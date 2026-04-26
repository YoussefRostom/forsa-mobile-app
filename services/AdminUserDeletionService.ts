import { auth } from '../lib/firebase';
import {
  getBackendUrl,
  getBackendUrlCandidates,
  rememberWorkingBackendUrl,
  testBackendConnection,
} from '../lib/config';

const ADMIN_DELETE_TIMEOUT_MS = 20000;

function isRetryableNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /timed out|network request failed|failed to fetch|abort|network request timed out/i.test(message);
}

export async function deleteUserPermanentlyAsAdmin(userId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('You must be signed in as admin.');
  }

  const token = await currentUser.getIdToken();
  const candidateUrls = getBackendUrlCandidates();
  if (candidateUrls.length === 0) {
    candidateUrls.push(getBackendUrl());
  }

  const reachableUrls: string[] = [];
  for (const candidateUrl of candidateUrls) {
    try {
      const isReachable = await testBackendConnection(candidateUrl);
      if (isReachable) {
        reachableUrls.push(candidateUrl);
      }
    } catch {
      // ignore preflight errors and let delete attempts provide final result
    }
  }

  const urlsToTry = reachableUrls.length > 0 ? reachableUrls : candidateUrls;
  let lastError: unknown = null;

  for (const backendUrl of urlsToTry) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), ADMIN_DELETE_TIMEOUT_MS)
      : null;

    try {
      const response = await fetch(`${backendUrl}/api/admin/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: controller?.signal,
      });

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          payload?.error?.message ||
          payload?.message ||
          'Failed to permanently delete this user.';
        throw new Error(message);
      }

      rememberWorkingBackendUrl(backendUrl);
      return;
    } catch (error) {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      lastError = error;
      if (!isRetryableNetworkError(error)) {
        throw error;
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : 'Failed to permanently delete this user.';
  const attemptedUrls = urlsToTry.join(', ');
  if (reachableUrls.length === 0) {
    throw new Error(`Delete request could not reach the backend. Tried: ${attemptedUrls}. Check that your backend server is running and your phone can reach your computer on the same Wi-Fi.`);
  }

  throw new Error(`Delete request reached backend candidate(s) ${attemptedUrls} but still failed. ${message}`);
}
