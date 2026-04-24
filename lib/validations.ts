import i18n from '../locales/i18n';

// Validation utility functions

const getTranslatedText = (key: string, fallback: string, options?: Record<string, string | number>) => {
  const translated = String(i18n.t(key, options));
  return translated && translated !== key ? translated : fallback;
};

const localizeFieldName = (fieldName: string): string => {
  const normalized = (fieldName || '').trim().toLowerCase();
  const fieldKeyMap: Record<string, string> = {
    'first name': 'first_name',
    'last name': 'last_name',
    'parent name': 'parent_name',
    'phone number': 'phone',
    phone: 'phone',
    password: 'password',
    city: 'city',
    address: 'address',
    position: 'position',
    'clinic name': 'clinic_name',
    'academy name': 'academy_name',
    email: 'email_address',
    'email address': 'email_address',
  };

  const key = fieldKeyMap[normalized];
  if (!key) {
    return fieldName;
  }

  const translated = String(i18n.t(key));
  return translated && translated !== key ? translated : fieldName;
};

/**
 * Normalize phone for Firebase Auth email generation (generic, any country).
 * Use the same function for both signup and signin so login with phone works.
 * - Strips all non-digits only. No country-specific rules (0, +92, etc.).
 * - Same digit sequence with any formatting (spaces, dashes, +, parentheses) → same account.
 * - User can sign up and sign in with e.g. "0300 123 4567" or "+92 300 1234567"; as long as
 *   the digit sequence is the same, the generated email matches.
 */
export function normalizePhoneForAuth(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '';

  // Canonical Egypt identity: 20 + 10 local digits (without leading zero)
  // 01555551766 -> 201555551766
  // 201555551766 -> 201555551766
  if (digits.startsWith('20') && digits.length === 12) {
    return digits;
  }
  if (digits.startsWith('0') && digits.length === 11) {
    return `20${digits.slice(1)}`;
  }

  return digits;
}

/**
 * Robust normalization for Auth IDs.
 * Simply extracts all digits to create a unique identifier.
 * This works for any country as long as the user enters the same digits.
 */
export function normalizePhoneForTwilio(phone: string): string {
  // We keep the name "normalizePhoneForTwilio" for now to avoid 
  // breaking existing imports, but the logic is now country-agnostic.
  if (!phone) return "";

  // Extract only digits
  const digits = phone.replace(/\D/g, "");

  // Return consistent digit string. 
  // (e.g., "0300..." stays "0300...", "+92300..." stays "92300...")
  return digits;
}

export function getPhoneIdentityCandidates(phone: string): string[] {
  const rawDigits = String(phone || '').replace(/\D/g, '');
  const canonical = normalizePhoneForAuth(rawDigits);
  const candidates = new Set<string>();

  if (canonical) candidates.add(canonical);
  if (rawDigits) candidates.add(rawDigits);

  if (rawDigits.startsWith('0') && rawDigits.length === 11) {
    candidates.add(`20${rawDigits.slice(1)}`);
  }
  if (rawDigits.startsWith('20') && rawDigits.length === 12) {
    candidates.add(`0${rawDigits.slice(2)}`);
  }

  return Array.from(candidates).filter(Boolean);
}

// For Egypt phone UX: keep +2 fixed in UI and let user type local number starting with 0.
export function getEgyptPhoneLocalPart(phone: string): string {
  const raw = String(phone || '').replace(/\s/g, '');
  if (!raw) return '';
  if (raw.startsWith('+2')) {
    return raw.slice(2).replace(/\D/g, '').slice(0, 11);
  }
  return raw.replace(/\D/g, '').slice(0, 11);
}

export function formatEgyptPhoneFromLocalInput(localInput: string): string {
  const digits = String(localInput || '').replace(/\D/g, '').slice(0, 11);
  if (!digits) return '';
  const startsWithZero = digits.startsWith('0');
  const normalizedLocal = (startsWithZero ? digits : `0${digits}`).slice(0, 11);
  return `+2${normalizedLocal}`;
}

export const validateEmail = (email: string): string | null => {
  if (!email) {
    return getTranslatedText('validationEmailRequired', 'Email is required');
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return getTranslatedText('validationValidEmail', 'Please enter a valid email address');
  }
  return null;
};

export const validatePhone = (phone: string): string | null => {
  if (!phone) {
    return getTranslatedText('validationPhoneRequired', 'Phone number is required');
  }
  // Strip spaces only (allow +2 prefix as entered)
  const cleaned = phone.replace(/\s/g, '');

  // Egyptian format: must start with +2 followed by exactly 11 digits
  // e.g. +201XXXXXXXXX
  const phoneRegex = /^\+2\d{11}$/;

  if (!phoneRegex.test(cleaned)) {
    return getTranslatedText('validationPhoneEgyptFormat', 'Phone must start with +2 followed by 11 digits (e.g. +20123456789)');
  }
  return null;
};

export const validatePassword = (password: string): string | null => {
  if (!password) {
    return getTranslatedText('validationPasswordRequired', 'Password is required');
  }
  if (password.length < 6) {
    return getTranslatedText('validationPasswordMin', 'Password must be at least 6 characters');
  }
  if (password.length > 50) {
    return getTranslatedText('validationPasswordMax', 'Password must be less than 50 characters');
  }
  // Optional: Add more password strength checks
  // if (!/[A-Z]/.test(password)) {
  //   return 'Password must contain at least one uppercase letter';
  // }
  // if (!/[0-9]/.test(password)) {
  //   return 'Password must contain at least one number';
  // }
  return null;
};

export const validateName = (name: string, fieldName: string = 'Name'): string | null => {
  const localizedFieldName = localizeFieldName(fieldName);

  if (!name || name.trim().length === 0) {
    return getTranslatedText('validationRequired', `${localizedFieldName} is required`, { field: localizedFieldName });
  }
  if (name.trim().length < 2) {
    return getTranslatedText('validationMinChars', `${localizedFieldName} must be at least 2 characters`, { field: localizedFieldName });
  }
  if (name.trim().length > 50) {
    return getTranslatedText('validationMaxChars', `${localizedFieldName} must be less than 50 characters`, { field: localizedFieldName });
  }
  // Allow Latin and Arabic letters, spaces, hyphens, and apostrophes.
  const nameRegex = /^[\p{L}\s'-]+$/u;
  if (!nameRegex.test(name.trim())) {
    return getTranslatedText('validationNameCharacters', `${localizedFieldName} can only contain letters, spaces, hyphens, and apostrophes`, { field: localizedFieldName });
  }
  return null;
};

export const validateDOB = (day: string, month: string, year: string): string | null => {
  if (!day || !month || !year) {
    return getTranslatedText('validationDobRequired', 'Date of birth is required');
  }
  const dayNum = parseInt(day, 10);
  const monthNum = parseInt(month, 10);
  const yearNum = parseInt(year, 10);

  if (isNaN(dayNum) || isNaN(monthNum) || isNaN(yearNum)) {
    return getTranslatedText('validationValidDate', 'Please enter a valid date');
  }

  // Check if date is valid
  const date = new Date(yearNum, monthNum - 1, dayNum);
  if (
    date.getFullYear() !== yearNum ||
    date.getMonth() !== monthNum - 1 ||
    date.getDate() !== dayNum
  ) {
    return getTranslatedText('validationValidDate', 'Please enter a valid date');
  }

  // Check if age is reasonable (between 5 and 100 years)
  const today = new Date();
  const age = today.getFullYear() - yearNum;
  if (age < 5 || age > 100) {
    return getTranslatedText('validationValidDob', 'Please enter a valid date of birth');
  }

  return null;
};

export const validateRequired = (value: string, fieldName: string): string | null => {
  if (!value || value.trim().length === 0) {
    const localizedFieldName = localizeFieldName(fieldName);
    return getTranslatedText('validationRequired', `${localizedFieldName} is required`, { field: localizedFieldName });
  }
  return null;
};

export const validateCity = (city: string): string | null => {
  if (!city || city.trim().length === 0) {
    return getTranslatedText('validationCityRequired', 'City is required');
  }
  return null;
};

export const validateAddress = (address: string): string | null => {
  if (!address || address.trim().length === 0) {
    return getTranslatedText('validationAddressRequired', 'Address is required');
  }
  if (address.trim().length < 5) {
    return getTranslatedText('validationAddressMin', 'Address must be at least 5 characters');
  }
  return null;
};

