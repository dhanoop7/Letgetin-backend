import { BaseRepository } from '../shared/base.repository.js';
import { IResumeDocument, ResumeModel } from './resume.model.js';

export class ResumeRepository extends BaseRepository<IResumeDocument> {
  constructor() {
    super(ResumeModel);
  }

  async findByUserId(userId: string): Promise<IResumeDocument[]> {
    return await this.findMany({ userId }, { sort: { updatedAt: -1 } });
  }

  async findByIdAndUserId(id: string, userId: string): Promise<IResumeDocument | null> {
    return await this.findOne({ _id: id, userId });
  }
}
