import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useRef, useState, useEffect } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import i18n from '../locales/i18n';
import { getBookingStatusMeta, matchesBookingStatusFilter } from '../lib/bookingStatus';
import { db, auth } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { startConversationWithUser } from '../services/BookingMessagingService';
import { findAdminUserId } from '../services/MessagingService';

type BookingItem = {
  id: string;
  patientName?: string;
  customerName?: string;
  playerId?: string;
  parentId?: string;
  service?: string;
  doctor?: string;
  date?: string;
  time?: string;
  shift?: 'Day' | 'Night';
  status: string;
  price?: number;
  createdAt?: string;
  updatedAt?: string;
};

export default function ClinicBookingsScreen() {
  const { openMenu } = useHamburgerMenu();
  const [filter, setFilter] = useState<'all' | 'confirmed' | 'pending' | 'new_time_proposed' | 'cancelled'>('all');
  const router = useRouter();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const getBookingSortTime = (booking: BookingItem): number => {
    const source: any = booking?.updatedAt ?? booking?.createdAt;
    if (!source) return 0;
    if (typeof source?.toDate === 'function') {
      return source.toDate().getTime();
    }
    if (typeof source === 'number') return source;
    const parsed = new Date(source).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  const fetchBookings = async () => {
    const user = auth.currentUser;
    if (!user) {
      setBookings([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const q = query(
        collection(db, 'bookings'),
        where('providerId', '==', user.uid),
        where('type', '==', 'clinic')
      );
      const snapshot = await getDocs(q);
      const list: BookingItem[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        list.push({
          id: docSnap.id,
          patientName: d.playerName,
          customerName: d.customerName,
          playerId: d.playerId,
          parentId: d.parentId,
          service: d.service,
          doctor: d.doctor,
          date: d.date,
          time: d.time,
          status: d.status || 'pending',
          price: d.price,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        });
      });

      list.sort((a, b) => {
        return getBookingSortTime(b) - getBookingSortTime(a);
      });

      setBookings(list);
    } catch (error) {
      console.error('Error fetching clinic bookings:', error);
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

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();

    fetchBookings();
  }, []);

  const filteredBookings = bookings.filter(b => matchesBookingStatusFilter(b.status, filter));

  const getStatusMeta = (status: string) => getBookingStatusMeta(status, i18n);

  const displayName = (b: BookingItem) => b.patientName || b.customerName || '—';

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
            <View style={styles.headerContent} pointerEvents="box-none">
              <Text style={styles.headerTitle}>{i18n.t('myBookings') || 'My Bookings'}</Text>
              <Text style={styles.headerSubtitle}>{i18n.t('manageAppointments') || 'Manage patient appointments'}</Text>
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
              style={[styles.filterButton, filter === 'new_time_proposed' && styles.filterButtonActive]}
              onPress={() => setFilter('new_time_proposed')}
            >
              <Ionicons name="swap-horizontal" size={18} color={filter === 'new_time_proposed' ? '#fff' : '#666'} />
              <Text style={[styles.filterButtonText, filter === 'new_time_proposed' && styles.filterButtonTextActive]}>
                {i18n.t('newTimeProposed') || 'New Time'}
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
                  <Text style={styles.emptySubtext}>{i18n.t('appointmentsWillAppear') || 'Patient appointments will appear here'}</Text>
                </View>
              ) : (
                filteredBookings.map((booking) => (
                  <View key={booking.id} style={styles.bookingCard}>
                    <View style={styles.bookingHeader}>
                      <View style={styles.patientInfoContainer}>
                        <Ionicons name="person-circle" size={32} color="#fff" />
                        <View style={styles.patientDetails}>
                          <Text style={styles.patientName}>{displayName(booking)}</Text>
                        </View>
                      </View>
                      <View style={[styles.statusBadge, { backgroundColor: getStatusMeta(booking.status).color }]}>
                        <Text style={styles.statusText}>{getStatusMeta(booking.status).label}</Text>
                      </View>
                    </View>

                    {getStatusMeta(booking.status).note ? (
                      <Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 12, marginBottom: 12, lineHeight: 18 }}>
                        {getStatusMeta(booking.status).note}
                      </Text>
                    ) : null}

                    <View style={styles.bookingDetails}>
                      {(booking.service || booking.doctor) && (
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
                          <Text style={styles.detailText}>{booking.time} {booking.shift ? `(${booking.shift === 'Day' ? (i18n.t('dayShift') || 'Day') : (i18n.t('nightShift') || 'Night')})` : ''}</Text>
                        </View>
                      )}
                    </View>

                    <View style={styles.bookingFooter}>
                      <Text style={styles.priceLabel}>{i18n.t('fee') || 'Fee'}</Text>
                      <Text style={styles.priceValue}>{booking.price != null ? `${booking.price} EGP` : '—'}</Text>
                    </View>
                    
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
                            pathname: '/clinic-chat',
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
    zIndex: 10,
    elevation: 10,
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
  patientInfoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  patientDetails: { flex: 1 },
  patientName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
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
