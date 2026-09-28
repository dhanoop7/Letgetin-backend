import { EntityType } from './recruiterOrg.model.js';

export interface OrgFormMeta {
  entity: EntityType;
  label: string;
  regLabel: string;
  typeLabel: string;
  typeOptions: string[];
  sizeLabel: string;
  sizeOptions: string[];
  valuationLabel: string;
  leaderLabel: string;
  urlPlaceholder: string;
}

export const ORG_FORM_META: Record<EntityType, OrgFormMeta> = {
  company: {
    entity: 'company',
    label: 'Company',
    regLabel: 'Company registration / CIN',
    typeLabel: 'Type of company',
    typeOptions: ['Private Limited', 'Public Limited', 'LLP', 'Sole Proprietorship', 'MNC subsidiary'],
    sizeLabel: 'Number of employees',
    sizeOptions: ['1–10', '11–50', '51–200', '201–500', '501–1,000', '1,001–5,000', '5,001–10,000', '10,000+'],
    valuationLabel: 'Revenue / Valuation',
    leaderLabel: 'CEO / Founder',
    urlPlaceholder: 'https://your-company.com',
  },
  institution: {
    entity: 'institution',
    label: 'Institution',
    regLabel: 'Institution / UGC / AICTE ID',
    typeLabel: 'Type of institution',
    typeOptions: ['Private University', 'Deemed University', 'Government College', 'Autonomous College', 'Training Institute'],
    sizeLabel: 'Students / faculty',
    sizeOptions: ['<500', '500–2000', '2000–5000', '5000–10000', '10000+'],
    valuationLabel: 'Budget / endowment',
    leaderLabel: 'Head / Chancellor / VC',
    urlPlaceholder: 'https://your-institution.edu',
  },
  startup: {
    entity: 'startup',
    label: 'Startup',
    regLabel: 'DPIIT / Startup registration ID',
    typeLabel: 'Sector / stage',
    typeOptions: ['SaaS · Seed', 'SaaS · Series A', 'SaaS · Series B', 'Fintech · Seed', 'D2C · Series A', 'Deep tech · Pre-seed'],
    sizeLabel: 'Number of employees',
    sizeOptions: ['1–10', '11–50', '51–200', '201–500'],
    valuationLabel: 'Valuation',
    leaderLabel: 'CEO / Founder',
    urlPlaceholder: 'https://your-startup.com',
  },
};
