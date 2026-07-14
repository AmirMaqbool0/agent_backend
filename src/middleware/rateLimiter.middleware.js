import rateLimit from 'express-rate-limit';

const logRateLimitHit = ({ limiterName, maxAllowed }) => (req, res, _next, options) => {
  const rateLimitState = req.rateLimit || {};

  console.log('[RATE LIMIT HIT]', {
    ip: req.ip,
    path: req.originalUrl,
    userAgent: req.headers['user-agent'],
    route: req.originalUrl,
    limiterName,
    current: rateLimitState.current ?? rateLimitState.used ?? null,
    maxAllowed: rateLimitState.limit ?? maxAllowed
  });

  res.status(options.statusCode).json(options.message);
};

export const activeRateLimiters = [
  {
    name: 'authLimiter',
    routes: [
      'POST /api/auth/register',
      'POST /api/auth/login'
    ]
  }
];

export const logActiveRateLimiters = () => {
  console.log('[RATE LIMIT ACTIVE]', activeRateLimiters);
};

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: logRateLimitHit({
    limiterName: 'authLimiter',
    maxAllowed: 20
  }),
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later'
  }
});
