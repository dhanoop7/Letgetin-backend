import { NoteModel, INoteDocument } from './note.model.js';
import { RecruiterOrganizationModel } from '../recruiterOrg/recruiterOrg.model.js';
import { AppError } from '../../utils/appError.js';

export class NoteService {
  private async getOrgIdForUser(userId: string): Promise<string | null> {
    const org = await RecruiterOrganizationModel.findOne({ ownerUserId: userId }).select('_id');
    return org ? org._id.toString() : null;
  }

  async getNotes(userId: string, search?: string): Promise<INoteDocument[]> {
    const orgId = await this.getOrgIdForUser(userId);

    const query: any = orgId
      ? { $or: [{ orgId }, { userId }] }
      : { userId };

    if (search && search.trim()) {
      const q = search.trim();
      query.$or = [
        { title: { $regex: q, $options: 'i' } },
        { content: { $regex: q, $options: 'i' } },
      ];
    }

    return await NoteModel.find(query).sort({ pinned: -1, updatedAt: -1 });
  }

  async getNoteById(userId: string, noteId: string): Promise<INoteDocument> {
    const orgId = await this.getOrgIdForUser(userId);
    const query: any = orgId
      ? { _id: noteId, $or: [{ orgId }, { userId }] }
      : { _id: noteId, userId };

    const note = await NoteModel.findOne(query);
    if (!note) {
      throw AppError.notFound('Note not found');
    }
    return note;
  }

  async createNote(userId: string, payload: Partial<INoteDocument>): Promise<INoteDocument> {
    const orgId = await this.getOrgIdForUser(userId);

    const note = new NoteModel({
      ...payload,
      userId,
      orgId: orgId || undefined,
    });

    return await note.save();
  }

  async updateNote(userId: string, noteId: string, updates: Partial<INoteDocument>): Promise<INoteDocument> {
    const note = await this.getNoteById(userId, noteId);

    Object.assign(note, updates);
    return await note.save();
  }

  async deleteNote(userId: string, noteId: string): Promise<void> {
    const note = await this.getNoteById(userId, noteId);
    await NoteModel.deleteOne({ _id: note._id });
  }
}

export const noteService = new NoteService();
