import { Router } from 'express';
import { NoteController } from './note.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { createNoteSchema, updateNoteSchema } from './note.validator.js';

const router = Router();

router.use(authenticate);

router.get('/', asyncHandler(NoteController.getNotes));
router.get('/:id', asyncHandler(NoteController.getNoteById));
router.post('/', validate(createNoteSchema), asyncHandler(NoteController.createNote));
router.put('/:id', validate(updateNoteSchema), asyncHandler(NoteController.updateNote));
router.patch('/:id', validate(updateNoteSchema), asyncHandler(NoteController.updateNote));
router.delete('/:id', asyncHandler(NoteController.deleteNote));

export default router;
