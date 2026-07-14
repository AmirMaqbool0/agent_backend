import { Router } from 'express';

import {
  createNewPatient,
  fetchPatientById,
  fetchPatients,
  removePatient,
  searchPatientsByQuery,
  updateExistingPatient
} from '../controllers/patient.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import {
  createPatientValidation,
  patientIdValidation,
  patientSearchValidation,
  updatePatientValidation
} from '../validators/patient.validator.js';

const router = Router();

router.get('/', authenticate, fetchPatients);
router.get('/search', authenticate, patientSearchValidation, validateRequest, searchPatientsByQuery);
router.get('/:id', authenticate, patientIdValidation, validateRequest, fetchPatientById);
router.post('/', authenticate, createPatientValidation, validateRequest, createNewPatient);
router.put('/:id', authenticate, updatePatientValidation, validateRequest, updateExistingPatient);
router.delete('/:id', authenticate, patientIdValidation, validateRequest, removePatient);

export default router;

