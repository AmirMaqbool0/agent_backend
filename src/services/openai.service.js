import OpenAI from 'openai';

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const client = env.openAiApiKey ? new OpenAI({ apiKey: env.openAiApiKey }) : null;

export const summarizeTranscript = async (transcript) => {
  if (!client || !transcript) {
    return transcript ? transcript.slice(0, 300) : '';
  }

  const response = await client.responses.create({
    model: env.openAiModel,
    input: [
      {
        role: 'system',
        content:
          'Summarize patient call transcripts for clinic staff in 2-3 short sentences.'
      },
      {
        role: 'user',
        content: transcript
      }
    ]
  });

  return response.output_text || '';
};

export const draftWhatsappConfirmation = async ({ patientName, clinicName, dateTime }) => {
  if (!client) {
    return `Hello ${patientName}, your appointment with ${clinicName} is confirmed for ${dateTime}. Reply if you need any changes.`;
  }

  try {
    const response = await client.responses.create({
      model: env.openAiModel,
      input: [
        {
          role: 'system',
          content:
            'Write a concise and professional WhatsApp appointment confirmation for a clinic.'
        },
        {
          role: 'user',
          content: `Patient: ${patientName}\nClinic: ${clinicName}\nAppointment: ${dateTime}`
        }
      ]
    });

    return response.output_text;
  } catch (error) {
    logger.warn(`OpenAI confirmation fallback used: ${error.message}`);
    return `Hello ${patientName}, your appointment with ${clinicName} is confirmed for ${dateTime}.`;
  }
};

export const draftWhatsappUpdate = async ({
  patientName,
  clinicName,
  dateTime,
  updateType
}) => {
  const fallback = (() => {
    if (updateType === 'cancelled') {
      return `Hello ${patientName}, your appointment with ${clinicName} scheduled for ${dateTime} has been cancelled.`;
    }

    if (updateType === 'rescheduled') {
      return `Hello ${patientName}, your appointment with ${clinicName} has been rescheduled to ${dateTime}.`;
    }

    return `Hello ${patientName}, there is an update to your appointment with ${clinicName} for ${dateTime}.`;
  })();

  if (!client) {
    return fallback;
  }

  try {
    const response = await client.responses.create({
      model: env.openAiModel,
      input: [
        {
          role: 'system',
          content:
            'Write a concise, professional WhatsApp message for a clinic appointment update.'
        },
        {
          role: 'user',
          content: `Patient: ${patientName}\nClinic: ${clinicName}\nAppointment: ${dateTime}\nUpdate type: ${updateType}`
        }
      ]
    });

    return response.output_text || fallback;
  } catch (error) {
    logger.warn(`OpenAI appointment update fallback used: ${error.message}`);
    return fallback;
  }
};

export const analyzeSentiment = async (transcript) => {
  if (!transcript) {
    return 'unknown';
  }

  if (!client) {
    const negativeKeywords = ['angry', 'upset', 'urgent', 'pain', 'bad'];
    const positiveKeywords = ['thanks', 'thank you', 'great', 'good'];
    const lower = transcript.toLowerCase();

    if (negativeKeywords.some((keyword) => lower.includes(keyword))) {
      return 'negative';
    }

    if (positiveKeywords.some((keyword) => lower.includes(keyword))) {
      return 'positive';
    }

    return 'neutral';
  }

  try {
    const response = await client.responses.create({
      model: env.openAiModel,
      input: [
        {
          role: 'system',
          content:
            'Classify the patient transcript sentiment as exactly one of: positive, neutral, negative.'
        },
        {
          role: 'user',
          content: transcript
        }
      ]
    });

    const sentiment = (response.output_text || '').trim().toLowerCase();
    if (['positive', 'neutral', 'negative'].includes(sentiment)) {
      return sentiment;
    }

    return 'neutral';
  } catch (error) {
    logger.warn(`OpenAI sentiment fallback used: ${error.message}`);
    return 'neutral';
  }
};

export const answerFaqWithOpenAi = async ({ question, faqs = [] }) => {
  if (!question) {
    return 'I do not have enough information to answer that right now.';
  }

  if (!client) {
    return faqs.length
      ? faqs[0].answer
      : 'I can help with appointments, clinic hours, and urgent call transfers.';
  }

  try {
    const context = faqs.length
      ? `Known FAQ entries:\n${faqs.map((faq) => `Q: ${faq.question}\nA: ${faq.answer}`).join('\n\n')}`
      : 'No FAQ knowledge entries matched directly.';

    const response = await client.responses.create({
      model: env.openAiModel,
      input: [
        {
          role: 'system',
          content:
            'Answer clinic receptionist questions clearly and briefly. If you do not know, say so without inventing facts.'
        },
        {
          role: 'user',
          content: `${context}\n\nQuestion: ${question}`
        }
      ]
    });

    return response.output_text || 'I do not have enough information to answer that right now.';
  } catch (error) {
    logger.warn(`OpenAI FAQ fallback used: ${error.message}`);
    return faqs.length
      ? faqs[0].answer
      : 'I do not have enough information to answer that right now.';
  }
};
