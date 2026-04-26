import { Request, Response, NextFunction } from 'express';
import admin, { auth as adminAuth, db } from '../config/firebase';
import { sendSuccess, sendError } from '../utils/response.util';
import { createNotificationForUser } from '../utils/notification.util';
import { resolveUserDisplayName } from '../utils/displayName.util';
import { AccountStatus } from '../types';
import { z } from 'zod';
import { listRevenueRecords, markRevenueAsReceived, summarizeRevenue } from '../services/revenue.service';

function sanitizePage(value: string | string[] | undefined, fallback: number): number {
  const parsed = parseInt(Array.isArray(value) ? value[0] : (value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function sanitizeLimit(value: string | string[] | undefined, fallback: number, max: number): number {
  const parsed = sanitizePage(value, fallback);
  return Math.min(parsed, max);
}

function getProfileCollectionForRole(role: string): string {
  if (role === 'academy') return 'academies';
  return `${role}s`;
}

const updateUserStatusSchema = z.object({
  status: z.nativeEnum(AccountStatus),
});

const listRevenueQuerySchema = z.object({
  source: z.enum(['booking', 'checkin', 'all']).optional(),
  providerId: z.string().trim().min(1).optional(),
  bookingId: z.string().trim().min(1).optional(),
  platformStatus: z.enum(['due', 'received', 'cancelled', 'all']).optional(),
});

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: List all users (Admin only)
 */
export async function listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { role, status, page = '1', limit = '20' } = req.query;
    const pageNum = sanitizePage(page as string, 1);
    const limitNum = sanitizeLimit(limit as string, 20, 100);
    const offset = (pageNum - 1) * limitNum;

    let query: any = db.collection('users');

    if (role) {
      query = query.where('role', '==', role);
    }

    if (status) {
      query = query.where('status', '==', status);
    }

    // Get total count
    const totalSnapshot = await query.get();
    const total = totalSnapshot.size;

    // Get paginated results
    const snapshot = await query
      .orderBy('createdAt', 'desc')
      .limit(limitNum)
      .offset(offset)
      .get();

    const users = snapshot.docs.map((doc: any) => {
      const data = doc.data();
      return {
        id: doc.id,
        email: data.email,
        phone: data.phone,
        role: data.role,
        status: data.status,
        profilePhoto: data.profilePhoto,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      };
    });

    sendSuccess(
      res,
      {
        users,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
      'Users retrieved successfully'
    );
  } catch (error) {
    next(error);
  }
}

/**
 * @swagger
 * /api/admin/users/{id}:
 *   get:
 *     summary: Get user by ID (Admin only)
 */
export async function getUserById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const userDoc = await db.collection('users').doc(id).get();

    if (!userDoc.exists) {
      sendError(res, 'NOT_FOUND', 'User not found', null, 404);
      return;
    }

    const userData = userDoc.data();

    // Get role-specific profile if exists
    let profile = null;
    const role = userData?.role;
    if (role) {
      const profileCollection = getProfileCollectionForRole(role);
      const profileDoc = await db.collection(profileCollection).doc(id).get();
      if (profileDoc.exists) {
        profile = profileDoc.data();
      }
    }

    sendSuccess(
      res,
      {
        id: userDoc.id,
        email: userData?.email,
        phone: userData?.phone,
        role: userData?.role,
        status: userData?.status,
        profilePhoto: userData?.profilePhoto,
        createdAt: userData?.createdAt,
        updatedAt: userData?.updatedAt,
        profile,
      },
      'User retrieved successfully'
    );
  } catch (error) {
    next(error);
  }
}

/**
 * @swagger
 * /api/admin/users/{id}/status:
 *   put:
 *     summary: Update user status (Admin only)
 */
export async function updateUserStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const validatedData = updateUserStatusSchema.parse(req.body);
    const { status } = validatedData;

    const userDoc = await db.collection('users').doc(id).get();

    if (!userDoc.exists) {
      sendError(res, 'NOT_FOUND', 'User not found', null, 404);
      return;
    }

    // Update user status
    await db.collection('users').doc(id).update({
      status,
      updatedAt: new Date(),
    });

    // If suspending, also sign out from Firebase Auth
    if (status === AccountStatus.SUSPENDED || status === AccountStatus.BANNED) {
      const { auth } = await import('../config/firebase');
      try {
        await auth.revokeRefreshTokens(id);
      } catch (error) {
        console.error('Error revoking tokens:', error);
      }
      // Notify user that account was suspended/banned
      createNotificationForUser({
        userId: id,
        title: 'Account suspended',
        body: status === AccountStatus.BANNED ? 'Your account has been banned.' : 'Your account has been suspended. Please contact support.',
        type: 'system',
        data: { action: 'suspended', status },
        createdBy: req.user?.userId ?? undefined,
      }).catch((err) => console.error('Suspend notification failed:', err));
    } else if (status === AccountStatus.ACTIVE) {
      // Notify user that account was reactivated
      createNotificationForUser({
        userId: id,
        title: 'Account reactivated',
        body: 'Your account has been reactivated. You can sign in again.',
        type: 'system',
        data: { action: 'activated', status },
        createdBy: req.user?.userId ?? undefined,
      }).catch((err) => console.error('Activate notification failed:', err));
    }

    const updatedDoc = await db.collection('users').doc(id).get();

    sendSuccess(
      res,
      {
        id: updatedDoc.id,
        ...updatedDoc.data(),
      },
      'User status updated successfully'
    );
  } catch (error: any) {
    if (error.name === 'ZodError') {
      sendError(res, 'VALIDATION_ERROR', 'Invalid input data', error.errors, 400);
      return;
    }
    next(error);
  }
}

async function recursiveDeleteDoc(ref: FirebaseFirestore.DocumentReference): Promise<void> {
  await db.recursiveDelete(ref);
}

async function deleteDocsFromSnapshot(
  snapshot: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>
): Promise<void> {
  await Promise.all(snapshot.docs.map((docSnap) => recursiveDeleteDoc(docSnap.ref)));
}

async function deleteByField(collectionName: string, field: string, value: string): Promise<void> {
  const snapshot = await db.collection(collectionName).where(field, '==', value).get();
  await deleteDocsFromSnapshot(snapshot);
}

async function deleteByDocumentIdFromCollectionGroup(collectionName: string, docId: string): Promise<void> {
  const snapshot = await db
    .collectionGroup(collectionName)
    .where(admin.firestore.FieldPath.documentId(), '==', docId)
    .get();

  await Promise.all(snapshot.docs.map((docSnap) => docSnap.ref.delete()));
}

async function deleteByFieldFromCollectionGroup(collectionName: string, field: string, value: string): Promise<void> {
  const snapshot = await db.collectionGroup(collectionName).where(field, '==', value).get();
  await Promise.all(snapshot.docs.map((docSnap) => docSnap.ref.delete()));
}

/**
 * @swagger
 * /api/admin/users/{id}:
 *   delete:
 *     summary: Permanently delete a user and related app data (Admin only)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User deleted permanently
 */
export async function deleteUserPermanently(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const userDocRef = db.collection('users').doc(id);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      sendError(res, 'NOT_FOUND', 'User not found', null, 404);
      return;
    }

    const userData = userDoc.data() || {};
    const role = String(userData.role || '').toLowerCase();
    const profileCollection = role ? getProfileCollectionForRole(role) : null;

    const followersSnap = await userDocRef.collection('followers').get();
    const followingSnap = await userDocRef.collection('following').get();

    await Promise.all([
      ...followersSnap.docs.map((followerDoc) =>
        db.collection('users').doc(followerDoc.id).collection('following').doc(id).delete().catch(() => null)
      ),
      ...followingSnap.docs.map((followingDoc) =>
        db.collection('users').doc(followingDoc.id).collection('followers').doc(id).delete().catch(() => null)
      ),
    ]);

    const postsSnap = await db.collection('posts').where('ownerId', '==', id).get();
    const ownedPostIds = postsSnap.docs.map((docSnap) => docSnap.id);
    const mediaIds = postsSnap.docs
      .map((docSnap) => String(docSnap.data()?.mediaId || '').trim())
      .filter((value) => value.length > 0);

    const repostSnapshots = await Promise.all(
      ownedPostIds.map((postId) => db.collection('posts').where('originalPostId', '==', postId).get())
    );
    await Promise.all(repostSnapshots.map((repostsSnap) => deleteDocsFromSnapshot(repostsSnap)));

    await deleteDocsFromSnapshot(postsSnap);

    await Promise.all(mediaIds.map((mediaId) => recursiveDeleteDoc(db.collection('media').doc(mediaId)).catch(() => null)));

    await Promise.all([
      deleteByField('media', 'ownerId', id),
      deleteByField('notifications', 'userId', id),
      deleteByField('reports', 'reporterId', id),
      deleteByField('reports', 'targetId', id),
      deleteByField('admin_notes', 'targetUserId', id),
      deleteByField('admin_messages', 'userId', id),
      ...['playerId', 'parentId', 'userId', 'academyId', 'clinicId', 'providerId'].map((field) =>
        deleteByField('bookings', field, id)
      ),
      deleteByField('checkins', 'userId', id),
      deleteByField('checkins', 'locationId', id),
      deleteByField('conversations', 'participant1Id', id),
      deleteByField('conversations', 'participant2Id', id),
      deleteByFieldFromCollectionGroup('comments', 'authorId', id),
      deleteByFieldFromCollectionGroup('likes', 'userId', id),
      deleteByFieldFromCollectionGroup('reposts', 'userId', id),
      deleteByDocumentIdFromCollectionGroup('blocked', id),
    ]);

    if (profileCollection) {
      await recursiveDeleteDoc(db.collection(profileCollection).doc(id)).catch(() => null);
    }

    if (role === 'academy') {
      await deleteByField('academy_programs', 'academyId', id);
    }

    await recursiveDeleteDoc(userDocRef);

    await db.collection('admin_logs').add({
      adminUid: req.user?.userId || null,
      actionType: 'user_soft_deleted',
      targetCollection: 'users',
      targetId: id,
      reason: 'User permanently deleted by admin',
      metadata: {
        deletedRole: role || null,
        deletedEmail: typeof userData.email === 'string' ? userData.email : null,
      },
      timestamp: new Date(),
    });

    try {
      await adminAuth.deleteUser(id);
    } catch (error: any) {
      const code = String(error?.code || '');
      if (code !== 'auth/user-not-found') {
        throw error;
      }
    }

    sendSuccess(res, { id }, 'User deleted permanently');
  } catch (error) {
    next(error);
  }
}

/**
 * @swagger
 * /api/admin/bookings:
 *   get:
 *     summary: List all bookings (Admin only)
 */
export async function listAllBookings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status, type, page = '1', limit = '20' } = req.query;
    const pageNum = sanitizePage(page as string, 1);
    const limitNum = sanitizeLimit(limit as string, 20, 100);
    const offset = (pageNum - 1) * limitNum;

    let query: any = db.collection('bookings');

    if (status) {
      query = query.where('status', '==', status);
    }

    if (type) {
      query = query.where('bookingType', '==', type);
    }

    // Get total count
    const totalSnapshot = await query.get();
    const total = totalSnapshot.size;

    // Get paginated results
    const snapshot = await query
      .orderBy('createdAt', 'desc')
      .limit(limitNum)
      .offset(offset)
      .get();

    const bookings = await Promise.all(snapshot.docs.map(async (doc: any) => {
      const data = doc.data();
      let customerName = data.customerName || data.playerName || data.parentName;

      // If customerName is missing, try to fetch it from the users collection
      if (!customerName && (data.userId || data.playerId || data.parentId || data.uid)) {
        try {
          const userId = data.userId || data.playerId || data.parentId || data.uid;
          const userDoc = await db.collection('users').doc(userId).get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            customerName = resolveUserDisplayName(userData);
          }
        } catch (err) {
          console.error('Error fetching user name for booking:', doc.id, err);
        }
      }

      return {
        id: doc.id,
        ...data,
        customerName: customerName || 'Unknown Player',
      };
    }));

    sendSuccess(
      res,
      {
        bookings,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
      'Bookings retrieved successfully'
    );
  } catch (error) {
    next(error);
  }
}

/**
 * @swagger
 * /api/admin/bookings/{id}:
 *   get:
 *     summary: Get booking by ID (Admin only)
 */
export async function getBookingById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const bookingDoc = await db.collection('bookings').doc(id).get();

    if (!bookingDoc.exists) {
      sendError(res, 'NOT_FOUND', 'Booking not found', null, 404);
      return;
    }

    const bookingData = bookingDoc.data();
    let customerName = bookingData?.customerName || bookingData?.playerName || bookingData?.parentName;

    if (!customerName && (bookingData?.userId || bookingData?.playerId || bookingData?.parentId || bookingData?.uid)) {
      try {
        const userId = bookingData.userId || bookingData.playerId || bookingData.parentId || bookingData.uid;
        const userDoc = await db.collection('users').doc(userId).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          customerName = resolveUserDisplayName(userData);
        }
      } catch (err) {
        console.error('Error fetching user name for booking:', id, err);
      }
    }

    sendSuccess(
      res,
      {
        id: bookingDoc.id,
        ...bookingData,
        customerName: customerName || 'Unknown Player',
      },
      'Booking retrieved successfully'
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Record an admin-to-user message in backend and notify the user
 */
export async function createAdminMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id: userId } = req.params;
    const { content } = req.body;
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      sendError(res, 'NOT_FOUND', 'User not found', null, 404);
      return;
    }


    if (!content || typeof content !== 'string' || !content.trim()) {
      sendError(res, 'VALIDATION_ERROR', 'Message content is required', null, 400);
      return;
    }

    // Create a backend record for admin messages
    const adminId = req.user?.userId ?? undefined;
    const payload = {
      adminId,
      userId,
      content: content.trim(),
      createdAt: new Date(),
    };

    const docRef = await db.collection('admin_messages').add(payload as any);

    // Also create a notification for the user (so they see it in-app)
    await createNotificationForUser({
      userId,
      title: 'Message from Admin',
      body: content.trim().slice(0, 200),
      type: 'info',
      data: { adminMessageId: docRef.id },
      createdBy: adminId,
    });

    sendSuccess(res, { id: docRef.id, ...payload }, 'Admin message recorded');
  } catch (error) {
    next(error);
  }
}

/**
 * Get admin messages for a specific user
 */
export async function getAdminMessages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id: userId } = req.params;
    const snapshot = await db.collection('admin_messages').where('userId', '==', userId).orderBy('createdAt', 'desc').get();
    const messages = snapshot.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
    sendSuccess(res, { messages }, 'Admin messages retrieved');
  } catch (error) {
    next(error);
  }
}

/**
 * List revenue ledger records for admin review.
 */
export async function listRevenue(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const validatedQuery = listRevenueQuerySchema.parse(req.query || {});
    const pageNum = sanitizePage(req.query.page as string, 1);
    const limitNum = sanitizeLimit(req.query.limit as string, 20, 100);

    const result = await listRevenueRecords({
      source: validatedQuery.source || 'booking',
      providerId: validatedQuery.providerId,
      bookingId: validatedQuery.bookingId,
      platformStatus: validatedQuery.platformStatus || 'all',
      page: pageNum,
      limit: limitNum,
    });

    sendSuccess(res, result, 'Revenue records retrieved successfully');
  } catch (error: any) {
    if (error?.name === 'ZodError') {
      sendError(res, 'VALIDATION_ERROR', 'Invalid query parameters', error.errors, 400);
      return;
    }
    next(error);
  }
}

/**
 * Summarize due vs received platform commission.
 */
export async function getRevenueSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const validatedQuery = listRevenueQuerySchema.parse(req.query || {});
    const summary = await summarizeRevenue({
      source: validatedQuery.source || 'booking',
      providerId: validatedQuery.providerId,
      bookingId: validatedQuery.bookingId,
      platformStatus: validatedQuery.platformStatus || 'all',
    });

    sendSuccess(res, summary, 'Revenue summary retrieved successfully');
  } catch (error: any) {
    if (error?.name === 'ZodError') {
      sendError(res, 'VALIDATION_ERROR', 'Invalid query parameters', error.errors, 400);
      return;
    }
    next(error);
  }
}

/**
 * Mark a commission record as collected by platform/admin.
 */
export async function collectRevenue(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, 'UNAUTHORIZED', 'Authentication required', null, 401);
      return;
    }

    const { id } = req.params;
    const updated = await markRevenueAsReceived(id, req.user.userId);
    sendSuccess(res, updated, 'Revenue record marked as received');
  } catch (error: any) {
    if (typeof error?.statusCode === 'number' && typeof error?.code === 'string') {
      sendError(res, error.code, error.message, null, error.statusCode);
      return;
    }
    next(error);
  }
}
