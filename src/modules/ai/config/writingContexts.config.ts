// Single source of truth for the shared AI Writing Assistant: which actions are valid for which
// field context, plus the light per-context prompt guidance and the metadata keys we'll actually
// trust from the client (everything else is dropped server-side, never passed to the model).

export type AIWritingAction =
  | 'improve'
  | 'rewrite'
  | 'professional'
  | 'expand'
  | 'shorten'
  | 'grammar'
  | 'simplify'
  | 'humanize'
  | 'tone-formal'
  | 'tone-friendly'
  | 'tone-persuasive'
  | 'tone-confident'
  | 'translate-es'
  | 'translate-fr'
  | 'translate-de'
  | 'translate-hi'
  | 'translate-zh'
  | 'translate-ja'
  | 'summarize'
  | 'analyze'
  | 'generate'
  | 'custom'
  | 'ats-optimize'
  | 'quantify-impact'
  | 'personalize'
  | 'suggest-skills';

export type AIWritingContext =
  | 'job-description'
  | 'company-about'
  | 'startup-about'
  | 'institution-about'
  | 'candidate-bio'
  | 'resume-summary'
  | 'resume-experience'
  | 'resume-project'
  | 'cover-letter'
  | 'skills';

export interface WritingContextConfig {
  label: string;
  allowedActions: AIWritingAction[];
  instructionFragment: string;
  allowedMetadataKeys: string[];
}

const QUILLBOT_FULL_ACTIONS: AIWritingAction[] = [
  'improve',
  'rewrite',
  'professional',
  'grammar',
  'simplify',
  'expand',
  'shorten',
  'humanize',
  'tone-formal',
  'tone-friendly',
  'tone-persuasive',
  'tone-confident',
  'translate-es',
  'translate-fr',
  'translate-de',
  'translate-hi',
  'translate-zh',
  'translate-ja',
  'summarize',
  'analyze',
  'custom',
  'generate',
];

export const WRITING_CONTEXTS: Record<AIWritingContext, WritingContextConfig> = {
  'job-description': {
    label: 'Job Description',
    allowedActions: QUILLBOT_FULL_ACTIONS,
    instructionFragment:
      "You are refining a job description posted on a hiring platform. Keep it clear, inclusive, and professional.",
    allowedMetadataKeys: ['jobTitle'],
  },
  'company-about': {
    label: 'About Company',
    allowedActions: QUILLBOT_FULL_ACTIONS,
    instructionFragment:
      "You are writing the 'About' section of a company's public profile. Keep it concise and credible.",
    allowedMetadataKeys: ['companyName', 'industry'],
  },
  'startup-about': {
    label: 'About Startup',
    allowedActions: QUILLBOT_FULL_ACTIONS,
    instructionFragment:
      "You are writing the 'About' section of a startup's public profile. Keep an energetic but credible tone.",
    allowedMetadataKeys: ['companyName', 'industry'],
  },
  'institution-about': {
    label: 'About Institution',
    allowedActions: QUILLBOT_FULL_ACTIONS,
    instructionFragment:
      "You are writing the 'About' section of an educational institution's public profile. Keep a trustworthy, academic tone.",
    allowedMetadataKeys: ['companyName'],
  },
  'candidate-bio': {
    label: 'Candidate Bio',
    allowedActions: QUILLBOT_FULL_ACTIONS,
    instructionFragment:
      "You are refining a candidate's personal bio/about profile summary for potential recruiters. Keep it authentic, engaging, concise, and professional.",
    allowedMetadataKeys: ['fullName', 'targetRole'],
  },
  'resume-summary': {
    label: 'Resume Summary',
    allowedActions: ['improve', 'rewrite', 'ats-optimize', 'professional', 'shorten'],
    instructionFragment:
      "You are refining a resume's professional summary. Keep it 2-4 sentences, achievement-oriented, no first-person pronouns.",
    allowedMetadataKeys: ['targetRole'],
  },
  'resume-experience': {
    label: 'Resume Experience',
    allowedActions: ['improve', 'rewrite', 'quantify-impact', 'ats-optimize'],
    instructionFragment:
      "You are refining a single resume experience bullet point. Keep it one concise line starting with a strong action verb.",
    allowedMetadataKeys: ['position', 'company', 'targetRole'],
  },
  'resume-project': {
    label: 'Resume Project',
    allowedActions: ['improve', 'rewrite', 'expand', 'shorten'],
    instructionFragment: 'You are refining a resume project description.',
    allowedMetadataKeys: ['projectName'],
  },
  'cover-letter': {
    label: 'Cover Letter',
    allowedActions: ['generate', 'improve', 'personalize', 'professional', 'shorten'],
    instructionFragment:
      'You are writing or refining a job application cover letter. Keep it professional, sincere, and specific.',
    allowedMetadataKeys: ['jobTitle', 'companyName'],
  },
  skills: {
    label: 'Skills',
    allowedActions: ['suggest-skills'],
    instructionFragment: 'You are suggesting additional relevant skills.',
    allowedMetadataKeys: ['jobTitle', 'targetRole'],
  },
};
