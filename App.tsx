// Polyfills must be imported first
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';

// Ensure a global crypto object exists for AWS SDK
// react-native-get-random-values provides crypto.getRandomValues
// but AWS SDK might need the crypto object to exist
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = globalThis.crypto || {};
}

import { I18nManager } from 'react-native';
import './locales/i18n'; // Load translations
import './lib/firebase'; // Initialize Firebase
import { initializeLanguage } from './lib/languageUtils';

// Handle unhandled promise rejections (e.g., keep-awake errors from dependencies)
// This suppresses non-critical errors from dependencies like expo-keep-awake
if (typeof ErrorUtils !== 'undefined') {
  const originalHandler = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    // Suppress keep-awake errors (common on web/simulator where it's not supported)
    const errorMessage = error?.message || String(error || '');
    if (
      errorMessage.includes('keep awake') ||
      errorMessage.includes('keep-awake') ||
      errorMessage.includes('KeepAwake') ||
      errorMessage.includes('Unable to activate keep awake')
    ) {
      // Silently ignore - keep-awake is not critical for app functionality
      return;
    }
    // Call original handler for other errors
    if (originalHandler) {
      originalHandler(error, isFatal);
    }
  });
}

// Set initial RTL state based on saved language
initializeLanguage().catch((error: unknown) => {
  console.error('Error initializing language:', error);
});

// Entry point for Expo Router
export { default } from 'expo-router/entry';

I18nManager.allowRTL(true);
