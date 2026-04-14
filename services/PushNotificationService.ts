import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { arrayUnion, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

let listenersConfigured = false;
let notificationHandlerConfigured = false;
let pushSyncInFlight: Promise<string | null> | null = null;
let notificationsModuleCache: any | null | undefined;

function getNotificationsModule(): any | null {
  if (notificationsModuleCache !== undefined) {
    return notificationsModuleCache;
  }

  try {
    const optionalRequire = eval('require');
    notificationsModuleCache = optionalRequire('expo-notifications');
  } catch (error) {
    console.warn('[PushNotificationService] expo-notifications is unavailable in this build:', error);
    notificationsModuleCache = null;
  }

  return notificationsModuleCache;
}

function ensureNotificationHandler(): any | null {
  const Notifications = getNotificationsModule();
  if (!Notifications || notificationHandlerConfigured) {
    return Notifications;
  }

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  notificationHandlerConfigured = true;
  return Notifications;
}

function normalizePushTokens(value: unknown): string[] {
  if (typeof value === 'string' && value.startsWith('ExponentPushToken')) {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string => typeof item === 'string' && item.startsWith('ExponentPushToken')
    );
  }

  return [];
}

function getDefaultNotificationsRoute(role?: string | null): '/notifications' | '/(admin)/notifications' {
  return String(role || '').toLowerCase() === 'admin'
    ? '/(admin)/notifications'
    : '/notifications';
}

export function configurePushNotificationListeners(): void {
  if (listenersConfigured || Platform.OS === 'web') return;

  const Notifications = ensureNotificationHandler();
  if (!Notifications) return;

  listenersConfigured = true;

  Notifications.addNotificationResponseReceivedListener(async (response: any) => {
    try {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      const route = typeof data?.route === 'string' ? data.route : null;

      if (route) {
        router.push(route as never);
        return;
      }

      const uid = auth.currentUser?.uid;
      if (!uid) {
        router.push('/signin');
        return;
      }

      const userSnap = await getDoc(doc(db, 'users', uid));
      const role = userSnap.exists() ? String(userSnap.data()?.role || '') : '';
      router.push(getDefaultNotificationsRoute(role));
    } catch (error) {
      console.warn('[PushNotificationService] Failed to route notification response:', error);
    }
  });
}

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  try {
    const Notifications = ensureNotificationHandler();
    if (!Notifications) {
      return null;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#000000',
      });
    }

    const existingPermissions = await Notifications.getPermissionsAsync();
    let finalStatus = existingPermissions.status;

    if (finalStatus !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      finalStatus = requested.status;
    }

    if (finalStatus !== 'granted') {
      return null;
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ||
      Constants.easConfig?.projectId;

    if (!projectId) {
      console.warn('[PushNotificationService] Missing Expo projectId; cannot fetch push token.');
      return null;
    }

    const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    return tokenResponse.data || null;
  } catch (error) {
    console.warn('[PushNotificationService] Push registration failed:', error);
    return null;
  }
}

export async function syncCurrentUserPushToken(): Promise<string | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;

  if (pushSyncInFlight) {
    return pushSyncInFlight;
  }

  pushSyncInFlight = (async () => {
    configurePushNotificationListeners();
    const token = await registerForPushNotificationsAsync();

    if (!token || !auth.currentUser?.uid) {
      return token;
    }

    await setDoc(
      doc(db, 'users', auth.currentUser.uid),
      {
        expoPushTokens: arrayUnion(token),
        lastExpoPushToken: token,
        lastPushPlatform: Platform.OS,
        pushTokenUpdatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return token;
  })();

  try {
    return await pushSyncInFlight;
  } finally {
    pushSyncInFlight = null;
  }
}

export async function sendPushNotificationsToUsers(
  userIds: string[],
  title: string,
  body: string,
  data?: Record<string, string | number | boolean>
): Promise<void> {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueUserIds.length === 0) return;

  try {
    const userSnapshots = await Promise.all(
      uniqueUserIds.map((userId) => getDoc(doc(db, 'users', userId)))
    );

    const messages = userSnapshots.flatMap((userSnap) => {
      if (!userSnap.exists()) return [];

      const userData = userSnap.data();
      const tokens = normalizePushTokens(userData?.expoPushTokens ?? userData?.lastExpoPushToken);

      return tokens.map((token) => ({
        to: token,
        title,
        body,
        data: data || {},
        sound: 'default',
        priority: 'high' as const,
        channelId: 'default',
      }));
    });

    if (messages.length === 0) return;

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn('[PushNotificationService] Expo push send failed:', errorText);
    }
  } catch (error) {
    console.warn('[PushNotificationService] Unable to send push notification:', error);
  }
}

export async function sendPushNotificationToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string | number | boolean>
): Promise<void> {
  await sendPushNotificationsToUsers([userId], title, body, data);
}
