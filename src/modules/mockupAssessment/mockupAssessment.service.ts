import crypto from 'crypto';
import { Types } from 'mongoose';
import { GoogleProvider } from '../ai/providers/google.provider.js';
import { AI_CONFIG } from '../../config/ai.config.js';
import { AppError } from '../../utils/appError.js';
import { logger } from '../../infrastructure/logging/logger.js';
import { MockupTestSessionModel } from '../mockupTest/mockupTest.model.js';

export class MockupAssessmentService {
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

    // Persist session to DB if possible
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
   * Evaluate a single descriptive/typed assessment answer via Gemini
   */
  public static async evaluateAssessmentAnswer(
    question: string,
    answer: string,
    category = 'Core Competency',
    assessmentType = 'technical',
    jobDescription?: string
  ) {
    const prompt = `You are a Senior Assessment Evaluator for LetGetIn.
Evaluate the candidate's answer for this ${assessmentType.toUpperCase()} assessment.

Category: ${category}
Question:
"${question}"

Candidate Answer:
"${answer}"

${jobDescription ? `Job Context / Stack:\n${jobDescription.slice(0, 1000)}\n` : ''}

Provide a comprehensive, objective technical evaluation.
Return strictly valid JSON matching this schema:
{
  "score": 88,
  "technicalScore": 90,
  "communicationScore": 86,
  "problemSolvingScore": 89,
  "starCoherence": 90,
  "summary": "2-3 sentences evaluating technical depth, correctness, and clarity.",
  "strengths": ["Clear architectural understanding", "Accurate time complexity"],
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
        promptName: 'mockup_assessment_evaluate_single',
        model: 'gemini-3.6-flash',
        jsonMode: true,
        temperature: 0.3,
      });

      const parsed = this.parseJsonSafely(response.text);
      if (!parsed) throw new Error('Failed to parse assessment evaluation');
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
      logger.warn({ err }, 'Gemini assessment answer evaluation failed');
      throw new AppError('Unable to evaluate response using AI. Please try again.', 500);
    }
  }

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

  private static parseJsonSafely(text: string): any {
    if (!text) return null;
    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '').trim();
    }
    try {
      return JSON.parse(cleaned);
    } catch {
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
          return JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
        } catch {
          return null;
        }
      }
      return null;
    }
  }
}
