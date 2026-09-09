import { BaseRepository } from '../shared/base.repository.js';
import { ICoverLetterDocument, CoverLetterModel } from './coverLetter.model.js';

export class CoverLetterRepository extends BaseRepository<ICoverLetterDocument> {
  constructor() {
    super(CoverLetterModel);
  }

  async findByUserId(userId: string): Promise<ICoverLetterDocument[]> {
    return await this.findMany({ userId }, { sort: { updatedAt: -1 } });
  }

  async findByIdAndUserId(id: string, userId: string): Promise<ICoverLetterDocument | null> {
    return await this.findOne({ _id: id, userId });
  }
}
