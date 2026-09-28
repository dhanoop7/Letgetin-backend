export const getImproveSummaryPrompt = (
  currentSummary: string,
  targetRole?: string,
  tone: string = 'impactful'
): string => `
You are a Principal Technical Recruiter and Resume Specialist.
Transform the following professional summary into 3 distinct, high-impact, ATS-optimized executive summaries.
Target Role: ${targetRole || 'Software Professional'}
Tone: ${tone}
Original Summary: "${currentSummary}"

Return ONLY a valid JSON array of 3 strings in this exact JSON format:
["Suggestion 1", "Suggestion 2", "Suggestion 3"]`;
