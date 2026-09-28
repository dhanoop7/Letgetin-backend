import { AssistantContextType } from '../context/context.types.js';

export interface AssistantContextConfigEntry {
  label: string;
  deflectionMessage: string;
}

export const ASSISTANT_CONTEXT_CONFIG: Record<AssistantContextType, AssistantContextConfigEntry> = {
  explore: {
    label: 'your profile, job search preferences, and the jobs you are exploring',
    deflectionMessage:
      "I can only help with questions about your profile, skills, or the jobs you're exploring here. Please ask something related to your job search.",
  },
  profile: {
    label: 'your user profile, career background, experience, education, and skills',
    deflectionMessage:
      'I can only help with questions about your profile, career background, skills, education, and experience here. Please ask something related to your profile.',
  },
  resume: {
    label: 'your resume and resume workspace content',
    deflectionMessage:
      'I can only help with questions about your resume and resume content. Please ask something related to your resume.',
  },
  drive: {
    label: 'your uploaded files and documents in Drive',
    deflectionMessage:
      'I can only help with questions about your files and documents in Drive. Please ask something related to your uploaded documents.',
  },
};
