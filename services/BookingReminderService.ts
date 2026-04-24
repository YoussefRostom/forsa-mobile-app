import * as ExpoNotifications from 'expo-notifications';
import { Platform } from 'react-native';
import i18n from '../locales/i18n';

const BOOKING_REMINDER_CHANNEL_ID = 'booking-reminders';
const MIN_FUTURE_MS = 60 * 1000;

let reminderChannelReady = false;

type ReminderDateResolution = {
  eventDate: Date;
  hasExplicitTime: boolean;
} | null;

function getNotificationsModule(): typeof ExpoNotifications | null {
  return ExpoNotifications && typeof ExpoNotifications.scheduleNotificationAsync === 'function'
    ? ExpoNotifications
    : null;
}

function parsePreferredTime(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDateAndTime(dateValue: unknown, timeValue: unknown): ReminderDateResolution {
  if (typeof dateValue !== 'string' || !dateValue.trim()) {
    return null;
  }

  const dateParts = dateValue.split('-').map((part) => Number(part));
  if (dateParts.length !== 3 || dateParts.some((part) => Number.isNaN(part))) {
    return null;
  }

  const [year, month, day] = dateParts;
  const eventDate = new Date(year, month - 1, day, 9, 0, 0, 0);
  if (Number.isNaN(eventDate.getTime())) {
    return null;
  }

  if (typeof timeValue !== 'string' || !timeValue.trim()) {
    return { eventDate, hasExplicitTime: false };
  }

  const normalizedTime = timeValue.trim();

  const hour24Match = normalizedTime.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hour24Match) {
    const hours = Number(hour24Match[1]);
    const minutes = Number(hour24Match[2]);
    const seconds = Number(hour24Match[3] || 0);

    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 && seconds >= 0 && seconds <= 59) {
      eventDate.setHours(hours, minutes, seconds, 0);
      return { eventDate, hasExplicitTime: true };
    }
  }

  const hour12Match = normalizedTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (hour12Match) {
    const rawHours = Number(hour12Match[1]);
    const minutes = Number(hour12Match[2]);
    const period = hour12Match[3].toUpperCase();

    if (rawHours >= 1 && rawHours <= 12 && minutes >= 0 && minutes <= 59) {
      const hours = period === 'PM' ? (rawHours % 12) + 12 : rawHours % 12;
      eventDate.setHours(hours, minutes, 0, 0);
      return { eventDate, hasExplicitTime: true };
    }
  }

  const fallback = new Date(`${dateValue} ${normalizedTime}`);
  if (!Number.isNaN(fallback.getTime())) {
    return { eventDate: fallback, hasExplicitTime: true };
  }

  return { eventDate, hasExplicitTime: false };
}

function resolveEventDate(booking: any): ReminderDateResolution {
  const preferredTime = parsePreferredTime(booking?.preferredTime);
  if (preferredTime) {
    return { eventDate: preferredTime, hasExplicitTime: true };
  }

  return parseDateAndTime(booking?.date, booking?.time);
}

function chooseReminderDate(eventDate: Date): Date | null {
  const now = Date.now();
  const eventTime = eventDate.getTime();
  const reminderOffsetsMinutes = [120, 60, 30, 10];

  for (const offset of reminderOffsetsMinutes) {
    const candidate = eventTime - offset * 60 * 1000;
    if (candidate - now > MIN_FUTURE_MS) {
      return new Date(candidate);
    }
  }

  if (eventTime - now > MIN_FUTURE_MS) {
    return new Date(now + MIN_FUTURE_MS);
  }

  return null;
}

function getBookingLabel(booking: any): string {
  return (
    booking?.service ||
    booking?.program ||
    booking?.providerName ||
    booking?.name ||
    i18n.t('booking') ||
    'Booking'
  );
}

async function ensureReminderChannel(Notifications: typeof ExpoNotifications): Promise<void> {
  if (Platform.OS !== 'android' || reminderChannelReady) {
    return;
  }

  await Notifications.setNotificationChannelAsync(BOOKING_REMINDER_CHANNEL_ID, {
    name: 'Booking reminders',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    enableVibrate: true,
    vibrationPattern: [0, 200, 150, 200],
    lightColor: '#000000',
  });

  reminderChannelReady = true;
}

async function ensureNotificationPermission(Notifications: typeof ExpoNotifications): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === 'granted') {
    return true;
  }

  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === 'granted';
}

export async function scheduleBookingReminder(booking: any, bookingId?: string): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  const Notifications = getNotificationsModule();
  if (!Notifications) return null;

  const resolved = resolveEventDate(booking);
  if (!resolved) return null;

  const reminderDate = chooseReminderDate(resolved.eventDate);
  if (!reminderDate) return null;

  const hasPermission = await ensureNotificationPermission(Notifications);
  if (!hasPermission) return null;

  await ensureReminderChannel(Notifications);

  const bookingLabel = getBookingLabel(booking);
  const when = resolved.eventDate.toLocaleString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: resolved.hasExplicitTime ? 'numeric' : undefined,
    minute: resolved.hasExplicitTime ? '2-digit' : undefined,
  });

  const title = i18n.t('bookingReminderTitle') || 'Booking reminder';
  const body = `${bookingLabel}${when ? ` - ${when}` : ''}`;

  return Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: 'default',
      data: {
        notificationKind: 'booking_reminder',
        bookingId: bookingId || booking?.id || booking?.clientRequestId || '',
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: reminderDate,
      channelId: Platform.OS === 'android' ? BOOKING_REMINDER_CHANNEL_ID : undefined,
    },
  });
}
