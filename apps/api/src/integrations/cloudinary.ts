import { v2 as cloudinary } from 'cloudinary';
import type { Config } from '../config.js';
import { AppError } from '../middleware/errors.js';
export type EvidenceStore = {
  upload(publicId: string, image: Buffer): Promise<{ publicId: string; assetId?: string }>;
  read(publicId: string): Promise<Response>;
  remove(publicId: string): Promise<void>;
};
export function cloudinaryEvidence(config: Config): EvidenceStore {
  function setup() {
    if (!config.CLOUDINARY_URL && !config.CLOUDINARY_CLOUD_NAME)
      throw new AppError(503, 'Evidence storage is not configured.');
    if (config.CLOUDINARY_URL) {
      const address = new URL(config.CLOUDINARY_URL);
      cloudinary.config({
        cloud_name: address.hostname,
        api_key: decodeURIComponent(address.username),
        api_secret: decodeURIComponent(address.password),
        secure: true,
      });
    } else {
      cloudinary.config({
        cloud_name: config.CLOUDINARY_CLOUD_NAME,
        api_key: config.CLOUDINARY_API_KEY,
        api_secret: config.CLOUDINARY_API_SECRET,
        secure: true,
      });
    }
  }
  return {
    upload(publicId, image) {
      setup();
      return new Promise((resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            {
              public_id: publicId,
              resource_type: 'image',
              type: 'authenticated',
              overwrite: false,
              timeout: 20_000,
            },
            (error, result) => {
              if (
                error ||
                !result ||
                result.public_id !== publicId ||
                result.type !== 'authenticated' ||
                result.format !== 'jpg' ||
                result.bytes !== image.length
              ) {
                reject(
                  new AppError(
                    503,
                    'Evidence storage could not confirm the upload. Retry the same capture.',
                  ),
                );
              } else resolve({ publicId: result.public_id, assetId: result.asset_id });
            },
          )
          .end(image);
      });
    },
    async read(publicId) {
      setup();
      try {
        const signed = cloudinary.utils.private_download_url(publicId, 'jpg', {
          resource_type: 'image',
          type: 'authenticated',
          expires_at: Math.floor(Date.now() / 1000) + 60,
        });
        const response = await fetch(signed, { signal: AbortSignal.timeout(15000) });
        if (response.ok && response.body) return response;
      } catch {
        /* Map provider errors to a safe application error. */
      }
      throw new AppError(503, 'The stored evidence is temporarily unavailable.');
    },
    async remove(publicId) {
      setup();
      try {
        const result = await cloudinary.uploader.destroy(publicId, {
          type: 'authenticated',
          resource_type: 'image',
          invalidate: true,
        });
        if (result.result === 'ok' || result.result === 'not found') return;
      } catch {
        /* Keep the cleanup claim for retry. */
      }
      throw new AppError(503, 'Evidence cleanup is pending.');
    },
  };
}
