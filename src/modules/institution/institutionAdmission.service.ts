import { Types } from 'mongoose';
import { AppError } from '../../utils/appError.js';
import { RecruiterOrgRepository } from '../recruiterOrg/recruiterOrg.repository.js';
import { RecruiterOrganizationModel } from '../recruiterOrg/recruiterOrg.model.js';
import {
  InstitutionAdmissionTrackModel,
  IInstitutionAdmissionTrackDocument,
} from './institutionAdmissionTrack.model.js';
import {
  InstitutionAdmissionApplicationModel,
  IInstitutionAdmissionApplicationDocument,
  AdmissionStage,
  VerificationStatus,
} from './institutionAdmissionApplication.model.js';

export interface CreateAdmissionTrackInput {
  program: string;
  school: string;
  seats: number;
  startDate?: string;
  deadline?: string;
  eligibility?: string;
  applicationFee?: string;
  status?: 'Open' | 'Upcoming' | 'Closed';
}

export interface CreateAdmissionApplicationInput {
  name: string;
  email: string;
  phone?: string;
  city?: string;
  program: string;
  stage?: AdmissionStage;
  score?: string;
  gpa?: string;
  category?: string;
  source?: string;
  counselor?: string;
  hostelOpted?: boolean;
}

export interface UpdateAdmissionApplicationInput {
  name?: string;
  email?: string;
  phone?: string;
  city?: string;
  program?: string;
  stage?: AdmissionStage;
  score?: string;
  gpa?: string;
  category?: string;
  source?: string;
  counselor?: string;
  meritRank?: number;
  meritIndex?: number;
  enrollmentNo?: string;
  feeStatus?: 'Full Fee Paid' | 'Token Paid (₹50k)' | 'Scholarship 100%' | 'Pending';
  scholarshipTier?: string;
  hostelOpted?: boolean;
  callLetterSent?: boolean;
}

export class InstitutionAdmissionService {
  private orgRepository = new RecruiterOrgRepository();

  /**
   * Resolves or provisions the institution organization for the current user.
   */
  async getInstitutionOrgId(ownerUserId: string): Promise<Types.ObjectId> {
    let org = await this.orgRepository.findByOwnerUserId(ownerUserId);
    if (!org) {
      org = await RecruiterOrganizationModel.create({
        ownerUserId: new Types.ObjectId(ownerUserId),
        name: 'Heritage Institute of Technology',
        entity: 'institution',
        website: 'https://heritage-institute.edu',
        verified: true,
      });
    }
    return org._id as Types.ObjectId;
  }

  /**
   * Seeds demo tracks and applicants if the institution has no data yet.
   */
  async ensureSeedData(institutionOrgId: Types.ObjectId): Promise<void> {
    const trackCount = await InstitutionAdmissionTrackModel.countDocuments({ institutionOrgId });
    if (trackCount === 0) {
      await InstitutionAdmissionTrackModel.insertMany([
        {
          institutionOrgId,
          program: 'B.Tech Computer Science & AI (2027 Batch)',
          school: 'School of Computing & Data Sciences',
          seats: 240,
          appliedCount: 4,
          startDate: 'Oct 01, 2026',
          deadline: 'Dec 15, 2026',
          eligibility: 'Min 75% in 10+2 (PCM) or Top 50k JEE Main Rank',
          applicationFee: '₹1,200',
          status: 'Open',
        },
        {
          institutionOrgId,
          program: 'B.Tech Electronics & VLSI Systems',
          school: 'Department of Electrical Engineering',
          seats: 120,
          appliedCount: 1,
          startDate: 'Oct 15, 2026',
          deadline: 'Dec 30, 2026',
          eligibility: 'Min 70% in 10+2 (PCM) with Math mandatory',
          applicationFee: '₹1,000',
          status: 'Open',
        },
        {
          institutionOrgId,
          program: 'MBA & Executive Tech Management',
          school: 'School of Business & Analytics',
          seats: 180,
          appliedCount: 2,
          startDate: 'Nov 01, 2026',
          deadline: 'Jan 15, 2027',
          eligibility: 'Graduation (Min 60%) + CAT/GMAT/MAT Score',
          applicationFee: '₹1,500',
          status: 'Upcoming',
        },
        {
          institutionOrgId,
          program: 'B.Tech Robotics & IoT',
          school: 'School of Computing & Data Sciences',
          seats: 60,
          appliedCount: 1,
          startDate: 'Oct 01, 2026',
          deadline: 'Dec 31, 2026',
          eligibility: 'Min 70% in 10+2 (PCM)',
          applicationFee: '₹1,200',
          status: 'Open',
        },
      ]);
    }

    const appCount = await InstitutionAdmissionApplicationModel.countDocuments({ institutionOrgId });
    if (appCount === 0) {
      const defaultDocs = [
        { name: 'Government Photo ID', type: 'PDF', size: '1.2 MB', status: 'verified' as VerificationStatus, updatedAt: new Date() },
        { name: 'Class XII / Degree Transcript', type: 'PDF', size: '860 KB', status: 'verified' as VerificationStatus, updatedAt: new Date() },
        { name: 'Entrance Exam Scorecard', type: 'PDF', size: '340 KB', status: 'verified' as VerificationStatus, updatedAt: new Date() },
        { name: 'Statement of Purpose', type: 'DOCX', size: '45 KB', status: 'verified' as VerificationStatus, updatedAt: new Date() },
      ];

      const defaultChecks = [
        { id: 'identity', label: 'Identity & KYC', desc: 'Government Aadhaar/Passport match', vendor: 'VerifyNow', status: 'verified' as VerificationStatus, updatedAt: new Date() },
        { id: 'academic', label: 'Academic Credentials', desc: '10+2 Board Marks and Transcript Authenticity', vendor: 'CredCheck', status: 'verified' as VerificationStatus, updatedAt: new Date() },
        { id: 'prior', label: 'Prior School/College Record', desc: 'Conduct certificate and migration status', vendor: 'EduTrace', status: 'verified' as VerificationStatus, updatedAt: new Date() },
        { id: 'reference', label: 'Reference Check', desc: 'Dean / School Principal reference call', vendor: 'RefVerify', status: 'verified' as VerificationStatus, updatedAt: new Date() },
      ];

      const defaultAssessments = [
        { name: 'Aptitude & Logical Reasoning', weight: 30, score: 92, max: 100, status: 'done' as const },
        { name: 'Subject Proficiency (PCM/Business)', weight: 30, score: 88, max: 100, status: 'done' as const },
        { name: 'English & Communication Test', weight: 15, score: 90, max: 100, status: 'done' as const },
        { name: 'Faculty Panel Interview', weight: 25, score: 94, max: 100, status: 'done' as const },
      ];

      await InstitutionAdmissionApplicationModel.insertMany([
        {
          institutionOrgId,
          applicantId: 'ADM-2026-001',
          name: 'Divya Nair',
          email: 'divya.nair@gmail.com',
          phone: '+91 94471 88921',
          city: 'Bengaluru, India',
          program: 'B.Tech Computer Science & AI (2027 Batch)',
          stage: 'enrolled',
          score: 'JEE 99.1%ile (Top 1000)',
          gpa: '97.6% (CBSE)',
          category: '100% Tuition Scholar',
          source: 'Website',
          counselor: 'Priya Nair',
          meritRank: 1,
          meritIndex: 98.4,
          enrollmentNo: 'LGI-2027-CS-001',
          feeStatus: 'Scholarship 100%',
          scholarshipTier: 'Chancellor Gold Scholar',
          hostelOpted: true,
          callLetterSent: true,
          documents: defaultDocs,
          bgChecks: { overall: 'verified', checks: defaultChecks },
          assessments: defaultAssessments,
          timeline: [
            { title: 'Seat confirmed & enrollment complete', meta: 'Allotment ID: LGI-2027-CS-001', date: new Date('2026-10-02') },
            { title: 'Counseling call completed', meta: 'Slot attended with Parents', date: new Date('2026-09-28') },
            { title: 'Merit shortlist cutoff cleared', meta: 'Rank #1 in CS AI', date: new Date('2026-09-22') },
            { title: 'Application submitted', meta: 'Fee: ₹1,200 verified', date: new Date('2026-09-15') },
          ],
          notes: [
            { text: 'Top percentile candidate. Granted 100% Chancellor Tuition Scholarship.', author: 'Priya Nair', createdAt: new Date('2026-09-28') },
          ],
        },
        {
          institutionOrgId,
          applicantId: 'ADM-2026-002',
          name: 'Rohan Verma',
          email: 'rohan.v@gmail.com',
          phone: '+91 98451 23041',
          city: 'Delhi, India',
          program: 'B.Tech Computer Science & AI (2027 Batch)',
          stage: 'counseling',
          score: 'JEE 98.4%ile (Rank 1,480)',
          gpa: '94.2% (ISC)',
          category: 'General Merit',
          source: 'Education Fair',
          counselor: 'Priya Nair',
          meritRank: 2,
          meritIndex: 96.3,
          enrollmentNo: 'LGI-2027-CS-002',
          feeStatus: 'Token Paid (₹50k)',
          scholarshipTier: 'Merit Tier-1 (25% Waiver)',
          hostelOpted: true,
          callLetterSent: true,
          documents: defaultDocs,
          bgChecks: { overall: 'verified', checks: defaultChecks },
          assessments: defaultAssessments,
          timeline: [
            { title: 'Counseling slot confirmed', meta: 'Room 204 with Academic Advisor', date: new Date('2026-10-04') },
            { title: 'Counseling call letter dispatched', meta: 'Slot booked for Oct 12', date: new Date('2026-09-29') },
            { title: 'Application submitted', meta: 'Fee: ₹1,200 verified', date: new Date('2026-09-18') },
          ],
          notes: [
            { text: 'Candidate requested hostel accommodation for 1st year.', author: 'Priya Nair', createdAt: new Date('2026-10-04') },
          ],
        },
        {
          institutionOrgId,
          applicantId: 'ADM-2026-003',
          name: 'Vikram Malhotra',
          email: 'vikram.m@gmail.com',
          phone: '+91 96540 11234',
          city: 'Mumbai, India',
          program: 'B.Tech Robotics & IoT',
          stage: 'shortlisted',
          score: 'JEE 97.2%ile',
          gpa: '93.8% (State Board)',
          category: 'State Domicile',
          source: 'Website',
          counselor: 'Rahul Verma',
          meritRank: 3,
          meritIndex: 95.5,
          enrollmentNo: 'LGI-2027-RO-001',
          feeStatus: 'Pending',
          scholarshipTier: 'State Domicile Waiver',
          hostelOpted: true,
          callLetterSent: false,
          documents: defaultDocs,
          bgChecks: { overall: 'verified', checks: defaultChecks },
          assessments: defaultAssessments,
          timeline: [
            { title: 'Merit shortlist cleared', meta: 'Rank #3 in Robotics', date: new Date('2026-09-28') },
            { title: 'Application submitted', meta: 'Fee: ₹1,200 verified', date: new Date('2026-09-20') },
          ],
          notes: [],
        },
        {
          institutionOrgId,
          applicantId: 'ADM-2026-004',
          name: 'Ananya Iyer',
          email: 'ananya.iyer@gmail.com',
          phone: '+91 99002 45671',
          city: 'Bengaluru, India',
          program: 'B.Tech Computer Science & AI (2027 Batch)',
          stage: 'shortlisted',
          score: 'SAT 1480 / 1600',
          gpa: '96.0% (IB Diploma)',
          category: 'International / NRI',
          source: 'Agent',
          counselor: 'Ananya Bose',
          meritRank: 4,
          meritIndex: 94.8,
          feeStatus: 'Pending',
          scholarshipTier: 'None',
          hostelOpted: false,
          callLetterSent: true,
          documents: defaultDocs,
          bgChecks: { overall: 'in_progress', checks: defaultChecks },
          assessments: defaultAssessments,
          timeline: [
            { title: 'Call letter dispatched', meta: 'NRI Quota Counseling', date: new Date('2026-09-29') },
            { title: 'Application submitted', meta: 'All docs uploaded', date: new Date('2026-09-21') },
          ],
          notes: [],
        },
        {
          institutionOrgId,
          applicantId: 'ADM-2026-005',
          name: 'Pooja Hegde',
          email: 'pooja.hegde@gmail.com',
          phone: '+91 88412 99012',
          city: 'Pune, India',
          program: 'MBA & Executive Tech Management',
          stage: 'submitted',
          score: 'CAT 94.8%ile',
          gpa: '90.4% (B.Com Honors)',
          category: 'Corporate Sponsored',
          source: 'Walk-in',
          counselor: 'Priya Nair',
          meritRank: 5,
          meritIndex: 93.6,
          enrollmentNo: 'LGI-2027-MB-001',
          feeStatus: 'Token Paid (₹50k)',
          scholarshipTier: 'Corporate Nominee',
          hostelOpted: false,
          callLetterSent: false,
          documents: defaultDocs,
          bgChecks: { overall: 'verified', checks: defaultChecks },
          assessments: defaultAssessments,
          timeline: [
            { title: 'Application form submitted', meta: 'Fee: ₹1,500 verified', date: new Date('2026-10-06') },
          ],
          notes: [],
        },
        {
          institutionOrgId,
          applicantId: 'ADM-2026-006',
          name: 'Sneha Mukherjee',
          email: 'sneha.m@outlook.com',
          phone: '+91 97120 44521',
          city: 'Kolkata, India',
          program: 'B.Tech Electronics & VLSI Systems',
          stage: 'inquiry',
          score: 'State CET Rank 1,420',
          gpa: '91.8% (WB Board)',
          category: 'Merit Scholar',
          source: 'Social Media',
          counselor: 'Rahul Verma',
          meritRank: 6,
          meritIndex: 92.1,
          enrollmentNo: 'LGI-2027-VL-001',
          feeStatus: 'Pending',
          scholarshipTier: 'General Admission',
          hostelOpted: false,
          callLetterSent: false,
          documents: defaultDocs.map((d, i) => (i > 1 ? { ...d, status: 'pending' as VerificationStatus } : d)),
          bgChecks: { overall: 'in_progress', checks: defaultChecks },
          assessments: defaultAssessments,
          timeline: [
            { title: 'Inquiry registered', meta: 'Course brochure downloaded', date: new Date('2026-10-09') },
          ],
          notes: [],
        },
        {
          institutionOrgId,
          applicantId: 'ADM-2026-007',
          name: 'Aakash Deep',
          email: 'aakash.deep@yahoo.com',
          phone: '+91 91234 88765',
          city: 'Patna, India',
          program: 'B.Tech Computer Science & AI (2027 Batch)',
          stage: 'submitted',
          score: '92.0% in 12th PCM',
          gpa: '92.0%',
          category: 'General Merit',
          source: 'Referral',
          counselor: 'Ananya Bose',
          feeStatus: 'Pending',
          scholarshipTier: 'None',
          hostelOpted: false,
          callLetterSent: false,
          documents: defaultDocs,
          bgChecks: { overall: 'pending', checks: defaultChecks.map(c => ({ ...c, status: 'pending' as VerificationStatus })) },
          assessments: defaultAssessments,
          timeline: [
            { title: 'Application submitted', meta: 'Awaiting marksheet normalization', date: new Date('2026-10-05') },
          ],
          notes: [],
        },
        {
          institutionOrgId,
          applicantId: 'ADM-2026-008',
          name: 'Karan Johar',
          email: 'karan.j@hotmail.com',
          phone: '+91 98860 33412',
          city: 'Hyderabad, India',
          program: 'MBA & Executive Tech Management',
          stage: 'counseling',
          score: 'GMAT 710 Score',
          gpa: '85.2%',
          category: 'Executive Quota',
          source: 'Website',
          counselor: 'Priya Nair',
          feeStatus: 'Pending',
          scholarshipTier: 'Executive Merit',
          hostelOpted: false,
          callLetterSent: true,
          documents: defaultDocs,
          bgChecks: { overall: 'verified', checks: defaultChecks },
          assessments: defaultAssessments,
          timeline: [
            { title: 'Executive counseling slot allocated', meta: 'Interview with Dean of Management', date: new Date('2026-09-20') },
          ],
          notes: [],
        },
      ]);
    }
  }

  // ─── Admission Tracks ────────────────────────────────────────────────────────

  async listTracks(institutionOrgId: Types.ObjectId): Promise<IInstitutionAdmissionTrackDocument[]> {
    await this.ensureSeedData(institutionOrgId);
    return InstitutionAdmissionTrackModel.find({ institutionOrgId }).sort({ createdAt: -1 });
  }

  async createTrack(
    institutionOrgId: Types.ObjectId,
    input: CreateAdmissionTrackInput
  ): Promise<IInstitutionAdmissionTrackDocument> {
    const existing = await InstitutionAdmissionTrackModel.findOne({
      institutionOrgId,
      program: input.program.trim(),
    });
    if (existing) {
      throw AppError.conflict('An admission track with this program name already exists.');
    }

    return InstitutionAdmissionTrackModel.create({
      institutionOrgId,
      program: input.program.trim(),
      school: input.school.trim(),
      seats: Number(input.seats) || 60,
      appliedCount: 0,
      startDate: input.startDate || 'Oct 2026',
      deadline: input.deadline || 'Dec 31, 2026',
      eligibility: input.eligibility?.trim() || '10+2 or Equivalent with relevant domain subjects',
      applicationFee: input.applicationFee || '₹1,200',
      status: input.status || 'Open',
    });
  }

  // ─── Admission Applications ──────────────────────────────────────────────────

  async listApplications(
    institutionOrgId: Types.ObjectId,
    filters?: { program?: string; stage?: string; search?: string }
  ): Promise<IInstitutionAdmissionApplicationDocument[]> {
    await this.ensureSeedData(institutionOrgId);

    const query: Record<string, unknown> = { institutionOrgId };
    if (filters?.program && filters.program !== 'All') {
      query.program = new RegExp(filters.program, 'i');
    }
    if (filters?.stage && filters.stage !== 'All') {
      query.stage = filters.stage;
    }
    if (filters?.search) {
      const q = filters.search.trim();
      query.$or = [
        { name: new RegExp(q, 'i') },
        { applicantId: new RegExp(q, 'i') },
        { email: new RegExp(q, 'i') },
        { program: new RegExp(q, 'i') },
      ];
    }

    return InstitutionAdmissionApplicationModel.find(query).sort({ createdAt: -1 });
  }

  async createApplication(
    institutionOrgId: Types.ObjectId,
    input: CreateAdmissionApplicationInput
  ): Promise<IInstitutionAdmissionApplicationDocument> {
    const email = input.email.trim().toLowerCase();
    const existing = await InstitutionAdmissionApplicationModel.findOne({
      institutionOrgId,
      email,
      program: input.program.trim(),
    });
    if (existing) {
      throw AppError.conflict('An application for this student in this program already exists.');
    }

    const count = await InstitutionAdmissionApplicationModel.countDocuments({ institutionOrgId });
    const applicantId = `ADM-2026-${String(count + 1).padStart(3, '0')}`;

    const defaultDocs = [
      { name: 'Government Photo ID', type: 'PDF', size: '1.2 MB', status: 'pending' as VerificationStatus, updatedAt: new Date() },
      { name: 'Class XII / Degree Transcript', type: 'PDF', size: '860 KB', status: 'pending' as VerificationStatus, updatedAt: new Date() },
      { name: 'Entrance Exam Scorecard', type: 'PDF', size: '340 KB', status: 'pending' as VerificationStatus, updatedAt: new Date() },
      { name: 'Statement of Purpose', type: 'DOCX', size: '45 KB', status: 'pending' as VerificationStatus, updatedAt: new Date() },
    ];

    const defaultChecks = [
      { id: 'identity', label: 'Identity & KYC', desc: 'Government Aadhaar/Passport match', vendor: 'VerifyNow', status: 'pending' as VerificationStatus, updatedAt: new Date() },
      { id: 'academic', label: 'Academic Credentials', desc: '10+2 Board Marks and Transcript Authenticity', vendor: 'CredCheck', status: 'pending' as VerificationStatus, updatedAt: new Date() },
      { id: 'prior', label: 'Prior School/College Record', desc: 'Conduct certificate and migration status', vendor: 'EduTrace', status: 'pending' as VerificationStatus, updatedAt: new Date() },
      { id: 'reference', label: 'Reference Check', desc: 'Dean / School Principal reference call', vendor: 'RefVerify', status: 'pending' as VerificationStatus, updatedAt: new Date() },
    ];

    const defaultAssessments = [
      { name: 'Aptitude & Logical Reasoning', weight: 30, score: null, max: 100, status: 'pending' as const },
      { name: 'Subject Proficiency Test', weight: 30, score: null, max: 100, status: 'pending' as const },
      { name: 'English Language Test', weight: 15, score: null, max: 100, status: 'pending' as const },
      { name: 'Panel Interview', weight: 25, score: null, max: 100, status: 'pending' as const },
    ];

    const app = await InstitutionAdmissionApplicationModel.create({
      institutionOrgId,
      applicantId,
      name: input.name.trim(),
      email,
      phone: input.phone?.trim() || '',
      city: input.city?.trim() || 'India',
      program: input.program.trim(),
      stage: input.stage || 'inquiry',
      score: input.score?.trim() || '',
      gpa: input.gpa?.trim() || '',
      category: input.category?.trim() || 'General Merit',
      source: input.source?.trim() || 'Website',
      counselor: input.counselor?.trim() || 'Priya Nair',
      appliedDate: new Date().toISOString().slice(0, 10),
      hostelOpted: Boolean(input.hostelOpted),
      documents: defaultDocs,
      bgChecks: { overall: 'pending', checks: defaultChecks },
      assessments: defaultAssessments,
      timeline: [
        { title: 'Application record created', meta: `Initial stage: ${input.stage || 'inquiry'}`, date: new Date() },
      ],
      notes: [],
    });

    // Increment track appliedCount
    await InstitutionAdmissionTrackModel.updateOne(
      { institutionOrgId, program: input.program.trim() },
      { $inc: { appliedCount: 1 } }
    );

    return app;
  }

  async updateStage(
    institutionOrgId: Types.ObjectId,
    applicationId: string,
    newStage: AdmissionStage,
    note?: string
  ): Promise<IInstitutionAdmissionApplicationDocument> {
    const app = await InstitutionAdmissionApplicationModel.findOne({
      institutionOrgId,
      _id: applicationId,
    });
    if (!app) {
      throw AppError.notFound('Admission application not found.');
    }

    const previousStage = app.stage;
    app.stage = newStage;

    const stageNames: Record<AdmissionStage, string> = {
      inquiry: 'Inquiry / Lead',
      submitted: 'Form Submitted',
      shortlisted: 'Merit Shortlist',
      counseling: 'Counseling Slot',
      enrolled: 'Seat Confirmed',
      rejected: 'Application Rejected',
    };

    app.timeline.unshift({
      title: `Moved to ${stageNames[newStage]}`,
      meta: note ? `Reason: ${note}` : `Transitioned from ${stageNames[previousStage]}`,
      date: new Date(),
    });

    if (note) {
      app.notes.unshift({
        text: `Stage transition note: ${note}`,
        author: 'Admissions Officer',
        createdAt: new Date(),
      });
    }

    // Auto-generate enrollment number if moving to enrolled and doesn't have one
    if (newStage === 'enrolled' && !app.enrollmentNo) {
      const code = app.program.includes('CS') ? 'CS' : app.program.includes('VLSI') ? 'VL' : 'MB';
      const num = Math.floor(100 + Math.random() * 900);
      app.enrollmentNo = `LGI-2027-${code}-${num}`;
      if (app.feeStatus === 'Pending') {
        app.feeStatus = 'Token Paid (₹50k)';
      }
    }

    await app.save();
    return app;
  }

  async updateApplication(
    institutionOrgId: Types.ObjectId,
    applicationId: string,
    updates: UpdateAdmissionApplicationInput
  ): Promise<IInstitutionAdmissionApplicationDocument> {
    const app = await InstitutionAdmissionApplicationModel.findOne({
      institutionOrgId,
      _id: applicationId,
    });
    if (!app) {
      throw AppError.notFound('Admission application not found.');
    }

    Object.assign(app, updates);
    await app.save();
    return app;
  }

  async bulkIssueCallLetters(
    institutionOrgId: Types.ObjectId,
    applicantIds: string[]
  ): Promise<{ updatedCount: number }> {
    const result = await InstitutionAdmissionApplicationModel.updateMany(
      {
        institutionOrgId,
        _id: { $in: applicantIds },
      },
      {
        $set: {
          callLetterSent: true,
          stage: 'counseling',
        },
        $push: {
          timeline: {
            title: 'Counseling Call Letter Issued',
            meta: 'Automated 1:1 admission counseling slot invitation dispatched',
            date: new Date(),
          },
        },
      }
    );

    return { updatedCount: result.modifiedCount };
  }

  async addNote(
    institutionOrgId: Types.ObjectId,
    applicationId: string,
    noteText: string,
    author = 'Admissions Officer'
  ): Promise<IInstitutionAdmissionApplicationDocument> {
    const app = await InstitutionAdmissionApplicationModel.findOne({
      institutionOrgId,
      _id: applicationId,
    });
    if (!app) {
      throw AppError.notFound('Admission application not found.');
    }

    app.notes.unshift({
      text: noteText.trim(),
      author,
      createdAt: new Date(),
    });
    app.timeline.unshift({
      title: 'Note recorded',
      meta: noteText.trim(),
      date: new Date(),
    });

    await app.save();
    return app;
  }
}
