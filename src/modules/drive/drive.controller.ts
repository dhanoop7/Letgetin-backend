import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { DriveFileModel, DriveCategory } from './drive.model.js';
import { VerificationDocumentModel } from '../profile/verification.model.js';
import { ResumeModel } from '../resume/resume.model.js';
import { CloudinaryService } from '../../services/cloudinary.service.js';
import { AppError } from '../../utils/appError.js';
import { TextExtractionService } from '../import/text-extraction.service.js';

const TOTAL_LIMIT_BYTES = 50 * 1024 * 1024; // 50 MB SaaS limit per user
const MAX_EXTRACTED_TEXT_CHARS = 8000;
const textExtractionService = new TextExtractionService();

/**
 * Best-effort text extraction for chat-context retrieval, run after the upload response is sent.
 * Only attempted for pdf/document categories; never blocks the upload request.
 */
async function extractAndStoreDriveFileText(
  fileId: string,
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<void> {
  try {
    const text = await textExtractionService.extractTextFromBuffer(buffer, mimeType || fileName);
    await DriveFileModel.findByIdAndUpdate(fileId, {
      extractedText: text.slice(0, MAX_EXTRACTED_TEXT_CHARS),
      extractedTextStatus: 'done',
    });
  } catch (err: any) {
    const status = err?.name === 'UnsupportedFileTypeError' ? 'unsupported' : 'failed';
    await DriveFileModel.findByIdAndUpdate(fileId, { extractedTextStatus: status }).catch(() => {});
    console.warn(`[DriveController] Text extraction failed for file ${fileId}:`, err?.message);
  }
}

export function determineCategory(mimeType: string, fileName: string): DriveCategory {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (mimeType === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (
    mimeType.includes('word') ||
    mimeType.includes('excel') ||
    mimeType.includes('spreadsheet') ||
    mimeType.includes('presentation') ||
    mimeType.includes('text') ||
    ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'rtf', 'md', 'json'].includes(ext)
  ) {
    return 'document';
  }
  if (
    mimeType.includes('zip') ||
    mimeType.includes('rar') ||
    mimeType.includes('tar') ||
    mimeType.includes('compressed') ||
    ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)
  ) {
    return 'archive';
  }
  return 'other';
}

interface IUnifiedDriveFile {
  _id: string;
  userId: string;
  originalName: string;
  mimeType: string;
  size: number;
  category: DriveCategory;
  cloudinary: {
    publicId: string;
    url: string;
    secureUrl: string;
    format: string;
    resourceType: string;
  };
  starred: boolean;
  tags: string[];
  description: string;
  source: 'drive' | 'profile' | 'resume';
  section?: string;
  documentType?: string;
  verificationStatus?: string;
  resumeId?: string;
  atsScore?: number;
  templateId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class DriveController {
  /**
   * Calculate storage usage across all user assets (Drive files, Profile verification documents, Resumes)
   */
  public static async getUserStorageUsage(userId: string) {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // 1. Fetch user assets across all sources in parallel
    const [driveFiles, profileDocs, resumes] = await Promise.all([
      DriveFileModel.find({ userId: userObjectId }).lean(),
      VerificationDocumentModel.find({ userId: userObjectId }).lean(),
      ResumeModel.find({ userId: userObjectId }).lean(),
    ]);

    let usedBytes = 0;
    let totalCount = 0;
    let driveBytes = 0;
    let profileBytes = 0;
    let resumeBytes = 0;

    const categoryBreakdown: Record<string, number> = {
      pdf: 0,
      image: 0,
      document: 0,
      archive: 0,
      audio: 0,
      video: 0,
      other: 0,
    };

    // 1. Process Drive files
    for (const f of driveFiles) {
      const size = Number(f.size) || 0;
      usedBytes += size;
      driveBytes += size;
      totalCount += 1;
      const cat = f.category || 'other';
      if (categoryBreakdown[cat] !== undefined) {
        categoryBreakdown[cat] += size;
      } else {
        categoryBreakdown.other += size;
      }
    }

    // 2. Process Profile verification documents
    for (const doc of profileDocs) {
      const mime = doc.cloudinary?.mimeType || 'application/pdf';
      const name = doc.cloudinary?.originalName || `${doc.section || 'profile'}_${doc.documentType || 'doc'}.pdf`;
      const size = Number(doc.cloudinary?.size) || (50 * 1024);
      const cat = determineCategory(mime, name);
      usedBytes += size;
      profileBytes += size;
      totalCount += 1;
      if (categoryBreakdown[cat] !== undefined) {
        categoryBreakdown[cat] += size;
      } else {
        categoryBreakdown.other += size;
      }
    }

    // 3. Process Resumes
    for (const r of resumes) {
      const contentBytes = Buffer.byteLength(JSON.stringify(r.content || {}), 'utf8');
      const settingsBytes = Buffer.byteLength(JSON.stringify(r.settings || {}), 'utf8');
      const size = contentBytes + settingsBytes + 15360; // ~15KB baseline representation for structured PDF/JSON resume
      usedBytes += size;
      resumeBytes += size;
      totalCount += 1;
      categoryBreakdown.pdf += size;
    }

    const remainingBytes = Math.max(0, TOTAL_LIMIT_BYTES - usedBytes);
    const usedPercentage = Number(((usedBytes / TOTAL_LIMIT_BYTES) * 100).toFixed(1));

    return {
      totalLimitBytes: TOTAL_LIMIT_BYTES,
      usedBytes,
      remainingBytes,
      usedPercentage,
      fileCount: totalCount,
      categoryBreakdown,
      sourcesBreakdown: {
        drive: driveBytes,
        profile: profileBytes,
        resume: resumeBytes,
      },
    };
  }

  /**
   * GET /api/drive - Get user files with search, filter & unified storage stats
   */
  public static getDriveFiles = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.user?.userId || (req.user as any)?.id;
      if (!userId) {
        throw AppError.unauthorized('User not authenticated');
      }

      const userObjectId = new mongoose.Types.ObjectId(userId);
      const { search, category, starred, source, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

      // 1. Fetch from DriveFileModel, VerificationDocumentModel, and ResumeModel in parallel
      const [rawDriveFiles, rawProfileDocs, rawResumes] = await Promise.all([
        DriveFileModel.find({ userId: userObjectId }).lean(),
        VerificationDocumentModel.find({ userId: userObjectId }).lean(),
        ResumeModel.find({ userId: userObjectId }).lean(),
      ]);

      // Map Drive files
      const driveList: IUnifiedDriveFile[] = rawDriveFiles.map((f) => ({
        _id: f._id.toString(),
        userId: f.userId.toString(),
        originalName: f.originalName,
        mimeType: f.mimeType,
        size: Number(f.size) || 0,
        category: f.category,
        cloudinary: f.cloudinary,
        starred: Boolean(f.starred),
        tags: Array.isArray(f.tags) ? f.tags : [],
        description: f.description || '',
        source: 'drive' as const,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      }));

      // Map Profile verification documents
      const profileList: IUnifiedDriveFile[] = rawProfileDocs.map((d) => {
        const mime = d.cloudinary?.mimeType || 'application/pdf';
        const name = d.cloudinary?.originalName || `${d.section || 'profile'}_${d.documentType || 'document'}.pdf`;
        const cat = determineCategory(mime, name);
        const url = d.cloudinary?.cloudinaryUrl || '';
        const secLabel = d.section ? d.section.charAt(0).toUpperCase() + d.section.slice(1) : 'Profile';
        const docLabel = (d.documentType || 'Document').replace(/_/g, ' ');

        return {
          _id: d._id.toString(),
          userId: d.userId.toString(),
          originalName: name,
          mimeType: mime,
          size: Number(d.cloudinary?.size) || (50 * 1024),
          category: cat,
          cloudinary: {
            publicId: d.cloudinary?.cloudinaryPublicId || '',
            url,
            secureUrl: url,
            format: mime.split('/')[1] || 'pdf',
            resourceType: mime.startsWith('image/') ? 'image' : 'raw',
          },
          starred: Boolean(d.starred),
          tags: ['Profile', secLabel, docLabel, `Status: ${d.verification?.status || 'pending'}`].filter(Boolean),
          description: d.ai?.summary || `Profile ${d.section} verification document (${docLabel})`,
          source: 'profile' as const,
          section: d.section,
          documentType: d.documentType,
          verificationStatus: d.verification?.status || 'pending',
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        };
      });

      // Map Resumes
      const resumeList: IUnifiedDriveFile[] = rawResumes.map((r) => {
        const contentBytes = Buffer.byteLength(JSON.stringify(r.content || {}), 'utf8');
        const settingsBytes = Buffer.byteLength(JSON.stringify(r.settings || {}), 'utf8');
        const size = contentBytes + settingsBytes + 15360;
        const name = `${r.title || 'Untitled Resume'}.pdf`;

        return {
          _id: r._id.toString(),
          userId: r.userId.toString(),
          originalName: name,
          mimeType: 'application/pdf',
          size,
          category: 'pdf' as DriveCategory,
          cloudinary: {
            publicId: `resume_${r._id}`,
            url: `/builder?resumeId=${r._id}`,
            secureUrl: `/builder?resumeId=${r._id}`,
            format: 'pdf',
            resourceType: 'raw',
          },
          starred: Boolean(r.starred),
          tags: ['Resume', r.templateId || 'modern', `ATS: ${r.atsScore || 0}%`].filter(Boolean),
          description: `AI Resume - Template: ${r.templateId || 'modern'}, ATS Score: ${r.atsScore || 0}%`,
          source: 'resume' as const,
          resumeId: r._id.toString(),
          atsScore: r.atsScore || 0,
          templateId: r.templateId,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        };
      });

      let allFiles: IUnifiedDriveFile[] = [...driveList, ...profileList, ...resumeList];

      // Filter by source
      if (source && source !== 'all') {
        allFiles = allFiles.filter((f) => f.source === source);
      }

      // Filter by category or pseudo-categories
      if (category && category !== 'all') {
        if (category === 'starred') {
          allFiles = allFiles.filter((f) => f.starred);
        } else if (category === 'profile') {
          allFiles = allFiles.filter((f) => f.source === 'profile');
        } else if (category === 'resume') {
          allFiles = allFiles.filter((f) => f.source === 'resume');
        } else {
          allFiles = allFiles.filter((f) => f.category === category);
        }
      }

      // Filter starred
      if (starred === 'true') {
        allFiles = allFiles.filter((f) => f.starred);
      }

      // Search across name, tags, description, section, documentType
      if (search && typeof search === 'string' && search.trim()) {
        const s = search.toLowerCase().trim();
        allFiles = allFiles.filter(
          (f) =>
            f.originalName.toLowerCase().includes(s) ||
            f.description.toLowerCase().includes(s) ||
            f.tags.some((t) => t.toLowerCase().includes(s)) ||
            (f.section && f.section.toLowerCase().includes(s)) ||
            (f.documentType && f.documentType.toLowerCase().includes(s))
        );
      }

      // Sorting
      const order = sortOrder === 'asc' ? 1 : -1;
      allFiles.sort((a, b) => {
        if (sortBy === 'name') {
          return a.originalName.localeCompare(b.originalName) * order;
        } else if (sortBy === 'size') {
          return (a.size - b.size) * order;
        } else {
          return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * order;
        }
      });

      const stats = await DriveController.getUserStorageUsage(userId);

      res.status(200).json({
        success: true,
        data: {
          files: allFiles,
          stats,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/drive/stats - Get user storage stats only
   */
  public static getStorageStats = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.user?.userId || (req.user as any)?.id;
      if (!userId) {
        throw AppError.unauthorized('User not authenticated');
      }

      const stats = await DriveController.getUserStorageUsage(userId);
      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/drive/upload - Upload file to Cloudinary & store DB record
   */
  public static uploadFile = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.user?.userId || (req.user as any)?.id;
      if (!userId) {
        throw AppError.unauthorized('User not authenticated');
      }

      const file = req.file;
      if (!file) {
        throw AppError.badRequest('No file provided for upload');
      }

      // Check current storage quota across all sources
      const stats = await DriveController.getUserStorageUsage(userId);
      if (stats.usedBytes + file.size > TOTAL_LIMIT_BYTES) {
        const remainingMb = (stats.remainingBytes / (1024 * 1024)).toFixed(2);
        const fileMb = (file.size / (1024 * 1024)).toFixed(2);
        throw AppError.badRequest(
          `Storage quota exceeded! File is ${fileMb} MB, but you only have ${remainingMb} MB remaining of your 50 MB Cloud Drive quota.`
        );
      }

      // Upload to Cloudinary using CloudinaryService
      const folderPath = `resumebuildai/drive/${userId}`;
      const uploadResult = await CloudinaryService.uploadFileBuffer(
        file.buffer,
        file.originalname,
        file.mimetype,
        folderPath
      );

      const category = determineCategory(file.mimetype, file.originalname);

      // Create drive file document
      const newFile = await DriveFileModel.create({
        userId: new mongoose.Types.ObjectId(userId),
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        category,
        cloudinary: {
          publicId: uploadResult.publicId,
          url: uploadResult.url,
          secureUrl: uploadResult.secureUrl,
          format: uploadResult.format,
          resourceType: uploadResult.resourceType,
        },
        starred: false,
        tags: [],
        description: '',
        extractedTextStatus: category === 'pdf' || category === 'document' ? 'pending' : undefined,
      });

      if (category === 'pdf' || category === 'document') {
        extractAndStoreDriveFileText(newFile._id.toString(), file.buffer, file.mimetype, file.originalname).catch(
          (err) => console.warn(`[DriveController] Background text extraction warning for ${newFile._id}:`, err?.message)
        );
      }

      const updatedStats = await DriveController.getUserStorageUsage(userId);

      res.status(201).json({
        success: true,
        message: 'File uploaded successfully to LetGetIn Drive',
        data: {
          file: newFile,
          stats: updatedStats,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * DELETE /api/drive/:id - Delete file from Cloudinary and DB (handles Drive, Profile docs, Resumes)
   */
  public static deleteFile = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.user?.userId || (req.user as any)?.id;
      if (!userId) {
        throw AppError.unauthorized('User not authenticated');
      }

      const { id } = req.params;
      const userObjectId = new mongoose.Types.ObjectId(userId);

      // 1. Check DriveFileModel
      const driveFile = await DriveFileModel.findOne({
        _id: id,
        userId: userObjectId,
      });

      if (driveFile) {
        if (driveFile.cloudinary?.publicId) {
          await CloudinaryService.deleteFile(
            driveFile.cloudinary.publicId,
            driveFile.cloudinary.resourceType
          );
        }
        await driveFile.deleteOne();
      } else {
        // 2. Check VerificationDocumentModel
        const profileDoc = await VerificationDocumentModel.findOne({
          _id: id,
          userId: userObjectId,
        });

        if (profileDoc) {
          if (profileDoc.cloudinary?.cloudinaryPublicId) {
            await CloudinaryService.deleteFile(profileDoc.cloudinary.cloudinaryPublicId);
          }
          await profileDoc.deleteOne();
        } else {
          // 3. Check ResumeModel
          const resume = await ResumeModel.findOne({
            _id: id,
            userId: userObjectId,
          });

          if (resume) {
            await resume.deleteOne();
          } else {
            throw AppError.notFound('Drive file or document not found or unauthorized');
          }
        }
      }

      const updatedStats = await DriveController.getUserStorageUsage(userId);

      res.status(200).json({
        success: true,
        message: 'File deleted successfully',
        data: {
          deletedId: id,
          stats: updatedStats,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /api/drive/:id/star - Toggle star status (handles Drive, Profile docs, Resumes)
   */
  public static toggleStar = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.user?.userId || (req.user as any)?.id;
      if (!userId) {
        throw AppError.unauthorized('User not authenticated');
      }

      const { id } = req.params;
      const userObjectId = new mongoose.Types.ObjectId(userId);
      let starredStatus = false;

      const driveFile = await DriveFileModel.findOne({ _id: id, userId: userObjectId });
      if (driveFile) {
        driveFile.starred = !driveFile.starred;
        await driveFile.save();
        starredStatus = driveFile.starred;
      } else {
        const profileDoc = await VerificationDocumentModel.findOne({ _id: id, userId: userObjectId });
        if (profileDoc) {
          profileDoc.starred = !profileDoc.starred;
          await profileDoc.save();
          starredStatus = Boolean(profileDoc.starred);
        } else {
          const resume = await ResumeModel.findOne({ _id: id, userId: userObjectId });
          if (resume) {
            resume.starred = !resume.starred;
            await resume.save();
            starredStatus = Boolean(resume.starred);
          } else {
            throw AppError.notFound('File not found');
          }
        }
      }

      res.status(200).json({
        success: true,
        message: starredStatus ? 'File starred' : 'File unstarred',
        data: { _id: id, starred: starredStatus },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /api/drive/:id - Update file details (handles Drive, Profile docs, Resumes)
   */
  public static updateFile = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.user?.userId || (req.user as any)?.id;
      if (!userId) {
        throw AppError.unauthorized('User not authenticated');
      }

      const { id } = req.params;
      const { originalName, description, tags } = req.body;
      const userObjectId = new mongoose.Types.ObjectId(userId);

      const driveFile = await DriveFileModel.findOne({ _id: id, userId: userObjectId });
      if (driveFile) {
        if (originalName && typeof originalName === 'string') {
          driveFile.originalName = originalName.trim();
        }
        if (description !== undefined && typeof description === 'string') {
          driveFile.description = description.trim();
        }
        if (Array.isArray(tags)) {
          driveFile.tags = tags.map((t) => String(t).trim()).filter(Boolean);
        }
        await driveFile.save();
        res.status(200).json({ success: true, message: 'File details updated', data: driveFile });
        return;
      }

      const profileDoc = await VerificationDocumentModel.findOne({ _id: id, userId: userObjectId });
      if (profileDoc) {
        if (originalName && typeof originalName === 'string') {
          profileDoc.cloudinary.originalName = originalName.trim();
        }
        if (description !== undefined && typeof description === 'string') {
          profileDoc.ai.summary = description.trim();
        }
        await profileDoc.save();
        res.status(200).json({ success: true, message: 'Document details updated', data: profileDoc });
        return;
      }

      const resume = await ResumeModel.findOne({ _id: id, userId: userObjectId });
      if (resume) {
        if (originalName && typeof originalName === 'string') {
          resume.title = originalName.replace(/\.pdf$/i, '').trim();
        }
        await resume.save();
        res.status(200).json({ success: true, message: 'Resume details updated', data: resume });
        return;
      }

      throw AppError.notFound('File not found');
    } catch (error) {
      next(error);
    }
  };
}
