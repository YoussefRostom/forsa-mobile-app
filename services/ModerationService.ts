import { auth, db } from '../lib/firebase';
import { doc, updateDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { cleanupMediaForPost } from './MediaService';
import { createNotification } from './NotificationService';
import { logAdminAction } from './AdminOpsService';

/**
 * Remove a post (soft delete)
 */
export async function removePost(postId: string, adminId: string, note?: string): Promise<void> {
  try {
    const postRef = doc(db, 'posts', postId);
    const postSnap = await getDoc(postRef);

    if (!postSnap.exists()) {
      throw new Error('Post not found');
    }

    const postData = postSnap.data();
    const mediaId = postData?.mediaId;

    await updateDoc(postRef, {
      status: 'deleted',
      deletedAt: serverTimestamp(),
      deletedBy: adminId,
    });

    await logAdminAction({
      actionType: 'content_removed',
      targetCollection: 'posts',
      targetId: postId,
      reason: note || 'Post removed by moderation',
      actorId: adminId,
    });

    // Notify post owner that their post was removed
    const ownerId = postData?.ownerId;
    if (ownerId) {
      createNotification({
        userId: ownerId,
        title: 'Post removed',
        body: note ? `Your post was removed by moderation. Reason: ${note}` : 'Your post was removed by moderation.',
        type: 'system',
        data: { postId, action: 'removed' },
      }).catch((e) => console.warn('[ModerationService] Post-removed notification failed:', e));
    }

    // Cleanup media from Cloudinary (non-blocking)
    if (mediaId) {
      cleanupMediaForPost(mediaId).catch((e) =>
        console.warn('[ModerationService] Media cleanup failed:', e)
      );
    }
  } catch (error: any) {
    console.error('Error removing post:', error);
    throw new Error(`Failed to remove post: ${error.message}`);
  }
}

/**
 * Suspend a user
 */
export async function suspendUser(userId: string, adminId: string, reason: string): Promise<void> {
  try {
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      throw new Error('User not found');
    }

    const userData = userSnap.data() as Record<string, any>;
    const role = String(userData?.role || 'user').toLowerCase();
    const roleLabel =
      role === 'player'
        ? 'player'
        : role === 'parent'
          ? 'parent'
          : role === 'agent'
            ? 'agent'
            : 'account';

    await updateDoc(userRef, {
      isSuspended: true,
      suspendedAt: serverTimestamp(),
      suspendedBy: adminId,
      suspensionReason: reason,
      status: 'suspended',
    });

    await logAdminAction({
      actionType: 'user_suspended',
      targetCollection: 'users',
      targetId: userId,
      reason: reason || 'User suspended by admin',
      actorId: adminId,
    });

    // Notify user that account was suspended
    createNotification({
      userId,
      title: 'Account suspended',
      body: reason || `Your ${roleLabel} account has been suspended. Please contact the admin.`,
      type: 'system',
      data: { action: 'suspended', role },
    }).catch((e) => console.warn('[ModerationService] Suspend notification failed:', e));
  } catch (error: any) {
    console.error('Error suspending user:', error);
    throw new Error(`Failed to suspend user: ${error.message}`);
  }
}

/**
 * Unsuspend a user
 */
export async function unsuspendUser(userId: string, adminId: string, note?: string): Promise<void> {
  try {
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      throw new Error('User not found');
    }

    await updateDoc(userRef, {
      isSuspended: false,
      suspendedAt: null,
      suspendedBy: null,
      suspensionReason: null,
      status: 'active',
    });

    await logAdminAction({
      actionType: 'user_unsuspended',
      targetCollection: 'users',
      targetId: userId,
      reason: note || 'User reactivated by admin',
      actorId: adminId,
    });

    // Notify user that account was reactivated
    createNotification({
      userId,
      title: 'Account reactivated',
      body: note || 'Your account has been reactivated. You can sign in again.',
      type: 'system',
      data: { action: 'activated' },
    }).catch((e) => console.warn('[ModerationService] Unsuspend notification failed:', e));
  } catch (error: any) {
    console.error('Error unsuspending user:', error);
    throw new Error(`Failed to unsuspend user: ${error.message}`);
  }
}

/**
 * Check if current user is suspended
 */
export async function isUserSuspended(userId?: string): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) {
    return false;
  }

  const targetUserId = userId || user.uid;

  try {
    const userRef = doc(db, 'users', targetUserId);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      return false;
    }

    const userData = userSnap.data();
    return userData?.isSuspended === true;
  } catch (error: any) {
    console.error('Error checking user suspension status:', error);
    return false;
  }
}

/**
 * Check if current user is admin
 */
export async function isAdmin(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) {
    return false;
  }

  try {
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      return false;
    }

    const userData = userSnap.data();
    const role = (userData?.role || '').toLowerCase();
    return role === 'admin';
  } catch (error: any) {
    console.error('Error checking admin status:', error);
    return false;
  }
}
