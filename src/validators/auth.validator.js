import { body, param } from 'express-validator';

const passwordRule = (field) =>
  body(field)
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long');

export const registerValidation = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').trim().isEmail().withMessage('Valid email is required'),
  passwordRule('password')
];

export const loginValidation = [
  body('email').trim().isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required')
];

export const updateProfileValidation = [
  body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
  body('email').optional().trim().isEmail().withMessage('Valid email is required')
];

export const changePasswordValidation = [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  passwordRule('newPassword')
];

export const createUserValidation = [
  ...registerValidation,
  body('role').optional().isIn(['admin', 'staff']).withMessage('Role must be admin or staff')
];

export const userIdValidation = [
  param('id').isMongoId().withMessage('User id must be a valid MongoDB id')
];

export const resetUserPasswordValidation = [...userIdValidation, passwordRule('password')];
