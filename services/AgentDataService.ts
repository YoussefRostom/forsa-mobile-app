import {
  collection,
  doc,
  DocumentData,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  QueryDocumentSnapshot,
  startAfter,
  where,
} from 'firebase/firestore';
import { db } from '../lib/firebase';

export type AgentPlayer = {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  position?: string;
  city?: string;
  dob?: string;
  profilePhoto?: string | null;
  pinnedVideo?: string | null;
  createdAt?: string | null;
  [key: string]: any;
};

export type AgentDirectoryEntry = {
  id: string;
  name: string;
  city: string;
  description: string;
  profilePic?: string;
  phone?: string;
  [key: string]: any;
};

export type PageResult<T> = {
  items: T[];
  cursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
};

const ROLE_COLLECTION_MAP: Record<string, string> = {
  player: 'players',
  parent: 'parents',
  academy: 'academies',
  clinic: 'clinics',
  agent: 'agents',
};

export async function fetchUserProfileByRole(userId: string, role?: string): Promise<Record<string, any> | null> {
  if (!userId) return null;
  const collectionName = ROLE_COLLECTION_MAP[String(role || '').toLowerCase()] || 'users';

  try {
    if (collectionName !== 'users') {
      const roleSnap = await getDoc(doc(db, collectionName, userId));
      if (roleSnap.exists()) {
        return roleSnap.data() as Record<string, any>;
      }
    }

    const userSnap = await getDoc(doc(db, 'users', userId));
    if (userSnap.exists()) {
      return userSnap.data() as Record<string, any>;
    }

    return null;
  } catch {
    return null;
  }
}

export async function getUserDisplayName(userId: string, role?: string): Promise<string> {
  const data = await fetchUserProfileByRole(userId, role);
  if (!data) return 'Unknown';

  const normalizedRole = String(role || data.role || '').toLowerCase();
  if (normalizedRole === 'player' || normalizedRole === 'agent') {
    const first = String(data.firstName || '').trim();
    const last = String(data.lastName || '').trim();
    const full = `${first} ${last}`.trim();
    if (full) return full;
  }
  if (normalizedRole === 'parent' && data.parentName) return String(data.parentName);
  if (normalizedRole === 'academy' && data.academyName) return String(data.academyName);
  if (normalizedRole === 'clinic' && data.clinicName) return String(data.clinicName);

  return (
    String(data.name || '').trim() ||
    String(data.parentName || '').trim() ||
    String(data.academyName || '').trim() ||
    String(data.clinicName || '').trim() ||
    String(data.email || '').trim() ||
    'Unknown'
  );
}

export async function fetchAgentPlayersPage(options?: {
  pageSize?: number;
  cursor?: QueryDocumentSnapshot<DocumentData> | null;
}): Promise<PageResult<AgentPlayer>> {
  const pageSize = options?.pageSize ?? 20;
  const usersRef = collection(db, 'users');

  const baseQuery = query(
    usersRef,
    where('role', '==', 'player'),
    orderBy('__name__'),
    limit(pageSize)
  );

  const pageQuery = options?.cursor
    ? query(
        usersRef,
        where('role', '==', 'player'),
        orderBy('__name__'),
        startAfter(options.cursor),
        limit(pageSize)
      )
    : baseQuery;

  const snap = await getDocs(pageQuery);
  const users = snap.docs;

  const players = await Promise.all(
    users.map(async (userDoc) => {
      const userData = userDoc.data() as Record<string, any>;
      const userId = userDoc.id;

      try {
        const playerDocRef = doc(db, 'players', userId);
        const playerDocSnap = await getDoc(playerDocRef);
        if (playerDocSnap.exists()) {
          const playerData = playerDocSnap.data() as Record<string, any>;
          return {
            id: userId,
            firstName: playerData.firstName || userData.firstName || '',
            lastName: playerData.lastName || userData.lastName || '',
            email: playerData.email || userData.email || '',
            position: playerData.position || userData.position || '',
            city: playerData.city || userData.city || '',
            dob: playerData.dob || userData.dob || '',
            profilePhoto: playerData.profilePhoto || userData.profilePhoto || null,
            pinnedVideo: playerData.pinnedVideo || playerData.highlightVideo || null,
            createdAt: playerData.createdAt || userData.createdAt || null,
          } as AgentPlayer;
        }
      } catch {
        // Fall back to users document if players document read fails.
      }

      return {
        id: userId,
        firstName: userData.firstName || '',
        lastName: userData.lastName || '',
        email: userData.email || '',
        position: userData.position || '',
        city: userData.city || '',
        dob: userData.dob || '',
        profilePhoto: userData.profilePhoto || null,
        pinnedVideo: userData.pinnedVideo || userData.highlightVideo || null,
        createdAt: userData.createdAt || null,
      } as AgentPlayer;
    })
  );

  const sortedPlayers = players.sort((a, b) => {
    const aTs = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTs = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTs - aTs;
  });

  return {
    items: sortedPlayers,
    cursor: users.length > 0 ? users[users.length - 1] : options?.cursor || null,
    hasMore: users.length === pageSize,
  };
}

export async function fetchAgentsPage(options?: {
  pageSize?: number;
  cursor?: QueryDocumentSnapshot<DocumentData> | null;
}): Promise<PageResult<AgentDirectoryEntry>> {
  const pageSize = options?.pageSize ?? 20;
  const agentsRef = collection(db, 'agents');

  const baseQuery = query(agentsRef, orderBy('__name__'), limit(pageSize));
  const pageQuery = options?.cursor
    ? query(agentsRef, orderBy('__name__'), startAfter(options.cursor), limit(pageSize))
    : baseQuery;

  const snap = await getDocs(pageQuery);
  const docs = snap.docs;

  const items = docs.map((agentDoc) => {
    const data = agentDoc.data() as Record<string, any>;
    return {
      id: agentDoc.id,
      name: `${data.firstName || ''} ${data.lastName || ''}`.trim(),
      city: data.city || '',
      description: data.description || '',
      profilePic: data.profilePhoto || '',
      phone: data.phone || '',
      ...data,
    } as AgentDirectoryEntry;
  });

  return {
    items,
    cursor: docs.length > 0 ? docs[docs.length - 1] : options?.cursor || null,
    hasMore: docs.length === pageSize,
  };
}
