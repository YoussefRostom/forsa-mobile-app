import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

/**
 * Block a user by adding their ID to the current user's blocklist in Firestore.
 */
export async function blockUser(targetUserId: string) {
  const currentUser = auth.currentUser;
  if (!currentUser || !targetUserId) throw new Error('Not authenticated or invalid target');
  const ref = doc(db, `users/${currentUser.uid}/blocked/${targetUserId}`);
  await setDoc(ref, { blockedAt: Date.now() });
}

/**
 * Unblock a user by removing their ID from the current user's blocklist in Firestore.
 */
export async function unblockUser(targetUserId: string) {
  const currentUser = auth.currentUser;
  if (!currentUser || !targetUserId) throw new Error('Not authenticated or invalid target');
  const ref = doc(db, `users/${currentUser.uid}/blocked/${targetUserId}`);
  await deleteDoc(ref);
}
