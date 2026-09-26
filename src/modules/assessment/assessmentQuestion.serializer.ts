import {
  IAssessmentQuestion,
  IAssessmentQuestionDocument,
  IMcqOption,
} from './assessmentQuestion.model.js';
import { GeneralAssessmentQuestionType } from '../job/job.model.js';

/**
 * Candidate-safe question representation.
 * CRITICAL SECURITY GUARANTEE:
 * Does NOT contain correctOptionId, expectedAnswer, evaluationCriteria, or internal AI metadata.
 */
export interface ICandidateQuestion {
  id: string;
  type: GeneralAssessmentQuestionType;
  order: number;
  question: string;
  instructions?: string;
  points: number;
  required: boolean;

  // MCQ specific (options only, NO correctOptionId)
  options?: IMcqOption[];

  // Scenario specific
  context?: string;
}

/**
 * Serializes a single assessment question into a safe representation for candidates.
 * Strips all evaluation answers, keys, prompts, and internal metadata.
 */
export function toCandidateQuestion(
  q: IAssessmentQuestionDocument | IAssessmentQuestion | Record<string, any>
): ICandidateQuestion {
  const id = String((q as any)._id || q.id || '');
  const type = q.type as GeneralAssessmentQuestionType;
  const order = Number(q.order) || 1;
  const question = String(q.question || '').trim();
  const instructions = q.instructions ? String(q.instructions).trim() : undefined;
  const points = typeof q.points === 'number' && q.points > 0 ? q.points : 1;
  const required = q.required !== false;

  const candidateQuestion: ICandidateQuestion = {
    id,
    type,
    order,
    question,
    instructions,
    points,
    required,
  };

  if (type === 'mcq' && Array.isArray(q.options)) {
    candidateQuestion.options = q.options.map((opt: any) => ({
      id: String(opt.id || '').trim(),
      text: String(opt.text || '').trim(),
    }));
  }

  if (type === 'scenario' && q.context) {
    candidateQuestion.context = String(q.context).trim();
  }

  return candidateQuestion;
}

/**
 * Serializes a list of assessment questions into candidate-safe representations.
 */
export function toCandidateQuestions(
  questions: (IAssessmentQuestionDocument | IAssessmentQuestion | Record<string, any>)[]
): ICandidateQuestion[] {
  return questions.map(toCandidateQuestion);
}

/**
 * Recruiter question representation, including evaluation keys and internal metadata.
 */
export interface IRecruiterQuestion extends IAssessmentQuestion {
  id: string;
}

/**
 * Serializes a question for recruiter view and editing.
 */
export function toRecruiterQuestion(
  q: IAssessmentQuestionDocument | IAssessmentQuestion | Record<string, any>
): IRecruiterQuestion {
  const id = String((q as any)._id || q.id || '');
  return {
    id,
    jobId: q.jobId,
    roundId: q.roundId,
    type: q.type,
    order: q.order,
    question: q.question,
    instructions: q.instructions,
    points: q.points,
    required: q.required,
    status: q.status,
    source: q.source,
    options: q.options ? q.options.map((opt: any) => ({ id: opt.id, text: opt.text })) : undefined,
    correctOptionId: q.correctOptionId,
    expectedAnswer: q.expectedAnswer,
    context: q.context,
    evaluationCriteria: q.evaluationCriteria,
    metadata: q.metadata,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  };
}

/**
 * Serializes a list of questions for recruiter view.
 */
export function toRecruiterQuestions(
  questions: (IAssessmentQuestionDocument | IAssessmentQuestion | Record<string, any>)[]
): IRecruiterQuestion[] {
  return questions.map(toRecruiterQuestion);
}
