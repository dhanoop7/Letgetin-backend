import crypto from 'crypto';
import { GoogleProvider } from '../ai/providers/google.provider.js';
import { AI_CONFIG } from '../../config/ai.config.js';
import { AppError } from '../../utils/appError.js';

export class InterviewBuddyService {
  /**
   * Generate tailored AI Interview Buddy questions using Gemini LLM
   */
  public static async generateBuddyQuestions(params: {
    mode: string;
    jobDescription?: string;
    customConfig?: {
      role?: string;
      seniority?: string;
      scenario?: string;
      interviewStyle?: string;
      technicalScope?: string;
    };
    userId?: string;
  }): Promise<{
    sessionId: string;
    sessionTitle: string;
    extractedSkills: string[];
    questions: any[];
  }> {
    const { mode, jobDescription = '', customConfig } = params;
    const attemptSeed = crypto.randomBytes(4).toString('hex');
    const sessionId = `ib_${Date.now()}_${attemptSeed}`;

    console.log(`[InterviewBuddy] Generation request received`);
    console.log(`[InterviewBuddy] Mode: ${mode}`);
    console.log(`[InterviewBuddy] Job description received: ${!!jobDescription && jobDescription.trim().length > 0}`);
    console.log(`[InterviewBuddy] Calling Gemini`);

    const prompt = this.buildBuddyPrompt(mode, jobDescription, customConfig, attemptSeed);

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
        console.log(`[InterviewBuddy] Gemini model: ${modelName}`);
        const response = await GoogleProvider.getInstance().generate({
          prompt,
          promptName: `buddy_generate_${mode}_${attemptSeed}`,
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
        console.error(`[InterviewBuddy] Gemini generation attempt failed for model ${modelName}:`, err?.message || err);
      }
    }

    if (rawQuestions.length === 0) {
      console.error(`[InterviewBuddy] Gemini generation failed:`, lastError?.message || lastError);
      console.error(`[InterviewBuddy] No fallback questions will be used`);
      throw new AppError('Unable to generate AI interview questions. Please try again.', 500);
    }

    const formattedQuestions = rawQuestions.map((q: any, idx: number) => {
      const qNum = idx + 1;
      const options =
        Array.isArray(q.options) && q.options.length === 4
          ? q.options.map((opt: any) => String(opt).trim())
          : [
              String(q.expectedAnswer || 'Optimal engineering solution and data-driven alignment'),
              'Suboptimal approach with unaddressed concurrency or latency trade-offs',
              'Synchronous blocking execution without error handling or telemetry',
              'Immediate escalation without root cause analysis or stakeholder alignment',
            ];

      const correctOptionIndex =
        typeof q.correctOptionIndex === 'number' && q.correctOptionIndex >= 0 && q.correctOptionIndex < 4
          ? q.correctOptionIndex
          : 0;

      return {
        id: q.id || `ibq-${attemptSeed}-${qNum}`,
        questionNumber: qNum,
        category: q.category || 'Interview Focus',
        question: String(q.question || '').trim(),
        options,
        correctOptionIndex,
        expectedAnswer: String(q.expectedAnswer || options[correctOptionIndex]).trim(),
        keywords: Array.isArray(q.keywords) && q.keywords.length > 0 ? q.keywords : ['leadership', 'architecture', 'metrics'],
        explanation: String(q.explanation || 'Evaluated on depth, quantitative impact, and STAR methodology alignment.').trim(),
        starTip: q.starTip ? String(q.starTip).trim() : undefined,
        codeSnippet: q.codeSnippet ? String(q.codeSnippet).trim() : undefined,
      };
    });

    console.log(`[InterviewBuddy] Gemini response received`);
    console.log(`[InterviewBuddy] Generated questions: ${formattedQuestions.length}`);
    console.log(`[InterviewBuddy] Source: gemini`);

    return {
      sessionId,
      sessionTitle: this.getBuddyTitle(mode),
      extractedSkills,
      questions: formattedQuestions,
    };
  }

  /**
   * Helper to build prompt for Interview Buddy
   */
  private static buildBuddyPrompt(
    mode: string,
    jobDescription: string,
    customConfig?: {
      role?: string;
      seniority?: string;
      scenario?: string;
      interviewStyle?: string;
      technicalScope?: string;
    },
    attemptSeed?: string
  ): string {
    let modeInstructions = '';
    const normMode = mode.toLowerCase().replace(/_/g, '-');

    if (normMode.includes('hiring') || normMode === 'simulated-hiring') {
      modeInstructions = `Interview Mode: SIMULATED HIRING MANAGER INTERVIEW.
You are a seasoned Engineering Director / VP of Engineering.
Focus on:
- Realistic hiring manager questions: leadership, cross-functional alignment with Product/Design, conflict resolution.
- Handling scope creep, delayed dependencies, and fixed deadlines with proactive triage.
- Engineering mentorship, fostering culture, psychological safety, and blameless retrospectives.
- Severe production incident protocol (P0 triage, rollback before root cause, 5-Whys).
- 30-60-90 day impact roadmap and executive alignment.
- Emphasize the STAR methodology (Situation, Task, Action, Result).`;
    } else if (normMode.includes('scenario') || normMode === 'custom-scenario') {
      const role = customConfig?.role || 'Senior Software Engineer';
      const seniority = customConfig?.seniority || 'Senior / Lead';
      const scenario = customConfig?.scenario || 'Scaling High-Growth Systems';
      modeInstructions = `Interview Mode: CUSTOM SCENARIO SETUP.
Configured Target: Role="${role}", Seniority="${seniority}", Scenario="${scenario}".
Focus on:
- Complex technical debt vs feature velocity trade-offs in fast-paced sprints.
- Navigating ambiguous requirements, legacy migrations, and architectural refactoring.
- Cross-functional stakeholder negotiations and trade-off matrices.`;
    } else if (normMode.includes('voice') || normMode === 'voice-ai') {
      modeInstructions = `Interview Mode: VOICE AI PRACTICE.
Focus on:
- Conversational phrasing natural when spoken by Text-to-Speech engines.
- Verbal articulation of technical architecture, system constraints, and engineering decisions.
- Clear probing questions testing verbal clarity, structured thought, and conciseness.`;
    } else if (normMode.includes('coding') || normMode.includes('technical') || normMode === 'technical-coding') {
      modeInstructions = `Interview Mode: TECHNICAL & CODING ROUNDS.
Focus on:
- Core programming concepts, algorithms, data structures, and technologies found in the Job Description.
- Memory management, event loop execution order, distributed caching (Redis/Memcached), and indexing (B-Tree/Clustered).
- Debugging memory leaks, bottleneck profiling (Clinic.js / DevTools), and Big-O time/space trade-offs.
- Provide a concise codeSnippet where helpful.`;
    } else if (normMode.includes('scoring') || normMode === 'instant-scoring') {
      modeInstructions = `Interview Mode: INSTANT AI SCORING & STAR FEEDBACK.
Focus on:
- Quantifiable engineering impact: before/after latency (p99/p95), throughput (RPS), SLA/SLO uptime, and cost savings ($).
- Concrete metrics in post-mortems (MTTR, failure rate reduction, canary pipelines).
- Demonstrating engineering ROI and Developer Experience (hours saved per sprint).`;
    } else {
      modeInstructions = `Interview Mode: 360° MOCKUP INTERVIEW.
Focus on:
- End-to-end holistic evaluation: long-term architecture vision (Edge, WebAssembly, RSC), system design (URL shorteners, partitioning), security (JWT in HTTP-only cookies vs XSS/CSRF), testing pyramid, and composure under pressure.`;
    }

    const jdText =
      jobDescription && jobDescription.trim().length > 10
        ? `Target Job Description:
"""
${jobDescription.trim().slice(0, 4000)}
"""`
        : `Target Job Benchmark:
Role: Senior Full Stack / Software Engineer with modern web architecture and distributed systems competencies.`;

    return `You are the Lead Technical Interviewer and AI Interview Buddy for LetGetIn.
Generate 5 realistic, challenging, and insightful interview questions tailored to the candidate's chosen mode and Job Description.

${modeInstructions}

${jdText}

Unique Attempt Seed: "${attemptSeed || crypto.randomBytes(4).toString('hex')}".
Generate a fresh interview question set for this new attempt. Do not reuse questions from previous attempts. Generate different questions even if the same job description and interview mode are used again.

Return strictly valid JSON with this schema:
{
  "extractedSkills": ["Skill1", "Skill2", "Skill3", "Skill4"],
  "questions": [
    {
      "id": "q1",
      "category": "Domain Category (e.g. Leadership & Alignment, Concurrency, System Design)",
      "question": "Realistic scenario-based interview question...",
      "options": [
        "Optimal, data-driven, and architecturally sound answer option",
        "Plausible but flawed or naive distractor option",
        "Shortsighted or blame-shifting anti-pattern option",
        "Incorrect terminology or superficial option"
      ],
      "correctOptionIndex": 0,
      "expectedAnswer": "Comprehensive model response covering root principles, trade-offs, and metrics...",
      "keywords": ["keyword1", "keyword2", "keyword3"],
      "explanation": "Why the correct option represents executive engineering leadership...",
      "starTip": "STAR tip for behavioral/situational framing",
      "codeSnippet": null
    }
  ]
}`;
  }

  private static getBuddyTitle(mode: string): string {
    const m = mode.toLowerCase().replace(/_/g, '-');
    if (m.includes('hiring')) return 'Simulated Hiring Manager Interview';
    if (m.includes('scenario')) return 'Custom Scenario Setup';
    if (m.includes('voice')) return 'Voice AI Practice';
    if (m.includes('coding') || m.includes('technical')) return 'Technical & Coding Rounds';
    if (m.includes('scoring')) return 'Instant AI Scoring & STAR Feedback';
    return 'Mockup Interview';
  }

  /**
   * Evaluate single Interview Buddy answer using Gemini
   */
  public static async evaluateBuddyAnswer(params: {
    question: string;
    answer: string;
    category?: string;
    mode?: string;
    expectedAnswer?: string;
    jobDescription?: string;
  }): Promise<{
    score: number;
    isCorrect: boolean;
    feedback: string;
    strengths: string[];
    improvements: string[];
    star?: {
      situation?: string;
      task?: string;
      action?: string;
      result?: string;
    };
  }> {
    const { question, answer, category, mode, expectedAnswer, jobDescription } = params;

    console.log('[InterviewBuddy] Evaluating candidate response');
    console.log('[InterviewBuddy] Calling Gemini');

    const prompt = `You are the Lead Evaluator for LetGetIn AI Interview Buddy.
Evaluate this candidate's interview response with technical rigor and STAR methodology analysis.

Question: "${question}"
Category: "${category || 'Core Engineering'}"
Expected Answer / Key Concepts: "${expectedAnswer || 'Comprehensive architectural response'}"
Candidate Answer: "${answer}"
${jobDescription ? `Job Description Context: "${jobDescription.slice(0, 1500)}"` : ''}

Return strictly valid JSON:
{
  "score": 85,
  "isCorrect": true,
  "feedback": "Concise 2-3 sentence assessment of candidate answer correctness and depth.",
  "strengths": ["Strong point 1", "Strong point 2"],
  "improvements": ["Constructive area for improvement 1"],
  "star": {
    "situation": "Identified situation context or missing context",
    "task": "Identified problem scope",
    "action": "Actions taken or recommended technical approach",
    "result": "Quantifiable metrics and business outcomes"
  }
}`;

    const candidateModels = [
      AI_CONFIG.model,
      'gemini-3.8-flash',
      'gemini-3.6-flash',
    ].filter((v, i, a) => !!v && a.indexOf(v) === i);

    for (const modelName of candidateModels) {
      try {
        const response = await GoogleProvider.getInstance().generate({
          prompt,
          promptName: `buddy_eval_${mode || 'interview'}`,
          model: modelName,
          jsonMode: true,
          temperature: 0.2,
          timeoutMs: 25000,
          retryAttempts: 2,
        });

        const parsed = this.parseJsonSafely(response.text);
        if (parsed && typeof parsed.score === 'number') {
          console.log('[InterviewBuddy] Gemini evaluation received');
          return {
            score: Math.min(100, Math.max(0, parsed.score)),
            isCorrect: parsed.isCorrect !== undefined ? Boolean(parsed.isCorrect) : parsed.score >= 60,
            feedback: String(parsed.feedback || 'Answer evaluated by AI.').trim(),
            strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
            improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
            star: parsed.star,
          };
        }
      } catch (err: any) {
        console.warn(`[InterviewBuddy] Evaluation attempt with ${modelName} failed:`, err?.message || err);
      }
    }

    console.error('[InterviewBuddy] Gemini evaluation failed');
    throw new AppError('Unable to evaluate your response with AI. Please try again.', 500);
  }

  private static parseJsonSafely(text: string): any {
    if (!text) return null;
    let clean = text.trim();
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    }
    try {
      return JSON.parse(clean);
    } catch {
      const firstBrace = clean.indexOf('{');
      const lastBrace = clean.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        try {
          return JSON.parse(clean.substring(firstBrace, lastBrace + 1));
        } catch {
          return null;
        }
      }
      return null;
    }
  }
}
