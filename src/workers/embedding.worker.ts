import mongoose from 'mongoose';
import { Worker, Job } from 'bullmq';
import {
  QUEUE_NAMES,
  getRedisConnectionOptions,
  JobEmbeddingPayload,
  CandidateEmbeddingPayload,
  enqueueCandidateEmbedding,
} from '../queues/queue.config.js';
import { JobModel } from '../modules/job/job.model.js';
import { CandidateProfileModel } from '../modules/job/candidateProfile.model.js';
import { UserProfileModel } from '../modules/profile/profile.model.js';
import { ResumeModel } from '../modules/resume/resume.model.js';
import { UserModel } from '../modules/user/user.model.js';
import { embeddingService } from '../modules/embedding/embedding.service.js';
import { redisService } from '../services/redis.service.js';

const redisOptions = getRedisConnectionOptions();

/**
 * Worker for processing Job document embeddings
 */
export const createJobEmbeddingWorker = (): Worker<JobEmbeddingPayload> => {
  const worker = new Worker<JobEmbeddingPayload>(
    QUEUE_NAMES.JOB_EMBEDDING,
    async (job: Job<JobEmbeddingPayload>) => {
      const { jobId, forceRecompute } = job.data;
      console.log(`[JobEmbeddingWorker] Processing job embedding for ID: ${jobId}`);

      const jobDoc = await JobModel.findById(jobId);
      if (!jobDoc) {
        console.warn(`[JobEmbeddingWorker] Job ${jobId} not found in database.`);
        return { success: false, reason: 'Job not found' };
      }

      if (!forceRecompute && jobDoc.embedding && jobDoc.embedding.length > 0 && jobDoc.embeddingStatus === 'completed') {
        console.log(`[JobEmbeddingWorker] Job ${jobId} already has valid embedding. Skipping.`);
        return { success: true, skipped: true };
      }

      // Mark status as processing
      jobDoc.embeddingStatus = 'processing';
      await jobDoc.save();

      try {
        const normalizedText = embeddingService.buildJobEmbeddingText(jobDoc);
        const result = await embeddingService.generateEmbedding(normalizedText);

        jobDoc.embedding = result.embedding;
        jobDoc.embeddingModel = result.model;
        jobDoc.embeddingVersion = result.version;
        jobDoc.embeddingStatus = 'completed';
        await jobDoc.save();

        console.log(
          `✅ [JobEmbeddingWorker] Completed embedding for Job: "${jobDoc.title}" (${result.dimensions} dims, ${result.executionTimeMs}ms)`
        );

        return {
          success: true,
          jobId,
          dimensions: result.dimensions,
          timeMs: result.executionTimeMs,
        };
      } catch (error: any) {
        jobDoc.embeddingStatus = 'failed';
        await jobDoc.save();
        console.error(`❌ [JobEmbeddingWorker] Failed embedding for Job ${jobId}:`, error?.message || error);
        throw error;
      }
    },
    {
      connection: redisOptions,
      concurrency: 5,
    }
  );

  worker.on('completed', (job) => {
    // console.log(`[JobEmbeddingWorker] Job ${job.id} marked completed`);
  });

  worker.on('error', () => {});

  worker.on('failed', (job, err) => {
    console.error(`[JobEmbeddingWorker] Task ${job?.id} failed with error:`, err.message);
  });

  return worker;
};

/**
 * Worker for processing Candidate Profile vector embeddings.
 * Guaranteed:
 *  - Strict single-flight per user (no concurrent workers modifying the same user's profile)
 *  - Atomic MongoDB updates (zero Mongoose VersionErrors)
 *  - Latest Profile Must Win (always processes freshest state from MongoDB)
 *  - Idempotent and safe on retries
 */
export const createCandidateEmbeddingWorker = (): Worker<CandidateEmbeddingPayload> => {
  const worker = new Worker<CandidateEmbeddingPayload>(
    QUEUE_NAMES.CANDIDATE_EMBEDDING,
    async (job: Job<CandidateEmbeddingPayload>) => {
      const { userId, forceRecompute } = job.data;

      if (!mongoose.Types.ObjectId.isValid(userId)) {
        console.warn(`[CandidateEmbeddingWorker] Invalid user ID ${userId}`);
        return { success: false, reason: 'Invalid userId' };
      }

      const userObjectId = new mongoose.Types.ObjectId(userId);
      const lockKey = `lock:candidate-embed:${userId}`;
      const lockToken = `${Date.now()}_${Math.random()}`;

      // 1. Acquire distributed lock for user (with spin-wait) to prevent concurrent execution on the same user
      let acquired = false;
      for (let attempt = 0; attempt < 25; attempt++) {
        acquired = await redisService.setNx(lockKey, 45, lockToken);
        if (acquired) break;
        await new Promise((r) => setTimeout(r, 300));
      }

      if (!acquired) {
        console.warn(`[CandidateEmbeddingWorker] User ${userId} embedding locked by another worker. Deferring.`);
        return { success: true, deferred: true };
      }

      console.log(`[CandidateEmbeddingWorker] Processing candidate embedding for User: ${userId}`);

      try {
        // 2. Fetch the latest state directly from MongoDB (Latest Profile Must Win)
        const [userProfile, latestResume, user, candidateProfile] = await Promise.all([
          UserProfileModel.findOne({ userId: userObjectId }).lean(),
          ResumeModel.findOne({ userId: userObjectId }).sort({ updatedAt: -1 }).lean(),
          UserModel.findById(userObjectId).lean(),
          CandidateProfileModel.findOne({ userId: userObjectId }).lean(),
        ]);

        const currentVersion = userProfile?.version || 1;

        // 3. Build composite candidate profile representation
        let skills: string[] = [];
        let headline = '';
        let summary = '';
        let yearsOfExperience = 0;
        let location = '';
        let education = '';
        let resumeContent: any = {};

        if (latestResume && latestResume.content) {
          resumeContent = { ...(latestResume.content as any) };
          headline = resumeContent.personalInfo?.headline || '';
          summary = resumeContent.summary || '';
          location = resumeContent.personalInfo?.location || '';

          if (Array.isArray(resumeContent.skills)) {
            skills = resumeContent.skills
              .map((s: any) => (typeof s === 'string' ? s : s.name))
              .filter(Boolean);
          }

          if (Array.isArray(resumeContent.experiences)) {
            yearsOfExperience = Math.min(25, Math.max(1, resumeContent.experiences.length * 2));
          }

          if (Array.isArray(resumeContent.educations) && resumeContent.educations.length > 0) {
            const edu = resumeContent.educations[0];
            education = `${edu.degree || ''} ${edu.fieldOfStudy || ''} - ${edu.institution || ''}`.trim();
          }
        } else if (user) {
          headline = user.fullName ? `${user.fullName}'s Profile` : 'Software Professional';
          skills = ['React', 'TypeScript', 'Node.js', 'JavaScript'];
        }

        if (userProfile) {
          if (Array.isArray(userProfile.skills) && userProfile.skills.length > 0) {
            const combinedSkills = Array.from(new Set([...userProfile.skills, ...skills]));
            skills = combinedSkills;
          }
          if (userProfile.personal?.headline) {
            headline = userProfile.personal.headline;
          } else if (userProfile.experience?.title && !headline) {
            headline = userProfile.experience.title;
          }
          if (userProfile.personal?.bio) {
            summary = userProfile.personal.bio;
          }
          if (userProfile.contact?.city || userProfile.contact?.country) {
            const parts = [userProfile.contact.city, userProfile.contact.country].filter(Boolean);
            if (parts.length > 0) {
              location = parts.join(', ');
            }
          }
          if (userProfile.track === 'fresher') {
            yearsOfExperience = 0;
          } else if (userProfile.experiencesList && userProfile.experiencesList.length > 0) {
            yearsOfExperience = Math.min(25, Math.max(1, userProfile.experiencesList.length * 2));
          }
          if (userProfile.educationsList && userProfile.educationsList.length > 0) {
            const topEdu = userProfile.educationsList[0];
            education = `${topEdu.degree || ''} - ${topEdu.institution || ''}`.trim();
          } else if (userProfile.education?.institution) {
            education = `${userProfile.education.degree || ''} - ${userProfile.education.institution || ''}`.trim();
          }

          resumeContent = {
            ...resumeContent,
            personalInfo: {
              ...resumeContent.personalInfo,
              fullName: userProfile.contact?.fullName || user?.fullName,
              headline: headline,
              location: location,
            },
            summary: summary,
            skills: skills,
            experiences:
              userProfile.experiencesList && userProfile.experiencesList.length > 0
                ? userProfile.experiencesList.map((e) => ({
                    company: e.company,
                    position: e.title,
                    startDate: e.start,
                    endDate: e.end,
                    highlights: e.highlights ? [e.highlights] : [],
                  }))
                : resumeContent.experiences,
            educations:
              userProfile.educationsList && userProfile.educationsList.length > 0
                ? userProfile.educationsList.map((e) => ({
                    institution: e.institution,
                    degree: e.degree,
                    startDate: e.startYear,
                    endDate: e.endYear,
                  }))
                : resumeContent.educations,
          };
        }

        const normalizedText = embeddingService.buildCandidateEmbeddingText(resumeContent, user || undefined);

        // 4. Idempotency check:
        // If already completed with identical version, matching rawText, and valid embedding, skip redundant API computation
        if (
          !forceRecompute &&
          candidateProfile &&
          candidateProfile.embedding &&
          candidateProfile.embedding.length > 0 &&
          candidateProfile.embeddingStatus === 'completed' &&
          candidateProfile.rawText === normalizedText &&
          candidateProfile.embeddedVersion === currentVersion
        ) {
          console.log(`[CandidateEmbeddingWorker] User ${userId} already has up-to-date embedding (v${currentVersion}). Skipping.`);
          return { success: true, skipped: true, version: currentVersion };
        }

        // 5. Atomic MongoDB update to mark status as processing (Prevents Mongoose VersionError)
        await CandidateProfileModel.findOneAndUpdate(
          { userId: userObjectId },
          {
            $set: {
              resumeId: latestResume?._id,
              headline,
              summary,
              skills,
              yearsOfExperience,
              location,
              education,
              rawText: normalizedText,
              profileVersion: currentVersion,
              embeddingStatus: 'processing',
              lastSyncedAt: new Date(),
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        // 6. Generate Vector Embedding using Gemini embedding provider
        const result = await embeddingService.generateEmbedding(normalizedText);

        // 7. Check if newer profile version was saved to MongoDB while embedding was generating
        const freshProfile = await UserProfileModel.findOne({ userId: userObjectId }).select('version').lean();
        const latestDbVersion = freshProfile?.version || currentVersion;

        if (latestDbVersion > currentVersion) {
          // A newer profile update occurred while generating the embedding.
          // Save the current embedding to ensure valid vectors exist, but re-enqueue follow-up for the latest state.
          await CandidateProfileModel.findOneAndUpdate(
            { userId: userObjectId },
            {
              $set: {
                embedding: result.embedding,
                embeddingModel: result.model,
                embeddingVersion: result.version,
                embeddedVersion: currentVersion,
                embeddingStatus: 'completed',
              },
            }
          );

          console.log(
            `🔄 [CandidateEmbeddingWorker] Newer profile version detected (v${latestDbVersion} > v${currentVersion}) for User ${userId}. Enqueueing latest version.`
          );

          // Release lock first so follow-up can execute immediately
          await redisService.del(lockKey);
          await enqueueCandidateEmbedding(userId);

          return {
            success: true,
            userId,
            version: currentVersion,
            newerVersionDetected: true,
            latestDbVersion,
          };
        }

        // 8. Atomic MongoDB update with completed vector embedding
        await CandidateProfileModel.findOneAndUpdate(
          { userId: userObjectId },
          {
            $set: {
              embedding: result.embedding,
              embeddingModel: result.model,
              embeddingVersion: result.version,
              embeddingStatus: 'completed',
              embeddedVersion: currentVersion,
            },
          }
        );

        console.log(
          `✅ [CandidateEmbeddingWorker] Completed candidate embedding for User: ${userId} (v${currentVersion}, ${result.dimensions} dims)`
        );

        return {
          success: true,
          userId,
          version: currentVersion,
          dimensions: result.dimensions,
        };
      } catch (error: any) {
        await CandidateProfileModel.findOneAndUpdate(
          { userId: userObjectId },
          { $set: { embeddingStatus: 'failed' } }
        ).catch(() => {});

        console.error(`❌ [CandidateEmbeddingWorker] Failed candidate embedding for ${userId}:`, error?.message || error);
        throw error;
      } finally {
        await redisService.del(lockKey).catch(() => {});
      }
    },
    {
      connection: redisOptions,
      concurrency: 3,
    }
  );

  worker.on('error', () => {});

  worker.on('failed', (job, err) => {
    console.error(`[CandidateEmbeddingWorker] Task ${job?.id} failed with error:`, err.message);
  });

  return worker;
};

