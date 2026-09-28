import { Types } from 'mongoose';
import { IResumeEvaluation, ResumeDecision, ResumeScreeningStatus } from '../application/application.model.js';

export interface ResumeScreeningFilters {
  decision?: ResumeDecision | 'all';
  screeningStatus?: ResumeScreeningStatus | 'all';
  search?: string;
  minScore?: number;
  page?: number;
  limit?: number;
  sortBy?: 'score' | 'appliedAt' | 'name';
  sortOrder?: 'asc' | 'desc';
}

export interface CandidateUserSummary {
  _id: string;
  fullName?: string;
  username?: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
}

export interface CandidateResumeSummary {
  _id: string;
  title: string;
  atsScore?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResumeScreeningCandidateItem {
  applicationId: string;
  jobId: string;
  jobTitle?: string;
  candidate: CandidateUserSummary;
  resume: CandidateResumeSummary | null;
  appliedAt: Date;
  source: string;
  // Screening details
  screeningStatus: ResumeScreeningStatus;
  decision: ResumeDecision;
  decidedAt?: Date;
  decisionNotes?: string;
  // Scorecard & evaluation
  evaluation?: IResumeEvaluation;
  matchScore: number;
}

export interface ResumeScreeningStats {
  totalApplications: number;
  pendingReview: number;
  aiReviewed: number;
  shortlisted: number; // Qualified candidates
  needsReview: number;
  rejected: number;
  minimumIntakeRequired: number;
  idealIntakeTarget: number;
  isReadyForFunnel: boolean;
  actualQualifiedCount: number;
  collectionStatus: string;
  isFunnelStarted: boolean;
}

export interface RecordDecisionInput {
  decision: ResumeDecision;
  notes?: string;
}

export interface BulkDecisionInput {
  applicationIds: string[];
  decision: ResumeDecision;
  notes?: string;
}
