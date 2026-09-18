import { EventEmitter } from 'events';
import { createChildLogger } from '../../../infrastructure/logging/logger.js';

const hiringLogger = createChildLogger({ component: 'HiringEngine' });

export interface CandidateInvitedNotification {
  candidateId: string;
  email?: string;
  fullName?: string;
  jobId: string;
  jobTitle: string;
  stageId: string;
  stageName: string;
  deadlineHours: number;
  stageDeadline?: Date;
}

export interface CandidatePassedNotification {
  candidateId: string;
  jobId: string;
  jobTitle: string;
  stageId: string;
  stageName: string;
  nextStageId?: string;
  nextStageName?: string;
  score?: number;
}

export interface CandidateFailedNotification {
  candidateId: string;
  jobId: string;
  jobTitle: string;
  stageId: string;
  stageName: string;
  reason?: string;
}

export interface CandidateNoShowNotification {
  candidateId: string;
  jobId: string;
  jobTitle: string;
  stageId: string;
  stageName: string;
  deadline?: Date;
}

export interface CandidateShortlistedNotification {
  candidateId: string;
  jobId: string;
  jobTitle: string;
  totalShortlisted: number;
  targetCount: number;
}

export interface CollectionExtendedNotification {
  recruiterId?: string;
  jobId: string;
  jobTitle: string;
  qualifiedCandidates: number;
  minimumRequired: number;
  newDeadline: Date;
  extensionsUsed: number;
  maxExtensions: number;
}

export interface CollectionInsufficientNotification {
  recruiterId?: string;
  jobId: string;
  jobTitle: string;
  qualifiedCandidates: number;
  minimumRequired: number;
  finalShortlistTarget: number;
  idealIntake: number;
  extensionsUsed: number;
}

export interface CollectionReadyNotification {
  recruiterId?: string;
  jobId: string;
  jobTitle: string;
  qualifiedCandidates: number;
  minimumRequired: number;
  idealIntake: number;
}

class HiringNotificationHookEmitter extends EventEmitter {
  constructor() {
    super();
    // Default logging listener for traceability
    this.on('candidateInvited', (data: CandidateInvitedNotification) => {
      hiringLogger.info(
        {
          event: 'candidate_invited',
          candidateId: data.candidateId,
          jobId: data.jobId,
          stageId: data.stageId,
          stageName: data.stageName,
          deadline: data.stageDeadline,
        },
        `Candidate "${data.fullName || data.candidateId}" invited to stage "${data.stageName}" for role "${data.jobTitle}"`
      );
      console.log(
        `📨 [HiringNotificationHook] Candidate "${data.fullName || data.candidateId}" invited to stage "${data.stageName}" for role "${data.jobTitle}" (Deadline: ${data.stageDeadline?.toISOString() || `${data.deadlineHours}h`})`
      );
    });

    this.on('candidatePassed', (data: CandidatePassedNotification) => {
      hiringLogger.info(
        {
          event: 'candidate_passed',
          candidateId: data.candidateId,
          jobId: data.jobId,
          stageId: data.stageId,
          stageName: data.stageName,
          nextStageId: data.nextStageId,
          score: data.score,
        },
        `Candidate "${data.candidateId}" passed stage "${data.stageName}" for role "${data.jobTitle}"`
      );
      console.log(
        `🎉 [HiringNotificationHook] Candidate "${data.candidateId}" passed stage "${data.stageName}" for role "${data.jobTitle}"`
      );
    });

    this.on('candidateFailed', (data: CandidateFailedNotification) => {
      hiringLogger.warn(
        {
          event: 'candidate_failed',
          candidateId: data.candidateId,
          jobId: data.jobId,
          stageId: data.stageId,
          stageName: data.stageName,
          reason: data.reason,
        },
        `Candidate "${data.candidateId}" failed stage "${data.stageName}" for role "${data.jobTitle}"`
      );
      console.log(
        `❌ [HiringNotificationHook] Candidate "${data.candidateId}" failed stage "${data.stageName}" for role "${data.jobTitle}": ${data.reason || 'Criteria not met'}`
      );
    });

    this.on('candidateNoShow', (data: CandidateNoShowNotification) => {
      hiringLogger.warn(
        {
          event: 'candidate_no_show',
          candidateId: data.candidateId,
          jobId: data.jobId,
          stageId: data.stageId,
          stageName: data.stageName,
        },
        `Candidate "${data.candidateId}" marked NO-SHOW in stage "${data.stageName}" for role "${data.jobTitle}"`
      );
      console.log(
        `⚠️ [HiringNotificationHook] Candidate "${data.candidateId}" marked NO-SHOW in stage "${data.stageName}" for role "${data.jobTitle}"`
      );
    });

    this.on('candidateShortlisted', (data: CandidateShortlistedNotification) => {
      hiringLogger.info(
        {
          event: 'candidate_shortlisted',
          candidateId: data.candidateId,
          jobId: data.jobId,
          totalShortlisted: data.totalShortlisted,
          targetCount: data.targetCount,
        },
        `Candidate "${data.candidateId}" reached FINAL SHORTLIST for role "${data.jobTitle}" (${data.totalShortlisted}/${data.targetCount})`
      );
      console.log(
        `🏆 [HiringNotificationHook] Candidate "${data.candidateId}" reached FINAL SHORTLIST for role "${data.jobTitle}" (${data.totalShortlisted}/${data.targetCount})`
      );
    });

    this.on('collectionExtended', (data: CollectionExtendedNotification) => {
      hiringLogger.info(
        {
          event: 'collection_extended',
          jobId: data.jobId,
          qualified: data.qualifiedCandidates,
          minimumRequired: data.minimumRequired,
          extensionsUsed: data.extensionsUsed,
          maxExtensions: data.maxExtensions,
        },
        `Candidate collection extended for role "${data.jobTitle}"`
      );
      console.log(
        `⏳ [HiringNotificationHook] Candidate collection extended for role "${data.jobTitle}": Qualified=${data.qualifiedCandidates}/${data.minimumRequired}, NewDeadline=${data.newDeadline.toISOString()}, Extensions=${data.extensionsUsed}/${data.maxExtensions}`
      );
    });

    this.on('collectionInsufficient', (data: CollectionInsufficientNotification) => {
      hiringLogger.warn(
        {
          event: 'collection_insufficient',
          jobId: data.jobId,
          qualified: data.qualifiedCandidates,
          minimumRequired: data.minimumRequired,
          finalShortlistTarget: data.finalShortlistTarget,
        },
        `Insufficient qualified candidates for role "${data.jobTitle}"`
      );
      console.log(
        `⚠️ [HiringNotificationHook] Insufficient qualified candidates for role "${data.jobTitle}": Qualified=${data.qualifiedCandidates}/${data.minimumRequired} (Final Target: ${data.finalShortlistTarget})`
      );
    });

    this.on('collectionReady', (data: CollectionReadyNotification) => {
      hiringLogger.info(
        {
          event: 'collection_ready',
          jobId: data.jobId,
          qualified: data.qualifiedCandidates,
          minimumRequired: data.minimumRequired,
          idealIntake: data.idealIntake,
        },
        `Candidate collection ready for role "${data.jobTitle}"`
      );
      console.log(
        `🚀 [HiringNotificationHook] Candidate collection ready for role "${data.jobTitle}": Qualified=${data.qualifiedCandidates}/${data.minimumRequired} (Ideal: ${data.idealIntake})`
      );
    });
  }

  public notifyCandidateInvited(data: CandidateInvitedNotification): void {
    this.emit('candidateInvited', data);
  }

  public notifyCandidatePassed(data: CandidatePassedNotification): void {
    this.emit('candidatePassed', data);
  }

  public notifyCandidateFailed(data: CandidateFailedNotification): void {
    this.emit('candidateFailed', data);
  }

  public notifyCandidateNoShow(data: CandidateNoShowNotification): void {
    this.emit('candidateNoShow', data);
  }

  public notifyCandidateShortlisted(data: CandidateShortlistedNotification): void {
    this.emit('candidateShortlisted', data);
  }

  public notifyCollectionExtended(data: CollectionExtendedNotification): void {
    this.emit('collectionExtended', data);
  }

  public notifyCollectionInsufficient(data: CollectionInsufficientNotification): void {
    this.emit('collectionInsufficient', data);
  }

  public notifyCollectionReady(data: CollectionReadyNotification): void {
    this.emit('collectionReady', data);
  }
}

export const HiringNotificationHook = new HiringNotificationHookEmitter();
