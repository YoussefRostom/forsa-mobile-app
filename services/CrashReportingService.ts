import Constants from 'expo-constants';
import React from 'react';

const sentryDsn =
  (process.env.EXPO_PUBLIC_SENTRY_DSN || Constants.expoConfig?.extra?.sentryDsn || '').trim();

let crashReportingInitialized = false;
let sentryModuleCache: any | null | undefined;

function getSentryModule(): any | null {
  if (sentryModuleCache !== undefined) {
    return sentryModuleCache;
  }

  try {
    const optionalRequire = eval('require');
    sentryModuleCache = optionalRequire('@sentry/react-native');
  } catch (error) {
    console.warn('[CrashReportingService] Sentry is unavailable in this build:', error);
    sentryModuleCache = null;
  }

  return sentryModuleCache;
}

export function initCrashReporting(): void {
  if (crashReportingInitialized || !sentryDsn) {
    return;
  }

  const SentryModule = getSentryModule();
  if (!SentryModule) {
    return;
  }

  SentryModule.init({
    dsn: sentryDsn,
    enabled: !__DEV__,
    debug: __DEV__,
    tracesSampleRate: __DEV__ ? 1.0 : 0.2,
    attachStacktrace: true,
  });

  crashReportingInitialized = true;
}

export function setCrashReportingUser(user: {
  uid?: string;
  email?: string;
  name?: string;
  role?: string;
} | null): void {
  if (!sentryDsn) return;
  if (!crashReportingInitialized) initCrashReporting();

  const SentryModule = getSentryModule();
  if (!SentryModule) return;

  SentryModule.setUser(
    user
      ? {
          id: user.uid,
          email: user.email,
          username: user.name,
          role: user.role,
        }
      : null
  );
}

export function captureAppException(
  error: unknown,
  extra?: Record<string, unknown>
): void {
  if (!sentryDsn) {
    console.error('[CrashReportingService] Captured exception:', error, extra);
    return;
  }

  if (!crashReportingInitialized) initCrashReporting();

  const SentryModule = getSentryModule();
  if (!SentryModule) {
    console.error('[CrashReportingService] Sentry unavailable, falling back to console:', error, extra);
    return;
  }

  SentryModule.withScope((scope: any) => {
    if (extra) {
      scope.setContext('extra', extra);
    }
    SentryModule.captureException(error);
  });
}

export function isCrashReportingEnabled(): boolean {
  return Boolean(sentryDsn);
}

function SafeErrorBoundary({ children, fallback }: { children: React.ReactNode; fallback?: any }) {
  const SentryModule = getSentryModule();
  const BoundaryComponent = SentryModule?.ErrorBoundary;

  if (BoundaryComponent) {
    return React.createElement(BoundaryComponent, { fallback }, children);
  }

  return React.createElement(React.Fragment, null, children);
}

export const Sentry = {
  ErrorBoundary: SafeErrorBoundary,
};
