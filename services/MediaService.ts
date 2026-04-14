import Constants from 'expo-constants';
import { auth, db } from '../lib/firebase';
import { collection, addDoc, serverTimestamp, doc, setDoc, query, where, orderBy, onSnapshot, Unsubscribe, getDoc, deleteDoc, updateDoc, getDocs } from 'firebase/firestore';
import { getCurrentUserRole, getVisibleToRoles, type Role } from './UserRoleService';

// Helper function to get environment variables with multiple fallbacks
function getEnvVar(key: string, fallbackKey?: string): string | undefined {
  // Try process.env first (works in Expo with EXPO_PUBLIC_ prefix)
  let value = process.env[key];
  if (value && value.trim()) return value.trim();
  
  // Try fallback key if provided
  if (fallbackKey) {
    value = process.env[fallbackKey];
    if (value && value.trim()) return value.trim();
  }
  
  // Try non-EXPO_PUBLIC_ version as fallback (for backwards compatibility)
  const nonExpoKey = key.replace('EXPO_PUBLIC_', '');
  value = process.env[nonExpoKey];
  if (value && value.trim()) return value.trim();
  
  // Try Constants.expoConfig.extra (for app.json configuration)
  const extraValue = Constants.expoConfig?.extra?.[key.replace('EXPO_PUBLIC_', '').toLowerCase()] ||
                    Constants.expoConfig?.extra?.[nonExpoKey.toLowerCase()] ||
                    (fallbackKey ? Constants.expoConfig?.extra?.[fallbackKey.replace('EXPO_PUBLIC_', '').toLowerCase()] : undefined);
  if (extraValue) return String(extraValue).trim();
  
  // Try Constants.manifest.extra (legacy - with type guard)
  const manifest = Constants.manifest as any;
  if (manifest?.extra) {
    const manifestValue = manifest.extra[key.replace('EXPO_PUBLIC_', '').toLowerCase()] ||
                          manifest.extra[nonExpoKey.toLowerCase()] ||
                          (fallbackKey ? manifest.extra[fallbackKey.replace('EXPO_PUBLIC_', '').toLowerCase()] : undefined);
    if (manifestValue) return String(manifestValue).trim();
  }
  
  return undefined;
}

// Types
export type ResourceType = 'image' | 'video';
export type Visibility = 'public' | 'private' | 'unlisted';

export interface CloudinaryResponse {
  public_id: string;
  asset_id?: string;
  secure_url: string;
  format?: string;
  bytes?: number;
  duration?: number;
  width?: number;
  height?: number;
  resource_type: string;
  [key: string]: any;
}

export interface MediaDoc {
  id: string;
  ownerId: string;
  resourceType: ResourceType;
  visibility: Visibility;
  cloudinaryPublicId: string;
  cloudinaryAssetId: string | null;
  secureUrl: string;
  playbackUrl: string;
  format: string | null;
  sizeBytes: number | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  createdAt: any;
  updatedAt: any;
  status: 'ready' | 'failed';
  error: string | null;
}

export interface TaggedUserMeta {
  id: string;
  name: string;
  role?: string;
}

/**
 * Upload media file directly to Cloudinary using unsigned upload preset
 * @param localUri - Local file URI from expo-image-picker
 * @param type - 'image' or 'video'
 * @returns Cloudinary response with metadata
 */
export async function uploadMedia(
  localUri: string,
  type: ResourceType,
  onProgress?: (progress: number) => void
): Promise<CloudinaryResponse> {
  // Get environment variables with multiple fallbacks
  const cloudName = getEnvVar('EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_CLOUD_NAME');
  const uploadPreset = getEnvVar('EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET');
  const folder = getEnvVar('EXPO_PUBLIC_CLOUDINARY_FOLDER', 'CLOUDINARY_UPLOAD_FOLDER') || 'forsa/media';



  // Check if credentials are missing or empty
  if (!cloudName || !cloudName.trim() || !uploadPreset || !uploadPreset.trim()) {
    console.error('Cloudinary credentials not found or empty. Checked:', {
      'process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME': process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME,
      'process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET': process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET,
      'getEnvVar result - cloudName': cloudName,
      'getEnvVar result - uploadPreset': uploadPreset,
      'Constants.expoConfig?.extra': Constants.expoConfig?.extra,
    });
    
    throw new Error(
      'Cloudinary credentials missing or empty.\n\n' +
      'Please add to your .env file in the project root:\n' +
      'EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME=your_actual_cloud_name\n' +
      'EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET=your_actual_upload_preset\n' +
      'EXPO_PUBLIC_CLOUDINARY_FOLDER=forsa/media (optional)\n\n' +
      'Then restart your Expo development server with: npm start -- --clear'
    );
  }

  // Trim whitespace
  const trimmedCloudName = cloudName.trim();
  const trimmedUploadPreset = uploadPreset.trim();

  // Check if placeholder values are still being used
  if (
    trimmedCloudName.includes('your_cloud_name') ||
    trimmedCloudName.includes('your_actual') ||
    trimmedCloudName.includes('placeholder') ||
    trimmedUploadPreset.includes('your_upload_preset') ||
    trimmedUploadPreset.includes('your_actual') ||
    trimmedUploadPreset.includes('placeholder')
  ) {
    throw new Error(
      'Cloudinary credentials are still using placeholder values.\n\n' +
      'Please replace the placeholder values in your .env file with your actual Cloudinary credentials:\n' +
      `Current cloudName: "${trimmedCloudName}"\n` +
      `Current uploadPreset: "${trimmedUploadPreset}"\n\n` +
      'Steps to fix:\n' +
      '1. Get your Cloudinary cloud name from https://console.cloudinary.com/\n' +
      '2. Create an unsigned upload preset in Cloudinary Settings > Upload\n' +
      '3. Update your .env file with the real values\n' +
      '4. Restart Expo server with: npm start -- --clear'
    );
  }

  // Choose endpoint based on resource type (use trimmed values)
  const endpoint = type === 'video' 
    ? `https://api.cloudinary.com/v1_1/${trimmedCloudName}/video/upload`
    : `https://api.cloudinary.com/v1_1/${trimmedCloudName}/image/upload`;

  // Create FormData
  const formData = new FormData();
  
  // Get file name from URI
  const filename = localUri.split('/').pop() || `media.${type === 'video' ? 'mp4' : 'jpg'}`;
  const match = /\.(\w+)$/.exec(filename);
  const extension = match?.[1]?.toLowerCase();
  const mimeType = extension
    ? `${type}/${extension === 'jpg' ? 'jpeg' : extension}`
    : (type === 'video' ? 'video/mp4' : 'image/jpeg');

  // Append file - React Native FormData expects { uri, type, name }
  formData.append('file', {
    uri: localUri,
    type: mimeType,
    name: filename,
  } as any);

  formData.append('upload_preset', trimmedUploadPreset);
  formData.append('folder', folder);

  try {
    const timeoutMs = type === 'video' ? 600000 : 90000;

    const data = await new Promise<CloudinaryResponse>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const timeoutId = setTimeout(() => {
        try {
          xhr.abort();
        } catch {
          // no-op
        }
      }, timeoutMs);

      xhr.open('POST', endpoint);
      xhr.responseType = 'text';

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          const progress = Math.min(100, Math.max(0, Math.round((event.loaded / event.total) * 100)));
          onProgress(progress);
        }
      };

      xhr.onload = () => {
        clearTimeout(timeoutId);

        try {
          const responseText = typeof xhr.response === 'string' ? xhr.response : xhr.responseText;
          const parsed: CloudinaryResponse = JSON.parse(responseText || '{}');

          if (xhr.status < 200 || xhr.status >= 300) {
            let errorMessage = `Cloudinary upload failed: ${xhr.status} - ${responseText}`;

            if (xhr.status === 401) {
              errorMessage += '\n\nThis usually means:\n' +
                '1. Your upload preset name is incorrect, OR\n' +
                '2. Your upload preset is not set to "Unsigned" mode, OR\n' +
                '3. Your cloud name is incorrect\n\n' +
                'Please verify your Cloudinary credentials in the .env file and ensure:\n' +
                '- The upload preset exists and is set to "Unsigned"\n' +
                '- The cloud name matches your Cloudinary account\n' +
                '- You have restarted the Expo server after updating .env';
            }

            reject(new Error(errorMessage));
            return;
          }

          if ((parsed as any)?.error) {
            reject(new Error(`Cloudinary error: ${(parsed as any).error.message || 'Unknown error'}`));
            return;
          }

          onProgress?.(100);
          resolve(parsed);
        } catch (parseError: any) {
          reject(new Error(parseError?.message || 'Failed to parse upload response'));
        }
      };

      xhr.onerror = () => {
        clearTimeout(timeoutId);
        reject(new Error('Failed to upload media to Cloudinary. Please check your connection and try again.'));
      };

      xhr.onabort = () => {
        clearTimeout(timeoutId);
        reject(new Error('Upload timed out. Please try a smaller file or a stronger connection.'));
      };

      onProgress?.(1);
      xhr.send(formData);
    });

    return data;
  } catch (error: any) {
    console.error('Upload error:', error);
    throw new Error(
      error.message || 'Failed to upload media to Cloudinary. Please check your connection and try again.'
    );
  }
}

/**
 * Save media metadata to Firestore /media collection
 * @param cloudinaryResponse - Response from Cloudinary upload
 * @param type - 'image' or 'video'
 * @param visibility - Visibility setting (default: 'public')
 * @returns Media document ID
 */
export async function saveMediaToFirestore(
  cloudinaryResponse: CloudinaryResponse,
  type: ResourceType,
  visibility: Visibility = 'public'
): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User must be authenticated to save media');
  }

  const mediaData: Omit<MediaDoc, 'id'> = {
    ownerId: user.uid,
    resourceType: type,
    visibility,
    cloudinaryPublicId: cloudinaryResponse.public_id,
    cloudinaryAssetId: cloudinaryResponse.asset_id || null,
    secureUrl: cloudinaryResponse.secure_url,
    playbackUrl: cloudinaryResponse.secure_url, // Will be updated with streamable URL if needed
    format: cloudinaryResponse.format || null,
    sizeBytes: cloudinaryResponse.bytes || null,
    durationSec: type === 'video' && cloudinaryResponse.duration ? cloudinaryResponse.duration : null,
    width: cloudinaryResponse.width || null,
    height: cloudinaryResponse.height || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    status: 'ready',
    error: null,
  };

  try {
    const docRef = await addDoc(collection(db, 'media'), mediaData);
    return docRef.id;
  } catch (error: any) {
    console.error('Error saving media to Firestore:', error);
    throw new Error(`Failed to save media metadata: ${error.message}`);
  }
}

/**
 * Helper function to get author name based on user role
 */
async function getAuthorName(ownerId: string, ownerRole: Role): Promise<string> {
  try {
    const userDoc = await getDoc(doc(db, 'users', ownerId));
    if (userDoc.exists()) {
      const d = userDoc.data();
      if (ownerRole === 'admin') {
        return d?.name || d?.adminName || 'Admin';
      }
      return d?.academyName || d?.agentName || d?.clinicName || d?.parentName || d?.name ||
        (d?.firstName && d?.lastName ? `${d.firstName} ${d.lastName}`.trim() : 'User');
    }
  } catch {
    // use default
  }
  return ownerRole === 'admin' ? 'Admin' : 'User';
}

/**
 * Create a feed item in /posts collection if feed uses posts
 * This links the media to the existing feed structure
 * @param mediaDoc - The media document data
 * @param content - Optional text/caption for the post (default: empty string)
 * @returns Post document ID if created, null otherwise
 */
export async function createFeedItemIfNeeded(
  mediaDoc: MediaDoc,
  content: string = '',
  taggedUsers: TaggedUserMeta[] = []
): Promise<string | null> {
  // Since feed reads from /posts, we'll create a post entry
  // that references the media
  try {
    // Check if user is suspended
    const { isUserSuspended } = await import('./ModerationService');
    const suspended = await isUserSuspended();
    if (suspended) {
      throw new Error('Your account has been suspended. You cannot create new posts.');
    }

    // Get the current user's role
    const ownerRole = await getCurrentUserRole();
    const visibleToRoles = getVisibleToRoles(ownerRole);

    const sanitizedTaggedUsers = taggedUsers
      .map((entry) => ({
        id: String(entry?.id || '').trim(),
        name: String(entry?.name || '').trim(),
        role: entry?.role ? String(entry.role).trim() : undefined,
      }))
      .filter((entry) => entry.id && entry.name)
      .slice(0, 5);

    const postData = {
      mediaId: mediaDoc.id,
      mediaUrl: mediaDoc.secureUrl,
      mediaType: mediaDoc.resourceType,
      ownerId: mediaDoc.ownerId,
      ownerRole: ownerRole,
      visibleToRoles: visibleToRoles,
      visibilityScope: 'role_based',
      status: 'active',
      visibility: mediaDoc.visibility || 'public',
      author: await getAuthorName(mediaDoc.ownerId, ownerRole), // Fetch user name based on role
      content: content || '', // Caption/text content for the post
      contentText: content || '',
      taggedUsers: sanitizedTaggedUsers,
      taggedUserIds: sanitizedTaggedUsers.map((entry) => entry.id),
      taggedUserNames: sanitizedTaggedUsers.map((entry) => entry.name),
      timestamp: serverTimestamp(),
      createdAt: serverTimestamp(),
    };

    const postRef = await addDoc(collection(db, 'posts'), postData);
    return postRef.id;
  } catch (error: any) {
    console.error('Error creating feed item:', error);
    // Re-throw suspension errors
    if (error.message && error.message.includes('suspended')) {
      throw error;
    }
    // Don't throw other errors - feed might work without this
    return null;
  }
}

/**
 * Subscribe to user's media uploads
 * @param uid - User ID
 * @param callback - Callback function that receives media documents array
 * @returns Unsubscribe function
 */
export function subscribeMyMedia(
  uid: string,
  callback: (media: MediaDoc[]) => void
): Unsubscribe {
  const mediaRef = collection(db, 'media');
  const q = query(
    mediaRef,
    where('ownerId', '==', uid),
    orderBy('createdAt', 'desc')
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const media: MediaDoc[] = [];
      snapshot.forEach((doc) => {
        media.push({
          id: doc.id,
          ...doc.data(),
        } as MediaDoc);
      });
      callback(media);
    },
    (error) => {
      console.error('Error subscribing to media:', error);
      callback([]);
    }
  );
}

/**
 * Complete upload flow: upload to Cloudinary -> save to Firestore -> create feed item
 * @param localUri - Local file URI
 * @param type - 'image' or 'video'
 * @param visibility - Visibility setting (default: 'public')
 * @param content - Optional text/caption for the post (default: empty string)
 * @returns Object with mediaId and postId (if created)
 */
export async function uploadAndSaveMedia(
  localUri: string,
  type: ResourceType,
  visibility: Visibility = 'public',
  content: string = '',
  onProgress?: (progress: number) => void,
  taggedUsers: TaggedUserMeta[] = []
): Promise<{ mediaId: string; postId: string | null }> {
  try {
    const normalizedContent = String(content || '').trim().slice(0, 500);

    // Step 0: Validate file size before upload
    await validateFileSizeBeforeUpload(localUri, type);
    
    // Step 1: Upload to Cloudinary
    const cloudinaryResponse = await uploadMedia(localUri, type, onProgress);

    // Step 2: Save to Firestore
    const mediaId = await saveMediaToFirestore(cloudinaryResponse, type, visibility);

    // Step 3: Get the media doc to create feed item
    // We'll construct the media doc from what we saved
    const mediaDoc: MediaDoc = {
      id: mediaId,
      ownerId: auth.currentUser!.uid,
      resourceType: type,
      visibility,
      cloudinaryPublicId: cloudinaryResponse.public_id,
      cloudinaryAssetId: cloudinaryResponse.asset_id || null,
      secureUrl: cloudinaryResponse.secure_url,
      playbackUrl: cloudinaryResponse.secure_url, // Can be enhanced with getStreamablePlaybackUrl if needed
      format: cloudinaryResponse.format || null,
      sizeBytes: cloudinaryResponse.bytes || null,
      durationSec: type === 'video' && cloudinaryResponse.duration ? cloudinaryResponse.duration : null,
      width: cloudinaryResponse.width || null,
      height: cloudinaryResponse.height || null,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'ready',
      error: null,
    };

    // Step 4: Create feed item if needed (pass content/caption + tagged users)
    const postId = await createFeedItemIfNeeded(mediaDoc, normalizedContent, taggedUsers);

    return { mediaId, postId };
  } catch (error: any) {
    console.error('Complete upload flow error:', error);
    throw error;
  }
}

/**
 * Cleanup media from Cloudinary when a post is removed (e.g. by moderation).
 * Called from ModerationService.removePost. If mediaId is missing or cleanup
 * is not configured, this no-ops so the rest of the flow is not broken.
 */
export async function cleanupMediaForPost(mediaId: string | undefined): Promise<void> {
  if (!mediaId) return;
  
  try {
    // Fetch media document
    const mediaRef = doc(db, 'media', mediaId);
    const mediaSnap = await getDoc(mediaRef);
    
    if (!mediaSnap.exists()) {
      console.warn(`[MediaService] Media ${mediaId} not found for cleanup`);
      return;
    }
    
    const mediaData = mediaSnap.data() as MediaDoc;
    const publicId = mediaData.cloudinaryPublicId;
    const resourceType = mediaData.resourceType;
    
    if (!publicId) {
      console.warn(`[MediaService] No cloudinaryPublicId found for media ${mediaId}`);
      // Still delete from Firestore
      await deleteDoc(mediaRef);
      return;
    }
    
    // Try to call backend API to delete from Cloudinary (optional - graceful failure)
    // If backend is not available, we still clean up Firestore
    const user = auth.currentUser;
    const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL;
    
    // Only attempt API call if backend URL is configured and user is authenticated
    if (user && apiBaseUrl && apiBaseUrl !== 'http://localhost:3000') {
      try {
        const idToken = await user.getIdToken();
        
        // Use a timeout to prevent hanging requests
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
        
        const response = await fetch(`${apiBaseUrl}/api/media/delete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            publicId,
            resourceType,
            mediaId,
          }),
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          // Log but don't throw - continue with Firestore cleanup
          console.warn(`[MediaService] Backend cleanup returned ${response.status}, continuing with Firestore cleanup`);
        }
      } catch (apiError: any) {
        // Silently handle network errors - backend may not be available
        // This is expected in development or when backend is not deployed
        if (apiError.name !== 'AbortError') {
          // Only log non-timeout errors at debug level
          console.debug('[MediaService] Backend cleanup unavailable, using Firestore-only cleanup');
        }
        // Continue to delete from Firestore regardless
      }
    } else {
      // Backend not configured or not available - use Firestore-only cleanup
      console.debug('[MediaService] Backend not configured, using Firestore-only cleanup');
    }
    
    // Delete from Firestore
    await deleteDoc(mediaRef);
  } catch (error: any) {
    console.error(`[MediaService] Error cleaning up media ${mediaId}:`, error);
    // Don't throw - cleanup failures shouldn't break the moderation flow
  }
}

/**
 * Get streamable playback URL with Cloudinary transformations
 * @param publicId - Cloudinary public ID
 * @param resourceType - 'image' or 'video'
 * @param transformations - Optional Cloudinary transformation parameters
 * @returns Streamable playback URL
 */
export async function getStreamablePlaybackUrl(
  publicId: string,
  resourceType: ResourceType,
  transformations?: Record<string, any>
): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User must be authenticated to get playback URL');
  }
  
  try {
    const idToken = await user.getIdToken();
    const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';
    
    const response = await fetch(`${apiBaseUrl}/api/media/playback-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        publicId,
        resourceType,
        transformations,
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || 'Failed to get playback URL');
    }
    
    const data = await response.json();
    return data.data.playbackUrl;
  } catch (error: any) {
    console.error('Error getting playback URL:', error);
    // Fallback to secure URL if API fails
    const cloudName = getEnvVar('EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_CLOUD_NAME');
    if (cloudName && publicId) {
      return `https://res.cloudinary.com/${cloudName}/${resourceType}/upload/${publicId}`;
    }
    throw error;
  }
}

/**
 * Validate file size before upload
 * @param fileUri - Local file URI
 * @param resourceType - 'image' or 'video'
 * @returns true if valid, throws error if invalid
 */
export async function validateFileSizeBeforeUpload(
  fileUri: string,
  resourceType: ResourceType
): Promise<boolean> {
  try {
    // Get file info using FileSystem
    const FileSystem = await import('expo-file-system/legacy');
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    
    if (!fileInfo.exists || !('size' in fileInfo)) {
      throw new Error('File not found or size unavailable');
    }
    
    const fileSize = fileInfo.size;
    const maxSize = resourceType === 'video' ? 500 * 1024 * 1024 : 10 * 1024 * 1024; // 500MB or 10MB
    const maxSizeMB = resourceType === 'video' ? 500 : 10;
    
    if (fileSize > maxSize) {
      throw new Error(
        `File size (${(fileSize / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size of ${maxSizeMB}MB`
      );
    }
    
    return true;
  } catch (error: any) {
    if (error.message.includes('exceeds maximum')) {
      throw error;
    }
    // If validation fails for other reasons, log but allow upload to proceed
    // (backend will also validate)
    console.warn('[MediaService] File size validation warning:', error.message);
    return true;
  }
}

/**
 * Update media caption/content for admin's uploaded media
 * Updates the associated post's content field
 * @param mediaId - Media document ID
 * @param postId - Post document ID (optional, will be looked up if not provided)
 * @param newContent - New caption/content text
 */
export async function updateMediaCaption(
  mediaId: string,
  postId: string | null,
  newContent: string
): Promise<void> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User must be authenticated to update media');
  }

  try {
    let targetPostId = postId;

    // If postId not provided, find the associated post
    if (!targetPostId) {
      const postsRef = collection(db, 'posts');
      const postQuery = query(
        postsRef,
        where('mediaId', '==', mediaId),
        where('ownerId', '==', user.uid)
      );
      const postSnap = await getDocs(postQuery);
      const postDoc = postSnap.docs[0];
      
      if (!postDoc) {
        throw new Error('Associated post not found');
      }
      
      targetPostId = postDoc.id;
    }

    // Verify ownership and update the post caption fields consistently
    const postRef = doc(db, 'posts', targetPostId);
    const postSnap = await getDoc(postRef);

    if (!postSnap.exists()) {
      throw new Error('Associated post not found');
    }

    const postData = postSnap.data();
    if (postData.ownerId !== user.uid) {
      throw new Error('You can only update your own caption');
    }

    await updateDoc(postRef, {
      content: newContent,
      contentText: newContent,
      updatedAt: serverTimestamp(),
    });
  } catch (error: any) {
    console.error('Error updating media caption:', error);
    throw new Error(`Failed to update caption: ${error.message}`);
  }
}

/**
 * Delete admin's uploaded media and associated post
 * @param mediaId - Media document ID
 * @param postId - Post document ID (optional, will be looked up if not provided)
 */
export async function deleteAdminMedia(
  mediaId: string,
  postId: string | null
): Promise<void> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User must be authenticated to delete media');
  }

  try {
    // Verify ownership
    const mediaRef = doc(db, 'media', mediaId);
    const mediaSnap = await getDoc(mediaRef);
    
    if (!mediaSnap.exists()) {
      throw new Error('Media not found');
    }

    const mediaData = mediaSnap.data();
    if (mediaData.ownerId !== user.uid) {
      throw new Error('You can only delete your own media');
    }

    let targetPostId = postId;

    // If postId not provided, find the associated post
    if (!targetPostId) {
      const postsRef = collection(db, 'posts');
      const postQuery = query(
        postsRef,
        where('mediaId', '==', mediaId),
        where('ownerId', '==', user.uid)
      );
      const postSnap = await getDocs(postQuery);
      const postDoc = postSnap.docs[0];
      
      if (postDoc) {
        targetPostId = postDoc.id;
      }
    }

    // Delete associated post if it exists
    if (targetPostId) {
      const postRef = doc(db, 'posts', targetPostId);
      const postSnap = await getDoc(postRef);

      if (postSnap.exists()) {
        const postData = postSnap.data();
        if (postData.ownerId !== user.uid) {
          throw new Error('You can only delete your own post');
        }

        await deleteDoc(postRef);
      }
    }

    // Delete media and attempt backend/cloud cleanup when available
    await cleanupMediaForPost(mediaId);
  } catch (error: any) {
    console.error('Error deleting admin media:', error);
    throw new Error(`Failed to delete media: ${error.message}`);
  }
}
