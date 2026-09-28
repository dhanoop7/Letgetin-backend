import { Request, Response, NextFunction } from 'express';
import { VerificationDocumentModel, SectionType, VerificationStatus } from './verification.model.js';
import { DriveController } from '../drive/drive.controller.js';
import { CloudinaryService } from '../../services/cloudinary.service.js';
import { DocumentParserService } from '../../services/documentParser.service.js';
import { GeminiVerificationService } from '../../services/geminiVerification.service.js';
import { AppError } from '../../utils/appError.js';

function normalizeCloudinaryUrl(url: string, mimeType: string = '', originalName: string = ''): string {
  if (!url || typeof url !== 'string') return url;
  if (!url.includes('cloudinary.com')) return url;

  if (url.includes('/raw/upload/')) {
    return url.replace('/raw/upload/', '/image/upload/fl_inline/');
  }
  return url;
}

export class VerificationController {
  /**
   * GET /api/profile/verifications
   * List all verification documents and summary stats for current user (or query userId for admin)
   */
  static async getVerifications(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req.query.userId as string) || req.user?.userId;
      if (!userId) {
        throw AppError.unauthorized('User ID required');
      }

      const rawDocs = await VerificationDocumentModel.find({ userId }).sort({ createdAt: -1 });

      const docs = rawDocs.map((d) => {
        const docObj = d.toObject();
        if (docObj.cloudinary?.cloudinaryUrl) {
          docObj.cloudinary.cloudinaryUrl = normalizeCloudinaryUrl(
            docObj.cloudinary.cloudinaryUrl,
            docObj.cloudinary.mimeType,
            docObj.cloudinary.originalName
          );
        }
        return docObj;
      });

      const sections: SectionType[] = ['personal', 'contacts', 'education', 'experience', 'skills'];
      const sectionStatusMap: Record<SectionType, { status: VerificationStatus; documentsCount: number; lastUploadedAt?: Date }> = {
        personal: { status: 'unsubmitted', documentsCount: 0 },
        contacts: { status: 'unsubmitted', documentsCount: 0 },
        education: { status: 'unsubmitted', documentsCount: 0 },
        experience: { status: 'unsubmitted', documentsCount: 0 },
        skills: { status: 'unsubmitted', documentsCount: 0 },
      };

      sections.forEach((sec) => {
        const secDocs = docs.filter((d) => d.section === sec);
        const count = secDocs.length;
        if (count === 0) {
          sectionStatusMap[sec] = { status: 'unsubmitted', documentsCount: 0 };
          return;
        }

        const latestUploadedAt = secDocs[0]?.cloudinary?.uploadedAt;
        const hasPending = secDocs.some((d) => d.verification.status === 'pending');
        const latestDoc = secDocs[0];

        let finalSectionStatus: VerificationStatus = 'unsubmitted';

        if (hasPending) {
          finalSectionStatus = 'pending';
        } else if (latestDoc && latestDoc.verification.status === 'verified') {
          finalSectionStatus = 'verified';
        } else if (latestDoc && latestDoc.verification.status === 'rejected') {
          const hasVerified = secDocs.some((d) => d.verification.status === 'verified');
          finalSectionStatus = hasVerified ? 'verified' : 'rejected';
        } else {
          finalSectionStatus = latestDoc ? latestDoc.verification.status : 'unsubmitted';
        }

        sectionStatusMap[sec] = {
          status: finalSectionStatus,
          documentsCount: count,
          lastUploadedAt: latestUploadedAt,
        };
      });

      const verifiedCount = sections.filter((s) => sectionStatusMap[s].status === 'verified').length;
      const pendingCount = sections.filter((s) => sectionStatusMap[s].status === 'pending').length;
      const rejectedCount = docs.filter((d) => d.verification.status === 'rejected').length;
      const verificationPercent = Math.round((verifiedCount / sections.length) * 100);

      const timeline = docs.map((doc) => ({
        id: doc._id,
        section: doc.section,
        documentType: doc.documentType,
        originalName: doc.cloudinary.originalName,
        status: doc.verification.status,
        timestamp: doc.createdAt,
        summary: doc.ai.summary,
      }));

      res.status(200).json({
        success: true,
        data: {
          documents: docs,
          sections: sectionStatusMap,
          stats: {
            verificationPercent,
            verifiedCount,
            pendingCount,
            rejectedCount,
            totalDocuments: docs.length,
          },
          timeline,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/profile/verifications/:id
   * Fetch a single verification document by ID
   */
  static async getVerificationById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req.query.userId as string) || req.user?.userId;
      const docId = req.params.id;

      if (!userId) {
        throw AppError.unauthorized('User ID required');
      }

      const doc = await VerificationDocumentModel.findOne({ _id: docId, userId });
      if (!doc) {
        throw AppError.notFound('Verification document not found');
      }

      const docObj = doc.toObject();
      if (docObj.cloudinary?.cloudinaryUrl) {
        docObj.cloudinary.cloudinaryUrl = normalizeCloudinaryUrl(
          docObj.cloudinary.cloudinaryUrl,
          docObj.cloudinary.mimeType,
          docObj.cloudinary.originalName
        );
      }

      res.status(200).json({
        success: true,
        data: docObj,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/profile/verifications/upload
   * Upload supporting verification document & trigger async AI verification pipeline
   */
  static async uploadDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      console.time('UPLOAD_REQUEST');

      const userId = req.user?.userId;
      if (!userId) {
        throw AppError.unauthorized('Authentication required');
      }

      if (!req.file) {
        throw AppError.badRequest('No document file uploaded');
      }

      const { section, documentType, profileContext } = req.body;

      const validSections: SectionType[] = ['personal', 'contacts', 'education', 'experience', 'skills'];
      if (!section || !validSections.includes(section as SectionType)) {
        throw AppError.badRequest(`Invalid section. Must be one of: ${validSections.join(', ')}`);
      }

      // Security Check: Allowed mime types
      const allowedMimes = [
        'application/pdf',
        'image/png',
        'image/jpeg',
        'image/jpg',
        'image/webp',
        'image/heic',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
      ];

      if (!allowedMimes.includes(req.file.mimetype)) {
        throw AppError.badRequest('Invalid file type. Supported formats: PDF, PNG, JPG, WEBP, DOCX');
      }

      const parsedProfile = profileContext ? JSON.parse(profileContext) : {};

      // Check current Cloud Drive storage quota
      const stats = await DriveController.getUserStorageUsage(userId);
      const TOTAL_LIMIT_BYTES = 50 * 1024 * 1024;
      if (stats.usedBytes + req.file.size > TOTAL_LIMIT_BYTES) {
        const remainingMb = (stats.remainingBytes / (1024 * 1024)).toFixed(2);
        const fileMb = (req.file.size / (1024 * 1024)).toFixed(2);
        throw AppError.badRequest(
          `Cloud Drive storage quota exceeded! File is ${fileMb} MB, but you only have ${remainingMb} MB remaining of your 50 MB quota. Please free up space in your Cloud Drive.`
        );
      }

      // 1. Fast step: Upload to Cloudinary storage
      const cloudResult = await CloudinaryService.uploadFileBuffer(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
      console.log('✅ Step 1: Cloudinary upload complete');

      // 2. Create MongoDB document record immediately with status 'pending'
      const doc = await VerificationDocumentModel.create({
        userId,
        section,
        documentType: documentType || 'other',
        cloudinary: {
          originalName: req.file.originalname,
          cloudinaryPublicId: cloudResult.publicId,
          cloudinaryUrl: cloudResult.secureUrl,
          mimeType: req.file.mimetype,
          size: req.file.size,
          uploadedAt: new Date(),
        },
        verification: {
          status: 'pending',
          confidence: 0,
          reason: undefined,
        },
        ai: {
          summary: 'Document uploaded successfully. Gemini AI is analyzing and verifying details...',
          issues: [],
          extractedFields: {},
        },
      });

      console.log(`✅ Step 2: Saved initial document record (${doc._id}) with status 'pending'`);

      // 3. Respond immediately to client to avoid HTTP timeouts
      res.status(201).json({
        success: true,
        message: 'Document uploaded successfully. Verification is processing in background.',
        data: doc,
      });

      console.timeEnd('UPLOAD_REQUEST');

      // 4. Run background AI processing pipeline asynchronously
      const fileBuffer = req.file.buffer;
      const fileMimeType = req.file.mimetype;
      const docId = doc._id;
      const secType = section as SectionType;
      const docTypeParam = documentType || 'other';

      (async () => {
        try {
          console.log(`[AI Background Job] Starting text extraction & Gemini AI for doc: ${docId}`);

          // Extract text
          const extractionResult = await DocumentParserService.extractText(fileBuffer, fileMimeType);
          console.log(`[AI Background Job] Text extraction complete (length: ${extractionResult.text.length})`);

          // Run Gemini AI Verification
          const aiResult = await GeminiVerificationService.verifyDocument(
            fileBuffer,
            fileMimeType,
            extractionResult.text,
            extractionResult.isImageOrScanned,
            secType,
            docTypeParam,
            parsedProfile
          );

          console.log(`[AI Background Job] Gemini AI verification complete. Outcome: ${aiResult.verificationSuggestion}`);

          // Update MongoDB record with final status and AI metadata
          await VerificationDocumentModel.findByIdAndUpdate(docId, {
            documentType: aiResult.documentType || docTypeParam,
            'verification.status': aiResult.verificationSuggestion,
            'verification.confidence': aiResult.confidence,
            'verification.reason': aiResult.issues.length > 0 ? aiResult.issues.join('; ') : undefined,
            'ai.summary': aiResult.summary,
            'ai.issues': aiResult.issues,
            'ai.extractedFields': aiResult.extractedFields,
          });

          console.log(`[AI Background Job] Successfully updated document ${docId} to ${aiResult.verificationSuggestion}`);
        } catch (bgErr: any) {
          console.error(`[AI Background Job Error] Processing failed for doc ${docId}:`, bgErr);

          await VerificationDocumentModel.findByIdAndUpdate(docId, {
            'verification.status': 'rejected',
            'verification.confidence': 0,
            'verification.reason': bgErr?.message || 'Verification pipeline encountered an internal error.',
            'ai.summary': 'Document processing encountered an error during AI analysis.',
            'ai.issues': [bgErr?.message || 'Failed to analyze document with AI.'],
          }).catch((dbErr) => {
            console.error(`Failed to record error state for doc ${docId}:`, dbErr);
          });
        }
      })();
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/profile/verifications/:id
   * Delete a verification document
   */
  static async deleteDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.userId;
      const docId = req.params.id;

      const doc = await VerificationDocumentModel.findOne({ _id: docId, userId });
      if (!doc) {
        throw AppError.notFound('Verification document not found');
      }

      // Remove from Cloudinary
      await CloudinaryService.deleteFile(doc.cloudinary.cloudinaryPublicId);

      // Remove from MongoDB
      await doc.deleteOne();

      res.status(200).json({
        success: true,
        message: 'Verification document deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/profile/verifications/:id/status
   * Admin / manual override endpoint to update verification status
   */
  static async updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const docId = req.params.id;
      const { status, reason, reviewedBy } = req.body;

      const validStatuses: VerificationStatus[] = ['verified', 'pending', 'rejected', 'unsubmitted'];
      if (!status || !validStatuses.includes(status)) {
        throw AppError.badRequest('Invalid status');
      }

      const doc = await VerificationDocumentModel.findById(docId);
      if (!doc) {
        throw AppError.notFound('Verification document not found');
      }

      doc.verification.status = status;
      if (reason) doc.verification.reason = reason;
      doc.verification.reviewedBy = reviewedBy || req.user?.userId || 'Admin';
      doc.verification.reviewedAt = new Date();

      await doc.save();

      res.status(200).json({
        success: true,
        message: 'Verification status updated successfully',
        data: doc,
      });
    } catch (error) {
      next(error);
    }
  }
}

