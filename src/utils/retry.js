import { logger } from './logger.js';

export const withRetry = async (
  operation,
  {
    retries = 2,
    delayMs = 300,
    operationName = 'external operation'
  } = {}
) => {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === retries) {
        break;
      }

      logger.warn(
        `${operationName} failed on attempt ${attempt + 1}. Retrying: ${error.message}`
      );

      await new Promise((resolve) => {
        setTimeout(resolve, delayMs * (attempt + 1));
      });
    }
  }

  throw lastError;
};

