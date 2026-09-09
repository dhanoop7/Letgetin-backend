export type AssistantContextType = 'explore' | 'profile' | 'resume' | 'drive';
export type AssistantMode = 'instant' | 'expert';

export interface AssistantContextPayload {
  resumeId?: string;
  activeResumeContext?: Record<string, unknown>;
  selectedJobId?: string;
  driveFileId?: string;
  activeProfileContext?: Record<string, unknown>;
  activeProfileSection?: string;
}

export interface BuiltContext {
  summary: string;
  hasData: boolean;
}

