import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import PureQRCode from '../../components/PureQRCode';
import i18n from '../../locales/i18n';

const C = {
  bg: '#f0f4f8', card: '#ffffff', border: '#e2e8f0',
  text: '#1e293b', subtext: '#64748b', muted: '#94a3b8',
  blue: '#2563eb', blueLight: '#eff6ff',
};

export default function QRDisplay() {
  const params = useLocalSearchParams<{ code?: string; title?: string }>();
  const rawCode = typeof params.code === 'string' && params.code.trim().length > 0
    ? params.code.trim()
    : 'FORSA-X92-2024';
  const qrValue = rawCode.startsWith('forsa_checkin:') ? rawCode : `forsa_checkin:${rawCode}`;
  const screenTitle = typeof params.title === 'string' && params.title.trim().length > 0
    ? params.title
    : (i18n.t('myQrCode') || 'QR Code');

  return (
    <View style={S.container}>
      <View style={S.card}>
        <View style={S.headerBadge}>
          <Text style={S.headerBadgeText}>Check-in</Text>
        </View>
        <Text style={S.title}>{screenTitle}</Text>
        <Text style={S.subtitle}>{i18n.t('scanCheckIn') || 'Scan this QR for attendance check-in'}</Text>

        <View style={S.qrWrapper}>
          <PureQRCode
            value={qrValue}
            size={220}
            color="#111"
            backgroundColor="#fff"
            quietZone={12}
          />
        </View>

        <View style={S.infoBox}>
          <Text style={S.infoLabel}>{i18n.t('checkInCode') || 'Check-in Code'}</Text>
          <Text style={S.infoValue}>{rawCode}</Text>
        </View>
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: C.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  headerBadge: {
    backgroundColor: C.blueLight,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 10,
  },
  headerBadgeText: {
    color: C.blue,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: C.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: C.subtext,
    marginTop: 6,
    marginBottom: 20,
    textAlign: 'center',
    lineHeight: 20,
  },
  qrWrapper: {
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    backgroundColor: '#fff',
    marginBottom: 18,
  },
  infoBox: {
    width: '100%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: '#fafcff',
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: 11,
    color: C.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoValue: {
    marginTop: 3,
    fontSize: 18,
    fontWeight: '800',
    color: C.text,
    textAlign: 'center',
  },
});
