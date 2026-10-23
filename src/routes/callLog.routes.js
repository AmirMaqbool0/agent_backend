import { Router } from 'express';

import { fetchCallLogs, streamCallRecording } from '../controllers/callLog.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { isValidRecordingSignature } from '../services/recordingAccess.service.js';

const router = Router();

router.get('/', authenticate, fetchCallLogs);
router.get('/:id/recording', (req, res, next) => {
  if (isValidRecordingSignature(req.params.id, req.query.expires, req.query.signature)) return next();
  return authenticate(req, res, next);
}, streamCallRecording);

export default router;

