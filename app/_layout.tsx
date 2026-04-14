import { Slot } from 'expo-router';
import React, { useEffect } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider } from 'react-native-toast-notifications';
import { HamburgerMenuProvider } from '../components/HamburgerMenuContext';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { initCrashReporting, Sentry, setCrashReportingUser } from '../services/CrashReportingService';
import { configurePushNotificationListeners, syncCurrentUserPushToken } from '../services/PushNotificationService';
import i18n from '../locales/i18n';

initCrashReporting();

function PushNotificationBootstrap() {
  const { user } = useAuth();

  useEffect(() => {
    configurePushNotificationListeners();
  }, []);

  useEffect(() => {
    setCrashReportingUser(
      user
        ? {
            uid: user.uid,
            email: user.email,
            name: user.name,
            role: user.role,
          }
        : null
    );
  }, [user]);

  useEffect(() => {
    if (!user?.uid) return;
    void syncCurrentUserPushToken();
  }, [user?.uid]);

  return null;
}

function AppCrashFallback({ resetError }: { resetError: () => void }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#0f172a',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
      }}
    >
      <Text style={{ color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 10 }}>
        {i18n.t('somethingWentWrong') || 'Something went wrong'}
      </Text>
      <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 15, textAlign: 'center', marginBottom: 20 }}>
        {i18n.t('issueLoggedMessage') || 'The issue has been logged so it can be fixed quickly.'}
      </Text>
      <TouchableOpacity
        onPress={resetError}
        style={{ backgroundColor: '#fff', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10 }}
      >
        <Text style={{ color: '#111827', fontWeight: '700' }}>{i18n.t('tryAgain') || 'Try again'}</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function Layout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <Sentry.ErrorBoundary fallback={({ resetError }) => <AppCrashFallback resetError={resetError} />}>
            <PushNotificationBootstrap />
            <HamburgerMenuProvider>
              <ToastProvider>
                <Slot />
              </ToastProvider>
            </HamburgerMenuProvider>
          </Sentry.ErrorBoundary>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
