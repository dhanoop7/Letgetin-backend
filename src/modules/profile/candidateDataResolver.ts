/**
 * Candidate Data Resolver
 * 
 * Centralized, authoritative runtime resolver that deterministically merges candidate data from:
 * 1. UserProfileModel (current profile state, personal/contact details, track)
 * 2. ResumeModel.content (rich parsed resume JSON, project items, skill levels/categories)
 * 3. CandidateProfileModel (denormalized search projection, if available)
 * 4. UserModel (base account identity)
 * 
 * Rules:
 * - Deterministic precedence: Current profile is authoritative for contact/identity; resume is authoritative for rich historical projects and metadata.
 * - Accurate experience calculation: Uses ExperienceCalculator on actual merged date ranges; zero hardcoded heuristics.
 * - Proper skill deduplication: Case-insensitive unique union preserving resume level/category metadata; NO hardcoded tech fallbacks.
 * - Proper education & project normalization.
 */

import { ExperienceCalculator, RawExperienceEntry } from './experienceCalculator.js';

export interface INormalizedSkill {
  name: string;
  category?: string;
  level?: number;
}

export interface INormalizedExperience {
  company: string;
  position: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
  highlights: string[];
}

export interface INormalizedEducation {
  institution: string;
  degree: string;
  fieldOfStudy?: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
  gradeScore?: string;
  certificateUrl?: string;
}

export interface INormalizedProject {
  title: string;
  subtitle?: string;
  link?: string;
  startDate?: string;
  endDate?: string;
  highlights: string[];
  technologies: string[];
}

export interface IResolvedCandidateData {
  userId: string;
  fullName: string;
  email?: string;
  phone?: string;
  headline: string;
  summary: string;
  location: string;
  skills: string[];                     // Flat deduplicated array for fast matching
  detailedSkills: INormalizedSkill[];   // Rich metadata (category, level)
  experiences: INormalizedExperience[];
  totalExperienceMonths: number;
  totalExperienceYears: number;
  educations: INormalizedEducation[];
  projects: INormalizedProject[];
  isFresher: boolean;
}

export interface ResolveCandidateInput {
  userId?: string;
  user?: any;
  userProfile?: any;
  resume?: any;
  candidateProfile?: any;
}

export class CandidateDataResolver {
  /**
   * Resolves and normalizes candidate data from all available sources in memory.
   */
  public static resolve(input: ResolveCandidateInput): IResolvedCandidateData {
    const { user, userProfile, resume, candidateProfile } = input;
    const userId = String(
      input.userId ||
      user?._id ||
      userProfile?.userId ||
      resume?.userId ||
      candidateProfile?.userId ||
      ''
    );

    const resumeContent = (resume?.content && typeof resume.content === 'object') ? resume.content : {};

    // 1. Fresher determination
    const isFresher = userProfile?.track === 'fresher';

    // 2. Personal & Contact info
    const fullName = (
      userProfile?.contact?.fullName ||
      user?.fullName ||
      resumeContent?.personalInfo?.fullName ||
      user?.username ||
      'Candidate'
    ).trim();

    const email = (
      userProfile?.contact?.email ||
      user?.email ||
      resumeContent?.personalInfo?.email ||
      ''
    ).trim();

    const phone = (
      userProfile?.contact?.phone ||
      user?.phone ||
      resumeContent?.personalInfo?.phone ||
      ''
    ).trim();

    // Location precedence: Profile structured location -> Resume location -> CandidateProfile location
    let location = '';
    if (userProfile?.contact?.city || userProfile?.contact?.country) {
      const parts = [userProfile.contact.city, userProfile.contact.country].filter(Boolean);
      location = parts.join(', ');
    } else if (resumeContent?.personalInfo?.location) {
      location = String(resumeContent.personalInfo.location).trim();
    } else if (candidateProfile?.location) {
      location = String(candidateProfile.location).trim();
    }

    // Headline & Summary precedence
    let headline = '';
    if (userProfile?.personal?.headline?.trim()) {
      headline = userProfile.personal.headline.trim();
    } else if (resumeContent?.personalInfo?.headline?.trim()) {
      headline = resumeContent.personalInfo.headline.trim();
    } else if (userProfile?.experience?.title?.trim()) {
      headline = userProfile.experience.title.trim();
    } else if (candidateProfile?.headline?.trim()) {
      headline = candidateProfile.headline.trim();
    }

    let summary = '';
    if (userProfile?.personal?.bio?.trim()) {
      summary = userProfile.personal.bio.trim();
    } else if (resumeContent?.summary?.trim()) {
      summary = resumeContent.summary.trim();
    } else if (candidateProfile?.summary?.trim()) {
      summary = candidateProfile.summary.trim();
    }

    // 3. Skills Resolution & Deduplication
    const skillsMap = new Map<string, INormalizedSkill>();

    // Step 3a: Resume skills (richer: category, level)
    if (Array.isArray(resumeContent?.skills)) {
      for (const item of resumeContent.skills) {
        if (!item) continue;
        const name = typeof item === 'string' ? item.trim() : (item.name ? String(item.name).trim() : '');
        if (!name) continue;
        const key = name.toLowerCase();
        if (!skillsMap.has(key)) {
          skillsMap.set(key, {
            name,
            category: typeof item === 'object' && item.category ? String(item.category) : undefined,
            level: typeof item === 'object' && typeof item.level === 'number' ? item.level : undefined,
          });
        }
      }
    }

    // Step 3b: UserProfile skills
    if (Array.isArray(userProfile?.skills)) {
      for (const item of userProfile.skills) {
        if (typeof item !== 'string') continue;
        const name = item.trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (!skillsMap.has(key)) {
          skillsMap.set(key, { name });
        }
      }
    }

    // Step 3c: CandidateProfile skills fallback (if not already captured)
    if (Array.isArray(candidateProfile?.skills)) {
      for (const item of candidateProfile.skills) {
        if (typeof item !== 'string') continue;
        const name = item.trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (!skillsMap.has(key)) {
          skillsMap.set(key, { name });
        }
      }
    }

    // Flatten skills (NO hardcoded tech fallback! A candidate with no skills has empty array)
    const detailedSkills = Array.from(skillsMap.values());
    const skills = detailedSkills.map((s) => s.name);

    // 4. Experiences Resolution & Deduplication
    const experienceMap = new Map<string, INormalizedExperience>();
    const rawExperienceEntriesForDuration: RawExperienceEntry[] = [];

    // Step 4a: Resume experiences
    if (Array.isArray(resumeContent?.experiences)) {
      for (const exp of resumeContent.experiences) {
        if (!exp) continue;
        const company = String(exp.company || '').trim();
        const position = String(exp.position || exp.title || '').trim();
        if (!company && !position) continue;

        const key = `${company.toLowerCase()}::${position.toLowerCase()}`;
        const highlights = Array.isArray(exp.highlights)
          ? exp.highlights.map((h: any) => String(h).trim()).filter(Boolean)
          : [];

        const normalizedExp: INormalizedExperience = {
          company: company || 'Organization',
          position: position || 'Role',
          location: exp.location ? String(exp.location).trim() : undefined,
          startDate: exp.startDate ? String(exp.startDate).trim() : undefined,
          endDate: exp.endDate ? String(exp.endDate).trim() : undefined,
          isCurrent: !!exp.isCurrent,
          highlights,
        };

        experienceMap.set(key, normalizedExp);
        rawExperienceEntriesForDuration.push({
          startDate: normalizedExp.startDate,
          endDate: normalizedExp.endDate,
          isCurrent: normalizedExp.isCurrent,
        });
      }
    }

    // Step 4b: UserProfile experiencesList
    if (Array.isArray(userProfile?.experiencesList)) {
      for (const exp of userProfile.experiencesList) {
        if (!exp) continue;
        const company = String(exp.company || '').trim();
        const position = String(exp.title || '').trim();
        if (!company && !position) continue;

        const key = `${company.toLowerCase()}::${position.toLowerCase()}`;
        if (!experienceMap.has(key)) {
          const highlights = exp.highlights ? [String(exp.highlights).trim()] : [];
          const normalizedExp: INormalizedExperience = {
            company: company || 'Organization',
            position: position || 'Role',
            startDate: exp.start ? String(exp.start).trim() : undefined,
            endDate: exp.end ? String(exp.end).trim() : undefined,
            isCurrent: exp.end ? /^(present|current|now|ongoing)$/i.test(String(exp.end).trim()) : true,
            highlights,
          };
          experienceMap.set(key, normalizedExp);
          rawExperienceEntriesForDuration.push({
            startDate: normalizedExp.startDate,
            endDate: normalizedExp.endDate,
            isCurrent: normalizedExp.isCurrent,
          });
        }
      }
    } else if (userProfile?.experience?.company || userProfile?.experience?.title) {
      // Legacy single experience on profile
      const exp = userProfile.experience;
      const company = String(exp.company || '').trim();
      const position = String(exp.title || '').trim();
      if (company || position) {
        const key = `${company.toLowerCase()}::${position.toLowerCase()}`;
        if (!experienceMap.has(key)) {
          const normalizedExp: INormalizedExperience = {
            company: company || 'Organization',
            position: position || 'Role',
            startDate: exp.start ? String(exp.start).trim() : undefined,
            endDate: exp.end ? String(exp.end).trim() : undefined,
            isCurrent: exp.end ? /^(present|current|now|ongoing)$/i.test(String(exp.end).trim()) : true,
            highlights: exp.highlights ? [String(exp.highlights).trim()] : [],
          };
          experienceMap.set(key, normalizedExp);
          rawExperienceEntriesForDuration.push({
            startDate: normalizedExp.startDate,
            endDate: normalizedExp.endDate,
            isCurrent: normalizedExp.isCurrent,
          });
        }
      }
    }

    const experiences = Array.from(experienceMap.values());

    // Compute accurate non-overlapping duration
    const expResult = ExperienceCalculator.calculateTotalExperience(
      rawExperienceEntriesForDuration,
      isFresher
    );

    // 5. Education Resolution & Deduplication
    const educationMap = new Map<string, INormalizedEducation>();

    // Step 5a: Resume educations
    if (Array.isArray(resumeContent?.educations)) {
      for (const edu of resumeContent.educations) {
        if (!edu) continue;
        const institution = String(edu.institution || '').trim();
        const degree = String(edu.degree || '').trim();
        if (!institution && !degree) continue;

        const key = `${institution.toLowerCase()}::${degree.toLowerCase()}`;
        educationMap.set(key, {
          institution: institution || 'Institution',
          degree: degree || 'Degree',
          fieldOfStudy: edu.fieldOfStudy ? String(edu.fieldOfStudy).trim() : undefined,
          startDate: edu.startDate ? String(edu.startDate).trim() : undefined,
          endDate: edu.endDate ? String(edu.endDate).trim() : undefined,
          isCurrent: !!edu.isCurrent,
          gradeScore: edu.gradeScore ? String(edu.gradeScore).trim() : undefined,
        });
      }
    }

    // Step 5b: UserProfile educationsList
    if (Array.isArray(userProfile?.educationsList)) {
      for (const edu of userProfile.educationsList) {
        if (!edu) continue;
        const institution = String(edu.institution || '').trim();
        const degree = String(edu.degree || '').trim();
        if (!institution && !degree) continue;

        const key = `${institution.toLowerCase()}::${degree.toLowerCase()}`;
        const existing = educationMap.get(key);
        if (existing) {
          // Enrich with certificateUrl or missing dates
          if (edu.certificateUrl) existing.certificateUrl = edu.certificateUrl;
          if (!existing.startDate && edu.startYear) existing.startDate = String(edu.startYear);
          if (!existing.endDate && edu.endYear) existing.endDate = String(edu.endYear);
        } else {
          educationMap.set(key, {
            institution: institution || 'Institution',
            degree: degree || 'Degree',
            startDate: edu.startYear ? String(edu.startYear) : undefined,
            endDate: edu.endYear ? String(edu.endYear) : undefined,
            certificateUrl: edu.certificateUrl ? String(edu.certificateUrl) : undefined,
          });
        }
      }
    } else if (userProfile?.education?.institution || userProfile?.education?.degree) {
      // Legacy single education
      const edu = userProfile.education;
      const institution = String(edu.institution || '').trim();
      const degree = String(edu.degree || '').trim();
      if (institution || degree) {
        const key = `${institution.toLowerCase()}::${degree.toLowerCase()}`;
        if (!educationMap.has(key)) {
          educationMap.set(key, {
            institution: institution || 'Institution',
            degree: degree || 'Degree',
            startDate: edu.startYear ? String(edu.startYear) : undefined,
            endDate: edu.endYear ? String(edu.endYear) : undefined,
            certificateUrl: edu.certificateUrl ? String(edu.certificateUrl) : undefined,
          });
        }
      }
    }

    const educations = Array.from(educationMap.values());

    // 6. Projects Resolution (from resumeContent)
    const projects: INormalizedProject[] = [];
    if (Array.isArray(resumeContent?.projects)) {
      const seenTitles = new Set<string>();
      for (const proj of resumeContent.projects) {
        if (!proj) continue;
        const title = String(proj.title || '').trim();
        if (!title || seenTitles.has(title.toLowerCase())) continue;
        seenTitles.add(title.toLowerCase());

        projects.push({
          title,
          subtitle: proj.subtitle ? String(proj.subtitle).trim() : undefined,
          link: proj.link ? String(proj.link).trim() : undefined,
          startDate: proj.startDate ? String(proj.startDate).trim() : undefined,
          endDate: proj.endDate ? String(proj.endDate).trim() : undefined,
          highlights: Array.isArray(proj.highlights)
            ? proj.highlights.map((h: any) => String(h).trim()).filter(Boolean)
            : [],
          technologies: Array.isArray(proj.technologies)
            ? proj.technologies.map((t: any) => String(t).trim()).filter(Boolean)
            : [],
        });
      }
    }

    return {
      userId,
      fullName,
      email,
      phone,
      headline,
      summary,
      location,
      skills,
      detailedSkills,
      experiences,
      totalExperienceMonths: expResult.totalMonths,
      totalExperienceYears: expResult.totalYears,
      educations,
      projects,
      isFresher,
    };
  }

  /**
   * Helper to format resolved candidate data into the payload expected by embeddingService.buildCandidateEmbeddingText
   */
  public static toEmbeddingPayload(resolved: IResolvedCandidateData) {
    return {
      personalInfo: {
        fullName: resolved.fullName,
        headline: resolved.headline,
        location: resolved.location,
      },
      summary: resolved.summary,
      skills: resolved.detailedSkills.length > 0 ? resolved.detailedSkills : resolved.skills,
      experiences: resolved.experiences.map((e) => ({
        company: e.company,
        position: e.position,
        startDate: e.startDate,
        endDate: e.endDate,
        highlights: e.highlights,
      })),
      educations: resolved.educations.map((e) => ({
        institution: e.institution,
        degree: e.degree,
        fieldOfStudy: e.fieldOfStudy,
        startDate: e.startDate,
        endDate: e.endDate,
      })),
      projects: resolved.projects.map((p) => ({
        title: p.title,
        highlights: p.highlights,
        technologies: p.technologies,
      })),
    };
  }

  /**
   * Helper to format primary education as a clean display/model string
   */
  public static getPrimaryEducationString(resolved: IResolvedCandidateData): string {
    if (!resolved.educations || resolved.educations.length === 0) return '';
    const edu = resolved.educations[0];
    const degreeAndField = [edu.degree, edu.fieldOfStudy].filter(Boolean).join(' ');
    if (degreeAndField && edu.institution) {
      return `${degreeAndField} - ${edu.institution}`.trim();
    }
    return (degreeAndField || edu.institution || '').trim();
  }
}

