import app from './app.js';
import { connectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

const startServer = async () => {
  await connectDatabase();
  console.log('GOOGLE_CALENDAR_ID =', env.googleCalendarId);
  console.log('GOOGLE_CALENDAR_AUTH_MODE =', env.googleCalendarAuthMode);

  const server = app.listen(env.port, () => {
    logger.info(`Server running on port ${env.port}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      logger.error(
        `Port ${env.port} is already in use. Another backend is probably still running; stop it or set PORT to a different value in backend/.env.`
      );
    } else {
      logger.error(`Server error: ${error.message}`);
    }
    process.exit(1);
  });
};

startServer().catch((error) => {
  logger.error(`Failed to start server: ${error.message}`);
  process.exit(1);
});
