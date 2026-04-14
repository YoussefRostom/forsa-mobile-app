import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { createNotification } from '../../services/NotificationService';
import { getAdminOverviewMetrics, logAdminAction } from '../../services/AdminOpsService';

const C = {
  bg: '#eef3f8',
  card: '#ffffff',
  border: '#dbe5ef',
  text: '#142438',
  subtext: '#5f7388',
  muted: '#90a2b6',
  blue: '#1f5b95',
  blueLight: '#e8f1fb',
  green: '#18824d',
  greenLight: '#edf9f1',
  amber: '#b56d12',
  amberLight: '#fff7ea',
  purple: '#5b46c9',
  purpleLight: '#f1eeff',
  red: '#c73a3a',
};

type RankingItem = { id: string; name: string; count: number };

type RankingGroup = {
  key: string;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  light: string;
  unit: string;
  list: RankingItem[];
};

const topBadgeColor = (index: number) => {
  if (index === 0) return { bg: '#fff3d1', fg: '#9a6400' };
  if (index === 1) return { bg: '#edf1f5', fg: '#4a5969' };
  if (index === 2) return { bg: '#ffe8db', fg: '#9a4f1b' };
  return { bg: '#f1f5f9', fg: '#64748b' };
};

export default function AdminTopRankingsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rankings, setRankings] = useState<any>(null);

  const [offerModalVisible, setOfferModalVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState<{ id: string; name: string } | null>(null);
  const [offerType, setOfferType] = useState<'gift' | 'offer'>('gift');
  const [offerTitle, setOfferTitle] = useState('');
  const [offerBody, setOfferBody] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await getAdminOverviewMetrics();
        setRankings(data?.topRankings || null);
      } catch (error) {
        console.error('Failed to load rankings:', error);
        Alert.alert('Error', 'Unable to load rankings right now.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const groups: RankingGroup[] = useMemo(() => {
    return [
      {
        key: 'clinics',
        title: 'Top Clinics Visited',
        subtitle: 'Most check-ins handled',
        icon: 'medkit',
        color: C.green,
        light: C.greenLight,
        unit: 'visits',
        list: rankings?.clinicsVisited || [],
      },
      {
        key: 'users',
        title: 'Top Users Booked',
        subtitle: 'Most active customers',
        icon: 'person',
        color: C.blue,
        light: C.blueLight,
        unit: 'bookings',
        list: rankings?.usersBooked || [],
      },
      {
        key: 'academies',
        title: 'Top Academies Booked',
        subtitle: 'Best performing academies',
        icon: 'school',
        color: C.purple,
        light: C.purpleLight,
        unit: 'bookings',
        list: rankings?.academiesBooked || [],
      },
      {
        key: 'parents',
        title: 'Top Parents Booked',
        subtitle: 'Most engaged parents',
        icon: 'people',
        color: C.amber,
        light: C.amberLight,
        unit: 'bookings',
        list: rankings?.parentsBooked || [],
      },
    ];
  }, [rankings]);

  const openOfferModal = (item: RankingItem, type: 'gift' | 'offer') => {
    setSelectedUser({ id: item.id, name: item.name || 'User' });
    setOfferType(type);
    setOfferTitle(type === 'gift' ? 'You earned a gift' : 'Special offer for you');
    setOfferBody(
      type === 'gift'
        ? 'You are one of our top users this month. Enjoy a reward from the admin team.'
        : 'You are eligible for a special admin offer based on your activity. Contact support for details.'
    );
    setOfferModalVisible(true);
  };

  const sendOffer = async () => {
    if (!selectedUser) return;
    if (!offerTitle.trim() || !offerBody.trim()) {
      Alert.alert('Missing info', 'Please provide both title and message.');
      return;
    }

    setSending(true);
    try {
      await createNotification({
        userId: selectedUser.id,
        title: offerTitle.trim(),
        body: offerBody.trim(),
        type: 'info',
        data: {
          offerType,
          route: '/notifications',
          source: 'top_rankings',
        },
      });

      await logAdminAction({
        actionType: 'broadcast_sent',
        targetCollection: 'users',
        targetId: selectedUser.id,
        reason: `${offerType} sent from top rankings`,
        metadata: { title: offerTitle.trim() },
      });

      setOfferModalVisible(false);
      Alert.alert('Sent', `${offerType === 'gift' ? 'Gift' : 'Offer'} sent to ${selectedUser.name}.`);
    } catch (error) {
      console.error('Failed to send offer:', error);
      Alert.alert('Error', 'Failed to send message. Please try again.');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <View style={S.loadingWrap}>
        <ActivityIndicator size="large" color={C.blue} />
        <Text style={S.loadingText}>Loading top rankings...</Text>
      </View>
    );
  }

  return (
    <View style={S.container}>
      <View style={S.header}>
        <TouchableOpacity style={S.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.headerTitle}>Top Rankings</Text>
          <Text style={S.headerSub}>Reward top performers with gifts and offers</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        {groups.map((group) => (
          <View key={group.key} style={S.groupCard}>
            <View style={S.groupHeader}>
              <View style={[S.groupIcon, { backgroundColor: group.light }]}>
                <Ionicons name={group.icon} size={18} color={group.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={S.groupTitle}>{group.title}</Text>
                <Text style={S.groupSub}>{group.subtitle}</Text>
              </View>
            </View>

            {group.list.length === 0 ? (
              <Text style={S.emptyText}>No ranking data available yet.</Text>
            ) : (
              group.list.map((item, idx) => {
                const badge = topBadgeColor(idx);
                return (
                  <View key={`${group.key}_${item.id}`} style={S.rankRow}>
                    <View style={[S.rankBadge, { backgroundColor: badge.bg }]}>
                      <Text style={[S.rankBadgeText, { color: badge.fg }]}>#{idx + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={S.rankName} numberOfLines={1}>{item.name || 'Unknown'}</Text>
                      <Text style={S.rankMeta}>{item.count} {group.unit}</Text>
                    </View>
                    <View style={S.rankActions}>
                      <TouchableOpacity
                        style={[S.actionBtn, { backgroundColor: C.amberLight }]}
                        onPress={() => openOfferModal(item, 'gift')}
                      >
                        <Text style={[S.actionText, { color: C.amber }]}>Gift</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[S.actionBtn, { backgroundColor: C.blueLight }]}
                        onPress={() => openOfferModal(item, 'offer')}
                      >
                        <Text style={[S.actionText, { color: C.blue }]}>Offer</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        ))}
      </ScrollView>

      <Modal transparent visible={offerModalVisible} animationType="slide" onRequestClose={() => setOfferModalVisible(false)}>
        <View style={S.modalBg}>
          <View style={S.modalBox}>
            <View style={S.modalHeader}>
              <Text style={S.modalTitle}>{offerType === 'gift' ? 'Send Gift' : 'Send Offer'}</Text>
              <TouchableOpacity onPress={() => setOfferModalVisible(false)}>
                <Ionicons name="close" size={22} color={C.subtext} />
              </TouchableOpacity>
            </View>
            <Text style={S.modalSub}>Target user: {selectedUser?.name}</Text>

            <View style={S.switchRow}>
              <TouchableOpacity
                style={[S.switchBtn, offerType === 'gift' && S.switchBtnActive]}
                onPress={() => setOfferType('gift')}
              >
                <Text style={[S.switchText, offerType === 'gift' && S.switchTextActive]}>Gift</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[S.switchBtn, offerType === 'offer' && S.switchBtnActive]}
                onPress={() => setOfferType('offer')}
              >
                <Text style={[S.switchText, offerType === 'offer' && S.switchTextActive]}>Offer</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={S.input}
              value={offerTitle}
              onChangeText={setOfferTitle}
              placeholder="Title"
              placeholderTextColor={C.muted}
            />
            <TextInput
              style={[S.input, S.textArea]}
              value={offerBody}
              onChangeText={setOfferBody}
              placeholder="Message"
              placeholderTextColor={C.muted}
              multiline
              textAlignVertical="top"
            />

            <TouchableOpacity style={S.sendBtn} onPress={sendOffer} disabled={sending}>
              {sending ? <ActivityIndicator color="#fff" /> : <Text style={S.sendBtnText}>Send Now</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 14, paddingTop: 12 },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10, backgroundColor: C.bg },
  loadingText: { color: C.subtext, fontSize: 13 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: C.border },
  headerTitle: { fontSize: 22, fontWeight: '900', color: C.text },
  headerSub: { fontSize: 12, color: C.subtext, marginTop: 2 },

  groupCard: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 12, marginBottom: 12 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  groupIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  groupTitle: { fontSize: 14, color: C.text, fontWeight: '800' },
  groupSub: { fontSize: 11, color: C.subtext, marginTop: 1 },
  emptyText: { color: C.muted, fontSize: 12, paddingVertical: 8 },

  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#eef2f6' },
  rankBadge: { width: 34, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rankBadgeText: { fontSize: 11, fontWeight: '900' },
  rankName: { fontSize: 13, color: C.text, fontWeight: '700' },
  rankMeta: { fontSize: 11, color: C.subtext, marginTop: 2 },
  rankActions: { flexDirection: 'row', gap: 6 },
  actionBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  actionText: { fontSize: 11, fontWeight: '800' },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { color: C.text, fontSize: 17, fontWeight: '900' },
  modalSub: { marginTop: 6, marginBottom: 10, color: C.subtext, fontSize: 12 },
  switchRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  switchBtn: { flex: 1, borderRadius: 9, borderWidth: 1, borderColor: C.border, paddingVertical: 8, alignItems: 'center', backgroundColor: '#fff' },
  switchBtnActive: { backgroundColor: C.blueLight, borderColor: C.blue },
  switchText: { color: C.subtext, fontSize: 12, fontWeight: '700' },
  switchTextActive: { color: C.blue },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10, color: C.text },
  textArea: { minHeight: 90 },
  sendBtn: { marginTop: 4, backgroundColor: C.blue, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  sendBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});