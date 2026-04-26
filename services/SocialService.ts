import { auth, db } from '../lib/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  increment,
  updateDoc,
  limit,
  where,
} from 'firebase/firestore';
import i18n from '../locales/i18n';
import { createNotification } from './NotificationService';

// ─── Helpers ──────────────────────────────────────────────────────

/** Cache to avoid repeated Firestore fetches for the same user. */
const nameCache: Record<string, { name: string; photo: string | null }> = {};

async function resolveActor(userId: string): Promise<{ name: string; photo: string | null }> {
  if (nameCache[userId]) return nameCache[userId];
  try {
    const [userSnap, playerSnap] = await Promise.all([
      getDoc(doc(db, 'users', userId)),
      getDoc(doc(db, 'players', userId)),
    ]);
    const merged: Record<string, any> = {
      ...(userSnap.exists() ? userSnap.data() : {}),
      ...(playerSnap.exists() ? playerSnap.data() : {}),
    };
    const first = merged.firstName || '';
    const last = merged.lastName || '';
    const name = merged.name || merged.displayName || `${first} ${last}`.trim() || userId.slice(0, 8);
    const photo = merged.profilePhoto || merged.profilePic || merged.photo || null;
    nameCache[userId] = { name, photo };
    return nameCache[userId];
  } catch {
    return { name: userId.slice(0, 8), photo: null };
  }
}

async function enrichEntries<T extends { userId: string; actorName?: string; actorPhoto?: string | null }>(entries: T[]): Promise<T[]> {
  return Promise.all(
    entries.map(async (entry) => {
      if (entry.actorName) return entry;
      const resolved = await resolveActor(entry.userId);
      return { ...entry, actorName: resolved.name, actorPhoto: entry.actorPhoto ?? resolved.photo };
    })
  );
}

type SocialKind = 'like' | 'comment' | 'repost';

async function notifyPostOwner(params: {
  postId: string;
  postOwnerId?: string;
  actorName: string;
  kind: SocialKind;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user || !params.postOwnerId || params.postOwnerId === user.uid) return;

  const bodyByKind: Record<SocialKind, string> = {
    like: i18n.t('likedYourPost', { name: params.actorName }) || `${params.actorName} liked your post`,
    comment: i18n.t('commentedYourPost', { name: params.actorName }) || `${params.actorName} commented on your post`,
    repost: i18n.t('repostedYourPost', { name: params.actorName }) || `${params.actorName} reposted your post`,
  };

  try {
    await createNotification({
      userId: params.postOwnerId,
      title: i18n.t('newPostInteraction') || 'New post interaction',
      body: bodyByKind[params.kind],
      type: 'info',
      data: {
        notificationKind: `post_${params.kind}`,
        postId: params.postId,
        actorId: user.uid,
      },
    });
  } catch (error) {
    console.warn('[SocialService] Failed to notify post owner:', error);
  }
}

// ─── Likes ────────────────────────────────────────────────────────

export interface LikeEntry {
  userId: string;
  actorName: string;
  actorPhoto?: string | null;
  likedAt: any;
}

/**
 * Toggle like on a post. Returns true if now liked, false if unliked.
 */
export async function toggleLike(
  postId: string,
  postOwnerId?: string,
  actorName: string = 'Someone',
  actorPhoto?: string | null
): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be authenticated');

  const likeRef = doc(db, 'posts', postId, 'likes', user.uid);
  const likeSnap = await getDoc(likeRef);
  const postRef = doc(db, 'posts', postId);

  if (likeSnap.exists()) {
    await deleteDoc(likeRef);
    await updateDoc(postRef, { likesCount: increment(-1) });
    return false;
  } else {
    await setDoc(likeRef, {
      likedAt: serverTimestamp(),
      userId: user.uid,
      actorName,
      actorPhoto: actorPhoto || null,
    });
    await updateDoc(postRef, { likesCount: increment(1) });
    void notifyPostOwner({ postId, postOwnerId, actorName, kind: 'like' });
    return true;
  }
}

/**
 * Subscribe to all likes on a post (real-time).
 */
export function subscribeLikes(
  postId: string,
  callback: (likes: LikeEntry[]) => void
): () => void {
  const likesRef = collection(db, 'posts', postId, 'likes');
  const q = query(likesRef, orderBy('likedAt', 'desc'), limit(100));
  return onSnapshot(
    q,
    async (snap) => {
      const raw = snap.docs.map((d) => ({ userId: d.id, ...d.data() } as LikeEntry));
      const enriched = await enrichEntries(raw);
      callback(enriched);
    },
    () => callback([])
  );
}

/**
 * Subscribe to whether the current user has liked a post.
 */
export function subscribeIsLiked(
  postId: string,
  callback: (isLiked: boolean) => void
): () => void {
  const user = auth.currentUser;
  if (!user) {
    callback(false);
    return () => {};
  }
  const likeRef = doc(db, 'posts', postId, 'likes', user.uid);
  return onSnapshot(likeRef, (snap) => callback(snap.exists()), () => callback(false));
}

// ─── Comments ─────────────────────────────────────────────────────

export interface Comment {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  authorPhoto?: string | null;
  createdAt: any;
}

/**
 * Add a comment to a post.
 */
export async function addComment(
  postId: string,
  text: string,
  authorName: string,
  authorPhoto?: string | null,
  postOwnerId?: string
): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be authenticated');

  const commentsRef = collection(db, 'posts', postId, 'comments');
  await addDoc(commentsRef, {
    text: text.trim(),
    authorId: user.uid,
    authorName,
    authorPhoto: authorPhoto || null,
    createdAt: serverTimestamp(),
  });

  const postRef = doc(db, 'posts', postId);
  await updateDoc(postRef, { commentsCount: increment(1) });
  void notifyPostOwner({ postId, postOwnerId, actorName: authorName || 'Someone', kind: 'comment' });
}

/**
 * Delete a comment if the current user wrote it or owns the post.
 */
export async function deleteComment(postId: string, commentId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be authenticated');

  const postRef = doc(db, 'posts', postId);
  const commentRef = doc(db, 'posts', postId, 'comments', commentId);
  const [postSnap, commentSnap] = await Promise.all([getDoc(postRef), getDoc(commentRef)]);

  if (!commentSnap.exists()) {
    throw new Error('COMMENT_NOT_FOUND');
  }

  const postOwnerId = String(postSnap.data()?.ownerId || '');
  const commentAuthorId = String(commentSnap.data()?.authorId || '');
  if (commentAuthorId !== user.uid && postOwnerId !== user.uid) {
    throw new Error('NOT_ALLOWED_TO_DELETE_COMMENT');
  }

  await deleteDoc(commentRef);
  await updateDoc(postRef, { commentsCount: increment(-1) });
}

/**
 * Subscribe to comments on a post (real-time, ordered oldest first).
 */
export function subscribeComments(
  postId: string,
  callback: (comments: Comment[]) => void
): () => void {
  const commentsRef = collection(db, 'posts', postId, 'comments');
  const q = query(commentsRef, orderBy('createdAt', 'asc'), limit(200));
  return onSnapshot(
    q,
    (snap) => {
      const comments = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Comment));
      callback(comments);
    },
    () => callback([])
  );
}

// ─── Reposts ──────────────────────────────────────────────────────

/**
 * Toggle repost on a post. Returns true if now reposted, false if removed.
 */
export async function repostPost(
  post: any,
  currentUserName: string,
  currentUserPhoto?: string | null,
  currentUserRole: string = 'player'
): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be authenticated');

  if (post.ownerId === user.uid) {
    throw new Error('CANNOT_REPOST_OWN');
  }

  const repostRef = doc(db, 'posts', post.id, 'reposts', user.uid);
  const repostSnap = await getDoc(repostRef);
  const postRef = doc(db, 'posts', post.id);

  if (repostSnap.exists()) {
    await deleteDoc(repostRef);
    await updateDoc(postRef, { repostsCount: increment(-1) });

    const repostsQ = query(
      collection(db, 'posts'),
      where('ownerId', '==', user.uid),
      where('isRepost', '==', true),
      where('originalPostId', '==', post.id),
      limit(10)
    );
    const repostsSnap = await getDocs(repostsQ);
    await Promise.all(repostsSnap.docs.map((docSnap) => deleteDoc(docSnap.ref)));
    return false;
  }

  // Mark in subcollection
  await setDoc(repostRef, {
    repostedAt: serverTimestamp(),
    userId: user.uid,
    actorName: currentUserName,
    actorPhoto: currentUserPhoto || null,
  });

  // Increment counter on original
  await updateDoc(postRef, { repostsCount: increment(1) });

  // Create new post entry as a repost
  const postsRef = collection(db, 'posts');
  await addDoc(postsRef, {
    isRepost: true,
    originalPostId: post.id,
    originalAuthorName: post.author || 'Unknown',
    originalAuthorPhoto: post.authorPhoto || post.ownerPhoto || null,
    ownerId: user.uid,
    ownerRole: String(currentUserRole || 'player').toLowerCase(),
    author: currentUserName,
    authorPhoto: currentUserPhoto || null,
    content: post.content || '',
    mediaUrl: post.mediaUrl || null,
    mediaType: post.mediaType || null,
    timestamp: serverTimestamp(),
    status: 'active',
    visibleToRoles: ['player', 'parent', 'academy', 'agent', 'clinic'],
    likesCount: 0,
    commentsCount: 0,
    repostsCount: 0,
  });

  void notifyPostOwner({
    postId: post.id,
    postOwnerId: post.ownerId,
    actorName: currentUserName || 'Someone',
    kind: 'repost',
  });
  return true;
}

export interface RepostEntry {
  userId: string;
  actorName: string;
  actorPhoto?: string | null;
  repostedAt: any;
}

/**
 * Subscribe to all reposts on a post (real-time).
 */
export function subscribeReposts(
  postId: string,
  callback: (reposts: RepostEntry[]) => void
): () => void {
  const repostsRef = collection(db, 'posts', postId, 'reposts');
  const q = query(repostsRef, orderBy('repostedAt', 'desc'), limit(100));
  return onSnapshot(
    q,
    async (snap) => {
      const raw = snap.docs.map((d) => ({ userId: d.id, ...d.data() } as RepostEntry));
      const enriched = await enrichEntries(raw);
      callback(enriched);
    },
    () => callback([])
  );
}

export function subscribeIsReposted(
  postId: string,
  callback: (isReposted: boolean) => void
): () => void {
  const user = auth.currentUser;
  if (!user) {
    callback(false);
    return () => {};
  }

  const repostRef = doc(db, 'posts', postId, 'reposts', user.uid);
  return onSnapshot(repostRef, (snap) => callback(snap.exists()), () => callback(false));
}
