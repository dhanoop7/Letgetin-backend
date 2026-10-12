import { Request, Response } from 'express';
import { AppError } from '../../utils/appError.js';
import { InstitutionService } from './institution.service.js';
import { InstitutionAdmissionService } from './institutionAdmission.service.js';

const institutionService = new InstitutionService();
const admissionService = new InstitutionAdmissionService();

export class InstitutionController {
  // ─── Admission Pipeline & Intakes ──────────────────────────────────────────

  static listAdmissionTracks = async (req: Request, res: Response): Promise<void> => {
    const orgId = await admissionService.getInstitutionOrgId(req.user!.userId);
    const tracks = await admissionService.listTracks(orgId);
    res.status(200).json({ success: true, data: tracks, timestamp: new Date().toISOString() });
  };

  static createAdmissionTrack = async (req: Request, res: Response): Promise<void> => {
    const orgId = await admissionService.getInstitutionOrgId(req.user!.userId);
    const track = await admissionService.createTrack(orgId, req.body);
    res.status(201).json({
      success: true,
      data: track,
      message: 'Admission track created successfully',
      timestamp: new Date().toISOString(),
    });
  };

  static listAdmissionApplications = async (req: Request, res: Response): Promise<void> => {
    const orgId = await admissionService.getInstitutionOrgId(req.user!.userId);
    const applications = await admissionService.listApplications(orgId, {
      program: req.query.program as string | undefined,
      stage: req.query.stage as string | undefined,
      search: req.query.search as string | undefined,
    });
    res.status(200).json({ success: true, data: applications, timestamp: new Date().toISOString() });
  };

  static createAdmissionApplication = async (req: Request, res: Response): Promise<void> => {
    const orgId = await admissionService.getInstitutionOrgId(req.user!.userId);
    const application = await admissionService.createApplication(orgId, req.body);
    res.status(201).json({
      success: true,
      data: application,
      message: 'Application registered successfully',
      timestamp: new Date().toISOString(),
    });
  };

  static updateAdmissionStage = async (req: Request, res: Response): Promise<void> => {
    const orgId = await admissionService.getInstitutionOrgId(req.user!.userId);
    const { stage, note } = req.body;
    if (!stage) {
      throw AppError.badRequest('New stage is required.');
    }
    const application = await admissionService.updateStage(orgId, req.params.id as string, stage, note);
    res.status(200).json({
      success: true,
      data: application,
      message: 'Stage updated successfully',
      timestamp: new Date().toISOString(),
    });
  };

  static updateAdmissionApplication = async (req: Request, res: Response): Promise<void> => {
    const orgId = await admissionService.getInstitutionOrgId(req.user!.userId);
    const application = await admissionService.updateApplication(orgId, req.params.id as string, req.body);
    res.status(200).json({
      success: true,
      data: application,
      message: 'Application updated successfully',
      timestamp: new Date().toISOString(),
    });
  };

  static bulkIssueCallLetters = async (req: Request, res: Response): Promise<void> => {
    const orgId = await admissionService.getInstitutionOrgId(req.user!.userId);
    const { applicantIds } = req.body;
    if (!Array.isArray(applicantIds) || applicantIds.length === 0) {
      throw AppError.badRequest('List of applicantIds is required.');
    }
    const result = await admissionService.bulkIssueCallLetters(orgId, applicantIds);
    res.status(200).json({
      success: true,
      data: result,
      message: `Issued counseling letters to ${result.updatedCount} candidate(s)`,
      timestamp: new Date().toISOString(),
    });
  };

  static addAdmissionNote = async (req: Request, res: Response): Promise<void> => {
    const orgId = await admissionService.getInstitutionOrgId(req.user!.userId);
    const { note } = req.body;
    if (!note || !note.trim()) {
      throw AppError.badRequest('Note content is required.');
    }
    const application = await admissionService.addNote(
      orgId,
      req.params.id as string,
      note,
      req.user!.email || 'Admissions Officer'
    );
    res.status(200).json({
      success: true,
      data: application,
      message: 'Note added successfully',
      timestamp: new Date().toISOString(),
    });
  };
  static listStudents = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    const students = await institutionService.listStudents(orgId);
    res.status(200).json({ success: true, data: students, timestamp: new Date().toISOString() });
  };

  static addStudent = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    const student = await institutionService.addStudent(orgId, req.body);
    res
      .status(201)
      .json({ success: true, data: student, message: 'Student added successfully', timestamp: new Date().toISOString() });
  };

  static updateStudent = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    const student = await institutionService.updateStudent(orgId, req.params.id as string, req.body);
    res
      .status(200)
      .json({ success: true, data: student, message: 'Student updated successfully', timestamp: new Date().toISOString() });
  };

  static deleteStudent = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    await institutionService.deleteStudent(orgId, req.params.id as string);
    res.status(200).json({ success: true, message: 'Student removed', timestamp: new Date().toISOString() });
  };

  static bulkUploadStudents = async (req: Request, res: Response): Promise<void> => {
    if (!req.file) {
      throw AppError.badRequest('No file uploaded.');
    }
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    const result = await institutionService.bulkUploadStudents(
      orgId,
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );
    res.status(200).json({
      success: true,
      data: result,
      message: `Imported ${result.imported} student${result.imported === 1 ? '' : 's'}.`,
      timestamp: new Date().toISOString(),
    });
  };

  static listRecruiters = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    const recruiters = await institutionService.listRecruiters(orgId);
    res.status(200).json({ success: true, data: recruiters, timestamp: new Date().toISOString() });
  };

  static addRecruiter = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    const recruiter = await institutionService.addRecruiter(orgId, req.body);
    res
      .status(201)
      .json({ success: true, data: recruiter, message: 'Recruiter added successfully', timestamp: new Date().toISOString() });
  };

  static updateRecruiter = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    const recruiter = await institutionService.updateRecruiter(orgId, req.params.id as string, req.body);
    res
      .status(200)
      .json({ success: true, data: recruiter, message: 'Recruiter updated successfully', timestamp: new Date().toISOString() });
  };

  static disconnectRecruiter = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    await institutionService.disconnectRecruiter(orgId, req.params.id as string);
    res.status(200).json({ success: true, message: 'Recruiter removed', timestamp: new Date().toISOString() });
  };

  static listEvents = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    const year = typeof req.query.year === 'string' ? req.query.year : undefined;
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    const events = await institutionService.listEvents(orgId, year, month);
    res.status(200).json({ success: true, data: events, timestamp: new Date().toISOString() });
  };

  static createEvent = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    const event = await institutionService.createEvent(orgId, req.body);
    res.status(201).json({ success: true, data: event, message: 'Event added', timestamp: new Date().toISOString() });
  };

  static updateEvent = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    const event = await institutionService.updateEvent(orgId, req.params.id as string, req.body);
    res.status(200).json({ success: true, data: event, message: 'Event updated', timestamp: new Date().toISOString() });
  };

  static deleteEvent = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    await institutionService.deleteEvent(orgId, req.params.id as string);
    res.status(200).json({ success: true, message: 'Event removed', timestamp: new Date().toISOString() });
  };

  static listTasks = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    const tasks = await institutionService.listTasks(orgId);
    res.status(200).json({ success: true, data: tasks, timestamp: new Date().toISOString() });
  };

  static createTask = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    const task = await institutionService.createTask(orgId, req.body);
    res.status(201).json({ success: true, data: task, message: 'Task added', timestamp: new Date().toISOString() });
  };

  static updateTask = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    const task = await institutionService.updateTask(orgId, req.params.id as string, req.body);
    res.status(200).json({ success: true, data: task, message: 'Task updated', timestamp: new Date().toISOString() });
  };

  static deleteTask = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    await institutionService.deleteTask(orgId, req.params.id as string);
    res.status(200).json({ success: true, message: 'Task removed', timestamp: new Date().toISOString() });
  };

  static getReports = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    const reports = await institutionService.getReports(orgId);
    res.status(200).json({ success: true, data: reports, timestamp: new Date().toISOString() });
  };

  static getTrainingInsights = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    const insights = await institutionService.getTrainingInsights(orgId);
    res.status(200).json({ success: true, data: insights, timestamp: new Date().toISOString() });
  };

  static listTrainingPrograms = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    const programs = await institutionService.listTrainingPrograms(orgId);
    res.status(200).json({ success: true, data: programs, timestamp: new Date().toISOString() });
  };

  static createTrainingProgram = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    const program = await institutionService.createTrainingProgram(orgId, req.body);
    res.status(201).json({ success: true, data: program, message: 'Training program scheduled', timestamp: new Date().toISOString() });
  };

  static deleteTrainingProgram = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    await institutionService.deleteTrainingProgram(orgId, req.params.id as string);
    res.status(200).json({ success: true, message: 'Training program removed', timestamp: new Date().toISOString() });
  };

  static getPolicy = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    const policy = await institutionService.getPolicy(orgId);
    res.status(200).json({ success: true, data: policy, timestamp: new Date().toISOString() });
  };

  static updatePolicy = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    const policy = await institutionService.updatePolicy(orgId, req.body);
    res.status(200).json({ success: true, data: policy, message: 'Policies saved', timestamp: new Date().toISOString() });
  };

  static getPipeline = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    const pipeline = await institutionService.getPipeline(orgId);
    res.status(200).json({ success: true, data: pipeline, timestamp: new Date().toISOString() });
  };

  static getPlacements = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    const placements = await institutionService.getPlacements(orgId);
    res.status(200).json({ success: true, data: placements, timestamp: new Date().toISOString() });
  };

  static getOverview = async (req: Request, res: Response): Promise<void> => {
    const orgId = await institutionService.getInstitutionOrgId(req.user!.userId);
    const overview = await institutionService.getOverview(orgId);
    res.status(200).json({ success: true, data: overview, timestamp: new Date().toISOString() });
  };
}
