import { Router } from 'express';
import { TaskController } from './task.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  createTaskSchema,
  updateTaskSchema,
  updateTaskStatusSchema,
} from './task.validator.js';

const router = Router();

router.use(authenticate);

router.get('/', asyncHandler(TaskController.getTasks));
router.get('/:id', asyncHandler(TaskController.getTaskById));
router.post('/', validate(createTaskSchema), asyncHandler(TaskController.createTask));
router.put('/:id', validate(updateTaskSchema), asyncHandler(TaskController.updateTask));
router.patch('/:id', validate(updateTaskSchema), asyncHandler(TaskController.updateTask));
router.patch(
  '/:id/status',
  validate(updateTaskStatusSchema),
  asyncHandler(TaskController.updateTaskStatus)
);
router.delete('/:id', asyncHandler(TaskController.deleteTask));

export default router;
