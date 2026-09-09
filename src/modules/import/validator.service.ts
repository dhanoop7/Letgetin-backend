import { z } from 'zod';
import { ValidationError } from './import.errors';
import { ResumeNormalizationService } from './normalization.service';

export const personalInfoSchema = z.object({
  fullName: z.string().default(''),
  headline: z.string().default(''),
  email: z.string().default(''),
  phone: z.string().default(''),
  location: z.string().default(''),
  websiteUrl: z.string().default(''),
});

export const experienceSchema = z.object({
  id: z.string().optional(),
  company: z.string().default(''),
  position: z.string().default(''),
  location: z.string().default(''),
  startDate: z.string().default(''),
  endDate: z.string().default('Present'),
  isCurrent: z.boolean().default(false),
  highlights: z.array(z.string()).default([]),
});

export const educationSchema = z.object({
  id: z.string().optional(),
  institution: z.string().default(''),
  degree: z.string().default(''),
  fieldOfStudy: z.string().default(''),
  startDate: z.string().default(''),
  endDate: z.string().default(''),
  isCurrent: z.boolean().default(false),
  gradeScore: z.string().optional(),
});

export const projectSchema = z.object({
  id: z.string().optional(),
  title: z.string().default(''),
  subtitle: z.string().default(''),
  link: z.string().default(''),
  startDate: z.string().default(''),
  endDate: z.string().default(''),
  highlights: z.array(z.string()).default([]),
  technologies: z.array(z.string()).default([]),
});

export const skillSchema = z.object({
  id: z.string().optional(),
  name: z.string().default(''),
  category: z.string().default('Technical'),
  level: z.number().min(1).max(5).default(4),
});

export const certificateSchema = z.object({
  id: z.string().optional(),
  name: z.string().default(''),
  issuer: z.string().default(''),
  issueDate: z.string().default(''),
});

export const languageSchema = z.object({
  id: z.string().optional(),
  language: z.string().default(''),
  proficiency: z.string().default(''),
});

export const resumeContentSchema = z.object({
  personalInfo: personalInfoSchema.default({}),
  summary: z.string().default(''),
  experiences: z.array(experienceSchema).default([]),
  educations: z.array(educationSchema).default([]),
  projects: z.array(projectSchema).default([]),
  skills: z.array(skillSchema).default([]),
  certificates: z.array(certificateSchema).default([]),
  languages: z.array(languageSchema).default([]),
  references: z.array(z.any()).default([]),
  socialLinks: z.array(z.any()).default([]),
});

export type ValidatedResumeContent = z.infer<typeof resumeContentSchema>;

export class ResumeValidationService {
  /**
   * Validates raw JSON object from AI parser using Zod schema, then applies strict normalization.
   * Throws ValidationError if structure cannot be parsed as a valid resume schema.
   */
  public validateAndNormalize(rawObj: unknown): ValidatedResumeContent {
    if (!rawObj || typeof rawObj !== 'object') {
      throw new ValidationError('AI parser response must be a non-null JSON object');
    }

    const parseResult = resumeContentSchema.safeParse(rawObj);

    let validatedData: ValidatedResumeContent;
    if (parseResult.success) {
      validatedData = parseResult.data;
    } else {
      // Coerce shape safely if top-level structure is close
      try {
        validatedData = this.coerceRawObject(rawObj as Record<string, any>);
      } catch (err: any) {
        throw new ValidationError('Could not structure AI payload into valid resume schema', parseResult.error.format());
      }
    }

    // Apply strict normalization across all validated fields
    return ResumeNormalizationService.normalize(validatedData);
  }

  private coerceRawObject(obj: Record<string, any>): ValidatedResumeContent {
    const safeObj = {
      personalInfo: {
        fullName: String(obj.personalInfo?.fullName || ''),
        headline: String(obj.personalInfo?.headline || ''),
        email: String(obj.personalInfo?.email || ''),
        phone: String(obj.personalInfo?.phone || ''),
        location: String(obj.personalInfo?.location || ''),
        websiteUrl: String(obj.personalInfo?.websiteUrl || ''),
      },
      summary: String(obj.summary || ''),
      experiences: Array.isArray(obj.experiences)
        ? obj.experiences.map((exp: any, i: number) => ({
            id: exp.id || `exp-${i + 1}`,
            company: String(exp.company || ''),
            position: String(exp.position || ''),
            location: String(exp.location || ''),
            startDate: String(exp.startDate || ''),
            endDate: String(exp.endDate || 'Present'),
            isCurrent: Boolean(exp.isCurrent),
            highlights: Array.isArray(exp.highlights) ? exp.highlights.map(String) : [],
          }))
        : [],
      educations: Array.isArray(obj.educations)
        ? obj.educations.map((edu: any, i: number) => ({
            id: edu.id || `edu-${i + 1}`,
            institution: String(edu.institution || ''),
            degree: String(edu.degree || ''),
            fieldOfStudy: String(edu.fieldOfStudy || ''),
            startDate: String(edu.startDate || ''),
            endDate: String(edu.endDate || ''),
            isCurrent: Boolean(edu.isCurrent),
          }))
        : [],
      projects: Array.isArray(obj.projects)
        ? obj.projects.map((proj: any, i: number) => ({
            id: proj.id || `proj-${i + 1}`,
            title: String(proj.title || ''),
            subtitle: String(proj.subtitle || ''),
            link: String(proj.link || ''),
            startDate: String(proj.startDate || ''),
            endDate: String(proj.endDate || ''),
            highlights: Array.isArray(proj.highlights) ? proj.highlights.map(String) : [],
            technologies: Array.isArray(proj.technologies) ? proj.technologies.map(String) : [],
          }))
        : [],
      skills: Array.isArray(obj.skills)
        ? obj.skills.map((s: any, i: number) => ({
            id: s.id || `skill-${i + 1}`,
            name: typeof s === 'string' ? s : String(s.name || ''),
            category: String(s.category || 'Technical'),
            level: typeof s.level === 'number' ? Math.min(5, Math.max(1, s.level)) : 4,
          }))
        : [],
      certificates: Array.isArray(obj.certificates)
        ? obj.certificates.map((c: any, i: number) => ({
            id: c.id || `cert-${i + 1}`,
            name: String(c.name || ''),
            issuer: String(c.issuer || ''),
            issueDate: String(c.issueDate || ''),
          }))
        : [],
      languages: Array.isArray(obj.languages)
        ? obj.languages.map((l: any, i: number) => ({
            id: l.id || `lang-${i + 1}`,
            language: String(l.language || ''),
            proficiency: String(l.proficiency || ''),
          }))
        : [],
      references: [],
      socialLinks: [],
    };

    return resumeContentSchema.parse(safeObj);
  }
}
