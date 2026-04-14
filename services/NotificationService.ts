import { auth, db } from '../lib/firebase';
import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  updateDoc,
  doc,
  getDocs,
  serverTimestamp,
  limit,
} from 'firebase/firestore';
import { sendPushNotificationsToUsers } from './PushNotificationService';

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

/**
 * Create a notification for a user. Caller must be authenticated.
 * createdBy is set to current user (required by Firestore rules).
 */
export async function createNotification(params: {
  userId: string;
  title: string;
  body: string;
  type: NotificationType;
  data?: Record<string, string | number | boolean>;
}): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be authenticated to create notification');

  const ref = await addDoc(collection(db, 'notifications'), {
    userId: params.userId,
    title: params.title,
    body: params.body,
    type: params.type,
    read: false,
    createdAt: serverTimestamp(),
    createdBy: user.uid,
    data: params.data || null,
  });

  if (params.userId !== user.uid) {
    await sendPushNotificationsToUsers([params.userId], params.title, params.body, params.data);
  }

  return ref.id;
}

/**
 * Create notifications for multiple users (e.g. provider + all admins)
 */
export async function createNotificationsForUsers(
  userIds: string[],
  title: string,
  body: string,
  type: NotificationType,
  data?: Record<string, string | number | boolean>
): Promise<void> {
  const unique = [...new Set(userIds)];
  await Promise.all(
    unique.map(userId =>
      createNotification({ userId, title, body, type, data })
    )
  );
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

/**
 * Subscribe to current user's notifications (realtime)
 */
export function subscribeMyNotifications(
  callback: (notifications: Notification[]) => void,
  maxItems: number = 100
): () => void {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    callback([]);
    return () => {};
  }

  const notificationsRef = collection(db, 'notifications');
  const q = query(
    notificationsRef,
    where('userId', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(maxItems)
  );

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
