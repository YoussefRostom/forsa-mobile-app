import {
  addDoc,
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  where,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

export type AdminLogActionType =
  | 'booking_status_changed'
  | 'booking_time_proposed'
  | 'user_suspended'
  | 'user_unsuspended'
  | 'user_soft_deleted'
  | 'report_resolved'
  | 'broadcast_sent'
  | 'payout_completed'
  | 'admin_note_added'
  | 'content_removed';

export async function logAdminAction(params: {
  actionType: AdminLogActionType;
  targetCollection: string;
  targetId: string;
  reason?: string | null;
  metadata?: Record<string, any> | null;
  actorId?: string | null;
}) {
  const actorId = params.actorId || auth.currentUser?.uid || null;
  return addDoc(collection(db, 'admin_logs'), {
    adminUid: actorId,
    actionType: params.actionType,
    targetCollection: params.targetCollection,
    targetId: params.targetId,
    reason: params.reason || null,
    metadata: params.metadata || null,
    timestamp: serverTimestamp(),
  });
}

export async function addAdminNote(params: {
  targetUserId: string;
  note: string;
  category?: string;
  actorId?: string | null;
}) {
  const trimmed = params.note.trim();
  if (!trimmed) {
    throw new Error('Note cannot be empty');
  }

  const actorId = params.actorId || auth.currentUser?.uid || null;
  const noteRef = await addDoc(collection(db, 'admin_notes'), {
    targetUserId: params.targetUserId,
    note: trimmed,
    category: params.category || 'general',
    createdBy: actorId,
    createdAt: serverTimestamp(),
  });

  await logAdminAction({
    actionType: 'admin_note_added',
    targetCollection: 'users',
    targetId: params.targetUserId,
    reason: trimmed,
    actorId,
    metadata: { noteId: noteRef.id, category: params.category || 'general' },
  });

  return noteRef;
}

export function subscribeAdminNotes(targetUserId: string, callback: (notes: any[]) => void) {
  const notesRef = collection(db, 'admin_notes');
  const q = query(notesRef, where('targetUserId', '==', targetUserId));
  return onSnapshot(q, (snapshot) => {
    const notes = snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a: any, b: any) => getDateValue(b.createdAt).getTime() - getDateValue(a.createdAt).getTime());
    callback(notes);
  });
}

const getDateValue = (value: any): Date => {
  if (!value) return new Date(0);
  if (typeof value?.toDate === 'function') return value.toDate();
  if (value?.seconds) return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
};

const hasMeaningfulValue = (value: unknown) => typeof value === 'string' && value.trim().length > 0;

const resolveDisplayName = (user: any, fallback = 'Unknown') => {
  if (!user) return fallback;
  return (
    user.name ||
    user.academyName ||
    user.clinicName ||
    user.parentName ||
    user.playerName ||
    `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
    user.email ||
    user.phone ||
    fallback
  );
};

export async function getAdminOverviewMetrics() {
  const [
    usersCount,
    bookingsCount,
    checkinsCount,
    unresolvedReportsCount,
    suspendedCount,
    playersCount,
    academiesCount,
    clinicsCount,
    agentsCount,
    parentsCount,
  ] = await Promise.all([
    getCountFromServer(collection(db, 'users')),
    getCountFromServer(collection(db, 'bookings')),
    getCountFromServer(collection(db, 'checkins')),
    getCountFromServer(query(collection(db, 'reports'), where('status', '==', 'open'))),
    getCountFromServer(query(collection(db, 'users'), where('isSuspended', '==', true))),
    getCountFromServer(query(collection(db, 'users'), where('role', 'in', ['player', 'PLAYER']))),
    getCountFromServer(query(collection(db, 'users'), where('role', 'in', ['academy', 'ACADEMY']))),
    getCountFromServer(query(collection(db, 'users'), where('role', 'in', ['clinic', 'CLINIC']))),
    getCountFromServer(query(collection(db, 'users'), where('role', 'in', ['agent', 'AGENT']))),
    getCountFromServer(query(collection(db, 'users'), where('role', 'in', ['parent', 'PARENT']))),
  ]);

  const [recentUsersSnap, logsSnap, checkinsSnap] = await Promise.all([
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'admin_logs')),
    getDocs(collection(db, 'checkins')),
  ]);

  const bookingsSnap = await getDocs(collection(db, 'bookings'));

  const now = new Date();
  const todayThreshold = new Date();
  todayThreshold.setHours(0, 0, 0, 0);
  const weekThreshold = new Date();
  weekThreshold.setDate(now.getDate() - 7);

  let activeToday = 0;
  let activeThisWeek = 0;
  let incompleteProfiles = 0;
  let missingPricing = 0;
  let missingBranchAddress = 0;
  let attendedBookings = 0;
  let noShowBookings = 0;

  const usersById: Record<string, any> = {};

  const clinicVisitCounts: Record<string, { name: string; count: number }> = {};
  const userBookedCounts: Record<string, { name: string; count: number }> = {};
  const academyBookedCounts: Record<string, { name: string; count: number }> = {};
  const parentBookedCounts: Record<string, { name: string; count: number }> = {};

  recentUsersSnap.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    usersById[docSnap.id] = data;
    const updatedAt = getDateValue(data.updatedAt || data.createdAt || data.lastSeenAt);
    if (updatedAt >= todayThreshold) activeToday += 1;
    if (updatedAt >= weekThreshold) activeThisWeek += 1;

    const role = String(data.role || '').toLowerCase();
    if (role === 'academy' || role === 'clinic') {
      const hasName = hasMeaningfulValue(data.academyName) || hasMeaningfulValue(data.clinicName) || hasMeaningfulValue(data.name);
      const hasAddress = hasMeaningfulValue(data.address);
      if (!hasName || !hasAddress) incompleteProfiles += 1;

      if (role === 'academy') {
        const feeValues = data.fees && typeof data.fees === 'object' ? Object.values(data.fees) : [];
        const hasFees = feeValues.some((fee) => Number(fee) > 0);
        if (!hasFees) missingPricing += 1;
      }

      if (role === 'clinic') {
        const services = data.services && typeof data.services === 'object' ? Object.values(data.services) : [];
        const hasPricedService = services.some((service: any) => service?.selected && Number(service?.fee) > 0);
        if (!hasPricedService) missingPricing += 1;
      }

      const locations = Array.isArray(data.locations) ? data.locations : [];
      const hasBrokenLocation = locations.some((location: any) => !hasMeaningfulValue(location?.address));
      if (!hasAddress || hasBrokenLocation) {
        missingBranchAddress += 1;
      }
    }
  });

  const recentAdminActions = logsSnap.docs
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .sort((a: any, b: any) => getDateValue(b.timestamp).getTime() - getDateValue(a.timestamp).getTime())
    .slice(0, 8);

  bookingsSnap.docs.forEach((docSnap) => {
    const booking = docSnap.data() || {};
    const status = String(booking.status || '').toLowerCase();
    const hasAttendanceProof = Boolean(booking.checkedInAt || booking.lastCheckInId || String(booking.attendanceStatus || '').toLowerCase() === 'checked_in');

    if (status === 'completed' || hasAttendanceProof) attendedBookings += 1;
    if (status === 'no_show') noShowBookings += 1;

    const bookingUserId = booking.playerId || booking.parentId || booking.userId || booking.academyId || null;
    if (bookingUserId) {
      const name = resolveDisplayName(usersById[bookingUserId], booking.customerName || 'Unknown user');
      userBookedCounts[bookingUserId] = {
        name,
        count: (userBookedCounts[bookingUserId]?.count || 0) + 1,
      };
    }

    const providerRole = String(booking.type || usersById[booking.providerId || '']?.role || '').toLowerCase();
    if (providerRole === 'academy' && booking.providerId) {
      const academyName =
        booking.providerName ||
        resolveDisplayName(usersById[booking.providerId], 'Unknown academy');
      academyBookedCounts[booking.providerId] = {
        name: academyName,
        count: (academyBookedCounts[booking.providerId]?.count || 0) + 1,
      };
    }

    if (booking.parentId) {
      const parentName = resolveDisplayName(usersById[booking.parentId], booking.parentName || 'Unknown parent');
      parentBookedCounts[booking.parentId] = {
        name: parentName,
        count: (parentBookedCounts[booking.parentId]?.count || 0) + 1,
      };
    }
  });

  checkinsSnap.docs.forEach((docSnap) => {
    const checkin = docSnap.data() || {};
    const role = String(checkin.locationRole || '').toLowerCase();
    if (role !== 'clinic') return;

    const clinicId = String(checkin.locationId || '').trim();
    if (!clinicId) return;

    const clinicName =
      checkin.locationName ||
      resolveDisplayName(usersById[clinicId], 'Unknown clinic');

    clinicVisitCounts[clinicId] = {
      name: clinicName,
      count: (clinicVisitCounts[clinicId]?.count || 0) + 1,
    };
  });

  const toTopList = (record: Record<string, { name: string; count: number }>) =>
    Object.entries(record)
      .map(([id, value]) => ({ id, name: value.name, count: value.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

  return {
    totalUsers: usersCount.data().count,
    totalBookings: bookingsCount.data().count,
    totalCheckIns: checkinsCount.data().count,
    totalAttendedBookings: attendedBookings,
    totalNoShows: noShowBookings,
    unresolvedReports: unresolvedReportsCount.data().count,
    suspendedAccounts: suspendedCount.data().count,
    activeToday,
    activeThisWeek,
    usersByRole: {
      player: playersCount.data().count,
      academy: academiesCount.data().count,
      clinic: clinicsCount.data().count,
      agent: agentsCount.data().count,
      parent: parentsCount.data().count,
    },
    dataQuality: {
      incompleteProfiles,
      missingPricing,
      missingBranchAddress,
    },
    topRankings: {
      clinicsVisited: toTopList(clinicVisitCounts),
      usersBooked: toTopList(userBookedCounts),
      academiesBooked: toTopList(academyBookedCounts),
      parentsBooked: toTopList(parentBookedCounts),
    },
    recentAdminActions,
  };
}
