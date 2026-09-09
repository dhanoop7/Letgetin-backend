import { Router } from 'express';
import multer from 'multer';
import { InstitutionController } from './institution.controller.js';
import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, requireRole } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  createStudentSchema,
  updateStudentSchema,
  studentIdParamSchema,
  addRecruiterSchema,
  updateRecruiterSchema,
  recruiterLinkIdParamSchema,
  createEventSchema,
  listEventsSchema,
  updateEventSchema,
  eventIdParamSchema,
  createTaskSchema,
  updateTaskSchema,
  taskIdParamSchema,
  createTrainingProgramSchema,
  trainingProgramIdParamSchema,
  updatePolicySchema,
} from './institution.validator.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const router = Router();

router.use(authenticate, requireRole('recruiter'));

router.get('/overview', asyncHandler(InstitutionController.getOverview));

router.get('/students', asyncHandler(InstitutionController.listStudents));
router.post('/students', validate(createStudentSchema), asyncHandler(InstitutionController.addStudent));
router.post('/students/bulk-upload', upload.single('file'), asyncHandler(InstitutionController.bulkUploadStudents));
router.put('/students/:id', validate(updateStudentSchema), asyncHandler(InstitutionController.updateStudent));
router.delete('/students/:id', validate(studentIdParamSchema), asyncHandler(InstitutionController.deleteStudent));

router.get('/recruiters', asyncHandler(InstitutionController.listRecruiters));
router.post('/recruiters', validate(addRecruiterSchema), asyncHandler(InstitutionController.addRecruiter));
router.patch(
  '/recruiters/:id',
  validate(updateRecruiterSchema),
  asyncHandler(InstitutionController.updateRecruiter)
);
router.delete(
  '/recruiters/:id',
  validate(recruiterLinkIdParamSchema),
  asyncHandler(InstitutionController.disconnectRecruiter)
);


router.get('/pipeline', asyncHandler(InstitutionController.getPipeline));
router.get('/placements', asyncHandler(InstitutionController.getPlacements));

router.get('/events', validate(listEventsSchema), asyncHandler(InstitutionController.listEvents));
router.post('/events', validate(createEventSchema), asyncHandler(InstitutionController.createEvent));
router.put('/events/:id', validate(updateEventSchema), asyncHandler(InstitutionController.updateEvent));
router.delete('/events/:id', validate(eventIdParamSchema), asyncHandler(InstitutionController.deleteEvent));

router.get('/tasks', asyncHandler(InstitutionController.listTasks));
router.post('/tasks', validate(createTaskSchema), asyncHandler(InstitutionController.createTask));
router.patch('/tasks/:id', validate(updateTaskSchema), asyncHandler(InstitutionController.updateTask));
router.delete('/tasks/:id', validate(taskIdParamSchema), asyncHandler(InstitutionController.deleteTask));

router.get('/reports', asyncHandler(InstitutionController.getReports));

router.get('/training/insights', asyncHandler(InstitutionController.getTrainingInsights));
router.get('/training/programs', asyncHandler(InstitutionController.listTrainingPrograms));
router.post(
  '/training/programs',
  validate(createTrainingProgramSchema),
  asyncHandler(InstitutionController.createTrainingProgram)
);
router.delete(
  '/training/programs/:id',
  validate(trainingProgramIdParamSchema),
  asyncHandler(InstitutionController.deleteTrainingProgram)
);

router.get('/policy', asyncHandler(InstitutionController.getPolicy));
router.put('/policy', validate(updatePolicySchema), asyncHandler(InstitutionController.updatePolicy));

export default router;
