import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { formatBookingPublicId } from '../lib/bookingId';
import {
  createBackendFeatureUnavailableError,
  getBackendUrlCandidates,
  rememberWorkingBackendUrl,
} from '../lib/config';
import { db } from '../lib/firebase';
import { auth } from '../lib/firebase';
import { notifyProviderAndAdmins } from './NotificationService';
import { scheduleBookingReminder } from './BookingReminderService';

export type MonetizationEventSource = 'booking' | 'checkin';
export type MonetizationStatus =
  | 'pending'
  | 'earned'
  | 'cancelled'
  | 'refunded'
  | 'failed'
  | 'no_show'
  | 'voided';
export type PayoutStatus = 'not_ready' | 'pending' | 'processing' | 'completed' | 'held';
export type CommissionCollectionStatus = 'pending' | 'collected' | 'not_applicable';
export type CommissionPaymentStatus = 'due' | 'paid';
export type OfferingType = 'academy_group' | 'academy_private' | 'clinic_service' | 'generic';

export type MonetizationSettings = {
  currency: string;
  bookingCommission: {
    enabled: boolean;
    mode: 'percentage' | 'flat';
    value: number;
    minimumFee: number;
  };
  walkInCommission: {
    enabled: boolean;
    mode: 'percentage' | 'flat';
    value: number;
    minimumFee: number;
  };
  checkInFee: {
    enabled: boolean;
    mode: 'percentage' | 'flat';
    value: number;
    maxPerDayPerUserLocation: number;
    requireLinkedBooking: boolean;
  };
  payouts: {
    enabled: boolean;
    delayDays: number;
    minimumAmount: number;
  };
  abuse: {
    duplicateCheckInCooldownMinutes: number;
    duplicateBookingWindowMinutes: number;
  };
};

export type DashboardFilters = {
  providerQuery?: string;
  datePreset?: '1d' | '7d' | '30d' | '365d' | 'all';
  offeringType?: 'all' | OfferingType;
};

export type DashboardMetrics = {
  grossBookingValue: number;
  platformRevenue: number;
  bookingRevenue: number;
  checkInRevenue: number;
  providerNetEarnings: number;
  platformPendingCollection: number;
  platformCollected: number;
  providerPendingPayout: number;
  providerPaidOut: number;
  collectionRate: number;
  moneyStillToReceive: number;
  moneyReceived: number;
  dueRecords: any[];
  paidRecords: any[];
  pendingPayouts: number;
  completedPayouts: number;
  transactionCount: number;
  transactions: any[];
  payoutSummaries: any[];
  providerOptions: string[];
};

function isPermissionDeniedError(error: unknown) {
  if (!error || typeof error !== 'object') return false;

  const code = 'code' in error ? String((error as { code?: unknown }).code || '') : '';
  const message = 'message' in error ? String((error as { message?: unknown }).message || '') : '';
  return code === 'permission-denied' || /insufficient permissions|permission-denied/i.test(message);
}

function queueProviderPayoutSummaryRefresh(providerId?: string | null, actorId?: string) {
  if (!providerId) return;

  void refreshProviderPayoutSummary(providerId, actorId).catch((error) => {
    if (!isPermissionDeniedError(error)) {
      console.warn('[MonetizationService] Deferred payout summary refresh failed:', error);
    }
  });
}

const DEFAULT_SETTINGS: MonetizationSettings = {
  currency: 'EGP',
  bookingCommission: {
    enabled: true,
    mode: 'percentage',
    value: 15,
    minimumFee: 0,
  },
  walkInCommission: {
    enabled: true,
    mode: 'percentage',
    value: 15,
    minimumFee: 0,
  },
  checkInFee: {
    enabled: true,
    mode: 'flat',
    value: 10,
    maxPerDayPerUserLocation: 1,
    requireLinkedBooking: false,
  },
  payouts: {
    enabled: true,
    delayDays: 7,
    minimumAmount: 0,
  },
  abuse: {
    duplicateCheckInCooldownMinutes: 5,
    duplicateBookingWindowMinutes: 15,
  },
};

const asNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const formatDateAsLocalYMD = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getLocalDateInput = (value: Date = new Date()): string => formatDateAsLocalYMD(value);

const normalizeBookingStatus = (status?: string) => String(status || 'pending').toLowerCase();

const getDateValue = (value: any): Date => {
  if (!value) return new Date(0);
  if (typeof value?.toDate === 'function') return value.toDate();
  if (value?.seconds) return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
};

const inferOfferingType = (booking: any): OfferingType => {
  const type = String(booking?.type || '').toLowerCase();
  const sessionType = String(booking?.sessionType || '').toLowerCase();

  if (type === 'academy' && sessionType === 'private') return 'academy_private';
  if (type === 'academy') return 'academy_group';
  if (type === 'clinic') return 'clinic_service';
  return 'generic';
};

const resolveBookingGrossAmount = (booking: any): number => {
  // Different booking flows persist amount under different keys.
  const candidates = [
    booking?.price,
    booking?.fee,
    booking?.amount,
    booking?.totalPrice,
    booking?.servicePrice,
    booking?.programFee,
  ];

  for (const candidate of candidates) {
    const n = asNumber(candidate, NaN);
    if (Number.isFinite(n) && n > 0) {
      return roundMoney(n);
    }
  }

  return 0;
};

const getCommissionPaymentStatus = (item: any): CommissionPaymentStatus | null => {
  const next = String(item?.commissionPaymentStatus || '').toLowerCase();
  if (next === 'due' || next === 'paid') return next as CommissionPaymentStatus;

  // Backward compatibility with older fields.
  const legacy = String(item?.commissionCollectionStatus || '').toLowerCase();
  if (legacy === 'collected') return 'paid';
  if (legacy === 'pending') return 'due';
  return null;
};

const calculateFeeAmount = (
  grossAmount: number,
  config: { enabled: boolean; mode: 'percentage' | 'flat'; value: number; minimumFee?: number }
) => {
  if (!config.enabled) return 0;
  const calculated = config.mode === 'flat' ? config.value : (grossAmount * config.value) / 100;
  return roundMoney(Math.max(calculated, config.minimumFee || 0));
};

const buildDateRange = (preset: DashboardFilters['datePreset']) => {
  if (!preset || preset === 'all') return null;
  const days = preset === '1d' ? 1 : preset === '7d' ? 7 : preset === '30d' ? 30 : 365;
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - days);
  return threshold;
};

const parseLooseDate = (value: any): Date | null => {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (value?.seconds) return new Date(value.seconds * 1000);

  const raw = String(value).trim();
  if (!raw) return null;

  const dmy = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]) - 1;
    const year = dmy[3].length === 2 ? Number(`20${dmy[3]}`) : Number(dmy[3]);
    const parsed = new Date(year, month, day, 0, 0, 0, 0);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeBookingDateInput = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;

  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : trimmed;
  }

  const parsed = parseLooseDate(trimmed);
  return parsed ? formatDateAsLocalYMD(parsed) : null;
};

function normalizeBookingForCreation(booking: any) {
  const type = String(booking?.type || '').toLowerCase();
  if (type !== 'academy' && type !== 'clinic') {
    throw new Error('Booking type must be academy or clinic.');
  }

  const providerId = String(booking?.providerId || '').trim();
  if (!providerId) {
    throw new Error('Booking is missing a provider.');
  }

  const providerName = String(booking?.providerName || booking?.name || '').trim();
  if (!providerName) {
    throw new Error('Booking is missing a provider name.');
  }

  const customerId = [booking?.playerId, booking?.parentId, booking?.userId, booking?.academyId].find(
    (value) => typeof value === 'string' && value.trim().length > 0
  );
  if (!customerId) {
    throw new Error('Booking is missing a customer reference.');
  }

  const customerName = String(
    booking?.customerName || booking?.playerName || booking?.parentName || booking?.academyName || ''
  ).trim();
  if (!customerName) {
    throw new Error('Booking is missing a customer name.');
  }

  const date = normalizeBookingDateInput(booking?.date);
  if (!date) {
    throw new Error('Booking date is invalid.');
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const bookingDate = new Date(`${date}T00:00:00`);
  if (bookingDate < startOfToday) {
    throw new Error('Booking date cannot be in the past.');
  }

  const price = asNumber(booking?.price, NaN);
  if (!Number.isFinite(price) || price < 0) {
    throw new Error('Booking price is invalid.');
  }

  const createdAt =
    typeof booking?.createdAt === 'string' && !Number.isNaN(new Date(booking.createdAt).getTime())
      ? booking.createdAt
      : new Date().toISOString();

  const preferredTime =
    typeof booking?.preferredTime === 'string' && !Number.isNaN(new Date(booking.preferredTime).getTime())
      ? booking.preferredTime
      : null;

  const comments =
    typeof booking?.comments === 'string' ? booking.comments.trim() || null : (booking?.comments ?? null);

  return {
    ...booking,
    type,
    status: 'pending',
    providerId,
    providerName,
    customerName,
    name: String(booking?.name || providerName).trim(),
    date,
    price: roundMoney(price),
    createdAt,
    preferredTime,
    comments,
  };
}

function buildBookingTransactionPayload(
  bookingId: string,
  booking: any,
  settings: MonetizationSettings,
  actorId?: string | null,
  reason?: string,
  existingTransaction?: any | null
) {
  const snapshot = buildBookingMonetizationSnapshot(booking, settings);
  const nextPaymentStatus: CommissionPaymentStatus | null =
    snapshot.status === 'earned' && snapshot.platformRevenueAmount > 0
      ? (getCommissionPaymentStatus(existingTransaction) === 'paid' ? 'paid' : 'due')
      : null;

  return {
    type: 'booking_commission',
    revenueSource: 'booking' as MonetizationEventSource,
    bookingId,
    checkInId: null,
    providerId: booking.providerId || null,
    providerName: booking.providerName || booking.name || 'Unknown provider',
    providerRole: booking.type || null,
    customerId: booking.playerId || booking.parentId || booking.userId || booking.academyId || null,
    customerName: booking.customerName || booking.playerName || booking.parentName || null,
    createdBy: actorId || booking.playerId || booking.parentId || booking.userId || booking.academyId || booking.providerId || null,
    notes: reason || null,
    bookingStatus: normalizeBookingStatus(booking.status),
    date: booking.date || null,
    serviceName: booking.service || booking.program || booking.sessionType || 'Booking service',
    commissionPercentage: settings.bookingCommission.mode === 'percentage' ? settings.bookingCommission.value : null,
    attendanceVerifiedAt: booking.checkedInAt || booking.lastCheckInAt || null,
    referenceCode: bookingId,
    commissionPaymentStatus: nextPaymentStatus,
    commissionPaidAt:
      nextPaymentStatus === 'paid'
        ? (existingTransaction?.commissionPaidAt || existingTransaction?.commissionCollectedAt || null)
        : null,
    commissionPaidBy:
      nextPaymentStatus === 'paid'
        ? (existingTransaction?.commissionPaidBy || existingTransaction?.commissionCollectedBy || null)
        : null,
    commissionCollectionStatus:
      nextPaymentStatus === 'paid'
        ? 'collected'
        : nextPaymentStatus === 'due'
          ? 'pending'
          : 'not_applicable',
    commissionCollectedAt:
      nextPaymentStatus === 'paid'
        ? (existingTransaction?.commissionCollectedAt || existingTransaction?.commissionPaidAt || null)
        : null,
    commissionCollectedBy:
      nextPaymentStatus === 'paid'
        ? (existingTransaction?.commissionCollectedBy || existingTransaction?.commissionPaidBy || null)
        : null,
    createdAt: existingTransaction?.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...snapshot,
  };
}

export async function getMonetizationSettings(): Promise<MonetizationSettings> {
  try {
    const settingsRef = doc(db, 'settings', 'admin');
    const snap = await getDoc(settingsRef);
    if (!snap.exists()) {
      return DEFAULT_SETTINGS;
    }

    const raw = snap.data() || {};
    const legacyCommission = asNumber(raw.commissionRate, DEFAULT_SETTINGS.bookingCommission.value);

    return {
      currency: raw.currency || DEFAULT_SETTINGS.currency,
      bookingCommission: {
        enabled: raw.bookingCommission?.enabled ?? true,
        mode: raw.bookingCommission?.mode === 'flat' ? 'flat' : 'percentage',
        value: asNumber(raw.bookingCommission?.value, legacyCommission),
        minimumFee: asNumber(raw.bookingCommission?.minimumFee, 0),
      },
      walkInCommission: {
        enabled: raw.walkInCommission?.enabled ?? raw.checkInCommission?.enabled ?? true,
        mode:
          raw.walkInCommission?.mode === 'flat'
            ? 'flat'
            : raw.checkInCommission?.mode === 'flat'
              ? 'flat'
              : 'percentage',
        value: asNumber(
          raw.walkInCommission?.value,
          asNumber(raw.checkInCommission?.value, DEFAULT_SETTINGS.walkInCommission.value)
        ),
        minimumFee: asNumber(raw.walkInCommission?.minimumFee, 0),
      },
      checkInFee: {
        enabled: raw.checkInFee?.enabled ?? true,
        mode: raw.checkInFee?.mode === 'percentage' ? 'percentage' : 'flat',
        value: asNumber(raw.checkInFee?.value, DEFAULT_SETTINGS.checkInFee.value),
        maxPerDayPerUserLocation: asNumber(
          raw.checkInFee?.maxPerDayPerUserLocation,
          DEFAULT_SETTINGS.checkInFee.maxPerDayPerUserLocation
        ),
        requireLinkedBooking: raw.checkInFee?.requireLinkedBooking ?? DEFAULT_SETTINGS.checkInFee.requireLinkedBooking,
      },
      payouts: {
        enabled: raw.payouts?.enabled ?? true,
        delayDays: asNumber(raw.payouts?.delayDays, DEFAULT_SETTINGS.payouts.delayDays),
        minimumAmount: asNumber(raw.payouts?.minimumAmount, DEFAULT_SETTINGS.payouts.minimumAmount),
      },
      abuse: {
        duplicateCheckInCooldownMinutes: asNumber(
          raw.abuse?.duplicateCheckInCooldownMinutes,
          DEFAULT_SETTINGS.abuse.duplicateCheckInCooldownMinutes
        ),
        duplicateBookingWindowMinutes: asNumber(
          raw.abuse?.duplicateBookingWindowMinutes,
          DEFAULT_SETTINGS.abuse.duplicateBookingWindowMinutes
        ),
      },
    };
  } catch (error) {
    console.error('[MonetizationService] Failed to load settings:', error);
    return DEFAULT_SETTINGS;
  }
}

export async function saveMonetizationSettings(partial: Partial<MonetizationSettings>) {
  const current = await getMonetizationSettings();
  const next: MonetizationSettings = {
    ...current,
    ...partial,
    bookingCommission: { ...current.bookingCommission, ...(partial.bookingCommission || {}) },
    walkInCommission: { ...current.walkInCommission, ...(partial.walkInCommission || {}) },
    checkInFee: { ...current.checkInFee, ...(partial.checkInFee || {}) },
    payouts: { ...current.payouts, ...(partial.payouts || {}) },
    abuse: { ...current.abuse, ...(partial.abuse || {}) },
  };

  await setDoc(
    doc(db, 'settings', 'admin'),
    {
      currency: next.currency,
      commissionRate: next.bookingCommission.value,
      bookingCommission: next.bookingCommission,
      walkInCommission: next.walkInCommission,
      checkInFee: next.checkInFee,
      payouts: next.payouts,
      abuse: next.abuse,
      monetizationUpdatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return next;
}

export async function applyBookingCommissionToUpcomingTransactions(
  bookingCommission: MonetizationSettings['bookingCommission'],
  actorId?: string | null
) {
  const txSnap = await getDocs(collection(db, 'transactions'));
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

  let updatedCount = 0;

  await Promise.all(
    txSnap.docs.map(async (docSnap) => {
      const tx = docSnap.data() as any;
      if (tx.revenueSource !== 'booking') return;

      const bookingStatus = normalizeBookingStatus(tx.bookingStatus || tx.status);
      const monetizationStatus = String(tx.status || '').toLowerCase();
      const paymentStatus = getCommissionPaymentStatus(tx);
      const isCollected = String(tx.commissionCollectionStatus || '').toLowerCase() === 'collected';

      // Only upcoming mutable bookings are recalculated.
      // Skip confirmed, completed/recent, paid/collected records.
      if (!['pending', 'new_time_proposed'].includes(bookingStatus)) return;
      if (bookingStatus === 'confirmed') return;
      if (monetizationStatus !== 'pending') return;
      if (paymentStatus === 'paid' || isCollected) return;
      if (tx.attendanceVerifiedAt || tx.checkInId) return;

      const bookingDate = parseLooseDate(tx.date);
      if (bookingDate && bookingDate < startOfToday) return;

      const grossAmount = asNumber(tx.grossAmount, 0);
      const nextBookingCommissionAmount = calculateFeeAmount(grossAmount, bookingCommission);

      await updateDoc(doc(db, 'transactions', docSnap.id), {
        bookingCommissionAmount: nextBookingCommissionAmount,
        commissionPercentage: bookingCommission.mode === 'percentage' ? bookingCommission.value : null,
        updatedAt: serverTimestamp(),
        notes: 'Booking commission updated from latest admin settings (upcoming only).',
        updatedBy: actorId || null,
      });

      updatedCount += 1;
    })
  );

  return { updatedCount };
}

export function buildBookingMonetizationSnapshot(booking: any, settings: MonetizationSettings) {
  const grossAmount = resolveBookingGrossAmount(booking);
  const bookingCommissionAmount = calculateFeeAmount(grossAmount, settings.bookingCommission);
  const providerNetBase = roundMoney(Math.max(grossAmount - bookingCommissionAmount, 0));
  const offeringType = inferOfferingType(booking);
  const normalizedStatus = normalizeBookingStatus(booking?.status);

  const hasAttendanceProof = Boolean(booking?.checkedInAt || booking?.lastCheckInId || booking?.attendanceConfirmed === true);
  const isCancelledLike = ['cancelled', 'refunded', 'failed_payment', 'failed', 'no_show'].includes(normalizedStatus);

  // Booking commission is recognized only after an actual attendance check-in.
  const isRevenueActive = hasAttendanceProof && !isCancelledLike;

  const status: MonetizationStatus =
    normalizedStatus === 'cancelled'
      ? 'cancelled'
      : normalizedStatus === 'refunded'
        ? 'refunded'
        : normalizedStatus === 'no_show'
          ? 'no_show'
          : normalizedStatus === 'failed_payment' || normalizedStatus === 'failed'
            ? 'failed'
            : isRevenueActive
              ? 'earned'
              : 'pending';

  const platformRevenueAmount = isRevenueActive ? bookingCommissionAmount : 0;
  const providerNetAmount = isRevenueActive ? providerNetBase : 0;
  const payoutStatus: PayoutStatus =
    status === 'earned'
      ? 'pending'
      : status === 'pending'
        ? 'not_ready'
        : status === 'no_show'
          ? 'held'
          : 'not_ready';

  return {
    currency: settings.currency,
    offeringType,
    grossAmount,
    bookingCommissionAmount,
    checkInFeeAmount: 0,
    platformRevenueAmount,
    providerNetAmount,
    status,
    payoutStatus,
    paymentStatus:
      status === 'refunded'
        ? 'refunded'
        : status === 'failed'
          ? 'failed'
          : status === 'earned'
            ? 'paid'
            : 'pending',
    refundAmount: status === 'refunded' ? grossAmount : 0,
  };
}

export async function upsertBookingTransaction(
  bookingId: string,
  booking: any,
  actorId?: string | null,
  reason?: string
) {
  if (!bookingId || !booking) return null;

  try {
    const settings = await getMonetizationSettings();
    const transactionId = `booking_${bookingId}`;
    const existingTransactionSnap = await getDoc(doc(db, 'transactions', transactionId));
    const existingTransaction = existingTransactionSnap.exists() ? (existingTransactionSnap.data() as any) : null;

    const payload = buildBookingTransactionPayload(bookingId, booking, settings, actorId, reason, existingTransaction);
    const snapshot = buildBookingMonetizationSnapshot(booking, settings);

    await setDoc(doc(db, 'transactions', transactionId), payload, { merge: true });

    const wasEarnedBefore = String(existingTransaction?.status || '').toLowerCase() === 'earned';
    const isEarnedNow = String(snapshot.status || '').toLowerCase() === 'earned';
    if (!wasEarnedBefore && isEarnedNow && Number(snapshot.platformRevenueAmount || 0) > 0) {
      try {
        if (payload.providerId) {
          await notifyProviderAndAdmins(
            payload.providerId,
            'Commission due',
            `${payload.providerName || 'Provider'} owes ${snapshot.platformRevenueAmount} ${payload.currency || 'EGP'} commission for ${payload.serviceName || 'service'} after attendance check-in.`,
            'booking',
            {
              transactionId,
              bookingId,
              providerId: payload.providerId || '',
              providerName: payload.providerName || '',
              providerRole: String(payload.providerRole || ''),
              serviceName: String(payload.serviceName || ''),
              platformRevenueAmount: snapshot.platformRevenueAmount,
              currency: payload.currency || 'EGP',
            }
          );
        }
      } catch (notifyError) {
        const message = notifyError instanceof Error ? notifyError.message : String(notifyError || '');
        if (!/timed out|aborted/i.test(message)) {
          console.warn('[MonetizationService] Failed to notify admins about booking commission:', notifyError);
        }
      }
    }

    await refreshProviderPayoutSummary(booking.providerId, actorId || undefined);
    return { id: transactionId, ...payload };
  } catch (error) {
    console.warn('[MonetizationService] Booking transaction sync skipped:', error);
    return null;
  }
}

export async function createBookingWithTransaction(
  booking: any,
  actorId?: string | null,
  reason?: string
) {
  const normalizedBooking = normalizeBookingForCreation(booking);
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Must be authenticated to create booking');
  }

  const bookingRequestBody = JSON.stringify({
    ...normalizedBooking,
    reason: reason || null,
  });

  const candidateUrls = getBackendUrlCandidates();
  if (candidateUrls.length === 0) {
    throw createBackendFeatureUnavailableError('Booking requests');
  }

  const sendBookingRequest = async (backendUrl: string, idToken: string) => {
    const abortController = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutHandle = abortController ? setTimeout(() => abortController.abort(), 25000) : null;

    try {
      const response = await fetch(`${backendUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: bookingRequestBody,
        signal: abortController?.signal,
      });

      return response;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  };

  try {
    let idToken = await user.getIdToken(true);
    let lastError: Error | null = null;

    for (const backendUrl of candidateUrls) {
      try {
        let response: Response | null = null;
        let payload: any = {};

        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            response = await sendBookingRequest(backendUrl, idToken);
            payload = await response.json().catch(() => ({}));
            break;
          } catch (requestError: any) {
            const message = requestError instanceof Error ? requestError.message : String(requestError || '');

            if (requestError?.name === 'AbortError' || /network request failed|network request timed out|timed out|failed to fetch/i.test(message)) {
              lastError = new Error(`Booking service unreachable at ${backendUrl}`);
              if (attempt === 0) {
                continue;
              }
            }

            throw requestError;
          }
        }

        if (!response) {
          continue;
        }

        if (
          response.status === 401 &&
          /invalid or expired token/i.test(String(payload?.error?.message || payload?.message || ''))
        ) {
          await user.reload();
          idToken = await user.getIdToken(true);
          response = await sendBookingRequest(backendUrl, idToken);
          payload = await response.json().catch(() => ({}));
        }

        if (!response.ok) {
          throw new Error(payload?.error?.message || payload?.message || 'Failed to create booking');
        }

        rememberWorkingBackendUrl(backendUrl);
          const createdBooking = payload?.data || null;

          void scheduleBookingReminder(
            {
              ...normalizedBooking,
              ...(createdBooking || {}),
            },
            createdBooking?.id
          ).catch((reminderError) => {
            console.warn('[MonetizationService] Booking reminder scheduling failed:', reminderError);
          });

          return createdBooking;
      } catch (error: any) {
        if (error?.name === 'AbortError') {
          lastError = new Error(`Booking service timed out at ${backendUrl}`);
          continue;
        }

        const message = error instanceof Error ? error.message : String(error || '');
        if (/network request failed|network request timed out|timed out|failed to fetch/i.test(message)) {
          lastError = new Error(`Booking service unreachable at ${backendUrl}`);
          continue;
        }

        throw error;
      }
    }

    throw lastError || new Error('Failed to create booking');
  } catch (error: any) {
    if (error instanceof Error) {
      throw error;
    }

    throw new Error('Booking service unreachable');
  }
}

async function findRelatedBookingForCheckIn(userId: string, providerId: string) {
  try {
    const snap = await getDocs(query(collection(db, 'bookings'), where('providerId', '==', providerId)));
    const candidates = snap.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .filter((booking: any) => {
        const bookingStatus = normalizeBookingStatus(booking.status);
        return (
          [booking.playerId, booking.parentId, booking.userId, booking.academyId].includes(userId) &&
          !['cancelled', 'refunded', 'failed', 'failed_payment'].includes(bookingStatus)
        );
      })
      .sort((a: any, b: any) => getDateValue(b.createdAt).getTime() - getDateValue(a.createdAt).getTime());

    return candidates[0] || null;
  } catch (error) {
    console.warn('[MonetizationService] Failed to find related booking for check-in:', error);
    return null;
  }
}

async function hasChargeableCheckInForKey(abuseKey: string, providerId?: string | null) {
  try {
    if (!providerId) {
      return false;
    }

    const snap = await getDocs(
      query(
        collection(db, 'transactions'),
        where('providerId', '==', providerId),
        where('abuseKey', '==', abuseKey)
      )
    );
    return snap.docs.some((docSnap) => {
      const data = docSnap.data();
      return data.revenueSource === 'checkin' && !['voided', 'cancelled', 'refunded'].includes(String(data.status || '').toLowerCase());
    });
  } catch (error) {
    console.warn('[MonetizationService] Failed to inspect abuse key:', error);
    return false;
  }
}

export async function registerCheckInMonetization(
  checkInId: string,
  checkIn: any,
  actorId?: string | null
) {
  if (!checkInId || !checkIn) return null;

  const settings = await getMonetizationSettings();

  let relatedBooking: any = null;
  const explicitBookingId = checkIn?.meta?.linkedBookingId || null;

  // Only link to a booking when a bookingId was explicitly embedded in the scanned QR.
  // Personal code scans (reusable signup code) must NEVER auto-link to old bookings;
  // they are always walk-in visits and their revenue comes from the walk-in service details.
  if (explicitBookingId) {
    try {
      const explicitSnap = await getDoc(doc(db, 'bookings', explicitBookingId));
      if (explicitSnap.exists()) {
        relatedBooking = { id: explicitSnap.id, ...explicitSnap.data() };
      }
    } catch (error) {
      console.warn('[MonetizationService] Failed to fetch explicit linked booking:', error);
    }
  }
  // No fallback booking lookup — walk-in revenue is fully captured from walkInGrossAmount + walkInCommissionPercentage.

  const walkInGrossAmount = asNumber(checkIn?.meta?.walkInGrossAmount, 0);
  const walkInCommissionPercentage = asNumber(checkIn?.meta?.walkInCommissionPercentage, 0);
  const hasWalkInDetails = walkInGrossAmount > 0 && walkInCommissionPercentage > 0;

  if (settings.checkInFee.requireLinkedBooking && !relatedBooking && !hasWalkInDetails) {
    return null;
  }

  const grossAmount = relatedBooking ? resolveBookingGrossAmount(relatedBooking) : walkInGrossAmount;
  const walkInCommissionAmount = hasWalkInDetails ? roundMoney((grossAmount * walkInCommissionPercentage) / 100) : 0;

  const checkInDate = getDateValue(checkIn.createdAt || new Date());
  const dateKey = `${checkInDate.getFullYear()}-${String(checkInDate.getMonth() + 1).padStart(2, '0')}-${String(checkInDate.getDate()).padStart(2, '0')}`;
  const abuseKey = `${checkIn.userId}_${checkIn.locationId}_${dateKey}`;

  // Daily duplicate-charge protection should only apply to booking-attendance records.
  // Walk-in services are explicit paid services selected by staff and can occur multiple times per day.
  const applyDailyDuplicateGuard = Boolean(relatedBooking);
  const alreadyCharged = applyDailyDuplicateGuard ? await hasChargeableCheckInForKey(abuseKey, checkIn.locationId) : false;
  const status: MonetizationStatus = alreadyCharged ? 'voided' : 'earned';
  const payoutStatus: PayoutStatus = alreadyCharged ? 'held' : 'pending';

  // For app bookings: check-in is attendance proof, commission is recognized in booking transaction.
  // For walk-ins: commission is captured directly using the provided service amount + percentage.
  const platformRevenueAmount = relatedBooking
    ? 0
    : status === 'earned'
      ? walkInCommissionAmount
      : 0;
  const providerNetAmount = status === 'earned' ? roundMoney(Math.max(grossAmount - platformRevenueAmount, 0)) : 0;

  const payload = {
    type: relatedBooking ? 'checkin_attendance' : 'walkin_commission',
    revenueSource: 'checkin' as MonetizationEventSource,
    source: relatedBooking ? 'in_app_booking' : 'walkin_offline',
    checkInId,
    providerId: checkIn.locationId || null,
    providerName: checkIn.locationName || relatedBooking?.providerName || 'Unknown provider',
    providerRole: checkIn.locationRole || relatedBooking?.type || null,
    customerId: checkIn.userId || null,
    customerName: checkIn.userName || relatedBooking?.customerName || null,
    offeringType: relatedBooking ? inferOfferingType(relatedBooking) : 'generic',
    grossAmount,
    bookingCommissionAmount: 0,
    checkInFeeAmount: 0,
    walkInCommissionPercentage: relatedBooking ? null : walkInCommissionPercentage,
    walkInServiceName: checkIn?.meta?.walkInServiceName || null,
    walkInCustomerType: checkIn?.meta?.walkInCustomerType || null,
    serviceName: checkIn?.meta?.walkInServiceName || (relatedBooking?.service || relatedBooking?.program || 'Service'),
    commissionPercentage: relatedBooking ? null : walkInCommissionPercentage,
    platformRevenueAmount,
    providerNetAmount,
    currency: settings.currency,
    status,
    payoutStatus,
    paymentStatus: status === 'earned' ? 'paid' : 'pending',
    attendanceVerifiedAt: checkIn.createdAt || serverTimestamp(),
    referenceCode: relatedBooking?.id || checkInId,
    commissionPaymentStatus: status === 'earned' && platformRevenueAmount > 0 ? ('due' as CommissionPaymentStatus) : null,
    commissionPaidAt: null,
    commissionPaidBy: null,
    commissionCollectionStatus: status === 'earned' && platformRevenueAmount > 0 ? 'pending' as CommissionCollectionStatus : 'not_applicable' as CommissionCollectionStatus,
    commissionCollectedAt: null,
    commissionCollectedBy: null,
    refundAmount: 0,
    bookingStatus: relatedBooking ? normalizeBookingStatus(relatedBooking.status) : 'completed',
    abuseKey,
    createdBy: actorId || checkIn.createdBy || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    notes: alreadyCharged
      ? 'Duplicate same-day check-in fee prevented.'
      : relatedBooking
        ? 'Attendance check-in captured for app booking.'
        : 'Walk-in service commission captured from scanner input.',
  };

  const persistedPayload = relatedBooking?.id
    ? { ...payload, bookingId: relatedBooking.id }
    : payload;

  await setDoc(doc(db, 'transactions', `checkin_${checkInId}`), persistedPayload, { merge: true });

  if (status === 'earned' && platformRevenueAmount > 0) {
    try {
      if (persistedPayload.providerId) {
        await notifyProviderAndAdmins(
          persistedPayload.providerId,
          'Commission due',
          `${persistedPayload.providerName || 'Provider'} owes ${platformRevenueAmount} ${persistedPayload.currency || 'EGP'} commission for ${persistedPayload.walkInServiceName || persistedPayload.serviceName || 'a check-in service'}. Mark it collected when received.`,
          'checkin',
          {
            transactionId: `checkin_${checkInId}`,
            checkInId,
            providerId: persistedPayload.providerId || '',
            providerName: persistedPayload.providerName || '',
            providerRole: String(persistedPayload.providerRole || ''),
            serviceName: String(persistedPayload.walkInServiceName || persistedPayload.serviceName || ''),
            platformRevenueAmount,
            currency: persistedPayload.currency || 'EGP',
          }
        );
      }
    } catch (notifyError) {
      const message = notifyError instanceof Error ? notifyError.message : String(notifyError || '');
      if (!/timed out|aborted/i.test(message)) {
        console.warn('[MonetizationService] Failed to notify admins about pending commission:', notifyError);
      }
    }
  }

  if (relatedBooking?.id) {
    try {
      await updateDoc(doc(db, 'bookings', relatedBooking.id), {
        status: 'completed',
        attendanceStatus: 'checked_in',
        source: 'in_app_booking',
        checkedInAt: serverTimestamp(),
        checkedInBy: actorId || checkIn.createdBy || null,
        lastCheckInId: checkInId,
        lastCheckInAt: serverTimestamp(),
      });
      await upsertBookingTransaction(
        relatedBooking.id,
        {
          ...relatedBooking,
          status: 'completed',
          checkedInAt: checkIn.createdAt || new Date(),
          lastCheckInId: checkInId,
        },
        actorId || checkIn.createdBy,
        'Completed automatically after successful check-in'
      );
    } catch (error) {
      console.warn('[MonetizationService] Failed to mark linked booking as completed:', error);
    }
  }

  queueProviderPayoutSummaryRefresh(checkIn.locationId, actorId || undefined);
  return { id: `checkin_${checkInId}`, ...persistedPayload };
}

export async function refreshProviderPayoutSummary(providerId?: string | null, actorId?: string) {
  if (!providerId) return null;

  try {
    const snap = await getDocs(query(collection(db, 'transactions'), where('providerId', '==', providerId)));
    const allTransactions: any[] = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));

    const pendingTransactions = allTransactions.filter((item: any) => item.payoutStatus === 'pending');
    const completedTransactions = allTransactions.filter((item: any) => item.payoutStatus === 'completed');

    const pendingNetAmount = roundMoney(
      pendingTransactions.reduce((sum: number, item: any) => sum + asNumber(item.providerNetAmount, 0), 0)
    );
    const completedNetAmount = roundMoney(
      completedTransactions.reduce((sum: number, item: any) => sum + asNumber(item.providerNetAmount, 0), 0)
    );

    const summary = {
      providerId,
      providerName: allTransactions[0]?.providerName || 'Unknown provider',
      providerRole: allTransactions[0]?.providerRole || null,
      recordType: 'summary',
      pendingNetAmount,
      completedNetAmount,
      pendingCount: pendingTransactions.length,
      completedCount: completedTransactions.length,
      status: pendingNetAmount > 0 ? 'pending' : completedNetAmount > 0 ? 'completed' : 'idle',
      lastUpdatedAt: serverTimestamp(),
      updatedBy: actorId || null,
    };

    await setDoc(doc(db, 'payouts', `summary_${providerId}`), summary, { merge: true });
    return summary;
  } catch (error) {
    if (!isPermissionDeniedError(error)) {
      console.error('[MonetizationService] Failed to refresh payout summary:', error);
    }
    return null;
  }
}

export async function completeProviderPayout(summaryId: string, actorId?: string | null) {
  const summaryRef = doc(db, 'payouts', summaryId);
  const summarySnap = await getDoc(summaryRef);
  if (!summarySnap.exists()) {
    throw new Error('Payout summary not found');
  }

  const summary = summarySnap.data();
  const providerId = summary.providerId;
  if (!providerId) {
    throw new Error('Missing provider reference on payout summary');
  }

  const txSnap = await getDocs(query(collection(db, 'transactions'), where('providerId', '==', providerId)));
  const pendingTransactions = txSnap.docs.filter((docSnap) => docSnap.data().payoutStatus === 'pending');

  if (!pendingTransactions.length) {
    return null;
  }

  const transactionIds: string[] = [];
  let batchAmount = 0;

  await Promise.all(
    pendingTransactions.map(async (docSnap) => {
      transactionIds.push(docSnap.id);
      batchAmount += asNumber(docSnap.data().providerNetAmount, 0);
      await updateDoc(doc(db, 'transactions', docSnap.id), {
        payoutStatus: 'completed',
        payoutCompletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    })
  );

  const payoutBatch = {
    providerId,
    providerName: summary.providerName || 'Unknown provider',
    providerRole: summary.providerRole || null,
    recordType: 'batch',
    status: 'completed',
    transactionIds,
    grossProviderNetAmount: roundMoney(batchAmount),
    processedAt: serverTimestamp(),
    processedBy: actorId || null,
  };

  const batchRef = await addDoc(collection(db, 'payouts'), payoutBatch);
  await refreshProviderPayoutSummary(providerId, actorId || undefined);
  return { id: batchRef.id, ...payoutBatch };
}

export async function markCommissionAsCollected(transactionId: string, actorId?: string | null) {
  if (!transactionId) throw new Error('Missing transaction id');

  const txRef = doc(db, 'transactions', transactionId);
  const txSnap = await getDoc(txRef);
  if (!txSnap.exists()) {
    throw new Error('Transaction not found');
  }

  const tx = txSnap.data() as any;
  const revenue = asNumber(tx.platformRevenueAmount, 0);
  if (revenue <= 0) {
    return null;
  }

  await updateDoc(txRef, {
    commissionPaymentStatus: 'paid',
    commissionPaidAt: serverTimestamp(),
    commissionPaidBy: actorId || null,
    commissionCollectionStatus: 'collected',
    commissionCollectedAt: serverTimestamp(),
    commissionCollectedBy: actorId || null,
    updatedAt: serverTimestamp(),
  });

  return { id: transactionId, commissionCollectionStatus: 'collected' };
}

export async function backfillVoidedCheckInProviderNet(actorId?: string | null) {
  const txSnap = await getDocs(collection(db, 'transactions'));
  let updatedCount = 0;
  const touchedProviders = new Set<string>();

  await Promise.all(
    txSnap.docs.map(async (docSnap) => {
      const tx = docSnap.data() as any;
      const source = String(tx?.revenueSource || '').toLowerCase();
      const status = String(tx?.status || '').toLowerCase();
      const providerNet = asNumber(tx?.providerNetAmount, 0);

      if (source !== 'checkin') return;
      if (!['voided', 'cancelled', 'refunded'].includes(status)) return;
      if (providerNet === 0) return;

      await updateDoc(doc(db, 'transactions', docSnap.id), {
        providerNetAmount: 0,
        updatedAt: serverTimestamp(),
        notes: 'Backfill: corrected non-earned check-in provider net to 0.',
        updatedBy: actorId || null,
      });

      updatedCount += 1;
      if (tx?.providerId) touchedProviders.add(String(tx.providerId));
    })
  );

  await Promise.all(Array.from(touchedProviders).map((providerId) => refreshProviderPayoutSummary(providerId, actorId || undefined)));

  return { updatedCount, affectedProviders: touchedProviders.size };
}

export async function getMonetizationDashboardData(filters: DashboardFilters = {}): Promise<DashboardMetrics> {
  const dateThreshold = buildDateRange(filters.datePreset || '30d');

  const [transactionsSnap, payoutsSnap] = await Promise.all([
    getDocs(collection(db, 'transactions')),
    getDocs(collection(db, 'payouts')),
  ]);

  let transactions = transactionsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  let payoutSummaries = payoutsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));

  if (filters.providerQuery?.trim()) {
    const queryText = filters.providerQuery.trim().toLowerCase();
    transactions = transactions.filter((item: any) =>
      String(item.providerName || '').toLowerCase().includes(queryText) ||
      String(item.providerId || '').toLowerCase().includes(queryText)
    );
    payoutSummaries = payoutSummaries.filter((item: any) =>
      String(item.providerName || '').toLowerCase().includes(queryText) ||
      String(item.providerId || '').toLowerCase().includes(queryText)
    );
  }

  if (filters.offeringType && filters.offeringType !== 'all') {
    transactions = transactions.filter((item: any) => item.offeringType === filters.offeringType);
  }

  if (dateThreshold) {
    transactions = transactions.filter((item: any) => getDateValue(item.updatedAt || item.createdAt) >= dateThreshold);
    payoutSummaries = payoutSummaries.filter((item: any) => {
      const hasPending = item.recordType === 'summary' && asNumber(item.pendingNetAmount, 0) > 0;
      return hasPending || getDateValue(item.lastUpdatedAt || item.processedAt) >= dateThreshold;
    });
  }

  const grossBookingValue = roundMoney(
    transactions
      .filter((item: any) => item.revenueSource === 'booking')
      .reduce((sum: number, item: any) => sum + asNumber(item.grossAmount, 0), 0)
  );
  const bookingRevenue = roundMoney(
    transactions
      .filter((item: any) => item.revenueSource === 'booking')
      .reduce((sum: number, item: any) => sum + asNumber(item.platformRevenueAmount, 0), 0)
  );
  const checkInRevenue = roundMoney(
    transactions
      .filter((item: any) => item.revenueSource === 'checkin')
      .reduce((sum: number, item: any) => sum + asNumber(item.platformRevenueAmount, 0), 0)
  );
  const platformRevenue = roundMoney(bookingRevenue + checkInRevenue);
  const providerNetEarnings = roundMoney(
    transactions.reduce((sum: number, item: any) => sum + asNumber(item.providerNetAmount, 0), 0)
  );
  const commissionRecords = transactions
    .filter((item: any) => item.status === 'earned' && asNumber(item.platformRevenueAmount, 0) > 0)
    .map((item: any) => {
      const paymentStatus = getCommissionPaymentStatus(item) || 'due';
      const providerType = String(item.providerRole || '').toLowerCase() === 'clinic' ? 'clinic' : 'academy';
      const attendanceDate = item.attendanceVerifiedAt || item.updatedAt || item.createdAt || null;
      const paidDate = item.commissionPaidAt || item.commissionCollectedAt || null;

      return {
        id: item.id,
        providerName: item.providerName || 'Unknown provider',
        providerType,
        serviceName: item.serviceName || item.walkInServiceName || 'Service',
        reference: item.bookingId || item.checkInId || item.referenceCode || item.id,
        grossAmount: asNumber(item.grossAmount, 0),
        commissionPercentage: item.commissionPercentage ?? item.walkInCommissionPercentage ?? null,
        commissionAmount: asNumber(item.platformRevenueAmount, 0),
        status: paymentStatus,
        attendanceDate,
        paidDate,
        transaction: item,
      };
    });

  const dueRecords = commissionRecords.filter((item: any) => item.status === 'due');
  const paidRecords = commissionRecords.filter((item: any) => item.status === 'paid');

  const platformPendingCollection = roundMoney(
    dueRecords.reduce((sum: number, item: any) => sum + asNumber(item.commissionAmount, 0), 0)
  );
  const platformCollected = roundMoney(
    paidRecords.reduce((sum: number, item: any) => sum + asNumber(item.commissionAmount, 0), 0)
  );

  // Provider payout flow (what we owe providers vs what we already paid out)
  const providerPendingPayout = roundMoney(
    payoutSummaries
      .filter((item: any) => item.recordType === 'summary')
      .reduce((sum: number, item: any) => sum + asNumber(item.pendingNetAmount, 0), 0)
  );
  const providerPaidOut = roundMoney(
    payoutSummaries
      .filter((item: any) => item.recordType === 'summary')
      .reduce((sum: number, item: any) => sum + asNumber(item.completedNetAmount, 0), 0)
  );

  const collectionBase = platformPendingCollection + platformCollected;
  const collectionRate = collectionBase > 0
    ? roundMoney((platformCollected / collectionBase) * 100)
    : 0;

  // Backward-compatible aliases currently used by dashboard UI.
  const pendingPayouts = platformPendingCollection;
  const completedPayouts = platformCollected;

  transactions.sort((a: any, b: any) => getDateValue(b.updatedAt || b.createdAt).getTime() - getDateValue(a.updatedAt || a.createdAt).getTime());
  payoutSummaries.sort((a: any, b: any) => getDateValue(b.lastUpdatedAt || b.processedAt).getTime() - getDateValue(a.lastUpdatedAt || a.processedAt).getTime());

  const providerOptions = Array.from(new Set(transactions.map((item: any) => item.providerName).filter(Boolean))) as string[];

  return {
    grossBookingValue,
    platformRevenue,
    bookingRevenue,
    checkInRevenue,
    providerNetEarnings,
    platformPendingCollection,
    platformCollected,
    providerPendingPayout,
    providerPaidOut,
    collectionRate,
    moneyStillToReceive: platformPendingCollection,
    moneyReceived: platformCollected,
    dueRecords: dueRecords.slice(0, 100),
    paidRecords: paidRecords.slice(0, 100),
    pendingPayouts,
    completedPayouts,
    transactionCount: transactions.length,
    transactions: transactions.slice(0, 30),
    payoutSummaries: payoutSummaries.slice(0, 20),
    providerOptions,
  };
}
