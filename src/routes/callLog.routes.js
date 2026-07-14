import { Router } from 'express';

import { fetchCallLogs } from '../controllers/callLog.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/', authenticate, fetchCallLogs);

export default router;

