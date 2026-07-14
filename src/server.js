import app from './app.js';
import { connectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

const startServer = async () => {
  await connectDatabase();
  console.log('GOOGLE_CALENDAR_ID =', env.googleCalendarId);
  console.log('GOOGLE_CALENDAR_AUTH_MODE =', env.googleCalendarAuthMode);

  app.listen(env.port, () => {
    logger.info(`Server running on port ${env.port}`);
  });
};

startServer().catch((error) => {
  logger.error(`Failed to start server: ${error.message}`);
  process.exit(1);
});
