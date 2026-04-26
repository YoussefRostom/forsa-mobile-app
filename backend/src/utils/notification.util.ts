import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase';

export type NotificationType = 'booking' | 'checkin' | 'report' | 'info' | 'system';

export interface CreateNotificationParams {
  userId: string;
  title: string;
  body: string;
  type: NotificationType;
  data?: Record<string, string | number | boolean>;
  createdBy?: string;
}

const DEFAULT_PUSH_CHANNEL_ID = 'default';
const CHAT_PUSH_CHANNEL_ID = 'chat-messages';
const COMMISSION_PUSH_CHANNEL_ID = 'commission-updates';

function isChatNotificationPayload(data?: Record<string, string | number | boolean>): boolean {
  return Boolean(data && (data.notificationKind === 'chat' || typeof data.conversationId === 'string'));
}

function isCommissionNotificationPayload(data?: Record<string, string | number | boolean>): boolean {
  return Boolean(data && data.notificationKind === 'commission_settings');
}

function resolvePushChannelId(data?: Record<string, string | number | boolean>): string {
  if (isChatNotificationPayload(data)) {
    return CHAT_PUSH_CHANNEL_ID;
  }

  if (isCommissionNotificationPayload(data)) {
    return COMMISSION_PUSH_CHANNEL_ID;
  }

  return DEFAULT_PUSH_CHANNEL_ID;
}

function normalizeExpoPushTokens(value: unknown): string[] {
  if (typeof value === 'string' && /^(Expo|Exponent)PushToken/.test(value)) {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string => typeof item === 'string' && /^(Expo|Exponent)PushToken/.test(item)
    );
  }

  return [];
}

async function sendPushNotificationsToUsers(
  userIds: string[],
  title: string,
  body: string,
  data?: Record<string, string | number | boolean>
): Promise<void> {
  const uniqueUserIds = [...new Set(userIds.filter((userId) => typeof userId === 'string' && userId.trim().length > 0))];
  if (uniqueUserIds.length === 0) {
    return;
  }

  const userSnapshots = await Promise.all(
    uniqueUserIds.map((userId) => db.collection('users').doc(userId).get())
  );

  const messages = userSnapshots.flatMap((userDoc) => {
    if (!userDoc.exists) {
      return [];
    }

    const userData = userDoc.data() || {};
    const tokens = normalizeExpoPushTokens(userData.expoPushTokens ?? userData.lastExpoPushToken);
    const channelId = resolvePushChannelId(data);
    return tokens.map((token) => ({
      to: token,
      title,
      body,
      data: data ?? {},
      sound: 'default',
      priority: 'high' as const,
      channelId,
    }));
  });

  if (messages.length === 0) {
    return;
  }

  const abortController = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutHandle = abortController ? setTimeout(() => abortController.abort(), 5000) : null;

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
      signal: abortController?.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn('[notification.util] Expo push send failed:', errorText);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (!/timed out|aborted/i.test(message)) {
      console.warn('[notification.util] Expo push send threw:', error);
    }
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export async function getAdminUserIds(): Promise<string[]> {
  const snapshot = await db.collection('users').where('role', 'in', ['admin', 'Admin', 'ADMIN']).get();
  return snapshot.docs.map((doc) => doc.id);
}

/**
 * Create a notification document in Firestore (backend only).
 * Uses Admin SDK so it bypasses security rules. Same shape as frontend notifications
 * so the app can read them via subscribeMyNotifications.
 */
export async function createNotificationForUser(params: CreateNotificationParams): Promise<string> {
  const ref = await db.collection('notifications').add({
    userId: params.userId,
    title: params.title,
    body: params.body,
    type: params.type,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: params.createdBy ?? null,
    data: params.data ?? null,
  });
  return ref.id;
}

export async function createNotificationsForUsers(
  userIds: string[],
  params: Omit<CreateNotificationParams, 'userId'>
): Promise<string[]> {
  const uniqueUserIds = [...new Set(userIds.filter((userId) => typeof userId === 'string' && userId.trim().length > 0))];
  if (uniqueUserIds.length === 0) {
    return [];
  }

  const notificationIds = await Promise.all(
    uniqueUserIds.map((userId) =>
      createNotificationForUser({
        ...params,
        userId,
      })
    )
  );

  void sendPushNotificationsToUsers(uniqueUserIds, params.title, params.body, params.data).catch((error) => {
    console.warn('[notification.util] Failed to send push notifications:', error);
  });

  return notificationIds;
}

export async function createNotificationForAdmins(
  params: Omit<CreateNotificationParams, 'userId'>
): Promise<string[]> {
  const adminIds = await getAdminUserIds();
  return createNotificationsForUsers(adminIds, params);
}
