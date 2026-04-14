import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { getOrCreateConversation } from './MessagingService';
import { getCurrentUserRole } from './UserRoleService';

const ROLE_COLLECTION_MAP: Record<string, string> = {
  player: 'players',
  parent: 'parents',
  academy: 'academies',
  clinic: 'clinics',
  agent: 'agents',
  admin: 'users',
};

function inferRoleFromCollection(collectionName: string, fallbackRole?: string): string {
  if (fallbackRole) return fallbackRole;

  switch (collectionName) {
    case 'players':
      return 'player';
    case 'parents':
      return 'parent';
    case 'academies':
      return 'academy';
    case 'clinics':
      return 'clinic';
    case 'agents':
      return 'agent';
    default:
      return 'unknown';
  }
}

function getDisplayName(userData: any, roleHint?: string): string {
  const role = String(userData?.role || roleHint || '').toLowerCase();

  if (role === 'academy') {
    return userData?.academyName || userData?.name || userData?.firstName || 'Academy';
  }

  if (role === 'clinic') {
    return userData?.clinicName || userData?.name || userData?.firstName || 'Clinic';
  }

  const fullName = [userData?.firstName, userData?.lastName].filter(Boolean).join(' ').trim();
  return fullName || userData?.parentName || userData?.agentName || userData?.name || 'Unknown';
}

async function getUserProfileWithFallback(
  userId: string,
  expectedRole?: string
): Promise<{ userId: string; name: string; photo?: string; role: string; createdAt?: string } | null> {
  const collectionsToTry = [
    'users',
    ...(expectedRole && ROLE_COLLECTION_MAP[expectedRole] ? [ROLE_COLLECTION_MAP[expectedRole]] : []),
    'players',
    'parents',
    'academies',
    'clinics',
    'agents',
  ].filter((value, index, array) => array.indexOf(value) === index);

  for (const collectionName of collectionsToTry) {
    try {
      const userSnap = await getDoc(doc(db, collectionName, userId));
      if (!userSnap.exists()) continue;

      const userData = userSnap.data();
      const resolvedRole = String(userData?.role || inferRoleFromCollection(collectionName, expectedRole)).toLowerCase();

      return {
        userId,
        name: getDisplayName(userData, resolvedRole),
        photo: userData?.profilePhoto,
        role: resolvedRole,
        createdAt: userData?.createdAt,
      };
    } catch (error) {
      console.warn(`[BookingMessagingService] Unable to read ${collectionName}/${userId}:`, error);
    }
  }

  return null;
}

async function getAgentSupportUsers(): Promise<Array<{ userId: string; name: string; photo?: string; role: string; lastBookingDate?: string }>> {
  try {
    const agentsRef = collection(db, 'users');
    const agentsQuery = query(agentsRef, where('role', '==', 'agent'));
    const agentsSnapshot = await getDocs(agentsQuery);

    if (!agentsSnapshot.empty) {
      return agentsSnapshot.docs.map((docSnap) => {
        const agentData = docSnap.data();
        return {
          userId: docSnap.id,
          name: agentData.firstName && agentData.lastName
            ? `${agentData.firstName} ${agentData.lastName} (Customer Support)`
            : agentData.firstName || agentData.lastName || agentData.name || 'Customer Support',
          photo: agentData.profilePhoto,
          role: 'agent',
          lastBookingDate: agentData.createdAt,
        };
      });
    }
  } catch (error) {
    console.warn('[BookingMessagingService] Falling back to agents collection for support users:', error);
  }

  try {
    const agentsSnapshot = await getDocs(collection(db, 'agents'));
    return agentsSnapshot.docs.map((docSnap) => {
      const agentData = docSnap.data();
      return {
        userId: docSnap.id,
        name: agentData.firstName && agentData.lastName
          ? `${agentData.firstName} ${agentData.lastName} (Customer Support)`
          : agentData.firstName || agentData.lastName || agentData.name || 'Customer Support',
        photo: agentData.profilePhoto,
        role: 'agent',
        lastBookingDate: agentData.createdAt,
      };
    });
  } catch (error) {
    console.warn('[BookingMessagingService] Unable to load support agents:', error);
    return [];
  }
}

async function getAgentReachableUsers(): Promise<Array<{ userId: string; name: string; photo?: string; role: string; lastBookingDate?: string }>> {
  const collectionsToLoad = [
    { collectionName: 'players', role: 'player' },
    { collectionName: 'parents', role: 'parent' },
    { collectionName: 'academies', role: 'academy' },
    { collectionName: 'clinics', role: 'clinic' },
  ];

  const results = await Promise.all(
    collectionsToLoad.map(async ({ collectionName, role }) => {
      try {
        const snapshot = await getDocs(collection(db, collectionName));
        return snapshot.docs.map((docSnap) => {
          const userData = docSnap.data();
          return {
            userId: docSnap.id,
            name: getDisplayName({ ...userData, role }, role),
            photo: userData.profilePhoto,
            role,
            lastBookingDate: userData.createdAt,
          };
        });
      } catch (error) {
        console.warn(`[BookingMessagingService] Unable to load ${collectionName}:`, error);
        return [];
      }
    })
  );

  return results.flat();
}

/**
 * Get users that the current user can chat with based on bookings
 * For Players/Parents: Can chat with academies/clinics they've booked
 * For Academies/Clinics: Can chat with players/parents who booked them
 * For Agents: Can chat with all players (customer support style)
 */
export async function getChattableUsers(): Promise<Array<{
  userId: string;
  name: string;
  photo?: string;
  role: string;
  bookingId?: string;
  lastBookingDate?: string;
}>> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('User must be authenticated');
  }

  try {
    const role = await getCurrentUserRole();
    const chattableUsers: Array<{
      userId: string;
      name: string;
      photo?: string;
      role: string;
      bookingId?: string;
      lastBookingDate?: string;
    }> = [];

    if (role === 'player' || role === 'parent') {
      // Players/Parents can chat with academies/clinics they've booked
      const bookingsRef = collection(db, 'bookings');
      const q = query(
        bookingsRef,
        where(role === 'player' ? 'playerId' : 'parentId', '==', currentUser.uid)
      );

      const snapshot = await getDocs(q);
      const providerIds = new Set<string>();
      const providerMap = new Map<string, { bookingId: string; date: string; type: string }>();

      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const providerId = data.providerId;
        const bookingType = data.type; // 'academy' or 'clinic'
        if (providerId && bookingType) {
          // Only include if we haven't seen this provider, or this is a more recent booking
          const existing = providerMap.get(providerId);
          if (!existing || 
              (data.createdAt && existing.date < data.createdAt)) {
            providerMap.set(providerId, {
              bookingId: docSnap.id,
              date: data.createdAt || '',
              type: bookingType
            });
            providerIds.add(providerId);
          }
        }
      });

      // Fetch provider details and verify they match the booking type
      for (const providerId of providerIds) {
        try {
          const bookingInfo = providerMap.get(providerId);
          const providerProfile = await getUserProfileWithFallback(providerId, bookingInfo?.type);

          if (bookingInfo && providerProfile &&
              ((bookingInfo.type === 'clinic' && providerProfile.role === 'clinic') ||
               (bookingInfo.type === 'academy' && providerProfile.role === 'academy'))) {
            chattableUsers.push({
              userId: providerId,
              name: providerProfile.name,
              photo: providerProfile.photo,
              role: providerProfile.role || 'unknown',
              bookingId: bookingInfo.bookingId,
              lastBookingDate: bookingInfo.date
            });
          }
        } catch (error) {
          console.error(`Error fetching provider ${providerId}:`, error);
        }
      }

      const supportAgents = await getAgentSupportUsers();
      chattableUsers.push(...supportAgents);
    } else if (role === 'academy' || role === 'clinic') {
      // Academies/Clinics can chat with players/parents who booked them
      // IMPORTANT: Only show customers who have bookings with the specific type (clinic or academy)
      const bookingsRef = collection(db, 'bookings');
      const q = query(
        bookingsRef,
        where('providerId', '==', currentUser.uid),
        where('type', '==', role) // For clinics: only 'clinic' bookings, for academies: only 'academy' bookings
      );

      const snapshot = await getDocs(q);
      const customerIds = new Set<string>();
      const customerMap = new Map<string, { bookingId: string; date: string; type: string }>();

      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const customerId = data.playerId || data.parentId;
        const bookingType = data.type; // Should be 'clinic' or 'academy'
        
        // Double-check: only include if booking type matches the provider role
        if (customerId && bookingType === role) {
          customerIds.add(customerId);
          // Keep track of most recent booking
          if (!customerMap.has(customerId) || 
              (data.createdAt && customerMap.get(customerId)!.date < data.createdAt)) {
            customerMap.set(customerId, {
              bookingId: docSnap.id,
              date: data.createdAt || '',
              type: bookingType
            });
          }
        }
      });

      // Fetch customer details - only include players/parents who have bookings
      for (const customerId of customerIds) {
        try {
          const bookingInfo = customerMap.get(customerId);
          const customerProfile = await getUserProfileWithFallback(customerId);

          if (bookingInfo && customerProfile && (customerProfile.role === 'player' || customerProfile.role === 'parent')) {
            chattableUsers.push({
              userId: customerId,
              name: customerProfile.name,
              photo: customerProfile.photo,
              role: customerProfile.role || 'unknown',
              bookingId: bookingInfo.bookingId,
              lastBookingDate: bookingInfo.date
            });
          }
        } catch (error) {
          console.error(`Error fetching customer ${customerId}:`, error);
        }
      }

      const supportAgents = await getAgentSupportUsers();
      chattableUsers.push(...supportAgents);
    } else if (role === 'agent') {
      // Agents can chat with all users (players, parents, academies, clinics) - customer support style
      const reachableUsers = await getAgentReachableUsers();
      chattableUsers.push(
        ...reachableUsers.filter((user) => user.userId !== currentUser.uid)
      );
    }

    return chattableUsers;
  } catch (error: any) {
    console.error('Error getting chattable users:', error);
    throw error;
  }
}

/**
 * Start a conversation with a user (creates conversation if doesn't exist)
 */
export async function startConversationWithUser(otherUserId: string): Promise<string> {
  return await getOrCreateConversation(otherUserId);
}

/**
 * Check if user can chat with another user based on bookings
 */
export async function canChatWithUser(otherUserId: string): Promise<boolean> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return false;
  }

  try {
    const role = await getCurrentUserRole();

    // First, check if the other user is an agent - agents are always available for all users
    const otherUserProfile = await getUserProfileWithFallback(otherUserId);
    if (otherUserProfile?.role === 'agent') {
      // Agents can always be chatted with by anyone (customer support)
      return true;
    }

    if (role === 'agent') {
      // Agents can chat with all users (players, parents, academies, clinics)
      return ['player', 'parent', 'academy', 'clinic'].includes(otherUserProfile?.role || '');
    }

    // For others, check if there's a booking relationship
    const bookingsRef = collection(db, 'bookings');
    
    if (role === 'player' || role === 'parent') {
      // Check if current user has booked the other user (provider)
      const q = query(
        bookingsRef,
        where(role === 'player' ? 'playerId' : 'parentId', '==', currentUser.uid),
        where('providerId', '==', otherUserId)
      );
      const snapshot = await getDocs(q);
      return !snapshot.empty;
    } else if (role === 'academy' || role === 'clinic') {
      // Check if other user has booked current user
      const q = query(
        bookingsRef,
        where('providerId', '==', currentUser.uid),
        where('type', '==', role),
        where('playerId', '==', otherUserId)
      );
      const snapshot1 = await getDocs(q);
      if (!snapshot1.empty) return true;

      // Also check parentId
      const q2 = query(
        bookingsRef,
        where('providerId', '==', currentUser.uid),
        where('type', '==', role),
        where('parentId', '==', otherUserId)
      );
      const snapshot2 = await getDocs(q2);
      return !snapshot2.empty;
    }

    return false;
  } catch (error) {
    console.error('Error checking chat permission:', error);
    return false;
  }
}
