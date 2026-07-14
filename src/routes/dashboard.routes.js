import { Router } from 'express';

import { fetchDashboard } from '../controllers/dashboard.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/', authenticate, fetchDashboard);

export default router;

