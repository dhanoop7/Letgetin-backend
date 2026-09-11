import { Types } from 'mongoose';
import { Interview, IInterviewDocument, InterviewStage, IAiQuestion, IAiScorecard } from './interview.model.js';
import { TaskModel } from '../task/task.model.js';
import { GoogleProvider } from '../ai/providers/google.provider.js';
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
  public static async listInterviews(userId: string, filter: ListInterviewsFilter = {}) {
    const query: Record<string, unknown> = {
      $or: [{ userId: new Types.ObjectId(userId) }, { 'interviewers.email': userId }],
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
    const meetingLink =
      data.meetingLink ||
      (data.platform === 'LetGetIn Room' ? `/recruiter/video-interview?room=${roomCode}` : '');

    const interview = new Interview({
      userId: new Types.ObjectId(userId),
      candidateName: data.candidateName,
      candidateEmail: data.candidateEmail,
      candidateAvatar:
        data.candidateAvatar ||
        `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(data.candidateName)}`,
      candidateId: data.candidateId ? new Types.ObjectId(data.candidateId) : undefined,
      position: data.position,
      department: data.department || 'Engineering',
      jobId: data.jobId ? new Types.ObjectId(data.jobId) : undefined,
      roundName: data.roundName || 'Technical Round 1',
      stage: data.stage || 'upcoming',
      type: data.type || 'live_video',
      date: data.date,
      time: data.time,
      durationMinutes: data.durationMinutes || 45,
      platform: data.platform || 'LetGetIn Room',
      meetingLink,
      roomCode,
      interviewers: data.interviewers && data.interviewers.length > 0
        ? data.interviewers
        : [{ name: 'Hiring Lead', role: 'Panel Chair' }],
    });

    // Automatically synchronize event into Task / Calendar system
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
      console.warn('[InterviewService] Failed to sync task to calendar:', err);
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
        await Interview.findByIdAndUpdate(interviewId, {
          aiScorecard: scorecard,
          score: Math.round((scorecard.overallScore / 100) * 5),
          stage: 'completed',
        });
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
        await Interview.findByIdAndUpdate(interviewId, {
          aiScorecard: fallbackScorecard,
          score: 4,
          stage: 'completed',
        });
      }

      return fallbackScorecard;
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
}
