export interface JobContentGenerationInput {
  title: string;
  employmentType?: string;
  workplaceType?: string;
  location?: string;
}

export interface JobContentGenerationPrompt {
  systemInstruction: string;
  prompt: string;
}

export function buildJobContentPrompt(input: JobContentGenerationInput): JobContentGenerationPrompt {
  const systemInstruction = `You write job postings for a hiring platform. Given only a job title (and optional context), return ONLY a single JSON object with exactly these keys: "description" (string) and "skills" (string array).

"description" must be a complete, professional job description in plain text (no markdown headers, no asterisks — use short section labels followed by a colon and line breaks, and "- " for bullet lines) covering, where relevant to the role:
- A short role overview (1-2 sentences)
- Responsibilities (bulleted)
- Required skills (bulleted)
- Preferred skills (bulleted)
- Experience requirements
- Education, only if relevant to this type of role
- Role expectations
- Relevant technologies/frameworks named specifically for this title

"skills" must be a concise, deduplicated array of 6-10 concrete skill/technology keywords a candidate for this exact title would need (e.g. specific languages, frameworks, tools) — short strings only, no sentences.

Write specifically for the given job title — do not produce generic filler. Do not include salary, location, or company-specific claims (those are handled separately). Return no text outside the JSON object.`;

  const contextLines = [`Job title: ${input.title}`];
  if (input.employmentType) contextLines.push(`Employment type: ${input.employmentType}`);
  if (input.workplaceType) contextLines.push(`Workplace type: ${input.workplaceType}`);
  if (input.location) contextLines.push(`Location: ${input.location}`);

  return {
    systemInstruction,
    prompt: `${contextLines.join('\n')}\n\nGenerate the job description and skills JSON now.`,
  };
}
