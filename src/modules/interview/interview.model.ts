import { Schema, model, Document, Types } from 'mongoose';

export type InterviewStage =
  | 'to_schedule'
  | 'upcoming'
  | 'today'
  | 'feedback_pending'
  | 'completed'
  | 'cancelled';

export type InterviewType = 'live_video' | 'ai_interview' | 'onsite';

export interface IInterviewer {
  name: string;
  role: string;
  email?: string;
  avatar?: string;
}

export interface IAiQuestion {
  id: string;
  question: string;
  category: string;
  expectedAnswer?: string;
  difficulty?: 'junior' | 'mid' | 'senior' | 'lead';
  criteria?: string[];
  greenFlags?: string[];
  redFlags?: string[];
}

export interface IAiScorecard {
  overallScore: number; // 1-100 or 1-5
  technicalScore: number;
  communicationScore: number;
  problemSolvingScore: number;
  confidenceScore: number;
  summary: string;
  strengths: string[];
  improvements: string[];
  recommendation: 'Strong Hire' | 'Hire' | 'Hold' | 'Reject';
  evaluationDate?: string;
}

export interface IInterviewDocument extends Document {
  userId: Types.ObjectId;
  orgId?: Types.ObjectId;
  candidateName: string;
  candidateEmail: string;
  candidateAvatar?: string;
  candidateId?: Types.ObjectId;
  position: string;
  department: string;
  jobId?: Types.ObjectId;
  roundName: string;
  stage: InterviewStage;
  type: InterviewType;
  date: string; // YYYY-MM-DD
  time: string; // e.g. "10:30 AM"
  durationMinutes: number;
  platform: 'LetGetIn Room' | 'Google Meet' | 'Zoom' | 'Microsoft Teams' | 'On-Site';
  meetingLink: string;
  roomCode?: string;
  interviewers: IInterviewer[];
  aiQuestions: IAiQuestion[];
  score?: number; // 1-5
  feedbackNotes?: string;
  aiScorecard?: IAiScorecard;
  linkedTaskId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const InterviewSchema = new Schema<IInterviewDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'RecruiterOrg', index: true },
    candidateName: { type: String, required: true, trim: true },
    candidateEmail: { type: String, required: true, trim: true, lowercase: true },
    candidateAvatar: { type: String },
    candidateId: { type: Schema.Types.ObjectId, ref: 'User' },
    position: { type: String, required: true, trim: true },
    department: { type: String, default: 'Engineering', trim: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job' },
    roundName: { type: String, default: 'Technical Round 1', trim: true },
    stage: {
      type: String,
      enum: ['to_schedule', 'upcoming', 'today', 'feedback_pending', 'completed', 'cancelled'],
      default: 'upcoming',
      index: true,
    },
    type: {
      type: String,
      enum: ['live_video', 'ai_interview', 'onsite'],
      default: 'live_video',
    },
    date: { type: String, required: true, index: true },
    time: { type: String, required: true },
    durationMinutes: { type: Number, default: 45 },
    platform: {
      type: String,
      enum: ['LetGetIn Room', 'Google Meet', 'Zoom', 'Microsoft Teams', 'On-Site'],
      default: 'LetGetIn Room',
    },
    meetingLink: { type: String, default: '' },
    roomCode: { type: String, default: '' },
    interviewers: [
      {
        name: { type: String, required: true },
        role: { type: String, default: 'Interviewer' },
        email: { type: String },
        avatar: { type: String },
      },
    ],
    aiQuestions: [
      {
        id: { type: String, required: true },
        question: { type: String, required: true },
        category: { type: String, default: 'Technical' },
        expectedAnswer: { type: String },
        difficulty: { type: String, enum: ['junior', 'mid', 'senior', 'lead'] },
        criteria: [{ type: String }],
        greenFlags: [{ type: String }],
        redFlags: [{ type: String }],
      },
    ],
    score: { type: Number, min: 1, max: 5 },
    feedbackNotes: { type: String },
    aiScorecard: {
      overallScore: { type: Number },
      technicalScore: { type: Number },
      communicationScore: { type: Number },
      problemSolvingScore: { type: Number },
      confidenceScore: { type: Number },
      summary: { type: String },
      strengths: [{ type: String }],
      improvements: [{ type: String }],
      recommendation: { type: String, enum: ['Strong Hire', 'Hire', 'Hold', 'Reject'] },
      evaluationDate: { type: String },
    },
    linkedTaskId: { type: Schema.Types.ObjectId, ref: 'Task' },
  },
  {
    timestamps: true,
  }
);

InterviewSchema.index({ userId: 1, date: 1 });
InterviewSchema.index({ userId: 1, stage: 1 });

export const Interview = model<IInterviewDocument>('Interview', InterviewSchema);
