import { getFirestore, doc, setDoc, deleteDoc, getDoc, collection, query, where, getDocs, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { createNotification } from './NotificationService';
import { resolveUserDisplayName } from '../lib/userDisplayName';

const db = getFirestore();

async function resolveCurrentUserProfile(uid: string, fallbackName: string, fallbackPhoto: string) {
  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    const userData = userSnap.exists() ? userSnap.data() : {};
    return {
      name: resolveUserDisplayName(userData, fallbackName || 'Someone'),
      photo:
        userData?.profilePhoto ||
        userData?.profilePic ||
        userData?.photo ||
        userData?.avatarUrl ||
        fallbackPhoto ||
        '',
      role: String(userData?.role || 'player').toLowerCase(),
    };
  } catch {
    return {
      name: fallbackName || 'Someone',
      photo: fallbackPhoto || '',
      role: 'player',
    };
  }
}

export async function followUser(targetUid: string) {
  const auth = getAuth();
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Not authenticated');
  const followRef = doc(db, 'follows', `${currentUser.uid}_${targetUid}`);
  await setDoc(followRef, {
    follower: currentUser.uid,
    following: targetUid,
    createdAt: Date.now(),
  });
}

export async function unfollowUser(targetUid: string) {
  const auth = getAuth();
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Not authenticated');
  const followRef = doc(db, 'follows', `${currentUser.uid}_${targetUid}`);
  await deleteDoc(followRef);
}

export async function isFollowing(targetUid: string): Promise<boolean> {
  const auth = getAuth();
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Not authenticated');
  const followRef = doc(db, 'follows', `${currentUser.uid}_${targetUid}`);
  const snap = await getDoc(followRef);
  return snap.exists();
}

export async function getFollowers(uid: string): Promise<string[]> {
  const q = query(collection(db, 'follows'), where('following', '==', uid));
  const snaps = await getDocs(q);
  return snaps.docs.map(doc => doc.data().follower);
}

export async function getFollowing(uid: string): Promise<string[]> {
  const q = query(collection(db, 'follows'), where('follower', '==', uid));
  const snaps = await getDocs(q);
  return snaps.docs.map(doc => doc.data().following);
}

// Toggle follow/unfollow with mirrored docs
export async function toggleFollow(targetUid: string, targetRole: string, targetName: string, targetPhoto: string) {
  const auth = getAuth();
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Not authenticated');
  const sourceUid = currentUser.uid;
  const sourceProfile = await resolveCurrentUserProfile(
    sourceUid,
    currentUser.displayName || currentUser.email?.split('@')[0] || '',
    currentUser.photoURL || ''
  );

  const followingRef = doc(db, `users/${sourceUid}/following/${targetUid}`);
  const followerRef = doc(db, `users/${targetUid}/followers/${sourceUid}`);

  // Debug logging
  console.log('[toggleFollow] currentUser:', sourceUid);
  console.log('[toggleFollow] followingRef:', followingRef.path);
  console.log('[toggleFollow] followerRef:', followerRef.path);
  console.log('[toggleFollow] targetUid:', targetUid, 'targetRole:', targetRole, 'targetName:', targetName, 'targetPhoto:', targetPhoto);

  const followingSnap = await getDoc(followingRef);
  if (followingSnap.exists()) {
    // Unfollow
    try {
      await deleteDoc(followingRef);
      await deleteDoc(followerRef);
    } catch (e) {
      console.error('[toggleFollow] Unfollow error:', e);
      throw e;
    }
    return false;
  } else {
    // Follow
    const now = Date.now();
    try {
      await setDoc(followingRef, {
        userId: targetUid,
        role: targetRole,
        actorName: targetName,
        actorPhoto: targetPhoto,
        createdAt: now,
      });
      await setDoc(followerRef, {
        userId: sourceUid,
        role: sourceProfile.role,
        actorName: sourceProfile.name,
        actorPhoto: sourceProfile.photo,
        createdAt: now,
      });
      // Keep follow/unfollow state independent from notification delivery.
      void createNotification({
        userId: targetUid,
        title: 'New Follower',
        body: `${sourceProfile.name} followed you`,
        type: 'info',
        data: {
          notificationKind: 'follow',
          actorId: sourceUid,
          actorRole: sourceProfile.role,
          actorName: sourceProfile.name,
          userId: targetUid,
        },
      }).catch((notificationError) => {
        console.warn('[toggleFollow] Follow notification failed:', notificationError);
      });
    } catch (e) {
      console.error('[toggleFollow] Follow error:', e);
      throw e;
    }
    return true;
  }
}

// Subscribe to following state
export function subscribeIsFollowing(targetUid: string, callback: (isFollowing: boolean) => void): Unsubscribe {
  const auth = getAuth();
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Not authenticated');
  const followingRef = doc(db, `users/${currentUser.uid}/following/${targetUid}`);
  return onSnapshot(followingRef, (snap) => callback(snap.exists()));
}

// Subscribe to follower/following counts
export function subscribeFollowCounts(uid: string, callback: (counts: {followers: number, following: number}) => void): Unsubscribe {
  const followersQ = collection(db, `users/${uid}/followers`);
  const followingQ = collection(db, `users/${uid}/following`);
  let followersCount = 0;
  let followingCount = 0;
  const unsubFollowers = onSnapshot(followersQ, (snap) => {
    followersCount = snap.size;
    callback({ followers: followersCount, following: followingCount });
  });
  const unsubFollowing = onSnapshot(followingQ, (snap) => {
    followingCount = snap.size;
    callback({ followers: followersCount, following: followingCount });
  });
  return () => { unsubFollowers(); unsubFollowing(); };
}

// Get followers
export async function getFollowersMirrored(uid: string) {
  const snaps = await getDocs(collection(db, `users/${uid}/followers`));
  return snaps.docs.map(doc => doc.data());
}

// Get following
export async function getFollowingMirrored(uid: string) {
  const snaps = await getDocs(collection(db, `users/${uid}/following`));
  return snaps.docs.map(doc => doc.data());
}
