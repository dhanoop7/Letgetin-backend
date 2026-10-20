export const TRIAL_DURATION_DAYS = 7;
export const TRIAL_DURATION_MS = TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000;

export interface HuremasoPlanDefinition {
  id: 'starter' | 'pro';
  name: string;
  badge?: string;
  description: string;
  monthlyPrice: number;
  annualPrice: number;
  currency: string;
  features: string[];
}

export const HUREMASO_PLANS: Record<'starter' | 'pro', HuremasoPlanDefinition> = {
  starter: {
    id: 'starter',
    name: 'Starter Plan',
    description: 'Essential employee directory & document management',
    monthlyPrice: 19,
    annualPrice: 190,
    currency: 'USD',
    features: [
      'Up to 25 Employees',
      'Core Employee Directory & Profiles',
      'Basic Leave & Time-Off Tracking',
      'Document & Certificate Management',
      'Email Notifications & Announcements',
      'Standard Email Support',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro HRMS Plan',
    badge: 'POPULAR',
    description: 'Full HR management, attendance, payroll & recruitment tools',
    monthlyPrice: 49,
    annualPrice: 490,
    currency: 'USD',
    features: [
      'Unlimited Employees & Multi-Department',
      'Autonomous Payroll & Statutory Compliance',
      'Advanced Attendance, Shifts & Overtime Tracking',
      'Recruitment Pipeline & Candidate Onboarding',
      'HUREMASO AI Analytics & Predictive Insights',
      'Custom Access Roles & Performance Reviews',
      'Priority 24/7 Dedicated Support',
    ],
  },
};
