export const getAtsAnalysisPrompt = (resumeContent: unknown, targetJobDescription?: string): string => `
You are an enterprise-grade ATS (Applicant Tracking System) Scanner & Senior Technical Talent Screener.
Analyze the candidate's resume JSON for automated ATS screening compliance, recruiter keyword matching, and section impact.

Target Role / Job Description: ${targetJobDescription || 'Standard Industry Professional Role'}
Resume Content JSON:
${JSON.stringify(resumeContent)}

Strict Scoring Calibration (0 to 100):
- If the resume is empty or only whitespace / default blank placeholders: The score MUST BE 0.
- If the resume has minimal information (e.g. only a name or 1 section without experience): Score MUST BE 5 to 25.
- If the resume is partially filled (experience present but lacking metrics, action verbs, or technical skills): Score MUST BE 35 to 65.
- If the resume is well-developed with action verbs, quantifiable metrics (% improvements, revenue, user numbers), and technical keywords: Score MUST BE 75 to 95.

Return ONLY a valid JSON object in this exact schema without markdown wrap:
{
  "score": 0,
  "recommendations": [
    "Specific recommendation 1",
    "Specific recommendation 2",
    "Specific recommendation 3"
  ],
  "missingKeywords": [
    "Missing Keyword 1",
    "Missing Keyword 2",
    "Missing Keyword 3"
  ]
}`;

export const getJobMatchPrompt = (resumeContent: unknown, jobDescription: string): string => `
You are a Senior Technical Recruiter & ATS Match Optimization AI.
Compare the following candidate resume JSON against the target Job Description.

Job Description:
"""
${jobDescription.slice(0, 5000)}
"""

Resume Content JSON (each experience/project item has a stable "id" field):
${JSON.stringify(resumeContent)}

Strict Match Calibration (0 to 100):
- If resume is empty, matchScore MUST BE 0.
- Otherwise calculate the percentage alignment between resume skills/experience and the job description requirements.

Also produce a "suggestions" array of concrete, reviewable edits the candidate can accept or decline one at a time.
CRITICAL RULES for suggestions:
- NEVER invent facts not implied by the existing resume content (no fake companies, titles, metrics, or technologies).
- Only rewrite/extend text that already exists in the resume - reword or extend it to better match the job description's real requirements.
- For "experience" or "projects" suggestions, "itemId" MUST be copied exactly from that item's "id" field in the Resume Content JSON above.
- For "summary" suggestions, omit "itemId".
- For "skills" suggestions, omit "itemId"; only suggest skills that are reasonably implied by existing experience/projects, never fabricated expertise.
- "originalText" must be the exact existing text being changed (empty string only for a brand-new "addition").
- "changeType" is one of: "addition" (net-new content), "replacement" (swap the whole text), "rewrite" (reword while keeping meaning).
- Only include a suggestion if it meaningfully improves alignment with the job description - do not pad with trivial edits.
- Produce at most 6 suggestions, ordered by impact.

Also identify which resume sections are MISSING or too sparse to even generate a meaningful
suggestion for, given what this job description actually requires. Judge this from the real
resume content and real JD requirements - never use a fixed/arbitrary completeness percentage.
Only list a section here if it is empty, or so thin that the candidate must supply real
information before AI can propose anything grounded in fact. Valid section values: "summary",
"experience", "skills", "projects". Omit this entirely (empty array) if all relevant sections
already have enough content to work from.

Return ONLY a valid JSON object in this exact format:
{
  "matchScore": 75,
  "matchedKeywords": ["Keyword1", "Keyword2"],
  "missingKeywords": ["Keyword3", "Keyword4"],
  "missingSkills": ["Skill1", "Skill2"],
  "recommendedImprovements": [
    "Recommendation 1",
    "Recommendation 2"
  ],
  "tailoredSummary": "An optimized executive summary tailored to this job description...",
  "tailoredBullets": [
    "Tailored bullet point 1 incorporating target keywords and action verbs...",
    "Tailored bullet point 2..."
  ],
  "suggestions": [
    {
      "section": "experience",
      "itemId": "<copied from resume item id>",
      "changeType": "rewrite",
      "originalText": "Existing bullet text exactly as in the resume...",
      "proposedText": "Reworded bullet incorporating a real missing keyword...",
      "reason": "Explain briefly why this improves alignment with the job description.",
      "relatedKeywords": ["Keyword3"]
    }
  ],
  "missingSections": [
    {
      "section": "experience",
      "reason": "This job requires 3+ years of team leadership experience, but no work experience is listed on the resume yet."
    }
  ]
}`;
