import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Translate common library errors into meaningful HTTP responses instead of a generic 500.
const normalizeError = (error) => {
  if (error.statusCode) {
    return { statusCode: error.statusCode, message: error.message, details: error.details };
  }

  if (error.name === 'CastError') {
    return { statusCode: 400, message: `Invalid value for ${error.path}` };
  }

  if (error.name === 'ValidationError') {
    return {
      statusCode: 422,
      message: 'Validation failed',
      details: Object.values(error.errors || {}).map((item) => ({
        path: item.path,
        msg: item.message
      }))
    };
  }

  if (error.code === 11000) {
    return { statusCode: 409, message: 'A record with these details already exists' };
  }

  if (error.type === 'entity.parse.failed') {
    return { statusCode: 400, message: 'Request body is not valid JSON' };
  }

  return {
    statusCode: 500,
    message:
      env.nodeEnv === 'production'
        ? 'Something went wrong on our side. Please try again.'
        : error.message || 'Internal server error'
  };
};

export const errorHandler = (error, _req, res, _next) => {
  const { statusCode, message, details } = normalizeError(error);

  if (statusCode >= 500) {
    logger.error(error.stack || error.message);
  } else {
    logger.warn(`${statusCode} ${message}`);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(details ? { details } : {})
  });
};
