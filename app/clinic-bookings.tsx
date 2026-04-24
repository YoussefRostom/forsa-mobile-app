import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, Alert, RefreshControl } from 'react-native';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import { formatBookingBranch } from '../lib/bookingBranch';
import { getBookingPublicId } from '../lib/bookingId';
import i18n from '../locales/i18n';
import { getBookingStatusMeta, matchesBookingStatusFilter } from '../lib/bookingStatus';
import { db, auth } from '../lib/firebase';
import { collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import { startConversationWithUser } from '../services/BookingMessagingService';
import { findAdminUserId } from '../services/MessagingService';
import { getMonetizationSettings } from '../services/MonetizationService';
import FootballLoader from '../components/FootballLoader';

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
  branchName?: string;
  branchAddress?: string;
};

export default function ClinicBookingsScreen() {
  const { openMenu } = useHamburgerMenu();
  const [filter, setFilter] = useState<'all' | 'confirmed' | 'pending' | 'new_time_proposed' | 'cancelled'>('all');
  const router = useRouter();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openingAdminChat, setOpeningAdminChat] = useState(false);
  const [commissionSummary, setCommissionSummary] = useState({ booking: 15, walkIn: 15 });

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

  const fetchBookings = useCallback(async () => {
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
          branchName: d.branchName,
          branchAddress: d.branchAddress,
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
  }, []);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim, fetchBookings]);

  useEffect(() => {
    void (async () => {
      try {
        const settings = await getMonetizationSettings();
        setCommissionSummary({
          booking: Number(settings.bookingCommission?.value || 15),
          walkIn: Number(settings.walkInCommission?.value || 15),
        });
      } catch (error) {
        console.warn('Failed to load clinic commission summary:', error);
      }
    })();
  }, []);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setBookings([]);
      setLoading(false);
      setRefreshing(false);
      return () => {};
    }

    const bookingsQuery = query(
      collection(db, 'bookings'),
      where('providerId', '==', user.uid),
      where('type', '==', 'clinic')
    );

    const unsubscribe = onSnapshot(
      bookingsQuery,
      () => {
        void fetchBookings();
      },
      (error) => {
        console.error('Error subscribing to clinic bookings:', error);
        setLoading(false);
        setRefreshing(false);
      }
    );

    return unsubscribe;
  }, [fetchBookings]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchBookings();
  }, [fetchBookings]);

  const filteredBookings = bookings.filter(b => matchesBookingStatusFilter(b.status, filter));

  const getStatusMeta = (status: string) => getBookingStatusMeta(status, i18n);

  const displayName = (b: BookingItem) => b.patientName || b.customerName || '—';

  const handleCopyBookingId = async (booking: BookingItem) => {
    const publicId = getBookingPublicId(booking);
    try {
      await Clipboard.setStringAsync(publicId);
      Alert.alert(i18n.t('copied') || 'Copied', i18n.t('bookingIdCopied') || 'Booking ID copied to clipboard');
    } catch {
      Alert.alert(i18n.t('error') || 'Error', i18n.t('failedToCopy') || 'Failed to copy');
    }
  };

  const openAdminChat = async () => {
    if (openingAdminChat) return;

    try {
      setOpeningAdminChat(true);
      const adminId = await findAdminUserId();
      if (!adminId) {
        Alert.alert(i18n.t('error') || 'Error', i18n.t('noAdminFound') || 'No admin found');
        return;
      }
      const conversationId = await startConversationWithUser(adminId);
      router.push({
        pathname: '/clinic-chat',
        params: {
          conversationId,
          otherUserId: adminId,
          contact: i18n.t('adminLabel') || 'Admin'
        }
      });
    } catch (error: any) {
      Alert.alert(i18n.t('error') || 'Error', error.message || (i18n.t('failedToStartConversation') || 'Failed to start conversation'));
    } finally {
      setOpeningAdminChat(false);
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
              <FootballLoader size="large" color="#fff" />
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
              }
            >
              <View style={styles.commissionBanner}>
                <Text style={styles.commissionBannerTitle}>{i18n.t('commissionSettings') || 'Commission Settings'}</Text>
                <Text style={styles.commissionBannerText}>
                  {(i18n.t('bookingCommission') || 'Booking Commission')}: {commissionSummary.booking}%  |  {(i18n.t('walkInCommission') || 'Walk-in Commission')}: {commissionSummary.walkIn}%
                </Text>
              </View>

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

                    <TouchableOpacity style={styles.bookingIdBadge} onPress={() => void handleCopyBookingId(booking)} activeOpacity={0.8}>
                      <Text style={styles.bookingIdText}>{i18n.t('bookingId') || 'Booking ID'}: {getBookingPublicId(booking)}</Text>
                    </TouchableOpacity>

                    <View style={styles.bookingDetails}>
                      {formatBookingBranch(booking) ? (
                        <View style={styles.detailRow}>
                          <Ionicons name="location-outline" size={18} color="rgba(255,255,255,0.7)" />
                          <Text style={styles.detailText}>{i18n.t('branch') || 'Branch'}: {formatBookingBranch(booking)}</Text>
                        </View>
                      ) : null}
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
                      style={[styles.chatButton, { opacity: openingAdminChat ? 0.6 : 1 }]}
                      onPress={openAdminChat}
                      disabled={openingAdminChat}
                      activeOpacity={0.8}
                    >
                      {openingAdminChat ? (
                        <FootballLoader size="small" color="#000" />
                      ) : (
                        <Ionicons name="chatbubbles" size={18} color="#000" />
                      )}
                      <Text style={styles.chatButtonText}>{openingAdminChat ? (i18n.t('loading') || 'Loading...') : (i18n.t('chatToAdmin') || 'Chat to Admin')}</Text>
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
    paddingTop: Platform.OS === 'ios' ? 52 : 34,
    paddingBottom: 16,
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
    fontSize: 26,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 2,
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    marginBottom: 16,
    gap: 6,
    flexWrap: 'wrap',
  },
  filterButton: {
    flex: 1,
    minWidth: '22%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    gap: 5,
  },
  filterButtonActive: { backgroundColor: '#fff' },
  filterButtonText: { fontSize: 13, fontWeight: '600', color: '#666' },
  filterButtonTextActive: { color: '#000' },
  commissionBanner: {
    marginHorizontal: 24,
    marginBottom: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(37, 99, 235, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.35)',
  },
  commissionBannerTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  commissionBannerText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    lineHeight: 18,
  },
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
    borderRadius: 18,
    padding: 22,
    marginBottom: 18,
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
    fontSize: 21,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    minHeight: 30,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  statusText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2, color: '#fff' },
  bookingIdBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 12,
  },
  bookingIdText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: '#fff',
  },
  bookingDetails: { gap: 12, marginBottom: 16 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  detailText: { fontSize: 16, lineHeight: 22, color: 'rgba(255, 255, 255, 0.88)' },
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
  priceValue: { fontSize: 21, fontWeight: 'bold', letterSpacing: 0.2, color: '#fff' },
  chatButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    minHeight: 44,
    paddingVertical: 12,
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
