import { auth, db } from '../lib/firebase';
import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  getDocs,
  limit,
} from 'firebase/firestore';
import { getUserByCheckInCode } from './CheckInCodeService';
import { getCurrentUserRole } from './UserRoleService';
import { doc, getDoc } from 'firebase/firestore';
import { notifyAdmins, createNotification } from './NotificationService';
import { registerCheckInMonetization } from './MonetizationService';

export type CheckInLocationRole = 'academy' | 'clinic';

export interface CheckIn {
  id: string;
  userId: string;
  userRole: 'player' | 'parent';
  userCheckInCode: string;
  locationId: string;
  locationRole: CheckInLocationRole;
  createdAt: Timestamp | any;
  createdBy: string;
  meta?: {
    deviceTime?: number;
    note?: string | null;
    linkedBookingId?: string | null;
    walkInServiceName?: string | null;
    walkInGrossAmount?: number | null;
    walkInCommissionPercentage?: number | null;
  };
  // Denormalized fields (optional, for admin UI speed)
  userName?: string;
  locationName?: string;
}

export interface CheckInFilters {
  todayOnly?: boolean;
  locationRole?: CheckInLocationRole;
}

export type WalkInServiceDetails = {
  serviceName: string;
  grossAmount: number;
  commissionPercentage: number;
};

export type CreateCheckInOptions = {
  note?: string;
  linkedBookingId?: string | null;
  walkInService?: WalkInServiceDetails | null;
  walkInCustomerType?: string | null;
};

type BookingEligibilityResult = {
  eligible: boolean;
  reason?: string;
};

function parseBookingDateTime(booking: any): Date | null {
  const rawDate = String(booking?.date || '').trim();
  if (!rawDate) return null;

  const dmyMatch = rawDate.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  let parsedDate: Date | null = null;

  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]) - 1;
    const year = Number(dmyMatch[3].length === 2 ? `20${dmyMatch[3]}` : dmyMatch[3]);
    parsedDate = new Date(year, month, day, 0, 0, 0, 0);
  } else {
    const nativeParsed = new Date(rawDate);
    if (!Number.isNaN(nativeParsed.getTime())) parsedDate = nativeParsed;
  }

  if (!parsedDate) return null;

  const rawTime = String(booking?.time || '').trim().toLowerCase();
  if (rawTime) {
    const m = rawTime.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (m) {
      let hour = Number(m[1]);
      const minute = Number(m[2] || '0');
      const meridiem = (m[3] || '').toLowerCase();
      if (meridiem === 'pm' && hour < 12) hour += 12;
      if (meridiem === 'am' && hour === 12) hour = 0;
      parsedDate.setHours(hour, minute, 0, 0);
    }
  }

  return parsedDate;
}

function isBookingEligibleForAttendance(booking: any, userId: string, locationId: string): BookingEligibilityResult {
  const status = String(booking?.status || '').toLowerCase();
  const allowedStatuses = ['pending', 'confirmed', 'new_time_proposed', 'timing_proposed', 'player_accepted'];

  const belongsToUser = [booking?.playerId, booking?.parentId, booking?.userId, booking?.academyId].includes(userId);
  if (!belongsToUser) {
    return { eligible: false, reason: 'This booking is not linked to this customer.' };
  }

  if (booking?.providerId !== locationId) {
    return { eligible: false, reason: 'This booking belongs to a different provider.' };
  }

  if (!allowedStatuses.includes(status)) {
    return { eligible: false, reason: 'Booking is not eligible for attendance in its current status.' };
  }

  if (booking?.checkedInAt || booking?.lastCheckInId || String(booking?.attendanceStatus || '').toLowerCase() === 'checked_in') {
    return { eligible: false, reason: 'This booking has already been checked in.' };
  }

  const bookingDateTime = parseBookingDateTime(booking);
  if (bookingDateTime) {
    const expiresAt = new Date(bookingDateTime);
    expiresAt.setDate(expiresAt.getDate() + 1);
    expiresAt.setHours(23, 59, 59, 999);
    if (Date.now() > expiresAt.getTime()) {
      return { eligible: false, reason: 'This booking QR has expired.' };
    }
  }

  return { eligible: true };
}

/**
 * Check if user has checked in to the same location within the last 5 minutes
 * Uses in-memory filtering to avoid composite index requirement
 */
async function hasRecentCheckIn(
  userId: string,
  locationId: string,
  minutesThreshold: number = 5
): Promise<boolean> {
  try {
    const thresholdMs = minutesThreshold * 60 * 1000;
    const thresholdDate = new Date(Date.now() - thresholdMs);

    const checkInsRef = collection(db, 'checkins');
    // Query without orderBy and createdAt filter to avoid index requirement
    // We'll filter by time in memory
    const q = query(
      checkInsRef,
      where('userId', '==', userId),
      where('locationId', '==', locationId)
    );

    const snapshot = await getDocs(q);
    
    // Filter by createdAt in memory
    const recentCheckIns = snapshot.docs.filter(doc => {
      const data = doc.data();
      const createdAt = data.createdAt;
      
      if (!createdAt) return false;
      
      // Handle Firestore Timestamp
      let checkInDate: Date;
      if (createdAt && typeof createdAt.toDate === 'function') {
        checkInDate = createdAt.toDate();
      } else if (createdAt?.seconds) {
        checkInDate = new Date(createdAt.seconds * 1000);
      } else if (createdAt?._seconds) {
        checkInDate = new Date(createdAt._seconds * 1000);
      } else if (createdAt instanceof Date) {
        checkInDate = createdAt;
      } else {
        return false;
      }
      
      return checkInDate >= thresholdDate;
    });

    return recentCheckIns.length > 0;
  } catch (error: any) {
    console.error('Error checking recent check-in:', error);
    // On error, allow check-in (fail open)
    return false;
  }
}

/**
 * Get user name from user document
 */
async function getUserName(userId: string): Promise<string | null> {
  try {
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      return null;
    }
    
    const userData = userDoc.data();
    
    // Try role-specific name fields first
    if (userData.agentName) return userData.agentName;
    if (userData.academyName) return userData.academyName;
    if (userData.clinicName) return userData.clinicName;
    if (userData.parentName) return userData.parentName;
    if (userData.playerName) return userData.playerName;
    
    // Fallback to firstName/lastName
    if (userData.firstName && userData.lastName) {
      return `${userData.firstName} ${userData.lastName}`;
    }
    if (userData.firstName || userData.lastName) {
      return userData.firstName || userData.lastName;
    }
    
    // Fallback to email or phone
    if (userData.email) return userData.email.split('@')[0];
    if (userData.phone) return userData.phone;
    
    return null;
  } catch (error: any) {
    console.error('Error getting user name:', error);
    return null;
  }
}

/**
 * Get location name from user document
 */
async function getLocationName(locationId: string): Promise<string | null> {
  try {
    const locationRef = doc(db, 'users', locationId);
    const locationDoc = await getDoc(locationRef);
    
    if (!locationDoc.exists()) {
      return null;
    }
    
    const locationData = locationDoc.data();
    
    if (locationData.academyName) return locationData.academyName;
    if (locationData.clinicName) return locationData.clinicName;
    if (locationData.agentName) return locationData.agentName;
    
    // Fallback
    if (locationData.firstName && locationData.lastName) {
      return `${locationData.firstName} ${locationData.lastName}`;
    }
    
    return locationData.email?.split('@')[0] || locationData.phone || null;
  } catch (error: any) {
    console.error('Error getting location name:', error);
    return null;
  }
}

async function findLinkedBookingForCheckIn(
  userId: string,
  locationId: string,
  linkedBookingId?: string | null
): Promise<any | null> {
  try {
    if (linkedBookingId) {
      const bookingSnap = await getDoc(doc(db, 'bookings', linkedBookingId));
      if (!bookingSnap.exists()) return null;
      const booking = { id: bookingSnap.id, ...bookingSnap.data() } as any;
      const eligibility = isBookingEligibleForAttendance(booking, userId, locationId);
      return eligibility.eligible ? booking : null;
    }

    const snap = await getDocs(query(collection(db, 'bookings'), where('providerId', '==', locationId)));
    const candidates = snap.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .filter((booking: any) => {
        const eligibility = isBookingEligibleForAttendance(booking, userId, locationId);
        return eligibility.eligible;
      })
      .sort((a: any, b: any) => {
        const aTime = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
        const bTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
        return bTime - aTime;
      });

    return candidates[0] || null;
  } catch (error) {
    console.warn('Failed to resolve linked booking for check-in:', error);
    return null;
  }
}

/**
 * Create a check-in from a scanned QR code
 * @param code - The check-in code extracted from QR (without "forsa_checkin:" prefix)
 * @param options - Optional booking link, note, and walk-in service details
 */
export async function createCheckInFromScan(
  code: string,
  options?: CreateCheckInOptions | string
): Promise<CheckIn> {
  const staffUser = auth.currentUser;
  if (!staffUser) {
    throw new Error('Staff user must be authenticated');
  }

  const normalizedOptions: CreateCheckInOptions =
    typeof options === 'string' ? { note: options } : (options || {});

  try {
    const staffRole = await getCurrentUserRole();
    if (staffRole !== 'academy' && staffRole !== 'clinic') {
      throw new Error('Only academy and clinic staff can create check-ins');
    }

    const userId = await getUserByCheckInCode(code);
    if (!userId) {
      throw new Error('Invalid check-in code');
    }

    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    if (!userDoc.exists()) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    const userRole = userData.role?.toLowerCase();
    if (userRole !== 'player' && userRole !== 'parent') {
      throw new Error('Check-in code belongs to a user who cannot check in');
    }

    const locationId = staffUser.uid;

    // Determine scan type: booking QR (explicit bookingId embedded) vs personal code (reusable)
    const isBookingQrScan = Boolean(normalizedOptions.linkedBookingId);

    // Personal code scans: apply time-based cooldown to prevent walk-in duplicates within the same session.
    // Booking QR scans: skip cooldown — each booking is protected by its own one-time duplicate check below.
    if (!isBookingQrScan) {
      const hasRecent = await hasRecentCheckIn(userId, locationId, 5);
      if (hasRecent) {
        throw new Error('User has already checked in recently. Please wait before scanning again.');
      }
    }

    // Only look up a linked booking when a specific bookingId was embedded in the QR.
    // Personal-code scans must never auto-link to a booking — they are always walk-in visits.
    const linkedBooking = isBookingQrScan
      ? await findLinkedBookingForCheckIn(userId, locationId, normalizedOptions.linkedBookingId)
      : null;

    if (isBookingQrScan && !linkedBooking) {
      throw new Error('Invalid, expired, or already used booking QR code.');
    }

    if (linkedBooking?.id) {
      const duplicateBookingCheckIn = await getDocs(
        query(
          collection(db, 'checkins'),
          where('meta.linkedBookingId', '==', linkedBooking.id),
          limit(1)
        )
      );
      if (!duplicateBookingCheckIn.empty) {
        throw new Error('This booking has already been checked in. Each booking can only be scanned once.');
      }
    }

    const walkInService = normalizedOptions.walkInService || null;
    if (!linkedBooking && !walkInService) {
      const serviceError: any = new Error('Walk-in service details are required when no booking exists.');
      serviceError.code = 'service-details-required';
      throw serviceError;
    }

    const userName = await getUserName(userId);
    const locationName = await getLocationName(locationId);

    const checkInData = {
      userId,
      userRole: userRole as 'player' | 'parent',
      userCheckInCode: code,
      locationId,
      locationRole: staffRole as CheckInLocationRole,
      status: 'completed',
      createdAt: serverTimestamp(),
      createdBy: staffUser.uid,
      meta: {
        deviceTime: Date.now(),
        note: normalizedOptions.note || null,
        linkedBookingId: linkedBooking?.id || normalizedOptions.linkedBookingId || null,
        walkInServiceName: walkInService?.serviceName || null,
        walkInGrossAmount: walkInService?.grossAmount ?? null,
        walkInCommissionPercentage: walkInService?.commissionPercentage ?? null,
        walkInCustomerType: normalizedOptions.walkInCustomerType || null,
      },
      userName: userName || null,
      locationName: locationName || null,
    };

    const checkInsRef = collection(db, 'checkins');
    const checkInRef = await addDoc(checkInsRef, checkInData);

    try {
      await registerCheckInMonetization(checkInRef.id, { id: checkInRef.id, ...checkInData }, staffUser.uid);
    } catch (financeError) {
      console.warn('Check-in monetization sync failed:', financeError);
    }

    try {
      await notifyAdmins(
        'New check-in',
        locationName ? `${userName || 'User'} checked in at ${locationName}` : `${userName || 'User'} (${userRole}) checked in`,
        'checkin',
        { checkInId: checkInRef.id, locationId, userId }
      );
      await createNotification({
        userId,
        title: 'Check-in recorded',
        body: locationName ? `You checked in at ${locationName}` : 'Check-in successful',
        type: 'checkin',
        data: { checkInId: checkInRef.id },
      });
    } catch (e) {
      console.warn('Check-in notification failed:', e);
    }

    return {
      id: checkInRef.id,
      ...checkInData,
      createdAt: Timestamp.now(),
    } as CheckIn;
  } catch (error: any) {
    console.error('Error creating check-in:', error);
    if (error?.code === 'service-details-required') {
      throw error;
    }
    throw new Error(`Failed to create check-in: ${error.message}`);
  }
}

/**
 * Subscribe to check-ins for admin (realtime listener)
 * @param filters - Optional filters for check-ins
 * @param callback - Callback function that receives check-ins array
 * @returns Unsubscribe function
 */
export function subscribeAdminCheckIns(
  filters: CheckInFilters | null,
  callback: (checkIns: CheckIn[]) => void
): () => void {
  const checkInsRef = collection(db, 'checkins');
  
  // Query without orderBy to avoid index requirement, we'll sort in memory
  let q;
  if (filters?.locationRole) {
    q = query(
      checkInsRef,
      where('locationRole', '==', filters.locationRole)
    );
  } else {
    q = query(checkInsRef);
  }

  const unsubscribe = onSnapshot(
    q,
    async (querySnapshot) => {
      let checkIns: CheckIn[] = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as CheckIn[];

      // Filter by location role if needed
      if (filters?.locationRole) {
        checkIns = checkIns.filter(ci => ci.locationRole === filters.locationRole);
      }

      // Filter by today only if needed
      if (filters?.todayOnly) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayTimestamp = Timestamp.fromDate(today);
        
        checkIns = checkIns.filter(ci => {
          const createdAt = ci.createdAt;
          if (!createdAt) return false;
          
          const checkInDate = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
          return checkInDate >= today;
        });
      }

      // Sort by createdAt in memory (newest first)
      checkIns.sort((a, b) => {
        const dateA = getDateFromTimestamp(a.createdAt);
        const dateB = getDateFromTimestamp(b.createdAt);
        return dateB.getTime() - dateA.getTime();
      });

      callback(checkIns);
    },
    (error) => {
      console.error('Error subscribing to check-ins:', error);
      callback([]);
    }
  );

  return unsubscribe;
}

/**
 * Subscribe to user's own check-ins
 * @param userId - User ID
 * @param callback - Callback function that receives check-ins array
 * @returns Unsubscribe function
 */
export function subscribeMyCheckIns(
  userId: string,
  callback: (checkIns: CheckIn[]) => void
): () => void {
  const checkInsRef = collection(db, 'checkins');
  // Query without orderBy to avoid index requirement, sort in memory
  const q = query(
    checkInsRef,
    where('userId', '==', userId)
  );

  const unsubscribe = onSnapshot(
    q,
    (querySnapshot) => {
      let checkIns: CheckIn[] = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as CheckIn[];
      
      // Sort by createdAt in memory (newest first)
      checkIns.sort((a, b) => {
        const dateA = getDateFromTimestamp(a.createdAt);
        const dateB = getDateFromTimestamp(b.createdAt);
        return dateB.getTime() - dateA.getTime();
      });
      
      callback(checkIns);
    },
    (error) => {
      console.error('Error subscribing to user check-ins:', error);
      callback([]);
    }
  );

  return unsubscribe;
}

/**
 * Helper function to safely get date from Firestore timestamp
 */
function getDateFromTimestamp(timestamp: any): Date {
  if (!timestamp) return new Date(0);
  if (timestamp.toDate && typeof timestamp.toDate === 'function') {
    return timestamp.toDate();
  }
  if (timestamp.seconds) {
    return new Date(timestamp.seconds * 1000);
  }
  if (timestamp instanceof Date) {
    return timestamp;
  }
  return new Date(timestamp);
}

