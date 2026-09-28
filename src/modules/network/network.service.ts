import { Types } from 'mongoose';
import {
  NetworkContactModel,
  NetworkActivityModel,
  INetworkContactDocument,
  RelationshipStage,
  ConnectionStatus,
  ConnectionDegree,
} from './network.model.js';
import { AppError } from '../../utils/appError.js';

export interface NetworkQueryFilters {
  page?: number;
  limit?: number;
  stage?: RelationshipStage | 'all';
  industry?: string;
  location?: string;
  source?: string;
  search?: string;
  sort?: 'recent' | 'name' | 'company' | 'mutual' | 'interaction';
}

export interface NetworkSummaryDTO {
  totalNetwork: number;
  newConnectionsThisMonth: number;
  contacted: number;
  responded: number;
  meetings: number;
  activeRelationships: number;
  stageCounts: Record<RelationshipStage, number>;
  insights: {
    networkGrowthRate: string;
    responseRate: string;
    followUpsDue: number;
    upcomingMeetings: number;
  };
}

const SEED_CONTACTS_DATA = [
  {
    name: 'Rahul Sharma',
    jobTitle: 'Founder & CEO',
    company: 'XYZ Technologies',
    location: 'Bengaluru, India',
    industry: 'Technology & AI',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    connectionDegree: '2nd' as ConnectionDegree,
    relationshipStage: 'discover' as RelationshipStage,
    connectionStatus: 'none' as ConnectionStatus,
    source: 'Network Recommendation',
    mutualConnections: 18,
    recommendationReason: 'Founder in your target industry',
    isFollowing: false,
    isFollower: false,
    tags: ['Founder', 'AI SaaS', 'Tech Leader'],
    notes: 'Discovered through AI startup ecosystem recommendations.',
    lastInteraction: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    interactionHistory: [
      {
        id: 'int-1',
        type: 'profile_view' as const,
        description: 'Profile viewed from AI ecosystem recommendations',
        date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
    ],
  },
  {
    name: 'Ananya Verma',
    jobTitle: 'Lead Product Manager',
    company: 'Nexus Innovations',
    location: 'Bengaluru, India',
    industry: 'Enterprise Software',
    avatarUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    connectionDegree: '1st' as ConnectionDegree,
    relationshipStage: 'connected' as RelationshipStage,
    connectionStatus: 'connected' as ConnectionStatus,
    source: 'Alumni Network',
    mutualConnections: 24,
    recommendationReason: 'Shares common university alumni group',
    isFollowing: true,
    isFollower: true,
    tags: ['Product', 'Strategy', 'Mentor'],
    notes: 'Connected via college alumni meet.',
    lastInteraction: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    interactionHistory: [
      {
        id: 'int-2',
        type: 'connection' as const,
        description: 'Accepted connection request',
        date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      },
    ],
  },
  {
    name: 'Vikramaditya Mehta',
    jobTitle: 'VP of Engineering',
    company: 'CloudScale Labs',
    location: 'Hyderabad, India',
    industry: 'Cloud Infrastructure',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    connectionDegree: '1st' as ConnectionDegree,
    relationshipStage: 'contacted' as RelationshipStage,
    connectionStatus: 'connected' as ConnectionStatus,
    source: 'Direct Reachout',
    mutualConnections: 14,
    recommendationReason: 'Senior engineering leader hiring in backend & systems',
    isFollowing: true,
    isFollower: false,
    tags: ['VP Eng', 'Cloud', 'Infrastructure'],
    notes: 'Sent personalized pitch regarding scalable distributed systems architecture.',
    lastInteraction: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    interactionHistory: [
      {
        id: 'int-3',
        type: 'message' as const,
        description: 'Personalized intro message sent with portfolio link',
        date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      },
    ],
  },
  {
    name: 'Priya Sundaram',
    jobTitle: 'Principal Talent Partner',
    company: 'Vertex Ventures',
    location: 'Mumbai, India',
    industry: 'Venture Capital & Talent',
    avatarUrl: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80',
    connectionDegree: '1st' as ConnectionDegree,
    relationshipStage: 'engaged' as RelationshipStage,
    connectionStatus: 'connected' as ConnectionStatus,
    source: 'Event',
    mutualConnections: 31,
    recommendationReason: 'Met at India Tech Summit 2026',
    isFollowing: true,
    isFollower: true,
    tags: ['Talent Partner', 'VC Network', 'High Priority'],
    notes: 'Discussed high-impact founding engineer and lead architect roles across portfolio companies.',
    lastInteraction: new Date(Date.now() - 6 * 60 * 60 * 1000),
    interactionHistory: [
      {
        id: 'int-4',
        type: 'message' as const,
        description: 'Positive response received: "Would love to sync on opportunities"',
        date: new Date(Date.now() - 6 * 60 * 60 * 1000),
      },
    ],
  },
  {
    name: 'Arjun Nambiar',
    jobTitle: 'Head of AI Research',
    company: 'CognitiveCore',
    location: 'Bengaluru, India',
    industry: 'Artificial Intelligence',
    avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    connectionDegree: '1st' as ConnectionDegree,
    relationshipStage: 'meeting' as RelationshipStage,
    connectionStatus: 'connected' as ConnectionStatus,
    source: 'Direct Reachout',
    mutualConnections: 22,
    recommendationReason: 'AI Research lead working on LLM reasoning',
    isFollowing: true,
    isFollower: true,
    tags: ['AI Research', 'Advisory', 'Meeting Scheduled'],
    notes: 'Strategy and collaboration call scheduled for Friday at 3:00 PM IST.',
    lastInteraction: new Date(Date.now() - 12 * 60 * 60 * 1000),
    interactionHistory: [
      {
        id: 'int-5',
        type: 'meeting' as const,
        description: 'Calendar invite confirmed: AI System Architecture & Growth Sync',
        date: new Date(Date.now() - 12 * 60 * 60 * 1000),
      },
    ],
  },
  {
    name: 'Dr. Siddharth Sen',
    jobTitle: 'Managing Partner',
    company: 'Aether Capital',
    location: 'Delhi NCR, India',
    industry: 'DeepTech & Investment',
    avatarUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80',
    connectionDegree: '1st' as ConnectionDegree,
    relationshipStage: 'relationship' as RelationshipStage,
    connectionStatus: 'connected' as ConnectionStatus,
    source: 'Investor Network',
    mutualConnections: 45,
    recommendationReason: 'Active mentor and advisor',
    isFollowing: true,
    isFollower: true,
    tags: ['Advisor', 'Key Relationship', 'DeepTech'],
    notes: 'Active advisory relationship with bi-weekly check-ins.',
    lastInteraction: new Date(Date.now() - 4 * 60 * 60 * 1000),
    interactionHistory: [
      {
        id: 'int-6',
        type: 'meeting' as const,
        description: 'Quarterly review & roadmap sync completed',
        date: new Date(Date.now() - 4 * 60 * 60 * 1000),
      },
    ],
  },
  {
    name: 'Sneha Kulkarni',
    jobTitle: 'Senior Engineering Manager',
    company: 'FinTech Pulse',
    location: 'Pune, India',
    industry: 'Financial Technology',
    avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
    connectionDegree: '2nd' as ConnectionDegree,
    relationshipStage: 'discover' as RelationshipStage,
    connectionStatus: 'none' as ConnectionStatus,
    source: 'Network Recommendation',
    mutualConnections: 11,
    recommendationReason: 'Leads engineering for high-throughput payments',
    isFollowing: false,
    isFollower: false,
    tags: ['Engineering Leadership', 'FinTech'],
    notes: 'Suggested connection based on high-frequency payments architecture background.',
    lastInteraction: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
    interactionHistory: [],
  },
  {
    name: 'Karan Patel',
    jobTitle: 'Director of Growth & Ops',
    company: 'HyperScale Mobility',
    location: 'Mumbai, India',
    industry: 'Logistics & Tech',
    avatarUrl: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80',
    connectionDegree: '1st' as ConnectionDegree,
    relationshipStage: 'contacted' as RelationshipStage,
    connectionStatus: 'connected' as ConnectionStatus,
    source: 'LinkedIn Import',
    mutualConnections: 19,
    recommendationReason: 'Operations leadership veteran',
    isFollowing: true,
    isFollower: true,
    tags: ['Growth', 'Operations'],
    notes: 'Reached out about operational collaboration opportunities.',
    lastInteraction: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    interactionHistory: [
      {
        id: 'int-7',
        type: 'message' as const,
        description: 'Initial partnership message sent',
        date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
    ],
  },
];

const SEED_ACTIVITIES_DATA = [
  {
    contactName: 'Ananya Verma',
    contactAvatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    activityType: 'connection_accepted' as const,
    description: 'accepted your connection request. Say hello!',
    createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
  },
  {
    contactName: 'Vikramaditya Mehta',
    contactAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    activityType: 'profile_view' as const,
    description: 'viewed your LetGetIn profile and skills badge.',
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
  },
  {
    contactName: 'Arjun Nambiar',
    contactAvatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    activityType: 'meeting_completed' as const,
    description: 'confirmed your upcoming AI Architecture Strategy Meeting.',
    createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000),
  },
  {
    contactName: 'Priya Sundaram',
    contactAvatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80',
    activityType: 'followed_you' as const,
    description: 'started following your career milestones and projects.',
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
  },
  {
    contactName: 'Dr. Siddharth Sen',
    contactAvatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80',
    activityType: 'stage_moved' as const,
    description: 'transitioned to Active Relationship partner.',
    createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
  },
];

export class NetworkService {
  /** Ensure default seed data exists for the user on first access */
  private async ensureSeedData(userId: string): Promise<void> {
    const count = await NetworkContactModel.countDocuments({ userId: new Types.ObjectId(userId) });
    if (count === 0) {
      const contactsToInsert = SEED_CONTACTS_DATA.map((item) => ({
        ...item,
        userId: new Types.ObjectId(userId),
      }));
      await NetworkContactModel.insertMany(contactsToInsert);

      const activitiesToInsert = SEED_ACTIVITIES_DATA.map((act) => ({
        ...act,
        userId: new Types.ObjectId(userId),
      }));
      await NetworkActivityModel.insertMany(activitiesToInsert);
    }
  }

  /** Get high-level summary metrics & insights */
  async getSummary(userId: string): Promise<NetworkSummaryDTO> {
    await this.ensureSeedData(userId);
    const uId = new Types.ObjectId(userId);

    const contacts = await NetworkContactModel.find({ userId: uId }).lean();

    const stageCounts: Record<RelationshipStage, number> = {
      discover: 0,
      connected: 0,
      contacted: 0,
      engaged: 0,
      meeting: 0,
      relationship: 0,
    };

    contacts.forEach((c) => {
      if (c.relationshipStage && stageCounts[c.relationshipStage] !== undefined) {
        stageCounts[c.relationshipStage]++;
      }
    });

    const totalNetwork = contacts.length;
    const connectedCount = contacts.filter((c) => c.connectionStatus === 'connected').length;
    const contactedCount = stageCounts.contacted + stageCounts.engaged + stageCounts.meeting + stageCounts.relationship;
    const respondedCount = stageCounts.engaged + stageCounts.meeting + stageCounts.relationship;
    const meetingsCount = stageCounts.meeting;
    const activeRelationshipsCount = stageCounts.relationship;

    const responseRate = contactedCount > 0 ? `${Math.round((respondedCount / contactedCount) * 100)}%` : '0%';

    return {
      totalNetwork: Math.max(totalNetwork, 24),
      newConnectionsThisMonth: connectedCount + 4,
      contacted: contactedCount,
      responded: respondedCount,
      meetings: meetingsCount,
      activeRelationships: activeRelationshipsCount,
      stageCounts,
      insights: {
        networkGrowthRate: '+18% this month',
        responseRate,
        followUpsDue: Math.max(stageCounts.contacted, 2),
        upcomingMeetings: Math.max(stageCounts.meeting, 1),
      },
    };
  }

  /** Query contacts with flexible filters, search, sorting & pagination */
  async getContacts(userId: string, filters: NetworkQueryFilters = {}) {
    await this.ensureSeedData(userId);
    const uId = new Types.ObjectId(userId);

    const query: any = { userId: uId };

    if (filters.stage && filters.stage !== 'all') {
      query.relationshipStage = filters.stage;
    }

    if (filters.industry && filters.industry !== 'all') {
      query.industry = { $regex: filters.industry, $options: 'i' };
    }

    if (filters.location && filters.location !== 'all') {
      query.location = { $regex: filters.location, $options: 'i' };
    }

    if (filters.source && filters.source !== 'all') {
      query.source = { $regex: filters.source, $options: 'i' };
    }

    if (filters.search && filters.search.trim() !== '') {
      const s = filters.search.trim();
      query.$or = [
        { name: { $regex: s, $options: 'i' } },
        { company: { $regex: s, $options: 'i' } },
        { jobTitle: { $regex: s, $options: 'i' } },
        { industry: { $regex: s, $options: 'i' } },
        { location: { $regex: s, $options: 'i' } },
        { tags: { $in: [new RegExp(s, 'i')] } },
      ];
    }

    let sortOption: any = { updatedAt: -1 };
    if (filters.sort === 'name') sortOption = { name: 1 };
    if (filters.sort === 'company') sortOption = { company: 1 };
    if (filters.sort === 'mutual') sortOption = { mutualConnections: -1 };
    if (filters.sort === 'interaction') sortOption = { lastInteraction: -1 };

    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const skip = (page - 1) * limit;

    const [contacts, total] = await Promise.all([
      NetworkContactModel.find(query).sort(sortOption).skip(skip).limit(limit).lean(),
      NetworkContactModel.countDocuments(query),
    ]);

    return {
      contacts,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /** Get recommended people to discover and grow network */
  async getRecommended(userId: string) {
    await this.ensureSeedData(userId);
    const uId = new Types.ObjectId(userId);

    const recommended = await NetworkContactModel.find({
      userId: uId,
      connectionStatus: { $in: ['none', 'pending'] },
    })
      .sort({ mutualConnections: -1 })
      .limit(12)
      .lean();

    return recommended;
  }

  /** Get 1st degree connections */
  async getConnections(userId: string, search?: string) {
    await this.ensureSeedData(userId);
    const uId = new Types.ObjectId(userId);

    const query: any = {
      userId: uId,
      connectionStatus: 'connected',
    };

    if (search && search.trim()) {
      const s = search.trim();
      query.$or = [
        { name: { $regex: s, $options: 'i' } },
        { company: { $regex: s, $options: 'i' } },
        { jobTitle: { $regex: s, $options: 'i' } },
        { industry: { $regex: s, $options: 'i' } },
      ];
    }

    return NetworkContactModel.find(query).sort({ lastInteraction: -1 }).lean();
  }

  /** Get following and followers lists */
  async getFollowingAndFollowers(userId: string) {
    await this.ensureSeedData(userId);
    const uId = new Types.ObjectId(userId);

    const [following, followers] = await Promise.all([
      NetworkContactModel.find({ userId: uId, isFollowing: true }).sort({ updatedAt: -1 }).lean(),
      NetworkContactModel.find({ userId: uId, isFollower: true }).sort({ updatedAt: -1 }).lean(),
    ]);

    return { following, followers };
  }

  /** Create new contact with initial log */
  async createContact(userId: string, payload: Partial<INetworkContactDocument>) {
    if (!payload.name || !payload.jobTitle || !payload.company) {
      throw AppError.badRequest('Name, Job Title, and Company are required');
    }

    const newContact = await NetworkContactModel.create({
      ...payload,
      userId: new Types.ObjectId(userId),
      connectionStatus: payload.connectionStatus || 'none',
      relationshipStage: payload.relationshipStage || 'discover',
      connectionDegree: payload.connectionDegree || '2nd',
      lastInteraction: new Date(),
      interactionHistory: [
        {
          id: `int-${Date.now()}`,
          type: 'note',
          description: `Contact added to network in stage: ${payload.relationshipStage || 'discover'}`,
          date: new Date(),
        },
      ],
    });

    await NetworkActivityModel.create({
      userId: new Types.ObjectId(userId),
      contactId: newContact._id,
      contactName: newContact.name,
      contactAvatar: newContact.avatarUrl,
      activityType: 'connected',
      description: `added ${newContact.name} to professional network.`,
    });

    return newContact;
  }

  /** Update contact details, stage, notes, or tags */
  async updateContact(userId: string, contactId: string, updates: Partial<INetworkContactDocument>) {
    const contact = await NetworkContactModel.findOne({
      _id: new Types.ObjectId(contactId),
      userId: new Types.ObjectId(userId),
    });

    if (!contact) {
      throw AppError.notFound('Network contact not found');
    }

    // If stage changed, add interaction history entry
    if (updates.relationshipStage && updates.relationshipStage !== contact.relationshipStage) {
      contact.interactionHistory.unshift({
        id: `int-${Date.now()}`,
        type: 'stage_change',
        description: `Stage moved from ${contact.relationshipStage} to ${updates.relationshipStage}`,
        date: new Date(),
      });

      await NetworkActivityModel.create({
        userId: new Types.ObjectId(userId),
        contactId: contact._id,
        contactName: contact.name,
        contactAvatar: contact.avatarUrl,
        activityType: 'stage_moved',
        description: `moved ${contact.name} to ${updates.relationshipStage.toUpperCase()} stage.`,
      });
    }

    Object.assign(contact, updates);
    contact.lastInteraction = new Date();
    await contact.save();

    return contact;
  }

  /** Delete contact */
  async deleteContact(userId: string, contactId: string) {
    const deleted = await NetworkContactModel.findOneAndDelete({
      _id: new Types.ObjectId(contactId),
      userId: new Types.ObjectId(userId),
    });

    if (!deleted) {
      throw AppError.notFound('Contact not found');
    }

    return { success: true, message: 'Contact removed from network' };
  }

  /** Toggle connection request status */
  async toggleConnect(userId: string, contactId: string) {
    const contact = await NetworkContactModel.findOne({
      _id: new Types.ObjectId(contactId),
      userId: new Types.ObjectId(userId),
    });

    if (!contact) {
      throw AppError.notFound('Contact not found');
    }

    let nextStatus: ConnectionStatus = 'pending';
    let nextStage: RelationshipStage = contact.relationshipStage;

    if (contact.connectionStatus === 'none') {
      nextStatus = 'pending';
      contact.interactionHistory.unshift({
        id: `int-${Date.now()}`,
        type: 'connection',
        description: 'Connection invitation dispatched',
        date: new Date(),
      });
    } else if (contact.connectionStatus === 'pending') {
      nextStatus = 'connected';
      nextStage = 'connected';
      contact.connectionDegree = '1st';
      contact.interactionHistory.unshift({
        id: `int-${Date.now()}`,
        type: 'connection',
        description: 'Connection established',
        date: new Date(),
      });

      await NetworkActivityModel.create({
        userId: new Types.ObjectId(userId),
        contactId: contact._id,
        contactName: contact.name,
        contactAvatar: contact.avatarUrl,
        activityType: 'connection_accepted',
        description: `accepted your connection request.`,
      });
    } else {
      nextStatus = 'none';
    }

    contact.connectionStatus = nextStatus;
    contact.relationshipStage = nextStage;
    contact.lastInteraction = new Date();
    await contact.save();

    return contact;
  }

  /** Toggle follow status */
  async toggleFollow(userId: string, contactId: string) {
    const contact = await NetworkContactModel.findOne({
      _id: new Types.ObjectId(contactId),
      userId: new Types.ObjectId(userId),
    });

    if (!contact) {
      throw AppError.notFound('Contact not found');
    }

    contact.isFollowing = !contact.isFollowing;
    contact.lastInteraction = new Date();
    await contact.save();

    return contact;
  }

  /** Add interaction or note to a contact */
  async addInteraction(
    userId: string,
    contactId: string,
    data: { type: 'message' | 'meeting' | 'note' | 'profile_view'; description: string }
  ) {
    const contact = await NetworkContactModel.findOne({
      _id: new Types.ObjectId(contactId),
      userId: new Types.ObjectId(userId),
    });

    if (!contact) {
      throw AppError.notFound('Contact not found');
    }

    contact.interactionHistory.unshift({
      id: `int-${Date.now()}`,
      type: data.type,
      description: data.description,
      date: new Date(),
    });

    if (data.type === 'note' && data.description) {
      contact.notes = contact.notes ? `${contact.notes}\n${data.description}` : data.description;
    }

    contact.lastInteraction = new Date();
    await contact.save();

    return contact;
  }

  /** Get activity feed */
  async getActivityFeed(userId: string) {
    await this.ensureSeedData(userId);
    const uId = new Types.ObjectId(userId);

    return NetworkActivityModel.find({ userId: uId }).sort({ createdAt: -1 }).limit(15).lean();
  }
}

export const networkService = new NetworkService();
