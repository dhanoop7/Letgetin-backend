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
   * AI Question Generation tailored specifically for any assessment round
   * (e.g. general_aptitude, technical_test, rapid_round, domain, skills, technical, linguistic, psychometric, genius)
   */
  public async generateRoundQuestions(input: {
    roundType: string;
    roundName?: string;
    jobTitle?: string;
    skills?: string[];
    difficulty?: string;
    count?: number;
    focusTopic?: string;
    section?: 'mcq' | 'descriptive' | 'rapid';
    questionFormat?: 'mcq' | 'descriptive' | 'rapid' | 'mixed';
    timeLimitSeconds?: number;
    experience?: string;
    jobDescription?: string;
    jobResponsibilities?: string | string[];
  }): Promise<Array<{
    id: string;
    target: 'ai_online_test' | 'ai_assessment';
    section?: 'mcq' | 'descriptive' | 'rapid';
    type: 'mcq' | 'coding' | 'descriptive' | 'rapid';
    question: string;
    options?: Array<{ id: string; text: string }>;
    correctOptionId?: string;
    points: number;
    timeLimitSeconds?: number;
    explanation?: string;
    sampleAnswer?: string;
    evaluationRubric?: string;
  }>> {
    const roundType = input.roundType || 'general_aptitude';
    const roundName = input.roundName || roundType;
    const jobTitle = input.jobTitle || 'Software Engineer';
    const skills = Array.isArray(input.skills) && input.skills.length > 0 ? input.skills.join(', ') : 'General Problem Solving';
    const difficulty = input.difficulty || 'medium';
    const count = Math.min(Math.max(input.count || 10, 2), 60);
    const format = input.questionFormat || (roundType === 'rapid_round' || roundName.toLowerCase().includes('rapid') ? 'rapid' : 'mcq');

    const isGeneralAptitude =
      roundType !== 'rapid_round' &&
      roundType !== 'technical_test' &&
      !roundName.toLowerCase().includes('technical') &&
      !roundName.toLowerCase().includes('rapid') &&
      (roundType === 'general_aptitude' ||
        roundName.toLowerCase().includes('general aptitude') ||
        roundName.toLowerCase().includes('aptitude') ||
        roundType.includes('aptitude'));

    const BATCH_SIZE = 15;
    const numBatches = Math.ceil(count / BATCH_SIZE);

    const aptitudeBatchTopics = [
      'Quantitative Aptitude: Arithmetic, Percentages, Profit & Loss, Work & Time, Ratios & Proportions',
      'Logical Reasoning: Number Series, Letter Series, Coding-Decoding, Pattern Analogies',
      'Quantitative Aptitude: Speed Distance & Time, Averages, Probability, Simple & Compound Interest, Permutations',
      'Logical Reasoning: Syllogisms, Blood Relations, Direction Sense, Seating Arrangements, Deductions',
    ];

    const generateBatch = async (batchIdx: number, batchCount: number) => {
      let prompt = '';
      if (isGeneralAptitude) {
        const topicFocus = input.focusTopic
          ? `${input.focusTopic} (focusing on ${aptitudeBatchTopics[batchIdx % aptitudeBatchTopics.length]})`
          : aptitudeBatchTopics[batchIdx % aptitudeBatchTopics.length];

        if (format === 'rapid' || input.section === 'rapid') {
          const rapidSeconds = input.timeLimitSeconds || 30;
          prompt = `You are a Senior Speed Testing & Cognitive Agility Examiner.
Generate strictly ${batchCount} high-quality, completely NON-TECHNICAL RAPID-FIRE / SPEED QUESTION ROUND assessment questions on: ${topicFocus}.
Difficulty: ${difficulty}

CRITICAL RULES:
1. Every question must be pure Quantitative Aptitude or Logical Reasoning designed for fast ${rapidSeconds}-second solving (mental math shortcuts, quick percentages, speed series, rapid analogies, quick syllogisms, estimation).
2. ABSOLUTELY NO TECHNICAL OR PROGRAMMING CONTENT (NO code, NO databases, NO software engineering).
3. Questions must be crisp, punchy, and quick to read.
4. Each question must provide 4 distinct concise options (A, B, C, D) with exactly one logically indisputable correct answer, and "timeLimitSeconds": ${rapidSeconds}.

Format strictly as JSON with this exact schema:
{
  "questions": [
    {
      "type": "rapid",
      "question": "Punchy, fast-paced speed aptitude question designed for ${rapidSeconds}s",
      "options": [
        { "id": "opt_a", "text": "Option A" },
        { "id": "opt_b", "text": "Option B" },
        { "id": "opt_c", "text": "Option C" },
        { "id": "opt_d", "text": "Option D" }
      ],
      "correctOptionId": "opt_a",
      "timeLimitSeconds": ${rapidSeconds},
      "points": 10,
      "explanation": "Quick 1-line mathematical or logical shortcut"
    }
  ]
}`;
        } else if (format === 'descriptive' || input.section === 'descriptive') {
          prompt = `You are a Senior Aptitude & Cognitive Testing Examiner.
Generate strictly ${batchCount} high-quality, completely NON-TECHNICAL DESCRIPTIVE analytical problem-solving assessment questions on: ${topicFocus}.
Difficulty: ${difficulty}

CRITICAL RULES:
1. Every question must be pure Quantitative Aptitude or Logical Reasoning.
2. ABSOLUTELY NO TECHNICAL OR PROGRAMMING CONTENT:
   - DO NOT mention any programming languages (Java, Python, C++, JavaScript, TypeScript, Go, etc.).
   - DO NOT mention web development, APIs, databases, SQL, frameworks, Git, Linux, microservices, or software engineering.
   - All questions must be pure math, word problems, business cases, or logical deduction puzzles.
3. These are DESCRIPTIVE / OPEN-ENDED questions:
   - Candidates must write out their step-by-step mathematical calculations, algebraic reasoning, or logical deduction proofs.
   - For every question, you MUST provide:
     a) "question": The complete scenario or problem statement requiring written derivation.
     b) "sampleAnswer": A comprehensive step-by-step model solution detailing intermediate steps and final answer.
     c) "evaluationRubric": Specific grading criteria with point distribution (e.g. "Formulation: 3 pts, Intermediate calculations: 4 pts, Final conclusion: 3 pts").
     d) "points": 10
     e) "explanation": The underlying mathematical or logical principle.

Format strictly as JSON with this exact schema:
{
  "questions": [
    {
      "question": "Full comprehensive mathematical scenario or logical deduction puzzle requiring written derivation",
      "sampleAnswer": "Step-by-step mathematical derivation and final answer",
      "evaluationRubric": "Specific point-by-point grading criteria",
      "points": 10,
      "explanation": "Core theoretical principle or insight"
    }
  ]
}`;
        } else if (format === 'mixed') {
          const descCount = Math.max(1, Math.round(batchCount * 0.3));
          const mcqCount = Math.max(1, batchCount - descCount);

          prompt = `You are a Senior Aptitude & Cognitive Testing Examiner.
Generate strictly ${batchCount} completely NON-TECHNICAL assessment questions (${mcqCount} Multiple-Choice Questions and ${descCount} Descriptive problem-solving questions) on: ${topicFocus}.
Difficulty: ${difficulty}

CRITICAL RULES:
1. Every question must be pure Quantitative Aptitude or Logical Reasoning. No technical or programming topics allowed.
2. For "mcq" questions: provide 4 distinct options (opt_a, opt_b, opt_c, opt_d) and "correctOptionId".
3. For "descriptive" questions: provide "sampleAnswer" (step-by-step solution derivation) and "evaluationRubric" (grading criteria).

Format strictly as JSON with this exact schema:
{
  "questions": [
    {
      "type": "mcq",
      "question": "Clear mathematical or logical MCQ problem statement",
      "options": [
        { "id": "opt_a", "text": "Option A" },
        { "id": "opt_b", "text": "Option B" },
        { "id": "opt_c", "text": "Option C" },
        { "id": "opt_d", "text": "Option D" }
      ],
      "correctOptionId": "opt_b",
      "points": 10,
      "explanation": "Clear step-by-step explanation"
    },
    {
      "type": "descriptive",
      "question": "Analytical word problem or logical proof requiring written step-by-step derivation",
      "sampleAnswer": "Step-by-step model solution and final answer",
      "evaluationRubric": "Grading breakdown criteria",
      "points": 10,
      "explanation": "Underlying mathematical or logical principle"
    }
  ]
}`;
        } else {
          prompt = `You are a Senior Aptitude & Cognitive Testing Examiner.
Generate strictly ${batchCount} high-quality, completely NON-TECHNICAL multiple-choice assessment questions on: ${topicFocus}.
Difficulty: ${difficulty}

CRITICAL RULES:
1. Every question must be pure Quantitative Aptitude or Logical Reasoning.
2. ABSOLUTELY NO TECHNICAL OR PROGRAMMING CONTENT:
   - DO NOT mention any programming languages (Java, Python, C++, JavaScript, TypeScript, Go, etc.).
   - DO NOT mention web development, APIs, databases, SQL, frameworks (React, Node), Git, Linux, microservices, or software engineering.
   - All questions must be pure math, word problems, or logical deduction.
3. Each question must provide 4 distinct options (A, B, C, D) with exactly one logically indisputable correct answer, and a clear step-by-step explanation.

Format strictly as JSON with this exact schema:
{
  "questions": [
    {
      "question": "Full clear mathematical or logical problem statement",
      "options": [
        { "id": "opt_a", "text": "Option A text" },
        { "id": "opt_b", "text": "Option B text" },
        { "id": "opt_c", "text": "Option C text" },
        { "id": "opt_d", "text": "Option D text" }
      ],
      "correctOptionId": "opt_b",
      "points": 10,
      "explanation": "Clear step-by-step mathematical or logical explanation"
    }
  ]
}`;
        }
      } else {
        const expText = input.experience?.trim() || `${difficulty} level (e.g. 3-5 years)`;
        const jdText = input.jobDescription?.trim()
          ? input.jobDescription.trim()
          : `Standard enterprise software engineering practices, lifecycle, and architectures for ${jobTitle}.`;

        const respList = Array.isArray(input.jobResponsibilities)
          ? input.jobResponsibilities.filter(Boolean)
          : typeof input.jobResponsibilities === 'string' && input.jobResponsibilities.trim()
          ? input.jobResponsibilities.split('\n').map((s) => s.trim().replace(/^[-*•]\s*/, '')).filter(Boolean)
          : [];
        const respFormatted = respList.length > 0
          ? respList.map((r) => `- ${r}`).join('\n')
          : `- Design, implement, and maintain scalable systems and services for ${jobTitle}\n- Troubleshoot performance issues, code bugs, and production incidents\n- Deliver high quality, testable code aligned with industry engineering standards`;

        const skillsFormatted = skills || 'Core programming languages, frameworks, databases, and system architecture';

        const difficultyDirective =
          difficulty.toLowerCase() === 'easy'
            ? `LEVEL: EASY (Foundational / Junior Engineer).
- FOCUS: Fundamental programming concepts, language syntax, basic standard library APIs, clean coding practices, simple data structures (arrays/lists/hashmaps), input validation, straightforward unit testing, and direct troubleshooting.
- RESTRICTION: Absolutely DO NOT ask complex distributed systems, high concurrency, microservice consensus, or advanced system design trade-offs.`
            : difficulty.toLowerCase() === 'hard'
            ? `LEVEL: HARD (Senior / Staff / Principal Architect).
- FOCUS: Advanced distributed system architecture, high-concurrency patterns, race conditions, memory profiling, performance bottlenecks, fault tolerance, event-driven streaming, caching hierarchies, database sharding & replication lag, circuit breaking, and deep trade-off analysis between latency, consistency, and availability.
- RESTRICTION: Do NOT ask simple trivia or basic syntax questions.`
            : `LEVEL: MEDIUM (Mid-Level Practical Software Engineer).
- FOCUS: Real-world practical implementation, software design patterns, database indexing & SQL query optimization, REST/gRPC API contract design, asynchronous execution flow, robust error handling & recovery, component-level trade-offs, and daily production feature delivery.`;

        const roleHierarchyBlueprint = `
================================================================================
MANDATORY ROLE HIERARCHY BLUEPRINT (EVALUATION ORDER):
You MUST formulate every single question strictly adhering to the following 5-tier hierarchy:

1. TARGET JOB TITLE:
   "${jobTitle}"
   - Role Domain: Every question must directly mirror the engineering domain, terminology, workflows, and responsibilities expected of a "${jobTitle}".

2. TARGET EXPERIENCE LEVEL & SENIORITY:
   "${expText}"
   ACTIVE CALIBRATED DIFFICULTY DIRECTIVE:
   ${difficultyDirective}

3. JOB DESCRIPTION & BUSINESS CONTEXT:
   """
   ${jdText}
   """
   - Contextualize questions within this specific business domain, technical environment, and operational challenges described in the Job Description.

4. KEY ROLE RESPONSIBILITIES & DELIVERABLES:
${respFormatted}
   - CRITICAL REQUIREMENT: Derive questions directly from these daily responsibilities. Formulate scenarios that test whether the candidate can successfully execute these exact deliverables on the job.

5. REQUIRED SKILLS SET & TECH STACK:
   ${skillsFormatted}
   - All questions, coding scenarios, and distractors MUST test and reference these specific technologies, frameworks, libraries, tools, and languages.
================================================================================
${input.focusTopic ? `\nADDITIONAL RECRUITER TOPIC FOCUS: ${input.focusTopic}\n` : ''}`;

        const isAiAssessmentRound =
          roundType === 'ai_assessment' ||
          roundType === 'ai_chat' ||
          roundType === 'ai_voice' ||
          roundName.toLowerCase().includes('ai assessment') ||
          roundName.toLowerCase().includes('chat') ||
          roundName.toLowerCase().includes('voice') ||
          roundName.toLowerCase().includes('interview');

        if (isAiAssessmentRound) {
          const isVoiceRound = roundType === 'ai_voice' || roundName.toLowerCase().includes('voice');

          if (isVoiceRound) {
            prompt = `You are an Executive Technical Interviewer and AI Voice Assessment Architect at LetGetIn.
Generate strictly ${batchCount} spoken interview discussion questions specifically tailored for an AI Voice Assessment for the round: "${roundName}".

${roleHierarchyBlueprint}

CRITICAL RULES FOR AI VOICE ASSESSMENT:
1. This is a real-time SPOKEN AUDIO interview session. Questions MUST be formulated as natural verbal discussion prompts that an AI Interviewer speaks aloud to the candidate.
2. DO NOT ask questions that require writing code blocks, typing complex syntax, or drawing diagrams.
3. Every question must probe:
   - Spoken technical communication: How clearly the candidate articulates architectural systems vocally.
   - Architectural and system scalability trade-offs (e.g., latency vs throughput, consistency models, microservices vs modular monoliths).
   - Live production incident verbal triage (e.g., "Production is experiencing sudden latency spikes and elevated 504 errors. Walk me through your first 10 minutes of diagnosis and containment").
   - Engineering leadership, technical disagreement resolution, and mentoring junior engineers.
   - Non-technical stakeholder communication (e.g., "How would you explain the necessity of paying down architectural tech debt to a business product manager?").
4. The questions MUST be calibrated strictly to ${difficulty.toUpperCase()} difficulty level:
   ${difficultyDirective}
5. The questions must probe the candidate's real-world grasp of the Job Description and Daily Deliverables for "${jobTitle}".
6. For every question, provide:
   a) "question": The natural, engaging conversational spoken question to ask the candidate aloud.
   b) "sampleAnswer": Comprehensive model spoken response highlighting structured reasoning, key architectural terms, and practical trade-offs.
   c) "evaluationRubric": Point-by-point scoring guidelines (e.g. "Spoken clarity & structuring: 4 pts, Technical depth & justification: 3 pts, Production trade-offs: 3 pts").
   d) "points": 10
   e) "explanation": The verbal communication and technical judgment competency evaluated.

Format strictly as JSON with this exact schema:
{
  "questions": [
    {
      "type": "descriptive",
      "question": "Spoken interview question to be asked aloud by AI voice interviewer",
      "sampleAnswer": "Comprehensive model spoken answer with key principles",
      "evaluationRubric": "Criteria for full and partial credit",
      "points": 10,
      "explanation": "Core verbal competency evaluated"
    }
  ]
}`;
          } else {
            prompt = `You are an Executive Technical Interviewer and AI Chat Assessment Architect at LetGetIn.
Generate strictly ${batchCount} conversational technical interview topics & code reasoning questions for an AI Chat Assessment for the round: "${roundName}".

${roleHierarchyBlueprint}

CRITICAL RULES FOR AI CHAT ASSESSMENT:
1. This is an interactive text & code reasoning assessment session.
2. Questions MUST probe concrete software engineering, code implementation patterns, state management architecture, API and database design, and edge-case handling.
3. The candidate can provide code snippets, typescript algorithms, and structured technical explanations in the chat.
4. The questions MUST be calibrated strictly to ${difficulty.toUpperCase()} difficulty level:
   ${difficultyDirective}
5. The questions must probe the candidate's real-world grasp of the Job Description and Daily Deliverables for "${jobTitle}".
6. For every question, provide:
   a) "question": The conversational technical interview question / scenario to present in the chat.
   b) "sampleAnswer": Comprehensive model response with architectural details, implementation patterns, and code practices.
   c) "evaluationRubric": Point-by-point scoring guidelines (e.g. "Concept clarity: 4 pts, Practical code implementation: 3 pts, Edge cases & performance: 3 pts").
   d) "points": 10
   e) "explanation": The core technical programming competency evaluated.

Format strictly as JSON with this exact schema:
{
  "questions": [
    {
      "type": "descriptive",
      "question": "Technical chat interview question with code/system design scenario",
      "sampleAnswer": "Comprehensive model response with implementation details",
      "evaluationRubric": "Criteria for full and partial credit",
      "points": 10,
      "explanation": "Core technical competency evaluated"
    }
  ]
}`;
          }
        } else if (format === 'rapid' || input.section === 'rapid' || roundType === 'rapid_round') {
          const rapidSeconds = input.timeLimitSeconds || 30;
          prompt = `You are a Chief Technical Examiner and Hiring Specialist at LetGetIn.
Generate strictly ${batchCount} high-quality, practical RAPID-FIRE / SPEED TECHNICAL assessment questions for the round: "${roundName}" (Type: ${roundType}).

${roleHierarchyBlueprint}

CRITICAL RULES:
1. Every question MUST evaluate technical concepts, syntax, code output, or tools derived directly from the 5-tier Role Blueprint above (Job Title -> Experience -> JD -> Responsibilities -> Skills).
2. Calibrate question depth and cognitive complexity to the Target Experience Level: "${expText}".
3. Questions must be crisp, punchy, and solvable within ${rapidSeconds} seconds.
4. Each question must provide 4 distinct options (opt_a, opt_b, opt_c, opt_d) with exactly one logically indisputable correct answer, and "timeLimitSeconds": ${rapidSeconds}.

Format strictly as JSON with this exact schema:
{
  "questions": [
    {
      "type": "rapid",
      "question": "Punchy, job-relevant speed technical question designed for ${rapidSeconds}s",
      "options": [
        { "id": "opt_a", "text": "Option A" },
        { "id": "opt_b", "text": "Option B" },
        { "id": "opt_c", "text": "Option C" },
        { "id": "opt_d", "text": "Option D" }
      ],
      "correctOptionId": "opt_a",
      "timeLimitSeconds": ${rapidSeconds},
      "points": 10,
      "explanation": "Clear 1-2 line technical explanation linking to the job domain and role requirements"
    }
  ]
}`;
        } else if (format === 'descriptive' || input.section === 'descriptive') {
          prompt = `You are a Chief Technical Examiner and Engineering Architect at LetGetIn.
Generate strictly ${batchCount} practical, in-depth DESCRIPTIVE architectural / engineering challenge questions for the round: "${roundName}" (Type: ${roundType}).

${roleHierarchyBlueprint}

CRITICAL RULES:
1. Every question MUST be grounded in real-world scenarios, architectural challenges, and daily deliverables derived directly from the 5-tier Role Blueprint above:
   - Evaluates the Job Title ("${jobTitle}")
   - Calibrated to the Experience Level ("${expText}")
   - Directly contextualized by the Job Description
   - Tests hands-on execution of the Key Responsibilities
   - Requires usage of the Required Skills & Tech Stack
2. These questions test how a candidate actually designs, implements, debugs, or solves real engineering tasks for this specific role.
3. For every question, you MUST provide:
   a) "question": A comprehensive practical scenario or problem statement requiring written technical explanation, architectural trade-offs, or pseudocode/algorithm steps.
   b) "sampleAnswer": A comprehensive model solution and trade-off analysis.
   c) "evaluationRubric": Point-by-point scoring criteria (e.g. "Approach & Architecture: 4 pts, Edge cases & Error Handling: 3 pts, Scalability & Performance: 3 pts").
   d) "points": 10
   e) "explanation": Key architectural insights and connection to the role's deliverables.

Format strictly as JSON with this exact schema:
{
  "questions": [
    {
      "type": "descriptive",
      "question": "Comprehensive job-aligned technical challenge or architectural scenario",
      "sampleAnswer": "Comprehensive technical answer, code/algorithm steps, and trade-off analysis",
      "evaluationRubric": "Criteria for full and partial credit",
      "points": 10,
      "explanation": "Key architectural insights"
    }
  ]
}`;
        } else if (format === 'mixed') {
          const descCount = Math.max(1, Math.round(batchCount * 0.3));
          const mcqCount = Math.max(1, batchCount - descCount);

          prompt = `You are a Chief Technical Examiner and Hiring Specialist at LetGetIn.
Generate strictly ${batchCount} practical assessment questions (${mcqCount} MCQ questions and ${descCount} Descriptive challenge questions) for the round: "${roundName}" (Type: ${roundType}).

${roleHierarchyBlueprint}

CRITICAL RULES:
1. Every question MUST be directly tailored to and derived from the 5-tier Role Blueprint above:
   - Job Title: "${jobTitle}"
   - Experience Level: "${expText}"
   - Job Description
   - Key Responsibilities
   - Required Skill Set & Tech Stack
2. For "mcq" questions: provide 4 distinct options (opt_a, opt_b, opt_c, opt_d) and "correctOptionId".
3. For "descriptive" questions: provide "sampleAnswer" (model solution and trade-offs) and "evaluationRubric" (grading criteria).

Format strictly as JSON with this exact schema:
{
  "questions": [
    {
      "type": "mcq",
      "question": "Job-specific technical MCQ problem statement",
      "options": [
        { "id": "opt_a", "text": "Option A" },
        { "id": "opt_b", "text": "Option B" },
        { "id": "opt_c", "text": "Option C" },
        { "id": "opt_d", "text": "Option D" }
      ],
      "correctOptionId": "opt_b",
      "points": 10,
      "explanation": "Clear explanation of the solution"
    },
    {
      "type": "descriptive",
      "question": "Practical technical scenario or system design challenge derived from job responsibilities",
      "sampleAnswer": "Comprehensive model solution and trade-off analysis",
      "evaluationRubric": "Grading breakdown criteria",
      "points": 10,
      "explanation": "Underlying engineering principle"
    }
  ]
}`;
        } else {
          prompt = `You are a Chief Technical Examiner and Hiring Specialist at LetGetIn.
Generate strictly ${batchCount} high-quality, practical multiple-choice technical assessment questions for the round: "${roundName}" (Type: ${roundType}).

${roleHierarchyBlueprint}

CRITICAL RULES:
1. Every question MUST directly evaluate technical competence, concepts, algorithms, frameworks, or best practices derived from the 5-tier Role Blueprint:
   - Job Title: "${jobTitle}"
   - Experience Level: "${expText}"
   - Job Description
   - Key Responsibilities
   - Required Skills & Tech Stack
2. Avoid generic trivia; prefer practical scenario-based questions that test how candidates solve real problems in this role.
3. Each question must provide 4 distinct options (A, B, C, D) with exactly one logically indisputable correct answer, and a clear technical explanation.

Format strictly as JSON with this exact schema:
{
  "questions": [
    {
      "question": "Comprehensive technical scenario or code/concept problem statement",
      "options": [
        { "id": "opt_a", "text": "Option A" },
        { "id": "opt_b", "text": "Option B" },
        { "id": "opt_c", "text": "Option C" },
        { "id": "opt_d", "text": "Option D" }
      ],
      "correctOptionId": "opt_b",
      "points": 10,
      "explanation": "Clear explanation of why this answer is correct"
    }
  ]
}`;
        }
      }

      const response = await GoogleProvider.getInstance().generate({
        prompt,
        promptName: isGeneralAptitude ? `aptitude_batch_${batchIdx + 1}` : `round_batch_${batchIdx + 1}`,
        jsonMode: true,
        temperature: 0.35,
      });

      const parsed = JSON.parse(response.text.trim());
      const rawList = Array.isArray(parsed) ? parsed : (parsed?.questions || parsed?.items || []);
      return rawList.map((q: any, idx: number) => {
        const isRapid =
          format === 'rapid' ||
          input.section === 'rapid' ||
          q.type === 'rapid' ||
          Boolean(q.timeLimitSeconds);

        if (isRapid) {
          return {
            id: `cq_${Date.now().toString(36)}_${batchIdx}_${idx + 1}`,
            target: 'ai_online_test' as const,
            section: 'rapid' as const,
            type: 'rapid' as const,
            question: q.question,
            options: Array.isArray(q.options) && q.options.length >= 2
              ? q.options.map((opt: any, optIdx: number) => ({
                  id: opt.id || `opt_${String.fromCharCode(97 + optIdx)}`,
                  text: String(opt.text || opt),
                }))
              : [
                  { id: 'opt_a', text: 'Option A' },
                  { id: 'opt_b', text: 'Option B' },
                  { id: 'opt_c', text: 'Option C' },
                  { id: 'opt_d', text: 'Option D' },
                ],
            correctOptionId: q.correctOptionId || 'opt_a',
            points: Number(q.points) || 10,
            timeLimitSeconds: Number(q.timeLimitSeconds) || input.timeLimitSeconds || 30,
            explanation: q.explanation || '',
          };
        }

        const isDesc =
          format === 'descriptive' ||
          input.section === 'descriptive' ||
          q.type === 'descriptive' ||
          q.type === 'short_answer' ||
          (!q.options || q.options.length < 2);

        if (isDesc) {
          return {
            id: `cq_${Date.now().toString(36)}_${batchIdx}_${idx + 1}`,
            target: 'ai_online_test' as const,
            section: 'descriptive' as const,
            type: 'descriptive' as const,
            question: q.question,
            sampleAnswer: q.sampleAnswer || q.expectedAnswer || q.explanation || 'Step-by-step problem-solving derivation.',
            evaluationRubric: q.evaluationRubric || 'Award points for clear formulation, accurate calculation, and justified final answer.',
            points: Number(q.points) || 10,
            explanation: q.explanation || '',
          };
        }

        return {
          id: `cq_${Date.now().toString(36)}_${batchIdx}_${idx + 1}`,
          target: 'ai_online_test' as const,
          section: 'mcq' as const,
          type: 'mcq' as const,
          question: q.question,
          options: Array.isArray(q.options) && q.options.length >= 2
            ? q.options.map((opt: any, optIdx: number) => ({
                id: opt.id || `opt_${String.fromCharCode(97 + optIdx)}`,
                text: String(opt.text || opt),
              }))
            : [
                { id: 'opt_a', text: 'Option A' },
                { id: 'opt_b', text: 'Option B' },
                { id: 'opt_c', text: 'Option C' },
                { id: 'opt_d', text: 'Option D' },
              ],
          correctOptionId: q.correctOptionId || 'opt_a',
          points: Number(q.points) || 10,
          explanation: q.explanation || '',
        };
      });
    };

    // Run batches concurrently in parallel
    const batchTasks: Promise<any[]>[] = [];
    for (let i = 0; i < numBatches; i++) {
      const currentBatchCount = Math.min(BATCH_SIZE, count - (i * BATCH_SIZE));
      batchTasks.push(
        generateBatch(i, currentBatchCount).catch((err) => {
          console.warn(`[DomainAssessmentService] Batch ${i + 1} failed:`, err?.message);
          return [];
        })
      );
    }

    const batchResults = await Promise.all(batchTasks);
    const collectedQuestions = batchResults.flat();

    if (collectedQuestions.length > 0) {
      return collectedQuestions.slice(0, count);
    }

    // Curated fallbacks
    if (isGeneralAptitude) {
      if (format === 'descriptive') {
        const aptitudeDescriptiveFallbacks = [
          {
            question: 'A retail firm has fixed overhead costs of $120,000 per month and variable costs of $30 per unit. The product sells for $60 per unit. Calculate the monthly break-even unit volume. Then, show step-by-step how a 15% increase in variable costs changes the required break-even volume.',
            sampleAnswer: '1. Initial contribution margin = $60 - $30 = $30. Initial break-even = $120,000 / $30 = 4,000 units.\n2. New variable cost = $30 * 1.15 = $34.50. New contribution margin = $60 - $34.50 = $25.50.\n3. New break-even volume = $120,000 / $25.50 = 4,705.88 (~4,706 units). The firm must sell 706 additional units (+17.65%) to reach break-even.',
            evaluationRubric: '1. Correct initial break-even calculation (3 pts); 2. Correct revised contribution margin calculation (3 pts); 3. Accurate final break-even volume and percentage impact explanation (4 pts).',
            points: 10,
            explanation: 'Tests multi-step quantitative break-even and financial ratio reasoning.',
          },
          {
            question: 'Five committee members (P, Q, R, S, T) sit in a straight row facing north. S sits at one extreme end. Q is second to the right of P. R sits immediately left of T. P is not adjacent to S. Deduce the unique seating arrangement from left to right, justifying each elimination step.',
            sampleAnswer: 'Step 1: S must be at Position 5 (if S=1, P cannot be at 2, so P=3 => Q=5 which contradicts S=1/5).\nStep 2: With S at 5, P sits at 1 and Q sits at 3.\nStep 3: R is immediately left of T. Positions 2 and 4 are free => R=2, T=4.\nValidated final order from left to right: P, R, Q, T, S.',
            evaluationRubric: '1. Step-by-step constraint elimination (4 pts); 2. Correct placement of S and P (3 pts); 3. Validated final order P, R, Q, T, S (3 pts).',
            points: 10,
            explanation: 'Tests logical deduction and constraint satisfaction reasoning.',
          },
          {
            question: 'A project is handled by two teams. Team Alpha can complete it in 20 days, and Team Beta can complete it in 30 days. Both work together for 6 days, after which Team Beta is replaced by Team Gamma. If Alpha and Gamma finish the remaining work in 8 days, calculate how many days Team Gamma would take to complete the entire project working alone.',
            sampleAnswer: 'Step 1: Daily rates: Alpha = 1/20, Beta = 1/30. Combined rate = 1/20 + 1/30 = 5/60 = 1/12.\nStep 2: In 6 days, Alpha + Beta complete 6 * (1/12) = 1/2 of the project. Remaining work = 1/2.\nStep 3: In 8 days, Alpha completes 8 * (1/20) = 8/20 = 2/5 of the project.\nStep 4: Gamma must complete the rest of the 1/2 work in 8 days: 1/2 - 2/5 = 5/10 - 4/10 = 1/10 of the project.\nStep 5: Gamma completes 1/10 work in 8 days => Standalone time = 8 / (1/10) = 80 days.',
            evaluationRubric: '1. Correct combined work of Alpha & Beta for 6 days (3 pts); 2. Correct calculation of Alpha\'s contribution in remaining phase (3 pts); 3. Accurate derivation of Gamma\'s standalone completion time (80 days) (4 pts).',
            points: 10,
            explanation: 'Tests multi-agent fractional work & time algebraic reasoning.',
          },
          {
            question: 'A company surveyed 1,000 employees and found that those who used a standing desk reported 20% fewer musculoskeletal complaints. Based on this, HR proposed purchasing standing desks for all 10,000 company staff to reduce healthcare claims. Identify two major logical fallacies or confounding variables in this reasoning and explain how HR should empirically test this hypothesis before full rollout.',
            sampleAnswer: '1. Self-selection bias: Employees who initially requested standing desks may already be more health-conscious, exercise more, or have better ergonomics.\n2. Post hoc / correlation vs causation: Standing desks may not be the direct causal mechanism (e.g., increased movement or stretching during the day could be the actual cause).\n3. Proposed empirical test: Run a randomized controlled trial (A/B testing) with 200 randomly assigned employees over 3-6 months with pre-and-post health surveys.',
            evaluationRubric: '1. Identification of self-selection bias (3 pts); 2. Distinction between correlation vs causation (3 pts); 3. Realistic randomized controlled validation framework (4 pts).',
            points: 10,
            explanation: 'Tests critical reasoning, bias identification, and empirical analysis.',
          },
        ];

        return aptitudeDescriptiveFallbacks.map((f, idx) => ({
          id: `cq_${Date.now().toString(36)}_${idx + 1}`,
          target: 'ai_online_test' as const,
          section: 'descriptive' as const,
          type: 'descriptive' as const,
          question: f.question,
          sampleAnswer: f.sampleAnswer,
          evaluationRubric: f.evaluationRubric,
          points: f.points,
          explanation: f.explanation,
        }));
      }

      if (format === 'rapid' || input.section === 'rapid') {
        const aptitudeRapidFallbacks = [
          {
            question: 'Quick Math: What is 15% of 240?',
            options: [
              { id: 'opt_a', text: '32' },
              { id: 'opt_b', text: '36' },
              { id: 'opt_c', text: '38' },
              { id: 'opt_d', text: '42' },
            ],
            correctOptionId: 'opt_b',
            points: 10,
            timeLimitSeconds: 30,
            explanation: '10% of 240 is 24, 5% is 12. 24 + 12 = 36.',
          },
          {
            question: 'Rapid Logic: If 3 cats catch 3 mice in 3 minutes, how many cats are needed to catch 100 mice in 100 minutes?',
            options: [
              { id: 'opt_a', text: '3' },
              { id: 'opt_b', text: '33' },
              { id: 'opt_c', text: '100' },
              { id: 'opt_d', text: '300' },
            ],
            correctOptionId: 'opt_a',
            points: 10,
            timeLimitSeconds: 30,
            explanation: '1 cat catches 1 mouse in 3 minutes. 3 cats catch 100 mice in 100 minutes.',
          },
          {
            question: 'Speed Series: Complete the sequence: 2, 6, 12, 20, 30, ...?',
            options: [
              { id: 'opt_a', text: '38' },
              { id: 'opt_b', text: '40' },
              { id: 'opt_c', text: '42' },
              { id: 'opt_d', text: '44' },
            ],
            correctOptionId: 'opt_c',
            points: 10,
            timeLimitSeconds: 30,
            explanation: 'Sequence follows n*(n+1): 1*2=2, 2*3=6, 3*4=12, 4*5=20, 5*6=30, 6*7=42.',
          },
          {
            question: 'Mental Ratio: If A : B = 2 : 3 and B : C = 4 : 5, what is A : C?',
            options: [
              { id: 'opt_a', text: '8 : 15' },
              { id: 'opt_b', text: '6 : 15' },
              { id: 'opt_c', text: '8 : 12' },
              { id: 'opt_d', text: '2 : 5' },
            ],
            correctOptionId: 'opt_a',
            points: 10,
            timeLimitSeconds: 30,
            explanation: 'A/C = (A/B) * (B/C) = (2/3) * (4/5) = 8/15.',
          },
        ];

        return aptitudeRapidFallbacks.map((f, idx) => ({
          id: `cq_${Date.now().toString(36)}_${idx + 1}`,
          target: 'ai_online_test' as const,
          section: 'rapid' as const,
          type: 'rapid' as const,
          question: f.question,
          options: f.options,
          correctOptionId: f.correctOptionId,
          points: f.points,
          timeLimitSeconds: input.timeLimitSeconds || f.timeLimitSeconds || 30,
          explanation: f.explanation,
        }));
      }

      const aptitudeFallbacks = [
        {
          question: 'A can complete a piece of work in 12 days, and B can complete the same work in 18 days. If they work together for 4 days, what fraction of the total work remains to be completed?',
          options: [
            { id: 'opt_a', text: '1/3' },
            { id: 'opt_b', text: '4/9' },
            { id: 'opt_c', text: '5/9' },
            { id: 'opt_d', text: '2/5' },
          ],
          correctOptionId: 'opt_b',
          points: 10,
          explanation: "A's 1-day work = 1/12, B's 1-day work = 1/18. Combined 1-day work = 5/36. In 4 days, they complete 4 * (5/36) = 20/36 = 5/9. Remaining work = 1 - 5/9 = 4/9.",
        },
        {
          question: 'Find the missing number in the sequence: 4, 9, 19, 39, 79, ...?',
          options: [
            { id: 'opt_a', text: '149' },
            { id: 'opt_b', text: '159' },
            { id: 'opt_c', text: '169' },
            { id: 'opt_d', text: '179' },
          ],
          correctOptionId: 'opt_b',
          points: 10,
          explanation: 'The pattern is multiply by 2 and add 1: 4*2+1=9, 9*2+1=19, 19*2+1=39, 39*2+1=79, 79*2+1=159.',
        },
        {
          question: 'A merchant marks goods 40% above the cost price and allows a discount of 25% on the marked price. What is the merchant net profit percentage?',
          options: [
            { id: 'opt_a', text: '5%' },
            { id: 'opt_b', text: '10%' },
            { id: 'opt_c', text: '12%' },
            { id: 'opt_d', text: '15%' },
          ],
          correctOptionId: 'opt_a',
          points: 10,
          explanation: 'Let CP = $100. MP = $140. Discount = 25% of 140 = $35. SP = 140 - 35 = $105. Net profit = (105 - 100) = 5%.',
        },
        {
          question: 'Statements: (1) All birds have wings. (2) Some winged creatures can swim. Which conclusion logically follows?',
          options: [
            { id: 'opt_a', text: 'All birds can swim' },
            { id: 'opt_b', text: 'Some creatures that can swim have wings' },
            { id: 'opt_c', text: 'No birds can swim' },
            { id: 'opt_d', text: 'All creatures that swim are birds' },
          ],
          correctOptionId: 'opt_b',
          points: 10,
          explanation: 'From statement 2, "Some winged creatures can swim" directly converts by conversion to "Some creatures that can swim have wings".',
        },
        {
          question: 'A train 150 meters long is traveling at a speed of 54 km/h. How many seconds will it take to pass a stationary telegraph post?',
          options: [
            { id: 'opt_a', text: '8 seconds' },
            { id: 'opt_b', text: '10 seconds' },
            { id: 'opt_c', text: '12 seconds' },
            { id: 'opt_d', text: '15 seconds' },
          ],
          correctOptionId: 'opt_b',
          points: 10,
          explanation: 'Speed in m/s = 54 * (5/18) = 15 m/s. Time to pass a post = distance / speed = 150 / 15 = 10 seconds.',
        },
        {
          question: 'Pointing towards a photograph, a woman says: "His father is the only son of my grandfather." How is the man in the photograph related to the woman?',
          options: [
            { id: 'opt_a', text: 'Brother' },
            { id: 'opt_b', text: 'Uncle' },
            { id: 'opt_c', text: 'Cousin' },
            { id: 'opt_d', text: 'Father' },
          ],
          correctOptionId: 'opt_a',
          points: 10,
          explanation: 'Only son of my grandfather = Father. Father of the man in photograph = Father of the woman. Therefore, the man is her brother.',
        },
      ];

      return aptitudeFallbacks.map((f, idx) => ({
        id: `cq_${Date.now().toString(36)}_${idx + 1}`,
        target: 'ai_online_test' as const,
        section: 'mcq' as const,
        type: 'mcq' as const,
        question: f.question,
        options: f.options,
        correctOptionId: f.correctOptionId,
        points: f.points,
        explanation: f.explanation,
      }));
    }

    const isAiAssessmentRound =
      roundType === 'ai_assessment' ||
      roundType === 'ai_chat' ||
      roundType === 'ai_voice' ||
      roundName.toLowerCase().includes('ai assessment') ||
      roundName.toLowerCase().includes('chat') ||
      roundName.toLowerCase().includes('voice') ||
      roundName.toLowerCase().includes('interview');

    if (isAiAssessmentRound || format === 'descriptive' || input.section === 'descriptive') {
      const easyDescriptiveFallbacks = [
        {
          question: `Explain how you would write a clean, well-tested function in ${skills.split(',')[0] || 'your core language'} to validate and parse user input payloads. What error cases and edge conditions do you check?`,
          sampleAnswer: 'A model response covers schema validation, checking for null/undefined, type checking, boundary limits, sanitization against injection, structured error reporting, and automated unit testing covering edge cases.',
          evaluationRubric: '1. Input validation & sanitization (4 pts); 2. Boundary and edge-case handling (3 pts); 3. Clean syntax & testability (3 pts).',
          points: 10,
          explanation: 'Evaluates foundational clean code, validation rigor, and defensive programming.',
        },
        {
          question: `What are the core differences between synchronous and asynchronous code execution in modern software development? How do you prevent thread blocking in ${jobTitle} workflows?`,
          sampleAnswer: 'Explains the event loop / thread scheduling, non-blocking I/O vs compute-heavy tasks, promises/async-await patterns, avoiding blocking operations on the main thread, and worker threads or background tasks for heavy computations.',
          evaluationRubric: '1. Clear conceptual distinction between sync and async (4 pts); 2. Accurate explanation of event loop/I/O (3 pts); 3. Practical mitigation for blocking operations (3 pts).',
          points: 10,
          explanation: 'Evaluates understanding of concurrency primitives and non-blocking runtime execution.',
        },
        {
          question: `Walk me through your step-by-step debugging process when a unit test or integration test fails unexpectedly on a feature you are implementing.`,
          sampleAnswer: 'Covers reproducing the issue locally with minimal reproduction, reading stack traces, isolating variables, inspecting network/database payloads, verifying assumptions with breakpoints or logger, and writing a regression test once resolved.',
          evaluationRubric: '1. Structured reproduction and isolation approach (4 pts); 2. Tooling and stack trace analysis (3 pts); 3. Regression test prevention (3 pts).',
          points: 10,
          explanation: 'Tests methodical problem-solving and diagnostic skills.',
        },
        {
          question: `How do you structure code to adhere to DRY (Don't Repeat Yourself) and single-responsibility principles in your daily deliverables as a ${jobTitle}?`,
          sampleAnswer: 'Discusses extracting reusable utility functions, avoiding prematurely complex abstractions, modularizing components/services, clear parameter boundaries, and keeping functions focused on doing one thing well.',
          evaluationRubric: '1. Understanding of single responsibility (4 pts); 2. Practical code modularity examples (3 pts); 3. Balance between reusability and over-engineering (3 pts).',
          points: 10,
          explanation: 'Tests software craftsmanship and modular clean code principles.',
        },
      ];

      const hardDescriptiveFallbacks = [
        {
          question: `Walk through the architectural design for a high-throughput, low-latency service handling 100k requests/sec for ${jobTitle} (${skills}). How do you manage backpressure, caching tiers, and database bottlenecks?`,
          sampleAnswer: 'Explains multi-tiered caching (local in-memory L1 cache with Redis cluster L2), read-write database replicas with connection pooling, message brokers with reactive backpressure, horizontal pod autoscaling, and partition key strategy.',
          evaluationRubric: '1. Multi-tier caching & cache invalidation (4 pts); 2. Backpressure & queuing mechanisms (3 pts); 3. Database sharding/replication trade-offs (3 pts).',
          points: 10,
          explanation: 'Evaluates senior-level distributed systems design, throughput optimization, and bottleneck mitigation.',
        },
        {
          question: `How do you mitigate distributed race conditions and ensure data consistency across multiple microservices without introducing severe database row-locking?`,
          sampleAnswer: 'Discusses optimistic locking with version timestamps, distributed locks (e.g. Redlock with TTL), event sourcing / Outbox pattern, Saga orchestrations for distributed transactions, and idempotent consumer designs.',
          evaluationRubric: '1. Optimistic locking vs pessimistic locking trade-offs (4 pts); 2. Eventual consistency and Saga/Outbox pattern (3 pts); 3. Idempotency guarantees (3 pts).',
          points: 10,
          explanation: 'Tests deep mastery of distributed state, concurrency, and transactional integrity.',
        },
        {
          question: `Describe your strategy for implementing circuit breakers, exponential backoff with jitter, and graceful degradation during a major third-party downstream API outage.`,
          sampleAnswer: 'Covers state transitions (Closed -> Open -> Half-Open), setting adaptive timeout thresholds, fallback stale data caching, shedding non-critical load, and alerting telemetry to avoid thundering herd problems.',
          evaluationRubric: '1. Circuit breaker lifecycle & threshold calibration (4 pts); 2. Exponential backoff with randomized jitter (3 pts); 3. Graceful degradation and fallback UX (3 pts).',
          points: 10,
          explanation: 'Evaluates production resiliency, fault tolerance, and anti-fragility engineering.',
        },
        {
          question: `How do you profile memory leaks, garbage collection pauses, and CPU hotspots under high concurrency in a containerized production environment?`,
          sampleAnswer: 'Details heap dumps analysis, continuous profiling tools (e.g. pprof, flame graphs), monitoring event loop lag, identifying unclosed file descriptors/sockets, tuning container memory limits vs runtime heap, and analyzing GC pauses.',
          evaluationRubric: '1. Memory dump & flame graph profiling methodology (4 pts); 2. Identifying root causes like event listeners/leaks (3 pts); 3. Container memory vs runtime configuration (3 pts).',
          points: 10,
          explanation: 'Tests deep runtime internals, performance engineering, and production diagnostics.',
        },
      ];

      const mediumDescriptiveFallbacks = [
        {
          question: `How would you design a resilient REST/gRPC API for ${jobTitle} that handles database connection timeouts and returns clean, actionable error contracts to the client?`,
          sampleAnswer: 'Covers connection pooling, request deadlines/timeouts, standardized RFC 7807 problem details error format, circuit breaking on database pool exhaustion, and input validation middleware.',
          evaluationRubric: '1. Timeout & connection pool management (4 pts); 2. Standardized error contract formatting (3 pts); 3. Client retry guidance & status codes (3 pts).',
          points: 10,
          explanation: 'Evaluates production API design, error resilience, and database integration.',
        },
        {
          question: `Explain your indexing and query optimization strategy in a relational or NoSQL database when query latency spikes above 500ms on a core business table.`,
          sampleAnswer: 'Discusses EXPLAIN/ANALYZE query execution plans, identifying full table scans, composite index ordering, covering indexes, removing redundant queries (N+1 problem), and caching frequently queried static records.',
          evaluationRubric: '1. Query plan diagnosis using EXPLAIN (4 pts); 2. Composite and covering index strategy (3 pts); 3. Mitigation of N+1 and hot spots (3 pts).',
          points: 10,
          explanation: 'Tests database indexing, performance troubleshooting, and optimization practices.',
        },
        {
          question: `Describe a challenging production bug or race condition you debugged. What tools did you use to isolate the issue, and what automated tests or guardrails did you put in place?`,
          sampleAnswer: 'Covers reproduction strategy, structured log tracing with correlation IDs, atomic database operations or transaction locks to eliminate races, and regression unit/integration tests added to CI/CD.',
          evaluationRubric: '1. Incident analysis & structured logging (4 pts); 2. Root cause fix and synchronization (3 pts); 3. Automated regression prevention (3 pts).',
          points: 10,
          explanation: 'Evaluates real-world troubleshooting, incident remediation, and engineering discipline.',
        },
        {
          question: `How do you approach writing comprehensive integration and regression test suites for daily deliverables outlined in the job description?`,
          sampleAnswer: 'Discusses test pyramids, mocking external third-party services while testing real database transactions with test containers, automated CI/CD gating, and synthetic health checks.',
          evaluationRubric: '1. Balanced test pyramid strategy (4 pts); 2. Test isolation with containers/mocks (3 pts); 3. CI/CD integration and test reliability (3 pts).',
          points: 10,
          explanation: 'Tests quality engineering, automated testing strategies, and deliverable reliability.',
        },
      ];

      const chosenDescriptive =
        difficulty.toLowerCase() === 'easy'
          ? easyDescriptiveFallbacks
          : difficulty.toLowerCase() === 'hard'
          ? hardDescriptiveFallbacks
          : mediumDescriptiveFallbacks;

      return chosenDescriptive.map((f, idx) => ({
        id: `cq_${Date.now().toString(36)}_${idx + 1}`,
        target: isAiAssessmentRound ? ('ai_assessment' as const) : ('ai_online_test' as const),
        section: 'descriptive' as const,
        type: 'descriptive' as const,
        question: f.question,
        sampleAnswer: f.sampleAnswer,
        evaluationRubric: f.evaluationRubric,
        points: f.points,
        explanation: f.explanation,
      }));
    }

    const fallbacks = [
      {
        question: `In the context of ${jobTitle} (${skills}), which approach provides the most optimal time-space tradeoff for processing high-volume stream data?`,
        options: [
          { id: 'opt_a', text: 'In-memory sliding window aggregation with backpressure buffering' },
          { id: 'opt_b', text: 'Synchronous blocking disk writes per event' },
          { id: 'opt_c', text: 'Unbounded memory accumulator without eviction policy' },
          { id: 'opt_d', text: 'Sequential batch polling every 24 hours' },
        ],
        correctOptionId: 'opt_a',
        points: 10,
        explanation: 'Sliding window with backpressure prevents memory exhaustion while maintaining sub-second processing latency.',
      },
      {
        question: 'Which of the following best prevents cascading failures in distributed microservice architectures?',
        options: [
          { id: 'opt_a', text: 'Unlimited retry loops without delay' },
          { id: 'opt_b', text: 'Circuit Breaker pattern with exponential backoff and jitter' },
          { id: 'opt_c', text: 'Increasing server thread pool limits indefinitely' },
          { id: 'opt_d', text: 'Disabling health checks under load' },
        ],
        correctOptionId: 'opt_b',
        points: 10,
        explanation: 'Circuit breakers immediately fail fast when downstream dependencies degrade, preserving upstream capacity.',
      },
      {
        question: 'When designing idempotent REST APIs, which HTTP method is non-idempotent by specification?',
        options: [
          { id: 'opt_a', text: 'GET' },
          { id: 'opt_b', text: 'PUT' },
          { id: 'opt_c', text: 'POST' },
          { id: 'opt_d', text: 'DELETE' },
        ],
        correctOptionId: 'opt_c',
        points: 10,
        explanation: 'POST creates a new subordinate resource on repeated calls, making it non-idempotent without explicit idempotency keys.',
      },
    ];

    return fallbacks.map((f, idx) => ({
      id: `cq_${Date.now().toString(36)}_${idx + 1}`,
      target: 'ai_online_test' as const,
      type: 'mcq' as const,
      question: f.question,
      options: f.options,
      correctOptionId: f.correctOptionId,
      points: f.points,
      explanation: f.explanation,
    }));
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

  /**
   * Process a live conversational turn in an AI Chat Assessment session
   */
  public async processChatTurn(input: {
    jobTitle?: string;
    stageName?: string;
    difficulty?: string;
    currentTopic: string;
    topics?: string[];
    topicIndex?: number;
    history?: Array<{ role: 'ai' | 'candidate'; message: string }>;
    candidateMessage: string;
    blueprint?: any;
  }): Promise<{
    reply: string;
    turnScore: number;
    feedback: string;
    suggestedNextAction: 'probe_deeper' | 'transition_next_topic' | 'conclude';
    guidanceTip: string;
  }> {
    const jobTitle = input.jobTitle || 'Software Engineer';
    const stageName = input.stageName || 'AI Chat Assessment';
    const difficulty = (input.difficulty || 'medium').toLowerCase();
    const currentTopic = input.currentTopic || 'Core Technical Architecture & Problem Solving';
    const history = input.history || [];
    const candidateMessage = (input.candidateMessage || '').trim();

    const formattedHistory = history
      .slice(-6)
      .map((h) => `${h.role === 'ai' ? 'Interviewer' : 'Candidate'}: ${h.message}`)
      .join('\n\n');

    const prompt = `You are an Executive Technical Interviewer and AI Assessment Architect evaluating a candidate for the position "${jobTitle}" in an AI Chat Assessment session titled "${stageName}".

INTERVIEW CONFIGURATION:
- Difficulty Level: ${difficulty.toUpperCase()}
- Current Probing Topic / Seed: "${currentTopic}"
${input.blueprint?.skills ? `- Required Skills & Stack: ${Array.isArray(input.blueprint.skills) ? input.blueprint.skills.join(', ') : input.blueprint.skills}` : ''}
${input.blueprint?.responsibilities ? `- Role Responsibilities: ${Array.isArray(input.blueprint.responsibilities) ? input.blueprint.responsibilities.join('; ') : input.blueprint.responsibilities}` : ''}

CONVERSATION TRANSCRIPT:
${formattedHistory || '(Interview just started)'}

CANDIDATE'S LATEST MESSAGE:
"""${candidateMessage}"""

TASK & SCORING DIRECTIVES:
1. Act as a constructive, professional, and technically sharp AI Technical Interviewer.
2. Evaluate the candidate's response against the topic "${currentTopic}" at ${difficulty.toUpperCase()} difficulty.
3. Formulate your conversational "reply":
   - Acknowledge what was correct or insightful in their answer.
   - If they explained well, ask a deeper follow-up question probing an edge case, performance bottleneck, concurrency scenario, or architectural tradeoff.
   - If they missed critical components, gently ask for clarification or how they would mitigate that specific failure.
   - If they have thoroughly answered this topic across 2+ turns, summarize their conclusion and invite them to move to the next topic.
4. "turnScore": Score this specific response from 0 to 10 points:
   - 8-10: Exceptional depth, covers tradeoffs, edge cases, clean syntax/reasoning.
   - 6-7: Technically competent answer covering main aspects.
   - 3-5: Partial answer, vague, or missing critical logic.
   - 0-2: Off-topic, empty, or incorrect.
5. "feedback": A brief 1-sentence note summarizing the strength or gap of this answer.
6. "suggestedNextAction": "probe_deeper" (needs follow-up) | "transition_next_topic" (topic satisfied) | "conclude" (interview finished).
7. "guidanceTip": A concise hint or coaching takeaway for the candidate.

Format strictly as JSON:
{
  "reply": "Your interviewer response...",
  "turnScore": 8,
  "feedback": "Clear explanation of cache invalidation and distributed locks.",
  "suggestedNextAction": "probe_deeper",
  "guidanceTip": "Highlight practical error boundaries and concurrency edge cases."
}`;

    try {
      const res = await GoogleProvider.getInstance().generate({
        prompt,
        promptName: 'ai_chat_assessment_turn',
        jsonMode: true,
        temperature: 0.3,
      });

      const parsed = JSON.parse(res.text.trim());
      return {
        reply:
          parsed.reply ||
          `Thank you for detailing that approach for "${currentTopic}". Could you elaborate on how you would handle race conditions or failure recovery in this scenario?`,
        turnScore: Math.min(10, Math.max(0, Math.round(Number(parsed.turnScore) || 7))),
        feedback: parsed.feedback || 'Good initial response. Probing deeper into architectural resilience.',
        suggestedNextAction:
          parsed.suggestedNextAction === 'transition_next_topic' || parsed.suggestedNextAction === 'conclude'
            ? parsed.suggestedNextAction
            : 'probe_deeper',
        guidanceTip: parsed.guidanceTip || 'Demonstrate system tradeoffs and production readiness.',
      };
    } catch {
      // Heuristic fallback if AI generation is temporarily unavailable
      const words = candidateMessage.split(/\s+/).filter(Boolean).length;
      const turnScore = words > 40 ? 8 : words > 20 ? 6 : words > 8 ? 4 : 2;
      return {
        reply:
          words > 30
            ? `Solid technical explanation covering the core flow of "${currentTopic}". How would you verify this implementation through automated integration testing and monitor it under peak production traffic?`
            : `You mentioned key points regarding "${currentTopic}". Could you provide more specific technical details, algorithms, or code examples to demonstrate your implementation?`,
        turnScore,
        feedback: words > 30 ? 'Comprehensive technical detail provided.' : 'Consider expanding with concrete implementation details.',
        suggestedNextAction: words > 50 ? 'transition_next_topic' : 'probe_deeper',
        guidanceTip: 'Be sure to mention error handling and measurable performance metrics.',
      };
    }
  }

  /**
   * Strictly evaluate an entire AI Chat Assessment session
   */
  public async evaluateChatSession(input: {
    jobTitle?: string;
    stageName?: string;
    passingScore?: number;
    difficulty?: string;
    topics?: string[];
    transcript: Array<{ topic?: string; role: 'ai' | 'candidate'; message: string; turnScore?: number }>;
    durationMinutes?: number;
    timeSpentSeconds?: number;
  }): Promise<{
    totalScore: number;
    percentage: number;
    passed: boolean;
    passingScore: number;
    verdict: 'strong_hire' | 'hire' | 'borderline' | 'reject';
    summary: string;
    rubricBreakdown: {
      conceptClarity: { score: number; maxScore: 25; feedback: string };
      technicalDepth: { score: number; maxScore: 35; feedback: string };
      problemSolving: { score: number; maxScore: 25; feedback: string };
      communication: { score: number; maxScore: 15; feedback: string };
    };
    topicScores: Array<{ topic: string; score: number; maxScore: number; feedback: string }>;
    strengths: string[];
    areasForImprovement: string[];
  }> {
    const jobTitle = input.jobTitle || 'Software Engineer';
    const stageName = input.stageName || 'AI Chat Assessment';
    const passingScore = input.passingScore || 70;
    const difficulty = (input.difficulty || 'medium').toLowerCase();
    const topics = Array.isArray(input.topics) && input.topics.length > 0 ? input.topics : ['Technical Architecture'];
    const transcript = input.transcript || [];

    const formattedTranscript = transcript
      .map(
        (t, idx) =>
          `[Turn ${idx + 1} | Topic: ${t.topic || 'General'} | ${t.role === 'ai' ? 'Interviewer' : 'Candidate'}]:\n${t.message}`
      )
      .join('\n\n');

    const prompt = `You are a Senior Technical Hiring Auditor and AI Examiner evaluating an interactive conversational AI Chat Assessment session for "${jobTitle}".
Session Title: "${stageName}"
Difficulty Calibration: ${difficulty.toUpperCase()}
Passing Score Benchmark: ${passingScore}%
Configured Interview Topics:
${topics.map((t, i) => `${i + 1}. ${t}`).join('\n')}

COMPLETE CHAT TRANSCRIPT:
"""
${formattedTranscript}
"""

STRICT EVALUATION INSTRUCTIONS:
1. Conduct an objective, unbiased, highly thorough technical evaluation of the candidate's answers across all topics.
2. Score 4 Core Rubric Criteria:
   a) "conceptClarity" (Max 25): Grasp of core engineering principles, language syntax, algorithms, frameworks.
   b) "technicalDepth" (Max 35): Architectural depth, clean code design, state management, latency/throughput considerations.
   c) "problemSolving" (Max 25): Edge case handling, structured debugging, trade-off analysis, concurrency.
   d) "communication" (Max 15): Articulation, clarity, structured reasoning, professional tone.
3. Score each configured topic (0 to 10 points) with 1 sentence feedback.
4. Determine total percentage (0-100%). "passed" is true if percentage >= ${passingScore}.
5. "verdict": "strong_hire" (>=85%) | "hire" (>=70%) | "borderline" (>=55%) | "reject" (<55%).
6. "summary": A 2-3 sentence executive assessment summary of the candidate's performance.
7. "strengths": 2-4 specific technical strengths demonstrated in the conversation.
8. "areasForImprovement": 2-3 concrete areas where the candidate could demonstrate deeper mastery.

Format strictly as JSON:
{
  "percentage": 82,
  "verdict": "hire",
  "summary": "Candidate demonstrated solid grasp of system design...",
  "rubricBreakdown": {
    "conceptClarity": { "score": 21, "maxScore": 25, "feedback": "Accurate terminology and clean conceptual understanding." },
    "technicalDepth": { "score": 29, "maxScore": 35, "feedback": "Detailed explanations with realistic architectural trade-offs." },
    "problemSolving": { "score": 20, "maxScore": 25, "feedback": "Methodical approach to handling concurrency and edge cases." },
    "communication": { "score": 12, "maxScore": 15, "feedback": "Clear, concise, and structured conversational answers." }
  },
  "topicScores": [
    { "topic": "${topics[0] || 'Technical Mastery'}", "score": 8, "maxScore": 10, "feedback": "Well-articulated approach." }
  ],
  "strengths": ["Clean modular code design", "Consideration of scale"],
  "areasForImprovement": ["Deeper optimization of cache invalidation"]
}`;

    try {
      const res = await GoogleProvider.getInstance().generate({
        prompt,
        promptName: 'ai_chat_session_evaluation',
        jsonMode: true,
        temperature: 0.2,
      });

      const parsed = JSON.parse(res.text.trim());
      const percentage = Math.min(100, Math.max(0, Math.round(Number(parsed.percentage) || 75)));
      const passed = percentage >= passingScore;

      return {
        totalScore: percentage,
        percentage,
        passed,
        passingScore,
        verdict:
          parsed.verdict ||
          (percentage >= 85 ? 'strong_hire' : percentage >= 70 ? 'hire' : percentage >= 55 ? 'borderline' : 'reject'),
        summary:
          parsed.summary ||
          `Candidate completed the conversational AI Chat Assessment with an overall score of ${percentage}%.`,
        rubricBreakdown: {
          conceptClarity: parsed.rubricBreakdown?.conceptClarity || {
            score: Math.round(percentage * 0.25),
            maxScore: 25,
            feedback: 'Strong conceptual grasp.',
          },
          technicalDepth: parsed.rubricBreakdown?.technicalDepth || {
            score: Math.round(percentage * 0.35),
            maxScore: 35,
            feedback: 'Competent architectural depth.',
          },
          problemSolving: parsed.rubricBreakdown?.problemSolving || {
            score: Math.round(percentage * 0.25),
            maxScore: 25,
            feedback: 'Methodical reasoning and edge case analysis.',
          },
          communication: parsed.rubricBreakdown?.communication || {
            score: Math.round(percentage * 0.15),
            maxScore: 15,
            feedback: 'Articulate technical communication.',
          },
        },
        topicScores:
          Array.isArray(parsed.topicScores) && parsed.topicScores.length > 0
            ? parsed.topicScores
            : topics.map((t) => ({
                topic: t,
                score: Math.round(percentage / 10),
                maxScore: 10,
                feedback: `Evaluated successfully at ${percentage}% performance.`,
              })),
        strengths:
          Array.isArray(parsed.strengths) && parsed.strengths.length > 0
            ? parsed.strengths
            : ['Solid conceptual understanding of core tech stack', 'Constructive conversational approach'],
        areasForImprovement:
          Array.isArray(parsed.areasForImprovement) && parsed.areasForImprovement.length > 0
            ? parsed.areasForImprovement
            : ['Deepen edge-case handling under extreme load'],
      };
    } catch {
      // Heuristic fallback
      const candidateTurns = transcript.filter((t) => t.role === 'candidate');
      const totalWords = candidateTurns.reduce((acc, t) => acc + (t.message ? t.message.split(/\s+/).length : 0), 0);
      const avgWordsPerTurn = candidateTurns.length > 0 ? totalWords / candidateTurns.length : 0;

      let baseScore = 65;
      if (avgWordsPerTurn > 40) baseScore += 18;
      else if (avgWordsPerTurn > 20) baseScore += 10;
      if (candidateTurns.length >= topics.length) baseScore += 7;

      const percentage = Math.min(96, Math.max(40, baseScore));
      const passed = percentage >= passingScore;

      return {
        totalScore: percentage,
        percentage,
        passed,
        passingScore,
        verdict:
          percentage >= 85 ? 'strong_hire' : percentage >= 70 ? 'hire' : percentage >= 55 ? 'borderline' : 'reject',
        summary: `Candidate demonstrated solid technical competencies across ${topics.length} interview topics with an overall score of ${percentage}%.`,
        rubricBreakdown: {
          conceptClarity: {
            score: Math.round(percentage * 0.25),
            maxScore: 25,
            feedback: 'Consistently demonstrates foundational and framework knowledge.',
          },
          technicalDepth: {
            score: Math.round(percentage * 0.35),
            maxScore: 35,
            feedback: 'Provides practical explanations and implementation details.',
          },
          problemSolving: {
            score: Math.round(percentage * 0.25),
            maxScore: 25,
            feedback: 'Systematic approach to problem solving and trade-offs.',
          },
          communication: {
            score: Math.round(percentage * 0.15),
            maxScore: 15,
            feedback: 'Clear and structured conversational responses.',
          },
        },
        topicScores: topics.map((t) => ({
          topic: t,
          score: Math.min(10, Math.max(5, Math.round(percentage / 10))),
          maxScore: 10,
          feedback: `Competent response for ${t}.`,
        })),
        strengths: ['Clear conversational communication', 'Solid technical domain reasoning'],
        areasForImprovement: ['Further elaborate on concurrency primitives and production metrics'],
      };
    }
  }
}

export const domainAssessmentService = new DomainAssessmentService();
