import { Request, Response } from 'express';
import { noteService } from './note.service.js';

export class NoteController {
  static getNotes = async (req: Request, res: Response): Promise<void> => {
    const { search } = req.query;

    const notes = await noteService.getNotes(
      req.user!.userId,
      typeof search === 'string' ? search : undefined
    );

    res.status(200).json({
      success: true,
      data: notes,
      timestamp: new Date().toISOString(),
    });
  };

  static getNoteById = async (req: Request, res: Response): Promise<void> => {
    const note = await noteService.getNoteById(
      req.user!.userId,
      req.params.id as string
    );

    res.status(200).json({
      success: true,
      data: note,
      timestamp: new Date().toISOString(),
    });
  };

  static createNote = async (req: Request, res: Response): Promise<void> => {
    const note = await noteService.createNote(req.user!.userId, req.body);

    res.status(201).json({
      success: true,
      data: note,
      message: 'Note created successfully',
      timestamp: new Date().toISOString(),
    });
  };

  static updateNote = async (req: Request, res: Response): Promise<void> => {
    const note = await noteService.updateNote(
      req.user!.userId,
      req.params.id as string,
      req.body
    );

    res.status(200).json({
      success: true,
      data: note,
      message: 'Note updated successfully',
      timestamp: new Date().toISOString(),
    });
  };

  static deleteNote = async (req: Request, res: Response): Promise<void> => {
    await noteService.deleteNote(req.user!.userId, req.params.id as string);

    res.status(200).json({
      success: true,
      message: 'Note deleted successfully',
      timestamp: new Date().toISOString(),
    });
  };
}
