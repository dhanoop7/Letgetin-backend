import { Types } from 'mongoose';
import { AppError } from '../../utils/appError.js';
import { RecruiterOrgRepository } from '../recruiterOrg/recruiterOrg.repository.js';
import { JobModel } from '../job/job.model.js';
import { ApplicationModel } from '../application/application.model.js';
import { UserModel } from '../user/user.model.js';
import {
  InstitutionStudentModel,
  IInstitutionStudentDocument,
  InstitutionStudentStatus,
} from './institutionStudent.model.js';
import { InstitutionRecruiterLinkModel, IInstitutionRecruiterLinkDocument } from './institutionRecruiterLink.model.js';
import { InstitutionEventModel, IInstitutionEventDocument } from './institutionEvent.model.js';
import { InstitutionTaskModel, IInstitutionTaskDocument } from './institutionTask.model.js';
import { InstitutionTrainingProgramModel, IInstitutionTrainingProgramDocument } from './institutionTrainingProgram.model.js';
import { InstitutionPolicyModel, IInstitutionPolicyDocument } from './institutionPolicy.model.js';
import {
  CreateStudentInput,
  UpdateStudentInput,
  CreateEventInput,
  UpdateEventInput,
  CreateTaskInput,
  UpdateTaskInput,
  CreateTrainingProgramInput,
  UpdatePolicyInput,
  AddRecruiterInput,
  UpdateRecruiterInput,
} from './institution.validator.js';
import { parseStudentFile } from './studentImport.util.js';

interface StudentUpsertFields {
  name: string;
  email: string;
  course: string;
  year?: string;
  skills?: string[];
  status?: InstitutionStudentStatus;
}

export class InstitutionService {
  private orgRepository = new RecruiterOrgRepository();

  async getInstitutionOrgId(ownerUserId: string): Promise<Types.ObjectId> {
    const org = await this.orgRepository.findByOwnerUserId(ownerUserId);
    if (!org) {
      throw AppError.notFound('Complete your institution profile setup first.');
    }
    if (org.entity !== 'institution') {
      throw AppError.forbidden('This feature is only available to institution accounts.');
    }
    return org._id as Types.ObjectId;
  }

  // ─── Students ───────────────────────────────────────────────────────────

  async listStudents(institutionOrgId: Types.ObjectId): Promise<IInstitutionStudentDocument[]> {
    return InstitutionStudentModel.find({ institutionOrgId }).sort({ createdAt: -1 });
  }

  private async linkCandidateId(email: string): Promise<Types.ObjectId | undefined> {
    const user = await UserModel.findOne({ email: email.toLowerCase(), role: 'user' }).select('_id').lean();
    return user ? (user._id as Types.ObjectId) : undefined;
  }

  async addStudent(
    institutionOrgId: Types.ObjectId,
    data: CreateStudentInput
  ): Promise<IInstitutionStudentDocument> {
    const email = data.email.trim().toLowerCase();
    const existing = await InstitutionStudentModel.findOne({ institutionOrgId, email });
    if (existing) {
      throw AppError.conflict('A student with this email is already on your roster.');
    }

    const candidateUserId = await this.linkCandidateId(email);
    return InstitutionStudentModel.create({
      institutionOrgId,
      name: data.name.trim(),
      email,
      course: data.course.trim(),
      year: data.year || '',
      skills: data.skills || [],
      status: data.status || 'active',
      candidateUserId,
    });
  }

  async updateStudent(
    institutionOrgId: Types.ObjectId,
    studentId: string,
    data: UpdateStudentInput
  ): Promise<IInstitutionStudentDocument> {
    const student = await InstitutionStudentModel.findOne({ _id: studentId, institutionOrgId });
    if (!student) {
      throw AppError.notFound('Student not found.');
    }

    if (data.name !== undefined) student.name = data.name.trim();
    if (data.course !== undefined) student.course = data.course.trim();
    if (data.year !== undefined) student.year = data.year;
    if (data.skills !== undefined) student.skills = data.skills;
    if (data.status !== undefined) student.status = data.status;

    if (data.email !== undefined) {
      const email = data.email.trim().toLowerCase();
      if (email !== student.email) {
        const clash = await InstitutionStudentModel.findOne({ institutionOrgId, email, _id: { $ne: student._id } });
        if (clash) {
          throw AppError.conflict('Another student on your roster already uses this email.');
        }
        student.email = email;
        student.candidateUserId = await this.linkCandidateId(email);
      }
    }

    await student.save();
    return student;
  }

  async deleteStudent(institutionOrgId: Types.ObjectId, studentId: string): Promise<void> {
    const result = await InstitutionStudentModel.deleteOne({ _id: studentId, institutionOrgId });
    if (result.deletedCount === 0) {
      throw AppError.notFound('Student not found.');
    }
  }

  async bulkUploadStudents(
    institutionOrgId: Types.ObjectId,
    buffer: Buffer,
    originalName: string,
    mimetype: string
  ): Promise<{ imported: number; failed: { row: number; reason: string }[]; duplicates: number }> {
    const { rows, failures } = await parseStudentFile(buffer, originalName, mimetype);

    const seenInFile = new Set<string>();
    const dedupedRows: typeof rows = [];
    for (const row of rows) {
      if (seenInFile.has(row.email)) {
        failures.push({ row: row.rowNumber, reason: `Duplicate email within file: ${row.email}` });
        continue;
      }
      seenInFile.add(row.email);
      dedupedRows.push(row);
    }

    if (dedupedRows.length === 0) {
      return { imported: 0, failed: failures, duplicates: 0 };
    }

    const emails = dedupedRows.map((r) => r.email);
    const [existingStudents, matchingUsers] = await Promise.all([
      InstitutionStudentModel.find({ institutionOrgId, email: { $in: emails } }).select('email').lean(),
      UserModel.find({ email: { $in: emails }, role: 'user' }).select('email _id').lean(),
    ]);
    const existingEmails = new Set(existingStudents.map((s) => s.email));
    const userIdByEmail = new Map(matchingUsers.map((u) => [u.email!.toLowerCase(), u._id]));

    let duplicates = 0;
    const toInsert = [];
    for (const row of dedupedRows) {
      if (existingEmails.has(row.email)) {
        duplicates++;
        continue;
      }
      toInsert.push({
        institutionOrgId,
        name: row.name,
        email: row.email,
        course: row.course,
        year: row.year,
        skills: row.skills,
        status: row.status,
        candidateUserId: userIdByEmail.get(row.email),
      });
    }

    let imported = 0;
    if (toInsert.length > 0) {
      const result = await InstitutionStudentModel.insertMany(toInsert, { ordered: false });
      imported = result.length;
    }

    return { imported, failed: failures, duplicates };
  }

  // ─── Recruiters ─────────────────────────────────────────────────────────
  // Recruiters are manually entered by the institution (Company/Contact/Email/Phone/Industry),
  // not linked to a real platform org account — mirrors the Student roster pattern. Requirements
  // are embedded, structured rows on each recruiter document.

  async listRecruiters(institutionOrgId: Types.ObjectId): Promise<IInstitutionRecruiterLinkDocument[]> {
    return InstitutionRecruiterLinkModel.find({ institutionOrgId }).sort({ createdAt: -1 });
  }

  async addRecruiter(
    institutionOrgId: Types.ObjectId,
    data: AddRecruiterInput
  ): Promise<IInstitutionRecruiterLinkDocument> {
    const email = data.email.trim().toLowerCase();
    const existing = await InstitutionRecruiterLinkModel.findOne({ institutionOrgId, email });
    if (existing) {
      throw AppError.conflict('A recruiter with this email has already been added.');
    }

    return InstitutionRecruiterLinkModel.create({
      institutionOrgId,
      company: data.company.trim(),
      contactPerson: data.contactPerson || '',
      email,
      phone: data.phone || '',
      industry: data.industry || '',
      status: data.status || 'active',
      requirements: data.requirements || [],
    });
  }

  async updateRecruiter(
    institutionOrgId: Types.ObjectId,
    recruiterId: string,
    data: UpdateRecruiterInput
  ): Promise<IInstitutionRecruiterLinkDocument> {
    const recruiter = await InstitutionRecruiterLinkModel.findOne({ _id: recruiterId, institutionOrgId });
    if (!recruiter) {
      throw AppError.notFound('Recruiter not found.');
    }

    if (data.company !== undefined) recruiter.company = data.company.trim();
    if (data.contactPerson !== undefined) recruiter.contactPerson = data.contactPerson;
    if (data.phone !== undefined) recruiter.phone = data.phone;
    if (data.industry !== undefined) recruiter.industry = data.industry;
    if (data.status !== undefined) recruiter.status = data.status;
    if (data.requirements !== undefined) recruiter.requirements = data.requirements as IInstitutionRecruiterLinkDocument['requirements'];

    if (data.email !== undefined) {
      const email = data.email.trim().toLowerCase();
      if (email !== recruiter.email) {
        const clash = await InstitutionRecruiterLinkModel.findOne({
          institutionOrgId,
          email,
          _id: { $ne: recruiter._id },
        });
        if (clash) {
          throw AppError.conflict('Another recruiter you added already uses this email.');
        }
        recruiter.email = email;
      }
    }

    await recruiter.save();
    return recruiter;
  }

  async disconnectRecruiter(institutionOrgId: Types.ObjectId, recruiterId: string): Promise<void> {
    const result = await InstitutionRecruiterLinkModel.deleteOne({ _id: recruiterId, institutionOrgId });
    if (result.deletedCount === 0) {
      throw AppError.notFound('Recruiter not found.');
    }
  }

  // ─── Pipeline & Placements (read-only view of linked students' real applications) ──────────
  // Institutions do not own the application — the hiring company does (enforced by the existing
  // recruiter-status ownership check against Job.postedBy). So this is read-only: it surfaces the
  // real, current status of each linked student's applications rather than letting the
  // institution drive a second, parallel status system.

  private async getLinkedStudents(institutionOrgId: Types.ObjectId) {
    return InstitutionStudentModel.find({ institutionOrgId, candidateUserId: { $ne: null } })
      .select('name email status candidateUserId')
      .lean();
  }

  async getPipeline(institutionOrgId: Types.ObjectId) {
    const students = await this.getLinkedStudents(institutionOrgId);
    if (students.length === 0) return [];

    const candidateIds = students.map((s) => s.candidateUserId);
    const applications = await ApplicationModel.find({ userId: { $in: candidateIds } })
      .select('userId jobId status matchScore appliedAt')
      .sort({ appliedAt: -1 })
      .lean();
    if (applications.length === 0) return [];

    const jobIds = [...new Set(applications.map((a) => String(a.jobId)))];
    const jobs = await JobModel.find({ _id: { $in: jobIds } }).select('title company').lean();
    const jobsById = new Map(jobs.map((j) => [String(j._id), j]));
    const studentsByUserId = new Map(students.map((s) => [String(s.candidateUserId), s]));

    return applications.map((app) => {
      const student = studentsByUserId.get(String(app.userId));
      const job = jobsById.get(String(app.jobId));
      return {
        applicationId: String(app._id),
        studentId: student?._id ? String(student._id) : '',
        studentName: student?.name || 'Student',
        studentEmail: student?.email || '',
        jobId: String(app.jobId),
        jobTitle: job?.title || 'Unknown role',
        companyName: job?.company?.name || 'Unknown company',
        status: app.status,
        matchScore: app.matchScore,
        appliedAt: app.appliedAt,
      };
    });
  }

  async getPlacements(institutionOrgId: Types.ObjectId) {
    const students = await InstitutionStudentModel.find({ institutionOrgId }).lean();
    if (students.length === 0) return [];

    const linked = students.filter((s) => s.candidateUserId);
    const candidateIds = linked.map((s) => s.candidateUserId);
    const applications = candidateIds.length
      ? await ApplicationModel.find({ userId: { $in: candidateIds }, status: 'offered' })
          .select('userId jobId status appliedAt updatedAt')
          .sort({ updatedAt: -1 })
          .lean()
      : [];

    const jobIds = [...new Set(applications.map((a) => String(a.jobId)))];
    const jobs = jobIds.length ? await JobModel.find({ _id: { $in: jobIds } }).select('title company').lean() : [];
    const jobsById = new Map(jobs.map((j) => [String(j._id), j]));

    const bestOfferByUserId = new Map<string, (typeof applications)[number]>();
    for (const app of applications) {
      const key = String(app.userId);
      if (!bestOfferByUserId.has(key)) bestOfferByUserId.set(key, app);
    }

    const relevant = students.filter(
      (s) => s.status === 'placed' || (s.candidateUserId && bestOfferByUserId.has(String(s.candidateUserId)))
    );

    return relevant.map((s) => {
      const offer = s.candidateUserId ? bestOfferByUserId.get(String(s.candidateUserId)) : undefined;
      const job = offer ? jobsById.get(String(offer.jobId)) : undefined;
      return {
        studentId: String(s._id),
        studentName: s.name,
        studentEmail: s.email,
        jobTitle: job?.title,
        companyName: job?.company?.name,
        offerDate: offer?.updatedAt,
        status: s.status,
      };
    });
  }

  // ─── Calendar ───────────────────────────────────────────────────────────

  async listEvents(institutionOrgId: Types.ObjectId, year?: string, month?: string): Promise<IInstitutionEventDocument[]> {
    const filter: Record<string, unknown> = { institutionOrgId };
    if (year && month) {
      const y = parseInt(year, 10);
      const m = parseInt(month, 10) - 1;
      filter.date = { $gte: new Date(y, m, 1), $lt: new Date(y, m + 1, 1) };
    }
    return InstitutionEventModel.find(filter).sort({ date: 1 });
  }

  async createEvent(institutionOrgId: Types.ObjectId, data: CreateEventInput): Promise<IInstitutionEventDocument> {
    const date = new Date(data.date);
    if (isNaN(date.getTime())) {
      throw AppError.badRequest('Invalid date.');
    }
    return InstitutionEventModel.create({
      institutionOrgId,
      title: data.title.trim(),
      date,
      type: data.type || 'other',
      notes: data.notes || '',
    });
  }

  async updateEvent(
    institutionOrgId: Types.ObjectId,
    eventId: string,
    data: UpdateEventInput
  ): Promise<IInstitutionEventDocument> {
    const event = await InstitutionEventModel.findOne({ _id: eventId, institutionOrgId });
    if (!event) throw AppError.notFound('Event not found.');

    if (data.title !== undefined) event.title = data.title.trim();
    if (data.type !== undefined) event.type = data.type;
    if (data.notes !== undefined) event.notes = data.notes;
    if (data.date !== undefined) {
      const date = new Date(data.date);
      if (isNaN(date.getTime())) throw AppError.badRequest('Invalid date.');
      event.date = date;
    }
    await event.save();
    return event;
  }

  async deleteEvent(institutionOrgId: Types.ObjectId, eventId: string): Promise<void> {
    const result = await InstitutionEventModel.deleteOne({ _id: eventId, institutionOrgId });
    if (result.deletedCount === 0) throw AppError.notFound('Event not found.');
  }

  // ─── Tasks ──────────────────────────────────────────────────────────────

  async listTasks(institutionOrgId: Types.ObjectId): Promise<IInstitutionTaskDocument[]> {
    return InstitutionTaskModel.find({ institutionOrgId }).sort({ done: 1, createdAt: -1 });
  }

  async createTask(institutionOrgId: Types.ObjectId, data: CreateTaskInput): Promise<IInstitutionTaskDocument> {
    return InstitutionTaskModel.create({
      institutionOrgId,
      name: data.name.trim(),
      estimatedTime: data.estimatedTime || '',
      priority: data.priority || 'Medium',
    });
  }

  async updateTask(
    institutionOrgId: Types.ObjectId,
    taskId: string,
    data: UpdateTaskInput
  ): Promise<IInstitutionTaskDocument> {
    const task = await InstitutionTaskModel.findOneAndUpdate({ _id: taskId, institutionOrgId }, data, { new: true });
    if (!task) throw AppError.notFound('Task not found.');
    return task;
  }

  async deleteTask(institutionOrgId: Types.ObjectId, taskId: string): Promise<void> {
    const result = await InstitutionTaskModel.deleteOne({ _id: taskId, institutionOrgId });
    if (result.deletedCount === 0) throw AppError.notFound('Task not found.');
  }

  // ─── Reports ────────────────────────────────────────────────────────────
  // All figures are computed from the same real Pipeline/Placements/roster data used elsewhere —
  // no hardcoded percentages or seeded figures.

  async getReports(institutionOrgId: Types.ObjectId) {
    const [pipeline, totalStudents, studentsPlaced, activeRecruiters, openJobs] = await Promise.all([
      this.getPipeline(institutionOrgId),
      InstitutionStudentModel.countDocuments({ institutionOrgId }),
      InstitutionStudentModel.countDocuments({ institutionOrgId, status: 'placed' }),
      InstitutionRecruiterLinkModel.countDocuments({ institutionOrgId, status: 'active' }),
      JobModel.countDocuments({ orgId: institutionOrgId, status: 'active' }),
    ]);

    const totalApplications = pipeline.length;
    const shortlisted = pipeline.filter((p) => ['shortlisted', 'interviewing', 'offered'].includes(p.status)).length;
    const interviews = pipeline.filter((p) => ['interviewing', 'offered'].includes(p.status)).length;
    const offeredEntries = pipeline.filter((p) => p.status === 'offered');
    const offers = offeredEntries.length;

    const offerJobIds = [...new Set(offeredEntries.map((p) => p.jobId))];
    const offerJobs = offerJobIds.length
      ? await JobModel.find({ _id: { $in: offerJobIds } }).select('salary').lean()
      : [];
    const salaryMidpoints = offerJobs
      .filter((j) => j.salary && (j.salary.min > 0 || j.salary.max > 0))
      .map((j) => (j.salary.min + j.salary.max) / 2)
      .filter((v) => v > 0);
    const averageSalary = salaryMidpoints.length
      ? Math.round(salaryMidpoints.reduce((a, b) => a + b, 0) / salaryMidpoints.length)
      : null;

    const placementRate = totalStudents > 0 ? Math.round((studentsPlaced / totalStudents) * 100) : null;

    return {
      placementRate,
      totalStudents,
      studentsPlaced,
      totalApplications,
      shortlisted,
      interviews,
      offers,
      averageSalary,
      activeRecruiters,
      openJobs,
    };
  }

  // ─── Training & Employability ────────────────────────────────────────────
  // Skill-gap insight is a deterministic frequency comparison (student skills vs. skills demanded
  // by the institution's own posted jobs) — no AI call, matching the dashboard's insight pattern.

  async getTrainingInsights(institutionOrgId: Types.ObjectId) {
    const students = await InstitutionStudentModel.find({ institutionOrgId }).select('skills').lean();

    if (students.length === 0) return { insights: [], skillGaps: [] };

    const jobs = await JobModel.find({ orgId: institutionOrgId, status: 'active' }).select('skills').lean();

    const demandCounts = new Map<string, number>();
    for (const job of jobs) {
      for (const skill of job.skills || []) {
        const key = skill.trim().toLowerCase();
        if (!key) continue;
        demandCounts.set(key, (demandCounts.get(key) || 0) + 1);
      }
    }

    const studentSkillSets = students.map((s) => new Set((s.skills || []).map((sk) => sk.trim().toLowerCase())));

    const insights: { kind: 'suggestion' | 'warning'; text: string }[] = [];
    const skillGaps: { skill: string; demandCount: number; studentsWithSkill: number; gapCount: number }[] = [];

    const sortedDemand = [...demandCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [skill, demandCount] of sortedDemand) {
      const studentsWithSkill = studentSkillSets.filter((set) => set.has(skill)).length;
      const gapCount = students.length - studentsWithSkill;
      skillGaps.push({ skill, demandCount, studentsWithSkill, gapCount });

      if (gapCount > 0) {
        const pctGap = Math.round((gapCount / students.length) * 100);
        if (pctGap >= 50) {
          insights.push({
            kind: 'warning',
            text: `${gapCount} of ${students.length} students (${pctGap}%) lack "${skill}", required by ${demandCount} open job${
              demandCount === 1 ? '' : 's'
            } from your recruiter network. Consider scheduling a training program.`,
          });
        }
      }
    }

    return { insights: insights.slice(0, 5), skillGaps };
  }

  async listTrainingPrograms(institutionOrgId: Types.ObjectId): Promise<IInstitutionTrainingProgramDocument[]> {
    return InstitutionTrainingProgramModel.find({ institutionOrgId }).sort({ createdAt: -1 });
  }

  async createTrainingProgram(
    institutionOrgId: Types.ObjectId,
    data: CreateTrainingProgramInput
  ): Promise<IInstitutionTrainingProgramDocument> {
    let scheduledDate: Date | undefined;
    if (data.scheduledDate) {
      scheduledDate = new Date(data.scheduledDate);
      if (isNaN(scheduledDate.getTime())) throw AppError.badRequest('Invalid scheduled date.');
    }
    return InstitutionTrainingProgramModel.create({
      institutionOrgId,
      name: data.name.trim(),
      scheduledDate,
      attendees: data.attendees,
      notes: data.notes || '',
    });
  }

  async deleteTrainingProgram(institutionOrgId: Types.ObjectId, programId: string): Promise<void> {
    const result = await InstitutionTrainingProgramModel.deleteOne({ _id: programId, institutionOrgId });
    if (result.deletedCount === 0) throw AppError.notFound('Training program not found.');
  }

  // ─── Policy Engine ──────────────────────────────────────────────────────
  // Persisted settings only, per the confirmed scope decision — these are NOT wired into the
  // shared candidate apply/reject flow, so this carries zero regression risk to that code path.

  async getPolicy(institutionOrgId: Types.ObjectId): Promise<IInstitutionPolicyDocument> {
    let policy = await InstitutionPolicyModel.findOne({ institutionOrgId });
    if (!policy) {
      policy = await InstitutionPolicyModel.create({ institutionOrgId });
    }
    return policy;
  }

  async updatePolicy(institutionOrgId: Types.ObjectId, data: UpdatePolicyInput): Promise<IInstitutionPolicyDocument> {
    const policy = await InstitutionPolicyModel.findOneAndUpdate(
      { institutionOrgId },
      { $set: data },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return policy;
  }

  // ─── Dashboard ──────────────────────────────────────────────────────────

  async getOverview(institutionOrgId: Types.ObjectId) {
    const [totalStudents, studentsPlaced, activeRecruiters, linkedCandidateIds, recentStudents, recentLinks] =
      await Promise.all([
        InstitutionStudentModel.countDocuments({ institutionOrgId }),
        InstitutionStudentModel.countDocuments({ institutionOrgId, status: 'placed' }),
        InstitutionRecruiterLinkModel.countDocuments({ institutionOrgId, status: 'active' }),
        InstitutionStudentModel.find({ institutionOrgId, candidateUserId: { $ne: null } }).distinct('candidateUserId'),
        InstitutionStudentModel.find({ institutionOrgId }).select('name createdAt').sort({ createdAt: -1 }).limit(5).lean(),
        InstitutionRecruiterLinkModel.find({ institutionOrgId })
          .select('company connectedAt')
          .sort({ connectedAt: -1 })
          .limit(5)
          .lean(),
      ]);

    // Jobs are always self-posted by the institution now (orgId === institutionOrgId) — there's
    // no "connected recruiter" job source anymore.
    const [openJobs, offersRolled, recentJobs] = await Promise.all([
      JobModel.countDocuments({ orgId: institutionOrgId, status: 'active' }),
      linkedCandidateIds.length
        ? ApplicationModel.countDocuments({ userId: { $in: linkedCandidateIds }, status: 'offered' })
        : 0,
      JobModel.find({ orgId: institutionOrgId, status: 'active' })
        .select('title publishedAt')
        .sort({ publishedAt: -1 })
        .limit(5)
        .lean(),
    ]);

    const placementRate = totalStudents > 0 ? Math.round((studentsPlaced / totalStudents) * 100) : null;

    type ActivityItem = { event: string; detail: string; date: Date };
    const activity: ActivityItem[] = [
      ...recentStudents.map((s) => ({ event: 'Student Added', detail: s.name, date: s.createdAt as Date })),
      ...recentLinks.map((l) => ({
        event: 'Recruiter Added',
        detail: l.company || 'Recruiter',
        date: l.connectedAt as Date,
      })),
      ...recentJobs.map((j) => ({ event: 'New Job Available', detail: j.title, date: j.publishedAt as Date })),
    ]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 5);

    const aiInsights: { kind: 'suggestion' | 'success' | 'warning'; text: string }[] = [];
    if (openJobs > 0) {
      aiInsights.push({
        kind: 'suggestion',
        text: `${openJobs} open job${openJobs === 1 ? '' : 's'} posted for your students.`,
      });
    }
    if (totalStudents > 0 && linkedCandidateIds.length > 0) {
      aiInsights.push({
        kind: 'success',
        text: `${linkedCandidateIds.length} of ${totalStudents} students on your roster have verified platform profiles.`,
      });
    }
    if (offersRolled > 0) {
      aiInsights.push({
        kind: 'success',
        text: `${offersRolled} offer${offersRolled === 1 ? '' : 's'} rolled out to your students so far.`,
      });
    }

    return {
      kpis: {
        totalStudents,
        activeRecruiters,
        openJobs,
        studentsPlaced,
        offersRolled,
        placementRate,
      },
      recentActivity: activity.map((a) => ({ event: a.event, detail: a.detail, date: a.date.toISOString() })),
      aiInsights: aiInsights.slice(0, 3),
    };
  }
}
