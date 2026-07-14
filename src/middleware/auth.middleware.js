import { User } from '../models/user.model.js';
import { ApiError } from '../utils/apiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { verifyToken } from '../utils/jwt.js';

export const authenticate = asyncHandler(async (req, _res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    throw new ApiError(401, 'Authentication token is missing');
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  const user = await User.findById(decoded.userId).select('-password');

  if (!user) {
    throw new ApiError(401, 'Invalid authentication token');
  }

  req.user = user;
  next();
});

