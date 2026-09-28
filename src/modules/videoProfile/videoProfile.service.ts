import { VideoProfileRepository } from './videoProfile.repository.js';
import { IVideoProfileDocument, VideoType } from './videoProfile.model.js';
import { CloudinaryService } from '../../services/cloudinary.service.js';
import { AppError } from '../../utils/appError.js';

// Centralized, named limits - not magic numbers scattered through the codebase.
export const VIDEO_SIZE_LIMITS: Record<VideoType, number> = {
  short: 10 * 1024 * 1024, // 10 MB
  long: 50 * 1024 * 1024, // 50 MB
};

export class VideoProfileService {
  private repository: VideoProfileRepository;

  constructor() {
    this.repository = new VideoProfileRepository();
  }

  async uploadVideo(
    userId: string,
    videoType: VideoType,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number }
  ): Promise<IVideoProfileDocument> {
    if (!file) {
      throw AppError.badRequest('No video file provided');
    }

    // Server-side format validation - never trust the frontend's file picker `accept` attribute alone.
    if (!file.mimetype.startsWith('video/')) {
      throw AppError.badRequest('Only video files are supported for Video Profile uploads');
    }

    // Server-side, per-type size validation. Multer's own limit is a single shared ceiling (see
    // videoProfile.routes.ts) sized to the larger of the two types, so this is the real enforcement
    // point for the tighter Short Video limit.
    const maxBytes = VIDEO_SIZE_LIMITS[videoType];
    if (file.size > maxBytes) {
      const maxMb = (maxBytes / (1024 * 1024)).toFixed(0);
      const fileMb = (file.size / (1024 * 1024)).toFixed(2);
      throw AppError.badRequest(
        `${videoType === 'short' ? 'Short' : 'Long'} Video must be ${maxMb} MB or smaller (this file is ${fileMb} MB)`
      );
    }

    const folderPath = `resumebuildai/video-profile/${userId}`;
    const uploadResult = await CloudinaryService.uploadFileBuffer(
      file.buffer,
      file.originalname,
      file.mimetype,
      folderPath
    );

    return await this.repository.create({
      userId: userId as any,
      videoType,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      cloudinary: {
        publicId: uploadResult.publicId,
        url: uploadResult.url,
        secureUrl: uploadResult.secureUrl,
        format: uploadResult.format,
        resourceType: uploadResult.resourceType,
      },
      isArchived: false,
    });
  }

  async getVideosForUser(userId: string): Promise<IVideoProfileDocument[]> {
    return await this.repository.findByUserId(userId);
  }

  async setArchived(id: string, userId: string, isArchived: boolean): Promise<IVideoProfileDocument> {
    const existing = await this.repository.findByIdAndUserId(id, userId);
    if (!existing) {
      throw AppError.notFound('Video not found or access denied');
    }
    const updated = await this.repository.updateById(id, { isArchived });
    if (!updated) {
      throw AppError.internal('Failed to update video');
    }
    return updated;
  }

  async deleteVideo(id: string, userId: string): Promise<void> {
    const existing = await this.repository.findByIdAndUserId(id, userId);
    if (!existing) {
      throw AppError.notFound('Video not found or access denied');
    }
    if (existing.cloudinary?.publicId) {
      await CloudinaryService.deleteFile(existing.cloudinary.publicId, existing.cloudinary.resourceType);
    }
    await this.repository.deleteById(id);
  }
}

export const videoProfileService = new VideoProfileService();
