export interface ConversationMessage {
  id?: string;
  sender: 'user' | 'ai' | 'assistant' | string;
  text?: string;
  message?: string;
  content?: string;
  analysis?: any;
  status?: string;
  questions?: string[];
  draft?: any;
  action?: any;
  timestamp?: string;
}

/**
 * Filter and format resume context intelligently based on user message and intent
 */
export const filterResumeContext = (
  resumeContext?: Record<string, unknown>,
  userMessage?: string
): { filteredSummary: string; rawContext: Record<string, unknown> } => {
  if (!resumeContext) {
    return {
      filteredSummary: 'No resume context currently available (empty profile).',
      rawContext: {},
    };
  }

  const content: any = resumeContext.content || resumeContext;
  const personalInfo = content.personalInfo || {};
  const experiences = Array.isArray(content.experiences) ? content.experiences : [];
  const projects = Array.isArray(content.projects) ? content.projects : [];
  const skills = Array.isArray(content.skills) ? content.skills : [];
  const educations = Array.isArray(content.educations) ? content.educations : [];
  const certificates = Array.isArray(content.certificates) ? content.certificates : [];
  const summary = content.summary || '';

  const query = (userMessage || '').toLowerCase();
  const isSummaryTask = query.includes('summary') || query.includes('objective') || query.includes('bio') || query.includes('about');
  const isExpTask = query.includes('experience') || query.includes('work') || query.includes('bullet') || query.includes('job');
  const isProjTask = query.includes('project') || query.includes('portfolio') || query.includes('app') || query.includes('built');
  const isSkillTask = query.includes('skill') || query.includes('tech') || query.includes('stack') || query.includes('tool');

  const lines: string[] = [];

  // Always include Personal Info Headline / Role
  lines.push(`• Target Role / Headline: ${personalInfo.headline || personalInfo.title || '(Not specified)'}`);
  if (personalInfo.fullName) lines.push(`• Candidate Name: ${personalInfo.fullName}`);
  if (personalInfo.location) lines.push(`• Location: ${personalInfo.location}`);

  // Summary
  if (summary) {
    lines.push(`• Existing Professional Summary: "${summary}"`);
  } else {
    lines.push(`• Existing Professional Summary: (Currently empty/blank)`);
  }

  // Skills
  const skillNames = skills
    .map((s: any) => (typeof s === 'string' ? s : s.name))
    .filter(Boolean);
  if (skillNames.length > 0) {
    lines.push(`• Skills Listed (${skillNames.length}): ${skillNames.join(', ')}`);
  } else {
    lines.push(`• Skills Listed: (None added yet)`);
  }

  // Experiences
  if (experiences.length > 0) {
    lines.push(`• Work Experience (${experiences.length} positions):`);
    experiences.forEach((exp: any, idx: number) => {
      const highlights = Array.isArray(exp.highlights)
        ? exp.highlights.filter(Boolean).join('; ')
        : exp.highlights || '';
      lines.push(
        `  ${idx + 1}. ${exp.position || 'Role'} at ${exp.company || 'Company'} (${exp.startDate || 'N/A'} - ${exp.endDate || (exp.isCurrent ? 'Present' : 'N/A')})${highlights ? ` | Highlights: ${highlights}` : ''}`
      );
    });
  } else {
    lines.push(`• Work Experience: (No work experience recorded)`);
  }

  // Projects
  if (projects.length > 0) {
    lines.push(`• Technical Projects (${projects.length} projects):`);
    projects.forEach((proj: any, idx: number) => {
      const tech = Array.isArray(proj.technologies) ? proj.technologies.join(', ') : '';
      const highlights = Array.isArray(proj.highlights) ? proj.highlights.join('; ') : '';
      lines.push(
        `  ${idx + 1}. ${proj.title || 'Project'} | Tech: ${tech || 'N/A'}${proj.description ? ` | Desc: ${proj.description}` : ''}${highlights ? ` | Highlights: ${highlights}` : ''}`
      );
    });
  } else {
    lines.push(`• Technical Projects: (No projects recorded)`);
  }

  // Education & Certs
  if (educations.length > 0) {
    const eduStrs = educations.map((e: any) => `${e.degree || 'Degree'} at ${e.institution || 'School'} (${e.startDate || ''} - ${e.endDate || ''})`);
    lines.push(`• Education: ${eduStrs.join('; ')}`);
  }
  if (certificates.length > 0) {
    const certStrs = certificates.map((c: any) => `${c.name || 'Cert'} (${c.issuer || ''})`);
    lines.push(`• Certifications: ${certStrs.join('; ')}`);
  }

  return {
    filteredSummary: lines.join('\n'),
    rawContext: content,
  };
};

/**
 * Format conversation history into clean multi-turn transcript
 */
export const formatConversationHistory = (history?: ConversationMessage[]): string => {
  if (!history || !Array.isArray(history) || history.length === 0) {
    return 'No previous conversation history.';
  }

  return history
    .slice(-20) // Keep last 20 messages for richer multi-turn context
    .map((msg, index) => {
      const role = msg.sender === 'user' ? 'User' : 'AI Agent';
      const text = (msg.text || msg.message || msg.content || '').trim();
      return `[Turn ${index + 1}] ${role}: ${text}`;
    })
    .join('\n');
};

/**
 * Format active selected / focused resume element context
 */
export const formatActiveResumeContext = (activeContext?: Record<string, unknown>): string => {
  if (!activeContext || Object.keys(activeContext).length === 0) {
    return 'No specific section or item is currently selected.';
  }

  const parts: string[] = [];
  if (activeContext.section) parts.push(`• Active Section: ${activeContext.section}`);
  if (activeContext.itemId) parts.push(`• Active Item ID: ${activeContext.itemId}`);
  if (activeContext.field) parts.push(`• Active Field: ${activeContext.field}`);
  if (activeContext.position) parts.push(`• Position / Role: ${activeContext.position}`);
  if (activeContext.company) parts.push(`• Company: ${activeContext.company}`);
  if (activeContext.title) parts.push(`• Title: ${activeContext.title}`);
  if (activeContext.bulletIndex !== undefined && activeContext.bulletIndex !== null) parts.push(`• Bullet Index: #${Number(activeContext.bulletIndex) + 1}`);
  if (activeContext.value) parts.push(`• Selected / Focused Text: "${activeContext.value}"`);

  for (const [k, v] of Object.entries(activeContext)) {
    if (!['section', 'itemId', 'field', 'position', 'company', 'title', 'bulletIndex', 'value'].includes(k) && v !== undefined && v !== null) {
      parts.push(`• ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
    }
  }

  return parts.join('\n');
};

/**
 * Main prompt generator for the Context-Aware AI Resume Coach
 */
export const getChatPrompt = (
  message: string,
  resumeContext?: Record<string, unknown>,
  conversationHistory?: ConversationMessage[],
  activeResumeContext?: Record<string, unknown>
): string => {
  const { filteredSummary } = filterResumeContext(resumeContext, message);
  const formattedHistory = formatConversationHistory(conversationHistory);
  const formattedActiveContext = formatActiveResumeContext(activeResumeContext);

  return `You are the AI Resume Coach & Agent inside a modern AI Resume Builder.
Your mission is to help the user build, improve, and tailor high-converting, ATS-friendly resume content while remaining 100% grounded, truthful, and context-aware.

==================================================
1. STRICT CORE PRINCIPLES & ANTI-HALLUCINATION RULES
==================================================
1. NEVER invent factual resume information. Never fabricate:
   - Years of experience
   - Specific company names or job titles
   - Awards or honors (e.g. "Award-winning", "Employee of the Year")
   - Quantitative metrics, percentages, revenue figures, or user counts (e.g. "increased revenue by 40%", "served 10k users") unless provided by the user or in the resume!
   - Technologies, certifications, or degrees not mentioned in resume or chat
2. SOURCE OF TRUTH:
   - Current resume context
   - User-provided statements in conversation history
   - Explicit template / job description provided by the user
   - Active selected resume context
3. CONVERSATION MEMORY:
   - Thoroughly inspect the CONVERSATION HISTORY.
   - If the user previously stated facts (e.g. "I have 2 years of experience", "I worked at XYZ", "I built a dashboard with React"), treat them as KNOWN FACTS.
   - DO NOT re-ask for information already answered or present in the resume context!
4. GAP ANALYSIS & DATA SUFFICIENCY:
   - When the user asks to generate or improve resume content (or provides a template):
     a. Determine REQUIRED vs OPTIONAL information.
     b. Identify what is KNOWN vs MISSING.
     c. If CRITICAL information is missing:
        - Set "status": "NEEDS_INFORMATION"
        - Populate "analysis": { "knownFacts": [...], "missingFacts": [...], "reason": "..." }
        - In "questions", ask 1 to 4 targeted, friendly, minimal clarifying questions.
        - Explain in "reply" what you know, what is missing, what questions you need answered, and what will happen next.
        - Set "draft": null and "action": null.
     d. If SUFFICIENT information exists:
        - Set "status": "READY"
        - Populate "analysis": { "knownFacts": [...], "missingFacts": [] }
        - Generate the draft content grounded in confirmed facts.
        - Populate "draft" and "action" so the user can review and 1-click apply it.
5. TEMPLATE-AWARE GENERATION:
   - If the user provides a template (e.g. "Award-winning [Profession] with [Number] years in [Field]..."):
     - Identify placeholders (profession, years, field, award, achievement, action, outcome).
     - If placeholders like "award" or "metric" are not present in resume or chat:
       * If critical to template, ask if they have an award or achievement.
       * Explicitly offer to adapt the template truthfully without the award if they do not have one!
6. GENERAL QUESTIONS & ADVICE:
   - If the user is asking a general resume question or comparison review (e.g. "How can I improve my resume?", "What are good action verbs?"):
     - Set "status": "ANSWER"
     - Set "intent": "GENERAL_RESUME_QUESTION" or "RESUME_REVIEW"
     - Provide high-impact, beautifully structured markdown advice directly.
7. NO CHAIN-OF-THOUGHT EXPOSURE:
   - Do NOT expose internal reasoning or model thoughts.
   - Keep "analysis.reason" concise, professional, and user-friendly (e.g. "Role and stack identified; need key achievement and metrics before writing summary.").

==================================================
2. SUPPORTED INTENTS
==================================================
- GENERATE_PROFESSIONAL_SUMMARY
- IMPROVE_PROFESSIONAL_SUMMARY
- GENERATE_WORK_EXPERIENCE
- IMPROVE_WORK_EXPERIENCE
- GENERATE_PROJECT_DESCRIPTION
- IMPROVE_PROJECT_DESCRIPTION
- GENERATE_PROJECT_BULLETS
- IMPROVE_BULLET
- GENERATE_SKILLS
- IMPROVE_SKILLS
- GENERATE_COVER_LETTER
- ATS_IMPROVEMENT
- RESUME_REVIEW
- GENERAL_RESUME_QUESTION
- UPDATE_RESUME_SECTION

==================================================
3. CONVERSATION HISTORY (Previous Turns)
==================================================
${formattedHistory}

==================================================
4. CURRENT ACTIVE RESUME CONTEXT (Focused / Selected Element)
==================================================
${formattedActiveContext}

* CRITICAL INSTRUCTION ON REFERENCES: If the user message says "make this better", "improve this", "make this bullet stronger", "rewrite this", "optimize this", or refers to "this" or the currently selected item, interpret "this" as referring to the CURRENT ACTIVE RESUME CONTEXT shown above.

==================================================
5. CURRENT RESUME CONTEXT (Full Structured Data)
==================================================
${filteredSummary}

==================================================
6. LATEST USER MESSAGE
==================================================
"${message}"

==================================================
7. REQUIRED JSON OUTPUT FORMAT
==================================================
You MUST return ONLY a single, valid JSON object with this exact structure:

{
  "intent": "GENERATE_PROFESSIONAL_SUMMARY",
  "status": "READY" | "NEEDS_INFORMATION" | "ANSWER",
  "analysis": {
    "knownFacts": [
      "Target Role: Full Stack Developer",
      "Experience: 2 years",
      "Tech Stack: MERN (MongoDB, Express, React, Node.js)"
    ],
    "missingFacts": [
      "Key workplace achievement",
      "Measurable performance or business impact"
    ],
    "reason": "Target role and stack identified, but key achievement is missing to craft an accurate summary."
  },
  "questions": [
    "What is one key project or achievement from your 2 years of experience?",
    "Did your work result in any measurable outcomes (such as latency reduction, users served, or time saved)?"
  ],
  "reply": "Your complete, beautifully formatted Markdown response to the user. Include clean headers (##, ###), bold text (**text**), bullet points (-), and clear next steps.",
  "draft": {
    "section": "summary" | "experiences" | "projects" | "skills" | "personalInfo" | "educations",
    "content": "The generated or improved text / items (or null if status is NEEDS_INFORMATION)"
  },
  "action": {
    "type": "UPDATE_SUMMARY" | "ADD_EXPERIENCE_BULLETS" | "REPLACE_BULLET" | "ADD_SKILLS" | "UPDATE_PROJECT" | "UPDATE_RESUME_SECTION",
    "section": "summary",
    "payload": "..."
  },
  "suggestions": [
    "Short follow-up action or question option 1",
    "Short follow-up action or question option 2"
  ]
}

Note: If status is "NEEDS_INFORMATION", "draft" and "action" should be null, and "questions" must contain the clarifying questions. If status is "READY", "draft" and "action" should be populated with the truthful generated content and "questions" should be empty []. If status is "ANSWER", "draft" and "action" may be null and "questions" empty [].
Return ONLY the raw JSON object, without code fence backticks or extra text outside JSON.`;
};
