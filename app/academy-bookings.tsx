import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useRef, useState, useEffect } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import i18n from '../locales/i18n';
import { db, auth } from '../lib/firebase';
import { collection, query, where, getDocs, updateDoc, doc, orderBy } from 'firebase/firestore';
import { startConversationWithUser } from '../services/BookingMessagingService';
import { findAdminUserId } from '../services/MessagingService';

type BookingItem = {
  id: string;
  type: 'academy' | 'clinic';
  status: string;
  createdAt?: string;
  playerName?: string;
  playerId?: string;
  parentId?: string;
  playerAge?: string;
  ageGroup?: string;
  program?: string;
  date?: string;
  time?: string;
  price?: number;
  providerName?: string;
  doctor?: string;
  service?: string;
  customerName?: string;
  sessionType?: 'group' | 'private' | 'semiPrivate';
  trainerId?: string;
  trainerName?: string;
  proposedByAdmin?: boolean;
};

export default function AcademyBookingsScreen() {
  const { openMenu } = useHamburgerMenu();
  const [filter, setFilter] = useState<'all' | 'confirmed' | 'pending' | 'cancelled'>('all');
  const router = useRouter();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchBookings = async () => {
    const user = auth.currentUser;
    if (!user) {
      setBookings([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const all: BookingItem[] = [];

      // 1) Academy as provider: bookings made by players/parents to this academy
      try {
        const qProvider = query(
          collection(db, 'bookings'),
          where('providerId', '==', user.uid),
          where('type', '==', 'academy')
        );
        const snapProvider = await getDocs(qProvider);
        snapProvider.forEach((docSnap) => {
          const d = docSnap.data();
          all.push({
            id: docSnap.id,
            type: 'academy',
            status: d.status || 'pending',
            createdAt: d.createdAt,
            playerName: d.playerName || d.customerName,
            playerId: d.playerId,
            parentId: d.parentId,
            playerAge: d.ageGroup || d.playerAge,
            program: d.program,
            date: d.date,
            time: d.time,
            price: d.price,
            providerName: d.providerName,
            sessionType: d.sessionType,
            trainerId: d.trainerId,
            trainerName: d.trainerName,
            proposedByAdmin: d.proposedByAdmin,
          });
        });
      } catch (err) {
        console.warn('Academy provider bookings fetch error:', err);
      }

      // 2) Academy as customer: clinic bookings made by this academy
      try {
        const qClinic = query(
          collection(db, 'bookings'),
          where('academyId', '==', user.uid),
          where('type', '==', 'clinic')
        );
        const snapClinic = await getDocs(qClinic);
        snapClinic.forEach((docSnap) => {
          const d = docSnap.data();
          all.push({
            id: docSnap.id,
            type: 'clinic',
            status: d.status || 'pending',
            createdAt: d.createdAt,
            providerName: d.providerName || d.name,
            doctor: d.doctor,
            service: d.service,
            date: d.date,
            time: d.time,
            price: d.price,
            customerName: d.customerName,
            proposedByAdmin: d.proposedByAdmin,
          });
        });
      } catch (err) {
        console.warn('Academy clinic bookings fetch error:', err);
      }

      all.sort((a, b) => {
        const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tB - tA;
      });

      setBookings(all);
    } catch (error) {
      console.error('Error fetching academy bookings:', error);
      Alert.alert(i18n.t('error'), 'Failed to load bookings');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const findAdminUserId = async () => {
    try {
      const adminQuery = query(collection(db, 'users'), where('role', '==', 'admin'));
      const adminSnapshot = await getDocs(adminQuery);
      if (!adminSnapshot.empty) {
        return adminSnapshot.docs[0].id;
      }
    } catch (error) {
      console.error('Error finding admin:', error);
    }
    return null;
  };

  const handleAcceptTiming = async (bookingId: string) => {
    try {
      await updateDoc(doc(db, 'bookings', bookingId), { status: 'player_accepted' });
      Alert.alert(i18n.t('success') || 'Success', 'Timing accepted successfully');
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'player_accepted' } : b));
    } catch (err: any) {
      Alert.alert('Error', 'Failed to accept timing');
    }
  };

  const handleRejectTiming = async (bookingId: string) => {
    try {
      await updateDoc(doc(db, 'bookings', bookingId), { status: 'player_rejected' });
      Alert.alert(i18n.t('success') || 'Success', 'Timing rejected successfully');
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'player_rejected' } : b));
    } catch (err: any) {
      Alert.alert('Error', 'Failed to reject timing');
    }
  };

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();

    fetchBookings();
  }, []);

  const filteredBookings = filter === 'all'
    ? bookings
    : bookings.filter(b => b.status === filter);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed':
        return '#10b981';
      case 'player_accepted':
        return '#10b981';
      case 'pending':
        return '#f59e0b';
      case 'timing_proposed':
        return '#f59e0b';
      case 'cancelled':
        return '#ef4444';
      case 'player_rejected':
        return '#ef4444';
      default:
        return '#666';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'confirmed':
        return i18n.t('confirmed') || 'Confirmed';
      case 'player_accepted':
        return i18n.t('accepted') || 'Accepted';
      case 'pending':
        return i18n.t('pending') || 'Pending';
      case 'timing_proposed':
        return i18n.t('timingProposed') || 'Timing Proposed';
      case 'cancelled':
        return i18n.t('cancelled') || 'Cancelled';
      case 'player_rejected':
        return i18n.t('rejected') || 'Rejected';
      default:
        return status;
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient
        colors={['#000000', '#1a1a1a', '#2d2d2d']}
        style={styles.gradient}
      >
        <HamburgerMenu />
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.menuButton} onPress={openMenu}>
              <Ionicons name="menu" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.headerContent}>
              <Text style={styles.headerTitle}>{i18n.t('myBookings') || 'My Bookings'}</Text>
              <Text style={styles.headerSubtitle}>{i18n.t('manageReservations') || 'Manage player reservations'}</Text>
            </View>
          </View>

          <View style={styles.filterContainer}>
            <TouchableOpacity
              style={[styles.filterButton, filter === 'all' && styles.filterButtonActive]}
              onPress={() => setFilter('all')}
            >
              <Text style={[styles.filterButtonText, filter === 'all' && styles.filterButtonTextActive]}>
                {i18n.t('all') || 'All'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterButton, filter === 'confirmed' && styles.filterButtonActive]}
              onPress={() => setFilter('confirmed')}
            >
              <Ionicons name="checkmark-circle" size={18} color={filter === 'confirmed' ? '#fff' : '#666'} />
              <Text style={[styles.filterButtonText, filter === 'confirmed' && styles.filterButtonTextActive]}>
                {i18n.t('confirmed') || 'Confirmed'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterButton, filter === 'pending' && styles.filterButtonActive]}
              onPress={() => setFilter('pending')}
            >
              <Ionicons name="time" size={18} color={filter === 'pending' ? '#fff' : '#666'} />
              <Text style={[styles.filterButtonText, filter === 'pending' && styles.filterButtonTextActive]}>
                {i18n.t('pending') || 'Pending'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterButton, filter === 'cancelled' && styles.filterButtonActive]}
              onPress={() => setFilter('cancelled')}
            >
              <Ionicons name="close-circle" size={18} color={filter === 'cancelled' ? '#fff' : '#666'} />
              <Text style={[styles.filterButtonText, filter === 'cancelled' && styles.filterButtonTextActive]}>
                {i18n.t('cancelled') || 'Cancelled'}
              </Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#fff" />
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchBookings(); }} tintColor="#fff" />
              }
            >
              {filteredBookings.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Ionicons name="calendar-outline" size={64} color="rgba(255, 255, 255, 0.3)" />
                  <Text style={styles.emptyText}>{i18n.t('noBookings') || 'No bookings found'}</Text>
                  <Text style={styles.emptySubtext}>{i18n.t('bookingsWillAppear') || 'Player bookings and your clinic reservations will appear here'}</Text>
                </View>
              ) : (
                filteredBookings.map((booking) => (
                  <View key={booking.id} style={styles.bookingCard}>
                    <View style={styles.bookingHeader}>
                      <View style={styles.playerInfoContainer}>
                        <Ionicons name={booking.type === 'clinic' ? 'medical' : 'person-circle'} size={32} color="#fff" />
                        <View style={styles.playerDetails}>
                          <Text style={styles.playerName}>
                            {booking.type === 'academy'
                              ? (booking.playerName || '—')
                              : (booking.providerName || booking.service || 'Clinic')}
                          </Text>
                          <View style={styles.typeBadge}>
                            <Text style={styles.typeBadgeText}>
                              {booking.type === 'academy' ? (i18n.t('academy') || 'Academy') : (i18n.t('clinic') || 'Clinic')}
                            </Text>
                          </View>
                        </View>
                      </View>
                      <View style={[styles.statusBadge, { backgroundColor: getStatusColor(booking.status) }]}>
                        <Text style={styles.statusText}>{getStatusText(booking.status)}</Text>
                      </View>
                    </View>

                    <View style={styles.bookingDetails}>
                      {booking.type === 'academy' && booking.program && (
                        <View style={styles.detailRow}>
                          <Ionicons name="football" size={18} color="rgba(255,255,255,0.7)" />
                          <Text style={styles.detailText}>{booking.program}</Text>
                        </View>
                      )}
                      {booking.sessionType && (
                        <View style={styles.detailRow}>
                          <Ionicons name="people" size={18} color="rgba(255,255,255,0.7)" />
                          <Text style={styles.detailText}>
                            {booking.sessionType === 'group' ? 'Group Session' : booking.sessionType === 'private' ? 'Private Session' : 'Semi-Private Session'}
                          </Text>
                        </View>
                      )}
                      {booking.trainerName && (
                        <View style={styles.detailRow}>
                          <Ionicons name="person" size={18} color="rgba(255,255,255,0.7)" />
                          <Text style={styles.detailText}>Trainer: {booking.trainerName}</Text>
                        </View>
                      )}
                      {booking.type === 'clinic' && (booking.service || booking.doctor) && (
                        <View style={styles.detailRow}>
                          <Ionicons name="medical" size={18} color="rgba(255,255,255,0.7)" />
                          <Text style={styles.detailText}>{[booking.service, booking.doctor].filter(Boolean).join(' · ')}</Text>
                        </View>
                      )}
                      {booking.date && (
                        <View style={styles.detailRow}>
                          <Ionicons name="calendar" size={18} color="rgba(255,255,255,0.7)" />
                          <Text style={styles.detailText}>{booking.date}</Text>
                        </View>
                      )}
                      {booking.time && (
                        <View style={styles.detailRow}>
                          <Ionicons name="time" size={18} color="rgba(255,255,255,0.7)" />
                          <Text style={styles.detailText}>{booking.time}</Text>
                        </View>
                      )}
                    </View>

                    <View style={styles.bookingFooter}>
                      <Text style={styles.priceLabel}>{i18n.t('total') || 'Total'}</Text>
                      <Text style={styles.priceValue}>{booking.price != null ? `${booking.price} EGP` : '—'}</Text>
                    </View>
                    
                    {booking.status === 'timing_proposed' && booking.proposedByAdmin && booking.type === 'clinic' && (
                      <View style={{flexDirection: 'row', gap: 12, marginTop: 12}}>
                        <TouchableOpacity
                          style={[styles.chatButton, {flex: 1, backgroundColor: '#10b981', marginTop: 0}]}
                          onPress={() => handleAcceptTiming(booking.id)}
                        >
                          <Ionicons name="checkmark" size={18} color="#fff" />
                          <Text style={[styles.chatButtonText, {color: '#fff', marginLeft: 8}]}>{i18n.t('accept') || 'Accept'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.chatButton, {flex: 1, backgroundColor: '#ef4444', marginTop: 0}]}
                          onPress={() => handleRejectTiming(booking.id)}
                        >
                          <Ionicons name="close" size={18} color="#fff" />
                          <Text style={[styles.chatButtonText, {color: '#fff', marginLeft: 8}]}>{i18n.t('reject') || 'Reject'}</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    <TouchableOpacity
                      style={styles.chatButton}
                      onPress={async () => {
                        try {
                          const adminId = await findAdminUserId();
                          if (!adminId) {
                            Alert.alert('Error', 'No admin found');
                            return;
                          }
                          const conversationId = await startConversationWithUser(adminId);
                          router.push({
                            pathname: '/academy-chat',
                            params: {
                              conversationId,
                              otherUserId: adminId,
                              contact: 'Admin'
                            }
                          });
                        } catch (error: any) {
                          Alert.alert('Error', error.message || 'Failed to start conversation');
                        }
                      }}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="chatbubbles" size={18} color="#000" />
                      <Text style={styles.chatButtonText}>{i18n.t('chatToAdmin') || 'Chat to Admin'}</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </ScrollView>
          )}
        </Animated.View>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  gradient: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 24,
    paddingHorizontal: 24,
  },
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  headerContent: {
    flex: 1,
    alignItems: 'center',
    marginLeft: -44,
    paddingHorizontal: 44,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    marginBottom: 24,
    gap: 8,
    flexWrap: 'wrap',
  },
  filterButton: {
    flex: 1,
    minWidth: '22%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    gap: 6,
  },
  filterButtonActive: { backgroundColor: '#fff' },
  filterButtonText: { fontSize: 14, fontWeight: '600', color: '#666' },
  filterButtonTextActive: { color: '#000' },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 40 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40 },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingBottom: 40,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
  },
  bookingCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  bookingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  playerInfoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  playerDetails: { flex: 1 },
  playerName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  typeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  typeBadgeText: { fontSize: 12, color: 'rgba(255,255,255,0.9)' },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusText: { fontSize: 12, fontWeight: 'bold', color: '#fff' },
  bookingDetails: { gap: 12, marginBottom: 16 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  detailText: { fontSize: 16, color: 'rgba(255, 255, 255, 0.8)' },
  bookingFooter: {
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 6,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  priceLabel: { fontSize: 16, color: 'rgba(255, 255, 255, 0.7)' },
  priceValue: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  chatButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    gap: 8,
  },
  chatButtonText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '600',
  },
});
