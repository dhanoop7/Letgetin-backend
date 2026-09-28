export const getRewriteExperiencePrompt = (position: string, rawBullet: string): string => `
You are an expert ATS Resume Coach.
Rewrite the following raw work accomplishment bullet point into 3 action-oriented, quantifiable, high-impact resume bullets starting with strong action verbs.
Position: ${position}
Raw Bullet: "${rawBullet}"

Return ONLY a valid JSON array of 3 strings in this exact JSON format:
["Bullet 1", "Bullet 2", "Bullet 3"]`;

export const getGenerateSkillsPrompt = (targetJobTitle: string, existingSkills: string[]): string => `
Act as a Technical Hiring Manager.
Provide 6 essential, highly sought-after technical skills and tools for the target job title "${targetJobTitle}".
Avoid skills already listed: ${existingSkills.join(', ')}.

Return ONLY a valid JSON array of objects in this exact format:
[
  {"name": "SkillName1", "category": "Category1"},
  {"name": "SkillName2", "category": "Category2"}
]`;

export const getOptimizeSectionPrompt = (sectionName: string, sectionData: unknown): string => `
You are a Professional Proofreader and ATS Resume Specialist.
Analyze and optimize the following resume section: "${sectionName}".
Fix any spelling mistakes, typos, grammatical errors, and improve sentence clarity without losing original details.
Section Data: ${JSON.stringify(sectionData)}

Return ONLY a valid JSON object in this format:
{
  "optimizedData": <OPTIMIZED_JSON_SAME_SCHEMA_AS_INPUT>,
  "changesMade": ["Fixed spelling of...", "Improved phrasing for..."]
}`;
