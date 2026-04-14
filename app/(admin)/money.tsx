import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, TextInput, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import {
  applyBookingCommissionToUpcomingTransactions,
  getMonetizationDashboardData,
  getMonetizationSettings,
  markCommissionAsCollected,
  saveMonetizationSettings,
} from '../../services/MonetizationService';

const C = {
  bg: '#f0f4f8',
  card: '#ffffff',
  border: '#e2e8f0',
  text: '#1e293b',
  subtext: '#64748b',
  muted: '#94a3b8',
  blue: '#2563eb',
  blueLight: '#eff6ff',
  green: '#16a34a',
  greenLight: '#f0fdf4',
  amber: '#d97706',
  amberLight: '#fffbeb',
  red: '#dc2626',
  redLight: '#fef2f2',
};

type Txn = any;

const formatDate = (value: any) => {
  if (!value) return '-';
  if (typeof value?.toDate === 'function') return value.toDate().toLocaleString();
  if (value?.seconds) return new Date(value.seconds * 1000).toLocaleString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString();
};

const money = (value: any) => `${Number(value || 0)} EGP`;

export default function AdminMoneyScreen() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<any>(null);
  const [transactions, setTransactions] = useState<Txn[]>([]);
  const [providerQuery, setProviderQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'due' | 'paid'>('all');
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [bookingCommission, setBookingCommission] = useState('15');
  const [walkInCommission, setWalkInCommission] = useState('15');
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    void fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [dashboard, txSnap] = await Promise.all([
        getMonetizationDashboardData({ datePreset: 'all', offeringType: 'all' }),
        getDocs(collection(db, 'transactions')),
      ]);

      const settings = await getMonetizationSettings();
      const adminDoc = await getDoc(doc(db, 'settings', 'admin'));
      const rawAdmin = adminDoc.exists() ? (adminDoc.data() as any) : null;

      setBookingCommission(String(settings.bookingCommission?.value ?? 15));
      setWalkInCommission(String(rawAdmin?.checkInCommission?.value ?? settings.bookingCommission?.value ?? 15));

      const tx = txSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((item: any) => Number(item.platformRevenueAmount || 0) > 0)
        .sort((a: any, b: any) => {
          const aDate = new Date((a.updatedAt?.toDate?.() || a.updatedAt || a.createdAt || 0) as any).getTime();
          const bDate = new Date((b.updatedAt?.toDate?.() || b.updatedAt || b.createdAt || 0) as any).getTime();
          return bDate - aDate;
        });

      setSummary(dashboard);
      setTransactions(tx);
    } catch (error) {
      console.error('Failed to load money dashboard:', error);
      setSummary(null);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  };

  const filteredCheckins = useMemo(() => {
    const q = providerQuery.trim().toLowerCase();
    return transactions.filter((item: any) => {
      const paymentStatus = String(item.commissionPaymentStatus || '').toLowerCase() === 'paid' || String(item.commissionCollectionStatus || '').toLowerCase() === 'collected'
        ? 'paid'
        : (Number(item.platformRevenueAmount || 0) > 0 ? 'due' : 'n/a');

      const providerOk = !q || String(item.providerName || '').toLowerCase().includes(q) || String(item.providerId || '').toLowerCase().includes(q);
      const statusOk = statusFilter === 'all' || paymentStatus === statusFilter;
      return providerOk && statusOk;
    });
  }, [transactions, providerQuery, statusFilter]);

  const dueCount = filteredCheckins.filter((item: any) => {
    const paid = String(item.commissionPaymentStatus || '').toLowerCase() === 'paid' || String(item.commissionCollectionStatus || '').toLowerCase() === 'collected';
    return !paid && Number(item.platformRevenueAmount || 0) > 0;
  }).length;

  const paidCount = filteredCheckins.filter((item: any) => {
    const paid = String(item.commissionPaymentStatus || '').toLowerCase() === 'paid' || String(item.commissionCollectionStatus || '').toLowerCase() === 'collected';
    return paid;
  }).length;

  const handleMarkPaid = async (id: string) => {
    try {
      setMarkingId(id);
      await markCommissionAsCollected(id, auth.currentUser?.uid);
      await fetchData();
    } catch (error) {
      console.error('Failed to mark as paid:', error);
    } finally {
      setMarkingId(null);
    }
  };

  const handleSaveCommissionSettings = async () => {
    try {
      setSavingSettings(true);
      const current = await getMonetizationSettings();
      const bookingValue = Number(bookingCommission) || current.bookingCommission.value;
      const walkInValue = Number(walkInCommission) || bookingValue;

      const next = await saveMonetizationSettings({
        currency: current.currency,
        bookingCommission: {
          ...current.bookingCommission,
          value: bookingValue,
        },
        checkInFee: current.checkInFee,
        payouts: current.payouts,
        abuse: current.abuse,
      });

      // Keep legacy keys expected by current scanner flow for walk-in commission.
      await setDoc(doc(db, 'settings', 'admin'), {
        checkInCommission: {
          enabled: true,
          mode: 'percentage',
          value: walkInValue,
        },
        commissionRate: bookingValue,
        monetizationUpdatedAt: serverTimestamp(),
      }, { merge: true });

      const reprice = await applyBookingCommissionToUpcomingTransactions(next.bookingCommission, auth.currentUser?.uid);

      Alert.alert(
        'Saved',
        `Commission settings updated. ${reprice.updatedCount} upcoming booking record(s) were refreshed. Confirmed, paid, and recent records were not changed.`
      );
      await fetchData();
    } catch (error) {
      console.error('Failed to save commission settings:', error);
      Alert.alert('Error', 'Failed to save commission settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  if (loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator size="large" color={C.blue} />
        <Text style={S.loadingText}>Loading money data...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={S.container} contentContainerStyle={{ paddingBottom: 28 }}>
      <View style={S.header}>
        <Text style={S.title}>Money Dashboard</Text>
        <Text style={S.subtitle}>Clear view of what is due, paid, and every check-in commission record.</Text>
      </View>

      <View style={S.section}>
        <View style={S.kpiGrid}>
          <View style={S.kpiCard}>
            <Text style={S.kpiLabel}>Money Still to Receive</Text>
            <Text style={[S.kpiValue, { color: C.amber }]}>{money(summary?.moneyStillToReceive)}</Text>
            <Text style={S.kpiHint}>Commission generated but not yet collected from providers.</Text>
          </View>
          <View style={S.kpiCard}>
            <Text style={S.kpiLabel}>Money Received</Text>
            <Text style={[S.kpiValue, { color: C.green }]}>{money(summary?.moneyReceived)}</Text>
            <Text style={S.kpiHint}>Commission already collected and marked paid.</Text>
          </View>
          <View style={S.kpiCard}>
            <Text style={S.kpiLabel}>Booking Commission</Text>
            <Text style={[S.kpiValue, { color: C.blue }]}>{money(summary?.bookingRevenue)}</Text>
            <Text style={S.kpiHint}>Commission from attended in-app bookings.</Text>
          </View>
          <View style={S.kpiCard}>
            <Text style={S.kpiLabel}>Walk-in Commission</Text>
            <Text style={[S.kpiValue, { color: C.blue }]}>{money(summary?.checkInRevenue)}</Text>
            <Text style={S.kpiHint}>Commission from walk-in services entered at scan/check-in.</Text>
          </View>
        </View>
      </View>

      <View style={S.section}>
        <View style={S.card}>
          <Text style={S.sectionTitle}>Commission Settings</Text>
          <Text style={S.legendLine}>All money settings live here now.</Text>
          <Text style={[S.txLabel, { marginTop: 6 }]}>Booking Commission (%)</Text>
          <TextInput
            style={S.input}
            value={bookingCommission}
            onChangeText={setBookingCommission}
            keyboardType="numeric"
            placeholder="e.g. 15"
            placeholderTextColor={C.muted}
          />
          <Text style={[S.txLabel, { marginTop: 10 }]}>Walk-in Commission (%)</Text>
          <TextInput
            style={S.input}
            value={walkInCommission}
            onChangeText={setWalkInCommission}
            keyboardType="numeric"
            placeholder="e.g. 15"
            placeholderTextColor={C.muted}
          />
          <TouchableOpacity style={S.saveBtn} onPress={handleSaveCommissionSettings} disabled={savingSettings}>
            {savingSettings ? <ActivityIndicator color="#fff" size="small" /> : <Text style={S.saveBtnText}>Save Commission Settings</Text>}
          </TouchableOpacity>
          <Text style={[S.legendLine, { marginTop: 8 }]}>Updating booking commission refreshes upcoming booking records only. Confirmed, paid, and recent records are locked.</Text>
        </View>
      </View>

      <View style={S.section}>
        <View style={S.card}>
          <Text style={S.legendTitle}>Meaning</Text>
          <Text style={S.legendLine}>Due: Commission exists and admin has not collected cash/transfer yet.</Text>
          <Text style={S.legendLine}>Paid: Admin collected commission and marked it as paid.</Text>
          <Text style={S.legendLine}>Check-in attendance: Booking attendance proof, usually no extra platform fee on this transaction line.</Text>
          <Text style={S.legendLine}>Walk-in commission: Offline service entered at scanner with service value and commission %.</Text>
        </View>
      </View>

      <View style={S.section}>
        <View style={S.filterCard}>
          <TextInput
            style={S.input}
            value={providerQuery}
            onChangeText={setProviderQuery}
            placeholder="Filter by provider name"
            placeholderTextColor={C.muted}
          />
          <View style={S.chipRow}>
            {[
              { label: 'All', value: 'all' },
              { label: 'Due', value: 'due' },
              { label: 'Paid', value: 'paid' },
            ].map((chip) => (
              <TouchableOpacity
                key={chip.value}
                style={[S.chip, statusFilter === chip.value && S.chipActive]}
                onPress={() => setStatusFilter(chip.value as 'all' | 'due' | 'paid')}
              >
                <Text style={[S.chipText, statusFilter === chip.value && S.chipTextActive]}>{chip.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={S.countText}>Commission records shown: {filteredCheckins.length} (Due: {dueCount} | Paid: {paidCount})</Text>
        </View>
      </View>

      <View style={S.section}>
        <Text style={S.sectionTitle}>Commission Details</Text>
        {filteredCheckins.length === 0 ? (
          <View style={S.card}>
            <Text style={S.emptyText}>No commission records match this filter.</Text>
          </View>
        ) : (
          filteredCheckins.map((item: any) => {
            const isPaid = String(item.commissionPaymentStatus || '').toLowerCase() === 'paid' || String(item.commissionCollectionStatus || '').toLowerCase() === 'collected';
            const hasCommission = Number(item.platformRevenueAmount || 0) > 0;
            const statusText = hasCommission ? (isPaid ? 'Paid' : 'Due') : 'Attendance only';
            const statusColor = hasCommission ? (isPaid ? C.green : C.amber) : C.muted;

            return (
              <View key={item.id} style={S.txCard}>
                <View style={S.txHeader}>
                  <View>
                    <Text style={S.txProvider}>{item.providerName || 'Unknown provider'}</Text>
                    <Text style={S.txSub}>{String(item.providerRole || 'provider').toUpperCase()} • {item.walkInServiceName || item.serviceName || 'Service'} • {String(item.revenueSource || 'booking').toUpperCase()}</Text>
                  </View>
                  <View style={[S.statusPill, { backgroundColor: statusColor + '22' }]}>
                    <Text style={[S.statusPillText, { color: statusColor }]}>{statusText}</Text>
                  </View>
                </View>

                <View style={S.txGrid}>
                  <Text style={S.txLabel}>Transaction ID</Text>
                  <Text style={S.txValue}>{item.id}</Text>
                  <Text style={S.txLabel}>Customer</Text>
                  <Text style={S.txValue}>{item.customerName || '-'}</Text>
                  <Text style={S.txLabel}>Check-in ID</Text>
                  <Text style={S.txValue}>{item.checkInId || '-'}</Text>
                  <Text style={S.txLabel}>Source</Text>
                  <Text style={S.txValue}>{item.source || item.revenueSource || '-'}</Text>
                  <Text style={S.txLabel}>Gross Amount</Text>
                  <Text style={S.txValue}>{money(item.grossAmount)}</Text>
                  <Text style={S.txLabel}>Commission %</Text>
                  <Text style={S.txValue}>{item.commissionPercentage ?? item.walkInCommissionPercentage ?? '-'}{item.commissionPercentage != null || item.walkInCommissionPercentage != null ? '%' : ''}</Text>
                  <Text style={S.txLabel}>Platform Commission</Text>
                  <Text style={[S.txValue, { color: hasCommission ? C.green : C.subtext }]}>{money(item.platformRevenueAmount)}</Text>
                  <Text style={S.txLabel}>Provider Net</Text>
                  <Text style={S.txValue}>{money(item.providerNetAmount)}</Text>
                  <Text style={S.txLabel}>Attendance Time</Text>
                  <Text style={S.txValue}>{formatDate(item.attendanceVerifiedAt || item.updatedAt || item.createdAt)}</Text>
                  <Text style={S.txLabel}>Paid Time</Text>
                  <Text style={S.txValue}>{formatDate(item.commissionPaidAt || item.commissionCollectedAt)}</Text>
                </View>

                {!isPaid && hasCommission && (
                  <TouchableOpacity
                    style={S.payBtn}
                    onPress={() => handleMarkPaid(item.id)}
                    disabled={markingId === item.id}
                  >
                    {markingId === item.id ? <ActivityIndicator color="#fff" size="small" /> : <Text style={S.payBtnText}>Mark as Paid</Text>}
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10, backgroundColor: C.bg },
  loadingText: { color: C.subtext, fontSize: 14 },
  header: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: '900', color: C.text },
  subtitle: { marginTop: 4, color: C.subtext, fontSize: 13, lineHeight: 18 },
  section: { paddingHorizontal: 16, marginTop: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: C.text, marginBottom: 10 },
  card: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14 },
  legendTitle: { fontSize: 14, fontWeight: '800', color: C.text, marginBottom: 6 },
  legendLine: { fontSize: 12, color: C.subtext, marginBottom: 4, lineHeight: 17 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpiCard: { width: '47%', backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12 },
  kpiLabel: { fontSize: 12, fontWeight: '700', color: C.subtext },
  kpiValue: { marginTop: 5, fontSize: 20, fontWeight: '900' },
  kpiHint: { marginTop: 4, fontSize: 11, color: C.muted, lineHeight: 15 },
  filterCard: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12 },
  input: { height: 42, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10, color: C.text, backgroundColor: '#fff' },
  chipRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  chip: { borderWidth: 1, borderColor: C.border, backgroundColor: C.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  chipActive: { backgroundColor: C.blue, borderColor: C.blue },
  chipText: { color: C.subtext, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: '#fff' },
  countText: { marginTop: 10, fontSize: 12, color: C.muted, fontWeight: '600' },
  emptyText: { color: C.subtext, fontSize: 13 },
  txCard: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, marginBottom: 10 },
  txHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8 },
  txProvider: { fontSize: 15, fontWeight: '800', color: C.text },
  txSub: { marginTop: 2, fontSize: 12, color: C.subtext },
  statusPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  statusPillText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  txGrid: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8 },
  txLabel: { fontSize: 11, color: C.muted, marginTop: 6 },
  txValue: { fontSize: 13, color: C.text, fontWeight: '600' },
  saveBtn: { marginTop: 12, backgroundColor: C.blue, borderRadius: 10, height: 42, justifyContent: 'center', alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  payBtn: { marginTop: 12, backgroundColor: C.green, borderRadius: 10, height: 38, justifyContent: 'center', alignItems: 'center' },
  payBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
