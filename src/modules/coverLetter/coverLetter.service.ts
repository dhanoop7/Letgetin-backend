import { CoverLetterRepository } from './coverLetter.repository.js';
import { AppError } from '../../utils/appError.js';
import { ICoverLetterDocument } from './coverLetter.model.js';

export class CoverLetterService {
  private repository: CoverLetterRepository;

  constructor() {
    this.repository = new CoverLetterRepository();
  }

  async createCoverLetter(userId: string, data: { title: string; content: string }): Promise<ICoverLetterDocument> {
    return await this.repository.create({
      userId: userId as any,
      title: data.title,
      content: data.content,
    });
  }

  async getCoverLettersForUser(userId: string): Promise<ICoverLetterDocument[]> {
    return await this.repository.findByUserId(userId);
  }

  async getCoverLetterById(id: string, userId: string): Promise<ICoverLetterDocument> {
    const coverLetter = await this.repository.findByIdAndUserId(id, userId);
    if (!coverLetter) {
      throw AppError.notFound('Cover letter not found or access denied');
    }
    return coverLetter;
  }

  async updateCoverLetter(
    id: string,
    userId: string,
    updateData: Partial<ICoverLetterDocument>
  ): Promise<ICoverLetterDocument> {
    const existing = await this.repository.findByIdAndUserId(id, userId);
    if (!existing) {
      throw AppError.notFound('Cover letter not found or access denied');
    }

    const updated = await this.repository.updateById(id, updateData);
    if (!updated) {
      throw AppError.internal('Failed to update cover letter');
    }
    return updated;
  }

  async deleteCoverLetter(id: string, userId: string): Promise<void> {
    const existing = await this.repository.findByIdAndUserId(id, userId);
    if (!existing) {
      throw AppError.notFound('Cover letter not found or access denied');
    }
    await this.repository.deleteById(id);
  }
}
