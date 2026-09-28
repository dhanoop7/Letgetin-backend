import { Schema, model, Document, Types } from 'mongoose';

export type RelationshipStage =
  | 'discover'
  | 'connected'
  | 'contacted'
  | 'engaged'
  | 'meeting'
  | 'relationship';

export type ConnectionStatus = 'none' | 'pending' | 'connected' | 'rejected' | 'blocked';
export type ConnectionDegree = '1st' | '2nd' | '3rd+';

export interface IInteractionHistory {
  id: string;
  type: 'connection' | 'message' | 'meeting' | 'profile_view' | 'note' | 'stage_change';
  description: string;
  date: Date;
}

export interface INetworkContactDocument extends Document {
  userId: Types.ObjectId;
  name: string;
  email?: string;
  phone?: string;
  jobTitle: string;
  company: string;
  location: string;
  industry: string;
  avatarUrl?: string;
  linkedinUrl?: string;
  connectionDegree: ConnectionDegree;
  relationshipStage: RelationshipStage;
  connectionStatus: ConnectionStatus;
  source: string;
  mutualConnections: number;
  recommendationReason?: string;
  isFollowing: boolean;
  isFollower: boolean;
  tags: string[];
  notes?: string;
  lastInteraction: Date;
  interactionHistory: IInteractionHistory[];
  createdAt: Date;
  updatedAt: Date;
}

const InteractionHistorySchema = new Schema<IInteractionHistory>(
  {
    id: { type: String, required: true },
    type: {
      type: String,
      enum: ['connection', 'message', 'meeting', 'profile_view', 'note', 'stage_change'],
      required: true,
    },
    description: { type: String, required: true },
    date: { type: Date, default: Date.now },
  },
  { _id: false }
);

const NetworkContactSchema = new Schema<INetworkContactDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, sparse: true, lowercase: true, trim: true },
    phone: { type: String, sparse: true, trim: true },
    jobTitle: { type: String, required: true, trim: true },
    company: { type: String, required: true, trim: true },
    location: { type: String, required: true, trim: true },
    industry: { type: String, required: true, trim: true },
    avatarUrl: { type: String },
    linkedinUrl: { type: String, trim: true },
    connectionDegree: {
      type: String,
      enum: ['1st', '2nd', '3rd+'],
      default: '2nd',
    },
    relationshipStage: {
      type: String,
      enum: ['discover', 'connected', 'contacted', 'engaged', 'meeting', 'relationship'],
      default: 'discover',
      index: true,
    },
    connectionStatus: {
      type: String,
      enum: ['none', 'pending', 'connected', 'rejected', 'blocked'],
      default: 'none',
      index: true,
    },
    source: {
      type: String,
      default: 'Network Recommendation',
    },
    mutualConnections: {
      type: Number,
      default: 0,
    },
    recommendationReason: {
      type: String,
    },
    isFollowing: {
      type: Boolean,
      default: false,
    },
    isFollower: {
      type: Boolean,
      default: false,
    },
    tags: {
      type: [String],
      default: [],
    },
    notes: {
      type: String,
      default: '',
    },
    lastInteraction: {
      type: Date,
      default: Date.now,
    },
    interactionHistory: {
      type: [InteractionHistorySchema],
      default: [],
    },
  },
  { timestamps: true }
);

NetworkContactSchema.index({ userId: 1, relationshipStage: 1 });
NetworkContactSchema.index({ userId: 1, industry: 1 });
NetworkContactSchema.index({ userId: 1, company: 1 });
NetworkContactSchema.index({ userId: 1, name: 'text', company: 'text', jobTitle: 'text' });

export const NetworkContactModel = model<INetworkContactDocument>(
  'NetworkContact',
  NetworkContactSchema
);

export interface INetworkActivityDocument extends Document {
  userId: Types.ObjectId;
  contactId?: Types.ObjectId;
  contactName: string;
  contactAvatar?: string;
  activityType:
    | 'connection_accepted'
    | 'followed_you'
    | 'profile_view'
    | 'company_changed'
    | 'update_posted'
    | 'connected'
    | 'meeting_completed'
    | 'stage_moved';
  description: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

const NetworkActivitySchema = new Schema<INetworkActivityDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'NetworkContact', required: false },
    contactName: { type: String, required: true },
    contactAvatar: { type: String },
    activityType: {
      type: String,
      enum: [
        'connection_accepted',
        'followed_you',
        'profile_view',
        'company_changed',
        'update_posted',
        'connected',
        'meeting_completed',
        'stage_moved',
      ],
      required: true,
    },
    description: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

NetworkActivitySchema.index({ userId: 1, createdAt: -1 });

export const NetworkActivityModel = model<INetworkActivityDocument>(
  'NetworkActivity',
  NetworkActivitySchema
);
