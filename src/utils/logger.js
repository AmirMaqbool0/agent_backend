import fs from 'fs';
import path from 'path';
import winston from 'winston';

import { env } from '../config/env.js';

const logsDir = path.resolve('backend', 'logs');

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

export const logger = winston.createLogger({
  level: env.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ filename: path.join(logsDir, 'app.log') })
  ]
});

export const requestLoggerStream = {
  write: (message) => logger.info(message.trim())
};

