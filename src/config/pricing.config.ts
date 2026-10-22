/**
 * Authoritative Credit System & Pricing Configuration
 * Source of truth: Letgetin-Credit-Plan.docx
 * Strictly follows ₹10 = 1 credit.
 */

export const CREDIT_VALUE_INR = 10;
export const INITIAL_PROMOTIONAL_CREDITS = 20; // ₹200
export const REFERRAL_REWARD_CREDITS = 10; // ₹100

export interface FeaturePriceItem {
  id: string;
  name: string;
  chargingUnit: string;
  credits: number;
  priceInr: number;
  category: 'recruitment' | 'assessment' | 'candidate' | 'promotion' | 'learning' | 'institution' | 'startup' | 'verification';
  description?: string;
  caseByCase?: boolean;
}

export const FEATURE_PRICING: Record<string, FeaturePriceItem> = {
  // C. Job posting and recruitment activities
  standard_job_posting: {
    id: 'standard_job_posting',
    name: 'Standard Job Posting',
    chargingUnit: 'Per job',
    credits: 10,
    priceInr: 100,
    category: 'recruitment',
  },
  premium_job_posting: {
    id: 'premium_job_posting',
    name: 'Premium Job Posting',
    chargingUnit: 'Per job',
    credits: 20,
    priceInr: 200,
    category: 'recruitment',
  },
  ats_resume: {
    id: 'ats_resume',
    name: 'ATS Resume',
    chargingUnit: 'Per resume processed',
    credits: 30,
    priceInr: 300,
    category: 'recruitment',
  },
  verified_resume: {
    id: 'verified_resume',
    name: 'Verified Resume',
    chargingUnit: 'Per verification',
    credits: 30,
    priceInr: 300,
    category: 'verification',
  },
  mockup_assessment: {
    id: 'mockup_assessment',
    name: 'Mockup Assessment',
    chargingUnit: 'Per candidate assessment',
    credits: 20,
    priceInr: 200,
    category: 'assessment',
  },
  mockup_interview: {
    id: 'mockup_interview',
    name: 'Mockup Interview',
    chargingUnit: 'Per candidate interview',
    credits: 20,
    priceInr: 200,
    category: 'assessment',
  },
  ai_apply_10jobs_1day: {
    id: 'ai_apply_10jobs_1day',
    name: 'AI Apply — 10 jobs/day',
    chargingUnit: '1-day package',
    credits: 20,
    priceInr: 200,
    category: 'candidate',
  },
  ai_apply_20jobs_7days: {
    id: 'ai_apply_20jobs_7days',
    name: 'AI Apply — 20 jobs/1 week',
    chargingUnit: '7-day package',
    credits: 40,
    priceInr: 400,
    category: 'candidate',
  },
  ai_apply_50jobs_10days: {
    id: 'ai_apply_50jobs_10days',
    name: 'AI Apply — 50 jobs/10 days',
    chargingUnit: '10-day package',
    credits: 50,
    priceInr: 500,
    category: 'candidate',
  },
  ai_hire: {
    id: 'ai_hire',
    name: 'AI Hire',
    chargingUnit: 'Per candidate processed',
    credits: 50,
    priceInr: 500,
    category: 'recruitment',
  },
  domain_check: {
    id: 'domain_check',
    name: 'Domain Check',
    chargingUnit: 'Per check',
    credits: 20,
    priceInr: 200,
    category: 'verification',
  },
  bg_verification: {
    id: 'bg_verification',
    name: 'BG Verification',
    chargingUnit: 'Per verification',
    credits: 30,
    priceInr: 300,
    category: 'verification',
  },

  // D. Promotions and Explore Opportunities
  promo_landing_page: {
    id: 'promo_landing_page',
    name: 'List on Landing Pages',
    chargingUnit: 'Per campaign',
    credits: 50,
    priceInr: 500,
    category: 'promotion',
  },
  promo_featured_jobs: {
    id: 'promo_featured_jobs',
    name: 'Featured Jobs',
    chargingUnit: 'Per placement',
    credits: 30,
    priceInr: 300,
    category: 'promotion',
  },
  promo_recently_posted: {
    id: 'promo_recently_posted',
    name: 'Recently Posted',
    chargingUnit: 'Per promoted listing',
    credits: 10,
    priceInr: 100,
    category: 'promotion',
  },
  promo_first_page_7d: {
    id: 'promo_first_page_7d',
    name: 'Stay on the First Page',
    chargingUnit: '7-day placement',
    credits: 50,
    priceInr: 500,
    category: 'promotion',
  },
  promo_front_row_7d: {
    id: 'promo_front_row_7d',
    name: 'Stay in the Front/Top Row',
    chargingUnit: '7-day placement',
    credits: 75,
    priceInr: 750,
    category: 'promotion',
  },
  promo_social_media: {
    id: 'promo_social_media',
    name: 'Promote on Social Media',
    chargingUnit: 'Per campaign',
    credits: 30,
    priceInr: 300,
    category: 'promotion',
  },
  promo_job_fair: {
    id: 'promo_job_fair',
    name: 'Promote on Job Fair',
    chargingUnit: 'Per campaign',
    credits: 100,
    priceInr: 1000,
    category: 'promotion',
  },
  promo_advertisement: {
    id: 'promo_advertisement',
    name: 'Advertisement',
    chargingUnit: 'By placement and duration',
    credits: 0,
    priceInr: 0,
    category: 'promotion',
    description: 'Custom placement and duration (Case-by-case / To be agreed)',
  },

  // E. Career guidance and learning
  psychometric_test: {
    id: 'psychometric_test',
    name: 'Psychometric Test',
    chargingUnit: 'Per test',
    credits: 10,
    priceInr: 100,
    category: 'learning',
  },
  genius_test: {
    id: 'genius_test',
    name: 'Genius Test',
    chargingUnit: 'Per test',
    credits: 10,
    priceInr: 100,
    category: 'learning',
  },
  linguistic_test: {
    id: 'linguistic_test',
    name: 'Linguistic Test',
    chargingUnit: 'Per test',
    credits: 10,
    priceInr: 100,
    category: 'learning',
  },
  skills_enhancement: {
    id: 'skills_enhancement',
    name: 'Skills Enhancement',
    chargingUnit: 'Per course/programme',
    credits: 30,
    priceInr: 300,
    category: 'learning',
  },
  career_counselling_ai: {
    id: 'career_counselling_ai',
    name: 'Career Counselling — AI',
    chargingUnit: 'Per session',
    credits: 3,
    priceInr: 30,
    category: 'learning',
  },
  career_counselling_manual: {
    id: 'career_counselling_manual',
    name: 'Career Counselling — Manual',
    chargingUnit: 'Per session',
    credits: 30,
    priceInr: 300,
    category: 'learning',
  },
  language_training: {
    id: 'language_training',
    name: 'Language Training',
    chargingUnit: 'Per course/module',
    credits: 20,
    priceInr: 200,
    category: 'learning',
  },
  certificate_courses: {
    id: 'certificate_courses',
    name: 'Certificate Courses',
    chargingUnit: 'Per course',
    credits: 50,
    priceInr: 500,
    category: 'learning',
  },
  on_job_training: {
    id: 'on_job_training',
    name: 'On-job Training',
    chargingUnit: 'Per programme',
    credits: 100,
    priceInr: 1000,
    category: 'learning',
  },
  skills_certifications_courses: {
    id: 'skills_certifications_courses',
    name: 'Skills Certifications Courses',
    chargingUnit: 'Per course/certification',
    credits: 30,
    priceInr: 300,
    category: 'learning',
  },

  // F. Institution features
  inst_placement_mass_application: {
    id: 'inst_placement_mass_application',
    name: 'Placement — Mass Application',
    chargingUnit: 'Per student application',
    credits: 2,
    priceInr: 20,
    category: 'institution',
  },
  inst_campus_drive: {
    id: 'inst_campus_drive',
    name: 'Campus — Drive',
    chargingUnit: 'Per event',
    credits: 100,
    priceInr: 1000,
    category: 'institution',
  },
  inst_job_fair_campus: {
    id: 'inst_job_fair_campus',
    name: 'Job Fair at Campus',
    chargingUnit: 'Per event',
    credits: 300,
    priceInr: 3000,
    category: 'institution',
  },
  inst_job_fair_online: {
    id: 'inst_job_fair_online',
    name: 'Job Fair — Online',
    chargingUnit: 'Per event',
    credits: 150,
    priceInr: 1500,
    category: 'institution',
  },
  inst_career_enhancement: {
    id: 'inst_career_enhancement',
    name: 'Career Enhancement at Campus',
    chargingUnit: 'Per session',
    credits: 50,
    priceInr: 500,
    category: 'institution',
  },
  inst_skills_enhancement_batch: {
    id: 'inst_skills_enhancement_batch',
    name: 'Skills Enhancement',
    chargingUnit: 'Per batch',
    credits: 100,
    priceInr: 1000,
    category: 'institution',
  },
  inst_genius_test_campus: {
    id: 'inst_genius_test_campus',
    name: 'Genius Test at Campus',
    chargingUnit: 'Per student test',
    credits: 5,
    priceInr: 50,
    category: 'institution',
  },

  // G. Startup features
  startup_business_plus: {
    id: 'startup_business_plus',
    name: 'Business Plus',
    chargingUnit: 'Per listing/package',
    credits: 50,
    priceInr: 500,
    category: 'startup',
  },
  startup_documentations: {
    id: 'startup_documentations',
    name: 'Documentations',
    chargingUnit: 'Per service/request',
    credits: 50,
    priceInr: 500,
    category: 'startup',
  },
  startup_funding_support: {
    id: 'startup_funding_support',
    name: 'Funding Support',
    chargingUnit: 'Per support service',
    credits: 50,
    priceInr: 500,
    category: 'startup',
  },
  startup_networking: {
    id: 'startup_networking',
    name: 'Networking',
    chargingUnit: 'Per event/access',
    credits: 20,
    priceInr: 200,
    category: 'startup',
  },
  startup_incubations: {
    id: 'startup_incubations',
    name: 'Incubations',
    chargingUnit: 'Per listing/application support',
    credits: 50,
    priceInr: 500,
    category: 'startup',
  },
  startup_accelerators: {
    id: 'startup_accelerators',
    name: 'Accelerators',
    chargingUnit: 'Per listing/application support',
    credits: 50,
    priceInr: 500,
    category: 'startup',
  },
};

export type SubscriptionDurationKey = 'monthly' | 'six_months' | 'yearly';

export interface SubscriptionTierPlan {
  id: string;
  name: string;
  targetRole: string;
  durations: Record<
    SubscriptionDurationKey,
    {
      credits: number;
      priceInr: number;
      days: number;
    }
  >;
  features: string[];
}

export const SUBSCRIPTION_PLANS: SubscriptionTierPlan[] = [
  {
    id: 'job_posting',
    name: 'Job Posting',
    targetRole: 'recruiter',
    durations: {
      monthly: { credits: 50, priceInr: 500, days: 30 },
      six_months: { credits: 250, priceInr: 2500, days: 180 },
      yearly: { credits: 500, priceInr: 5000, days: 365 },
    },
    features: ['Active Job Postings included', 'Direct Applicant Pipeline', 'Standard Candidate Messaging'],
  },
  {
    id: 'hrms',
    name: 'HRMS',
    targetRole: 'recruiter',
    durations: {
      monthly: { credits: 150, priceInr: 1500, days: 30 },
      six_months: { credits: 750, priceInr: 7500, days: 180 },
      yearly: { credits: 1500, priceInr: 15000, days: 365 },
    },
    features: ['Employee Management System', 'Payroll & Compliance Tools', 'Leave & Attendance Management'],
  },
  {
    id: 'recruitment_suite',
    name: 'Recruitment Suite',
    targetRole: 'recruiter',
    durations: {
      monthly: { credits: 250, priceInr: 2500, days: 30 },
      six_months: { credits: 1250, priceInr: 12500, days: 180 },
      yearly: { credits: 2500, priceInr: 25000, days: 365 },
    },
    features: ['AI Resume Shortlisting & Scoring', 'Multi-round Automated Testing Suite', 'AI Interview Suite & Video Proctoring'],
  },
  {
    id: 'institution',
    name: 'Institution',
    targetRole: 'institution',
    durations: {
      monthly: { credits: 100, priceInr: 1000, days: 30 },
      six_months: { credits: 500, priceInr: 5000, days: 180 },
      yearly: { credits: 1000, priceInr: 10000, days: 365 },
    },
    features: ['Mass Student Applications', 'Campus Drive Scheduling', 'Recruiter Network Direct Links'],
  },
  {
    id: 'startup',
    name: 'Startup',
    targetRole: 'startup',
    durations: {
      monthly: { credits: 50, priceInr: 500, days: 30 },
      six_months: { credits: 250, priceInr: 2500, days: 180 },
      yearly: { credits: 500, priceInr: 5000, days: 365 },
    },
    features: ['Business Plus Listing', 'Documentations & Govt Schemes Support', 'Investor Connect & Fundraising Pipeline'],
  },
];

export interface CreditTopupPack {
  id: string;
  name: string;
  credits: number;
  priceInr: number;
  best?: boolean;
}

export const CREDIT_TOPUP_PACKS: CreditTopupPack[] = [
  { id: 'pack_20', name: 'Starter Boost', credits: 20, priceInr: 200 },
  { id: 'pack_50', name: 'Basic Pack', credits: 50, priceInr: 500 },
  { id: 'pack_100', name: 'Growth Pack', credits: 100, priceInr: 1000, best: true },
  { id: 'pack_250', name: 'Pro Pack', credits: 250, priceInr: 2500 },
  { id: 'pack_500', name: 'Enterprise Pack', credits: 500, priceInr: 5000 },
];

export interface CandidatePlanItem {
  id: string;
  name: string;
  chargingUnit: string;
  credits: number;
  priceInr: number;
  category: 'resume_services' | 'ai_apply' | 'mockups_assessments' | 'career_learning';
  description?: string;
  durationDays?: number;
  jobLimit?: number;
  actionUrl?: string;
}

export interface CandidateCategoryGroup {
  id: 'resume_services' | 'ai_apply' | 'mockups_assessments' | 'career_learning';
  title: string;
  description: string;
  items: CandidatePlanItem[];
}

export const CANDIDATE_PLAN_CATEGORIES: CandidateCategoryGroup[] = [
  {
    id: 'resume_services',
    title: 'Resume Services',
    description: 'AI ATS resume optimization and professional credential verification',
    items: [
      {
        id: 'ats_resume',
        name: 'ATS Resume',
        chargingUnit: 'Per resume processed',
        credits: 30,
        priceInr: 300,
        category: 'resume_services',
        description: 'Tailor and optimize your resume for automated ATS screening scanners',
        actionUrl: '/resume',
      },
      {
        id: 'verified_resume',
        name: 'Verified Resume',
        chargingUnit: 'Per verification',
        credits: 30,
        priceInr: 300,
        category: 'resume_services',
        description: 'Verify background, employment, and education credentials with official badge',
        actionUrl: '/verified-resume',
      },
    ],
  },
  {
    id: 'ai_apply',
    title: 'AI Apply Packages',
    description: 'Automated 10x batch application engine targeting matched verified vacancies',
    items: [
      {
        id: 'ai_apply_10jobs_1day',
        name: 'AI Apply — 10 jobs/day',
        chargingUnit: '1-day package',
        credits: 20,
        priceInr: 200,
        category: 'ai_apply',
        description: 'Apply to up to 10 matching jobs within 24 hours with AI tailored cover letters',
        durationDays: 1,
        jobLimit: 10,
        actionUrl: '/ai-apply',
      },
      {
        id: 'ai_apply_20jobs_7days',
        name: 'AI Apply — 20 jobs/1 week',
        chargingUnit: '7-day package',
        credits: 40,
        priceInr: 400,
        category: 'ai_apply',
        description: 'Apply to up to 20 matching jobs across 7 days with priority processing',
        durationDays: 7,
        jobLimit: 20,
        actionUrl: '/ai-apply',
      },
      {
        id: 'ai_apply_50jobs_10days',
        name: 'AI Apply — 50 jobs/10 days',
        chargingUnit: '10-day package',
        credits: 50,
        priceInr: 500,
        category: 'ai_apply',
        description: 'High-volume campaign applying to up to 50 jobs across 10 days',
        durationDays: 10,
        jobLimit: 50,
        actionUrl: '/ai-apply',
      },
    ],
  },
  {
    id: 'mockups_assessments',
    title: 'Mockups & Assessments',
    description: 'AI technical tests, interview practice, and cognitive benchmark evaluations',
    items: [
      {
        id: 'mockup_assessment',
        name: 'Mockup Assessment',
        chargingUnit: 'Per candidate assessment',
        credits: 20,
        priceInr: 200,
        category: 'mockups_assessments',
        description: 'Comprehensive adaptive skill and coding assessment with score report',
        actionUrl: '/interviews/assessment',
      },
      {
        id: 'mockup_interview',
        name: 'Mockup Interview',
        chargingUnit: 'Per candidate interview',
        credits: 20,
        priceInr: 200,
        category: 'mockups_assessments',
        description: 'Real-time AI voice and video practice interview with instant feedback',
        actionUrl: '/interviews/mock',
      },
      {
        id: 'psychometric_test',
        name: 'Psychometric Test',
        chargingUnit: 'Per test',
        credits: 10,
        priceInr: 100,
        category: 'mockups_assessments',
        description: 'Personality, cultural alignment, and situational judgment evaluation',
        actionUrl: '/psychometric-test',
      },
      {
        id: 'genius_test',
        name: 'Genius Test',
        chargingUnit: 'Per test',
        credits: 10,
        priceInr: 100,
        category: 'mockups_assessments',
        description: 'Adaptive cognitive and domain intelligence diagnostic test',
        actionUrl: '/geniustest',
      },
      {
        id: 'linguistic_test',
        name: 'Linguistic Test',
        chargingUnit: 'Per test',
        credits: 10,
        priceInr: 100,
        category: 'mockups_assessments',
        description: 'Speech clarity, fluency, and business communication assessment',
        actionUrl: '/linguistic-test',
      },
    ],
  },
  {
    id: 'career_learning',
    title: 'Career Guidance & Learning',
    description: 'Expert 1-on-1 counseling, specialized certifications, and on-job training',
    items: [
      {
        id: 'career_counselling_ai',
        name: 'Career Counselling — AI',
        chargingUnit: 'Per session',
        credits: 3,
        priceInr: 30,
        category: 'career_learning',
        description: 'AI-guided career roadmap, resume gap analysis, and role transition insights',
        actionUrl: '/career-guidance',
      },
      {
        id: 'career_counselling_manual',
        name: 'Career Counselling — Manual',
        chargingUnit: 'Per session',
        credits: 30,
        priceInr: 300,
        category: 'career_learning',
        description: 'Dedicated 1-on-1 counseling session with an experienced industry mentor',
        actionUrl: '/career-guidance',
      },
      {
        id: 'skills_enhancement',
        name: 'Skills Enhancement',
        chargingUnit: 'Per course/programme',
        credits: 30,
        priceInr: 300,
        category: 'career_learning',
        description: 'Hands-on project-based upskilling module tailored to top in-demand stacks',
        actionUrl: '/skills',
      },
      {
        id: 'language_training',
        name: 'Language Training',
        chargingUnit: 'Per course/module',
        credits: 20,
        priceInr: 200,
        category: 'career_learning',
        description: 'Professional language and workplace communication training module',
        actionUrl: '/skills/language',
      },
      {
        id: 'certificate_courses',
        name: 'Certificate Courses',
        chargingUnit: 'Per course',
        credits: 50,
        priceInr: 500,
        category: 'career_learning',
        description: 'Accredited certificate coursework recognized by hiring partner companies',
        actionUrl: '/skills/short-term',
      },
      {
        id: 'on_job_training',
        name: 'On-job Training',
        chargingUnit: 'Per programme',
        credits: 100,
        priceInr: 1000,
        category: 'career_learning',
        description: 'Immersive apprenticeship and real-world project work simulation programme',
        actionUrl: '/skills',
      },
      {
        id: 'skills_certifications_courses',
        name: 'Skills Certifications Courses',
        chargingUnit: 'Per course/certification',
        credits: 30,
        priceInr: 300,
        category: 'career_learning',
        description: 'Official skill competence assessment and verified credentials certificate',
        actionUrl: '/skills',
      },
    ],
  },
];

export interface CompanyPlanItem {
  id: string;
  name: string;
  chargingUnit: string;
  credits: number;
  priceInr: number;
  category: string;
  description?: string;
  durationDays?: number;
  actionUrl?: string;
  providerFeeNote?: string;
  caseByCase?: boolean;
}

export interface CompanyCategoryGroup {
  id: string;
  title: string;
  description: string;
  items: CompanyPlanItem[];
}

export const COMPANY_SUBSCRIPTION_IDS = ['job_posting', 'hrms', 'recruitment_suite'];

export const COMPANY_PLAN_CATEGORIES: CompanyCategoryGroup[] = [
  {
    id: 'job_posting_recruitment',
    title: 'Job Posting & Recruitment Activities',
    description: 'Job postings, resume verifications, AI hiring, and candidate background checks',
    items: [
      {
        id: 'standard_job_posting',
        name: 'Create Job Posting — Standard',
        chargingUnit: 'Per job posting',
        credits: 10,
        priceInr: 100,
        category: 'job_posting_recruitment',
        description: 'Standard single job listing with applicant inbox and matching',
        actionUrl: '/recruiter/jobs/create',
      },
      {
        id: 'premium_job_posting',
        name: 'Create Job Posting — PremiumS',
        chargingUnit: 'Per job posting',
        credits: 20,
        priceInr: 200,
        category: 'job_posting_recruitment',
        description: 'Premium job listing with highlighted placement and boosted candidate reach',
        actionUrl: '/recruiter/jobs/create',
      },
      {
        id: 'verified_resume',
        name: 'Verified Resume',
        chargingUnit: 'Per resume verification',
        credits: 30,
        priceInr: 300,
        category: 'job_posting_recruitment',
        description: 'Comprehensive verification of candidate credentials, past employment, and academic badges',
        actionUrl: '/recruiter/verified-resumes',
      },
      {
        id: 'ai_hire',
        name: 'AI Hire',
        chargingUnit: 'Per candidate processed',
        credits: 50,
        priceInr: 500,
        category: 'job_posting_recruitment',
        description: 'Autonomous AI candidate evaluation, technical scoring, and hiring recommendation',
        actionUrl: '/recruiter/ai-hire',
      },
      {
        id: 'domain_check',
        name: 'Domain Check',
        chargingUnit: 'Per check',
        credits: 20,
        priceInr: 200,
        category: 'job_posting_recruitment',
        description: 'Specialized domain technical assessment tailored to job requirements',
        actionUrl: '/recruiter/domain-assessments',
      },
      {
        id: 'bg_verification',
        name: 'BG Verification',
        chargingUnit: 'Per verification',
        credits: 30,
        priceInr: 300,
        category: 'job_posting_recruitment',
        description: '30 platform credits + provider fee, if applicable (UIDAI, EPFO, NAD, e-Courts checks)',
        actionUrl: '/recruiter/background-verification',
        providerFeeNote: 'External registry provider fee applicable where required',
      },
    ],
  },
  {
    id: 'promotions_explore',
    title: 'Promotions and Explore Opportunities',
    description: 'Placement promotions, landing page spotlights, social media pushes, and job fairs',
    items: [
      {
        id: 'promo_landing_page',
        name: 'List on the landing pages',
        chargingUnit: 'Per campaign',
        credits: 50,
        priceInr: 500,
        category: 'promotions_explore',
        description: 'Feature your vacancy prominently on LetGetIn landing pages',
        actionUrl: '/recruiter/jobs/create',
      },
      {
        id: 'promo_featured_jobs',
        name: 'Featured Jobs',
        chargingUnit: 'Per featured placement',
        credits: 30,
        priceInr: 300,
        category: 'promotions_explore',
        description: 'Featured badge and top placement in candidate search feeds',
        actionUrl: '/recruiter/jobs/create',
      },
      {
        id: 'promo_recently_posted',
        name: 'Recently Posted',
        chargingUnit: 'Per promoted listing',
        credits: 10,
        priceInr: 100,
        category: 'promotions_explore',
        description: 'Boosted listing inside the high-visibility Recently Posted feed',
        actionUrl: '/recruiter/jobs/create',
      },
      {
        id: 'promo_first_page_7d',
        name: 'Stay on the first page',
        chargingUnit: '7-day placement',
        credits: 50,
        priceInr: 500,
        category: 'promotions_explore',
        description: 'Guaranteed first-page placement in job search results for 7 full days',
        durationDays: 7,
        actionUrl: '/recruiter/promote-job',
      },
      {
        id: 'promo_front_row_7d',
        name: 'Stay in the front row / top row',
        chargingUnit: '7-day placement',
        credits: 75,
        priceInr: 750,
        category: 'promotions_explore',
        description: 'Premier front-row banner and top-row pinned placement for 7 full days',
        durationDays: 7,
        actionUrl: '/recruiter/promote-job',
      },
      {
        id: 'promo_social_media',
        name: 'Promote on Social Media',
        chargingUnit: 'Per campaign',
        credits: 30,
        priceInr: 300,
        category: 'promotions_explore',
        description: 'Targeted campaign across LetGetIn LinkedIn, Twitter, and professional channels',
        actionUrl: '/recruiter/promote-job',
      },
      {
        id: 'promo_job_fair',
        name: 'Promote on Job Fair',
        chargingUnit: 'Per campaign',
        credits: 100,
        priceInr: 1000,
        category: 'promotions_explore',
        description: 'Promote vacancies in virtual and on-campus LetGetIn mega job fairs',
        actionUrl: '/recruiter/promote-job',
      },
      {
        id: 'promo_advertisement',
        name: 'Advertisement',
        chargingUnit: 'By placement and duration',
        credits: 0,
        priceInr: 0,
        category: 'promotions_explore',
        description: 'Custom placement, branded banners, and tailored campaign duration (Case-by-case / To be agreed)',
        caseByCase: true,
        actionUrl: '/recruiter/ad-management',
      },
    ],
  },
  {
    id: 'career_guidance_workforce',
    title: 'Career Guidance and Learning',
    description: 'Workforce assessments, psychometric profiling, employee mentoring, and skill certifications',
    items: [
      {
        id: 'psychometric_test',
        name: 'Psychometric Test',
        chargingUnit: 'Per test',
        credits: 10,
        priceInr: 100,
        category: 'career_guidance_workforce',
        description: 'Workplace personality, cultural alignment, and situational judgment evaluation',
        actionUrl: '/recruiter/psychometric-test',
      },
      {
        id: 'genius_test',
        name: 'Genius Test',
        chargingUnit: 'Per test',
        credits: 10,
        priceInr: 100,
        category: 'career_guidance_workforce',
        description: 'Cognitive aptitude, logic, and problem-solving assessment',
        actionUrl: '/recruiter/genius-test',
      },
      {
        id: 'linguistic_test',
        name: 'Linguistic Test',
        chargingUnit: 'Per test',
        credits: 10,
        priceInr: 100,
        category: 'career_guidance_workforce',
        description: 'Language proficiency, business fluency, and communication analysis',
        actionUrl: '/recruiter/linguistic-test',
      },
      {
        id: 'skills_enhancement',
        name: 'Skills Enhancement',
        chargingUnit: 'Per course/programme',
        credits: 30,
        priceInr: 300,
        category: 'career_guidance_workforce',
        description: 'Targeted workforce skill enhancement courses for high-impact roles',
        actionUrl: '/recruiter/training',
      },
      {
        id: 'career_counselling_ai',
        name: 'Career Counselling — AI',
        chargingUnit: 'Per session',
        credits: 3,
        priceInr: 30,
        category: 'career_guidance_workforce',
        description: 'AI-guided career trajectory and role transition advisory',
        actionUrl: '/recruiter/career-counselling',
      },
      {
        id: 'career_counselling_manual',
        name: 'Career Counselling — Manual',
        chargingUnit: 'Per session',
        credits: 30,
        priceInr: 300,
        category: 'career_guidance_workforce',
        description: '1-on-1 human expert career advisory and mentoring session',
        actionUrl: '/recruiter/career-counselling',
      },
      {
        id: 'language_training',
        name: 'Language Training',
        chargingUnit: 'Per course/module',
        credits: 20,
        priceInr: 200,
        category: 'career_guidance_workforce',
        description: 'Professional language and workplace communication training module',
        actionUrl: '/recruiter/training',
      },
      {
        id: 'certificate_courses',
        name: 'Certificate Courses',
        chargingUnit: 'Per course',
        credits: 50,
        priceInr: 500,
        category: 'career_guidance_workforce',
        description: 'Accredited certificate coursework with verified employee credentials',
        actionUrl: '/recruiter/training',
      },
      {
        id: 'on_job_training',
        name: 'On-job Training',
        chargingUnit: 'Per programme',
        credits: 100,
        priceInr: 1000,
        category: 'career_guidance_workforce',
        description: 'Hands-on apprenticeship and real-world project work simulation programme',
        actionUrl: '/recruiter/training',
      },
      {
        id: 'skills_certifications_courses',
        name: 'Skills Certifications Courses',
        chargingUnit: 'Per course/certification',
        credits: 30,
        priceInr: 300,
        category: 'career_guidance_workforce',
        description: 'Standardized technical certification exams and badges',
        actionUrl: '/recruiter/training',
      },
    ],
  },
];

export interface StartupPlanItem {
  id: string;
  name: string;
  chargingUnit: string;
  credits: number;
  priceInr: number;
  category: string;
  description?: string;
  durationDays?: number;
  actionUrl?: string;
  providerFeeNote?: string;
  caseByCase?: boolean;
}

export interface StartupCategoryGroup {
  id: string;
  title: string;
  description: string;
  items: StartupPlanItem[];
}

export const STARTUP_SUBSCRIPTION_IDS = ['job_posting', 'hrms', 'startup'];

export const STARTUP_PLAN_CATEGORIES: StartupCategoryGroup[] = [
  {
    id: 'job_posting_recruitment',
    title: 'Job Posting and Recruitment Activities',
    description: 'Job postings, resume verifications, AI hiring, and candidate background checks',
    items: [
      {
        id: 'standard_job_posting',
        name: 'Create Job Posting – Standard',
        chargingUnit: 'Per job posting',
        credits: 10,
        priceInr: 100,
        category: 'job_posting_recruitment',
        description: 'Standard single job listing with applicant inbox and matching',
        actionUrl: '/recruiter/jobs/create',
      },
      {
        id: 'premium_job_posting',
        name: 'Create Job Posting – PremiumS',
        chargingUnit: 'Per job posting',
        credits: 20,
        priceInr: 200,
        category: 'job_posting_recruitment',
        description: 'Premium job listing with highlighted placement and boosted candidate reach',
        actionUrl: '/recruiter/jobs/create',
      },
      {
        id: 'verified_resume',
        name: 'Verified Resume',
        chargingUnit: 'Per resume verification',
        credits: 30,
        priceInr: 300,
        category: 'job_posting_recruitment',
        description: 'Comprehensive verification of candidate credentials, past employment, and academic badges',
        actionUrl: '/recruiter/verified-resumes',
      },
      {
        id: 'ai_hire',
        name: 'AI Hire',
        chargingUnit: 'Per candidate processed',
        credits: 50,
        priceInr: 500,
        category: 'job_posting_recruitment',
        description: 'Autonomous AI candidate evaluation, technical scoring, and hiring recommendation',
        actionUrl: '/recruiter/ai-hire',
      },
      {
        id: 'domain_check',
        name: 'Domain Check',
        chargingUnit: 'Per check',
        credits: 20,
        priceInr: 200,
        category: 'job_posting_recruitment',
        description: 'Specialized domain technical assessment tailored to job requirements',
        actionUrl: '/recruiter/domain-assessments',
      },
      {
        id: 'bg_verification',
        name: 'BG Verification',
        chargingUnit: 'Per verification',
        credits: 30,
        priceInr: 300,
        category: 'job_posting_recruitment',
        description: '30 platform credits + provider fee, if applicable (UIDAI, EPFO, NAD, e-Courts checks)',
        actionUrl: '/recruiter/background-verification',
        providerFeeNote: 'External registry provider fee applicable where required',
      },
    ],
  },
  {
    id: 'promotions_explore',
    title: 'Promotions and Explore Opportunities',
    description: 'Placement promotions, landing page spotlights, social media pushes, and job fairs',
    items: [
      {
        id: 'promo_landing_page',
        name: 'List on the landing pages',
        chargingUnit: 'Per campaign',
        credits: 50,
        priceInr: 500,
        category: 'promotions_explore',
        description: 'Feature your vacancy prominently on LetGetIn landing pages',
        actionUrl: '/recruiter/jobs/create',
      },
      {
        id: 'promo_featured_jobs',
        name: 'Featured Jobs',
        chargingUnit: 'Per featured placement',
        credits: 30,
        priceInr: 300,
        category: 'promotions_explore',
        description: 'Featured badge and top placement in candidate search feeds',
        actionUrl: '/recruiter/jobs/create',
      },
      {
        id: 'promo_recently_posted',
        name: 'Recently Posted',
        chargingUnit: 'Per promoted listing',
        credits: 10,
        priceInr: 100,
        category: 'promotions_explore',
        description: 'Boosted listing inside the high-visibility Recently Posted feed',
        actionUrl: '/recruiter/jobs/create',
      },
      {
        id: 'promo_first_page_7d',
        name: 'Stay on the first page',
        chargingUnit: '7-day placement',
        credits: 50,
        priceInr: 500,
        category: 'promotions_explore',
        description: 'Guaranteed first-page placement in job search results for 7 full days',
        durationDays: 7,
        actionUrl: '/recruiter/promote-job',
      },
      {
        id: 'promo_front_row_7d',
        name: 'Stay in the front row / top row',
        chargingUnit: '7-day placement',
        credits: 75,
        priceInr: 750,
        category: 'promotions_explore',
        description: 'Premier front-row banner and top-row pinned placement for 7 full days',
        durationDays: 7,
        actionUrl: '/recruiter/promote-job',
      },
      {
        id: 'promo_social_media',
        name: 'Promote on Social Media',
        chargingUnit: 'Per campaign',
        credits: 30,
        priceInr: 300,
        category: 'promotions_explore',
        description: 'Targeted campaign across LetGetIn LinkedIn, Twitter, and professional channels',
        actionUrl: '/recruiter/promote-job',
      },
      {
        id: 'promo_job_fair',
        name: 'Promote on Job Fair',
        chargingUnit: 'Per campaign',
        credits: 100,
        priceInr: 1000,
        category: 'promotions_explore',
        description: 'Promote vacancies in virtual and on-campus LetGetIn mega job fairs',
        actionUrl: '/recruiter/promote-job',
      },
      {
        id: 'promo_advertisement',
        name: 'Advertisement',
        chargingUnit: 'By placement and duration',
        credits: 0,
        priceInr: 0,
        category: 'promotions_explore',
        description: 'Custom placement, branded banners, and tailored campaign duration (Case-by-case / To be agreed)',
        caseByCase: true,
        actionUrl: '/recruiter/ad-management',
      },
    ],
  },
  {
    id: 'career_guidance_learning',
    title: 'Career Guidance and Learning',
    description: 'Workforce assessments, psychometric profiling, employee mentoring, and skill certifications',
    items: [
      {
        id: 'psychometric_test',
        name: 'Psychometric Test',
        chargingUnit: 'Per test',
        credits: 10,
        priceInr: 100,
        category: 'career_guidance_learning',
        description: 'Workplace personality, cultural alignment, and situational judgment evaluation',
        actionUrl: '/recruiter/psychometric-test',
      },
      {
        id: 'genius_test',
        name: 'Genius Test',
        chargingUnit: 'Per test',
        credits: 10,
        priceInr: 100,
        category: 'career_guidance_learning',
        description: 'Cognitive aptitude, logic, and problem-solving assessment',
        actionUrl: '/recruiter/genius-test',
      },
      {
        id: 'linguistic_test',
        name: 'Linguistic Test',
        chargingUnit: 'Per test',
        credits: 10,
        priceInr: 100,
        category: 'career_guidance_learning',
        description: 'Language proficiency, business fluency, and communication analysis',
        actionUrl: '/recruiter/linguistic-test',
      },
      {
        id: 'skills_enhancement',
        name: 'Skills Enhancement',
        chargingUnit: 'Per course/programme',
        credits: 30,
        priceInr: 300,
        category: 'career_guidance_learning',
        description: 'Targeted workforce skill enhancement courses for high-impact roles',
        actionUrl: '/recruiter/training',
      },
      {
        id: 'career_counselling_ai',
        name: 'Career Counselling – AI',
        chargingUnit: 'Per session',
        credits: 3,
        priceInr: 30,
        category: 'career_guidance_learning',
        description: 'AI-guided career trajectory and role transition advisory',
        actionUrl: '/recruiter/career-counselling',
      },
      {
        id: 'career_counselling_manual',
        name: 'Career Counselling – Manual',
        chargingUnit: 'Per session',
        credits: 30,
        priceInr: 300,
        category: 'career_guidance_learning',
        description: '1-on-1 human expert career advisory and mentoring session',
        actionUrl: '/recruiter/career-counselling',
      },
      {
        id: 'language_training',
        name: 'Language Training',
        chargingUnit: 'Per course/module',
        credits: 20,
        priceInr: 200,
        category: 'career_guidance_learning',
        description: 'Professional language and workplace communication training module',
        actionUrl: '/recruiter/training',
      },
      {
        id: 'certificate_courses',
        name: 'Certificate Courses',
        chargingUnit: 'Per course',
        credits: 50,
        priceInr: 500,
        category: 'career_guidance_learning',
        description: 'Accredited certificate coursework with verified employee credentials',
        actionUrl: '/recruiter/training',
      },
      {
        id: 'on_job_training',
        name: 'On-job Training',
        chargingUnit: 'Per programme',
        credits: 100,
        priceInr: 1000,
        category: 'career_guidance_learning',
        description: 'Hands-on apprenticeship and real-world project work simulation programme',
        actionUrl: '/recruiter/training',
      },
      {
        id: 'skills_certifications_courses',
        name: 'Skills Certifications Courses',
        chargingUnit: 'Per course/certification',
        credits: 30,
        priceInr: 300,
        category: 'career_guidance_learning',
        description: 'Standardized technical certification exams and badges',
        actionUrl: '/recruiter/training',
      },
    ],
  },
  {
    id: 'growth_fundraising',
    title: 'Growth & Fundraising Services',
    description: 'Venture scaling, investor networking, and business acceleration packages',
    items: [
      {
        id: 'startup_business_plus',
        name: 'Business Plus',
        chargingUnit: 'Per listing/package',
        credits: 50,
        priceInr: 500,
        category: 'growth_fundraising',
        description: 'Premium startup business showcase, AI pitch generation, and partner visibility',
        actionUrl: '/recruiter/startup/marketing-plus',
      },
      {
        id: 'startup_networking',
        name: 'Networking',
        chargingUnit: 'Per event/access',
        credits: 20,
        priceInr: 200,
        category: 'growth_fundraising',
        description: 'Direct investor networking access and pipeline deal creation',
        actionUrl: '/recruiter/startup/investors-connect',
      },
      {
        id: 'startup_funding_support',
        name: 'Funding Support',
        chargingUnit: 'Per support service',
        credits: 50,
        priceInr: 500,
        category: 'growth_fundraising',
        description: 'Dedicated fundraising advisory, outreach review, and capital strategy',
        actionUrl: '/recruiter/startup/fundraising-pipeline',
      },
    ],
  },
  {
    id: 'ecosystem_programs',
    title: 'Ecosystem & Documentation Services',
    description: 'Corporate filings, pitch decks, incubation facilities, and top-tier accelerators',
    items: [
      {
        id: 'startup_documentations',
        name: 'Documentations',
        chargingUnit: 'Per service/request',
        credits: 50,
        priceInr: 500,
        category: 'ecosystem_programs',
        description: 'Comprehensive documentation support (pitch decks, registrations, govt scheme filings)',
        actionUrl: '/recruiter/startup/pitch-decks',
      },
      {
        id: 'startup_incubations',
        name: 'Incubations',
        chargingUnit: 'Per listing/application support',
        credits: 50,
        priceInr: 500,
        category: 'ecosystem_programs',
        description: 'Incubation hub listings, lab facility access, and academic joint-program application support',
        actionUrl: '/recruiter/startup/incubator',
      },
      {
        id: 'startup_accelerators',
        name: 'Accelerators',
        chargingUnit: 'Per listing/application support',
        credits: 50,
        priceInr: 500,
        category: 'ecosystem_programs',
        description: 'Venture acceleration listings, cohort milestone tracking, and application support',
        actionUrl: '/recruiter/startup/accelerate',
      },
    ],
  },
];

export interface InstitutionPlanItem {
  id: string;
  name: string;
  chargingUnit: string;
  credits: number;
  priceInr: number;
  category: string;
  description?: string;
  actionUrl?: string;
}

export interface InstitutionCategoryGroup {
  id: string;
  title: string;
  description: string;
  items: InstitutionPlanItem[];
}

export const INSTITUTION_SUBSCRIPTION_IDS = ['institution'];

export const INSTITUTION_PLAN_CATEGORIES: InstitutionCategoryGroup[] = [
  {
    id: 'institution_services',
    title: 'Institution Services & Charges',
    description: 'Placement drives, campus job fairs, student assessments, and skill enhancement programs',
    items: [
      {
        id: 'inst_placement_mass_application',
        name: 'Placement – Mass Application',
        chargingUnit: 'Per student application',
        credits: 2,
        priceInr: 20,
        category: 'institution_services',
        description: 'Automated bulk student placement applications to matched recruiter network vacancies',
        actionUrl: '/institution/students',
      },
      {
        id: 'inst_campus_drive',
        name: 'Campus – Drive',
        chargingUnit: 'Per event',
        credits: 100,
        priceInr: 1000,
        category: 'institution_services',
        description: 'Dedicated on-campus recruitment drive coordination with participating corporate partners',
        actionUrl: '/institution/events',
      },
      {
        id: 'inst_job_fair_campus',
        name: 'Job Fair at Campus',
        chargingUnit: 'Per event',
        credits: 300,
        priceInr: 3000,
        category: 'institution_services',
        description: 'Full-scale on-campus mega job fair hosting with multi-employer interview booths',
        actionUrl: '/institution/events',
      },
      {
        id: 'inst_job_fair_online',
        name: 'Job Fair – Online',
        chargingUnit: 'Per event',
        credits: 150,
        priceInr: 1500,
        category: 'institution_services',
        description: 'Virtual hiring event and digital career fair with livestream recruiter interactions',
        actionUrl: '/institution/events',
      },
      {
        id: 'inst_career_enhancement',
        name: 'Career Enhancement at Campus',
        chargingUnit: 'Per session',
        credits: 50,
        priceInr: 500,
        category: 'institution_services',
        description: 'Interactive career development workshop, resume optimization, and interview readiness seminar',
        actionUrl: '/institution/training/programs',
      },
      {
        id: 'inst_skills_enhancement_batch',
        name: 'Skills Enhancement',
        chargingUnit: 'Per batch',
        credits: 100,
        priceInr: 1000,
        category: 'institution_services',
        description: 'Curriculum-aligned technical upskilling and certification batch training for student cohorts',
        actionUrl: '/institution/training/programs',
      },
      {
        id: 'inst_genius_test_campus',
        name: 'Genius Test at Campus',
        chargingUnit: 'Per student test',
        credits: 5,
        priceInr: 50,
        category: 'institution_services',
        description: 'Standardized cognitive intelligence, problem-solving, and aptitude benchmark evaluation for students',
        actionUrl: '/institution/students',
      },
    ],
  },
];

