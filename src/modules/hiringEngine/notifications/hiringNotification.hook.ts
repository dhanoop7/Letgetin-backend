import { EventEmitter } from 'events';

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

class HiringNotificationHookEmitter extends EventEmitter {
  constructor() {
    super();
    // Default logging listener for traceability
    this.on('candidateInvited', (data: CandidateInvitedNotification) => {
      console.log(
        `📨 [HiringNotificationHook] Candidate "${data.fullName || data.candidateId}" invited to stage "${data.stageName}" for role "${data.jobTitle}" (Deadline: ${data.stageDeadline?.toISOString() || `${data.deadlineHours}h`})`
      );
    });

    this.on('candidatePassed', (data: CandidatePassedNotification) => {
      console.log(
        `🎉 [HiringNotificationHook] Candidate "${data.candidateId}" passed stage "${data.stageName}" for role "${data.jobTitle}"`
      );
    });

    this.on('candidateFailed', (data: CandidateFailedNotification) => {
      console.log(
        `❌ [HiringNotificationHook] Candidate "${data.candidateId}" failed stage "${data.stageName}" for role "${data.jobTitle}": ${data.reason || 'Criteria not met'}`
      );
    });

    this.on('candidateNoShow', (data: CandidateNoShowNotification) => {
      console.log(
        `⚠️ [HiringNotificationHook] Candidate "${data.candidateId}" marked NO-SHOW in stage "${data.stageName}" for role "${data.jobTitle}"`
      );
    });

    this.on('candidateShortlisted', (data: CandidateShortlistedNotification) => {
      console.log(
        `🏆 [HiringNotificationHook] Candidate "${data.candidateId}" reached FINAL SHORTLIST for role "${data.jobTitle}" (${data.totalShortlisted}/${data.targetCount})`
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
}

export const HiringNotificationHook = new HiringNotificationHookEmitter();
