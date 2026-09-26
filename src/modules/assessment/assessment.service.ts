import mongoose, { Types } from 'mongoose';
import { JobModel, IJobDocument } from '../job/job.model.js';
import {
  AssessmentQuestionModel,
  IAssessmentQuestionDocument,
  GeneralAssessmentQuestionType,
} from './assessmentQuestion.model.js';
import {
  toCandidateQuestion,
  toCandidateQuestions,
  toRecruiterQuestion,
  toRecruiterQuestions,
  ICandidateQuestion,
  IRecruiterQuestion,
} from './assessmentQuestion.serializer.js';
import {
  CreateQuestionInput,
  UpdateQuestionInput,
  createQuestionSchema,
  updateQuestionSchema,
} from './assessmentQuestion.validator.js';
import { AppError } from '../../utils/appError.js';

export class AssessmentService {
  /**
   * Helper: verify job ownership and assessment round validity.
   * Enforces recruiter authorization and ensures round exists on the job.
   */
  public async verifyJobOwnershipAndRound(
    jobId: string | Types.ObjectId,
    roundId?: string,
    recruiterUserId?: string
  ): Promise<{ job: IJobDocument; round?: any }> {
    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      throw AppError.badRequest('Invalid jobId format');
    }

    const job = await JobModel.findById(jobId);
    if (!job) {
      throw AppError.notFound(`Job not found for ID: ${jobId}`);
    }

    if (recruiterUserId && String(job.postedBy) !== String(recruiterUserId)) {
      throw AppError.forbidden('You do not have permission to manage this job assessment.');
    }

    let round: any = undefined;
    if (roundId) {
      if (!job.assessment || !job.assessment.enabled || !Array.isArray(job.assessment.rounds)) {
        throw AppError.notFound(`Assessment is not enabled or configured for job ${jobId}`);
      }
      round = job.assessment.rounds.find(
        (r) => r.id === roundId || r.type === roundId
      );
      if (!round) {
        throw AppError.notFound(
          `Assessment round "${roundId}" not found for job ${jobId}`
        );
      }
    }

    return { job, round };
  }

  /**
   * Recruiter view: fetch all questions for a specific assessment round.
   * Returns full question details, including internal evaluation keys.
   */
  public async getRecruiterQuestions(
    jobId: string,
    roundId: string,
    recruiterUserId: string
  ): Promise<IRecruiterQuestion[]> {
    await this.verifyJobOwnershipAndRound(jobId, roundId, recruiterUserId);

    const questions = await AssessmentQuestionModel.find({
      jobId: new Types.ObjectId(jobId),
      roundId,
    }).sort({ order: 1 });

    return toRecruiterQuestions(questions);
  }

  /**
   * Candidate-safe view: fetch questions stripped of evaluation data.
   * Never exposes correctOptionId, expectedAnswer, evaluationCriteria, or internal AI metadata.
   */
  public async getCandidateQuestions(
    jobId: string,
    roundId: string
  ): Promise<ICandidateQuestion[]> {
    const { job, round } = await this.verifyJobOwnershipAndRound(jobId, roundId);

    const questions = await AssessmentQuestionModel.find({
      jobId: new Types.ObjectId(jobId),
      roundId,
      status: { $ne: 'archived' },
    }).sort({ order: 1 });

    return toCandidateQuestions(questions);
  }

  /**
   * Create a new question for an assessment round.
   */
  public async createQuestion(
    jobId: string,
    roundId: string,
    recruiterUserId: string,
    input: CreateQuestionInput
  ): Promise<IRecruiterQuestion> {
    const { round } = await this.verifyJobOwnershipAndRound(jobId, roundId, recruiterUserId);

    // Validate input with Zod
    const validated = createQuestionSchema.parse(input);

    // If General Assessment specifies allowed questionTypes, ensure this question matches
    if (round && round.type === 'general' && round.config?.questionTypes) {
      const allowedTypes = round.config.questionTypes as GeneralAssessmentQuestionType[];
      if (!allowedTypes.includes(validated.type)) {
        throw AppError.badRequest(
          `Question type "${validated.type}" is not enabled for this General Assessment round. Enabled types: ${allowedTypes.join(', ')}`
        );
      }
    }

    // Determine sequential order
    let targetOrder = validated.order;
    if (typeof targetOrder !== 'number' || targetOrder < 1) {
      const highest = await AssessmentQuestionModel.findOne({
        jobId: new Types.ObjectId(jobId),
        roundId,
      })
        .sort({ order: -1 })
        .select('order');
      targetOrder = (highest?.order || 0) + 1;
    }

    const questionDoc = new AssessmentQuestionModel({
      ...validated,
      jobId: new Types.ObjectId(jobId),
      roundId,
      order: targetOrder,
    });

    await questionDoc.save();

    // Re-normalize orders to guarantee sequence: 1, 2, 3...
    await this.normalizeQuestionOrders(jobId, roundId);

    const reloaded = await AssessmentQuestionModel.findById(questionDoc._id);
    return toRecruiterQuestion(reloaded || questionDoc);
  }

  /**
   * Update an existing question.
   */
  public async updateQuestion(
    jobId: string,
    roundId: string,
    questionId: string,
    recruiterUserId: string,
    input: UpdateQuestionInput
  ): Promise<IRecruiterQuestion> {
    await this.verifyJobOwnershipAndRound(jobId, roundId, recruiterUserId);

    if (!mongoose.Types.ObjectId.isValid(questionId)) {
      throw AppError.badRequest('Invalid questionId format');
    }

    const validated = updateQuestionSchema.parse(input);

    const question = await AssessmentQuestionModel.findOne({
      _id: new Types.ObjectId(questionId),
      jobId: new Types.ObjectId(jobId),
      roundId,
    });

    if (!question) {
      throw AppError.notFound(`Question not found: ${questionId}`);
    }

    // Update mutable fields
    if (typeof validated.question !== 'undefined') question.question = validated.question;
    if (typeof validated.instructions !== 'undefined') question.instructions = validated.instructions;
    if (typeof validated.points !== 'undefined') question.points = validated.points;
    if (typeof validated.required !== 'undefined') question.required = validated.required;
    if (typeof validated.status !== 'undefined') question.status = validated.status;
    if (typeof validated.metadata !== 'undefined') question.metadata = validated.metadata;

    if (question.type === 'mcq') {
      if (typeof validated.options !== 'undefined') question.options = validated.options;
      if (typeof validated.correctOptionId !== 'undefined') question.correctOptionId = validated.correctOptionId;
    } else if (question.type === 'short_answer') {
      if (typeof validated.expectedAnswer !== 'undefined') question.expectedAnswer = validated.expectedAnswer;
      if (typeof validated.evaluationCriteria !== 'undefined') question.evaluationCriteria = validated.evaluationCriteria;
    } else if (question.type === 'scenario') {
      if (typeof validated.context !== 'undefined') question.context = validated.context;
      if (typeof validated.evaluationCriteria !== 'undefined') question.evaluationCriteria = validated.evaluationCriteria;
    }

    if (typeof validated.order === 'number' && validated.order > 0) {
      question.order = validated.order;
    }

    await question.save();

    // Re-normalize if order was changed
    if (typeof validated.order === 'number') {
      await this.normalizeQuestionOrders(jobId, roundId);
    }

    const reloaded = await AssessmentQuestionModel.findById(question._id);
    return toRecruiterQuestion(reloaded || question);
  }

  /**
   * Delete a question and sequentially normalize remaining orders (e.g. 1, 3, 5 -> 1, 2, 3).
   */
  public async deleteQuestion(
    jobId: string,
    roundId: string,
    questionId: string,
    recruiterUserId: string
  ): Promise<{ success: boolean; deletedId: string }> {
    await this.verifyJobOwnershipAndRound(jobId, roundId, recruiterUserId);

    if (!mongoose.Types.ObjectId.isValid(questionId)) {
      throw AppError.badRequest('Invalid questionId format');
    }

    const deleted = await AssessmentQuestionModel.findOneAndDelete({
      _id: new Types.ObjectId(questionId),
      jobId: new Types.ObjectId(jobId),
      roundId,
    });

    if (!deleted) {
      throw AppError.notFound(`Question not found: ${questionId}`);
    }

    // Renormalize orders for remaining questions
    await this.normalizeQuestionOrders(jobId, roundId);

    return { success: true, deletedId: questionId };
  }

  /**
   * Reorder questions deterministically based on an ordered array of question IDs.
   */
  public async reorderQuestions(
    jobId: string,
    roundId: string,
    recruiterUserId: string,
    questionIds: string[]
  ): Promise<IRecruiterQuestion[]> {
    await this.verifyJobOwnershipAndRound(jobId, roundId, recruiterUserId);

    if (!Array.isArray(questionIds) || questionIds.length === 0) {
      throw AppError.badRequest('questionIds array must be non-empty');
    }

    // Verify all IDs are valid ObjectIds
    for (const qid of questionIds) {
      if (!mongoose.Types.ObjectId.isValid(qid)) {
        throw AppError.badRequest(`Invalid questionId: ${qid}`);
      }
    }

    // Query questions to ensure they all exist in this round
    const existing = await AssessmentQuestionModel.find({
      _id: { $in: questionIds.map((id) => new Types.ObjectId(id)) },
      jobId: new Types.ObjectId(jobId),
      roundId,
    });

    if (existing.length !== questionIds.length) {
      throw AppError.badRequest(
        `Some question IDs do not belong to this assessment round. Found ${existing.length} of ${questionIds.length}.`
      );
    }

    // Update orders sequentially: index + 1
    const bulkOps = questionIds.map((qid, idx) => ({
      updateOne: {
        filter: { _id: new Types.ObjectId(qid) },
        update: { $set: { order: idx + 1 } },
      },
    }));

    await AssessmentQuestionModel.bulkWrite(bulkOps);

    const reordered = await AssessmentQuestionModel.find({
      jobId: new Types.ObjectId(jobId),
      roundId,
    }).sort({ order: 1 });

    return toRecruiterQuestions(reordered);
  }

  /**
   * Deterministically normalizes all questions in a round to orders 1, 2, 3...
   * Ensures no gaps or duplicate numbers.
   */
  public async normalizeQuestionOrders(
    jobId: string | Types.ObjectId,
    roundId: string
  ): Promise<void> {
    const questions = await AssessmentQuestionModel.find({
      jobId: new Types.ObjectId(jobId),
      roundId,
    }).sort({ order: 1, createdAt: 1 });

    if (questions.length === 0) return;

    const bulkOps = questions.map((q, idx) => ({
      updateOne: {
        filter: { _id: q._id },
        update: { $set: { order: idx + 1 } },
      },
    }));

    await AssessmentQuestionModel.bulkWrite(bulkOps);
  }
}

export const assessmentService = new AssessmentService();
