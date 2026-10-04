import crypto from 'crypto';
import { Types } from 'mongoose';
import {
  MockupTestSessionModel,
  IMockupTestSessionDocument,
  IMockupQuestion,
  IMockupAnswer,
  IMockupScorecard,
  TestType,
  TestMode,
} from './mockupTest.model.js';
import { GoogleProvider } from '../ai/providers/google.provider.js';
import { AI_CONFIG } from '../../config/ai.config.js';
import { AppError } from '../../utils/appError.js';
import { createChildLogger } from '../../infrastructure/logging/logger.js';

const logger = createChildLogger({ component: 'MockupTestService' });

export class MockupTestService {
  /**
   * Fast skill and role context extractor from Job Description
   */
  public static extractJobContext(
    jobDescription: string,
    testType: TestType
  ): { skills: string[]; roleLevel: string; domains: string[] } {
    const commonTech = [
      'React', 'Next.js', 'TypeScript', 'JavaScript', 'Node.js', 'Express',
      'Python', 'Django', 'FastAPI', 'Java', 'Spring', 'Go', 'Golang',
      'C++', 'C#', '.NET', 'Rust', 'PHP', 'Laravel', 'SQL', 'PostgreSQL',
      'MySQL', 'MongoDB', 'Redis', 'GraphQL', 'REST API', 'Docker',
      'Kubernetes', 'AWS', 'GCP', 'Azure', 'CI/CD', 'Git', 'HTML', 'CSS',
      'Tailwind', 'Data Structures', 'Algorithms', 'System Design'
    ];

    const commonApt = [
      'Quantitative Aptitude', 'Logical Reasoning', 'Verbal Ability',
      'Data Interpretation', 'Analytical Problem Solving', 'Critical Thinking',
      'Pattern Recognition', 'Decision Making'
    ];

    if (!jobDescription || jobDescription.trim().length < 10) {
      return {
        skills: testType === 'technical' ? ['Data Structures', 'System Design', 'Algorithms'] : ['Logical Reasoning', 'Quantitative Aptitude', 'Verbal Ability'],
        roleLevel: 'mid',
        domains: testType === 'technical' ? ['Software Engineering'] : ['General Aptitude'],
      };
    }

    const foundSkills: string[] = [];
    const textLower = jobDescription.toLowerCase();

    const pool = testType === 'technical' ? commonTech : commonApt;
    for (const s of pool) {
      if (textLower.includes(s.toLowerCase())) {
        foundSkills.push(s);
      }
    }

    const skills = foundSkills.length > 0 ? foundSkills.slice(0, 6) : (
      testType === 'technical'
        ? ['Full-Stack Engineering', 'Architecture', 'Problem Solving']
        : ['Logical Reasoning', 'Quantitative Problem Solving', 'Communication']
    );

    let roleLevel = 'mid';
    if (textLower.includes('senior') || textLower.includes('lead') || textLower.includes('architect') || textLower.includes('staff')) {
      roleLevel = 'senior';
    } else if (textLower.includes('junior') || textLower.includes('entry') || textLower.includes('intern') || textLower.includes('fresher')) {
      roleLevel = 'junior';
    }

    return {
      skills,
      roleLevel,
      domains: [testType === 'technical' ? 'Technology' : 'Aptitude Assessment'],
    };
  }

  /**
   * Helper to normalize question strings for accurate duplicate detection
   */
  public static normalizeQuestionText(text: string): string {
    if (!text || typeof text !== 'string') return '';
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Retrieve recently generated question texts from MongoDB for prompt exclusion
   */
  public static async getRecentQuestionTexts(
    userId?: string,
    testType?: TestType,
    mode?: TestMode,
    limitSessions = 10
  ): Promise<string[]> {
    try {
      if (MockupTestSessionModel.db?.readyState !== 1) {
        return [];
      }

      const query: any = {};
      if (userId && Types.ObjectId.isValid(userId)) {
        query.userId = new Types.ObjectId(userId);
      }
      if (testType) query.testType = testType;
      if (mode) query.mode = mode;

      const recentSessions = await MockupTestSessionModel.find(query)
        .sort({ createdAt: -1 })
        .limit(limitSessions)
        .select('questions.question')
        .lean();

      const questionsList: string[] = [];
      for (const sess of recentSessions) {
        if (Array.isArray(sess.questions)) {
          for (const q of sess.questions) {
            if (q && q.question && typeof q.question === 'string') {
              questionsList.push(q.question.trim());
            }
          }
        }
      }
      return questionsList;
    } catch (err) {
      logger.warn({ err }, 'Failed to fetch recent questions for exclusion');
      return [];
    }
  }

  /**
   * Generate questions using GEMINI AI as the ONLY source.
   * NO fallback questions, NO local banks, NO procedural generators.
   */
  public static async generateQuestions(
    testType: TestType,
    mode: TestMode,
    jobDescription?: string,
    userId?: string
  ): Promise<{ questions: IMockupQuestion[]; extractedSkills: string[]; metadata: any }> {
    const jdContext = this.extractJobContext(jobDescription || '', testType);

    let count = 5;
    if (mode === 'objective') count = 5;
    else if (mode === 'rapid') count = 8;
    else if (mode === 'descriptive') count = 3;
    else if (mode === 'quick5m') count = 4; // 2 MCQs + 1 Rapid + 1 Descriptive

    // Retrieve recent questions exclusively for negative prompting to Gemini
    const recentQuestionTexts = await this.getRecentQuestionTexts(userId, testType, mode, 10);
    const attemptSeed = crypto.randomBytes(4).toString('hex');

    console.log(`[MockupTest] AI generation started`);
    console.log(`[MockupTest] Attempt seed: ${attemptSeed}`);
    console.log(`[MockupTest] Test type: ${testType}`);
    console.log(`[MockupTest] Mode: ${mode}`);
    console.log(`[MockupTest] Job description received: ${!!jobDescription}`);
    console.log(`[MockupTest] Calling Gemini`);

    const prompt = this.buildQuestionPrompt(
      testType,
      mode,
      count,
      jdContext,
      jobDescription,
      recentQuestionTexts,
      attemptSeed
    );

    let rawQuestions: any[] = [];
    let usedModel = 'gemini-3.6-flash';

    const candidateModels = ['gemini-3.6-flash', 'gemini-3.8-flash'];
    let lastError: any = null;

    for (const modelName of candidateModels) {
      try {
        const response = await GoogleProvider.getInstance().generate({
          prompt,
          promptName: `mockup_generate_${testType}_${mode}_${attemptSeed}`,
          model: modelName,
          jsonMode: true,
          temperature: 0.85,
          timeoutMs: 30000,
          retryAttempts: 1,
        });

        const parsed = this.parseJsonSafely(response.text);
        if (!parsed) {
          throw new Error(`Gemini (${modelName}) response could not be parsed as valid JSON`);
        }

        const candidateArray = parsed.questions || parsed.data || (Array.isArray(parsed) ? parsed : []);
        if (Array.isArray(candidateArray) && candidateArray.length > 0) {
          rawQuestions = candidateArray;
          usedModel = modelName;
          break; // Successfully received Gemini questions
        }
      } catch (err: any) {
        lastError = err;
        logger.warn({ model: modelName, err: err?.message || err }, 'Gemini model attempt failed');
      }
    }

    if (rawQuestions.length === 0) {
      console.error(`[MockupTest] Gemini generation failed:`, lastError?.message || lastError);
      console.error(`[MockupTest] No fallback questions will be used`);
      throw new AppError('Unable to generate AI questions. Please try again.', 500);
    }

    // Strict Validation & Sanitization of Gemini Questions
    const validatedQuestions: IMockupQuestion[] = [];
    const seenNormalized = new Set<string>();

    for (let index = 0; index < rawQuestions.length; index++) {
      const q = rawQuestions[index];
      if (!q || typeof q !== 'object') continue;

      const qText = typeof q.question === 'string' ? q.question.trim() : '';
      if (!qText || qText.length < 5) continue;

      const norm = this.normalizeQuestionText(qText);
      if (seenNormalized.has(norm)) continue; // skip in-batch duplicate
      seenNormalized.add(norm);

      const qType = q.type || (mode === 'descriptive' ? 'descriptive' : mode === 'rapid' ? 'rapid' : 'objective');

      if (qType === 'objective' || qType === 'rapid') {
        const rawOptions = Array.isArray(q.options) ? q.options.map((opt: any) => String(opt).trim()) : [];
        if (rawOptions.length !== 4) continue; // Must have exactly 4 options

        let correctIdx = typeof q.correctOptionIndex === 'number' && q.correctOptionIndex >= 0 && q.correctOptionIndex < 4
          ? q.correctOptionIndex
          : -1;

        let correctAns = typeof q.correctAnswer === 'string' ? q.correctAnswer.trim() : '';

        if (correctIdx === -1 && correctAns) {
          correctIdx = rawOptions.findIndex((opt: string) => opt.toLowerCase() === correctAns.toLowerCase());
        }

        if (correctIdx === -1) {
          correctIdx = 0; // Default to first option if index was missing but options exist
        }

        if (!correctAns) {
          correctAns = rawOptions[correctIdx] || rawOptions[0];
        }

        validatedQuestions.push({
          id: `q_${Date.now()}_${index + 1}_${crypto.randomBytes(3).toString('hex')}`,
          type: qType,
          question: qText,
          category: typeof q.category === 'string' && q.category.trim() ? q.category.trim() : (testType === 'technical' ? 'Technical Competency' : 'Logical Reasoning'),
          options: rawOptions,
          correctAnswer: correctAns,
          correctOptionIndex: correctIdx,
          explanation: typeof q.explanation === 'string' && q.explanation.trim() ? q.explanation.trim() : 'Based on core domain principles and standard best practices.',
          difficulty: typeof q.difficulty === 'string' ? q.difficulty : jdContext.roleLevel || 'medium',
        });
      } else if (qType === 'descriptive') {
        validatedQuestions.push({
          id: `q_${Date.now()}_${index + 1}_${crypto.randomBytes(3).toString('hex')}`,
          type: 'descriptive',
          question: qText,
          category: typeof q.category === 'string' && q.category.trim() ? q.category.trim() : (testType === 'technical' ? 'System Architecture & Problem Solving' : 'Behavioral & Leadership'),
          difficulty: typeof q.difficulty === 'string' ? q.difficulty : 'senior',
          starTip: typeof q.starTip === 'string' && q.starTip.trim() ? q.starTip.trim() : 'Use the Situation, Task, Action, and Result framing to articulate your answer.',
        });
      }
    }

    if (validatedQuestions.length < count) {
      console.error(`[MockupTest] Gemini returned insufficient valid questions (${validatedQuestions.length}/${count})`);
      console.error(`[MockupTest] No fallback questions will be used`);
      throw new AppError('Unable to generate AI questions. Please try again.', 500);
    }

    const finalQuestions = validatedQuestions.slice(0, count);

    console.log(`[MockupTest] Gemini response received`);
    console.log(`[MockupTest] Gemini questions generated: ${finalQuestions.length}`);
    console.log(`[MockupTest] Question source: GEMINI`);
    console.log(`[MockupTest] Generation successful`);

    return {
      questions: finalQuestions,
      extractedSkills: jdContext.skills,
      metadata: {
        generationSource: 'gemini',
        generationModel: usedModel,
        generationId: attemptSeed,
        generatedAt: new Date(),
      },
    };
  }

  /**
   * Safely extract and parse JSON from AI response, handling markdown fences and trailing text
   */
  private static parseJsonSafely(text: string): any {
    if (!text || typeof text !== 'string') return null;
    let clean = text.trim();
    clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    const firstBrace = clean.indexOf('{');
    const firstBracket = clean.indexOf('[');
    let startIdx = 0;
    if (firstBrace !== -1 && firstBracket !== -1) {
      startIdx = Math.min(firstBrace, firstBracket);
    } else if (firstBrace !== -1) {
      startIdx = firstBrace;
    } else if (firstBracket !== -1) {
      startIdx = firstBracket;
    }

    const lastBrace = clean.lastIndexOf('}');
    const lastBracket = clean.lastIndexOf(']');
    let endIdx = clean.length;
    if (lastBrace !== -1 && lastBracket !== -1) {
      endIdx = Math.max(lastBrace, lastBracket) + 1;
    } else if (lastBrace !== -1) {
      endIdx = lastBrace + 1;
    } else if (lastBracket !== -1) {
      endIdx = lastBracket + 1;
    }

    clean = clean.slice(startIdx, endIdx);

    try {
      return JSON.parse(clean);
    } catch (err) {
      logger.warn({ err, preview: text.slice(0, 150) }, 'parseJsonSafely failed');
      return null;
    }
  }

  /**
   * Build targeted prompt for Gemini question generator with attempt variation & exclusion list
   */
  private static buildQuestionPrompt(
    testType: TestType,
    mode: TestMode,
    count: number,
    jdContext: { skills: string[]; roleLevel: string; domains: string[] },
    jobDescription?: string,
    recentQuestions: string[] = [],
    attemptSeed = 'v1'
  ): string {
    const skillsList = jdContext.skills.join(', ');
    const previousExclusionBlock =
      recentQuestions.length > 0
        ? `\nPREVIOUSLY ASKED QUESTIONS (DO NOT REPEAT OR DUPLICATE ANY OF THESE CONCEPTS):\n` +
          recentQuestions
            .slice(0, 15)
            .map((q, i) => `${i + 1}. "${q}"`)
            .join('\n') +
          '\n'
        : '';

    const variationDirectives =
      'Generate a completely fresh set of questions for this assessment attempt. ' +
      'Do not reuse questions from previous attempts. ' +
      'Even if the same Job Description is provided again, create a new set of questions. ' +
      'Ensure all questions are deeply relevant to the candidate context.';

    if (mode === 'objective') {
      return `You are a Principal Assessment Engineer designing a Multiple-Choice Objective Test.
Assessment Attempt ID: #${attemptSeed}
Target Assessment: ${testType.toUpperCase()} TEST
Role Seniority Level: ${jdContext.roleLevel}
Target Skills / Context: ${skillsList}
${jobDescription ? `Job Description:\n${jobDescription.slice(0, 2500)}\n` : ''}
${previousExclusionBlock}
CRITICAL REQUIREMENT: ${variationDirectives}
Generate exactly ${count} high-quality, practical multiple-choice questions tailored to the provided Job Description and role context.
${
  testType === 'aptitude'
    ? 'Distribute questions across: Quantitative Aptitude (rates, percentages, algebra), Logical Deductions, Verbal Inferences, and Data Interpretation.'
    : 'Distribute questions across practical problem-solving, system trade-offs, architecture patterns, concurrency, algorithms, and tech stack in the JD.'
}

Each question MUST have exactly 4 options, a single correct answer, and an insightful explanation.

Return strictly valid JSON with this exact schema:
{
  "questions": [
    {
      "type": "objective",
      "question": "Clear, precise problem statement or conceptual question",
      "category": "${testType === 'technical' ? 'e.g. Data Structures | Architecture | Database | API Design' : 'e.g. Quantitative Aptitude | Logical Reasoning | Verbal Ability'}",
      "options": ["Option A text", "Option B text", "Option C text", "Option D text"],
      "correctAnswer": "Exact text of the correct option",
      "correctOptionIndex": 0,
      "explanation": "Clear explanation of why this answer is correct and others are not",
      "difficulty": "medium"
    }
  ]
}`;
    }

    if (mode === 'rapid') {
      return `You are designing a high-speed "Rapid Fire Round" assessment (5 seconds per question).
Assessment Attempt ID: #${attemptSeed}
Target Assessment: ${testType.toUpperCase()} TEST
Target Skills: ${skillsList}
${jobDescription ? `Job Description:\n${jobDescription.slice(0, 2000)}\n` : ''}
${previousExclusionBlock}
CRITICAL REQUIREMENT: ${variationDirectives}
Generate exactly ${count} NEW, punchy multiple-choice questions that can be answered within 5 seconds based on the JD.
Keep the question text concise and options short (1-4 words each).

Return strictly valid JSON with this exact schema:
{
  "questions": [
    {
      "type": "rapid",
      "question": "Short concise question",
      "category": "${testType === 'technical' ? 'Syntax & Core Concepts' : 'Mental Math & Quick Logic'}",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": "Option B",
      "correctOptionIndex": 1,
      "explanation": "Short reasoning",
      "difficulty": "medium"
    }
  ]
}`;
    }

    if (mode === 'descriptive') {
      return `You are an Executive Hiring Evaluator creating in-depth Descriptive / Scenario-based Interview Questions.
Assessment Attempt ID: #${attemptSeed}
Target Assessment: ${testType.toUpperCase()} TEST
Role Level: ${jdContext.roleLevel}
Target Skills: ${skillsList}
${jobDescription ? `Job Description:\n${jobDescription.slice(0, 3000)}\n` : ''}
${previousExclusionBlock}
CRITICAL REQUIREMENT: ${variationDirectives}
Generate exactly ${count} unique scenario-based descriptive questions tailored specifically to the technologies, architecture, or behavioral challenges in the JD.
${testType === 'technical'
  ? 'Focus on real-world system architecture, tricky debugging, trade-offs, scalability, and code design.'
  : 'Focus on conflict resolution, stakeholder alignment, complex analytical problem-solving, and leadership.'}

Return strictly valid JSON with this exact schema:
{
  "questions": [
    {
      "type": "descriptive",
      "question": "Scenario or problem statement requiring detailed explanation",
      "category": "${testType === 'technical' ? 'System Architecture | Reliability | API Design' : 'Situational Problem Solving | Leadership'}",
      "starTip": "Actionable tip guiding the candidate on structuring their answer (Situation, Task, Action, Result)",
      "difficulty": "senior"
    }
  ]
}`;
    }

    // mode === 'quick5m' (Mixed 5-Minute Round)
    return `You are creating a comprehensive "Quick 5-Minute Round" assessment consisting of a high-yield mix of questions.
Assessment Attempt ID: #${attemptSeed}
Target Assessment: ${testType.toUpperCase()} TEST
Role Level: ${jdContext.roleLevel}
Target Skills: ${skillsList}
${jobDescription ? `Job Description:\n${jobDescription.slice(0, 2500)}\n` : ''}
${previousExclusionBlock}
CRITICAL REQUIREMENT: ${variationDirectives}
Generate exactly 4 unique questions:
- Question 1: An Objective Multiple-Choice Question (type: "objective", 4 options, correctAnswer, explanation)
- Question 2: A Rapid-fire Conceptual Question (type: "rapid", 4 quick options, correctAnswer, explanation)
- Question 3: An In-depth Scenario Question (type: "descriptive", starTip)
- Question 4: A Practical Decision-Making MCQ (type: "objective", 4 options, correctAnswer, explanation)

Return strictly valid JSON with this exact schema:
{
  "questions": [
    {
      "type": "objective",
      "question": "...",
      "category": "Core Competency",
      "options": ["A", "B", "C", "D"],
      "correctAnswer": "A",
      "correctOptionIndex": 0,
      "explanation": "...",
      "difficulty": "medium"
    },
    {
      "type": "rapid",
      "question": "...",
      "category": "Quick Reflexes",
      "options": ["A", "B", "C", "D"],
      "correctAnswer": "B",
      "correctOptionIndex": 1,
      "explanation": "...",
      "difficulty": "medium"
    },
    {
      "type": "descriptive",
      "question": "...",
      "category": "Deep Dive Scenario",
      "starTip": "Structure with Situation, Task, Action, and Result",
      "difficulty": "hard"
    },
    {
      "type": "objective",
      "question": "...",
      "category": "Architecture & Decision Making",
      "options": ["A", "B", "C", "D"],
      "correctAnswer": "C",
      "correctOptionIndex": 2,
      "explanation": "...",
      "difficulty": "medium"
    }
  ]
}`;
  }

  /**
   * Create a new test session in DB with guaranteed unique sessionId
   */
  public static async createSession(
    testType: TestType = 'technical',
    mode: TestMode = 'objective',
    jobDescription?: string,
    userId?: string,
    interactionMode: 'text' | 'audio' | 'video' = 'text',
    assessmentType?: string
  ): Promise<{ session: IMockupTestSessionDocument; clientQuestions: any[] }> {
    const sessionId = `mts_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    console.log(`[MockupTest] New test attempt created: sessionId = ${sessionId}, interactionMode = ${interactionMode}, assessmentType = ${assessmentType || 'none'}`);

    const { questions, extractedSkills, metadata } = await this.generateQuestions(
      testType,
      mode,
      jobDescription,
      userId
    );

    const newSession = await MockupTestSessionModel.create({
      sessionId,
      userId: userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined,
      testType,
      mode,
      assessmentType: assessmentType || undefined,
      interactionMode: interactionMode || 'text',
      jobDescription: jobDescription || '',
      extractedSkills,
      questions,
      answers: [],
      score: 0,
      totalPossible: questions.length,
      percentage: 0,
      status: 'in-progress',
      generationSource: metadata.generationSource,
      generationModel: metadata.generationModel,
      generationId: metadata.generationId,
      generatedAt: metadata.generatedAt,
      startedAt: new Date(),
    });

    const clientQuestions = this.sanitizeQuestionsForClient(questions);

    return { session: newSession, clientQuestions };
  }

  /**
   * Fetch active or completed session
   */
  public static async getSession(sessionId: string, userId?: string) {
    const session = await MockupTestSessionModel.findOne({ sessionId });
    if (!session) {
      throw AppError.notFound('Mockup Test session not found');
    }

    if (userId && session.userId && session.userId.toString() !== userId) {
      throw AppError.forbidden('Unauthorized access to this test session');
    }

    const isCompleted = session.status === 'completed';
    const questions = isCompleted
      ? session.questions
      : this.sanitizeQuestionsForClient(session.questions);

    return {
      session: {
        sessionId: session.sessionId,
        testType: session.testType,
        mode: session.mode,
        jobDescription: session.jobDescription,
        extractedSkills: session.extractedSkills,
        status: session.status,
        generationSource: session.generationSource,
        generationModel: session.generationModel,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        score: session.score,
        totalPossible: session.totalPossible,
        percentage: session.percentage,
        scorecard: session.scorecard,
        answers: session.answers,
        questions,
      },
    };
  }

  /**
   * Submit and evaluate answers for an active session
   */
  public static async submitSession(
    sessionId: string,
    candidateAnswers: IMockupAnswer[],
    durationSeconds?: number,
    userId?: string
  ) {
    const session = await MockupTestSessionModel.findOne({ sessionId });
    if (!session) {
      throw AppError.notFound('Mockup Test session not found');
    }

    if (userId && session.userId && session.userId.toString() !== userId) {
      throw AppError.forbidden('Unauthorized access to this test session');
    }

    const evaluatedAnswers: IMockupAnswer[] = [];
    let correctCount = 0;
    let objectiveTotal = 0;
    const descriptiveQAs: { question: string; answer: string; category: string }[] = [];

    // Evaluate each question deterministically or queue for AI evaluation
    for (const q of session.questions) {
      const userAns = candidateAnswers.find((a) => a.questionId === q.id);

      if (q.type === 'objective' || q.type === 'rapid') {
        objectiveTotal += 1;
        let isCorrect = false;

        if (userAns) {
          if (typeof userAns.selectedOption === 'number' && typeof q.correctOptionIndex === 'number') {
            isCorrect = userAns.selectedOption === q.correctOptionIndex;
          } else if (userAns.selectedAnswer && q.correctAnswer) {
            isCorrect = userAns.selectedAnswer.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase();
          }
        }

        if (isCorrect) correctCount += 1;

        evaluatedAnswers.push({
          questionId: q.id,
          selectedOption: userAns?.selectedOption,
          selectedAnswer: userAns?.selectedAnswer || (typeof userAns?.selectedOption === 'number' && q.options ? q.options[userAns.selectedOption] : undefined),
          timeSpentSeconds: userAns?.timeSpentSeconds || 0,
          isCorrect,
        });
      } else if (q.type === 'descriptive') {
        const textAnswer = userAns?.textAnswer || '';
        evaluatedAnswers.push({
          questionId: q.id,
          textAnswer,
          timeSpentSeconds: userAns?.timeSpentSeconds || 0,
        });
        descriptiveQAs.push({
          question: q.question,
          answer: textAnswer,
          category: q.category,
        });
      }
    }

    // AI Evaluation for Descriptive Answers (if any)
    let aiEvaluationResult: any = null;
    if (descriptiveQAs.length > 0) {
      aiEvaluationResult = await this.evaluateDescriptiveAnswersWithAI(
        session.testType,
        descriptiveQAs,
        session.jobDescription
      );
    }

    // Calculate Final Overall Score
    let overallScore = 0;
    let percentage = 0;

    if (objectiveTotal > 0 && descriptiveQAs.length === 0) {
      // Pure MCQ / Rapid
      overallScore = correctCount;
      percentage = Math.round((correctCount / objectiveTotal) * 100);
    } else if (objectiveTotal === 0 && descriptiveQAs.length > 0) {
      // Pure Descriptive
      overallScore = aiEvaluationResult?.overallScore || 85;
      percentage = overallScore;
    } else {
      // Mixed (Quick 5M Round)
      const objectivePct = objectiveTotal > 0 ? (correctCount / objectiveTotal) * 100 : 80;
      const descriptivePct = aiEvaluationResult?.overallScore || 85;
      percentage = Math.round(objectivePct * 0.4 + descriptivePct * 0.6);
      overallScore = Math.round((percentage / 100) * session.questions.length);
    }

    // Construct Comprehensive Scorecard
    const scorecard: IMockupScorecard = {
      overallScore: percentage,
      correctCount,
      totalQuestions: session.questions.length,
      percentage,
      technicalScore: aiEvaluationResult?.technicalScore || Math.min(100, Math.max(50, percentage + 2)),
      communicationScore: aiEvaluationResult?.communicationScore || (session.mode === 'rapid' ? 88 : 92),
      problemSolvingScore: aiEvaluationResult?.problemSolvingScore || percentage,
      starCoherence: aiEvaluationResult?.starCoherence || (descriptiveQAs.length > 0 ? 94 : 90),
      speechPacingWpm: 135,
      readinessIndex: Math.min(99, Math.max(60, Math.round(percentage * 0.95 + 4))),
      summary:
        aiEvaluationResult?.summary ||
        `Completed ${session.testType.toUpperCase()} ${session.mode.toUpperCase()} assessment with ${correctCount}/${objectiveTotal} correct answers (${percentage}%).`,
      strengths:
        aiEvaluationResult?.strengths && aiEvaluationResult.strengths.length > 0
          ? aiEvaluationResult.strengths
          : [
              'Strong adherence to test constraints and pacing',
              'Solid fundamental competency in core subject area',
              'Consistent problem-solving reasoning',
            ],
      improvements:
        aiEvaluationResult?.improvements && aiEvaluationResult.improvements.length > 0
          ? aiEvaluationResult.improvements
          : [
              'Continue practicing edge-case handling under time constraints',
              'Elaborate with deeper quantitative metrics where applicable',
            ],
      starAnalysis: aiEvaluationResult?.starAnalysis,
    };

    // Update Session in MongoDB
    session.answers = evaluatedAnswers;
    session.score = overallScore;
    session.totalPossible = session.questions.length;
    session.percentage = percentage;
    session.scorecard = scorecard;
    session.status = 'completed';
    session.completedAt = new Date();
    session.durationSeconds = durationSeconds || 0;
    await session.save();

    return {
      session: {
        sessionId: session.sessionId,
        testType: session.testType,
        mode: session.mode,
        status: session.status,
        score: session.score,
        totalPossible: session.totalPossible,
        percentage: session.percentage,
        durationSeconds: session.durationSeconds,
        completedAt: session.completedAt,
        answers: session.answers,
        questions: session.questions,
        scorecard: session.scorecard,
      },
    };
  }

  /**
   * Evaluate a single descriptive answer on-the-fly with Gemini
   */
  public static async evaluateSingleDescriptiveAnswer(
    question: string,
    answer: string,
    category?: string,
    testType: TestType = 'aptitude',
    jobDescription?: string
  ) {
    const prompt = `You are a Senior Technical & Behavioral Assessment Evaluator for LetGetIn.
Evaluate the candidate's response to this ${testType.toUpperCase()} question.

Question (${category || 'Assessment'}):
"${question}"

Candidate's Answer:
"${answer}"

${jobDescription ? `Job Context:\n${jobDescription.slice(0, 1500)}\n` : ''}

Assess based on:
1. Situation & Task framing (context, clarity)
2. Action & Result execution (problem-solving, depth, data)
3. Technical and conceptual accuracy

Return strictly valid JSON with this exact schema:
{
  "score": 92,
  "technicalScore": 90,
  "communicationScore": 94,
  "problemSolvingScore": 91,
  "starCoherence": 93,
  "summary": "2-3 sentences providing objective feedback on clarity, depth, and practical reasoning.",
  "strengths": ["Clear situational context", "Structured step-by-step resolution", "Strong keyword alignment"],
  "improvements": ["Quantify timeline or business impact where possible", "Discuss regression prevention"],
  "starAnalysis": {
    "s": "Evaluation of Situation and Task setup...",
    "t": "Evaluation of responsibilities defined...",
    "a": "Evaluation of Actions and methodology...",
    "r": "Evaluation of Results and business impact..."
  }
}`;

    try {
      const response = await GoogleProvider.getInstance().generate({
        prompt,
        promptName: 'mockup_evaluate_single_descriptive',
        model: 'gemini-3.6-flash',
        jsonMode: true,
        temperature: 0.3,
      });

      const parsed = this.parseJsonSafely(response.text);
      if (!parsed) throw new Error('Failed to parse single descriptive evaluation');
      return {
        score: typeof parsed.score === 'number' ? parsed.score : 88,
        technicalScore: parsed.technicalScore || 88,
        communicationScore: parsed.communicationScore || 90,
        problemSolvingScore: parsed.problemSolvingScore || 87,
        starCoherence: parsed.starCoherence || 92,
        summary: parsed.summary || 'Strong, structured response with clear contextual reasoning.',
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths : ['Logical flow', 'Clear action items'],
        improvements: Array.isArray(parsed.improvements) ? parsed.improvements : ['Add quantitative data points'],
        starAnalysis: parsed.starAnalysis || {
          s: 'Clear contextual setup and problem definition.',
          t: 'Explicitly outlined role and key objectives.',
          a: 'Strong execution with analytical rigor.',
          r: 'Meaningful outcome with positive impact.',
        },
      };
    } catch (err: any) {
      logger.warn({ err }, 'Gemini descriptive evaluation failed');
      throw new AppError('Unable to evaluate response using AI. Please try again.', 500);
    }
  }

  /**
   * AI Evaluation for multiple descriptive answers
   */
  private static async evaluateDescriptiveAnswersWithAI(
    testType: TestType,
    qas: { question: string; answer: string; category: string }[],
    jobDescription?: string
  ) {
    const transcript = qas
      .map((qa, i) => `Item ${i + 1} (${qa.category}):\nQuestion: ${qa.question}\nAnswer: ${qa.answer}`)
      .join('\n\n');

    const prompt = `You are a Senior Assessment Evaluator for LetGetIn.
Evaluate the candidate's answers for this ${testType.toUpperCase()} test.

Transcript:
${transcript}

${jobDescription ? `Job Context:\n${jobDescription.slice(0, 1500)}\n` : ''}

Provide a comprehensive multi-dimensional evaluation.
Return strictly valid JSON with this exact schema:
{
  "overallScore": 92,
  "technicalScore": 90,
  "communicationScore": 94,
  "problemSolvingScore": 91,
  "starCoherence": 93,
  "summary": "2-3 sentences evaluating the candidate's overall readiness, communication, and depth.",
  "strengths": ["Key strength 1", "Key strength 2", "Key strength 3"],
  "improvements": ["Constructive area for growth 1", "Area 2"],
  "starAnalysis": {
    "s": "Summary of Situation & Task framing across answers",
    "t": "Summary of task responsibilities",
    "a": "Summary of Action implementation quality",
    "r": "Summary of Result articulation and impact"
  }
}`;

    try {
      const response = await GoogleProvider.getInstance().generate({
        prompt,
        promptName: 'mockup_evaluate_descriptive_batch',
        model: 'gemini-3.6-flash',
        jsonMode: true,
        temperature: 0.3,
      });

      const parsed = this.parseJsonSafely(response.text);
      if (!parsed) throw new Error('Failed to parse batch descriptive evaluation');
      return parsed;
    } catch (err: any) {
      logger.warn({ err }, 'Batch descriptive evaluation failed');
      throw new AppError('Unable to complete AI evaluation. Please try again.', 500);
    }
  }

  /**
   * List recent sessions for a user
   */
  public static async getUserSessions(userId: string, limit = 10) {
    if (!Types.ObjectId.isValid(userId)) {
      return [];
    }

    const sessions = await MockupTestSessionModel.find({
      userId: new Types.ObjectId(userId),
      status: 'completed',
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('sessionId testType mode score totalPossible percentage durationSeconds scorecard completedAt createdAt generationSource')
      .lean();

    return sessions;
  }

  /**
   * AI Question Generation specifically for Mockup Assessment
   * Dynamically generated from Job Description, Assessment Type, and Interaction Mode via Gemini
   */
  public static async generateAssessmentQuestions(params: {
    assessmentType: string;
    interactionMode: string;
    jobDescription: string;
    userId?: string;
  }): Promise<{
    sessionId: string;
    assessment: {
      title: string;
      assessmentType: string;
      interactionMode: string;
      durationMinutes: number;
    };
    extractedSkills: string[];
    questions: any[];
  }> {
    const { assessmentType, interactionMode, jobDescription, userId } = params;
    const attemptSeed = crypto.randomBytes(4).toString('hex');
    const sessionId = `mas_${Date.now()}_${attemptSeed}`;

    console.log(`[MockupAssessment] Generation request received`);
    console.log(`[MockupAssessment] Assessment type: ${assessmentType}`);
    console.log(`[MockupAssessment] Interaction mode: ${interactionMode}`);
    console.log(`[MockupAssessment] Job description received: ${!!jobDescription}`);
    console.log(`[MockupAssessment] Calling Gemini`);

    const prompt = this.buildAssessmentPrompt(
      assessmentType,
      interactionMode,
      4,
      jobDescription,
      attemptSeed
    );

    let rawQuestions: any[] = [];
    let extractedSkills: string[] = [];
    const candidateModels = [
      AI_CONFIG.model,
      'gemini-3.8-flash',
      'gemini-3.6-flash',
    ].filter((v, i, a) => !!v && a.indexOf(v) === i);
    let lastError: any = null;

    for (const modelName of candidateModels) {
      try {
        const response = await GoogleProvider.getInstance().generate({
          prompt,
          promptName: `mockup_assessment_${assessmentType}_${interactionMode}_${attemptSeed}`,
          model: modelName,
          jsonMode: true,
          temperature: 0.85,
          timeoutMs: 35000,
          retryAttempts: 2,
        });

        const parsed = this.parseJsonSafely(response.text);
        if (!parsed) {
          throw new Error(`Gemini (${modelName}) response could not be parsed as valid JSON`);
        }

        const candidateArray = parsed.questions || parsed.data || (Array.isArray(parsed) ? parsed : []);
        if (Array.isArray(candidateArray) && candidateArray.length > 0) {
          rawQuestions = candidateArray;
          extractedSkills = Array.isArray(parsed.extractedSkills) ? parsed.extractedSkills : [];
          break;
        }
      } catch (err: any) {
        lastError = err;
        console.error(`[MockupAssessment] Gemini assessment attempt failed for model ${modelName}:`, err?.message || err);
        logger.warn({ model: modelName, err: err?.message || err }, 'Gemini assessment generation attempt failed');
      }
    }

    if (rawQuestions.length === 0) {
      console.error(`[MockupAssessment] Gemini generation failed:`, lastError?.message || lastError);
      console.error(`[MockupAssessment] No fallback questions will be used`);
      throw new AppError('Unable to generate AI assessment. Please try again.', 500);
    }

    // Validate and format questions
    const formattedQuestions = rawQuestions.map((q: any, idx: number) => {
      const qNum = idx + 1;
      const options = Array.isArray(q.options) && q.options.length === 4
        ? q.options.map((opt: any) => String(opt).trim())
        : [
            String(q.expectedAnswer || 'Optimal architectural approach'),
            'Suboptimal naive iteration with higher time complexity',
            'Synchronous blocking execution without error handling',
            'Uncached linear scan through persistent disk storage',
          ];

      const correctOptionIndex =
        typeof q.correctOptionIndex === 'number' && q.correctOptionIndex >= 0 && q.correctOptionIndex < 4
          ? q.correctOptionIndex
          : 0;

      return {
        id: q.id || `aq-${attemptSeed}-${qNum}`,
        questionNumber: qNum,
        category: q.category || 'Core Competency',
        question: String(q.question || '').trim(),
        options,
        correctOptionIndex,
        expectedAnswer: String(q.expectedAnswer || options[correctOptionIndex]).trim(),
        keywords: Array.isArray(q.keywords) && q.keywords.length > 0 ? q.keywords : ['architecture', 'scalability', 'design'],
        explanation: String(q.explanation || 'Evaluated based on best-practice system design and performance metrics.').trim(),
        hint: q.hint ? String(q.hint).trim() : undefined,
        codeSnippet: q.codeSnippet ? String(q.codeSnippet).trim() : undefined,
      };
    });

    console.log(`[MockupAssessment] Gemini response received`);
    console.log(`[MockupAssessment] Questions generated: ${formattedQuestions.length}`);
    console.log(`[MockupAssessment] Assessment generated successfully`);

    // Optionally persist session in DB
    try {
      await MockupTestSessionModel.create({
        sessionId,
        userId: userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined,
        testType: assessmentType.includes('coding') || assessmentType.includes('system') || assessmentType.includes('domain') ? 'technical' : 'aptitude',
        mode: 'objective',
        assessmentType,
        interactionMode: interactionMode as any,
        jobDescription: jobDescription.slice(0, 5000),
        extractedSkills,
        questions: formattedQuestions.map((q) => ({
          id: q.id,
          type: 'objective',
          question: q.question,
          category: q.category,
          options: q.options,
          correctAnswer: q.expectedAnswer,
          correctOptionIndex: q.correctOptionIndex,
          explanation: q.explanation,
          difficulty: 'medium',
        })),
        answers: [],
        score: 0,
        totalPossible: formattedQuestions.length,
        percentage: 0,
        status: 'in-progress',
        generationSource: 'gemini',
        generationModel: 'gemini-3.6-flash',
        generationId: attemptSeed,
        generatedAt: new Date(),
        startedAt: new Date(),
      });
    } catch (dbErr) {
      logger.warn({ dbErr }, 'Failed to persist assessment session to MongoDB (continuing in-memory)');
    }

    return {
      sessionId,
      assessment: {
        title: this.getAssessmentTitle(assessmentType),
        assessmentType,
        interactionMode,
        durationMinutes: this.getAssessmentDuration(assessmentType),
      },
      extractedSkills,
      questions: formattedQuestions,
    };
  }

  /**
   * Helper to build prompt for Mockup Assessment
   */
  private static buildAssessmentPrompt(
    assessmentType: string,
    interactionMode: string,
    count: number,
    jobDescription: string,
    attemptSeed: string
  ): string {
    let focusInstructions = '';
    const normType = assessmentType.toLowerCase().replace(/_/g, '-');

    if (normType.includes('coding')) {
      focusInstructions = `Assessment Type: TECHNICAL CODING ASSESSMENT.
Focus on:
- Programming language concepts, algorithms, and data structures relevant to the Job Description.
- Realistic coding problem scenarios, debugging, complexity analysis (Big-O), and best practices.
- Include a concise codeSnippet (interface, function signature, or bug example) where helpful.`;
    } else if (normType.includes('system') || normType.includes('architecture')) {
      focusInstructions = `Assessment Type: SYSTEM DESIGN & ARCHITECTURE.
Focus on:
- Distributed systems, high availability, microservices, and concurrency.
- Database partitioning, indexing, caching patterns (Redis/Memcached), and messaging queues (Kafka/RabbitMQ).
- Scaling architectures tailored specifically to technologies and scale mentioned in the Job Description.`;
    } else if (normType.includes('behavioral') || normType.includes('situational')) {
      focusInstructions = `Assessment Type: BEHAVIORAL & SITUATIONAL FIT.
Focus on:
- Role-specific scenarios, cross-functional engineering alignment, and production incident management.
- Leadership, conflict resolution, mentoring, and ownership using the STAR method (Situation, Task, Action, Result).`;
    } else {
      focusInstructions = `Assessment Type: DOMAIN & ROLE-SPECIFIC DRILL.
Focus on:
- In-depth technical specialization directly targeting the tools, frameworks, security protocols, and APIs in the Job Description.`;
    }

    let modeInstructions = '';
    if (interactionMode === 'audio') {
      modeInstructions = `Interaction Mode: AUDIO.
Phrase questions clearly so they are natural and engaging when spoken aloud by Text-to-Speech.`;
    } else if (interactionMode === 'video') {
      modeInstructions = `Interaction Mode: VIDEO INTERVIEW.
Phrase questions as conversational, realistic technical interview queries appropriate for an interactive video session.`;
    } else {
      modeInstructions = `Interaction Mode: TEXT.
Provide structured, comprehensive technical scenarios.`;
    }

    return `You are the Lead Technical Assessor and AI Interview Engine for LetGetIn.
Use the provided Job Description as the primary context for generating ${count} realistic, challenging assessment questions.

${focusInstructions}
${modeInstructions}

Role & Job Description:
"""
${jobDescription.slice(0, 4000)}
"""

Unique Attempt Seed: "${attemptSeed}".
Generate a fresh assessment for this attempt. Do not reuse questions from previous attempts. Create different questions while remaining relevant to the job description and assessment type.

Return strictly valid JSON matching this schema:
{
  "extractedSkills": ["Skill1", "Skill2", "Skill3", "Skill4"],
  "questions": [
    {
      "id": "q1",
      "category": "Domain Category (e.g. Distributed Caching, React Architecture)",
      "question": "Realistic scenario or technical assessment question...",
      "options": [
        "Correct detailed architectural / technical answer option",
        "Plausible but incorrect distractor option",
        "Flawed approach with known bottlenecks option",
        "Incorrect terminology or anti-pattern option"
      ],
      "correctOptionIndex": 0,
      "expectedAnswer": "Comprehensive expected explanation addressing root concepts...",
      "keywords": ["key1", "key2", "key3"],
      "explanation": "Detailed explanation of why the correct option is optimal...",
      "hint": "Helpful conceptual hint...",
      "codeSnippet": "optional short code snippet or null"
    }
  ]
}`;
  }

  private static getAssessmentTitle(type: string): string {
    const t = type.toLowerCase().replace(/_/g, '-');
    if (t.includes('coding')) return 'Technical Coding Assessment';
    if (t.includes('system')) return 'System Design & Architecture';
    if (t.includes('behavioral')) return 'Behavioral & Situational Fit';
    return 'Domain & Role-Specific Drill';
  }

  private static getAssessmentDuration(type: string): number {
    const t = type.toLowerCase().replace(/_/g, '-');
    if (t.includes('coding')) return 45;
    if (t.includes('system')) return 40;
    if (t.includes('behavioral')) return 30;
    return 35;
  }

  /**
   * Strip confidential fields (correct answers, explanations) from questions for in-progress tests
   */
  private static sanitizeQuestionsForClient(questions: IMockupQuestion[]) {
    return questions.map((q, idx) => ({
      id: q.id,
      index: idx,
      type: q.type,
      question: q.question,
      category: q.category,
      options: q.options || [],
      difficulty: q.difficulty,
      starTip: q.starTip,
    }));
  }
}
