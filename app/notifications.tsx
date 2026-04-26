import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { auth } from '../lib/firebase';
import i18n from '../locales/i18n';
import {
  listMyNotifications,
  subscribeMyNotifications,
  markAsRead,
  markAllNotificationsAsRead,
  Notification,
  NotificationType,
} from '../services/NotificationService';
import { getOrCreateConversation } from '../services/MessagingService';
import { getCurrentUserRole } from '../services/UserRoleService';
import { formatTimestamp } from '../lib/dateUtils';
import FootballLoader from '../components/FootballLoader';
import { db } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

const typeToIcon: Record<NotificationType, string> = {
  booking: 'calendar',
  checkin: 'qr-code',
  report: 'flag',
  info: 'information-circle',
  system: 'notifications',
};

const typeToColor: Record<NotificationType, string> = {
  booking: '#1cc88a',
  checkin: '#4e73df',
  report: '#FF3B30',
  info: '#007AFF',
  system: '#8E8E93',
};

export default function NotificationsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [list, setList] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const reloadNotifications = useCallback(async () => {
    if (!user?.uid) {
      setList([]);
      setLoading(false);
      return;
    }

    try {
      const notifications = await listMyNotifications(100, user.uid);
      setList(notifications);
    } catch (error) {
      console.error('Failed to reload notifications:', error);
      Alert.alert(i18n.t('error') || 'Error', i18n.t('unableLoadNotifications') || 'Unable to load notifications right now.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.uid]);

  useFocusEffect(
    useCallback(() => {
      if (!user?.uid) {
        setList([]);
        setLoading(false);
        return () => {};
      }

      setLoading(true);
      void reloadNotifications();

      const unsubscribe = subscribeMyNotifications((notifications) => {
        setList(notifications);
        setLoading(false);
        setRefreshing(false);
      }, 100, user.uid);

      return () => unsubscribe();
    }, [reloadNotifications, user?.uid])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void reloadNotifications();
  }, [reloadNotifications]);

  const unreadCount = list.filter((item) => !item.read).length;

  const handleMarkAllRead = async () => {
    if (!unreadCount || markingAll) return;
    try {
      setMarkingAll(true);
      await markAllNotificationsAsRead();
    } catch (error) {
      console.warn('Mark all notifications read failed:', error);
      Alert.alert(i18n.t('error') || 'Error', i18n.t('unableMarkNotificationsRead') || 'Unable to mark all notifications as read right now.');
    } finally {
      setMarkingAll(false);
    }
  };

  const handlePress = async (item: Notification) => {
    if (!item.read) {
      try {
        await markAsRead(item.id);
      } catch (e) {
        console.warn('Mark read failed:', e);
      }
    }

    try {
      // Navigate based on notification type and current user role (stay in own profile)
      const role = await getCurrentUserRole().catch(() => null);

      const chatRoute =
        role === 'parent' ? '/parent-chat' :
        role === 'clinic' ? '/clinic-chat' :
        role === 'academy' ? '/academy-chat' :
        role === 'agent' ? '/agent-messages' :
        '/player-chat';

      const notificationKind = String(item.data?.notificationKind || '');

      if (notificationKind === 'follow' && item.data?.actorId) {
        const actorId = String(item.data.actorId);
        const actorRole = String(item.data.actorRole || 'player');
        const actorName = String(item.data.actorName || item.body || 'User');
        router.push({
          pathname: '/agent-user-posts',
          params: { ownerId: actorId, ownerRole: actorRole, userName: actorName },
        } as any);
        return;
      }

      if (notificationKind === 'chat' || item.data?.conversationId || item.data?.senderId) {
        const senderId = item.data?.senderId ? String(item.data.senderId) : '';
        const conversationId = item.data?.conversationId
          ? String(item.data.conversationId)
          : senderId
            ? await getOrCreateConversation(senderId)
            : '';

        const otherUserId = senderId || (() => {
          const parts = conversationId.split('_');
          const current = auth.currentUser?.uid;
          return parts[0] === current ? parts[1] : parts[0];
        })();

        if (role === 'admin') {
          router.push({ pathname: '/(admin)/user-chat', params: { otherUserId, name: item.title || 'User' } } as any);
        } else {
          router.push({ pathname: chatRoute as any, params: { conversationId, otherUserId, name: item.title || 'User', contact: item.title || 'User' } } as any);
        }
        return;
      }

      if (item.type === 'booking' && item.data?.bookingId) {
        const bookingRoute =
          role === 'parent' ? '/parent-bookings' :
          role === 'clinic' ? '/clinic-bookings' :
          role === 'academy' ? '/academy-bookings' :
          role === 'agent' ? '/agent-feed' :
          '/player-bookings';
        router.push(bookingRoute as any);
        return;
      }

      if (item.type === 'checkin' && role === 'clinic') {
        router.push('/clinic-bookings' as any);
        return;
      }

      if (item.type === 'checkin' && role === 'academy') {
        router.push('/academy-bookings' as any);
        return;
      }

      if (item.type === 'report' && role === 'admin') {
        router.push('/(admin)/reports' as any);
        return;
      }

      if (item.data?.postId) {
        const postId = String(item.data.postId);
        const postSnap = await getDoc(doc(db, 'posts', postId)).catch(() => null);
        const postData = postSnap?.exists() ? postSnap.data() : {};
        const ownerId = String(postData?.ownerId || auth.currentUser?.uid || '');
        const ownerRole = String(postData?.ownerRole || 'player');
        const userName = String(postData?.author || item.title || 'Player');

        router.push({
          pathname: '/agent-user-posts',
          params: { ownerId, ownerRole, userName, focusPostId: postId },
        } as any);
        return;
      }
    } catch (error) {
      console.error('Failed to open notification target', error);
      Alert.alert(i18n.t('error') || 'Error', 'Unable to open this notification right now.');
    }
  };

  const renderItem = ({ item }: { item: Notification }) => {
    const icon = typeToIcon[item.type] || 'notifications';
    const color = typeToColor[item.type] || '#666';
    const timeStr = formatTimestamp(item.createdAt, { fallback: '' });

    return (
      <TouchableOpacity
        style={[styles.item, !item.read && styles.itemUnread]}
        onPress={() => handlePress(item)}
        activeOpacity={0.7}
      >
        <View style={[styles.iconContainer, { backgroundColor: color + '22' }]}>
          <Ionicons name={icon as any} size={24} color={color} />
        </View>
        <View style={styles.content}>
          <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.message} numberOfLines={2}>{item.body}</Text>
          {timeStr ? <Text style={styles.time}>{timeStr}</Text> : null}
        </View>
      </TouchableOpacity>
    );
  };

  if (!user?.uid) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>{i18n.t('loginRequired') || 'Please log in'}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{i18n.t('notifications') || 'Notifications'}</Text>
        <View style={styles.headerRight} />
      </View>
      <View style={styles.summaryRow}>
        <Text style={styles.summaryText}>
          {unreadCount > 0 ? (i18n.t('unreadCountText', { count: unreadCount }) || `${unreadCount} unread`) : (i18n.t('allCaughtUp') || 'All caught up')}
        </Text>
        {unreadCount > 0 ? (
          <TouchableOpacity style={styles.markAllButton} onPress={handleMarkAllRead} disabled={markingAll}>
            <Text style={styles.markAllButtonText}>{markingAll ? (i18n.t('updating') || 'Updating...') : (i18n.t('markAllRead') || 'Mark all read')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {loading ? (
        <View style={styles.center}>
          <FootballLoader size="large" color="#007AFF" />
          <Text style={styles.loadingText}>{i18n.t('loading') || 'Loading...'}</Text>
        </View>
      ) : list.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="notifications-off-outline" size={64} color="#ccc" />
          <Text style={styles.emptyText}>{i18n.t('noNotifications') || 'No notifications yet'}</Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#007AFF" />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6f9' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 12,
    paddingTop: 48,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  backButton: { padding: 8 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#333' },
  headerRight: { width: 40 },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eef2f7',
  },
  summaryText: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: '600',
  },
  markAllButton: {
    backgroundColor: '#111827',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  markAllButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  list: { padding: 16 },
  item: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemUnread: {
    backgroundColor: '#f0f8ff',
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  content: { flex: 1 },
  title: { fontSize: 16, fontWeight: '600', color: '#333' },
  message: { fontSize: 14, color: '#666', marginTop: 2 },
  time: { fontSize: 12, color: '#999', marginTop: 4 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 14, color: '#666' },
  emptyText: { marginTop: 16, fontSize: 16, color: '#999' },
});
