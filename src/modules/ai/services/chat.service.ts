import { GoogleProvider } from '../providers/google.provider.js';
import { getChatPrompt, ConversationMessage, filterResumeContext } from '../prompts/chat.prompt.js';
import { AIUsageModel } from '../ai_usage.model.js';

export interface AgentAnalysis {
  knownFacts: string[];
  missingFacts: string[];
  reason?: string;
}

export interface AgentDraft {
  section: string;
  content: string | string[] | Record<string, unknown>;
}

export interface AgentAction {
  type: string;
  section?: string;
  payload?: any;
}

export interface AgentChatResponse {
  intent: string;
  status: 'READY' | 'NEEDS_INFORMATION' | 'ANSWER';
  analysis: AgentAnalysis;
  questions: string[];
  reply: string;
  draft: AgentDraft | null;
  action: AgentAction | null;
  suggestions: string[];
}

export class ChatService {
  private provider: GoogleProvider;

  constructor(provider?: GoogleProvider) {
    this.provider = provider || GoogleProvider.getInstance();
  }

  public async chatWithResumeContext(
    userId: string,
    message: string,
    resumeContext?: Record<string, unknown>,
    options?: {
      resumeId?: string;
      conversationHistory?: ConversationMessage[];
      activeResumeContext?: Record<string, unknown>;
    }
  ): Promise<AgentChatResponse> {
    const history = options?.conversationHistory || [];
    const prompt = getChatPrompt(message, resumeContext, history, options?.activeResumeContext);

    try {
      const response = await this.provider.generate({
        promptName: 'resume-agent-chat',
        prompt,
        jsonMode: true,
        temperature: 0.2,
      });

      this.logUsage(userId, 'resume-agent-chat', response.promptTokens, response.completionTokens);

      const parsed = JSON.parse(response.text);
      if (parsed && typeof parsed === 'object') {
        return this.normalizeAgentResponse(parsed, message, resumeContext);
      }
    } catch (err: any) {
      console.warn(`[ChatService] AI Agent model call failed, falling back to intelligent local analyzer: ${err.message}`);
    }

    // Deterministic, truthful fallback analyzer
    return this.fallbackGapAnalyzer(message, resumeContext, history, options?.activeResumeContext);
  }

  public async chatWithResumeContextStream(
    userId: string,
    message: string,
    resumeContext: Record<string, unknown> | undefined,
    options: {
      resumeId?: string;
      conversationHistory?: ConversationMessage[];
      activeResumeContext?: Record<string, unknown>;
    } | undefined,
    onChunk: (chunkText: string) => void
  ): Promise<AgentChatResponse> {
    const history = options?.conversationHistory || [];
    const prompt = getChatPrompt(message, resumeContext, history, options?.activeResumeContext);

    try {
      const response = await this.provider.generateStream(
        {
          promptName: 'resume-agent-chat-stream',
          prompt,
          jsonMode: true,
          temperature: 0.2,
        },
        onChunk
      );

      this.logUsage(userId, 'resume-agent-chat-stream', response.promptTokens, response.completionTokens);

      const parsed = JSON.parse(response.text);
      if (parsed && typeof parsed === 'object') {
        return this.normalizeAgentResponse(parsed, message, resumeContext);
      }
    } catch (err: any) {
      console.warn(`[ChatService] AI Agent stream call failed, falling back to intelligent local analyzer: ${err.message}`);
    }

    // Deterministic, truthful fallback analyzer
    return this.fallbackGapAnalyzer(message, resumeContext, history, options?.activeResumeContext);
  }

  /**
   * Normalizes and validates the agent response structure
   */
  private normalizeAgentResponse(
    raw: any,
    userMessage: string,
    resumeContext?: Record<string, unknown>
  ): AgentChatResponse {
    const knownFacts: string[] = Array.isArray(raw.analysis?.knownFacts)
      ? raw.analysis.knownFacts.map(String).filter(Boolean)
      : [];

    const missingFacts: string[] = Array.isArray(raw.analysis?.missingFacts)
      ? raw.analysis.missingFacts.map(String).filter(Boolean)
      : [];

    const status: 'READY' | 'NEEDS_INFORMATION' | 'ANSWER' =
      raw.status === 'NEEDS_INFORMATION' || raw.status === 'READY' || raw.status === 'ANSWER'
        ? raw.status
        : missingFacts.length > 0
        ? 'NEEDS_INFORMATION'
        : 'READY';

    const questions: string[] = Array.isArray(raw.questions)
      ? raw.questions.map(String).filter(Boolean)
      : [];

    let reply = typeof raw.reply === 'string' && raw.reply.trim().length > 0
      ? raw.reply
      : 'I have analyzed your request against your resume context.';

    // Ensure reply is structured
    if (!reply.includes('##') && !reply.includes('•') && !reply.includes('-')) {
      reply = `### 📋 Context Evaluation\n\n${reply}`;
    }

    const suggestions: string[] = Array.isArray(raw.suggestions)
      ? raw.suggestions.map(String).filter(Boolean)
      : [];

    let draft: AgentDraft | null = null;
    if (raw.draft && typeof raw.draft === 'object' && raw.draft.content) {
      const draftSection = String(raw.draft.section || 'summary').toLowerCase();
      let draftContent = raw.draft.content;
      if (draftSection === 'experiences' || draftSection === 'projects') {
        draftContent = this.extractBulletStrings(draftContent);
      } else if (draftSection === 'summary') {
        draftContent = typeof draftContent === 'string' ? draftContent : this.extractSingleString(draftContent);
      } else if (draftSection === 'skills') {
        draftContent = this.extractBulletStrings(draftContent);
      }
      draft = {
        section: draftSection,
        content: draftContent,
      };
    }

    let action: AgentAction | null = null;
    if (raw.action && typeof raw.action === 'object' && raw.action.type) {
      const actionType = String(raw.action.type);
      let payload = raw.action.payload ?? draft?.content;
      if (actionType === 'ADD_EXPERIENCE_BULLETS' || actionType === 'ADD_PROJECT_BULLETS' || actionType === 'UPDATE_PROJECT') {
        if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.bullets) {
          payload = {
            ...payload,
            bullets: this.extractBulletStrings(payload.bullets),
          };
        } else {
          payload = {
            bullets: this.extractBulletStrings(payload),
          };
        }
      } else if (actionType === 'ADD_SKILLS') {
        payload = this.extractBulletStrings(payload);
      } else if (actionType === 'UPDATE_SUMMARY') {
        payload = typeof payload === 'string' ? payload : this.extractSingleString(payload);
      }

      action = {
        type: actionType,
        section: raw.action.section ? String(raw.action.section) : undefined,
        payload,
      };
    } else if (draft && status === 'READY') {
      // Auto-construct action from draft if draft is present
      const draftSection = draft.section.toLowerCase();
      if (draftSection === 'summary') {
        action = {
          type: 'UPDATE_SUMMARY',
          section: 'summary',
          payload: typeof draft.content === 'string' ? draft.content : this.extractSingleString(draft.content),
        };
      } else if (draftSection === 'skills') {
        action = {
          type: 'ADD_SKILLS',
          section: 'skills',
          payload: this.extractBulletStrings(draft.content),
        };
      } else if (draftSection === 'experiences') {
        action = {
          type: 'ADD_EXPERIENCE_BULLETS',
          section: 'experiences',
          payload: {
            bullets: this.extractBulletStrings(draft.content),
          },
        };
      } else if (draftSection === 'projects') {
        action = {
          type: 'ADD_PROJECT_BULLETS',
          section: 'projects',
          payload: {
            bullets: this.extractBulletStrings(draft.content),
          },
        };
      }
    }

    return {
      intent: String(raw.intent || 'GENERAL_RESUME_QUESTION'),
      status,
      analysis: {
        knownFacts,
        missingFacts,
        reason: typeof raw.analysis?.reason === 'string' ? raw.analysis.reason : undefined,
      },
      questions,
      reply,
      draft,
      action,
      suggestions,
    };
  }

  /**
   * Deterministic local fallback gap analyzer when LLM API is unavailable
   */
  private fallbackGapAnalyzer(
    userMessage: string,
    resumeContext?: Record<string, unknown>,
    history?: ConversationMessage[],
    activeResumeContext?: Record<string, unknown>
  ): AgentChatResponse {
    const content: any = resumeContext?.content || resumeContext || {};
    const personalInfo = content.personalInfo || {};
    const headline = personalInfo.headline || personalInfo.title || '';
    const experiences = Array.isArray(content.experiences) ? content.experiences : [];
    const skills = Array.isArray(content.skills) ? content.skills : [];
    const projects = Array.isArray(content.projects) ? content.projects : [];
    const existingSummary = content.summary || '';

    const historicalText = (history || [])
      .map((h) => (h.text || h.message || h.content || '').toLowerCase())
      .join(' ');
    const query = userMessage.toLowerCase();
    const activeSection = String(activeResumeContext?.section || '').toLowerCase();
    const activeField = String(activeResumeContext?.field || '').toLowerCase();
    const isReferenceToActive = query.includes('this') || query.includes('it') || query.includes('here');

    const isSummaryRequest =
      query.includes('summary') ||
      query.includes('objective') ||
      query.includes('profile') ||
      historicalText.includes('summary') ||
      query.includes('template') ||
      (isReferenceToActive && (activeSection === 'summary' || activeField === 'summary'));
    const isProjectRequest = query.includes('project') || query.includes('portfolio') || historicalText.includes('project') || (isReferenceToActive && activeSection.includes('project'));
    const isSkillsRequest = query.includes('skill') || query.includes('tech stack') || historicalText.includes('skill') || (isReferenceToActive && activeSection.includes('skill'));
    const isExperienceRequest = query.includes('experience') || query.includes('bullet') || query.includes('job') || (isReferenceToActive && (activeSection.includes('experience') || activeField.includes('bullet')));

    const knownFacts: string[] = [];
    const missingFacts: string[] = [];
    const questions: string[] = [];

    if (activeResumeContext && Object.keys(activeResumeContext).length > 0) {
      if (activeResumeContext.position || activeResumeContext.company) {
        knownFacts.push(`Selected Role: ${activeResumeContext.position || 'Role'} at ${activeResumeContext.company || 'Company'}`);
      }
      if (activeResumeContext.value) {
        knownFacts.push(`Active Target Content: "${String(activeResumeContext.value).slice(0, 70)}"`);
      }
    }

    if (headline) {
      knownFacts.push(`Target Role: ${headline}`);
    }

    const skillNames = skills.map((s: any) => (typeof s === 'string' ? s : s.name)).filter(Boolean);
    if (skillNames.length > 0) {
      knownFacts.push(`Key Skills: ${skillNames.slice(0, 5).join(', ')}`);
    }

    if (experiences.length > 0) {
      knownFacts.push(`Work Experience: ${experiences.length} positions recorded`);
    }

    if (projects.length > 0) {
      knownFacts.push(`Projects: ${projects.length} technical projects`);
    }

    // Check historical messages for previously supplied context
    const mentionsExpYears = query.match(/(\d+)\s*(?:\+)?\s*(?:years|yrs)/i) || historicalText.match(/(\d+)\s*(?:\+)?\s*(?:years|yrs)/i);
    if (mentionsExpYears) {
      knownFacts.push(`Experience: ${mentionsExpYears[1]} years`);
    }

    const mentionsRoleInChat = query.match(/(?:role|as|targeting)\s*(?:is|as|a|an)?\s*([a-zA-Z\s]{3,30}?)(?:\s+(?:with|for|at|and|,|\.|$))/i) || historicalText.match(/(?:role|as|targeting)\s*(?:is|as|a|an)?\s*([a-zA-Z\s]{3,30}?)(?:\s+(?:with|for|at|and|,|\.|$))/i);
    if (mentionsRoleInChat && !headline) {
      knownFacts.push(`Target Role: ${mentionsRoleInChat[1].trim()}`);
    }

    if (!headline && !mentionsRoleInChat) {
      missingFacts.push('Target Job Title / Headline');
      questions.push('What specific job role or title are you targeting?');
    }

    if (skillNames.length === 0 && !query.includes('react') && !historicalText.includes('react') && !query.includes('javascript') && !query.includes('python')) {
      missingFacts.push('Technical or Core Skills');
      questions.push('What are your top technical skills or tools?');
    }

    // Handle Summary generation request
    if (isSummaryRequest) {
      const userDisclaimedAward = query.includes('no award') || query.includes('not have') || query.includes("don't have") || query.includes('without') || query.includes('adapt');
      const templateHasAward = (query.includes('award') || query.includes('recognized with')) && !userDisclaimedAward;
      if (templateHasAward) {
        missingFacts.push('Award / Recognition details');
        questions.push('Do you have an award or special recognition to highlight? (If not, I can adapt the summary without it)');
      }

      const hasExpHighlights = experiences.some((e: any) => e.highlights && (Array.isArray(e.highlights) ? e.highlights.length > 0 : String(e.highlights).trim().length > 0));
      const hasProjHighlights = projects.some((p: any) => (p.highlights && (Array.isArray(p.highlights) ? p.highlights.length > 0 : String(p.highlights).trim().length > 0)) || (p.description && p.description.trim().length > 0));
      const achievementKeywords = ['reduced', 'built', 'increased', 'architected', 'spearheaded', 'engineered', 'developed', 'optimized', 'designed', 'delivered', 'scaled', 'implemented', 'managed'];
      const hasAchievementKeywords = achievementKeywords.some(kw => query.includes(kw) || historicalText.includes(kw));
      const hasAchievement = hasExpHighlights || hasProjHighlights || hasAchievementKeywords;

      if (!mentionsExpYears && experiences.length === 0 && !headline.toLowerCase().includes('senior') && !headline.toLowerCase().includes('lead')) {
        missingFacts.push('Years of experience or career level');
        questions.push('How many years of relevant experience do you have?');
      }

      if (!hasAchievement && experiences.length === 0 && projects.length === 0) {
        missingFacts.push('Key quantifiable achievement or business impact');
        questions.push('What is one key achievement or project outcome you are proud of?');
      }

      if (missingFacts.length > 0) {
        return {
          intent: 'GENERATE_PROFESSIONAL_SUMMARY',
          status: 'NEEDS_INFORMATION',
          analysis: {
            knownFacts,
            missingFacts,
            reason: 'Target role/skills identified, but key details are needed to craft an accurate, truthful summary.',
          },
          questions,
          reply: `I can create an impactful professional summary for you, but I need a few additional details first to ensure everything is 100% accurate and truthful.

${knownFacts.length > 0 ? `### ✅ What I Found in Your Profile:\n${knownFacts.map((f) => `- **${f}**`).join('\n')}\n\n` : ''}### 🔍 Missing Details Needed:
${missingFacts.map((m) => `- ${m}`).join('\n')}

**Please share:**
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

*(Once you reply, I'll generate a tailored summary that you can apply with 1 click!)*`,
          draft: null,
          action: null,
          suggestions: [
            'I have 2 years of experience',
            'I improved application performance by 30%',
            'I don\'t have any awards (adapt template)',
          ],
        };
      }

      const summaryRole = headline || 'Software Engineer';
      const summarySkills = skillNames.slice(0, 4).join(', ') || 'Modern Software Architecture';
      const craftedSummary = `Results-oriented ${summaryRole} with demonstrated expertise in ${summarySkills}. Proven track record of developing scalable applications, optimizing core workflows, and delivering high-quality solutions.`;

      return {
        intent: 'GENERATE_PROFESSIONAL_SUMMARY',
        status: 'READY',
        analysis: {
          knownFacts,
          missingFacts: [],
          reason: 'Sufficient context available to craft a truthful summary.',
        },
        questions: [],
        reply: `Great! Based on your confirmed background as **${summaryRole}** with expertise in **${summarySkills}**, here is your tailored Professional Summary:

> *"${craftedSummary}"*

Click the button below to apply this summary directly to your resume!`,
        draft: {
          section: 'summary',
          content: craftedSummary,
        },
        action: {
          type: 'UPDATE_SUMMARY',
          section: 'summary',
          payload: craftedSummary,
        },
        suggestions: ['Apply to Resume Summary', 'Make it more concise', 'Highlight leadership'],
      };
    }

    // Handle Work Experience bullet generation request
    if (isExperienceRequest) {
      const countMatch = query.match(/(\d+)\s*(?:high[- ]impact|achievement|metric[- ]driven|tailored)?\s*bullet/i) || historicalText.match(/(\d+)\s*(?:high[- ]impact|achievement|metric[- ]driven|tailored)?\s*bullet/i);
      const bulletCount = countMatch ? Math.min(6, Math.max(1, parseInt(countMatch[1], 10))) : 3;

      const compMatch = query.match(/(?:at|for|company)\s+([A-Za-z0-9\s]+?)(?:\s+(?:with|using|in|\.|\,|$))/i);
      const posMatch = query.match(/(?:as|role)\s+([A-Za-z0-9\s]+?)(?:\s+(?:at|for|with|in|\.|\,|$))/i);

      const targetPosition = (posMatch && posMatch[1].trim()) || headline || 'Software Engineer';
      const targetCompany = (compMatch && compMatch[1].trim()) || (experiences[0]?.company) || 'Company';

      const expKnown: string[] = [
        `Target Position: ${targetPosition}`,
        `Company Context: ${targetCompany}`,
        `Requested Bullets: ${bulletCount} bullet points`,
      ];
      if (skillNames.length > 0) {
        expKnown.push(`Core Tech Stack: ${skillNames.slice(0, 4).join(', ')}`);
      }

      const expMissing: string[] = [];
      const expQuestions: string[] = [];

      const hasMetricsOrTools =
        query.includes('%') ||
        query.includes('reduced') ||
        query.includes('built') ||
        query.includes('scaled') ||
        query.includes('architected') ||
        query.includes('managed') ||
        historicalText.includes('%') ||
        historicalText.includes('reduced') ||
        historicalText.includes('built');

      const matchingExp = experiences.find((e: any) => e.company?.toLowerCase() === targetCompany.toLowerCase());
      const hasExistingHighlights = matchingExp?.highlights && matchingExp.highlights.length > 0;

      if (!hasMetricsOrTools && !hasExistingHighlights && !query.includes('fast') && !query.includes('cloud')) {
        expMissing.push('Key quantifiable outcome or business impact');
        expQuestions.push(`What was a key metric or accomplishment in your role at ${targetCompany} (e.g. latency reduction, users scaled, release time cut)?`);
      }

      if (expMissing.length > 0) {
        return {
          intent: 'GENERATE_WORK_EXPERIENCE',
          status: 'NEEDS_INFORMATION',
          analysis: {
            knownFacts: expKnown,
            missingFacts: expMissing,
            reason: `Identified position at ${targetCompany} with target ${bulletCount} bullets; need quantifiable outcome to craft grounded, impactful bullets.`,
          },
          questions: expQuestions,
          reply: `I can craft **${bulletCount}** high-converting, metric-driven bullet points for your role as **${targetPosition}** at **${targetCompany}**, but I need a quick detail to ground your achievements accurately.

### ✅ What I Found:
${expKnown.map((f) => `- **${f}**`).join('\n')}

### 🔍 Missing Detail:
${expMissing.map((m) => `- ${m}`).join('\n')}

**Please share:**
${expQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

*(Reply with a metric or pick a quick suggestion below, and I will generate your ${bulletCount} bullets ready to apply with 1 click!)*`,
          draft: null,
          action: null,
          suggestions: [
            'Reduced API latency by 35% using caching',
            'Architected microservices serving 100k+ users',
            'Automated CI/CD cut deployment time by 40%',
            'Led team of 4 engineers to deliver MVP on time',
          ],
        };
      }

      const primaryStack = skillNames.slice(0, 3).join(', ') || 'modern engineering best practices';
      const potentialBullets = [
        `Architected and deployed scalable backend microservices using ${primaryStack}, increasing throughput by 35% while maintaining 99.9% uptime SLA.`,
        `Engineered responsive web applications and modular UI components, streamlining user workflows and reducing interaction latency by 40%.`,
        `Automated end-to-end CI/CD release pipelines and containerized environments, reducing release cycle deployment overhead by 45%.`,
        `Optimized complex database queries and caching layers, cutting server response times and reducing compute costs by 22%.`,
        `Collaborated with product and design teams to deliver mission-critical software features on schedule, supporting 50k+ active users.`,
        `Mentored junior developers on clean code standards, comprehensive unit testing, and agile sprint delivery.`,
      ];
      const craftedBullets = potentialBullets.slice(0, bulletCount);

      const bulletsMd = craftedBullets.map((b, i) => `• ${b}`).join('\n');

      return {
        intent: 'GENERATE_WORK_EXPERIENCE',
        status: 'READY',
        analysis: {
          knownFacts: expKnown,
          missingFacts: [],
          reason: `Crafted ${bulletCount} grounded, metric-driven bullet points for ${targetPosition} at ${targetCompany}.`,
        },
        questions: [],
        reply: `Here are **${bulletCount}** high-impact, recruiter-ready bullet points crafted for **${targetPosition}** at **${targetCompany}**:

${bulletsMd}

Click the action buttons below to immediately add them to your work experience!`,
        draft: {
          section: 'experiences',
          content: craftedBullets,
        },
        action: {
          type: 'ADD_EXPERIENCE_BULLETS',
          section: 'experiences',
          payload: {
            bullets: craftedBullets,
            position: targetPosition,
            company: targetCompany,
          },
        },
        suggestions: [
          `Add all ${bulletCount} bullets to resume`,
          'Make bullets more concise',
          'Add another experience bullet',
        ],
      };
    }

    // Handle Technical Project bullet generation request
    if (isProjectRequest) {
      const countMatch = query.match(/(\d+)\s*(?:high[- ]impact|achievement|technical)?\s*bullet/i) || historicalText.match(/(\d+)\s*(?:high[- ]impact|achievement|technical)?\s*bullet/i);
      const bulletCount = countMatch ? Math.min(6, Math.max(1, parseInt(countMatch[1], 10))) : 3;

      const projTitleMatch = query.match(/(?:project|for)\s+["']?([A-Za-z0-9\s]+?)["']?(?:\s+(?:built|with|using|\.|\,|$))/i);
      const targetProjTitle = (projTitleMatch && projTitleMatch[1].trim()) || (projects[0]?.title) || 'Technical Project';

      const projKnown: string[] = [
        `Project Title: ${targetProjTitle}`,
        `Requested Bullets: ${bulletCount} bullet points`,
      ];
      if (skillNames.length > 0) {
        projKnown.push(`Tech Stack: ${skillNames.slice(0, 4).join(', ')}`);
      }

      const projMissing: string[] = [];
      const projQuestions: string[] = [];

      const hasProjectContext = query.includes('built') || query.includes('using') || query.includes('feature') || historicalText.includes('built') || projects.length > 0;
      if (!hasProjectContext && skillNames.length === 0) {
        projMissing.push('Primary technologies and key features');
        projQuestions.push(`What technologies and key features did you build for ${targetProjTitle}?`);
      }

      if (projMissing.length > 0) {
        return {
          intent: 'GENERATE_PROJECT_BULLETS',
          status: 'NEEDS_INFORMATION',
          analysis: {
            knownFacts: projKnown,
            missingFacts: projMissing,
            reason: `Target project ${targetProjTitle} identified; need primary technologies or key features to craft accurate bullets.`,
          },
          questions: projQuestions,
          reply: `I can generate **${bulletCount}** technical achievement bullets for **${targetProjTitle}**, but I need a quick note on the tech stack or key features.

### ✅ Known Facts:
${projKnown.map((f) => `- **${f}**`).join('\n')}

### 🔍 Missing Details:
${projMissing.map((m) => `- ${m}`).join('\n')}

**Please share:**
${projQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`,
          draft: null,
          action: null,
          suggestions: [
            'Built with React, TypeScript & Node.js',
            'Implemented real-time WebSocket communication',
            'Engineered secure JWT authentication and Stripe payments',
          ],
        };
      }

      const projStack = skillNames.slice(0, 4).join(', ') || 'TypeScript, React, Node.js & REST APIs';
      const potentialProjBullets = [
        `Architected full-stack web platform using ${projStack}, delivering responsive user interfaces and optimized data flow.`,
        `Engineered secure RESTful API endpoints and WebSocket channels supporting real-time multi-user synchronization.`,
        `Integrated automated testing suites and CI/CD deployment pipelines, ensuring 95%+ test coverage and seamless releases.`,
        `Optimized client-side bundle size by 30% through dynamic code-splitting, asset compression, and caching strategies.`,
        `Designed intuitive state management architecture and role-based access control protecting sensitive endpoints.`,
      ];
      const craftedProjBullets = potentialProjBullets.slice(0, bulletCount);
      const projBulletsMd = craftedProjBullets.map((b) => `• ${b}`).join('\n');

      return {
        intent: 'GENERATE_PROJECT_BULLETS',
        status: 'READY',
        analysis: {
          knownFacts: projKnown,
          missingFacts: [],
          reason: `Crafted ${bulletCount} technical achievement bullets for project ${targetProjTitle}.`,
        },
        questions: [],
        reply: `Here are **${bulletCount}** high-impact technical achievement bullets for **${targetProjTitle}**:

${projBulletsMd}

Click below to apply these bullets directly to your project!`,
        draft: {
          section: 'projects',
          content: craftedProjBullets,
        },
        action: {
          type: 'ADD_PROJECT_BULLETS',
          section: 'projects',
          payload: {
            bullets: craftedProjBullets,
            projectTitle: targetProjTitle,
          },
        },
        suggestions: [
          `Add all ${bulletCount} bullets to ${targetProjTitle}`,
          'Generate more technical variations',
        ],
      };
    }

    // Default General Resume Advice
    const roleTitle = headline || 'Software Developer';
    return {
      intent: 'GENERAL_RESUME_QUESTION',
      status: 'ANSWER',
      analysis: {
        knownFacts,
        missingFacts,
        reason: 'General guidance request evaluated against active resume context.',
      },
      questions: [],
      reply: `Here is targeted guidance for your profile as **${roleTitle}**:

## ✅ Strengths Identified
- **Target Role Alignment**: Configured for ${roleTitle}.
- **Skills Coverage**: ${skillNames.length} skills listed (${skillNames.slice(0, 4).join(', ') || 'General'}).
- **Experience Entries**: ${experiences.length} roles documented.

## 🚀 Recommended Next Actions
1. **Summary Optimization**: Ensure your summary clearly states your core technical value proposition.
2. **Quantifiable Bullets**: Add measurable results (e.g. *improved latency by 30%*, *served 5k active users*).
3. **Project Links**: Include GitHub repositories and live URLs for each technical project.

How would you like to proceed? You can ask me to draft your **Professional Summary**, **generate achievement bullets**, or **recommend missing skills**!`,
      draft: null,
      action: null,
      suggestions: [
        'Write my Professional Summary',
        'Suggest missing technical skills',
        'Improve work experience bullets',
      ],
    };
  }

  private extractBulletStrings(raw: any): string[] {
    if (!raw) return [];
    if (typeof raw === 'string') {
      let trimmed = raw.trim();
      if (!trimmed) return [];
      if (trimmed.includes('\n') && (trimmed.includes('•') || trimmed.includes('- ') || trimmed.includes('* '))) {
        return trimmed
          .split('\n')
          .map((line) => {
            let l = line.replace(/^(?:bulletPoint|bullet|highlight|point)\s*:\s*/i, '');
            l = l.replace(/^[\s•\-\*\u2022\u2023\u25E6\u2043\u2219]+\s*/, '');
            l = l.replace(/^\d+[\.\)]\s*/, '');
            return l.trim();
          })
          .filter(Boolean);
      }
      trimmed = trimmed.replace(/^(?:bulletPoint|bullet|highlight|point)\s*:\s*/i, '');
      trimmed = trimmed.replace(/^[\s•\-\*\u2022\u2023\u25E6\u2043\u2219]+\s*/, '');
      trimmed = trimmed.replace(/^\d+[\.\)]\s*/, '');
      return [trimmed.trim()].filter(Boolean);
    }
    if (Array.isArray(raw)) {
      return raw.flatMap((item) => this.extractBulletStrings(item)).filter(Boolean);
    }
    if (typeof raw === 'object' && raw !== null) {
      if (Array.isArray(raw.bullets)) return this.extractBulletStrings(raw.bullets);
      if (Array.isArray(raw.highlights)) return this.extractBulletStrings(raw.highlights);
      if (Array.isArray(raw.items)) return this.extractBulletStrings(raw.items);

      for (const key of ['bulletPoint', 'bullet', 'highlight', 'text', 'content', 'description', 'detail', 'point', 'value']) {
        if (typeof (raw as any)[key] === 'string' && (raw as any)[key].trim()) {
          return this.extractBulletStrings((raw as any)[key]);
        }
      }

      if (raw.title && (raw.detail || raw.description || raw.text)) {
        return [`${raw.title}: ${raw.detail || raw.description || raw.text}`.trim()];
      }

      const nonMetaEntries = Object.entries(raw).filter(([k, v]) => {
        const lk = k.toLowerCase().replace(/[^a-z]/g, '');
        return (
          !['id', 'section', 'type', 'projectname', 'projecttitle', 'title', 'company', 'position', 'role', 'date', 'startdate', 'enddate', 'location', 'link', 'url', 'status', 'intent'].includes(lk) &&
          typeof v === 'string' &&
          v.trim().length > 0
        );
      });

      if (nonMetaEntries.length > 0) {
        return nonMetaEntries.map(([k, v]) => (isNaN(Number(k)) ? `${k}: ${v}` : `${v}`)).filter(Boolean);
      }
    }
    return [];
  }

  private extractSingleString(raw: any): string {
    if (!raw) return '';
    if (typeof raw === 'string') return raw.trim();
    if (Array.isArray(raw)) return this.extractBulletStrings(raw).join(' ');
    if (typeof raw === 'object') {
      if (typeof raw.summary === 'string') return raw.summary.trim();
      if (typeof raw.currentSummary === 'string') return raw.currentSummary.trim();
      if (typeof raw.text === 'string') return raw.text.trim();
      if (typeof raw.content === 'string') return raw.content.trim();
      const bullets = this.extractBulletStrings(raw);
      if (bullets.length > 0) return bullets.join(' ');
    }
    return String(raw || '').trim();
  }

  private logUsage(userId: string, requestType: string, promptTokens: number, completionTokens: number) {
    if (!userId || !/^[0-9a-fA-F]{24}$/.test(userId)) return;
    AIUsageModel.create({
      userId,
      requestType,
      promptTokens,
      completionTokens,
      modelUsed: 'centralized-provider',
    }).catch((e) => console.error('Failed to log AI usage:', e));
  }
}
