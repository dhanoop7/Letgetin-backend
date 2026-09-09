import { RecruiterOrgRepository } from './recruiterOrg.repository.js';
import { AppError } from '../../utils/appError.js';
import { IRecruiterOrganizationDocument, EntityType } from './recruiterOrg.model.js';
import { ORG_FORM_META, OrgFormMeta } from './orgFormMeta.constants.js';
import { SaveOrgProfileInput } from './recruiterOrg.validator.js';
import { JobModel } from '../job/job.model.js';
import { CandidateProfileModel } from '../job/candidateProfile.model.js';
import { ApplicationModel } from '../application/application.model.js';
import { RecruiterCreditsModel } from '../recruiterCredits/recruiterCredits.model.js';
import { UserModel } from '../user/user.model.js';

// Funnel stages in pipeline order. A candidate "reaches" a stage if their current status is this
// stage or any later one — the only honest reading available since we store a single current
// status per application, not per-stage history. rejected/failed only ever count as "submitted".
const FUNNEL_STAGES: { stage: string; label: string; statuses: string[] }[] = [
  { stage: 'submitted', label: 'Applicants', statuses: ['submitted', 'reviewing', 'shortlisted', 'interviewing', 'offered'] },
  { stage: 'reviewing', label: 'Reviewing', statuses: ['reviewing', 'shortlisted', 'interviewing', 'offered'] },
  { stage: 'shortlisted', label: 'Shortlisted', statuses: ['shortlisted', 'interviewing', 'offered'] },
  { stage: 'interviewing', label: 'Interviewing', statuses: ['interviewing', 'offered'] },
  { stage: 'offered', label: 'Offered', statuses: ['offered'] },
];

interface OverviewJob {
  _id: any;
  title: string;
  status: string;
  recruiterStage?: string;
  skills: string[];
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

interface OverviewApplication {
  _id: any;
  jobId: any;
  userId: any;
  status: string;
  matchScore?: number;
  appliedAt: Date;
}
import { fetchAndExtractPageContent } from './urlFetcher.util.js';
import { buildOrgAutofillPrompt } from './orgAutofill.prompt.js';
import { GoogleProvider } from '../ai/providers/google.provider.js';

const AUTOFILL_FIELD_KEYS = [
  'name',
  'headquarters',
  'address',
  'orgType',
  'employees',
  'valuation',
  'revenue',
  'ceoName',
  'ceoEmail',
  'founded',
  'industry',
  'registrationId',
  'bio',
  'description',
  'whyJoinUs',
  'website',
] as const;

export type OrgAutofillFields = Partial<Record<(typeof AUTOFILL_FIELD_KEYS)[number], string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FIELD_LENGTH = 1000;

export class RecruiterOrgService {
  private repository: RecruiterOrgRepository;

  constructor() {
    this.repository = new RecruiterOrgRepository();
  }

  getOrgFormMeta(entity: EntityType): OrgFormMeta {
    return ORG_FORM_META[entity];
  }

  async getOrgProfile(ownerUserId: string): Promise<IRecruiterOrganizationDocument | null> {
    return await this.repository.findByOwnerUserId(ownerUserId);
  }

  async saveOrgProfile(ownerUserId: string, data: SaveOrgProfileInput): Promise<IRecruiterOrganizationDocument> {
    const payload = { ...data };
    if (payload.description && !payload.bio) payload.bio = payload.description;
    if (payload.bio && !payload.description) payload.description = payload.bio;
    if (payload.headquarters && !payload.address) payload.address = payload.headquarters;
    if (payload.address && !payload.headquarters) payload.headquarters = payload.address;

    const existing = await this.repository.findByOwnerUserId(ownerUserId);
    if (existing) {
      const updated = await this.repository.updateById(existing._id.toString(), payload);
      if (!updated) {
        throw AppError.internal('Failed to update organization profile');
      }
      return updated;
    }
    return await this.repository.create({ ...payload, ownerUserId: ownerUserId as any });
  }

  /**
   * Fetches a recruiter-supplied website URL and uses Gemini AI to extract and suggest values for
   * company profile fields. If AI extraction is unavailable, gracefully falls back to structured
   * OpenGraph, title, and Schema metadata.
   */
  async autofillOrgProfile(entity: EntityType, url: string): Promise<OrgAutofillFields> {
    const content = await fetchAndExtractPageContent(url);

    let raw: unknown = null;
    try {
      const { systemInstruction, prompt } = buildOrgAutofillPrompt(entity, content);
      const response = await GoogleProvider.getInstance().generate({
        promptName: 'recruiter-org-autofill',
        systemInstruction,
        prompt,
        jsonMode: true,
      });
      raw = JSON.parse(response.text);
    } catch (err) {
      console.warn('[RecruiterOrgService] Gemini AI extraction unavailable, using metadata fallback:', (err as Error)?.message);
      raw = this.extractFallbackFields(content, url);
    }

    const sanitized = this.sanitizeAutofillFields(entity, raw);
    if (!sanitized.website && url) {
      sanitized.website = url;
    }
    return sanitized;
  }

  private extractFallbackFields(content: Awaited<ReturnType<typeof fetchAndExtractPageContent>>, url: string): Record<string, unknown> {
    const fallback: Record<string, unknown> = {};
    const name =
      content.ogTags['og:site_name'] ||
      content.title?.split(/[-–—|:]/)[0]?.trim() ||
      new URL(url).hostname.replace(/^www\./i, '').split('.')[0];
    if (name) fallback.name = name;

    const desc = content.ogTags['og:description'] || content.metaDescription;
    if (desc) {
      fallback.bio = desc;
      fallback.description = desc;
    }

    fallback.website = url;

    // Inspect structured jsonLd if present
    for (const item of content.jsonLd) {
      if (typeof item !== 'object' || !item) continue;
      const ld = item as Record<string, any>;
      if (ld['@type'] === 'Organization' || ld['@type'] === 'Corporation') {
        if (ld.name && typeof ld.name === 'string') fallback.name = ld.name;
        if (ld.description && typeof ld.description === 'string') {
          fallback.bio = ld.description;
          fallback.description = ld.description;
        }
        if (ld.foundingDate) fallback.founded = String(ld.foundingDate).slice(0, 4);
        if (ld.address) {
          const addr = typeof ld.address === 'string' ? ld.address : [ld.address.addressLocality, ld.address.addressRegion, ld.address.addressCountry].filter(Boolean).join(', ');
          if (addr) {
            fallback.headquarters = addr;
            fallback.address = addr;
          }
        }
      }
    }
    return fallback;
  }

  private sanitizeAutofillFields(entity: EntityType, raw: unknown): OrgAutofillFields {
    if (!raw || typeof raw !== 'object') return {};
    const meta = ORG_FORM_META[entity];
    const source = raw as Record<string, unknown>;
    const result: OrgAutofillFields = {};

    for (const key of AUTOFILL_FIELD_KEYS) {
      const value = source[key];
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (!trimmed) continue;

      if (key === 'orgType') {
        const match = meta.typeOptions.find((opt) => opt.toLowerCase() === trimmed.toLowerCase());
        if (match) result.orgType = match;
        continue;
      }
      if (key === 'employees') {
        // Normalize dashes & commas: "1-10", "1–10", "501-1000", "501–1,000"
        const norm = (s: string) => s.replace(/[\u2013\u2014-]/g, '-').replace(/,/g, '').toLowerCase().trim();
        const match = meta.sizeOptions.find((opt) => norm(opt) === norm(trimmed));
        if (match) {
          result.employees = match;
        } else {
          result.employees = trimmed.slice(0, MAX_FIELD_LENGTH);
        }
        continue;
      }
      if (key === 'ceoEmail') {
        if (EMAIL_RE.test(trimmed)) result.ceoEmail = trimmed.slice(0, MAX_FIELD_LENGTH);
        continue;
      }

      result[key] = trimmed.slice(0, MAX_FIELD_LENGTH);
    }

    if (result.description && !result.bio) result.bio = result.description;
    if (result.bio && !result.description) result.description = result.bio;
    if (result.headquarters && !result.address) result.address = result.headquarters;
    if (result.address && !result.headquarters) result.headquarters = result.address;

    return result;
  }

  async getOverview(ownerUserId: string) {
    const org = await this.repository.findByOwnerUserId(ownerUserId);

    const [jobs, credits] = await Promise.all([
      JobModel.find({ postedBy: ownerUserId })
        .select('title status recruiterStage skills createdAt updatedAt completedAt')
        .lean<OverviewJob[]>(),
      org ? RecruiterCreditsModel.findOne({ orgId: org._id }).lean() : null,
    ]);

    const jobIds = jobs.map((j) => j._id);
    const applications = jobIds.length
      ? await ApplicationModel.find({ jobId: { $in: jobIds } })
          .select('jobId userId status matchScore appliedAt')
          .sort({ appliedAt: -1 })
          .lean<OverviewApplication[]>()
      : [];

    const jobsById = new Map(jobs.map((j) => [String(j._id), j]));
    const applicationsByJob = new Map<string, OverviewApplication[]>();
    for (const app of applications) {
      const key = String(app.jobId);
      const list = applicationsByJob.get(key) || [];
      list.push(app);
      applicationsByJob.set(key, list);
    }

    const openRoles = jobs.filter((j) => j.status === 'active' && (j.recruiterStage || 'open') !== 'completed').length;
    const activeCandidates = applications.length;

    const completedJobs = jobs.filter((j) => j.recruiterStage === 'completed' && j.completedAt);
    const avgTimeToFillDays = completedJobs.length
      ? Math.round(
          completedJobs.reduce(
            (sum, j) => sum + (new Date(j.completedAt!).getTime() - new Date(j.createdAt).getTime()) / 86_400_000,
            0
          ) / completedJobs.length
        )
      : null;

    const aiMatchRate = applications.length
      ? Math.round(applications.reduce((sum, a) => sum + (a.matchScore || 0), 0) / applications.length)
      : null;

    const funnel = FUNNEL_STAGES.map(({ stage, label, statuses }) => ({
      stage,
      label,
      count: applications.filter((a) => statuses.includes(a.status)).length,
    }));

    const recentActivity = [...jobs]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5)
      .map((j) => ({
        jobId: String(j._id),
        title: j.title,
        applicantCount: (applicationsByJob.get(String(j._id)) || []).length,
        stage: j.recruiterStage || 'open',
        updatedAt: j.updatedAt,
      }));

    const topApplications = [...applications]
      .filter((a) => typeof a.matchScore === 'number')
      .sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
    const seenCandidates = new Set<string>();
    const topMatchApps: OverviewApplication[] = [];
    for (const app of topApplications) {
      const key = String(app.userId);
      if (seenCandidates.has(key)) continue;
      seenCandidates.add(key);
      topMatchApps.push(app);
      if (topMatchApps.length >= 5) break;
    }
    const topCandidateIds = topMatchApps.map((a) => a.userId);
    const [topUsers, topProfiles] = topCandidateIds.length
      ? await Promise.all([
          UserModel.find({ _id: { $in: topCandidateIds } }).select('fullName username').lean(),
          CandidateProfileModel.find({ userId: { $in: topCandidateIds } })
            .select('userId headline yearsOfExperience skills')
            .lean(),
        ])
      : [[], []];
    const usersById = new Map(topUsers.map((u) => [String(u._id), u]));
    const profilesByUser = new Map(topProfiles.map((p) => [String(p.userId), p]));
    const topMatches = topMatchApps.map((app) => {
      const user = usersById.get(String(app.userId));
      const profile = profilesByUser.get(String(app.userId));
      const job = jobsById.get(String(app.jobId));
      return {
        candidateName: user?.fullName || user?.username || 'Candidate',
        headline: profile?.headline || undefined,
        yearsOfExperience: profile?.yearsOfExperience,
        jobTitle: job?.title || '',
        matchScore: app.matchScore || 0,
      };
    });

    const aiInsights = this.computeAiInsights(jobs, applications, profilesByUser);
    const funnelInsights = this.computeFunnelInsights(funnel);

    return {
      kpis: {
        openRoles,
        openRolesContext: jobs.length > openRoles ? `${jobs.length} total roles` : undefined,
        activeCandidates,
        avgTimeToFillDays,
        aiMatchRate,
        credits: credits?.balance ?? 0,
      },
      recentActivity,
      topMatches,
      funnel,
      aiInsights,
      funnelInsights,
    };
  }

  private computeAiInsights(
    jobs: OverviewJob[],
    applications: OverviewApplication[],
    profilesByUser: Map<string, { skills?: string[] }>
  ): { kind: 'suggestion' | 'success' | 'warning'; text: string }[] {
    const insights: { kind: 'suggestion' | 'success' | 'warning'; text: string }[] = [];
    const now = Date.now();

    for (const job of jobs) {
      if (insights.length >= 3) break;
      if (job.recruiterStage === 'completed') continue;
      const jobApps = applications.filter((a) => String(a.jobId) === String(job._id));
      const daysOpen = Math.round((now - new Date(job.createdAt).getTime()) / 86_400_000);

      if (daysOpen > 14 && jobApps.length < 5) {
        insights.push({
          kind: 'warning',
          text: `${job.title} has been open ${daysOpen} days with low inflow. Consider widening the location or salary band.`,
        });
        continue;
      }

      const highScorers = jobApps.filter((a) => (a.matchScore || 0) >= 80);
      if (jobApps.length >= 5 && highScorers.length > 0) {
        insights.push({
          kind: 'success',
          text: `Resume screening for ${job.title} is complete — ${highScorers.length} candidate${
            highScorers.length === 1 ? '' : 's'
          } cleared the 80% match threshold.`,
        });
        continue;
      }

      const topMatchedApps = jobApps.filter((a) => (a.matchScore || 0) >= 70);
      if (topMatchedApps.length >= 3) {
        const skillCounts = new Map<string, number>();
        for (const app of topMatchedApps) {
          const skills = profilesByUser.get(String(app.userId))?.skills || [];
          for (const skill of skills) {
            const key = skill.toLowerCase();
            skillCounts.set(key, (skillCounts.get(key) || 0) + 1);
          }
        }
        const jobSkillsLower = new Set((job.skills || []).map((s) => s.toLowerCase()));
        for (const [skill, count] of skillCounts) {
          const pct = Math.round((count / topMatchedApps.length) * 100);
          if (pct >= 50 && !jobSkillsLower.has(skill)) {
            insights.push({
              kind: 'suggestion',
              text: `Add "${skill}" to the ${job.title} requisition — ${pct}% of top matches list it as a core skill.`,
            });
            break;
          }
        }
      }
    }

    return insights.slice(0, 3);
  }

  private computeFunnelInsights(
    funnel: { stage: string; label: string; count: number }[]
  ): { kind: 'success' | 'warning'; text: string }[] {
    const MIN_SAMPLE = 5;
    const conversions: { from: string; to: string; rate: number }[] = [];
    for (let i = 0; i < funnel.length - 1; i++) {
      const from = funnel[i];
      const to = funnel[i + 1];
      if (from.count < MIN_SAMPLE) continue;
      conversions.push({ from: from.label, to: to.label, rate: to.count / from.count });
    }
    if (conversions.length === 0) return [];

    const insights: { kind: 'success' | 'warning'; text: string }[] = [];
    const weakest = conversions.reduce((min, c) => (c.rate < min.rate ? c : min));
    if (weakest.rate < 0.4) {
      insights.push({
        kind: 'warning',
        text: `Candidate drop-off is highest between ${weakest.from} and ${weakest.to} (${Math.round(
          weakest.rate * 100
        )}% conversion).`,
      });
    }
    const strongest = conversions.reduce((max, c) => (c.rate > max.rate ? c : max));
    if (strongest.rate >= 0.6 && strongest !== weakest) {
      insights.push({
        kind: 'success',
        text: `${strongest.from}-to-${strongest.to} conversion is strong at ${Math.round(strongest.rate * 100)}%.`,
      });
    }
    return insights;
  }
}
