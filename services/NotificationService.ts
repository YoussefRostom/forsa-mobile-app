import { auth, db } from '../lib/firebase';
import {
  addDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  updateDoc,
  doc,
  getDocs,
  limit,
  serverTimestamp,
} from 'firebase/firestore';
import { getBackendUrl } from '../lib/config';
import { sendPushNotificationsToUsers } from './PushNotificationService';

const NOTIFICATION_DISPATCH_TIMEOUT_MS = 12000;

export function isTransientNotificationDispatchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /timed out|aborted|aborterror|network request failed|failed to fetch/i.test(message);
}

function isPermissionDeniedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /missing or insufficient permissions|permission-denied/i.test(message);
}

export type NotificationType = 'booking' | 'checkin' | 'report' | 'info' | 'system';

export interface Notification {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: NotificationType;
  read: boolean;
  createdAt: unknown;
  createdBy?: string;
  data?: Record<string, string | number | boolean>;
}

type NotificationPayload = Record<string, string | number | boolean | null>;

function sanitizeNotificationPayload(
  data?: NotificationPayload
): Record<string, string | number | boolean> | undefined {
  if (!data) {
    return undefined;
  }

  const entries = Object.entries(data).filter(([, value]) => value !== null) as [
    string,
    string | number | boolean
  ][];

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

async function dispatchNotifications(params: {
  userId?: string;
  userIds?: string[];
  title: string;
  body: string;
  type: NotificationType;
  data?: NotificationPayload;
}): Promise<string[]> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be authenticated to create notification');

  const idToken = await user.getIdToken();
  const abortController = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutHandle = abortController
    ? setTimeout(() => abortController.abort(), NOTIFICATION_DISPATCH_TIMEOUT_MS)
    : null;

  let response: Response;
  try {
    response = await fetch(`${getBackendUrl()}/api/notifications/dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        userId: params.userId,
        userIds: params.userIds,
        title: params.title,
        body: params.body,
        type: params.type,
        data: params.data,
      }),
      signal: abortController?.signal,
    });
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = payload?.error?.details ? ` ${JSON.stringify(payload.error.details)}` : '';
    throw new Error(`${payload?.error?.message || 'Failed to create notification'}${details}`);
  }

  return Array.isArray(payload?.data?.notificationIds)
    ? payload.data.notificationIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    : [];
}

async function createOwnNotificationFallback(params: {
  userId: string;
  title: string;
  body: string;
  type: NotificationType;
  data?: NotificationPayload;
}): Promise<string> {
  const user = auth.currentUser;
  if (!user || params.userId !== user.uid) {
    throw new Error('Own notification fallback is only available for the authenticated user');
  }

  const ref = await addDoc(collection(db, 'notifications'), {
    userId: user.uid,
    title: params.title,
    body: params.body,
    type: params.type,
    read: false,
    createdAt: serverTimestamp(),
    createdBy: user.uid,
    data: sanitizeNotificationPayload(params.data) ?? null,
  });

  return ref.id;
}

async function createNotificationFallbackForRecipient(params: {
  userId: string;
  title: string;
  body: string;
  type: NotificationType;
  data?: NotificationPayload;
}): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Must be authenticated to create notification');
  }

  const ref = await addDoc(collection(db, 'notifications'), {
    userId: params.userId,
    title: params.title,
    body: params.body,
    type: params.type,
    read: false,
    createdAt: serverTimestamp(),
    createdBy: user.uid,
    data: sanitizeNotificationPayload(params.data) ?? null,
  });

  if (params.userId !== user.uid) {
    void sendPushNotificationsToUsers(
      [params.userId],
      params.title,
      params.body,
      sanitizeNotificationPayload(params.data)
    ).catch((error) => {
      if (!isTransientNotificationDispatchError(error)) {
        console.warn('[NotificationService] Push fanout failed after recipient fallback write:', error);
      }
    });
  }

  return ref.id;
}

export async function createNotificationsLocallyForUsers(
  userIds: string[],
  title: string,
  body: string,
  type: NotificationType,
  data?: NotificationPayload
): Promise<string[]> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return [];

  const createdIds = await Promise.all(
    unique.map((userId) =>
      createNotificationFallbackForRecipient({
        userId,
        title,
        body,
        type,
        data,
      })
    )
  );

  const pushPayload = sanitizeNotificationPayload(data);
  const currentUserId = auth.currentUser?.uid;
  const pushTargets = unique.filter((userId) => userId !== currentUserId);

  if (pushTargets.length > 0) {
    void sendPushNotificationsToUsers(pushTargets, title, body, pushPayload).catch((error) => {
      if (!isTransientNotificationDispatchError(error)) {
        console.warn('[NotificationService] Push fanout failed after local notification write:', error);
      }
    });
  }

  return createdIds;
}

export async function createNotificationLocally(params: {
  userId: string;
  title: string;
  body: string;
  type: NotificationType;
  data?: NotificationPayload;
}): Promise<string> {
  const ids = await createNotificationsLocallyForUsers(
    [params.userId],
    params.title,
    params.body,
    params.type,
    params.data
  );

  return ids[0] || '';
}

/**
 * Get all admin user IDs (for sending action notifications to admin)
 * Handles role stored as 'admin' or 'Admin'.
 */
export async function getAdminUserIds(): Promise<string[]> {
  const usersRef = collection(db, 'users');
  const q = query(
    usersRef,
    where('role', 'in', ['admin', 'Admin', 'ADMIN'])
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => d.id);
}

export async function getClinicAndAcademyUserIds(): Promise<string[]> {
  const usersRef = collection(db, 'users');
  const q = query(
    usersRef,
    where('role', 'in', ['academy', 'Academy', 'ACADEMY', 'clinic', 'Clinic', 'CLINIC'])
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((docSnap) => docSnap.id);
}

/**
 * Create a notification for a user. Caller must be authenticated.
 * createdBy is set to current user (required by Firestore rules).
 */
export async function createNotification(params: {
  userId: string;
  title: string;
  body: string;
  type: NotificationType;
  data?: NotificationPayload;
}): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be authenticated to create notification');

  let ids: string[] = [];
  try {
    ids = await dispatchNotifications({
      userId: params.userId,
      title: params.title,
      body: params.body,
      type: params.type,
      data: params.data,
    });
  } catch (error) {
    if (!isTransientNotificationDispatchError(error)) {
      console.warn('[NotificationService] Backend notification dispatch failed, falling back to local write:', error);
    }

    if (params.userId === user.uid) {
      const fallbackId = await createOwnNotificationFallback(params);
      ids = [fallbackId];
    } else {
      const fallbackId = await createNotificationFallbackForRecipient(params);
      ids = [fallbackId];
    }
  }

  return ids[0] || '';
}

/**
 * Create notifications for multiple users (e.g. provider + all admins)
 */
export async function createNotificationsForUsers(
  userIds: string[],
  title: string,
  body: string,
  type: NotificationType,
  data?: NotificationPayload
): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;

  try {
    await dispatchNotifications({
      userIds: unique,
      title,
      body,
      type,
      data,
    });
  } catch (error) {
    try {
      await Promise.all(
        unique.map((userId) =>
          createNotificationFallbackForRecipient({
            userId,
            title,
            body,
            type,
            data,
          })
        )
      );
    } catch (fallbackError) {
      if (isPermissionDeniedError(fallbackError)) {
        console.warn(
          '[NotificationService] Skipping local multi-recipient notification fallback because Firestore rules rejected it:',
          fallbackError
        );
        return;
      }

      throw fallbackError;
    }
  }
}

/**
 * Notify provider and all admins (e.g. after booking / check-in / report).
 * Optionally exclude booker so they only get their own "Booking request sent" notification.
 */
export async function notifyProviderAndAdmins(
  providerUserId: string,
  title: string,
  body: string,
  type: NotificationType,
  data?: Record<string, string | number | boolean>,
  excludeUserId?: string
): Promise<void> {
  const adminIds = await getAdminUserIds();
  let userIds = [providerUserId, ...adminIds];
  if (excludeUserId) {
    userIds = userIds.filter(id => id !== excludeUserId);
  }
  if (userIds.length === 0) return;
  await createNotificationsForUsers(userIds, title, body, type, data);
}

/**
 * Notify only all admins (e.g. new report)
 */
export async function notifyAdmins(
  title: string,
  body: string,
  type: NotificationType = 'report',
  data?: Record<string, string | number | boolean>
): Promise<void> {
  const adminIds = await getAdminUserIds();
  if (adminIds.length === 0) return;
  await createNotificationsForUsers(adminIds, title, body, type, data);
}

function buildNotificationsQuery(uid: string, maxItems: number) {
  return query(
    collection(db, 'notifications'),
    where('userId', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(maxItems)
  );
}

export async function listMyNotifications(
  maxItems: number = 100,
  userId?: string | null
): Promise<Notification[]> {
  const uid = userId || auth.currentUser?.uid;
  if (!uid) {
    return [];
  }

  const snapshot = await getDocs(buildNotificationsQuery(uid, maxItems));
  return snapshot.docs.map((d) => ({
    id: d.id,
    ...d.data(),
  })) as Notification[];
}

/**
 * Subscribe to current user's notifications (realtime)
 */
export function subscribeMyNotifications(
  callback: (notifications: Notification[]) => void,
  maxItems: number = 100,
  userId?: string | null
): () => void {
  const uid = userId || auth.currentUser?.uid;
  if (!uid) {
    callback([]);
    return () => {};
  }

  const q = buildNotificationsQuery(uid, maxItems);

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as Notification[];
      callback(list);
    },
    (err) => {
      console.error('Notification subscribe error:', err);
      callback([]);
    }
  );
  return unsubscribe;
}

/**
 * Mark a notification as read
 */
export async function markAsRead(notificationId: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Must be authenticated');

  const notifRef = doc(db, 'notifications', notificationId);
  await updateDoc(notifRef, { read: true });
}

export async function markAllNotificationsAsRead(): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Must be authenticated');

  const notificationsRef = collection(db, 'notifications');
  const unreadQuery = query(
    notificationsRef,
    where('userId', '==', uid),
    where('read', '==', false)
  );
  const snapshot = await getDocs(unreadQuery);

  await Promise.all(
    snapshot.docs.map((docSnap) => updateDoc(doc(db, 'notifications', docSnap.id), { read: true }))
  );
}
