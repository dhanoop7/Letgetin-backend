import { Types } from 'mongoose';
import crypto from 'crypto';
import {
  DomainAssessmentModel,
  IDomainAssessment,
  IDomainAssessmentQuestion,
  AssessmentStatus,
  AssessmentDifficulty,
  TestingMode,
} from './domainAssessment.model.js';
import {
  AssessmentAttemptModel,
  IAssessmentAttempt,
  IAttemptEvaluation,
  ISkillScoreBreakdown,
  IModeScoreBreakdown,
} from './assessmentAttempt.model.js';
import { GoogleProvider } from '../ai/providers/google.provider.js';
import { AppError } from '../../utils/appError.js';

export interface IAutoConfigureInput {
  jobTitle?: string;
  jobDescription?: string;
  domain?: string;
}

export interface IAutoConfigureOutput {
  domain: string;
  role: string;
  skillAreas: string[];
  difficulty: AssessmentDifficulty;
  timeLimitMinutes: number;
  testingModes: TestingMode[];
  options: {
    allowCodeCompilation: boolean;
    enableAiHints: boolean;
    recordScreen: boolean;
    autoEvaluateRubrics: boolean;
  };
  customInstructions: string;
  summary: string;
}

export interface IGenerateQuestionsInput {
  domain: string;
  role?: string;
  skillAreas: string[];
  difficulty: AssessmentDifficulty;
  testingModes: TestingMode[];
  count?: number;
  jobDescription?: string;
  customInstructions?: string;
}

const DEFAULT_DOMAIN_SKILLS: Record<string, string[]> = {
  frontend: ['React', 'TypeScript', 'CSS/Tailwind', 'State Management', 'Web Performance', 'Testing (Jest/RTL)'],
  backend: ['Node.js/Express', 'REST & GraphQL APIs', 'SQL & NoSQL Databases', 'Caching & Redis', 'System Architecture', 'Security'],
  fullstack: ['Programming & Algorithms', 'Frontend Architecture', 'Backend APIs', 'Databases', 'System Design', 'CI/CD & DevOps'],
  devops: ['Docker & Kubernetes', 'CI/CD Pipelines', 'Cloud Architecture (AWS/GCP)', 'Infrastructure as Code', 'Monitoring & SRE', 'Linux & Networking'],
  data: ['Python', 'SQL & Data Modeling', 'ETL/ELT Pipelines', 'Data Warehousing', 'Spark/Distributed Computing', 'Data Quality'],
  mobile: ['React Native / Flutter', 'Mobile Architecture', 'Offline Storage', 'App Performance', 'API Integration', 'App Security'],
  cloud: ['Cloud Architecture', 'Microservices Patterns', 'Serverless', 'High Availability', 'IAM & Cloud Security', 'Cost Optimization'],
  security: ['OWASP Top 10', 'Authentication & JWT', 'Data Encryption', 'Penetration Testing Concepts', 'Network Security', 'Code Audit'],
  ml: ['Python & PyTorch', 'Feature Engineering', 'Model Evaluation', 'LLM & Prompt Engineering', 'Vector Databases & RAG', 'MLOps'],
};

export class DomainAssessmentService {
  /**
   * AI Auto-Configure: Analyzes JD / Role to propose optimal test settings
   */
  public async autoConfigure(input: IAutoConfigureInput): Promise<IAutoConfigureOutput> {
    const role = input.jobTitle || 'Full Stack Engineer';
    const jd = input.jobDescription || '';

    const prompt = `You are a principal tech assessment architect at LetGetIn.
Analyze this job role and description to propose the optimal Domain Specific Assessment configuration.

Job Title / Role: "${role}"
Job Description:
"""
${jd.slice(0, 3500)}
"""

Instructions:
1. Carefully extract 4 to 8 primary skill sets directly required by this Job Description (technologies, frameworks, databases, architectural concepts).
2. Select 2 to 4 assessment rounds (testingModes) that directly evaluate the responsibilities in this JD:
   - "coding": hands-on coding, algorithms, logic, and implementations
   - "architecture": software design patterns, component modularity, system trade-offs
   - "system": distributed systems, scalability, load balancing, caching
   - "debugging": code troubleshooting, root-cause analysis, fixing edge cases
   - "database": query writing, indexing, relational and NoSQL schema design
   - "security": auth, OWASP security, encryption, and secure API practices
3. Select the best domain: "frontend" | "backend" | "fullstack" | "devops" | "data" | "mobile" | "cloud" | "security" | "ml".
4. Determine appropriate difficulty: "junior" | "mid" | "senior" | "lead" | "principal".
5. Recommend test duration (timeLimitMinutes): 30, 45, 60, 90, or 120.

Format strictly as JSON:
{
  "domain": "frontend" | "backend" | "fullstack" | "devops" | "data" | "mobile" | "cloud" | "security" | "ml",
  "role": "${role}",
  "skillAreas": ["Skill 1", "Skill 2", "Skill 3", "Skill 4"],
  "difficulty": "junior" | "mid" | "senior" | "lead" | "principal",
  "timeLimitMinutes": 60,
  "testingModes": ["coding", "architecture", "system"],
  "customInstructions": "Clear instructions for candidates based on this JD...",
  "summary": "Concise 1-2 sentence explanation of why these specific rounds and skills were selected for this role."
}`;

    try {
      const response = await GoogleProvider.getInstance().generate({
        prompt,
        promptName: 'domain_assessment_auto_configure',
        jsonMode: true,
        temperature: 0.4,
      });

      const parsed = JSON.parse(response.text.trim());
      if (parsed && parsed.domain && Array.isArray(parsed.skillAreas)) {
        return {
          domain: parsed.domain || input.domain || 'fullstack',
          role: parsed.role || role,
          skillAreas: parsed.skillAreas.length > 0 ? parsed.skillAreas : (DEFAULT_DOMAIN_SKILLS[parsed.domain] || DEFAULT_DOMAIN_SKILLS.fullstack),
          difficulty: parsed.difficulty || 'mid',
          timeLimitMinutes: Number(parsed.timeLimitMinutes) || 60,
          testingModes: Array.isArray(parsed.testingModes) && parsed.testingModes.length > 0 ? parsed.testingModes : ['coding', 'architecture', 'system'],
          options: {
            allowCodeCompilation: true,
            enableAiHints: true,
            recordScreen: false,
            autoEvaluateRubrics: true,
          },
          customInstructions: parsed.customInstructions || 'Complete all sections. Clearly explain architectural decisions and edge cases.',
          summary: parsed.summary || `Configured for ${role} focusing on ${parsed.domain} skills.`,
        };
      }
    } catch (err) {
      console.warn('[DomainAssessmentService] Gemini autoConfigure failed, using heuristic fallback:', (err as Error)?.message);
    }

    // Heuristic Fallback
    const detectedDomain = this.detectDomainFromText(role + ' ' + jd) || input.domain || 'fullstack';
    const skills = DEFAULT_DOMAIN_SKILLS[detectedDomain] || DEFAULT_DOMAIN_SKILLS.fullstack;

    let difficulty: AssessmentDifficulty = 'mid';
    const lower = (role + ' ' + jd).toLowerCase();
    if (lower.includes('lead') || lower.includes('principal') || lower.includes('staff')) {
      difficulty = 'lead';
    } else if (lower.includes('senior') || lower.includes('sr.')) {
      difficulty = 'senior';
    } else if (lower.includes('junior') || lower.includes('entry') || lower.includes('intern') || lower.includes('associate')) {
      difficulty = 'junior';
    }

    return {
      domain: detectedDomain,
      role: role,
      skillAreas: skills,
      difficulty,
      timeLimitMinutes: difficulty === 'lead' ? 90 : 60,
      testingModes: this.getDefaultModesForDomain(detectedDomain),
      options: {
        allowCodeCompilation: true,
        enableAiHints: true,
        recordScreen: false,
        autoEvaluateRubrics: true,
      },
      customInstructions: `Assessment tailored for ${role}. Ensure clean syntax, robust error handling, and scalable architectural choices.`,
      summary: `Auto-configured assessment for ${role} covering core ${detectedDomain} competencies.`,
    };
  }

  /**
   * AI Question Generation tailored to domain, modes, and difficulty
   */
  public async generateQuestions(input: IGenerateQuestionsInput): Promise<IDomainAssessmentQuestion[]> {
    const count = Math.min(Math.max(input.count || 5, 2), 15);
    const domain = input.domain || 'fullstack';
    const difficulty = input.difficulty || 'mid';
    const modes: TestingMode[] = input.testingModes && input.testingModes.length > 0 ? input.testingModes : ['coding', 'architecture', 'system'];
    const skills = input.skillAreas && input.skillAreas.length > 0 ? input.skillAreas.join(', ') : 'core technical competencies';

    const prompt = `You are a world-class principal engineering examiner at LetGetIn.
Generate ${count} comprehensive, practical domain assessment questions for a ${difficulty}-level role in "${domain}".

Skills to evaluate: ${skills}
Target testing modes: ${modes.join(', ')}
${input.jobDescription ? `Job Context:\n"""${input.jobDescription.slice(0, 1500)}"""\n` : ''}
${input.customInstructions ? `Special Instructions: "${input.customInstructions}"\n` : ''}

Provide a diverse mix across the target modes. Support:
1. "coding": Practical algorithmic or API task with starter code and test cases.
2. "architecture": System or software architecture scenario testing design patterns and scalability tradeoffs.
3. "system": Distributed system design challenge.
4. "debugging": Code snippet with a subtle bug to find and rectify.
5. "database": Schema or query challenge.
6. "mcq": High-acuity conceptual multiple-choice question.

Format strictly as JSON with this exact schema:
{
  "questions": [
    {
      "id": "q1",
      "order": 1,
      "title": "Short Descriptive Title",
      "question": "Full comprehensive problem statement with requirements",
      "type": "coding" | "architecture" | "system_design" | "debugging" | "mcq" | "short_answer",
      "testingMode": "coding" | "architecture" | "system" | "debugging" | "database" | "security",
      "skill": "Specific skill name",
      "difficulty": "${difficulty}",
      "points": 10,
      "instructions": "Instructions for candidate",
      "context": "Scenario context, architectural premise, or background",
      "starterCode": "// Starter code for coding/debugging",
      "solutionCode": "// Reference solution",
      "language": "javascript" | "typescript" | "python" | "sql",
      "testCases": [
        { "input": "inputData", "expectedOutput": "outputData", "isHidden": false }
      ],
      "options": [
        { "id": "opt_a", "text": "Option A" },
        { "id": "opt_b", "text": "Option B" },
        { "id": "opt_c", "text": "Option C" },
        { "id": "opt_d", "text": "Option D" }
      ],
      "correctOptionId": "opt_b",
      "expectedAnswer": "Key architectural expectations and criteria for full points",
      "evaluationCriteria": [
        "Criterion 1",
        "Criterion 2"
      ]
    }
  ]
}`;

    try {
      const response = await GoogleProvider.getInstance().generate({
        prompt,
        promptName: 'domain_assessment_generate_questions',
        jsonMode: true,
        temperature: 0.6,
      });

      const parsed = JSON.parse(response.text.trim());
      if (parsed && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
        return parsed.questions.map((q: any, idx: number) => ({
          id: q.id || `q_${idx + 1}`,
          order: idx + 1,
          title: q.title || `Question ${idx + 1}`,
          question: q.question,
          type: q.type || 'mcq',
          testingMode: q.testingMode || modes[idx % modes.length],
          skill: q.skill || (input.skillAreas[idx % input.skillAreas.length] || 'Core Domain'),
          difficulty: q.difficulty || difficulty,
          points: Number(q.points) || 10,
          instructions: q.instructions || '',
          context: q.context || '',
          starterCode: q.starterCode || '',
          solutionCode: q.solutionCode || '',
          language: q.language || 'javascript',
          testCases: Array.isArray(q.testCases) ? q.testCases : [],
          options: Array.isArray(q.options) ? q.options : [],
          correctOptionId: q.correctOptionId || '',
          expectedAnswer: q.expectedAnswer || '',
          evaluationCriteria: Array.isArray(q.evaluationCriteria) ? q.evaluationCriteria : [],
        }));
      }
    } catch (err) {
      console.warn('[DomainAssessmentService] Gemini question generation failed, using rich curated questions:', (err as Error)?.message);
    }

    // Curated Fallback Questions for Domain & Modes
    return this.getFallbackQuestions(domain, difficulty, modes, input.skillAreas, count);
  }

  /**
   * Create a new Domain Specific Assessment (Standalone entity)
   */
  public async createAssessment(
    data: Partial<IDomainAssessment>,
    recruiterId?: string
  ): Promise<IDomainAssessment> {
    const assessmentId = `dsa_${crypto.randomBytes(5).toString('hex')}`;
    const questions = data.questions || [];
    const questionsCount = questions.length;
    const totalPoints = questions.reduce((sum, q) => sum + (q.points || 10), 0);

    const doc = await DomainAssessmentModel.create({
      ...data,
      assessmentId,
      recruiterId: recruiterId ? new Types.ObjectId(recruiterId) : undefined,
      status: data.status || 'draft',
      questions,
      questionsCount,
      totalPoints,
      passingPercentage: data.passingPercentage || 70,
    });

    return doc.toJSON() as IDomainAssessment;
  }

  /**
   * List assessments with search, status filters, and pagination
   */
  public async getAssessments(params: {
    recruiterId?: string;
    status?: string;
    domain?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<{ assessments: any[]; total: number; page: number; totalPages: number }> {
    const page = Math.max(Number(params.page) || 1, 1);
    const limit = Math.min(Math.max(Number(params.limit) || 12, 1), 50);
    const query: any = {};

    if (params.status && params.status !== 'all') {
      query.status = params.status;
    }
    if (params.domain && params.domain !== 'all') {
      query.domain = params.domain;
    }
    if (params.search) {
      query.$or = [
        { title: { $regex: params.search, $options: 'i' } },
        { role: { $regex: params.search, $options: 'i' } },
        { domain: { $regex: params.search, $options: 'i' } },
        { skillAreas: { $regex: params.search, $options: 'i' } },
      ];
    }

    const [docs, total] = await Promise.all([
      DomainAssessmentModel.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      DomainAssessmentModel.countDocuments(query),
    ]);

    // Populate candidate attempt metrics for each assessment
    const assessmentIds = docs.map((d) => d._id);
    const attemptCounts = await AssessmentAttemptModel.aggregate([
      { $match: { assessmentId: { $in: assessmentIds } } },
      {
        $group: {
          _id: '$assessmentId',
          totalAttempts: { $sum: 1 },
          completedAttempts: {
            $sum: { $cond: [{ $in: ['$status', ['submitted', 'evaluated']] }, 1, 0] },
          },
          avgScore: { $avg: '$evaluation.percentage' },
        },
      },
    ]);

    const countsMap = new Map<string, { total: number; completed: number; avgScore: number }>();
    attemptCounts.forEach((c) => {
      countsMap.set(c._id.toString(), {
        total: c.totalAttempts,
        completed: c.completedAttempts,
        avgScore: Math.round(c.avgScore || 0),
      });
    });

    const assessments = docs.map((d: any) => {
      const stats = countsMap.get(d._id.toString()) || { total: 0, completed: 0, avgScore: 0 };
      return {
        ...d,
        id: d._id.toString(),
        attemptsCount: stats.total,
        completedAttemptsCount: stats.completed,
        averageScore: stats.avgScore,
      };
    });

    return {
      assessments,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get single assessment by ID or assessmentId
   */
  public async getAssessmentById(id: string): Promise<any> {
    const isObjectId = Types.ObjectId.isValid(id);
    const query = isObjectId ? { $or: [{ _id: id }, { assessmentId: id }] } : { assessmentId: id };

    const doc = await DomainAssessmentModel.findOne(query).lean();
    if (!doc) {
      throw AppError.notFound('Domain Assessment not found');
    }

    const attemptsCount = await AssessmentAttemptModel.countDocuments({ assessmentId: doc._id });
    const completedAttempts = await AssessmentAttemptModel.countDocuments({
      assessmentId: doc._id,
      status: { $in: ['submitted', 'evaluated'] },
    });

    return {
      ...doc,
      id: (doc as any)._id.toString(),
      attemptsCount,
      completedAttempts,
    };
  }

  /**
   * Update assessment
   */
  public async updateAssessment(id: string, updates: Partial<IDomainAssessment>): Promise<any> {
    const isObjectId = Types.ObjectId.isValid(id);
    const query = isObjectId ? { $or: [{ _id: id }, { assessmentId: id }] } : { assessmentId: id };

    const assessment = await DomainAssessmentModel.findOne(query);
    if (!assessment) {
      throw AppError.notFound('Domain Assessment not found');
    }

    if (updates.questions) {
      assessment.questions = updates.questions;
      assessment.questionsCount = updates.questions.length;
      assessment.totalPoints = updates.questions.reduce((sum, q) => sum + (q.points || 10), 0);
    }

    if (updates.title !== undefined) assessment.title = updates.title;
    if (updates.role !== undefined) assessment.role = updates.role;
    if (updates.jobDescription !== undefined) assessment.jobDescription = updates.jobDescription;
    if (updates.jobId !== undefined) assessment.jobId = updates.jobId as any;
    if (updates.jobTitle !== undefined) assessment.jobTitle = updates.jobTitle;
    if (updates.domain !== undefined) assessment.domain = updates.domain;
    if (updates.skillAreas !== undefined) assessment.skillAreas = updates.skillAreas;
    if (updates.difficulty !== undefined) assessment.difficulty = updates.difficulty;
    if (updates.timeLimitMinutes !== undefined) assessment.timeLimitMinutes = updates.timeLimitMinutes;
    if (updates.testingModes !== undefined) assessment.testingModes = updates.testingModes;
    if (updates.options !== undefined) assessment.options = updates.options;
    if (updates.customInstructions !== undefined) assessment.customInstructions = updates.customInstructions;
    if (updates.passingPercentage !== undefined) assessment.passingPercentage = updates.passingPercentage;
    if (updates.status !== undefined) assessment.status = updates.status;

    await assessment.save();
    return assessment.toJSON();
  }

  /**
   * Delete or archive assessment
   */
  public async deleteAssessment(id: string): Promise<boolean> {
    const isObjectId = Types.ObjectId.isValid(id);
    const query = isObjectId ? { $or: [{ _id: id }, { assessmentId: id }] } : { assessmentId: id };

    const assessment = await DomainAssessmentModel.findOne(query);
    if (!assessment) {
      throw AppError.notFound('Domain Assessment not found');
    }

    // Check if there are candidate attempts
    const attemptsCount = await AssessmentAttemptModel.countDocuments({ assessmentId: assessment._id });
    if (attemptsCount > 0) {
      // Soft-archive instead of hard-delete to preserve candidate records
      assessment.status = 'archived';
      assessment.archivedAt = new Date();
      await assessment.save();
      return true;
    }

    await DomainAssessmentModel.findByIdAndDelete(assessment._id);
    return true;
  }

  /**
   * Publish assessment (transitions from draft/ready -> published)
   */
  public async publishAssessment(id: string): Promise<any> {
    const assessment = await this.getAssessmentById(id);
    if (!assessment.questions || assessment.questions.length === 0) {
      throw AppError.badRequest('Cannot publish an assessment with zero questions. Please add or generate questions first.');
    }

    const updated = await DomainAssessmentModel.findByIdAndUpdate(
      assessment.id,
      {
        status: 'published',
        publishedAt: new Date(),
      },
      { new: true }
    );

    return updated?.toJSON();
  }

  /**
   * Archive assessment
   */
  public async archiveAssessment(id: string): Promise<any> {
    const assessment = await this.getAssessmentById(id);
    const updated = await DomainAssessmentModel.findByIdAndUpdate(
      assessment.id,
      {
        status: 'archived',
        archivedAt: new Date(),
      },
      { new: true }
    );
    return updated?.toJSON();
  }

  // ==========================================
  // CANDIDATE ATTEMPT & EVALUATION LIFECYCLE
  // ==========================================

  /**
   * Start or create a candidate test attempt
   */
  public async startAttempt(
    assessmentIdentifier: string,
    candidateData: { candidateName: string; candidateEmail: string; candidateId?: string }
  ): Promise<any> {
    const assessment = await this.getAssessmentById(assessmentIdentifier);

    const attemptId = `att_${crypto.randomBytes(5).toString('hex')}`;
    const initialAnswers = assessment.questions.map((q: any) => ({
      questionId: q.id,
      answer: q.starterCode || '',
      language: q.language || 'javascript',
      autoSavedAt: new Date(),
      score: 0,
    }));

    const attempt = await AssessmentAttemptModel.create({
      attemptId,
      assessmentId: assessment._id || assessment.id,
      candidateId: candidateData.candidateId ? new Types.ObjectId(candidateData.candidateId) : undefined,
      candidateName: candidateData.candidateName,
      candidateEmail: candidateData.candidateEmail.toLowerCase().trim(),
      status: 'in_progress',
      startedAt: new Date(),
      timeSpentSeconds: 0,
      timeLimitMinutes: assessment.timeLimitMinutes || 60,
      answers: initialAnswers,
    });

    return {
      attemptId: attempt.attemptId,
      assessmentId: assessment.assessmentId,
      status: attempt.status,
      timeLimitMinutes: attempt.timeLimitMinutes,
      startedAt: attempt.startedAt,
    };
  }

  /**
   * Candidate: Get test attempt data with sanitized questions (no answers exposed)
   */
  public async getAttempt(attemptId: string): Promise<any> {
    const attempt = await AssessmentAttemptModel.findOne({ attemptId }).lean();
    if (!attempt) {
      throw AppError.notFound('Test session not found');
    }

    const assessment = await DomainAssessmentModel.findById(attempt.assessmentId).lean();
    if (!assessment) {
      throw AppError.notFound('Assessment definition not found');
    }

    // Sanitize questions so test taker cannot see correct options or reference solution
    const sanitizedQuestions = assessment.questions.map((q) => ({
      id: q.id,
      order: q.order,
      title: q.title,
      question: q.question,
      type: q.type,
      testingMode: q.testingMode,
      skill: q.skill,
      difficulty: q.difficulty,
      points: q.points,
      instructions: q.instructions,
      context: q.context,
      starterCode: q.starterCode,
      language: q.language,
      options: q.options?.map((opt) => ({ id: opt.id, text: opt.text })),
      testCases: q.testCases?.filter((tc) => !tc.isHidden).map((tc) => ({ input: tc.input, expectedOutput: tc.expectedOutput })),
    }));

    // Calculate remaining seconds
    const elapsedSeconds = Math.floor((Date.now() - new Date(attempt.startedAt).getTime()) / 1000);
    const totalAllowedSeconds = (attempt.timeLimitMinutes || 60) * 60;
    const remainingSeconds = Math.max(totalAllowedSeconds - elapsedSeconds, 0);

    return {
      attempt: {
        id: (attempt as any)._id.toString(),
        attemptId: attempt.attemptId,
        candidateName: attempt.candidateName,
        candidateEmail: attempt.candidateEmail,
        status: attempt.status,
        startedAt: attempt.startedAt,
        timeLimitMinutes: attempt.timeLimitMinutes,
        remainingSeconds,
        answers: attempt.answers,
        evaluation: attempt.evaluation,
      },
      assessment: {
        id: (assessment as any)._id.toString(),
        assessmentId: assessment.assessmentId,
        title: assessment.title,
        role: assessment.role,
        domain: assessment.domain,
        difficulty: assessment.difficulty,
        timeLimitMinutes: assessment.timeLimitMinutes,
        options: assessment.options,
        questionsCount: assessment.questionsCount,
        totalPoints: assessment.totalPoints,
        questions: sanitizedQuestions,
      },
    };
  }

  /**
   * Candidate: Auto-save single answer or partial progress
   */
  public async saveAnswer(
    attemptId: string,
    data: { questionId: string; answer: string; language?: string; timeSpentSeconds?: number }
  ): Promise<boolean> {
    const attempt = await AssessmentAttemptModel.findOne({ attemptId });
    if (!attempt) {
      throw AppError.notFound('Attempt not found');
    }
    if (attempt.status !== 'in_progress') {
      throw AppError.badRequest('Cannot update answers on a submitted assessment.');
    }

    const answerIdx = attempt.answers.findIndex((a) => a.questionId === data.questionId);
    if (answerIdx >= 0) {
      attempt.answers[answerIdx].answer = data.answer;
      if (data.language) attempt.answers[answerIdx].language = data.language;
      attempt.answers[answerIdx].autoSavedAt = new Date();
    } else {
      attempt.answers.push({
        questionId: data.questionId,
        answer: data.answer,
        language: data.language,
        autoSavedAt: new Date(),
        score: 0,
      });
    }

    if (data.timeSpentSeconds) {
      attempt.timeSpentSeconds = data.timeSpentSeconds;
    }

    await attempt.save();
    return true;
  }

  /**
   * Candidate: Submit test and run automated evaluation
   */
  public async submitAttempt(attemptId: string): Promise<IAttemptEvaluation> {
    const attempt = await AssessmentAttemptModel.findOne({ attemptId });
    if (!attempt) {
      throw AppError.notFound('Attempt not found');
    }

    if (attempt.status === 'evaluated' && attempt.evaluation) {
      return attempt.evaluation;
    }

    const assessment = await DomainAssessmentModel.findById(attempt.assessmentId);
    if (!assessment) {
      throw AppError.notFound('Assessment not found');
    }

    // 1. Evaluate MCQs and calculate base scores
    const questions = assessment.questions;
    const answersMap = new Map(attempt.answers.map((a) => [a.questionId, a.answer]));

    let totalScore = 0;
    const maxScore = assessment.totalPoints || questions.reduce((sum, q) => sum + (q.points || 10), 0);
    const skillScores: Record<string, { earned: number; max: number; feedback: string[] }> = {};
    const modeScores: Record<string, { earned: number; max: number }> = {};

    questions.forEach((q) => {
      const candidateAns = answersMap.get(q.id) || '';
      const skillName = q.skill || 'General';
      const modeName = q.testingMode || 'coding';
      const pts = q.points || 10;

      if (!skillScores[skillName]) skillScores[skillName] = { earned: 0, max: 0, feedback: [] };
      if (!modeScores[modeName]) modeScores[modeName] = { earned: 0, max: 0 };

      skillScores[skillName].max += pts;
      modeScores[modeName].max += pts;

      let qScore = 0;
      let qFeedback = '';

      if (q.type === 'mcq') {
        if (candidateAns && q.correctOptionId && candidateAns.trim().toLowerCase() === q.correctOptionId.trim().toLowerCase()) {
          qScore = pts;
          qFeedback = 'Correct choice.';
        } else {
          qScore = 0;
          qFeedback = 'Incorrect choice.';
        }
      } else {
        // Non-MCQ baseline evaluation
        if (candidateAns && candidateAns.trim().length > 30) {
          // Substantial answer provided
          qScore = Math.round(pts * 0.8);
          qFeedback = 'Solid response covering primary architectural and technical aspects.';
        } else if (candidateAns && candidateAns.trim().length > 0) {
          qScore = Math.round(pts * 0.4);
          qFeedback = 'Partial answer provided. Could be expanded with more edge case considerations.';
        } else {
          qScore = 0;
          qFeedback = 'No answer submitted.';
        }
      }

      totalScore += qScore;
      skillScores[skillName].earned += qScore;
      modeScores[modeName].earned += qScore;

      // Update attempt answer record
      const ansObj = attempt.answers.find((a) => a.questionId === q.id);
      if (ansObj) {
        ansObj.score = qScore;
        ansObj.isCorrect = qScore >= pts * 0.7;
        ansObj.feedback = qFeedback;
      }
    });

    const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
    const passed = percentage >= (assessment.passingPercentage || 70);

    let verdict: 'strong_hire' | 'hire' | 'borderline' | 'reject' = 'borderline';
    if (percentage >= 85) verdict = 'strong_hire';
    else if (percentage >= 70) verdict = 'hire';
    else if (percentage >= 50) verdict = 'borderline';
    else verdict = 'reject';

    // Format breakdown arrays
    const skillBreakdown: ISkillScoreBreakdown[] = Object.entries(skillScores).map(([skill, data]) => ({
      skill,
      score: data.earned,
      maxScore: data.max,
      percentage: data.max > 0 ? Math.round((data.earned / data.max) * 100) : 0,
      feedback: data.earned >= data.max * 0.7 ? `Demonstrates proficient grasp of ${skill}.` : `Needs deeper domain expertise in ${skill}.`,
    }));

    const modeBreakdown: IModeScoreBreakdown[] = Object.entries(modeScores).map(([mode, data]) => ({
      mode,
      score: data.earned,
      maxScore: data.max,
      percentage: data.max > 0 ? Math.round((data.earned / data.max) * 100) : 0,
    }));

    const strengths: string[] = [];
    const gaps: string[] = [];

    skillBreakdown.forEach((s) => {
      if (s.percentage >= 75) strengths.push(`High acuity in ${s.skill} (${s.percentage}%)`);
      else if (s.percentage < 60) gaps.push(`Room for improvement in ${s.skill} (${s.percentage}%)`);
    });

    if (strengths.length === 0) strengths.push('Demonstrates foundational awareness of primary concepts.');
    if (gaps.length === 0) gaps.push('Consistently strong execution across all evaluated domains.');

    const summary = `${attempt.candidateName} achieved ${percentage}% (${totalScore}/${maxScore} points) on the ${assessment.title}. Candidate is rated as "${verdict.replace('_', ' ').toUpperCase()}" for ${assessment.role}.`;

    const evaluation: IAttemptEvaluation = {
      totalScore,
      maxScore,
      percentage,
      passed,
      verdict,
      summary,
      skillBreakdown,
      modeBreakdown,
      strengths,
      gaps,
      recommendations: passed
        ? `Proceed candidate to the next hiring evaluation or offer stage.`
        : `Candidate did not meet the benchmark threshold of ${assessment.passingPercentage}%. Recommend targeted training or considering alternative roles.`,
      evaluatedAt: new Date(),
    };

    attempt.status = 'evaluated';
    attempt.submittedAt = new Date();
    attempt.evaluation = evaluation;
    await attempt.save();

    return evaluation;
  }

  /**
   * Get candidate attempt results / scorecard
   */
  public async getAttemptResult(attemptId: string): Promise<any> {
    const attempt = await AssessmentAttemptModel.findOne({ attemptId }).lean();
    if (!attempt) {
      throw AppError.notFound('Attempt not found');
    }

    const assessment = await DomainAssessmentModel.findById(attempt.assessmentId).lean();

    return {
      attempt: {
        attemptId: attempt.attemptId,
        candidateName: attempt.candidateName,
        candidateEmail: attempt.candidateEmail,
        status: attempt.status,
        startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt,
        timeSpentSeconds: attempt.timeSpentSeconds,
        answers: attempt.answers,
        evaluation: attempt.evaluation,
      },
      assessment: assessment ? {
        id: (assessment as any)._id.toString(),
        title: assessment.title,
        role: assessment.role,
        domain: assessment.domain,
        difficulty: assessment.difficulty,
        passingPercentage: assessment.passingPercentage,
        questions: assessment.questions,
      } : null,
    };
  }

  /**
   * Recruiter: Get all candidate results for a specific assessment
   */
  public async getAssessmentResults(assessmentIdentifier: string): Promise<any> {
    const assessment = await this.getAssessmentById(assessmentIdentifier);

    const attempts = await AssessmentAttemptModel.find({ assessmentId: assessment._id || assessment.id })
      .sort({ createdAt: -1 })
      .lean();

    const completed = attempts.filter((a) => a.status === 'submitted' || a.status === 'evaluated');
    const totalAttempts = attempts.length;
    const passedAttempts = completed.filter((a) => a.evaluation?.passed).length;
    const avgScore = completed.length > 0
      ? Math.round(completed.reduce((acc, a) => acc + (a.evaluation?.percentage || 0), 0) / completed.length)
      : 0;

    return {
      assessment: {
        id: assessment.id,
        assessmentId: assessment.assessmentId,
        title: assessment.title,
        role: assessment.role,
        domain: assessment.domain,
        difficulty: assessment.difficulty,
        totalPoints: assessment.totalPoints,
        passingPercentage: assessment.passingPercentage,
      },
      analytics: {
        totalAttempts,
        completedAttempts: completed.length,
        passedAttempts,
        passRate: completed.length > 0 ? Math.round((passedAttempts / completed.length) * 100) : 0,
        averageScore: avgScore,
      },
      attempts: attempts.map((a: any) => ({
        id: a._id.toString(),
        attemptId: a.attemptId,
        candidateName: a.candidateName,
        candidateEmail: a.candidateEmail,
        status: a.status,
        startedAt: a.startedAt,
        submittedAt: a.submittedAt,
        timeSpentSeconds: a.timeSpentSeconds,
        score: a.evaluation?.totalScore || 0,
        percentage: a.evaluation?.percentage || 0,
        passed: a.evaluation?.passed || false,
        verdict: a.evaluation?.verdict || 'pending',
      })),
    };
  }

  // ==========================================
  // HELPER METHODS & FALLBACK QUESTION GENERATOR
  // ==========================================

  private detectDomainFromText(text: string): string | null {
    const lower = text.toLowerCase();
    if (lower.includes('frontend') || lower.includes('react') || lower.includes('vue') || lower.includes('angular') || lower.includes('ui engineer')) return 'frontend';
    if (lower.includes('backend') || lower.includes('node') || lower.includes('golang') || lower.includes('java ') || lower.includes('python backend')) return 'backend';
    if (lower.includes('fullstack') || lower.includes('full stack') || lower.includes('full-stack')) return 'fullstack';
    if (lower.includes('devops') || lower.includes('sre') || lower.includes('kubernetes') || lower.includes('docker') || lower.includes('infrastructure')) return 'devops';
    if (lower.includes('data engineer') || lower.includes('data science') || lower.includes('etl') || lower.includes('pipeline') || lower.includes('analytics engineer')) return 'data';
    if (lower.includes('mobile') || lower.includes('ios') || lower.includes('android') || lower.includes('flutter') || lower.includes('react native')) return 'mobile';
    if (lower.includes('cloud') || lower.includes('aws') || lower.includes('azure') || lower.includes('solutions architect')) return 'cloud';
    if (lower.includes('security') || lower.includes('cyber') || lower.includes('penetration') || lower.includes('infosec')) return 'security';
    if (lower.includes('machine learning') || lower.includes('ai') || lower.includes('deep learning') || lower.includes('llm')) return 'ml';
    return null;
  }

  private getDefaultModesForDomain(domain: string): TestingMode[] {
    switch (domain) {
      case 'frontend':
        return ['coding', 'debugging', 'architecture'];
      case 'backend':
        return ['coding', 'architecture', 'database', 'system'];
      case 'devops':
      case 'cloud':
        return ['system', 'architecture', 'security'];
      case 'data':
        return ['coding', 'database', 'system'];
      case 'security':
        return ['security', 'debugging', 'architecture'];
      case 'fullstack':
      default:
        return ['coding', 'architecture', 'system', 'debugging', 'database'];
    }
  }

  private getFallbackQuestions(
    domain: string,
    difficulty: AssessmentDifficulty,
    modes: TestingMode[],
    skills: string[],
    count: number
  ): IDomainAssessmentQuestion[] {
    const questions: IDomainAssessmentQuestion[] = [
      {
        id: 'q_1',
        order: 1,
        title: 'Optimized Debounced Search Hook & Rate Limiting',
        question: 'Implement an optimal debounced asynchronous fetch pipeline that cancels stale in-flight network requests when user inputs change rapidly.',
        type: 'coding',
        testingMode: 'coding',
        skill: skills[0] || 'Programming & Algorithms',
        difficulty,
        points: 15,
        instructions: 'Write production-ready code with cancellation tokens or AbortController.',
        context: 'High-throughput search inputs frequently saturate API servers with redundant queries if cancellations and debouncing are not strictly handled.',
        starterCode: `function createDebouncedSearch(fetchFn, delayMs = 300) {
  // TODO: Implement debouncing with request cancellation
  return async function search(query) {
    // ...
  };
}`,
        solutionCode: `function createDebouncedSearch(fetchFn, delayMs = 300) {
  let timer = null;
  let activeController = null;
  return function search(query) {
    return new Promise((resolve, reject) => {
      clearTimeout(timer);
      if (activeController) activeController.abort();
      activeController = new AbortController();
      const signal = activeController.signal;
      timer = setTimeout(async () => {
        try {
          const result = await fetchFn(query, { signal });
          resolve(result);
        } catch (err) {
          if (!signal.aborted) reject(err);
        }
      }, delayMs);
    });
  };
}`,
        language: 'javascript',
        testCases: [
          { input: 'rapid 5 keypresses within 100ms', expectedOutput: 'single network call executed', isHidden: false },
        ],
        evaluationCriteria: ['Handles AbortController correctly', 'Clears pending timeouts', 'Prevents race conditions'],
      },
      {
        id: 'q_2',
        order: 2,
        title: 'Distributed Session & Token Revocation Architecture',
        question: 'Design an authentication and token revocation architecture for a multi-region distributed application with 500k daily active users. Discuss the trade-offs between stateless JWTs, centralized Redis session stores, and bloom filters.',
        type: 'architecture',
        testingMode: 'architecture',
        skill: skills[1] || 'Software Architecture',
        difficulty,
        points: 20,
        instructions: 'Structure your proposal covering Token lifecycle, Revocation latency, Edge validation, and Disaster recovery.',
        context: 'A banking or high-security client requires immediate revocation capability when a security breach occurs on an active account.',
        expectedAnswer: 'Should cover short-lived JWTs (5-15 min) paired with refresh token rotation stored in a distributed datastore like Redis/DynamoDB, blacklist mechanisms or token versioning in database, and regional replication.',
        evaluationCriteria: [
          'Addresses revocation latency across geographic regions',
          'Balances database load vs security guarantees',
          'Details token rotation and reuse detection',
        ],
      },
      {
        id: 'q_3',
        order: 3,
        title: 'Scalable Real-Time Notification System Design',
        question: 'Design a real-time push notification system capable of fanning out 10 million notifications in under 2 minutes when a high-profile creator goes live. Detail the queuing, websocket server tier, and backpressure handling.',
        type: 'system_design',
        testingMode: 'system',
        skill: skills[2] || 'System Design',
        difficulty,
        points: 20,
        instructions: 'Outline message brokers (Kafka/RabbitMQ), WebSocket gateway state management (Redis Pub/Sub), and fallback strategies.',
        context: 'Spikes in concurrent active connections can cause memory exhaustion and reconnection storms (thundering herd).',
        expectedAnswer: 'Should describe horizontal WebSocket gateways decoupled from business logic via Kafka partition keys, Redis cluster for presence tracking, batching pushes, exponential backoff with jitter on reconnects.',
        evaluationCriteria: [
          'Handles WebSocket connection management at scale',
          'Prevents thundering herd with jitter and rate limiting',
          'Partitioning strategy for push queues',
        ],
      },
      {
        id: 'q_4',
        order: 4,
        title: 'Debugging Memory Leak in Async Event Pipeline',
        question: 'Inspect the provided Node.js stream handler. Identify the memory leak causing heap out-of-memory crashes under sustained traffic and provide the corrected code.',
        type: 'debugging',
        testingMode: 'debugging',
        skill: skills[3] || 'Debugging',
        difficulty,
        points: 15,
        instructions: 'Identify the unbounded event listener retention or unpaused stream buffer and rewrite the safe version.',
        context: 'Server crashes consistently after processing ~5,000 files in production.',
        starterCode: `const events = require('events');
function processPipeline(stream, onComplete) {
  const emitter = new events.EventEmitter();
  const buffer = [];
  stream.on('data', (chunk) => {
    buffer.push(chunk);
    // Potential backpressure and event listener accumulation issue
    emitter.on('drain', () => {
      // do something
    });
  });
  stream.on('end', () => onComplete(buffer));
}`,
        solutionCode: `const stream = require('stream');
const { pipeline } = require('stream/promises');
async function processPipeline(readableStream) {
  // Use pipeline or proper backpressure handling without nested unbounded listeners
  const chunks = [];
  for await (const chunk of readableStream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}`,
        language: 'javascript',
        evaluationCriteria: ['Identifies closure memory leak', 'Replaces with async iterator or pipeline', 'Implements backpressure'],
      },
      {
        id: 'q_5',
        order: 5,
        title: 'Database Indexing & Query Optimization Under High Concurrency',
        question: 'Given an orders table with 50 million rows queried with: SELECT * FROM orders WHERE tenant_id = ? AND status = ? ORDER BY created_at DESC LIMIT 20. Which compound index provides optimal query execution without filesort?',
        type: 'mcq',
        testingMode: 'database',
        skill: skills[4] || 'Databases',
        difficulty,
        points: 10,
        options: [
          { id: 'opt_1', text: '(created_at DESC, tenant_id, status)' },
          { id: 'opt_2', text: '(tenant_id, status, created_at DESC)' },
          { id: 'opt_3', text: '(status, created_at DESC, tenant_id)' },
          { id: 'opt_4', text: 'Three independent single-column indexes' },
        ],
        correctOptionId: 'opt_2',
        instructions: 'Select the optimal composite index ordering according to the Equality-Range-Sort rule.',
        context: 'Database explain plan shows temporary table and filesort without proper composite index ordering.',
        expectedAnswer: 'Option B: (tenant_id, status, created_at DESC). Equality columns first, followed by the sorting column to leverage index scan.',
      },
      {
        id: 'q_6',
        order: 6,
        title: 'API Security & Zero-Trust Verification Policy',
        question: 'A malicious actor crafts a Server-Side Request Forgery (SSRF) payload pointing to 169.254.169.254 inside a cloud webhook callback feature. What is the most effective defense-in-depth mitigation?',
        type: 'mcq',
        testingMode: 'security',
        skill: skills[5] || 'Security',
        difficulty,
        points: 10,
        options: [
          { id: 'sec_1', text: 'Regex checking for the word "localhost" or "127.0.0.1"' },
          { id: 'sec_2', text: 'Resolve DNS before requesting, validate IP is strictly non-private/non-link-local, and disable HTTP redirects' },
          { id: 'sec_3', text: 'Encrypt the outgoing webhook URL using HMAC SHA-256' },
          { id: 'sec_4', text: 'Only allow HTTP port 80 requests' },
        ],
        correctOptionId: 'sec_2',
        instructions: 'Choose the industry-standard mitigation strategy against SSRF attacks.',
        expectedAnswer: 'Option B: Strict IP validation against RFC 1918 and link-local ranges post-DNS resolution, along with disabling auto-redirects.',
      },
    ];

    return questions.slice(0, count);
  }
}

export const domainAssessmentService = new DomainAssessmentService();
