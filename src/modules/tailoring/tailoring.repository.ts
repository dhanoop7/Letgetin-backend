import { BaseRepository } from '../shared/base.repository.js';
import { ITailoringSessionDocument, TailoringSessionModel } from './tailoring.model.js';

export class TailoringRepository extends BaseRepository<ITailoringSessionDocument> {
  constructor() {
    super(TailoringSessionModel);
  }

  async findByIdAndUserId(id: string, userId: string): Promise<ITailoringSessionDocument | null> {
    return await this.findOne({ _id: id, userId });
  }

  async findActiveByResumeAndUser(sourceResumeId: string, userId: string): Promise<ITailoringSessionDocument | null> {
    return await this.model
      .findOne({ sourceResumeId, userId, status: 'active' })
      .sort({ updatedAt: -1 })
      .exec();
  }

  /** Removes any stale in-progress sessions for this resume so a fresh entry never leaks a prior journey. */
  async deleteActiveByResumeAndUser(sourceResumeId: string, userId: string): Promise<void> {
    await this.model.deleteMany({ sourceResumeId, userId, status: 'active' }).exec();
  }
}
