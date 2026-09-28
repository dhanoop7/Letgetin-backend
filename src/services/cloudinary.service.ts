import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';

let isCloudinaryConfigured = false;

if (env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
    console.log("Cloudinary Config:", cloudinary.config());
    (async () => {
    try {
      const res = await cloudinary.api.ping();
      console.log("PING SUCCESS:", res);
    } catch (err) {
      console.error("PING ERROR:");
      console.dir(err, { depth: null });
    }
  })();
  isCloudinaryConfigured = true;
}

export interface CloudinaryUploadResult {
  publicId: string;
  url: string;
  secureUrl: string;
  bytes: number;
  format: string;
  resourceType: string;
}

export class CloudinaryService {
  /**
   * Upload file buffer to Cloudinary or return secure data URI fallback
   */
  static async uploadFileBuffer(
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
    folder: string = 'resumebuildai/verifications'
  ): Promise<CloudinaryUploadResult> {
    if (isCloudinaryConfigured) {
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder,
            resource_type: "auto",
            public_id: `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9_.-]/g, "_")}`,
          },
          (error, result) => {
            if (error || !result) {
              return reject(error || new Error('Cloudinary upload failed'));
            }
            resolve({
              publicId: result.public_id,
              url: result.url,
              secureUrl: result.secure_url,
              bytes: result.bytes,
              format: result.format || mimeType.split('/')[1] || 'raw',
              resourceType: result.resource_type || (mimeType.startsWith('image/') ? 'image' : 'raw'),
            });
          }
        );
        uploadStream.end(fileBuffer);
      });
    }

    // Fallback data URI for local dev if Cloudinary credentials not configured yet
    const base64 = fileBuffer.toString('base64');
    const dataUri = `data:${mimeType};base64,${base64}`;
    const mockPublicId = `mock_cloud_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return {
      publicId: mockPublicId,
      url: dataUri,
      secureUrl: dataUri,
      bytes: fileBuffer.length,
      format: mimeType.split('/')[1] || 'bin',
      resourceType: mimeType.startsWith('image/') ? 'image' : 'raw',
    };
  }

  /**
   * Delete file from Cloudinary by public ID
   */
  static async deleteFile(publicId: string, resourceType?: string): Promise<boolean> {
    if (!isCloudinaryConfigured || publicId.startsWith('mock_cloud_')) {
      return true;
    }
    try {
      const res = await cloudinary.uploader.destroy(publicId, {
        resource_type: (resourceType as any) || 'image',
      });
      if (res && res.result !== 'ok' && res.result !== 'not found') {
        await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
      }
      return true;
    } catch (err) {
      console.warn('Cloudinary delete warning:', err);
      return false;
    }
  }
}
