import { TaskModel, ITaskDocument } from './task.model.js';
import { RecruiterOrganizationModel } from '../recruiterOrg/recruiterOrg.model.js';
import { AppError } from '../../utils/appError.js';

export interface TaskFilterOptions {
  status?: string;
  projectId?: string;
  date?: string;
  startDate?: string;
  endDate?: string;
  type?: string;
  isWaitingList?: boolean;
  search?: string;
}

export class TaskService {
  private async getOrgIdForUser(userId: string): Promise<string | null> {
    const org = await RecruiterOrganizationModel.findOne({ ownerUserId: userId }).select('_id');
    return org ? org._id.toString() : null;
  }

  async getTasks(userId: string, filters: TaskFilterOptions = {}): Promise<ITaskDocument[]> {
    const orgId = await this.getOrgIdForUser(userId);

    const andConditions: any[] = [
      orgId ? { $or: [{ orgId }, { userId }] } : { userId },
    ];

    if (filters.status && filters.status !== 'all') {
      andConditions.push({ status: filters.status });
    }

    if (filters.type && filters.type !== 'all') {
      andConditions.push({ type: filters.type });
    }

    if (filters.projectId && filters.projectId !== 'all') {
      andConditions.push({ projectId: filters.projectId });
    }

    if (filters.date) {
      andConditions.push({ date: filters.date });
    } else if (filters.startDate || filters.endDate) {
      const dateFilter: any = {};
      if (filters.startDate) dateFilter.$gte = filters.startDate;
      if (filters.endDate) dateFilter.$lte = filters.endDate;
      andConditions.push({ date: dateFilter });
    }

    if (typeof filters.isWaitingList === 'boolean') {
      andConditions.push({ isWaitingList: filters.isWaitingList });
    }

    if (filters.search && filters.search.trim()) {
      const q = filters.search.trim();
      andConditions.push({
        $or: [
          { title: { $regex: q, $options: 'i' } },
          { description: { $regex: q, $options: 'i' } },
          { location: { $regex: q, $options: 'i' } },
        ],
      });
    }

    const query = andConditions.length > 1 ? { $and: andConditions } : andConditions[0];

    return await TaskModel.find(query).sort({ order: 1, startTime: 1, createdAt: -1 });
  }

  async getTaskById(userId: string, taskId: string): Promise<ITaskDocument> {
    const orgId = await this.getOrgIdForUser(userId);
    const query: any = orgId
      ? { _id: taskId, $or: [{ orgId }, { userId }] }
      : { _id: taskId, userId };

    const task = await TaskModel.findOne(query);
    if (!task) {
      throw AppError.notFound('Task not found');
    }
    return task;
  }

  async createTask(userId: string, payload: Partial<ITaskDocument>): Promise<ITaskDocument> {
    const orgId = await this.getOrgIdForUser(userId);

    const task = new TaskModel({
      ...payload,
      userId,
      orgId: orgId || undefined,
    });

    return await task.save();
  }

  async updateTask(userId: string, taskId: string, updates: Partial<ITaskDocument>): Promise<ITaskDocument> {
    const task = await this.getTaskById(userId, taskId);

    Object.assign(task, updates);
    return await task.save();
  }

  async updateTaskStatus(userId: string, taskId: string, status: 'todo' | 'in_progress' | 'done'): Promise<ITaskDocument> {
    const task = await this.getTaskById(userId, taskId);

    task.status = status;
    return await task.save();
  }

  async deleteTask(userId: string, taskId: string): Promise<void> {
    const task = await this.getTaskById(userId, taskId);
    await TaskModel.deleteOne({ _id: task._id });
  }
}

export const taskService = new TaskService();
