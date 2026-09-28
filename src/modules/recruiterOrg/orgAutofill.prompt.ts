import { EntityType } from './recruiterOrg.model.js';
import { ORG_FORM_META } from './orgFormMeta.constants.js';
import { ExtractedPageContent } from './urlFetcher.util.js';

export interface OrgAutofillPrompt {
  systemInstruction: string;
  prompt: string;
}

export function buildOrgAutofillPrompt(entity: EntityType, content: ExtractedPageContent): OrgAutofillPrompt {
  const meta = ORG_FORM_META[entity];

  const systemInstruction = `You extract organization details from a ${meta.label.toLowerCase()}'s website content for a company profile and registration form. Return ONLY a single JSON object with these exact keys: name, headquarters, address, orgType, employees, valuation, revenue, ceoName, ceoEmail, founded, industry, registrationId, bio, description, whyJoinUs, website. Every value must be a string or null.

Field meanings for this "${meta.label}" entity type:
- name: the official ${meta.label.toLowerCase()} name.
- headquarters: city, state/region, and country where headquarters is located (e.g. "San Francisco, CA, USA").
- address: physical address or headquarters location, if stated.
- orgType: must be one of exactly these options if a confident match exists, else null: ${meta.typeOptions.join(', ')}.
- employees: realistic company size range. If a confident match exists, must be one of: ${meta.sizeOptions.join(', ')}.
- valuation: ${meta.valuationLabel.toLowerCase()}, only if explicitly stated.
- revenue: approximate or reported annual revenue (e.g. "$10M - $50M", "$1B+"), if stated.
- ceoName: name of the ${meta.leaderLabel.toLowerCase()} (CEO / Founder / Leader), only if explicitly named.
- ceoEmail: a public contact email address, only if explicitly shown.
- founded: founding year (e.g. "2018"), only if explicitly stated.
- industry: primary industry or sector (e.g. "Software & SaaS", "Financial Technology", "E-commerce", "Healthcare", "Artificial Intelligence").
- registrationId: ${meta.regLabel.toLowerCase()}, only if explicitly shown.
- bio: a short 1-3 sentence factual description of what the organization does, based only on the provided content.
- description: a comprehensive 2-4 sentence overview of the company, products, and target audience.
- whyJoinUs: a 1-3 sentence compelling summary of company culture, career growth, mission, or employee benefits highlighting why candidates should join.
- website: official canonical website URL.

CRITICAL RULES:
- Only include information that is clearly and explicitly present in the provided content or reliably indicated by official metadata.
- Never invent names, numbers, or stats. If a field's value is not clearly present, its value MUST be null.
- Do not include any keys other than the ones listed above.
- Do not include explanations, markdown, or any text outside the JSON object.`;

  const structuredHints: string[] = [];
  if (content.title) structuredHints.push(`Page title: ${content.title}`);
  if (content.metaDescription) structuredHints.push(`Meta description: ${content.metaDescription}`);
  const ogName = content.ogTags['og:site_name'] || content.ogTags['og:title'];
  if (ogName) structuredHints.push(`OpenGraph name: ${ogName}`);
  if (content.ogTags['og:description']) structuredHints.push(`OpenGraph description: ${content.ogTags['og:description']}`);
  if (content.jsonLd.length > 0) {
    structuredHints.push(`Structured metadata (JSON-LD): ${JSON.stringify(content.jsonLd).slice(0, 800)}`);
  }

  const prompt = `${structuredHints.join('\n')}

Page text content:
${content.bodyText}

Return the JSON object now.`;

  return { systemInstruction, prompt };
}
