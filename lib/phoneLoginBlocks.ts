import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export async function writePhoneLoginBlock(normalizedPhoneDigits: string, authEmail: string): Promise<void> {
  if (!normalizedPhoneDigits || !authEmail) return;
  const id = normalizedPhoneDigits.replace(/\D/g, '');
  if (!id) return;
  await setDoc(doc(db, 'phoneLoginBlocks', id), { authEmail });
}

export async function lookupPhoneLoginBlock(normalizedPhoneDigits: string): Promise<string | null> {
  if (!normalizedPhoneDigits) return null;
  const id = normalizedPhoneDigits.replace(/\D/g, '');
  if (!id) return null;
  const snap = await getDoc(doc(db, 'phoneLoginBlocks', id));
  if (snap.exists()) {
    return snap.data()?.authEmail ?? null;
  }
  return null;
}

export async function deletePhoneLoginBlock(normalizedPhoneDigits: string): Promise<void> {
  if (!normalizedPhoneDigits) return;
  const id = normalizedPhoneDigits.replace(/\D/g, '');
  if (!id) return;
  await deleteDoc(doc(db, 'phoneLoginBlocks', id));
}
