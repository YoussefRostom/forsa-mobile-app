import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/firebase';
import { sendError, sendSuccess } from '../utils/response.util';
import { createNotificationsForUsers, NotificationType } from '../utils/notification.util';

const createNotificationsSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  userIds: z.array(z.string().trim().min(1)).max(25).optional(),
  title: z.string().trim().min(1).max(140),
  body: z.string().trim().min(1).max(500),
  type: z.enum(['booking', 'checkin', 'report', 'info', 'system']),
  data: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
}).superRefine((value, ctx) => {
  const hasUserId = typeof value.userId === 'string' && value.userId.length > 0;
  const hasUserIds = Array.isArray(value.userIds) && value.userIds.length > 0;

  if (!hasUserId && !hasUserIds) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide userId or userIds',
      path: ['userIds'],
    });
  }
});

function normalizeRole(role: unknown): string {
  return typeof role === 'string' ? role.trim().toLowerCase() : '';
}

function addIfString(target: Set<string>, value: unknown): void {
  if (typeof value === 'string' && value.trim().length > 0) {
    target.add(value);
  }
}

async function getAdminUserIds(): Promise<Set<string>> {
  const snapshot = await db.collection('users').where('role', 'in', ['admin', 'Admin', 'ADMIN']).get();
  return new Set(snapshot.docs.map((doc) => doc.id));
}

async function getSenderRole(userId: string): Promise<string> {
  const userDoc = await db.collection('users').doc(userId).get();
  return normalizeRole(userDoc.data()?.role);
}

async function resolveBookingRecipients(allowed: Set<string>, bookingId: string, adminIds: Set<string>): Promise<void> {
  const bookingDoc = await db.collection('bookings').doc(bookingId).get();
  if (!bookingDoc.exists) return;

  const data = bookingDoc.data() || {};
  addIfString(allowed, data.userId);
  addIfString(allowed, data.parentId);
  addIfString(allowed, data.playerId);
  addIfString(allowed, data.providerId);
  addIfString(allowed, data.academyId);
  addIfString(allowed, data.clinicId);
  adminIds.forEach((adminId) => allowed.add(adminId));
}

async function resolveConversationRecipients(allowed: Set<string>, conversationId: string, adminIds: Set<string>): Promise<void> {
  const conversationDoc = await db.collection('conversations').doc(conversationId).get();
  if (!conversationDoc.exists) return;

  const data = conversationDoc.data() || {};
  addIfString(allowed, data.participant1Id);
  addIfString(allowed, data.participant2Id);
  adminIds.forEach((adminId) => allowed.add(adminId));
}

async function resolveCheckInRecipients(allowed: Set<string>, checkInId: string, adminIds: Set<string>): Promise<void> {
  const checkInDoc = await db.collection('checkins').doc(checkInId).get();
  if (!checkInDoc.exists) return;

  const data = checkInDoc.data() || {};
  addIfString(allowed, data.userId);
  addIfString(allowed, data.playerId);
  addIfString(allowed, data.parentId);
  addIfString(allowed, data.createdBy);
  addIfString(allowed, data.locationId);
  adminIds.forEach((adminId) => allowed.add(adminId));
}

async function resolveReportRecipients(allowed: Set<string>, reportId: string, adminIds: Set<string>): Promise<void> {
  const reportDoc = await db.collection('reports').doc(reportId).get();
  if (!reportDoc.exists) return;

  const data = reportDoc.data() || {};
  addIfString(allowed, data.reporterId);
  adminIds.forEach((adminId) => allowed.add(adminId));
}

async function resolvePostRecipients(allowed: Set<string>, postId: string): Promise<void> {
  const postDoc = await db.collection('posts').doc(postId).get();
  if (!postDoc.exists) return;

  const data = postDoc.data() || {};
  addIfString(allowed, data.ownerId);
}

async function resolveFollowRecipients(
  allowed: Set<string>,
  senderId: string,
  data: Record<string, string | number | boolean | null> | undefined
): Promise<void> {
  if (data?.notificationKind !== 'follow' || data?.actorId !== senderId) {
    return;
  }

  const followerDoc = await db
    .collection('users')
    .doc(String(data.actorId))
    .collection('following')
    .doc(String(data.userId || ''))
    .get();
  const followingDoc = await db
    .collection('users')
    .doc(String(data.userId || ''))
    .collection('followers')
    .doc(senderId)
    .get();
  const legacyFollowDoc = await db.collection('follows').doc(`${senderId}_${String(data.userId || '')}`).get();

  if (followerDoc.exists || followingDoc.exists || legacyFollowDoc.exists) {
    addIfString(allowed, data.userId);
  }
}

async function resolveAllowedRecipients(
  senderId: string,
  data: Record<string, string | number | boolean | null> | undefined,
  adminIds: Set<string>
): Promise<Set<string>> {
  const allowed = new Set<string>([senderId]);

  const bookingId = typeof data?.bookingId === 'string' ? data.bookingId : null;
  const conversationId = typeof data?.conversationId === 'string' ? data.conversationId : null;
  const checkInId = typeof data?.checkInId === 'string' ? data.checkInId : null;
  const reportId = typeof data?.reportId === 'string' ? data.reportId : null;
  const postId = typeof data?.postId === 'string' ? data.postId : null;

  if (bookingId) {
    await resolveBookingRecipients(allowed, bookingId, adminIds);
  }
  if (conversationId) {
    await resolveConversationRecipients(allowed, conversationId, adminIds);
  }
  if (checkInId) {
    await resolveCheckInRecipients(allowed, checkInId, adminIds);
  }
  if (reportId) {
    await resolveReportRecipients(allowed, reportId, adminIds);
  }
  if (postId) {
    await resolvePostRecipients(allowed, postId);
  }
  await resolveFollowRecipients(allowed, senderId, data);

  return allowed;
}

function stripNullValues(
  data: Record<string, string | number | boolean | null> | undefined
): Record<string, string | number | boolean> | undefined {
  if (!data) {
    return undefined;
  }

  const entries = Object.entries(data).filter(([, value]) => value !== null) as [][
    ] extends never ? never : [string, string | number | boolean][];

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeRequestedRecipients(userId?: string, userIds?: string[]): string[] {
  const requested = [userId, ...(userIds || [])]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());

  return [...new Set(requested)];
}

function isSignupNotificationRequest(
  senderId: string,
  type: NotificationType,
  recipients: string[],
  data: Record<string, string | number | boolean | null> | undefined,
  adminIds: Set<string>
): boolean {
  if (type !== 'info' || recipients.length === 0) {
    return false;
  }

  if (typeof data?.notificationKind !== 'string' || data.notificationKind !== 'signup') {
    return false;
  }

  if (typeof data?.signupUserId !== 'string' || data.signupUserId !== senderId) {
    return false;
  }

  return recipients.every((recipientId) => adminIds.has(recipientId));
}

export async function dispatchNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const senderId = (req as any).firebaseUser?.uid;
    if (!senderId) {
      sendError(res, 'UNAUTHORIZED', 'Authentication required', null, 401);
      return;
    }

    const validated = createNotificationsSchema.parse(req.body);
    const requestedRecipients = normalizeRequestedRecipients(validated.userId, validated.userIds);
    const senderRole = await getSenderRole(senderId);
    const adminIds = await getAdminUserIds();
    const isAdminSender = senderRole === 'admin' || adminIds.has(senderId);
    const sanitizedData = stripNullValues(validated.data);
    const isSignupNotification = isSignupNotificationRequest(
      senderId,
      validated.type as NotificationType,
      requestedRecipients,
      validated.data,
      adminIds
    );

    if (!isAdminSender && validated.type === 'system') {
      sendError(res, 'FORBIDDEN', 'Only admins can send system notifications', null, 403);
      return;
    }

    if (!isAdminSender && !isSignupNotification) {
      const allowedRecipients = await resolveAllowedRecipients(senderId, validated.data, adminIds);
      const invalidRecipient = requestedRecipients.find((recipientId) => !allowedRecipients.has(recipientId));
      if (invalidRecipient) {
        sendError(res, 'FORBIDDEN', 'Notification recipients are not allowed for this action', { userId: invalidRecipient }, 403);
        return;
      }

      if (requestedRecipients.some((recipientId) => recipientId !== senderId) && allowedRecipients.size === 1) {
        sendError(res, 'FORBIDDEN', 'Cross-user notifications require verified context', null, 403);
        return;
      }
    }

    const notificationIds = await createNotificationsForUsers(requestedRecipients, {
      title: validated.title,
      body: validated.body,
      type: validated.type as NotificationType,
      data: sanitizedData,
      createdBy: senderId,
    });

    sendSuccess(res, { notificationIds }, 'Notifications dispatched successfully', 201);
  } catch (error: any) {
    if (error?.name === 'ZodError') {
      sendError(res, 'VALIDATION_ERROR', 'Invalid notification payload', error.errors, 400);
      return;
    }

    next(error);
  }
}
