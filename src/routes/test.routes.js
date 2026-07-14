import { Router } from 'express';

import { createCalendarTestEvent } from '../controllers/calendarTest.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/test-calendar', authenticate, createCalendarTestEvent);

export default router;
