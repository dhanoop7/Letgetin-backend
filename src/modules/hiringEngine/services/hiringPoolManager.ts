import { Types } from 'mongoose';
import { ApplicationModel, IApplicationDocument } from '../../application/application.model.js';
import { JobModel } from '../../job/job.model.js';
import { CandidateProfileModel } from '../../job/candidateProfile.model.js';
import { UserModel } from '../../user/user.model.js';
import { UserProfileModel } from '../../profile/profile.model.js';
import { ResumeModel } from '../../resume/resume.model.js';
import { CandidateDataResolver } from '../../profile/candidateDataResolver.js';
import { candidateJobMatchingService } from '../../matching/candidateJobMatching.service.js';
import { embeddingService } from '../../embedding/embedding.service.js';
import { CandidateStageHistoryModel } from '../candidateStageHistory.model.js';
import { HiringFunnelConfigModel } from '../hiringFunnelConfig.model.js';
import { scheduleCandidateDeadlineCheck } from '../queues/hiringEngine.queue.js';
import { HiringNotificationHook } from '../notifications/hiringNotification.hook.js';

export interface PoolPartitionResult {
  primaryCandidates: IApplicationDocument[];
  reserveCandidates: IApplicationDocument[];
  totalRanked: number;
  initialDeficit: number; // > 0 if applicants < required intake
}

export class HiringPoolManager {
  /**
   * Calculates or retrieves composite rank score using the canonical matching engine.
   */
  public static async computeOrGetCompositeScore(
    application: IApplicationDocument,
    jobSkills: string[],
    jobEmbedding?: number[]
  ): Promise<number> {
    // If application already has a valid matchScore > 0, reuse it
    if (typeof application.matchScore === 'number' && application.matchScore > 0) {
      return application.matchScore;
    }

    try {
      if (application.jobId) {
        const canonicalResult = await candidateJobMatchingService.matchCandidateIdToJobId(
          String(application.userId),
          String(application.jobId)
        );
        if (canonicalResult) {
          return canonicalResult.overallScore;
        }
      }

      // Fallback: If jobId is not provided or job not found by ID, resolve candidate and evaluate against synthetic job
      const [candidateProfile, user, userProfile, resume] = await Promise.all([
        CandidateProfileModel.findOne({ userId: application.userId }).lean(),
        UserModel.findById(application.userId).select('fullName email').lean(),
        UserProfileModel.findOne({ userId: application.userId }).lean(),
        (application as any).resumeId
          ? ResumeModel.findById((application as any).resumeId).lean()
          : ResumeModel.findOne({ userId: application.userId }).sort({ updatedAt: -1 }).lean(),
      ]);

      const resolved = CandidateDataResolver.resolve({
        userId: String(application.userId),
        user,
        userProfile,
        resume,
        candidateProfile,
      });

      const syntheticJob = {
        skills: jobSkills,
        embedding: jobEmbedding,
      };

      const matchResult = candidateJobMatchingService.matchCandidateToJob(
        resolved,
        syntheticJob,
        {
          candidateEmbedding: candidateProfile?.embedding,
          jobEmbedding,
        }
      );

      return matchResult.overallScore;
    } catch {
      return application.matchScore || 50;
    }
  }

  /**
   * Partitions all active applicants for a job into:
   * 1. Primary Pool (top requiredIntake candidates)
   * 2. Reserve Pool (remaining qualified candidates ranked descending)
   */
  public static async partitionInitialPool(
    jobId: string | Types.ObjectId,
    firstStageId: string,
    requiredIntake: number,
    deadlineHours: number
  ): Promise<PoolPartitionResult> {
    const job = await JobModel.findById(jobId).lean();
    if (!job) {
      throw new Error(`Job not found for ID: ${jobId}`);
    }

    // Retrieve all active qualified applications for this job that have passed resume shortlisting
    const applications = await ApplicationModel.find({
      jobId,
      status: { $nin: ['rejected', 'failed'] },
      poolType: { $ne: 'disqualified' },
      resumeDecision: { $nin: ['rejected', 'needs_review'] },
      $or: [
        { resumeDecision: 'shortlisted' },
        { resumeDecision: 'pending', poolType: { $in: ['primary', 'reserve'] } },
        { resumeDecision: 'pending', matchScore: { $gte: 35 } },
        { resumeDecision: 'pending', compositeRank: { $gte: 35 } },
        { resumeDecision: { $exists: false } },
      ],
    });

    if (applications.length === 0) {
      return {
        primaryCandidates: [],
        reserveCandidates: [],
        totalRanked: 0,
        initialDeficit: requiredIntake,
      };
    }

    // Compute / confirm composite rank for each application using existing matching logic
    const rankedApplications: { app: IApplicationDocument; score: number }[] = [];
    for (const app of applications) {
      const score = await this.computeOrGetCompositeScore(app, job.skills || [], job.embedding);
      rankedApplications.push({ app, score });
    }

    // Sort descending by composite score, then by earliest application date
    rankedApplications.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(a.app.appliedAt).getTime() - new Date(b.app.appliedAt).getTime();
    });

    const primaryCandidates: IApplicationDocument[] = [];
    const reserveCandidates: IApplicationDocument[] = [];
    const now = new Date();
    const deadline = new Date(now.getTime() + deadlineHours * 3600 * 1000);

    for (let i = 0; i < rankedApplications.length; i++) {
      const { app, score } = rankedApplications[i];
      const isPrimary = i < requiredIntake;

      app.compositeRank = score;
      app.currentStageIndex = 1;
      app.currentStageId = firstStageId;

      if (isPrimary) {
        app.poolType = 'primary';
        app.stageStatus = 'invited';
        app.invitedAt = now;
        app.stageDeadline = deadline;
        primaryCandidates.push(app);
      } else {
        app.poolType = 'reserve';
        app.stageStatus = undefined;
        app.invitedAt = undefined;
        app.stageDeadline = undefined;
        reserveCandidates.push(app);
      }

      await app.save();

      // Enqueue deadline check and notification for initial primary candidates
      if (isPrimary) {
        await scheduleCandidateDeadlineCheck(String(jobId), String(app._id), firstStageId, deadlineHours);
        HiringNotificationHook.notifyCandidateInvited({
          candidateId: String(app.userId),
          jobId: String(jobId),
          jobTitle: job.title || 'Role',
          stageId: firstStageId,
          stageName: 'Initial Screening',
          deadlineHours,
          stageDeadline: deadline,
        });
      }
    }

    await JobModel.findByIdAndUpdate(jobId, {
      hiringEngineEnabled: true,
      'applicationCollection.status': 'started',
    });
    await HiringFunnelConfigModel.findOneAndUpdate(
      { jobId, status: { $nin: ['paused', 'completed'] } },
      { status: 'active' }
    );

    const initialDeficit = Math.max(0, requiredIntake - primaryCandidates.length);

    return {
      primaryCandidates,
      reserveCandidates,
      totalRanked: rankedApplications.length,
      initialDeficit,
    };
  }

  /**
   * Atomically promotes up to `count` candidates from the reserve pool into the primary pool.
   * Uses atomic conditional MongoDB updates to guarantee that no candidate is double-promoted,
   * even under concurrent calls.
   */
  public static async promoteReserveCandidates(
    jobId: string | Types.ObjectId,
    stageId: string,
    stageIndex: number,
    stageName: string,
    count: number,
    deadlineHours: number
  ): Promise<IApplicationDocument[]> {
    if (count <= 0) return [];

    // Safety check: verify job exists and is not closed
    const job = await JobModel.findById(jobId).select('title status').lean();
    if (!job || job.status === 'closed') {
      return [];
    }

    const promoted: IApplicationDocument[] = [];
    const now = new Date();
    const deadline = new Date(now.getTime() + deadlineHours * 3600 * 1000);

    // Promote candidates one by one with atomic CAS (Compare-And-Swap) condition: { poolType: 'reserve' }
    for (let i = 0; i < count; i++) {
      const candidateToPromote = await ApplicationModel.findOneAndUpdate(
        {
          jobId,
          poolType: 'reserve',
          status: { $nin: ['rejected', 'failed'] },
        },
        {
          $set: {
            poolType: 'primary',
            currentStageId: stageId,
            currentStageIndex: stageIndex,
            stageStatus: 'invited',
            invitedAt: now,
            stageDeadline: deadline,
          },
        },
        {
          sort: { compositeRank: -1, appliedAt: 1 },
          new: true,
        }
      );

      if (!candidateToPromote) {
        // Reserve pool has been exhausted
        break;
      }

      promoted.push(candidateToPromote);

      // Create an immutable audit trail entry for this promotion
      await CandidateStageHistoryModel.create({
        applicationId: candidateToPromote._id,
        jobId: candidateToPromote.jobId,
        candidateId: candidateToPromote.userId,
        stageId,
        stageName,
        stageIndex,
        status: 'invited',
        score: candidateToPromote.compositeRank,
        promotedFromReserve: true,
        notes: `Promoted from reserve pool into stage '${stageName}' due to stage deficit.`,
        enteredAt: now,
      });

      // Schedule delayed BullMQ candidate deadline check
      await scheduleCandidateDeadlineCheck(
        String(candidateToPromote.jobId),
        String(candidateToPromote._id),
        stageId,
        deadlineHours
      );

      // Notify through pluggable notification hook
      HiringNotificationHook.notifyCandidateInvited({
        candidateId: String(candidateToPromote.userId),
        jobId: String(candidateToPromote.jobId),
        jobTitle: job?.title || 'Job Role',
        stageId,
        stageName,
        deadlineHours,
        stageDeadline: deadline,
      });
    }

    return promoted;
  }
}
