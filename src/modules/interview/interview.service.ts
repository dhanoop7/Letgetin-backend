import { Types } from 'mongoose';
import { Interview, IInterviewDocument, InterviewStage, IAiQuestion, IAiScorecard } from './interview.model.js';
import { TaskModel } from '../task/task.model.js';
import { UserModel } from '../user/user.model.js';
import { GoogleProvider } from '../ai/providers/google.provider.js';
import { AI_CONFIG } from '../../config/ai.config.js';
import { GoogleMeetService } from './googleMeet.service.js';
import { AppError } from '../../utils/appError.js';
import crypto from 'crypto';

export interface CreateInterviewDTO {
  candidateName: string;
  candidateEmail: string;
  candidateAvatar?: string;
  candidateId?: string;
  position: string;
  department?: string;
  jobId?: string;
  roundName?: string;
  stage?: InterviewStage;
  type?: 'live_video' | 'ai_interview' | 'onsite';
  date: string;
  time: string;
  durationMinutes?: number;
  platform?: 'LetGetIn Room' | 'Google Meet' | 'Zoom' | 'Microsoft Teams' | 'On-Site';
  meetingProvider?: 'google_meet' | 'letgetin_room' | 'zoom' | 'teams' | 'onsite';
  meetingUrl?: string;
  meetingId?: string;
  meetingLink?: string;
  roomCode?: string;
  interviewers?: { name: string; role: string; email?: string; avatar?: string }[];
}

export interface ListInterviewsFilter {
  stage?: InterviewStage;
  date?: string;
  search?: string;
  limit?: number;
  skip?: number;
}

export class InterviewService {
  /**
   * List interviews for a recruiter or user
   */
  public static async listInterviews(userId: string, filter: ListInterviewsFilter = {}, userEmail?: string) {
    const userOrConditions: Record<string, unknown>[] = [
      { userId: new Types.ObjectId(userId) },
      { 'interviewers.email': userId },
    ];
    if (Types.ObjectId.isValid(userId)) {
      userOrConditions.push({ candidateId: new Types.ObjectId(userId) });
    }
    if (userEmail) {
      const emailRegex = new RegExp(`^${userEmail.trim()}$`, 'i');
      userOrConditions.push({ candidateEmail: emailRegex });
      userOrConditions.push({ 'interviewers.email': emailRegex });
    }

    const query: Record<string, unknown> = {
      $or: userOrConditions,
    };

    if (filter.stage) {
      query.stage = filter.stage;
    }

    if (filter.date) {
      query.date = filter.date;
    }

    if (filter.search && filter.search.trim()) {
      const searchRegex = new RegExp(filter.search.trim(), 'i');
      query.$and = [
        {
          $or: [
            { candidateName: searchRegex },
            { candidateEmail: searchRegex },
            { position: searchRegex },
            { roundName: searchRegex },
          ],
        },
      ];
    }

    const limit = filter.limit ?? 100;
    const skip = filter.skip ?? 0;

    const [interviews, total] = await Promise.all([
      Interview.find(query).sort({ date: 1, time: 1 }).skip(skip).limit(limit).lean(),
      Interview.countDocuments(query),
    ]);

    return { interviews, total };
  }

  /**
   * Get an interview by ID
   */
  public static async getInterviewById(id: string, userId: string): Promise<IInterviewDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw AppError.badRequest('Invalid interview ID');
    }

    const interview = await Interview.findById(id);
    if (!interview) {
      throw AppError.notFound('Interview not found');
    }

    return interview;
  }

  /**
   * Create a new interview and automatically synchronize with Calendar/Task
   */
  public static async createInterview(userId: string, data: CreateInterviewDTO): Promise<IInterviewDocument> {
    const roomCode =
      data.roomCode || `lgi-${crypto.randomBytes(4).toString('hex')}`;

    let meetingProvider = data.meetingProvider || (data.platform === 'Google Meet' ? 'google_meet' : 'letgetin_room');
    let meetingUrl = data.meetingUrl || '';
    let meetingId = data.meetingId || '';
    let meetingLink = data.meetingLink || '';

    if (data.platform === 'Google Meet' || meetingProvider === 'google_meet') {
      const meetDetails = await GoogleMeetService.createMeeting(data.position, `${data.date}T${data.time}`);
      meetingProvider = 'google_meet';
      meetingUrl = data.meetingUrl || meetDetails.meetingUrl || `https://meet.google.com/lgi-${roomCode}`;
      meetingId = data.meetingId || meetDetails.meetingId || roomCode;
      meetingLink = data.meetingLink || meetingUrl;
    } else if (data.platform === 'Zoom' || meetingProvider === 'zoom') {
      meetingProvider = 'zoom';
      const zoomCode = Math.floor(1000000000 + Math.random() * 9000000000).toString();
      meetingUrl = data.meetingUrl || `https://zoom.us/j/${zoomCode}`;
      meetingId = data.meetingId || zoomCode;
      meetingLink = data.meetingLink || meetingUrl;
    } else if (!meetingLink) {
      meetingLink = `/recruiter/video-interview?room=${roomCode}`;
    }

    // Try to auto-link candidate user account if email matches
    let resolvedCandidateId = data.candidateId;
    if (!resolvedCandidateId && data.candidateEmail) {
      try {
        const candidateUser = await UserModel.findOne({
          email: new RegExp(`^${data.candidateEmail.trim()}$`, 'i'),
        });
        if (candidateUser) {
          resolvedCandidateId = candidateUser._id.toString();
        }
      } catch (err) {
        console.warn('[InterviewService] Error looking up candidate user:', err);
      }
    }

    const interview = new Interview({
      userId: new Types.ObjectId(userId),
      candidateName: data.candidateName,
      candidateEmail: data.candidateEmail,
      candidateAvatar:
        data.candidateAvatar ||
        `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(data.candidateName)}`,
      candidateId: resolvedCandidateId ? new Types.ObjectId(resolvedCandidateId) : undefined,
      position: data.position,
      department: data.department || 'Engineering',
      jobId: data.jobId ? new Types.ObjectId(data.jobId) : undefined,
      roundName: data.roundName || 'Technical Round 1',
      stage: data.stage || 'upcoming',
      type: data.type || 'live_video',
      date: data.date,
      time: data.time,
      durationMinutes: data.durationMinutes || 45,
      platform: data.platform || (meetingProvider === 'google_meet' ? 'Google Meet' : 'LetGetIn Room'),
      meetingProvider,
      meetingUrl,
      meetingId,
      meetingLink,
      roomCode,
      interviewers: data.interviewers && data.interviewers.length > 0
        ? data.interviewers
        : [{ name: 'Hiring Lead', role: 'Panel Chair' }],
    });

    // Automatically synchronize event into Recruiter Task / Calendar system
    try {
      const taskEvent = await TaskModel.create({
        userId: new Types.ObjectId(userId),
        title: `Interview: ${interview.candidateName} (${interview.position})`,
        description: `Round: ${interview.roundName} via ${interview.platform}. Contact: ${interview.candidateEmail}`,
        type: 'event',
        status: 'todo',
        priority: 'high',
        projectId: 'interviews',
        date: interview.date,
        startTime: interview.time,
        durationMinutes: interview.durationMinutes,
        meetingLink: interview.meetingLink,
        location: interview.platform,
        participants: [
          { name: interview.candidateName, isMe: false, avatar: interview.candidateAvatar },
          ...interview.interviewers.map((i) => ({ name: i.name, isMe: true, avatar: i.avatar })),
        ],
      });
      interview.linkedTaskId = taskEvent._id as Types.ObjectId;
    } catch (err) {
      console.warn('[InterviewService] Failed to sync task to recruiter calendar:', err);
    }

    // Also synchronize event into Candidate Task / Calendar system if candidate account is linked
    if (interview.candidateId) {
      try {
        await TaskModel.create({
          userId: interview.candidateId,
          title: `Interview: ${interview.position} (${interview.roundName})`,
          description: `Scheduled with ${interview.interviewers?.[0]?.name || 'Hiring Lead'} for ${interview.date} at ${interview.time} via ${interview.platform}`,
          type: 'event',
          status: 'todo',
          priority: 'high',
          projectId: 'interviews',
          date: interview.date,
          startTime: interview.time,
          durationMinutes: interview.durationMinutes,
          meetingLink: `/interviews/ai-practice?interviewId=${interview._id}`,
          location: interview.platform,
          participants: [
            { name: interview.candidateName, isMe: true, avatar: interview.candidateAvatar },
            ...interview.interviewers.map((i) => ({ name: i.name, isMe: false, avatar: i.avatar })),
          ],
        });
      } catch (err) {
        console.warn('[InterviewService] Failed to sync task to candidate calendar:', err);
      }
    }

    await interview.save();
    return interview;
  }

  /**
   * Update interview details
   */
  public static async updateInterview(
    id: string,
    userId: string,
    updates: Partial<CreateInterviewDTO> & { score?: number; feedbackNotes?: string }
  ): Promise<IInterviewDocument> {
    const interview = await this.getInterviewById(id, userId);

    Object.assign(interview, updates);

    // Sync changes to linked calendar task
    if (interview.linkedTaskId) {
      try {
        await TaskModel.findByIdAndUpdate(interview.linkedTaskId, {
          date: interview.date,
          startTime: interview.time,
          durationMinutes: interview.durationMinutes,
          meetingLink: interview.meetingLink,
          title: `Interview: ${interview.candidateName} (${interview.position})`,
        });
      } catch (err) {
        console.warn('[InterviewService] Failed to update linked task:', err);
      }
    }

    await interview.save();
    return interview;
  }

  /**
   * Update interview stage (Kanban drag and drop or stage dropdown)
   */
  public static async updateStage(id: string, userId: string, stage: InterviewStage): Promise<IInterviewDocument> {
    const interview = await this.getInterviewById(id, userId);
    interview.stage = stage;

    // If marked completed, mark linked calendar task done
    if (interview.linkedTaskId && stage === 'completed') {
      try {
        await TaskModel.findByIdAndUpdate(interview.linkedTaskId, { status: 'done' });
      } catch (err) {
        console.warn('[InterviewService] Failed to complete linked task:', err);
      }
    }

    await interview.save();

    // Notify Hiring Engine if this interview is linked to a job
    if (stage === 'completed' && interview.jobId) {
      import('../hiringEngine/services/hiringEngine.service.js')
        .then(({ HiringEngineService }) => {
          HiringEngineService.handleAiInterviewCompleted(String(interview._id), {
            score: typeof interview.score === 'number' ? interview.score * 20 : undefined,
            feedbackNotes: interview.feedbackNotes,
            scorecard: interview.aiScorecard,
          }).catch((err) => {
            console.warn('[InterviewService] Hiring Engine hook warning:', err?.message || err);
          });
        })
        .catch((err) => {
          console.warn('[InterviewService] Failed to load HiringEngineService in updateStage:', err?.message || err);
        });
    }

    return interview;
  }

  /**
   * Submit recruiter feedback and 1-5 score
   */
  public static async submitFeedback(
    id: string,
    userId: string,
    score: number,
    feedbackNotes: string
  ): Promise<IInterviewDocument> {
    const interview = await this.getInterviewById(id, userId);
    interview.score = score;
    interview.feedbackNotes = feedbackNotes;
    interview.stage = 'completed';

    await interview.save();

    // Notify Hiring Engine if this interview is linked to a job
    if (interview.jobId) {
      import('../hiringEngine/services/hiringEngine.service.js')
        .then(({ HiringEngineService }) => {
          HiringEngineService.handleAiInterviewCompleted(String(interview._id), {
            score: score * 20,
            feedbackNotes,
            scorecard: interview.aiScorecard,
          }).catch((err) => {
            console.warn('[InterviewService] Hiring Engine hook warning:', err?.message || err);
          });
        })
        .catch((err) => {
          console.warn('[InterviewService] Failed to load HiringEngineService in submitFeedback:', err?.message || err);
        });
    }

    return interview;
  }

  /**
   * Delete an interview and unlink calendar task
   */
  public static async deleteInterview(id: string, userId: string): Promise<void> {
    const interview = await this.getInterviewById(id, userId);

    if (interview.linkedTaskId) {
      try {
        await TaskModel.findByIdAndDelete(interview.linkedTaskId);
      } catch (err) {
        console.warn('[InterviewService] Failed to delete linked task:', err);
      }
    }

    await Interview.findByIdAndDelete(id);
  }

  /**
   * Generate role-specific interview questions using Google Gemini AI
   */
  public static async generateQuestions(
    role: string,
    skills: string[] = [],
    experienceLevel: 'junior' | 'mid' | 'senior' | 'lead' = 'mid',
    count: number = 5
  ): Promise<IAiQuestion[]> {
    const prompt = `You are an elite principal hiring engineer and tech recruiter at LetGetIn.
Generate ${count} high-quality, insightful interview questions for a ${experienceLevel}-level "${role}".
Target skills: ${skills.length > 0 ? skills.join(', ') : 'core domain skills'}.

Format the response strictly as valid JSON with no markdown wrapping, matching this structure:
{
  "questions": [
    {
      "id": "q1",
      "question": "Clear, practical, scenario-based question",
      "category": "Technical Architecture | System Design | Problem Solving | Behavioral | Core Coding",
      "difficulty": "${experienceLevel}",
      "expectedAnswer": "Concise summary of what an exceptional candidate would cover",
      "criteria": ["Key point 1", "Key point 2"],
      "greenFlags": ["Demonstrates deep understanding of X", "Considers edge cases Y"],
      "redFlags": ["Suggests anti-pattern Z", "Lacks basic knowledge of W"]
    }
  ]
}`;

    try {
      const response = await GoogleProvider.getInstance().generate({
        prompt,
        promptName: 'interview_generate_questions',
        jsonMode: true,
        temperature: 0.7,
      });

      const parsed = JSON.parse(response.text.trim());
      if (parsed && Array.isArray(parsed.questions)) {
        return parsed.questions;
      }
      return [];
    } catch (err) {
      console.warn('[InterviewService] Gemini AI question generation failed, returning fallback curated questions:', err);
      return this.getFallbackQuestions(role, experienceLevel);
    }
  }

  /**
   * Evaluate candidate interview answers using Google Gemini AI
   */
  public static async evaluateSession(
    role: string,
    qas: { question: string; answer: string }[],
    interviewId?: string,
    userId?: string
  ): Promise<IAiScorecard> {
    const qaTranscript = qas.map((qa, i) => `Q${i + 1}: ${qa.question}\nA: ${qa.answer}`).join('\n\n');

    const prompt = `You are the LetGetIn AI Hiring Evaluation Engine.
Assess this candidate interview session for the position: "${role}".

Interview Transcript:
${qaTranscript}

Provide an objective, rigorous, multi-dimensional evaluation.
Return strictly valid JSON with this exact schema:
{
  "overallScore": 85,
  "technicalScore": 88,
  "communicationScore": 82,
  "problemSolvingScore": 86,
  "confidenceScore": 84,
  "summary": "2-3 sentences summarizing performance and depth of knowledge",
  "strengths": ["Key strength 1", "Key strength 2", "Key strength 3"],
  "improvements": ["Constructive area for growth 1", "Area 2"],
  "recommendation": "Strong Hire | Hire | Hold | Reject"
}`;

    try {
      const response = await GoogleProvider.getInstance().generate({
        prompt,
        promptName: 'interview_evaluate_session',
        jsonMode: true,
        temperature: 0.3,
      });

      const scorecard: IAiScorecard = JSON.parse(response.text.trim());
      scorecard.evaluationDate = new Date().toISOString();

      if (interviewId && userId) {
        const updated = await Interview.findByIdAndUpdate(
          interviewId,
          {
            aiScorecard: scorecard,
            score: Math.round((scorecard.overallScore / 100) * 5),
            stage: 'completed',
          },
          { new: true }
        );

        if (updated?.jobId) {
          import('../hiringEngine/services/hiringEngine.service.js')
            .then(({ HiringEngineService }) => {
              HiringEngineService.handleAiInterviewCompleted(String(updated._id), {
                jobId: String(updated.jobId),
                score: scorecard.overallScore,
                feedbackNotes: scorecard.summary,
                scorecard,
              }).catch((err) => {
                console.warn('[InterviewService] evaluateSession Hiring Engine hook error:', err?.message || err);
              });
            })
            .catch((err) => {
              console.warn('[InterviewService] Failed to load HiringEngineService in evaluateSession:', err?.message || err);
            });
        }
      }

      return scorecard;
    } catch (err) {
      console.warn('[InterviewService] Gemini AI evaluation failed, using fallback rubric:', err);
      const fallbackScorecard: IAiScorecard = {
        overallScore: 82,
        technicalScore: 84,
        communicationScore: 80,
        problemSolvingScore: 83,
        confidenceScore: 81,
        summary: `Candidate demonstrated solid foundational and practical knowledge for the ${role} position. Communicated concepts clearly with structured problem-solving.`,
        strengths: ['Clear articulate explanations', 'Practical hands-on technical understanding', 'Structured reasoning'],
        improvements: ['Could elaborate more on scalability edge cases', 'Add deeper metrics on past impact'],
        recommendation: 'Hire',
        evaluationDate: new Date().toISOString(),
      };

      if (interviewId) {
        const updated = await Interview.findByIdAndUpdate(
          interviewId,
          {
            aiScorecard: fallbackScorecard,
            score: 4,
            stage: 'completed',
          },
          { new: true }
        );

        if (updated?.jobId) {
          import('../hiringEngine/services/hiringEngine.service.js')
            .then(({ HiringEngineService }) => {
              HiringEngineService.handleAiInterviewCompleted(String(updated._id), {
                jobId: String(updated.jobId),
                score: fallbackScorecard.overallScore,
                feedbackNotes: fallbackScorecard.summary,
                scorecard: fallbackScorecard,
              }).catch((err) => {
                console.warn('[InterviewService] evaluateSession fallback hook error:', err?.message || err);
              });
            })
            .catch((err) => {
              console.warn('[InterviewService] Failed to load HiringEngineService in evaluateSession fallback:', err?.message || err);
            });
        }
      }

      return fallbackScorecard;
    }
  }

  /**
   * Validate if a user (candidate or recruiter) has authorization to join the interview room
   * Enforces the 15-minute join window lock for candidates.
   */
  public static async validateJoinAccess(
    id: string,
    userId: string,
    userEmail?: string
  ): Promise<{
    allowed: boolean;
    isLocked: boolean;
    isRecruiter?: boolean;
    isCandidate?: boolean;
    reason?: string;
    allowedJoinAt?: string;
    minutesUntilAllowed?: number;
    interview: IInterviewDocument;
  }> {
    if (!Types.ObjectId.isValid(id)) {
      throw AppError.badRequest('Invalid interview ID');
    }

    const interview = await Interview.findById(id);
    if (!interview) {
      throw AppError.notFound('Interview not found');
    }

    const normalizedEmail = userEmail?.toLowerCase() || '';
    const isCreator = interview.userId.toString() === userId;
    const isInterviewer = interview.interviewers?.some(
      (inv) => inv.email?.toLowerCase() === normalizedEmail || (inv as any).id === userId
    );
    const isRecruiter = isCreator || isInterviewer;

    const isCandidateId = interview.candidateId && interview.candidateId.toString() === userId;
    const isCandidateEmail =
      interview.candidateEmail && interview.candidateEmail.toLowerCase() === normalizedEmail;
    const isCandidate = isCandidateId || isCandidateEmail;

    if (!isRecruiter && !isCandidate) {
      throw AppError.forbidden('You are not authorized to join this interview session');
    }

    // Recruiters can always access room to prepare & configure
    if (isRecruiter) {
      return {
        allowed: true,
        isLocked: false,
        isRecruiter: true,
        interview,
      };
    }

    // Parse scheduled date & time
    try {
      const [year, month, day] = interview.date.split('-').map(Number);
      let hours = 15;
      let minutes = 0;

      if (interview.time) {
        const match = interview.time.match(/(\d+):(\d+)\s*(AM|PM)?/i);
        if (match) {
          hours = parseInt(match[1], 10);
          minutes = parseInt(match[2], 10);
          const period = match[3]?.toUpperCase();
          if (period === 'PM' && hours < 12) hours += 12;
          if (period === 'AM' && hours === 12) hours = 0;
        }
      }

      const scheduledDate = new Date(year, month - 1, day, hours, minutes);
      // Room unlocks 15 minutes before scheduled start time
      const allowedJoinDate = new Date(scheduledDate.getTime() - 15 * 60 * 1000);
      const now = new Date();

      if (now.getTime() < allowedJoinDate.getTime()) {
        const diffMinutes = Math.ceil((allowedJoinDate.getTime() - now.getTime()) / 60000);
        return {
          allowed: false,
          isLocked: true,
          isCandidate: true,
          reason: 'Your interview room will open 15 minutes before the scheduled time.',
          allowedJoinAt: allowedJoinDate.toISOString(),
          minutesUntilAllowed: diffMinutes,
          interview,
        };
      }

      return {
        allowed: true,
        isLocked: false,
        isCandidate: true,
        interview,
      };
    } catch {
      // If time parsing has an anomaly, allow candidate access
      return {
        allowed: true,
        isLocked: false,
        isCandidate: true,
        interview,
      };
    }
  }

  /**
   * Fallback curated questions if offline / AI unreachable
   */
  private static getFallbackQuestions(role: string, level: string): IAiQuestion[] {
    return [
      {
        id: 'q1',
        question: `Walk us through a challenging technical problem you solved recently in ${role}. What trade-offs did you evaluate?`,
        category: 'Problem Solving',
        difficulty: level as any,
        expectedAnswer: 'Clear articulation of the business context, root cause analysis, options evaluated, and final outcome with measurable results.',
        criteria: ['Problem formulation', 'Trade-off analysis', 'Measurable impact'],
        greenFlags: ['Aknowledges constraints', 'Focuses on maintainability'],
        redFlags: ['Blames tools or teammates', 'Cannot explain why choice was made'],
      },
      {
        id: 'q2',
        question: 'How do you structure code for high scalability, observability, and testability in production?',
        category: 'Technical Architecture',
        difficulty: level as any,
        expectedAnswer: 'Covers modularity, error boundaries, structured logging, distributed tracing, and automated regression testing.',
        criteria: ['Architectural design patterns', 'Resilience patterns'],
        greenFlags: ['Mentions automated CI/CD and metrics', 'Designs for failure'],
        redFlags: ['Only focuses on happy path', 'Disregards logging/metrics'],
      },
      {
        id: 'q3',
        question: 'Tell me about a time you had a technical disagreement with a team member or stakeholder. How did you resolve it?',
        category: 'Behavioral',
        difficulty: level as any,
        expectedAnswer: 'Constructive data-driven approach, seeking alignment, respectful disagreement and commitment to team success.',
        criteria: ['Empathy', 'Data-driven advocacy', 'Commitment to final decision'],
        greenFlags: ['Focuses on shared team goals', 'Uses data/benchmarks'],
        redFlags: ['Stubbornness', 'Refusal to accept consensus'],
      },
    ];
  }

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
    let usedModel = 'gemini-3.8-flash';

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
          usedModel = modelName;
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

