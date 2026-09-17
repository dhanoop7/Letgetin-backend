import { Types } from 'mongoose';
import { ApplicationModel, IApplicationDocument } from '../../application/application.model.js';
import { JobModel } from '../../job/job.model.js';
import { CandidateProfileModel } from '../../job/candidateProfile.model.js';
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
   * Calculates or retrieves composite rank score using the existing matching engine:
   * 70% vector similarity + 30% direct skills overlap.
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
      const candidateProfile = await CandidateProfileModel.findOne({ userId: application.userId }).lean();
      const candidateSkills = candidateProfile?.skills || [];

      // 1. Direct skills match (30% weight)
      const skillAnalysis = embeddingService.calculateSkillsMatch(jobSkills, candidateSkills);

      // 2. Vector similarity (70% weight) if embeddings exist
      let score = 50; // Neutral baseline
      if (candidateProfile?.embedding && jobEmbedding && jobEmbedding.length > 0) {
        const vectorSim = embeddingService.cosineSimilarity(candidateProfile.embedding, jobEmbedding);
        score = Math.round(Math.round(vectorSim * 100) * 0.7 + skillAnalysis.score * 0.3);
      } else if (candidateSkills.length > 0) {
        score = Math.min(
          98,
          Math.max(50, 45 + Math.round((skillAnalysis.matched.length / Math.max(1, jobSkills.length || 1)) * 50))
        );
      } else {
        score = skillAnalysis.score > 0 ? skillAnalysis.score : 50;
      }

      return Math.max(1, Math.min(100, score));
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

    // Retrieve all active applications for this job that are not rejected or failed
    const applications = await ApplicationModel.find({
      jobId,
      status: { $nin: ['rejected', 'failed'] },
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
