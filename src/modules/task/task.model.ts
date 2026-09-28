import { Schema, model, Document, Types } from 'mongoose';

export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskItemType = 'task' | 'event' | 'reminder';

export interface ITaskSubtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface ITaskAttachment {
  id: string;
  name: string;
  url: string;
  size?: string;
}

export interface ITaskParticipant {
  name: string;
  isMe?: boolean;
  avatar?: string;
}

export interface ITaskDocument extends Document {
  userId: Types.ObjectId;
  orgId?: Types.ObjectId;
  title: string;
  description?: string;
  type: TaskItemType;
  status: TaskStatus;
  priority: TaskPriority;
  projectId: string;
  typeName?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  dueDate?: string;
  estimatedTime?: string;
  iconEmoji?: string;
  location?: string;
  meetingLink?: string;
  workspaceName?: string;
  repeats?: boolean;
  themeColor?: string;
  participants: ITaskParticipant[];
  assignee?: {
    name: string;
    avatar?: string;
    userId?: Types.ObjectId;
  };
  subtasks: ITaskSubtask[];
  tags: string[];
  attachments: ITaskAttachment[];
  isWaitingList: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const TaskParticipantSchema = new Schema<ITaskParticipant>(
  {
    name: { type: String, required: true, trim: true },
    isMe: { type: Boolean, default: false },
    avatar: { type: String, default: '' },
  },
  { _id: false }
);

const TaskSubtaskSchema = new Schema<ITaskSubtask>(
  {
    id: { type: String, required: true },
    title: { type: String, required: true, trim: true },
    completed: { type: Boolean, default: false },
  },
  { _id: false }
);

const TaskAttachmentSchema = new Schema<ITaskAttachment>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    url: { type: String, required: true },
    size: { type: String, default: '' },
  },
  { _id: false }
);

const TaskSchema = new Schema<ITaskDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'RecruiterOrganization', index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    type: { type: String, enum: ['task', 'event', 'reminder'], default: 'task', index: true },
    status: { type: String, enum: ['todo', 'in_progress', 'done'], default: 'in_progress', index: true },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    projectId: { type: String, default: 'strategic', index: true },
    typeName: { type: String, default: '' },
    date: { type: String, default: null, index: true },
    startTime: { type: String, default: null },
    endTime: { type: String, default: null },
    durationMinutes: { type: Number, default: 60 },
    dueDate: { type: String, default: null },
    estimatedTime: { type: String, default: '' },
    iconEmoji: { type: String, default: '' },
    location: { type: String, default: '' },
    meetingLink: { type: String, default: '' },
    workspaceName: { type: String, default: '' },
    repeats: { type: Boolean, default: false },
    themeColor: { type: String, default: 'teal' },
    participants: { type: [TaskParticipantSchema], default: [] },
    assignee: {
      name: { type: String, default: 'Me' },
      avatar: { type: String, default: '' },
      userId: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    subtasks: { type: [TaskSubtaskSchema], default: [] },
    tags: { type: [String], default: [] },
    attachments: { type: [TaskAttachmentSchema], default: [] },
    isWaitingList: { type: Boolean, default: false, index: true },
    order: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: any) => {
        ret.id = ret._id.toString();
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (_doc, ret: any) => {
        ret.id = ret._id.toString();
        delete ret.__v;
        return ret;
      },
    },
  }
);

TaskSchema.index({ userId: 1, status: 1, createdAt: -1 });
TaskSchema.index({ userId: 1, date: 1, type: 1 });
TaskSchema.index({ orgId: 1, date: 1 });
TaskSchema.index({ orgId: 1, status: 1 });

export const TaskModel = model<ITaskDocument>('Task', TaskSchema);
