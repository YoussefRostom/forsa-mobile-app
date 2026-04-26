import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc } from 'firebase/firestore';
import * as Clipboard from 'expo-clipboard';
import PureQRCode from '../components/PureQRCode';
import { db } from '../lib/firebase';
import { ensureCheckInCodeForCurrentUser } from '../services/CheckInCodeService';
import FootballLoader from '../components/FootballLoader';
import i18n from '../locales/i18n';

const C = {
  bg: '#f0f4f8',
  card: '#ffffff',
  border: '#e2e8f0',
  text: '#1e293b',
  subtext: '#64748b',
  muted: '#94a3b8',
  blue: '#2563eb',
  blueLight: '#eff6ff',
};

const deriveShortBookingCode = (bookingId: string) =>
  String(bookingId || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(-7);

export default function BookingQrScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ bookingId?: string; providerName?: string; date?: string; time?: string }>();
  const bookingId = typeof params.bookingId === 'string' ? params.bookingId : '';
  const providerName = typeof params.providerName === 'string' ? params.providerName : 'Provider';
  const date = typeof params.date === 'string' ? params.date : '';
  const time = typeof params.time === 'string' ? params.time : '';

  const [code, setCode] = useState<string | null>(null);
  const [isBookingConfirmed, setIsBookingConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    void (async () => {
      try {
        if (!bookingId) {
          if (isActive) setIsBookingConfirmed(false);
          return;
        }

        const bookingSnap = await getDoc(doc(db, 'bookings', bookingId));
        if (!bookingSnap.exists()) {
          if (isActive) setIsBookingConfirmed(false);
          return;
        }

        const bookingStatus = String((bookingSnap.data() as any)?.status || '').toLowerCase();
        if (bookingStatus !== 'confirmed') {
          if (isActive) setIsBookingConfirmed(false);
          return;
        }

        const currentCode = await ensureCheckInCodeForCurrentUser();
        if (!isActive) return;
        setCode(currentCode);
        setIsBookingConfirmed(true);
      } finally {
        if (isActive) setLoading(false);
      }
    })();

    return () => {
      isActive = false;
    };
  }, [bookingId]);

  const qrValue = bookingId && code && isBookingConfirmed
    ? `forsa_checkin_booking:${bookingId}:${code}`
    : 'forsa_checkin:unavailable';

  const manualEntryCode = bookingId && code && isBookingConfirmed
    ? deriveShortBookingCode(bookingId)
    : '';

  const copyManualCode = async () => {
    if (!manualEntryCode) return;
    await Clipboard.setStringAsync(manualEntryCode);
    Alert.alert(
      i18n.t('copied') || 'Copied',
      i18n.t('checkInCodeCopied') || 'Check-in code copied to clipboard'
    );
  };

  return (
    <View style={S.container}>
      <View style={S.card}>
        <View style={S.topRow}>
          <TouchableOpacity style={S.backButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={16} color={C.text} />
            <Text style={S.backButtonText}>Back</Text>
          </TouchableOpacity>
        </View>

        <View style={S.badge}><Text style={S.badgeText}>Booking Attendance</Text></View>
        <Text style={S.title}>Show This QR At Check-in</Text>
        <Text style={S.subtitle}>Scan confirms attendance and activates commission for this booking.</Text>

        {loading ? (
          <View style={S.loaderWrap}>
            <FootballLoader size="large" color={C.blue} />
            <Text style={S.loaderText}>Preparing QR...</Text>
          </View>
        ) : !isBookingConfirmed ? (
          <View style={S.loaderWrap}>
            <Text style={S.loaderText}>QR is available only after booking is confirmed.</Text>
          </View>
        ) : (
          <>
            <View style={S.qrWrap}>
              <PureQRCode
                value={qrValue}
                size={220}
                color="#111"
                backgroundColor="#fff"
                quietZone={12}
              />
            </View>
            <View style={S.manualCodeBox}>
              <Text style={S.manualCodeLabel}>Manual Booking Code (7 chars)</Text>
              <TouchableOpacity style={S.manualCodeRow} onPress={copyManualCode} activeOpacity={0.7}>
                <Text selectable style={S.manualCodeValue}>{manualEntryCode}</Text>
                <Ionicons name="copy-outline" size={18} color={C.blue} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={S.copyButton} onPress={copyManualCode} activeOpacity={0.8}>
              <Ionicons name="copy" size={18} color="#fff" />
              <Text style={S.copyButtonText}>{i18n.t('copyCode') || 'Copy Code'}</Text>
            </TouchableOpacity>
          </>
        )}

        <View style={S.infoBox}>
          <Text style={S.infoLabel}>Provider</Text>
          <Text style={S.infoValue}>{providerName}</Text>
          {!!(date || time) && <Text style={S.infoSub}>{date}{time ? ` • ${time}` : ''}</Text>}
        </View>
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: {
    width: '100%',
    maxWidth: 430,
    backgroundColor: C.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 22,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  topRow: {
    width: '100%',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: '#fff',
  },
  backButtonText: {
    color: C.text,
    fontSize: 13,
    fontWeight: '700',
  },
  badge: { backgroundColor: C.blueLight, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 10 },
  badgeText: { color: C.blue, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { fontSize: 22, fontWeight: '800', color: C.text, textAlign: 'center' },
  subtitle: { marginTop: 6, fontSize: 13, color: C.subtext, textAlign: 'center', lineHeight: 18, marginBottom: 16 },
  loaderWrap: { height: 250, justifyContent: 'center', alignItems: 'center', gap: 8 },
  loaderText: { fontSize: 13, color: C.subtext },
  qrWrap: { padding: 14, borderWidth: 1, borderColor: C.border, borderRadius: 16, backgroundColor: '#fff', marginBottom: 16 },
  manualCodeBox: {
    width: '100%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: '#f8fafc',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  manualCodeLabel: {
    fontSize: 11,
    color: C.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  manualCodeValue: {
    fontSize: 12,
    color: C.text,
    fontWeight: '600',
  },
  manualCodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  copyButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.blue,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  copyButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  infoBox: { width: '100%', borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: '#fafcff', paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center' },
  infoLabel: { fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  infoValue: { marginTop: 3, fontSize: 16, fontWeight: '700', color: C.text, textAlign: 'center' },
  infoSub: { marginTop: 3, fontSize: 12, color: C.subtext, textAlign: 'center' },
});
