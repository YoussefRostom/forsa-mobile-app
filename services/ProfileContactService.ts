import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { deleteEmailIndex, lookupEmailIndex, writeEmailIndex } from '../lib/emailIndex';
import { deletePhoneIndex, lookupPhoneIndex, writePhoneIndex } from '../lib/phoneIndex';
import { deletePhoneLoginBlock, writePhoneLoginBlock } from '../lib/phoneLoginBlocks';
import { getPhoneIdentityCandidates, validateEmail, validatePhone } from '../lib/validations';

type PrepareProfileContactUpdateParams = {
  authEmail: string;
  currentUserId: string;
  currentEmail?: string | null;
  currentPhone?: string | null;
  nextEmail?: string | null;
  nextPhone?: string | null;
};

type PreparedProfileContactUpdate = {
  email: string | null;
  phone: string | null;
  emailLowercase: string | null;
};

const normalizeEmail = (value?: string | null) => {
  const trimmed = String(value || '').trim().toLowerCase();
  return trimmed || '';
};

const normalizePhone = (value?: string | null) => String(value || '').trim();

async function userExistsWithField(field: 'email' | 'phone', value: string, currentUserId: string) {
  if (!value) return false;
  const usersQuery = query(collection(db, 'users'), where(field, '==', value), limit(2));
  const snapshot = await getDocs(usersQuery);
  return snapshot.docs.some((docSnap) => docSnap.id !== currentUserId);
}

export async function prepareProfileContactUpdate({
  authEmail,
  currentUserId,
  currentEmail,
  currentPhone,
  nextEmail,
  nextPhone,
}: PrepareProfileContactUpdateParams): Promise<PreparedProfileContactUpdate> {
  const trimmedAuthEmail = normalizeEmail(authEmail);
  const normalizedCurrentEmail = normalizeEmail(currentEmail);
  const normalizedNextEmail = normalizeEmail(nextEmail);
  const normalizedCurrentPhone = normalizePhone(currentPhone);
  const normalizedNextPhone = normalizePhone(nextPhone);

  if (!normalizedNextEmail && !normalizedNextPhone) {
    throw new Error('Add at least one email or phone number.');
  }

  if (normalizedNextEmail) {
    const emailValidationError = validateEmail(normalizedNextEmail);
    if (emailValidationError) {
      throw new Error(emailValidationError);
    }
  }

  if (normalizedNextPhone) {
    const phoneValidationError = validatePhone(normalizedNextPhone);
    if (phoneValidationError) {
      throw new Error(phoneValidationError);
    }
  }

  if (normalizedNextEmail && normalizedNextEmail !== normalizedCurrentEmail) {
    const indexedAuthEmail = await lookupEmailIndex(normalizedNextEmail);
    if (indexedAuthEmail && normalizeEmail(indexedAuthEmail) !== trimmedAuthEmail) {
      throw new Error('This email is already being used by another account.');
    }

    const emailTakenInUsers = await userExistsWithField('email', normalizedNextEmail, currentUserId);
    if (emailTakenInUsers) {
      throw new Error('This email is already being used by another account.');
    }
  }

  if (normalizedNextPhone && normalizedNextPhone !== normalizedCurrentPhone) {
    const nextPhoneCandidates = getPhoneIdentityCandidates(normalizedNextPhone);

    for (const candidate of nextPhoneCandidates) {
      const indexedAuthEmail = await lookupPhoneIndex(candidate);
      if (indexedAuthEmail && normalizeEmail(indexedAuthEmail) !== trimmedAuthEmail) {
        throw new Error('This phone number is already being used by another account.');
      }
    }

    const phoneTakenInUsers = await userExistsWithField('phone', normalizedNextPhone, currentUserId);
    if (phoneTakenInUsers) {
      throw new Error('This phone number is already being used by another account.');
    }
  }

  return {
    email: normalizedNextEmail || null,
    phone: normalizedNextPhone || null,
    emailLowercase: normalizedNextEmail || null,
  };
}

export async function removeStaleProfileContactIndexes({
  authEmail,
  previousEmail,
  previousPhone,
  nextEmail,
  nextPhone,
}: {
  authEmail: string;
  previousEmail?: string | null;
  previousPhone?: string | null;
  nextEmail?: string | null;
  nextPhone?: string | null;
}) {
  const trimmedAuthEmail = normalizeEmail(authEmail);
  const normalizedPreviousEmail = normalizeEmail(previousEmail);
  const normalizedNextEmail = normalizeEmail(nextEmail);
  const previousPhoneCandidates = getPhoneIdentityCandidates(normalizePhone(previousPhone));
  const nextPhoneCandidates = getPhoneIdentityCandidates(normalizePhone(nextPhone));

  if (normalizedPreviousEmail && normalizedPreviousEmail !== normalizedNextEmail) {
    const indexedAuthEmail = await lookupEmailIndex(normalizedPreviousEmail);
    if (indexedAuthEmail && normalizeEmail(indexedAuthEmail) === trimmedAuthEmail) {
      await deleteEmailIndex(normalizedPreviousEmail);
    }
  }

  for (const candidate of previousPhoneCandidates) {
    if (nextPhoneCandidates.includes(candidate)) continue;
    const indexedAuthEmail = await lookupPhoneIndex(candidate);
    if (indexedAuthEmail && normalizeEmail(indexedAuthEmail) === trimmedAuthEmail) {
      await deletePhoneIndex(candidate);
    }
  }
}

export async function syncPhoneLoginBlocks({
  authEmail,
  previousPhone,
  nextPhone,
}: {
  authEmail: string;
  previousPhone?: string | null;
  nextPhone?: string | null;
}) {
  const trimmedAuthEmail = normalizeEmail(authEmail);
  const previousPhoneCandidates = getPhoneIdentityCandidates(normalizePhone(previousPhone));
  const nextPhoneCandidates = getPhoneIdentityCandidates(normalizePhone(nextPhone));

  for (const candidate of previousPhoneCandidates) {
    if (nextPhoneCandidates.includes(candidate)) continue;
    await writePhoneLoginBlock(candidate, trimmedAuthEmail);
  }

  for (const candidate of nextPhoneCandidates) {
    await deletePhoneLoginBlock(candidate);
  }
}

export async function writeProfileContactIndexes({
  authEmail,
  nextEmail,
  nextPhone,
}: {
  authEmail: string;
  nextEmail?: string | null;
  nextPhone?: string | null;
}) {
  const trimmedAuthEmail = normalizeEmail(authEmail);
  const normalizedNextEmail = normalizeEmail(nextEmail);
  const nextPhoneCandidates = getPhoneIdentityCandidates(normalizePhone(nextPhone));

  if (normalizedNextEmail) {
    await writeEmailIndex(normalizedNextEmail, trimmedAuthEmail);
  }

  for (const candidate of nextPhoneCandidates) {
    await writePhoneIndex(candidate, trimmedAuthEmail);
  }
}
