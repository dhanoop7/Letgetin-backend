import { Types } from 'mongoose';
import { RecruiterOrganizationModel, IFundraisingProfile } from '../recruiterOrg/recruiterOrg.model.js';
import {
  InvestorModel,
  IInvestorDocument,
  InvestorDealModel,
  IInvestorDealDocument,
  FundraisingDealStage,
  EcosystemApplicationModel,
} from './startup.model.js';
import { GoogleProvider } from '../ai/providers/google.provider.js';
import { AppError } from '../../utils/appError.js';
import crypto from 'crypto';

export interface ExplainableMatch {
  matchScore: number;
  matchReasons: string[];
  potentialMismatches: string[];
}

export class StartupService {
  /**
   * Retrieve or initialize the startup organization record for the user
   */
  public static async getOrCreateStartupOrg(userId: string) {
    let org = await RecruiterOrganizationModel.findOne({
      ownerUserId: new Types.ObjectId(userId),
    });

    if (!org) {
      org = await RecruiterOrganizationModel.create({
        ownerUserId: new Types.ObjectId(userId),
        entity: 'startup',
        name: 'My Emerging Venture',
        bio: 'Next-generation AI-powered platform',
        sector: 'Enterprise AI / B2B SaaS',
        fundraisingProfile: {
          fundingStage: 'seed',
          fundraisingStatus: 'active',
          targetAmount: 2000000,
          raisedAmount: 750000,
          committedAmount: 750000,
          minInvestment: 50000,
          maxInvestment: 1000000,
          valuationCap: 12000000,
          currency: '$',
          roundName: 'Seed Round',
          closeDate: 'Nov 30, 2026',
          instrument: 'Post-Money SAFE (with MFN)',
          businessModel: 'B2B SaaS',
          startupSlug: `startup-${userId.slice(-6)}`,
        },
      });
    } else if (org.entity !== 'startup' && !org.fundraisingProfile) {
      // If user had a generic recruiter org, enable startup fundraising profile
      org.fundraisingProfile = {
        fundingStage: 'seed',
        fundraisingStatus: 'active',
        targetAmount: 2000000,
        raisedAmount: 750000,
        committedAmount: 750000,
        minInvestment: 50000,
        maxInvestment: 1000000,
        valuationCap: 12000000,
        currency: '$',
        roundName: 'Seed Round',
        closeDate: 'Nov 30, 2026',
        instrument: 'Post-Money SAFE (with MFN)',
        businessModel: 'B2B SaaS',
        startupSlug: `startup-${userId.slice(-6)}`,
      };
      await org.save();
    }

    return org;
  }

  /**
   * Get startup profile & fundraising section
   */
  public static async getFundraisingProfile(userId: string) {
    const org = await this.getOrCreateStartupOrg(userId);
    return {
      organizationId: org._id,
      name: org.name,
      website: org.website,
      industry: org.industry || org.sector,
      sector: org.sector,
      description: org.description || org.bio,
      location: org.headquarters || org.address,
      founded: org.founded,
      employees: org.employees,
      founders: org.founders,
      fundraisingProfile: org.fundraisingProfile || {},
    };
  }

  /**
   * Update startup profile and fundraising parameters
   */
  public static async updateFundraisingProfile(
    userId: string,
    updates: {
      name?: string;
      website?: string;
      industry?: string;
      sector?: string;
      description?: string;
      location?: string;
      founded?: string;
      employees?: string;
      founders?: string;
      fundraisingProfile?: Partial<IFundraisingProfile>;
    }
  ) {
    const org = await this.getOrCreateStartupOrg(userId);

    if (updates.name !== undefined) org.name = updates.name;
    if (updates.website !== undefined) org.website = updates.website;
    if (updates.industry !== undefined) org.industry = updates.industry;
    if (updates.sector !== undefined) org.sector = updates.sector;
    if (updates.description !== undefined) org.description = updates.description;
    if (updates.location !== undefined) org.headquarters = updates.location;
    if (updates.founded !== undefined) org.founded = updates.founded;
    if (updates.employees !== undefined) org.employees = updates.employees;
    if (updates.founders !== undefined) org.founders = updates.founders;

    if (updates.fundraisingProfile) {
      org.fundraisingProfile = {
        ...(org.fundraisingProfile || {}),
        ...updates.fundraisingProfile,
      };
    }

    await org.save();
    return this.getFundraisingProfile(userId);
  }

  /**
   * Calculate live fundraising summary KPIs based on real database records
   */
  public static async getFundraisingSummary(userId: string) {
    const org = await this.getOrCreateStartupOrg(userId);
    const fp = org.fundraisingProfile || {};

    const targetAmount = fp.targetAmount || 2000000;
    const committedAmount = fp.committedAmount || 0;
    const raisedAmount = fp.raisedAmount || 0;
    const remainingAmount = Math.max(0, targetAmount - (committedAmount || raisedAmount));
    const progressPercentage = targetAmount > 0 ? Math.min(100, Math.round(((committedAmount || raisedAmount) / targetAmount) * 100)) : 0;

    const deals = await InvestorDealModel.find({
      ownerUserId: new Types.ObjectId(userId),
    }).sort({ updatedAt: -1 });

    const stageCounts: Record<FundraisingDealStage, number> = {
      prospect: 0,
      contacted: 0,
      engaged: 0,
      meeting: 0,
      diligence: 0,
      termsheet: 0,
      passed: 0,
    };

    deals.forEach((d) => {
      if (stageCounts[d.stage] !== undefined) {
        stageCounts[d.stage]++;
      }
    });

    const upcomingFollowUps = deals
      .filter((d) => d.followUpDate && d.stage !== 'passed')
      .slice(0, 5)
      .map((d) => ({
        dealId: d._id,
        fundName: d.fundName,
        leadPartner: d.leadPartner,
        stage: d.stage,
        followUpDate: d.followUpDate,
      }));

    return {
      roundName: fp.roundName || 'Seed Round',
      currency: fp.currency || '$',
      targetAmount,
      raisedAmount,
      committedAmount,
      remainingAmount,
      progressPercentage,
      valuationCap: fp.valuationCap || 12000000,
      totalDeals: deals.length,
      stageCounts,
      upcomingFollowUps,
      recentDeals: deals.slice(0, 5),
    };
  }

  /**
   * Deterministic, explainable matching between a startup profile and an investor
   */
  public static calculateMatch(
    startupProfile: IFundraisingProfile | undefined,
    investor: IInvestorDocument
  ): ExplainableMatch {
    const reasons: string[] = [];
    const mismatches: string[] = [];
    let score = 0;

    const startupStage = (startupProfile?.fundingStage || 'seed').toLowerCase();
    const targetAmount = startupProfile?.targetAmount || 2000000;
    const businessModel = (startupProfile?.businessModel || 'B2B SaaS').toLowerCase();

    // 1. Stage Compatibility (Max 30 points)
    const investorStages = (investor.stages || []).map((s) => s.toLowerCase());
    const matchesStage = investorStages.some(
      (s) =>
        s.includes(startupStage) ||
        (startupStage === 'seed' && (s.includes('seed') || s.includes('pre-seed'))) ||
        (startupStage === 'series-a' && s.includes('series a'))
    );

    if (matchesStage) {
      score += 30;
      reasons.push(`Invests in ${startupStage.toUpperCase()}-stage ventures`);
    } else if (investorStages.length > 0) {
      score += 10;
      mismatches.push(`Focuses primarily on ${investor.stages.join(', ')} stages`);
    } else {
      score += 20;
    }

    // 2. Sector / Industry Compatibility (Max 35 points)
    const investorSectors = (investor.sectors || []).map((s) => s.toLowerCase());
    const matchedSectors = investorSectors.filter(
      (sec) =>
        sec.includes('ai') ||
        sec.includes('saas') ||
        sec.includes('enterprise') ||
        sec.includes('tech') ||
        businessModel.includes(sec)
    );

    if (matchedSectors.length > 0) {
      score += 35;
      reasons.push(`Aligned focus on ${matchedSectors.slice(0, 2).join(' & ')}`);
    } else if (investorSectors.length > 0) {
      score += 15;
      mismatches.push(`Specialized focus in ${investorSectors.slice(0, 2).join(', ')}`);
    } else {
      score += 25;
    }

    // 3. Ticket Size Alignment (Max 20 points)
    const minT = investor.minTicket || 50000;
    const maxT = investor.maxTicket || 3000000;
    if (targetAmount >= minT && targetAmount <= maxT * 1.5) {
      score += 20;
      reasons.push(`Typical check (${investor.typicalTicket}) fits target raise`);
    } else if (targetAmount < minT) {
      score += 8;
      mismatches.push(`Typical minimum check is ${investor.typicalTicket}`);
    } else {
      score += 12;
    }

    // 4. Geography / Ecosystem (Max 15 points)
    const countries = (investor.countries || []).map((c) => c.toLowerCase());
    if (countries.includes('india') || countries.includes('global') || investor.location.toLowerCase().includes('india')) {
      score += 15;
      reasons.push(`Active deployment in India & Global Hubs`);
    } else {
      score += 10;
    }

    const finalScore = Math.min(98, Math.max(45, score));

    return {
      matchScore: finalScore,
      matchReasons: reasons,
      potentialMismatches: mismatches,
    };
  }

  /**
   * List all verified investors with search, filter, and explainable match scoring
   */
  public static async listInvestors(
    userId: string,
    filter: {
      search?: string;
      type?: string;
      sector?: string;
      stage?: string;
      page?: number;
      limit?: number;
    } = {}
  ) {
    // Ensure default system investors exist
    await this.ensureSeedInvestors();

    const org = await this.getOrCreateStartupOrg(userId);
    const query: Record<string, any> = { status: 'active' };

    if (filter.search && filter.search.trim()) {
      const regex = new RegExp(filter.search.trim(), 'i');
      query.$or = [{ name: regex }, { firm: regex }, { thesis: regex }, { sectors: regex }, { location: regex }];
    }

    if (filter.type && filter.type !== 'all') {
      query.type = filter.type;
    }

    if (filter.sector && filter.sector !== 'all') {
      query.sectors = { $regex: new RegExp(filter.sector, 'i') };
    }

    if (filter.stage && filter.stage !== 'all') {
      query.stages = { $regex: new RegExp(filter.stage, 'i') };
    }

    const page = Math.max(1, filter.page || 1);
    const limit = Math.min(50, Math.max(1, filter.limit || 20));
    const skip = (page - 1) * limit;

    const [investors, total] = await Promise.all([
      InvestorModel.find(query).sort({ isSystem: -1, createdAt: -1 }).skip(skip).limit(limit),
      InvestorModel.countDocuments(query),
    ]);

    // Attach deterministic explainable match scores
    const enrichedInvestors = investors.map((inv) => {
      const match = this.calculateMatch(org.fundraisingProfile, inv);
      return {
        ...inv.toObject(),
        matchScore: match.matchScore,
        matchReasons: match.matchReasons,
        potentialMismatches: match.potentialMismatches,
      };
    });

    // Sort by matchScore descending
    enrichedInvestors.sort((a, b) => b.matchScore - a.matchScore);

    return {
      investors: enrichedInvestors,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Get single investor by ID with match report
   */
  public static async getInvestorById(id: string, userId: string) {
    const investor = await InvestorModel.findById(id);
    if (!investor) {
      throw AppError.notFound('Investor record not found');
    }

    const org = await this.getOrCreateStartupOrg(userId);
    const match = this.calculateMatch(org.fundraisingProfile, investor);

    return {
      ...investor.toObject(),
      matchScore: match.matchScore,
      matchReasons: match.matchReasons,
      potentialMismatches: match.potentialMismatches,
    };
  }

  /**
   * List all pipeline deals for the startup
   */
  public static async listPipelineDeals(userId: string) {
    const deals = await InvestorDealModel.find({
      ownerUserId: new Types.ObjectId(userId),
    }).sort({ updatedAt: -1 });

    return deals;
  }

  /**
   * Add an investor to the founder's fundraising pipeline
   */
  public static async createPipelineDeal(
    userId: string,
    data: {
      investorId?: string;
      fundName: string;
      fundLogoText?: string;
      tier?: 'Tier 1 VC' | 'Growth VC' | 'Angel Syndicate' | 'Family Office' | 'Micro VC';
      leadPartner?: string;
      partnerRole?: string;
      partnerEmail?: string;
      linkedinUrl?: string;
      stage?: FundraisingDealStage;
      checkSize?: number;
      checkSizeText?: string;
      focusTags?: string[];
      notes?: string;
      recentDeal?: string;
    }
  ) {
    const org = await this.getOrCreateStartupOrg(userId);

    // Prevent duplicate deal for same investor in active pipeline
    if (data.investorId) {
      const existing = await InvestorDealModel.findOne({
        ownerUserId: new Types.ObjectId(userId),
        investorId: new Types.ObjectId(data.investorId),
        stage: { $ne: 'passed' },
      });
      if (existing) {
        return existing;
      }
    }

    const initials = (data.fundName || 'VC')
      .split(' ')
      .map((w) => w.charAt(0))
      .join('')
      .slice(0, 2)
      .toUpperCase();

    const newDeal = await InvestorDealModel.create({
      startupOrgId: org._id,
      ownerUserId: new Types.ObjectId(userId),
      investorId: data.investorId ? new Types.ObjectId(data.investorId) : undefined,
      fundName: data.fundName,
      fundLogoText: data.fundLogoText || initials,
      tier: data.tier || 'Tier 1 VC',
      leadPartner: data.leadPartner || 'Partner',
      partnerRole: data.partnerRole || 'General Partner',
      partnerEmail: data.partnerEmail || '',
      linkedinUrl: data.linkedinUrl || '',
      stage: data.stage || 'prospect',
      checkSize: data.checkSize || 500000,
      checkSizeText: data.checkSizeText || '$500,000',
      focusTags: data.focusTags || ['AI', 'SaaS'],
      notes: data.notes || '',
      recentDeal: data.recentDeal || '',
      lastTouch: 'Added to pipeline',
      lastTouchType: 'email',
      activities: [
        {
          id: `act_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          date: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
          type: 'stage_change',
          note: `Investor added to ${data.stage || 'prospect'} stage`,
          author: 'Founder',
        },
      ],
    });

    return newDeal;
  }

  /**
   * Update deal attributes or stage with optimistic synchronization
   */
  public static async updatePipelineDeal(
    userId: string,
    dealId: string,
    updates: Partial<IInvestorDealDocument> & { stage?: FundraisingDealStage }
  ) {
    const deal = await InvestorDealModel.findOne({
      _id: new Types.ObjectId(dealId),
      ownerUserId: new Types.ObjectId(userId),
    });

    if (!deal) {
      throw AppError.notFound('Pipeline deal not found');
    }

    const previousStage = deal.stage;

    // Apply updates
    Object.assign(deal, updates);

    // If stage changed, automatically log an activity
    if (updates.stage && updates.stage !== previousStage) {
      deal.activities.unshift({
        id: `act_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        date: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
        type: 'stage_change',
        note: `Moved deal stage from ${previousStage.toUpperCase()} to ${updates.stage.toUpperCase()}`,
        author: 'Founder',
      });
      deal.lastTouch = 'Stage updated';
    }

    await deal.save();
    return deal;
  }

  /**
   * Delete or withdraw deal from pipeline
   */
  public static async deletePipelineDeal(userId: string, dealId: string) {
    const res = await InvestorDealModel.deleteOne({
      _id: new Types.ObjectId(dealId),
      ownerUserId: new Types.ObjectId(userId),
    });

    if (res.deletedCount === 0) {
      throw AppError.notFound('Deal not found or unauthorized');
    }
    return { success: true };
  }

  /**
   * Add a manual note or activity touchpoint to a deal
   */
  public static async addDealActivity(
    userId: string,
    dealId: string,
    activity: { type: 'note' | 'email' | 'meeting' | 'call' | 'data_room'; note: string }
  ) {
    const deal = await InvestorDealModel.findOne({
      _id: new Types.ObjectId(dealId),
      ownerUserId: new Types.ObjectId(userId),
    });

    if (!deal) {
      throw AppError.notFound('Pipeline deal not found');
    }

    deal.activities.unshift({
      id: `act_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      date: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
      type: activity.type,
      note: activity.note,
      author: 'Founder',
    });

    deal.lastTouch = activity.note.slice(0, 40) + '...';
    deal.lastTouchType = activity.type === 'note' ? 'email' : activity.type;

    await deal.save();
    return deal;
  }

  /**
   * Generate hyper-personalized investor outreach email using Gemini AI
   */
  public static async generateAIPersonalizedPitch(
    userId: string,
    data: {
      investorId?: string;
      dealId?: string;
      investorName?: string;
      investorFirm?: string;
      partnerName?: string;
      tone?: 'executive' | 'conversational' | 'data_driven';
    }
  ) {
    const org = await this.getOrCreateStartupOrg(userId);
    const fp = org.fundraisingProfile || {};

    let targetInvestorName = data.investorName || '';
    let targetFirm = data.investorFirm || '';
    let targetPartner = data.partnerName || 'Investor';
    let targetThesis = '';
    let targetSectors = '';

    if (data.investorId) {
      const inv = await InvestorModel.findById(data.investorId);
      if (inv) {
        targetInvestorName = inv.name;
        targetFirm = inv.firm;
        targetPartner = inv.contactPerson?.name || inv.name;
        targetThesis = inv.thesis;
        targetSectors = (inv.sectors || []).join(', ');
      }
    } else if (data.dealId) {
      const deal = await InvestorDealModel.findById(data.dealId);
      if (deal) {
        targetFirm = deal.fundName;
        targetPartner = deal.leadPartner || 'Partner';
        targetSectors = (deal.focusTags || []).join(', ');
      }
    }

    const prompt = `You are an elite Silicon Valley / Indian venture capital fundraising advisor.
Write a personalized, concise, and highly effective cold outreach pitch email for a startup founder reaching out to an investor.

Strict Rules:
- DO NOT invent portfolio companies, fake mutual connections, or fabricated customer metrics.
- Keep the email punchy (under 160 words).
- Follow standard high-converting structure: Hook -> Problem/Solution -> Traction/Metrics -> The Ask (15-minute intro call).

Context Data:
Startup Name: ${org.name}
Sector: ${org.sector || org.industry || 'Enterprise Tech'}
Description: ${org.description || org.bio || 'AI-driven workflow platform'}
Round Name: ${fp.roundName || 'Seed Round'}
Target Raise: ${fp.currency || '$'}${fp.targetAmount ? fp.targetAmount.toLocaleString() : '2,000,000'}
Committed: ${fp.currency || '$'}${fp.committedAmount ? fp.committedAmount.toLocaleString() : '750,000'}
Business Model: ${fp.businessModel || 'B2B SaaS'}
Valuation Cap: ${fp.currency || '$'}${fp.valuationCap ? fp.valuationCap.toLocaleString() : '12,000,000'}

Investor Target:
Partner Name: ${targetPartner}
Firm: ${targetFirm}
Sectors Focus: ${targetSectors || 'Technology, AI, SaaS'}
Investor Thesis: ${targetThesis || 'Backing mission-driven founders with high technical moat'}

Return ONLY a JSON object with:
{
  "subject": "Compelling subject line",
  "emailBody": "Full email text formatted cleanly with paragraphs",
  "talkingPoints": ["Key strength 1", "Key strength 2"]
}`;

    try {
      const aiResponse = await GoogleProvider.getInstance().generate({
        prompt,
        promptName: 'startup_personalized_pitch',
        jsonMode: true,
      });

      const parsed = JSON.parse(aiResponse.text);
      return parsed;
    } catch (err) {
      // Fallback template if AI generation temporarily unavailable
      return {
        subject: `${org.name} (${fp.roundName || 'Seed'} — ${fp.currency || '$'}${fp.targetAmount ? (fp.targetAmount / 1000000).toFixed(1) + 'M' : '2M'}): AI-Powered Platform`,
        emailBody: `Hi ${targetPartner},\n\nI’ve been following ${targetFirm}'s investments in ${targetSectors || 'early-stage technology'} and wanted to introduce ${org.name}.\n\nWe are building an AI-powered operating system for ${org.sector || 'enterprise teams'}, addressing critical workflow bottlenecks.\n\nWe are currently raising our ${fp.roundName || 'Seed Round'} (${fp.currency || '$'}${fp.targetAmount ? (fp.targetAmount / 1000000).toFixed(1) + 'M' : '2M'}, with ${fp.currency || '$'}${fp.committedAmount ? (fp.committedAmount / 1000).toFixed(0) + 'k' : '750k'} already committed).\n\nWould you have 15 minutes next Tuesday or Wednesday for a brief introductory call?\n\nBest regards,\nFounder, ${org.name}`,
        talkingPoints: [
          `Clear fit with ${targetFirm}'s focus`,
          `${fp.currency || '$'}${fp.committedAmount ? (fp.committedAmount / 1000).toFixed(0) + 'k' : '750k'} already committed in round`,
        ],
      };
    }
  }

  /**
   * Seed curated default investors if database is clean
   */
  public static async ensureSeedInvestors() {
    const count = await InvestorModel.countDocuments();
    if (count > 0) return;

    const SEED_INVESTORS = [
      {
        name: 'Peak XV Surge',
        firm: 'Peak XV Partners (formerly Sequoia India)',
        type: 'Venture Capital',
        website: 'https://www.peakxv.com',
        location: 'Bangalore & Singapore',
        countries: ['India', 'Southeast Asia'],
        sectors: ['Enterprise AI', 'B2B SaaS', 'DevTools', 'Fintech'],
        stages: ['Pre-seed', 'Seed', 'Series A'],
        minTicket: 1000000,
        maxTicket: 3000000,
        typicalTicket: '$1M - $3M',
        thesis: 'Backing ambitious early-stage founders building enduring global tech companies with strong engineering moats.',
        description: 'Surge combines up to $3M of seed capital with company-building workshops and dedicated mentorship.',
        portfolioCompanies: ['Atlan', 'InVideo', 'CleverTap', 'Khatabook'],
        contactPerson: { name: 'Rajan Anandan', role: 'Managing Director', email: 'rajan@peakxv.com' },
        isSystem: true,
      },
      {
        name: 'Blume Ventures',
        firm: 'Blume Ventures Fund IV',
        type: 'Venture Capital',
        website: 'https://blume.vc',
        location: 'Mumbai & Bangalore',
        countries: ['India'],
        sectors: ['DeepTech', 'B2B SaaS', 'Fintech', 'Robotics'],
        stages: ['Pre-seed', 'Seed'],
        minTicket: 500000,
        maxTicket: 2000000,
        typicalTicket: '$500k - $2M',
        thesis: 'Investing in transformative Indian technology startups solving domestic friction and taking Indian tech global.',
        description: 'One of India’s premier homegrown early-stage venture capital firms managing over $600M AUM.',
        portfolioCompanies: ['GreyOrange', 'Unacademy', 'Spinny', 'Carbon Clean'],
        contactPerson: { name: 'Sajith Pai', role: 'Partner', email: 'sajith@blume.vc' },
        isSystem: true,
      },
      {
        name: 'Matrix Partners India',
        firm: 'Matrix Partners',
        type: 'Venture Capital',
        website: 'https://matrixpartners.in',
        location: 'Bangalore & Mumbai',
        countries: ['India'],
        sectors: ['Enterprise AI', 'Fintech', 'Consumer Tech', 'Healthtech'],
        stages: ['Seed', 'Series A'],
        minTicket: 1000000,
        maxTicket: 5000000,
        typicalTicket: '$1M - $5M',
        thesis: 'Founder-first early-stage venture capital partnering from the inception round.',
        description: 'Early-stage investors in market creators and breakout founders across India.',
        portfolioCompanies: ['Razorpay', 'Ola', 'Dailyhunt', 'OneCard'],
        contactPerson: { name: 'Avnish Bajaj', role: 'Founder & Managing Director', email: 'avnish@matrixpartners.in' },
        isSystem: true,
      },
      {
        name: 'Elevation Capital',
        firm: 'Elevation Capital VIII',
        type: 'Venture Capital',
        website: 'https://elevationcapital.com',
        location: 'Gurugram & Bangalore',
        countries: ['India'],
        sectors: ['B2B SaaS', 'HR Tech', 'Consumer', 'Fintech'],
        stages: ['Seed', 'Series A'],
        minTicket: 1000000,
        maxTicket: 6000000,
        typicalTicket: '$1M - $5M',
        thesis: 'High-conviction, early-stage partnerships with audacious founders building category-defining companies.',
        description: 'Over 20 years of early investing in India with iconic investments in Swiggy, Paytm, and Urban Company.',
        portfolioCompanies: ['Swiggy', 'Urban Company', 'Meesho', 'Acko'],
        contactPerson: { name: 'Mukul Arora', role: 'Managing Partner', email: 'mukul@elevationcapital.com' },
        isSystem: true,
      },
      {
        name: 'Kunal Shah',
        firm: 'QED Innovation Labs',
        type: 'Angel',
        website: 'https://cred.club',
        location: 'Bangalore, India',
        countries: ['India'],
        sectors: ['Fintech', 'High-Acuity Talent', 'Developer Tools', 'AI'],
        stages: ['Pre-seed', 'Seed'],
        minTicket: 50000,
        maxTicket: 500000,
        typicalTicket: '$100k - $500k',
        thesis: 'Backing high-delta founders who demonstrate exceptional velocity and product obsession.',
        description: 'Founder of CRED & Freecharge, prolific angel investor with 200+ portfolio investments.',
        portfolioCompanies: ['Razorpay', 'Unacademy', 'CRED', 'Khatabook'],
        contactPerson: { name: 'Kunal Shah', role: 'Angel Investor', email: 'kunal@qedlabs.in' },
        isSystem: true,
      },
      {
        name: 'Aman Gupta Syndicate',
        firm: 'boAt Angels & D2C Capital',
        type: 'Angel',
        website: 'https://boat-lifestyle.com',
        location: 'New Delhi, India',
        countries: ['India'],
        sectors: ['Consumer Tech', 'AI Apps', 'Edtech', 'E-commerce'],
        stages: ['Pre-seed', 'Seed'],
        minTicket: 25000,
        maxTicket: 200000,
        typicalTicket: '$50k - $200k',
        thesis: 'Investing in gritty founders creating brand love, high organic retention, and strong unit economics.',
        description: 'Co-founder of boAt and Shark Tank India investor supporting early founders with GTM and branding.',
        portfolioCompanies: ['Shiprocket', 'Skippi', 'Bummer', 'WickedGud'],
        contactPerson: { name: 'Aman Gupta', role: 'Angel Investor', email: 'aman@boat-lifestyle.com' },
        isSystem: true,
      },
      {
        name: 'Antler Global',
        firm: 'Antler India Pre-Seed Fund',
        type: 'Accelerator',
        website: 'https://www.antler.co',
        location: 'Bangalore, India & Global',
        countries: ['India', 'Global'],
        sectors: ['AI Infrastructure', 'Fintech', 'ClimateTech', 'B2B'],
        stages: ['Idea', 'Pre-seed'],
        minTicket: 150000,
        maxTicket: 500000,
        typicalTicket: '$150k - $300k',
        thesis: 'Day zero co-founder matching, validation capital, and global platform expansion.',
        description: 'World’s day zero investor partnering with exceptional founders from idea stage to IPO.',
        portfolioCompanies: ['Sapaad', 'Volopay', 'PowerClub', 'Reap'],
        contactPerson: { name: 'Nitin Sharma', role: 'Partner', email: 'nitin@antler.co' },
        isSystem: true,
      },
      {
        name: 'Accel India',
        firm: 'Accel Partners',
        type: 'Venture Capital',
        website: 'https://www.accel.com',
        location: 'Bangalore, India',
        countries: ['India', 'Global'],
        sectors: ['B2B SaaS', 'AI Applications', 'Cybersecurity', 'Cloud'],
        stages: ['Seed', 'Series A'],
        minTicket: 1000000,
        maxTicket: 5000000,
        typicalTicket: '$1M - $5M',
        thesis: 'First-check partners to exceptional entrepreneurs building generation-defining companies.',
        description: 'Global venture capital firm behind Flipkart, Swiggy, Freshworks, and BrowserStack.',
        portfolioCompanies: ['Freshworks', 'BrowserStack', 'Swiggy', 'Zetwerk'],
        contactPerson: { name: 'Shekhar Kirani', role: 'Partner', email: 'shekhar@accel.com' },
        isSystem: true,
      },
    ];

    await InvestorModel.insertMany(SEED_INVESTORS);
  }
}
