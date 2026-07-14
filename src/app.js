import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import { logActiveRateLimiters } from './middleware/rateLimiter.middleware.js';
import { requestLoggerStream } from './utils/logger.js';
import routes from './routes/index.js';
import { notFoundHandler } from './middleware/notFound.middleware.js';
import { errorHandler } from './middleware/error.middleware.js';

const app = express();
logActiveRateLimiters();
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-webhook-secret',
    'x-webhook-signature'
  ]
};

app.use(helmet());
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, x-webhook-secret, x-webhook-signature'
  );

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});
app.use(morgan('combined', { stream: requestLoggerStream }));
app.use(
  express.json({
    limit: '2mb',
    verify: (req, _res, buffer) => {
      req.rawBody = buffer;
    }
  })
);
app.use(express.urlencoded({ extended: true }));

app.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'Clinic AI Receptionist backend is running',
    docs: {
      health: '/health',
      api: '/api'
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'Backend is healthy',
    timestamp: new Date().toISOString()
  });
});

app.use('/api/webhooks', (req, _res, next) => {
  console.log('[WEBHOOK REQUEST]', req.method, req.originalUrl);
  next();
});

app.use('/api', routes);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
