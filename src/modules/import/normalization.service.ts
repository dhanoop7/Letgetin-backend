import { ValidatedResumeContent } from './validator.service';

export class ResumeNormalizationService {
  /**
   * Performs data sanitization, formatting, and normalization across all fields:
   * Dates, Phone Numbers, Emails, URLs, Skills, Locations, Job Titles, Whitespace, Capitalization.
   */
  public static normalize(resume: ValidatedResumeContent): ValidatedResumeContent {
    return {
      personalInfo: {
        fullName: this.capitalizeTitle(this.cleanWhitespace(resume.personalInfo.fullName)),
        headline: this.capitalizeTitle(this.cleanWhitespace(resume.personalInfo.headline)),
        email: this.normalizeEmail(resume.personalInfo.email),
        phone: this.normalizePhone(resume.personalInfo.phone),
        location: this.capitalizeTitle(this.cleanWhitespace(resume.personalInfo.location)),
        websiteUrl: this.normalizeUrl(resume.personalInfo.websiteUrl),
      },
      summary: this.cleanWhitespace(resume.summary),
      experiences: resume.experiences.map((exp, index) => ({
        ...exp,
        id: exp.id || `exp-norm-${index + 1}`,
        company: this.capitalizeTitle(this.cleanWhitespace(exp.company)),
        position: this.capitalizeTitle(this.cleanWhitespace(exp.position)),
        location: this.capitalizeTitle(this.cleanWhitespace(exp.location)),
        startDate: this.normalizeDate(exp.startDate),
        endDate: this.normalizeDate(exp.endDate),
        highlights: exp.highlights.map((h) => this.cleanWhitespace(h)).filter(Boolean),
      })),
      educations: resume.educations.map((edu, index) => ({
        ...edu,
        id: edu.id || `edu-norm-${index + 1}`,
        institution: this.capitalizeTitle(this.cleanWhitespace(edu.institution)),
        degree: this.capitalizeTitle(this.cleanWhitespace(edu.degree)),
        fieldOfStudy: this.capitalizeTitle(this.cleanWhitespace(edu.fieldOfStudy)),
        startDate: this.normalizeDate(edu.startDate),
        endDate: this.normalizeDate(edu.endDate),
      })),
      projects: resume.projects.map((proj, index) => ({
        ...proj,
        id: proj.id || `proj-norm-${index + 1}`,
        title: this.capitalizeTitle(this.cleanWhitespace(proj.title)),
        subtitle: this.cleanWhitespace(proj.subtitle),
        link: this.normalizeUrl(proj.link),
        startDate: this.normalizeDate(proj.startDate),
        endDate: this.normalizeDate(proj.endDate),
        highlights: proj.highlights.map((h) => this.cleanWhitespace(h)).filter(Boolean),
        technologies: proj.technologies.map((t) => this.cleanWhitespace(t)).filter(Boolean),
      })),
      skills: this.normalizeSkills(resume.skills),
      certificates: resume.certificates.map((cert, index) => ({
        ...cert,
        id: cert.id || `cert-norm-${index + 1}`,
        name: this.capitalizeTitle(this.cleanWhitespace(cert.name)),
        issuer: this.capitalizeTitle(this.cleanWhitespace(cert.issuer)),
        issueDate: this.normalizeDate(cert.issueDate),
      })),
      languages: resume.languages.map((lang, index) => ({
        ...lang,
        id: lang.id || `lang-norm-${index + 1}`,
        language: this.capitalizeTitle(this.cleanWhitespace(lang.language)),
        proficiency: this.capitalizeTitle(this.cleanWhitespace(lang.proficiency)),
      })),
      references: [],
      socialLinks: [],
    };
  }

  public static cleanWhitespace(str: string | undefined | null): string {
    if (!str) return '';
    return str.replace(/\s+/g, ' ').trim();
  }

  public static normalizeEmail(email: string | undefined | null): string {
    if (!email) return '';
    const cleaned = email.trim().toLowerCase();
    const match = cleaned.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
    return match ? match[0] : cleaned;
  }

  public static normalizePhone(phone: string | undefined | null): string {
    if (!phone) return '';
    const cleaned = phone.replace(/[^\d+()\s-]/g, '').trim();
    return cleaned;
  }

  public static normalizeUrl(url: string | undefined | null): string {
    if (!url) return '';
    const trimmed = url.trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  }

  public static normalizeDate(dateStr: string | undefined | null): string {
    if (!dateStr) return '';
    const cleaned = dateStr.trim();
    if (/present|current|now|today/i.test(cleaned)) {
      return 'Present';
    }
    const match = cleaned.match(/\b(19|20)\d{2}(?:[-/](0[1-9]|1[0-2]))?\b/);
    if (match) {
      return match[0];
    }
    return cleaned;
  }

  public static capitalizeTitle(str: string): string {
    if (!str) return '';
    const smallWords = /^(a|an|and|as|at|but|by|en|for|if|in|of|on|or|the|to|v\.?|via)$/i;
    return str
      .split(' ')
      .map((word, index) => {
        if (index > 0 && smallWords.test(word)) {
          return word.toLowerCase();
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ');
  }

  public static normalizeSkills(
    skills: Array<{ id?: string; name: string; category: string; level: number }>
  ) {
    const knownTechMap: Record<string, string> = {
      typescript: 'TypeScript',
      javascript: 'JavaScript',
      react: 'React.js',
      reactjs: 'React.js',
      nextjs: 'Next.js',
      nodejs: 'Node.js',
      expressjs: 'Express.js',
      python: 'Python',
      mongodb: 'MongoDB',
      postgresql: 'PostgreSQL',
      docker: 'Docker',
      kubernetes: 'Kubernetes',
      aws: 'AWS',
      graphql: 'GraphQL',
      tailwindcss: 'Tailwind CSS',
    };

    const uniqueMap = new Map<
      string,
      { id: string; name: string; category: string; level: number }
    >();

    skills.forEach((sk, i) => {
      const rawName = this.cleanWhitespace(sk.name);
      if (!rawName) return;

      const lowerKey = rawName.toLowerCase();
      const normalizedName = knownTechMap[lowerKey] || this.capitalizeTitle(rawName);

      if (!uniqueMap.has(normalizedName)) {
        uniqueMap.set(normalizedName, {
          id: sk.id || `skill-norm-${i + 1}`,
          name: normalizedName,
          category: this.capitalizeTitle(this.cleanWhitespace(sk.category || 'Technical')),
          level: Math.min(5, Math.max(1, sk.level || 4)),
        });
      }
    });

    return Array.from(uniqueMap.values());
  }
}
