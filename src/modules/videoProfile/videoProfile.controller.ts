import { Request, Response } from 'express';
import { videoProfileService } from './videoProfile.service.js';
import { VideoType } from './videoProfile.model.js';
import { AppError } from '../../utils/appError.js';

export class VideoProfileController {
  static upload = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const videoType = req.body.videoType as VideoType;
    const file = req.file;

    if (!file) {
      throw AppError.badRequest('No video file provided');
    }

    const video = await videoProfileService.uploadVideo(userId, videoType, {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    });

    res.status(201).json({
      success: true,
      data: { video },
      message: 'Video uploaded successfully',
      timestamp: new Date().toISOString(),
    });
  };

  static list = async (req: Request, res: Response): Promise<void> => {
    const videos = await videoProfileService.getVideosForUser(req.user!.userId);
    res.status(200).json({
      success: true,
      data: { videos },
      timestamp: new Date().toISOString(),
    });
  };

  static archive = async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    const video = await videoProfileService.setArchived(id, req.user!.userId, true);
    res.status(200).json({
      success: true,
      data: { video },
      message: 'Video archived',
      timestamp: new Date().toISOString(),
    });
  };

  static delete = async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    await videoProfileService.deleteVideo(id, req.user!.userId);
    res.status(200).json({
      success: true,
      data: null,
      message: 'Video deleted successfully',
      timestamp: new Date().toISOString(),
    });
  };
}
