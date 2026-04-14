import { auth, db } from '../lib/firebase';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';

/**
 * Update post content (owner only).
 */
export async function updatePost(
  postId: string,
  updates: { content?: string }
): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be authenticated');

  const postRef = doc(db, 'posts', postId);
  const postSnap = await getDoc(postRef);

  if (!postSnap.exists()) {
    throw new Error('Post not found');
  }

  const postData = postSnap.data();
  if (postData?.ownerId !== user.uid) {
    throw new Error('You can only edit your own post');
  }

  const data: Record<string, any> = { updatedAt: serverTimestamp() };
  if (updates.content !== undefined) {
    data.content = updates.content;
    data.contentText = updates.content;
  }

  await updateDoc(postRef, data);
}

/**
 * Soft-delete post by owner (sets status to 'deleted').
 */
export async function deletePostByOwner(postId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be authenticated');

  const postRef = doc(db, 'posts', postId);
  const postSnap = await getDoc(postRef);

  if (!postSnap.exists()) {
    throw new Error('Post not found');
  }

  const postData = postSnap.data();
  if (postData?.ownerId !== user.uid) {
    throw new Error('You can only delete your own post');
  }

  await updateDoc(postRef, {
    status: 'deleted',
    deletedAt: serverTimestamp(),
    deletedBy: user.uid,
  });
}
