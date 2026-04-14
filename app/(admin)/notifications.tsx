import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { auth } from '../../lib/firebase';
import { subscribeMyNotifications, markAsRead, markAllNotificationsAsRead, Notification, NotificationType } from '../../services/NotificationService';
import { formatTimestamp } from '../../lib/dateUtils';

const C = {
  bg: '#f0f4f8', card: '#ffffff', border: '#e2e8f0',
  text: '#1e293b', subtext: '#64748b', muted: '#94a3b8',
  blue: '#2563eb', blueLight: '#eff6ff',
  green: '#16a34a', greenLight: '#f0fdf4',
  amber: '#d97706', amberLight: '#fffbeb',
  red: '#dc2626', redLight: '#fef2f2',
  slate: '#64748b', slateLight: '#f1f5f9',
};

const TYPE_META: Record<NotificationType, { icon: string; color: string; label: string }> = {
  booking: { icon: 'calendar',           color: C.green,  label: 'Booking' },
  checkin: { icon: 'qr-code',            color: C.blue,   label: 'Check-in' },
  report:  { icon: 'flag',               color: C.red,    label: 'Report' },
  info:    { icon: 'information-circle', color: C.amber,  label: 'Info' },
  system:  { icon: 'notifications',      color: C.slate,  label: 'System' },
};


export default function AdminNotificationsScreen() {
  const router = useRouter();
  const [list, setList] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    if (!auth.currentUser) { setLoading(false); return; }
    const unsubscribe = subscribeMyNotifications((notifications) => {
      setList(notifications);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const unreadCount = list.filter(n => !n.read).length;

  const handleMarkAllRead = async () => {
    if (!unreadCount || markingAll) return;
    try {
      setMarkingAll(true);
      await markAllNotificationsAsRead();
    } catch (error) {
      console.warn('Mark all admin notifications read failed:', error);
    } finally {
      setMarkingAll(false);
    }
  };

  const handlePress = async (item: Notification) => {
    if (!item.read) {
      try { await markAsRead(item.id); } catch (e) { console.warn('Mark read failed:', e); }
    }
    if (item.type === 'report' && item.data?.reportId)  router.push('/(admin)/reports');
    if (item.type === 'booking' && item.data?.bookingId) router.push('/(admin)/bookings');
    if (item.type === 'checkin') router.push('/(admin)/checkins');
  };

  const renderItem = ({ item }: { item: Notification }) => {
    const meta = TYPE_META[item.type] || TYPE_META.system;
    const timeStr = formatTimestamp(item.createdAt, { fallback: '' });
    return (
      <TouchableOpacity
        style={[S.card, !item.read && S.cardUnread]}
        onPress={() => handlePress(item)}
        activeOpacity={0.75}
      >
        {!item.read && <View style={S.unreadDot} />}
        <View style={[S.accentBar, { backgroundColor: meta.color }]} />
        <View style={[S.iconCircle, { backgroundColor: meta.color + '18' }]}>
          <Ionicons name={meta.icon as any} size={22} color={meta.color} />
        </View>
        <View style={S.cardContent}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={[S.typePill, { backgroundColor: meta.color + '18' }]}>
              <Text style={[S.typePillText, { color: meta.color }]}>{meta.label}</Text>
            </View>
            <Text style={S.timeStr}>{timeStr}</Text>
          </View>
          <Text style={[S.notifTitle, !item.read && { color: C.text, fontWeight: '800' }]} numberOfLines={1}>{item.title}</Text>
          <Text style={S.notifBody} numberOfLines={2}>{item.body}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={C.muted} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={S.container}>
      <View style={S.header}>
        <TouchableOpacity onPress={() => router.back()} style={S.backBtn}>
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.headerTitle}>Notifications</Text>
          <Text style={S.headerSub}>
            {unreadCount > 0 ? unreadCount + ' unread' : 'All caught up'}
          </Text>
        </View>
        {unreadCount > 0 && (
          <TouchableOpacity style={S.markAllBtn} onPress={handleMarkAllRead} disabled={markingAll}>
            {markingAll
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={S.markAllText}>Mark all read</Text>
            }
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={S.center}>
          <ActivityIndicator size="large" color={C.blue} />
          <Text style={S.loadingText}>Loading notifications...</Text>
        </View>
      ) : list.length === 0 ? (
        <View style={S.center}>
          <View style={S.emptyIcon}>
            <Ionicons name="notifications-off-outline" size={36} color={C.muted} />
          </View>
          <Text style={S.emptyTitle}>No notifications yet</Text>
          <Text style={S.emptyDesc}>When something important happens, you will see it here.</Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={n => n.id}
          renderItem={renderItem}
          contentContainerStyle={S.list}
        />
      )}
    </View>
  );
}

const S = StyleSheet.create({
  container:   { flex: 1, backgroundColor: C.bg },
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 },
  loadingText: { color: C.subtext, fontSize: 14 },
  header:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 56, paddingBottom: 16, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn:     { width: 36, height: 36, borderRadius: 10, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: C.text },
  headerSub:   { fontSize: 12, color: C.muted, marginTop: 1 },
  markAllBtn:  { backgroundColor: C.text, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, minWidth: 110, alignItems: 'center', justifyContent: 'center' },
  markAllText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  list:        { padding: 14, paddingBottom: 40 },
  card:        { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 16, marginBottom: 10, paddingVertical: 14, paddingRight: 14, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  cardUnread:  { backgroundColor: C.blueLight },
  unreadDot:   { position: 'absolute', top: 12, right: 14, width: 8, height: 8, borderRadius: 4, backgroundColor: C.blue },
  accentBar:   { width: 4, alignSelf: 'stretch', borderRadius: 2, marginRight: 2 },
  iconCircle:  { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  cardContent: { flex: 1, gap: 3 },
  typePill:    { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  typePillText:{ fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  timeStr:     { fontSize: 11, color: C.muted },
  notifTitle:  { fontSize: 14, fontWeight: '700', color: C.text },
  notifBody:   { fontSize: 13, color: C.subtext, lineHeight: 18 },
  emptyIcon:   { width: 72, height: 72, borderRadius: 36, backgroundColor: C.border, justifyContent: 'center', alignItems: 'center' },
  emptyTitle:  { fontSize: 16, fontWeight: '700', color: C.text },
  emptyDesc:   { fontSize: 13, color: C.subtext, textAlign: 'center', maxWidth: 260 },
});
