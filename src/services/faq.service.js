import { FAQKnowledge } from '../models/faqKnowledge.model.js';
import { answerFaqWithOpenAi } from './openai.service.js';
import { ApiError } from '../utils/apiError.js';
import { logger } from '../utils/logger.js';

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'at',
  'can',
  'could',
  'do',
  'for',
  'from',
  'i',
  'in',
  'is',
  'me',
  'of',
  'on',
  'our',
  'please',
  'tell',
  'the',
  'to',
  'we',
  'what',
  'where',
  'which',
  'you',
  'your'
]);

const TOKEN_CANONICAL_MAP = {
  address: 'location',
  area: 'location',
  based: 'location',
  centre: 'clinic',
  center: 'clinic',
  clinic: 'clinic',
  contact: 'contact',
  cost: 'price',
  direction: 'location',
  directions: 'location',
  fee: 'price',
  fees: 'price',
  hospital: 'clinic',
  hour: 'hours',
  hours: 'hours',
  locate: 'location',
  located: 'location',
  location: 'location',
  map: 'location',
  office: 'clinic',
  opening: 'hours',
  phone: 'contact',
  place: 'location',
  price: 'price',
  reach: 'location',
  schedule: 'appointment',
  site: 'location',
  timing: 'hours',
  timings: 'hours',
  venue: 'location'
};

const normalizeText = (value = '') =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const canonicalizeToken = (token) => {
  if (TOKEN_CANONICAL_MAP[token]) {
    return TOKEN_CANONICAL_MAP[token];
  }

  if (token.endsWith('ies') && token.length > 3) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.endsWith('s') && token.length > 3) {
    return token.slice(0, -1);
  }

  return token;
};

const tokenize = (value = '') =>
  normalizeText(value)
    .split(' ')
    .filter(Boolean)
    .filter((token) => !STOP_WORDS.has(token))
    .map(canonicalizeToken);

const intersectionCount = (leftSet, rightSet) =>
  [...leftSet].filter((token) => rightSet.has(token)).length;

const buildFaqCandidate = (faq) => {
  const questionTokens = new Set(tokenize(faq.question));
  const answerTokens = new Set(tokenize(faq.answer));
  const categoryTokens = new Set(tokenize(faq.category));
  const keywordTokens = new Set((faq.keywords || []).flatMap((keyword) => tokenize(keyword)));
  const allTokens = new Set([
    ...questionTokens,
    ...answerTokens,
    ...categoryTokens,
    ...keywordTokens
  ]);

  return {
    faq,
    normalizedQuestion: normalizeText(faq.question),
    normalizedAnswer: normalizeText(faq.answer),
    questionTokens,
    answerTokens,
    categoryTokens,
    allTokens
  };
};

const scoreFaqCandidate = ({ question, candidate }) => {
  const normalizedQuestion = normalizeText(question);
  const queryTokens = new Set(tokenize(question));

  if (!queryTokens.size) {
    return {
      score: 0,
      overlapTokens: [],
      candidate
    };
  }

  const overlapWithAll = intersectionCount(queryTokens, candidate.allTokens);
  const overlapWithQuestion = intersectionCount(queryTokens, candidate.questionTokens);
  const overlapWithAnswer = intersectionCount(queryTokens, candidate.answerTokens);
  const phraseBoost =
    candidate.normalizedQuestion.includes(normalizedQuestion) ||
    normalizedQuestion.includes(candidate.normalizedQuestion)
      ? 1
      : 0;
  const exactQuestionBoost = candidate.normalizedQuestion === normalizedQuestion ? 2 : 0;

  const score =
    exactQuestionBoost +
    phraseBoost +
    overlapWithAll / queryTokens.size +
    overlapWithQuestion / Math.max(queryTokens.size, 1) +
    overlapWithAnswer / Math.max(queryTokens.size * 2, 1);

  return {
    score,
    overlapTokens: [...queryTokens].filter((token) => candidate.allTokens.has(token)),
    candidate
  };
};

export const listFaqs = async () =>
  FAQKnowledge.find().sort({ updatedAt: -1, createdAt: -1 });

export const createFaq = async ({ question, answer, category }) => {
  const faq = await FAQKnowledge.create({
    question,
    answer,
    category
  });

  logger.info(`Created FAQ: ${faq._id}`);

  return faq;
};

export const updateFaq = async (faqId, payload) => {
  const faq = await FAQKnowledge.findById(faqId);

  if (!faq) {
    throw new ApiError(404, 'FAQ not found');
  }

  Object.assign(faq, payload);
  await faq.save();

  logger.info(`Updated FAQ: ${faq._id}`);

  return faq;
};

export const deleteFaq = async (faqId) => {
  const faq = await FAQKnowledge.findById(faqId);

  if (!faq) {
    throw new ApiError(404, 'FAQ not found');
  }

  await faq.deleteOne();

  logger.info(`Deleted FAQ: ${faq._id}`);
};

export const findFaqMatches = async (question) => {
  const searchTerm = question?.trim();

  if (!searchTerm) {
    logger.info('FAQ lookup skipped because the incoming question was empty');
    return [];
  }

  logger.info(`FAQ incoming question: ${searchTerm}`);
  const faqs = await FAQKnowledge.find({ isActive: true }).limit(50);
  const scoredMatches = faqs
    .map((faq) => scoreFaqCandidate({ question: searchTerm, candidate: buildFaqCandidate(faq) }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return (
        new Date(right.candidate.faq.updatedAt || 0).getTime() -
        new Date(left.candidate.faq.updatedAt || 0).getTime()
      );
    });

  const acceptedMatches = scoredMatches
    .filter(({ score }) => score >= 0.75)
    .slice(0, 5)
    .map(({ score, overlapTokens, candidate }) => ({
      ...candidate.faq.toObject(),
      similarityScore: Number(score.toFixed(3)),
      overlapTokens
    }));

  if (acceptedMatches.length) {
    const bestMatch = acceptedMatches[0];
    logger.info(
      `FAQ matched: ${bestMatch._id} score=${bestMatch.similarityScore} overlap=${bestMatch.overlapTokens.join(',') || 'none'} question="${bestMatch.question}"`
    );
  } else {
    const topScore = scoredMatches[0];
    logger.info(
      `FAQ matched: none score=${topScore ? topScore.score.toFixed(3) : '0.000'} overlap=${topScore ? topScore.overlapTokens.join(',') || 'none' : 'none'}`
    );
  }

  return acceptedMatches;
};

export const answerFaq = async (question) => {
  const matches = await findFaqMatches(question);

  if (matches.length) {
    return {
      source: 'faq-db',
      answer: matches[0].answer,
      matches
    };
  }

  logger.info(`FAQ fallback to OpenAI for question: ${question}`);
  const answer = await answerFaqWithOpenAi({ question, faqs: matches });
  return {
    source: 'openai',
    answer,
    matches
  };
};
