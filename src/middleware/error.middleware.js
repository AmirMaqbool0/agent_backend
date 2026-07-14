import { logger } from '../utils/logger.js';

export const errorHandler = (error, _req, res, _next) => {
  logger.error(error);

  const statusCode = error.statusCode || 500;
  const message = error.message || 'Internal server error';

  res.status(statusCode).json({
    success: false,
    message,
    ...(error.details ? { details: error.details } : {})
  });
};

