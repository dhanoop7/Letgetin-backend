const CURRENT_STATUS_OPTIONS = [
  'employed_happy',
  'unemployed',
  'urgently_looking',
  'employed_switching',
  'employed_higher_opportunities',
] as const;

interface ProfileSummary {
  headline?: string;
  bio?: string;
  skills?: string[];
  latestExperience?: { title?: string; company?: string; start?: string; end?: string };
  yearsOfExperience?: number;
}

function formatProfileSummary(profile: ProfileSummary): string {
  const lines: string[] = [];
  lines.push(`Headline: ${profile.headline || '(not set)'}`);
  if (profile.bio) lines.push(`Bio: ${profile.bio}`);
  if (profile.skills && profile.skills.length > 0) lines.push(`Skills: ${profile.skills.join(', ')}`);
  if (profile.latestExperience) {
    const e = profile.latestExperience;
    lines.push(
      `Most Recent Role: ${e.title || 'Unknown'} at ${e.company || 'Unknown'} (${e.start || '?'} - ${e.end || 'Present'})`
    );
  }
  return lines.join('\n');
}

export const getStatusSuggestionPrompt = (profile: ProfileSummary): string => {
  return `You are assisting a job-search wizard. Based ONLY on the candidate's actual profile facts below, choose the single closest-matching current-status option from this exact closed list (return the literal key, not a description):

${CURRENT_STATUS_OPTIONS.map((o) => `- ${o}`).join('\n')}

Rules:
- Base your choice only on the facts given below. Never invent facts not present.
- If the profile gives no reliable signal, choose "employed_switching" as a neutral default and say so in the reason.
- "reason" must be a short, friendly, one-sentence explanation grounded only in the given facts.

==================================================
CANDIDATE PROFILE
==================================================
${formatProfileSummary(profile)}

==================================================
REQUIRED JSON OUTPUT
==================================================
Return ONLY a single valid JSON object:
{ "status": "<one of the exact keys above>", "reason": "short one-sentence reason" }
No code fences, no extra text.`;
};

export const getTitleExpansionPrompt = (profile: ProfileSummary, seedTitle: string): string => {
  return `You are assisting a job-search wizard. The candidate just entered this desired job title: "${seedTitle}".

Based on the candidate's actual profile facts below, suggest up to 5 closely related job titles a recruiter would recognize (seniority variants, adjacent role names). Do not repeat the seed title itself. Never invent skills/experience not present in the profile - only use the profile to judge which adjacent titles are plausible for this candidate.

==================================================
CANDIDATE PROFILE
==================================================
${formatProfileSummary(profile)}

==================================================
REQUIRED JSON OUTPUT
==================================================
Return ONLY a single valid JSON object:
{ "titles": ["Related Title 1", "Related Title 2", ...] }
Maximum 5 titles. No code fences, no extra text.`;
};

export type { ProfileSummary };
export { CURRENT_STATUS_OPTIONS };
