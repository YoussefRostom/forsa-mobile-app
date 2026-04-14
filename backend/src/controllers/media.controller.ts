import { v2 as cloudinary } from 'cloudinary';
import { Request, Response } from 'express';
import { db } from '../config/firebase';
import { sendError, sendSuccess } from '../utils/response.util';

// Configure Cloudinary (uses env: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Upload limits
const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB
const MAX_VIDEO_DURATION_SEC = 600; // 10 minutes
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_VIDEOS_PER_POST = 5;
const MAX_IMAGES_PER_POST = 10;

/**
 * Generate a signed upload URL for Cloudinary
 * This allows secure, scalable uploads with backend validation
 */
export async function getSignedUploadUrl(req: Request, res: Response): Promise<void> {
  try {
    const firebaseUser = (req as any).firebaseUser;
    if (!firebaseUser?.uid) {
      sendError(res, 'UNAUTHORIZED', 'Authentication required', null, 401);
      return;
    }

    const { resourceType, folder, publicId } = req.body;

    if (!resourceType || !['image', 'video'].includes(resourceType)) {
      sendError(res, 'BAD_REQUEST', 'resourceType must be "image" or "video"', null, 400);
      return;
    }

    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      sendError(res, 'SERVICE_UNAVAILABLE', 'Cloudinary not configured', null, 503);
      return;
    }

    // Generate timestamp for signature
    const timestamp = Math.round(new Date().getTime() / 1000);

    // Build upload parameters
    const uploadParams: Record<string, any> = {
      timestamp,
      folder: folder || 'forsa/media',
    };

    // Add public_id if provided (for overwriting)
    if (publicId) {
      uploadParams.public_id = publicId;
    }

    // Generate signature
    const signature = cloudinary.utils.api_sign_request(
      uploadParams,
      process.env.CLOUDINARY_API_SECRET
    );

    // Return signed upload parameters
    sendSuccess(res, {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      timestamp,
      signature,
      folder: uploadParams.folder,
      resourceType,
      uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`,
    }, 'Signed upload URL generated');
  } catch (error: any) {
    console.error('Signed URL generation error:', error);
    sendError(res, 'INTERNAL_ERROR', error.message || 'Failed to generate signed URL', null, 500);
  }
}

/**
 * Validate file size before upload
 */
export async function validateFileSize(req: Request, res: Response): Promise<void> {
  try {
    const firebaseUser = (req as any).firebaseUser;
    if (!firebaseUser?.uid) {
      sendError(res, 'UNAUTHORIZED', 'Authentication required', null, 401);
      return;
    }

    const { size, resourceType, durationSec } = req.body;

    if (!size || typeof size !== 'number') {
      sendError(res, 'BAD_REQUEST', 'File size is required', null, 400);
      return;
    }

    if (!resourceType || !['image', 'video'].includes(resourceType)) {
      sendError(res, 'BAD_REQUEST', 'resourceType must be "image" or "video"', null, 400);
      return;
    }

    const maxSize = resourceType === 'video' ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
    const maxSizeMB = resourceType === 'video' ? 500 : 10;

    if (resourceType === 'video' && typeof durationSec === 'number' && durationSec > MAX_VIDEO_DURATION_SEC) {
      sendError(
        res,
        'VIDEO_TOO_LONG',
        `Video duration exceeds maximum allowed length of ${MAX_VIDEO_DURATION_SEC} seconds`,
        { maxDurationSec: MAX_VIDEO_DURATION_SEC, actualDurationSec: durationSec },
        400
      );
      return;
    }

    if (size > maxSize) {
      sendError(
        res,
        'FILE_TOO_LARGE',
        `File size exceeds maximum allowed size of ${maxSizeMB}MB`,
        { maxSize, actualSize: size },
        400
      );
      return;
    }

    sendSuccess(res, {
      valid: true,
      size,
      maxSize,
      ...(resourceType === 'video' ? { maxDurationSec: MAX_VIDEO_DURATION_SEC } : {}),
    }, 'File size is valid');
  } catch (error: any) {
    console.error('File size validation error:', error);
    sendError(res, 'INTERNAL_ERROR', error.message || 'Failed to validate file size', null, 500);
  }
}

/**
 * Get streamable playback URL with Cloudinary transformations
 */
export async function getPlaybackUrl(req: Request, res: Response): Promise<void> {
  try {
    const firebaseUser = (req as any).firebaseUser;
    if (!firebaseUser?.uid) {
      sendError(res, 'UNAUTHORIZED', 'Authentication required', null, 401);
      return;
    }

    const { publicId, resourceType, transformations } = req.body;

    if (!publicId || !resourceType) {
      sendError(res, 'BAD_REQUEST', 'publicId and resourceType are required', null, 400);
      return;
    }

    if (!['image', 'video'].includes(resourceType)) {
      sendError(res, 'BAD_REQUEST', 'resourceType must be "image" or "video"', null, 400);
      return;
    }

    // Build transformation options
    const transformOptions: Record<string, any> = {
      resource_type: resourceType,
      secure: true,
    };

    // Add custom transformations if provided
    if (transformations && typeof transformations === 'object') {
      Object.assign(transformOptions, transformations);
    } else if (resourceType === 'video') {
      // Default video transformations for streaming
      transformOptions.quality = 'auto';
      transformOptions.fetch_format = 'auto';
    }

    // Generate URL with transformations
    const url = cloudinary.url(publicId, transformOptions);

    sendSuccess(res, { playbackUrl: url, publicId, resourceType }, 'Playback URL generated');
  } catch (error: any) {
    console.error('Playback URL generation error:', error);
    sendError(res, 'INTERNAL_ERROR', error.message || 'Failed to generate playback URL', null, 500);
  }
}

/**
 * Delete media from Cloudinary by public_id.
 * Requires Firebase token + user must be admin or owner.
 */
export async function deleteMedia(req: Request, res: Response): Promise<void> {
  try {
    const firebaseUser = (req as any).firebaseUser;
    if (!firebaseUser?.uid) {
      sendError(res, 'UNAUTHORIZED', 'Authentication required', null, 401);
      return;
    }

    const { publicId, resourceType, mediaId } = req.body;
    if (!publicId || typeof publicId !== 'string') {
      sendError(res, 'BAD_REQUEST', 'publicId is required', null, 400);
      return;
    }

    // Check if user is admin or owner
    const userDoc = await db.collection('users').doc(firebaseUser.uid).get();
    if (!userDoc.exists) {
      sendError(res, 'UNAUTHORIZED', 'User not found', null, 401);
      return;
    }

    const userData = userDoc.data();
    const role = (userData?.role || '').toLowerCase();
    const isAdmin = role === 'admin';

    // If not admin, check if user owns the media
    if (!isAdmin && mediaId) {
      const mediaDoc = await db.collection('media').doc(mediaId).get();
      if (!mediaDoc.exists) {
        sendError(res, 'NOT_FOUND', 'Media not found', null, 404);
        return;
      }
      const mediaData = mediaDoc.data();
      if (mediaData?.ownerId !== firebaseUser.uid) {
        sendError(res, 'FORBIDDEN', 'You can only delete your own media', null, 403);
        return;
      }
    }

    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      sendError(res, 'SERVICE_UNAVAILABLE', 'Cloudinary not configured for delete', null, 503);
      return;
    }

    // Determine resource type from public_id or default to image
    const resType = (resourceType as string) || 'image';

    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resType === 'video' ? 'video' : 'image',
    });

    if (result.result === 'not found') {
      res.status(200).json({ success: true, message: 'Already deleted or not found' });
      return;
    }

    // If mediaId provided, also delete from Firestore
    if (mediaId) {
      try {
        await db.collection('media').doc(mediaId).delete();
      } catch (firestoreError) {
        console.warn('Failed to delete media from Firestore:', firestoreError);
        // Continue even if Firestore delete fails
      }
    }

    res.status(200).json({ success: true, result: result.result });
  } catch (error: any) {
    console.error('Media delete error:', error);
    sendError(res, 'INTERNAL_ERROR', error.message || 'Failed to delete media', null, 500);
  }
}

/**
 * Get upload limits configuration
 */
export async function getUploadLimits(req: Request, res: Response): Promise<void> {
  try {
    sendSuccess(res, {
      video: {
        maxSizeBytes: MAX_VIDEO_SIZE,
        maxSizeMB: 500,
        maxDurationSec: MAX_VIDEO_DURATION_SEC,
        maxPerPost: MAX_VIDEOS_PER_POST,
      },
      image: {
        maxSizeBytes: MAX_IMAGE_SIZE,
        maxSizeMB: 10,
        maxPerPost: MAX_IMAGES_PER_POST,
      },
      rateLimit: {
        maxUploadsPerHour: 10,
      },
    }, 'Upload limits retrieved');
  } catch (error: any) {
    console.error('Get upload limits error:', error);
    sendError(res, 'INTERNAL_ERROR', error.message || 'Failed to get upload limits', null, 500);
  }
}
