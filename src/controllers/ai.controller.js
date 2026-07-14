import { answerFaq } from '../services/faq.service.js';
import { analyzeSentiment, summarizeTranscript } from '../services/openai.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';

export const generateSummary = asyncHandler(async (req, res) => {
  const summary = await summarizeTranscript(req.body.transcript);

  sendSuccess(res, 200, 'Summary generated successfully', {
    summary
  });
});

export const generateSentiment = asyncHandler(async (req, res) => {
  const sentiment = await analyzeSentiment(req.body.transcript);

  sendSuccess(res, 200, 'Sentiment analyzed successfully', {
    sentiment
  });
});

export const generateFaqAnswer = asyncHandler(async (req, res) => {
  const result = await answerFaq(req.body.question);

  sendSuccess(res, 200, 'FAQ answer generated successfully', {
    answer: result.answer,
    source: result.source
  });
});

