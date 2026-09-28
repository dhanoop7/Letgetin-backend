import { BaseRepository } from '../shared/base.repository.js';
import { IVideoProfileDocument, VideoProfileModel } from './videoProfile.model.js';

export class VideoProfileRepository extends BaseRepository<IVideoProfileDocument> {
  constructor() {
    super(VideoProfileModel);
  }

  async findByUserId(userId: string): Promise<IVideoProfileDocument[]> {
    return await this.findMany({ userId }, { sort: { createdAt: -1 } });
  }

  async findByIdAndUserId(id: string, userId: string): Promise<IVideoProfileDocument | null> {
    return await this.findOne({ _id: id, userId });
  }
}
