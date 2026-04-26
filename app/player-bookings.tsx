import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, Alert, RefreshControl, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import FootballLoader from '../components/FootballLoader';
import FootballRefreshHeader from '../components/FootballRefreshHeader';
import BookingCountdown from '../components/BookingCountdown';

import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import { formatBookingBranch } from '../lib/bookingBranch';
import { getBookingPublicId } from '../lib/bookingId';
import i18n from '../locales/i18n';
import { getBookingStatusMeta } from '../lib/bookingStatus';
import { notifyBookingStatusChange } from '../lib/bookingNotifications';
import { db, auth } from '../lib/firebase';
import { collection, query, where, getDocs, doc, updateDoc, onSnapshot } from 'firebase/firestore';
import { startConversationWithUser } from '../services/BookingMessagingService';
import { findAdminUserId } from '../services/MessagingService';
import { upsertBookingTransaction } from '../services/MonetizationService';
import { getPendingBookings, subscribePendingBookings } from '../lib/pendingBookingStore';

export default function PlayerBookingsScreen() {
  const { openMenu } = useHamburgerMenu();
  const [filter, setFilter] = useState<'all' | 'clinic' | 'academy'>('all');
  const [statusFilter, setStatusFilter] = useState<'active' | 'cancelled'>('active');
  const router = useRouter();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<{ id: string; type: 'cancel' | 'accept' | 'reject' } | null>(null);
  const [openingAdminChat, setOpeningAdminChat] = useState(false);
  const [pendingVersion, setPendingVersion] = useState(0);
  const meterAnim = useRef(new Animated.Value(0)).current;
  const controlsAnim = useRef(new Animated.Value(1)).current;
  const lastScrollY = useRef(0);
  const controlsHidden = useRef(false);

  const normalizeBooking = (booking: any) => {
    const bookingType = booking?.type || booking?.bookingType || (booking?.service ? 'clinic' : 'academy');
    const providerName = booking?.name || booking?.providerName || booking?.academyName || booking?.clinicName || 'Provider';
    const programName = booking?.program || (booking?.sessionType === 'private' ? 'Private Training' : null);

    return {
      ...booking,
      type: bookingType,
      bookingType,
      name: providerName,
      providerName,
      program: programName,
    };
  };

  const getBookingSortTime = (booking: any): number => {
    const source = booking?.updatedAt ?? booking?.createdAt;
    if (!source) return 0;
    if (typeof source?.toDate === 'function') {
      return source.toDate().getTime();
    }
    if (typeof source === 'number') return source;
    const parsed = new Date(source).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  const fetchBookings = useCallback(async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
        return;
      }

      const bookingQueries = [
        query(collection(db, 'bookings'), where('playerId', '==', user.uid)),
        query(collection(db, 'bookings'), where('userId', '==', user.uid)),
      ];

      const snapshots = await Promise.all(bookingQueries.map((bookingQuery) => getDocs(bookingQuery)));
      const bookingMap = new Map<string, any>();

      snapshots.forEach((snapshot) => {
        snapshot.forEach((docSnapshot) => {
          bookingMap.set(docSnapshot.id, normalizeBooking({ id: docSnapshot.id, ...docSnapshot.data() }));
        });
      });

      const bookingsList = Array.from(bookingMap.values());

      bookingsList.sort((a, b) => getBookingSortTime(b) - getBookingSortTime(a));

      setBookings(bookingsList);
    } catch (error: any) {
      console.error('Error fetching bookings:', error);
      Alert.alert(i18n.t('error'), 'Failed to load bookings');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribePendingBookings(() => {
      setPendingVersion((prev) => prev + 1);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const meterLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(meterAnim, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(meterAnim, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
      ])
    );

    meterLoop.start();
    return () => meterLoop.stop();
  }, [meterAnim]);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim, fetchBookings]);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setBookings([]);
      setLoading(false);
      setRefreshing(false);
      return () => {};
    }

    const bookingsQueries = [
      query(collection(db, 'bookings'), where('playerId', '==', user.uid)),
      query(collection(db, 'bookings'), where('userId', '==', user.uid)),
    ];

    const unsubscribes = bookingsQueries.map((bookingsQuery) =>
      onSnapshot(
        bookingsQuery,
        () => {
          void fetchBookings();
        },
        (error) => {
          console.error('Error subscribing to player bookings:', error);
          setLoading(false);
          setRefreshing(false);
        }
      )
    );

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [fetchBookings]);

  const bookingsWithPending = useMemo(() => {
    const pendingBookings = getPendingBookings('player');
    const combined = [...pendingBookings, ...bookings];
    return combined.sort((a, b) => getBookingSortTime(b) - getBookingSortTime(a));
  }, [bookings, pendingVersion]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchBookings();
  }, [fetchBookings]);

  const setControlsVisible = useCallback((visible: boolean) => {
    if (controlsHidden.current === !visible) return;
    controlsHidden.current = !visible;
    Animated.timing(controlsAnim, {
      toValue: visible ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [controlsAnim]);

  const handleListScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const currentY = Math.max(0, event.nativeEvent.contentOffset.y);
    const delta = currentY - lastScrollY.current;

    if (currentY <= 8) {
      setControlsVisible(true);
    } else if (delta > 12) {
      setControlsVisible(false);
    } else if (delta < -8) {
      setControlsVisible(true);
    }

    lastScrollY.current = currentY;
  }, [setControlsVisible]);

  const runBookingAction = async (
    bookingId: string,
    nextStatus: 'cancelled' | 'confirmed',
    successMessage: string,
    actionType: 'cancel' | 'accept' | 'reject'
  ): Promise<boolean> => {
    try {
      setActionLoading({ id: bookingId, type: actionType });
      const updatedAt = new Date().toISOString();
      await updateDoc(doc(db, 'bookings', bookingId), { status: nextStatus, updatedAt });
      const currentBooking = bookings.find(b => b.id === bookingId);
      const updatedBooking = currentBooking ? { ...currentBooking, status: nextStatus, updatedAt } : null;
      setBookings(prev => prev
        .map(b => b.id === bookingId ? { ...b, status: nextStatus, updatedAt } : b)
        .sort((a, b) => getBookingSortTime(b) - getBookingSortTime(a))
      );
      if (updatedBooking) {
        await upsertBookingTransaction(bookingId, updatedBooking, auth.currentUser?.uid, `Player updated booking to ${nextStatus}`);
      }
      if (currentBooking) {
        await notifyBookingStatusChange({
          booking: { ...currentBooking, status: nextStatus },
          nextStatus,
          actorId: auth.currentUser?.uid,
          actorLabel: i18n.t('player') || 'Player',
        });
      }
      Alert.alert(i18n.t('success') || 'Success', successMessage);
      return true;
    } catch (error) {
      console.error('Error updating booking:', error);
      Alert.alert(i18n.t('error') || 'Error', i18n.t('failedToUpdateBooking') || 'Failed to update booking');
      return false;
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancelBooking = (bookingId: string) => {
    if (actionLoading?.id === bookingId) return;

    Alert.alert(
      i18n.t('cancelBooking') || 'Cancel Booking',
      i18n.t('cancelConfirmation') || 'Are you sure you want to cancel this booking?',
      [
        { text: i18n.t('no') || 'No', style: 'cancel' },
        {
          text: i18n.t('yes') || 'Yes',
          style: 'destructive',
          onPress: async () => {
            await runBookingAction(
              bookingId,
              'cancelled',
              i18n.t('bookingCancelled') || 'Booking cancelled successfully',
              'cancel'
            );
          }
        }
      ]
    );
  };

  const handleAcceptTiming = async (bookingId: string) => {
    const success = await runBookingAction(bookingId, 'confirmed', i18n.t('timingAcceptedSuccess') || 'Timing accepted successfully', 'accept');
    if (!success) return;

    const currentBooking = bookings.find(b => b.id === bookingId);
    if (!currentBooking) return;

    router.push({
      pathname: '/booking-qr',
      params: {
        bookingId,
        providerName: currentBooking.name || currentBooking.providerName || 'Provider',
        date: currentBooking.date || '',
        time: currentBooking.time || '',
      },
    });
  };

  const handleRejectTiming = async (bookingId: string) => {
    await runBookingAction(bookingId, 'cancelled', i18n.t('timingRejectedSuccess') || 'Timing rejected successfully', 'reject');
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
        pathname: '/player-chat',
        params: {
          conversationId,
          otherUserId: adminId,
          name: i18n.t('adminLabel') || 'Admin'
        }
      });
    } catch (error: any) {
      Alert.alert(i18n.t('error') || 'Error', error.message || (i18n.t('failedToStartConversation') || 'Failed to start conversation'));
    } finally {
      setOpeningAdminChat(false);
    }
  };

  const handleCopyBookingId = async (booking: any) => {
    const publicId = getBookingPublicId(booking);
    try {
      await Clipboard.setStringAsync(publicId);
      Alert.alert(i18n.t('copied') || 'Copied', i18n.t('bookingIdCopied') || 'Booking ID copied to clipboard');
    } catch {
      Alert.alert(i18n.t('error') || 'Error', i18n.t('failedToCopy') || 'Failed to copy');
    }
  };

  const matchingBookings = filter === 'all'
    ? bookingsWithPending
    : bookingsWithPending.filter(b => (b.type || b.bookingType) === filter);
  const cancelledFilteredBookings = matchingBookings.filter(
    booking => String(booking.status || '').toLowerCase() === 'cancelled'
  );
  const filteredBookings = matchingBookings.filter(
    booking => String(booking.status || '').toLowerCase() !== 'cancelled'
  );
  const visibleBookings = statusFilter === 'cancelled' ? cancelledFilteredBookings : filteredBookings;

  const getStatusMeta = (status: string) => getBookingStatusMeta(status, i18n);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient
        colors={['#000000', '#1a1a1a', '#2d2d2d']}
        style={styles.gradient}
      >
        <HamburgerMenu />
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.menuButton} onPress={openMenu}>
              <Ionicons name="menu" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.headerContent} pointerEvents="box-none">
              <Text style={styles.headerTitle}>{i18n.t('myBookings') || 'My Bookings'}</Text>
              <Text style={styles.headerSubtitle}>{i18n.t('yourReservations') || 'Your reservations'}</Text>
            </View>
          </View>

          <Animated.View
            style={[
              styles.controlsWrap,
              {
                opacity: controlsAnim,
                maxHeight: controlsAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 140],
                }),
                transform: [{
                  translateY: controlsAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-18, 0],
                  }),
                }],
              },
            ]}
          >
          {/* Filter Buttons */}
          <View style={styles.filterContainer}>
            <TouchableOpacity
              style={[styles.filterButton, filter === 'all' && styles.filterButtonActive]}
              onPress={() => setFilter('all')}
            >
              <Text
                style={[styles.filterButtonText, filter === 'all' && styles.filterButtonTextActive]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {i18n.t('all') || 'All'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterButton, filter === 'clinic' && styles.filterButtonActive]}
              onPress={() => setFilter('clinic')}
            >
              <Ionicons name="medical" size={18} color={filter === 'clinic' ? '#fff' : '#666'} />
              <Text
                style={[styles.filterButtonText, filter === 'clinic' && styles.filterButtonTextActive]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {i18n.t('clinics') || 'Clinics'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterButton, filter === 'academy' && styles.filterButtonActive]}
              onPress={() => setFilter('academy')}
            >
              <Ionicons name="school" size={18} color={filter === 'academy' ? '#fff' : '#666'} />
              <Text
                style={[styles.filterButtonText, filter === 'academy' && styles.filterButtonTextActive]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
              >
                {i18n.t('academies') || 'Academies'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.sectionTabs}>
            <TouchableOpacity
              style={[styles.sectionTab, statusFilter === 'active' && styles.sectionTabActive]}
              onPress={() => setStatusFilter('active')}
              activeOpacity={0.85}
            >
              <Text style={[styles.sectionTabText, statusFilter === 'active' && styles.sectionTabTextActive]}>
                {i18n.t('activeBookings') || 'Active Bookings'} ({filteredBookings.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sectionTab, statusFilter === 'cancelled' && styles.sectionTabActive]}
              onPress={() => setStatusFilter('cancelled')}
              activeOpacity={0.85}
            >
              <Text style={[styles.sectionTabText, statusFilter === 'cancelled' && styles.sectionTabTextActive]}>
                {i18n.t('cancelledBookings') || 'Cancelled Bookings'} ({cancelledFilteredBookings.length})
              </Text>
            </TouchableOpacity>
          </View>
          </Animated.View>

          {/* Bookings List */}
          <ScrollView 
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            onScroll={handleListScroll}
            scrollEventThrottle={16}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="transparent" colors={['transparent']} />
            }
          >
            <FootballRefreshHeader refreshing={refreshing} />
            {loading ? (
              <View style={styles.emptyContainer}>
                <FootballLoader size="large" color="#fff" />
                <Text style={styles.emptyText}>{i18n.t('loading') || 'Loading...'}</Text>
              </View>
            ) : visibleBookings.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="calendar-outline" size={64} color="rgba(255, 255, 255, 0.3)" />
                <Text style={styles.emptyText}>
                  {statusFilter === 'cancelled'
                    ? (i18n.t('noCancelledBookings') || 'No cancelled bookings yet')
                    : (i18n.t('noBookings') || 'No bookings found')}
                </Text>
                <Text style={styles.emptySubtext}>
                  {statusFilter === 'cancelled'
                    ? (i18n.t('cancelledBookingsWillAppear') || 'Cancelled bookings will appear here')
                    : (i18n.t('bookingsWillAppear') || 'Your bookings will appear here')}
                </Text>
              </View>
            ) : (
              <>
                {visibleBookings.map((booking) => (
                  <View key={booking.id} style={styles.bookingCard}>
                  {booking.__pendingBooking ? (
                    <View style={styles.pendingPill}>
                      <Ionicons name="time-outline" size={14} color="#dbeafe" />
                      <Text style={styles.pendingPillText}>{i18n.t('bookingProcessing') || 'Processing'}</Text>
                    </View>
                  ) : null}

                  <View style={styles.bookingHeader}>
                    <View style={styles.bookingTypeContainer}>
                      <Ionicons 
                        name={booking.type === 'clinic' ? 'medical' : 'school'} 
                        size={24} 
                        color="#fff" 
                      />
                      <Text style={styles.bookingType}>
                        {booking.type === 'clinic' ? (i18n.t('clinic') || 'Clinic') : (i18n.t('academy') || 'Academy')}
                      </Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusMeta(booking.status).color }]}>
                      <Text style={styles.statusText}>{getStatusMeta(booking.status).label}</Text>
                    </View>
                  </View>

                  <Text style={styles.bookingName}>{booking.name}</Text>
                  {!booking.__pendingBooking ? (
                    <TouchableOpacity style={styles.bookingIdBadge} onPress={() => void handleCopyBookingId(booking)} activeOpacity={0.8}>
                      <Text style={styles.bookingIdText}>{i18n.t('bookingId') || 'Booking ID'}: {getBookingPublicId(booking)}</Text>
                    </TouchableOpacity>
                  ) : null}

                  {booking.__pendingBooking ? (
                    <View style={styles.progressWrap}>
                      {(() => {
                        const animatedFillWidth = meterAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['24%', '82%'],
                        });
                        const animatedPointerLeft = meterAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['22%', '80%'],
                        });
                        const animatedShimmerLeft = meterAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['-20%', '92%'],
                        });
                        const animatedFootballRotate = meterAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['-18deg', '18deg'],
                        });
                        const animatedFootballLift = meterAnim.interpolate({
                          inputRange: [0, 0.5, 1],
                          outputRange: [0, -2, 0],
                        });

                        return (
                          <View style={styles.progressTrack}>
                            <View style={styles.progressTrackMarkers} pointerEvents="none">
                              <View style={styles.progressTrackMarker} />
                              <View style={styles.progressTrackMarker} />
                              <View style={styles.progressTrackMarker} />
                              <View style={styles.progressTrackMarker} />
                              <View style={styles.progressTrackMarker} />
                            </View>

                            {booking.status === 'failed' ? (
                              <View
                                style={[
                                  styles.progressFill,
                                  { width: '100%', backgroundColor: '#111111' },
                                ]}
                              />
                            ) : (
                              <Animated.View
                                style={[
                                  styles.progressFill,
                                  { width: animatedFillWidth },
                                ]}
                              >
                                <LinearGradient
                                  colors={['#000000', '#262626', '#000000']}
                                  start={{ x: 0, y: 0.5 }}
                                  end={{ x: 1, y: 0.5 }}
                                  style={styles.progressFillGradient}
                                />
                                <Animated.View style={[styles.progressShimmer, { left: animatedShimmerLeft }]}>
                                  <LinearGradient
                                    colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.5)', 'rgba(255,255,255,0)']}
                                    start={{ x: 0, y: 0.5 }}
                                    end={{ x: 1, y: 0.5 }}
                                    style={styles.progressShimmerGradient}
                                  />
                                </Animated.View>
                              </Animated.View>
                            )}

                            {booking.status === 'failed' ? (
                              <View style={[styles.progressFootball, { left: '94%' }]}>
                                <Ionicons name="football" size={18} color="#f5f5f5" />
                              </View>
                            ) : (
                              <Animated.View
                                style={[
                                  styles.progressFootball,
                                  {
                                    left: animatedPointerLeft,
                                    transform: [{ translateY: animatedFootballLift }, { rotate: animatedFootballRotate }],
                                  },
                                ]}
                              >
                                <Ionicons name="football" size={18} color="#f5f5f5" />
                              </Animated.View>
                            )}
                          </View>
                        );
                      })()}
                      <Text style={styles.progressText}>
                        {booking.pendingMessage || getStatusMeta(booking.status).note || (i18n.t('bookingProcessingNote') || 'Your booking request is being sent right now.')}
                      </Text>
                    </View>
                  ) : null}

                  {formatBookingBranch(booking) ? (
                    <View style={styles.bookingDetail}>
                      <Ionicons name="location-outline" size={16} color="rgba(255,255,255,0.7)" />
                      <Text style={styles.bookingDetailText}>{i18n.t('branch') || 'Branch'}: {formatBookingBranch(booking)}</Text>
                    </View>
                  ) : null}
                  {getStatusMeta(booking.status).note ? (
                    <Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 12, marginBottom: 10, lineHeight: 18 }}>
                      {getStatusMeta(booking.status).note}
                    </Text>
                  ) : null}
                  
                  {booking.type === 'clinic' ? (
                    <>
                      {booking.doctor && (
                        <View style={styles.bookingDetail}>
                          <Ionicons name="person" size={16} color="rgba(255,255,255,0.7)" />
                          <Text style={styles.bookingDetailText}>{booking.doctor}</Text>
                        </View>
                      )}
                      <View style={styles.bookingDetail}>
                        <Ionicons name="calendar-outline" size={16} color="rgba(255,255,255,0.7)" />
                        <Text style={styles.bookingDetailText}>{i18n.t('date') || 'Date'}: {booking.date || '—'}</Text>
                      </View>
                      <View style={styles.bookingDetail}>
                        <Ionicons name="time" size={16} color="rgba(255,255,255,0.7)" />
                        <Text style={styles.bookingDetailText}>{i18n.t('time') || 'Time'}: {booking.time || '—'} {booking.shift ? `(${booking.shift === 'Day' ? (i18n.t('dayShift') || 'Day') : (i18n.t('nightShift') || 'Night')})` : ''}</Text>
                      </View>
                      <View style={styles.bookingDetail}>
                        <Ionicons name="medical-outline" size={16} color="rgba(255,255,255,0.7)" />
                        <Text style={styles.bookingDetailText}>{i18n.t('service') || 'Service'}: {booking.service || '—'}</Text>
                      </View>
                      <View style={styles.bookingDetail}>
                        <Ionicons name="cash-outline" size={16} color="rgba(255,255,255,0.7)" />
                        <Text style={styles.bookingDetailText}>{i18n.t('fee') || 'Fee'}: {booking.price != null ? `${booking.price} EGP` : '—'}</Text>
                      </View>
                    </>
                  ) : (
                    <>
                      {booking.program && (
                        <View style={styles.bookingDetail}>
                          <Ionicons name="football" size={16} color="rgba(255,255,255,0.7)" />
                          <Text style={styles.bookingDetailText}>{booking.program}</Text>
                        </View>
                      )}
                      {booking.ageGroup && (
                        <View style={styles.bookingDetail}>
                          <Ionicons name="people" size={16} color="rgba(255,255,255,0.7)" />
                          <Text style={styles.bookingDetailText}>{i18n.t('ageGroup') || 'Age Group'}: {booking.ageGroup} {i18n.t('years') || 'years'}</Text>
                        </View>
                      )}
                    </>
                  )}

                  <View style={styles.bookingFooter}>
                    <View style={styles.bookingDateTime}>
                      <Ionicons name="calendar" size={16} color="rgba(255,255,255,0.7)" />
                      <Text style={styles.bookingDateTimeText}>{booking.date || (booking.createdAt ? new Date(booking.createdAt).toLocaleDateString() : 'N/A')}</Text>
                    </View>

                    {booking.time && (
                      <View style={styles.bookingDateTime}>
                        <Ionicons name="time" size={16} color="rgba(255,255,255,0.7)" />
                        <Text style={styles.bookingDateTimeText}>{booking.time} {booking.shift ? `(${booking.shift === 'Day' ? (i18n.t('dayShift') || 'Day') : (i18n.t('nightShift') || 'Night')})` : ''}</Text>
                      </View>
                    )}
                    <Text style={styles.bookingPrice}>{booking.price || 0} EGP</Text>
                  </View>

                  {String(booking.status || '').toLowerCase() === 'confirmed' && (
                    <BookingCountdown date={booking.date} time={booking.time} />
                  )}

                  {!booking.__pendingBooking && String(booking.status || '').toLowerCase() === 'confirmed' && (
                    <TouchableOpacity
                      style={[styles.chatButton, { backgroundColor: '#2563eb', marginTop: 10 }]}
                      onPress={() =>
                        router.push({
                          pathname: '/booking-qr',
                          params: {
                            bookingId: booking.id,
                            providerName: booking.name || booking.providerName || 'Provider',
                            date: booking.date || '',
                            time: booking.time || '',
                          },
                        })
                      }
                    >
                      <Ionicons name="qr-code" size={18} color="#fff" />
                      <Text style={[styles.chatButtonText, { color: '#fff' }]}>Show Booking QR</Text>
                    </TouchableOpacity>
                  )}

                  {!booking.__pendingBooking && !['cancelled', 'completed', 'no_show', 'refunded', 'failed_payment'].includes(String(booking.status || '').toLowerCase()) && (
                    <TouchableOpacity
                      style={[styles.chatButton, { backgroundColor: '#ef4444', marginTop: 12, opacity: actionLoading?.id === booking.id ? 0.6 : 1 }]}
                      onPress={() => handleCancelBooking(booking.id)}
                      disabled={actionLoading?.id === booking.id}
                    >
                      {actionLoading?.id === booking.id && actionLoading?.type === 'cancel' ? (
                        <FootballLoader size="small" color="#fff" />
                      ) : (
                        <>
                          <Ionicons name="close-circle" size={18} color="#fff" />
                          <Text style={[styles.chatButtonText, {color: '#fff', marginLeft: 8}]}>{i18n.t('cancel') || 'Cancel'}</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}

                  {!booking.__pendingBooking && (booking.status === 'new_time_proposed' || booking.status === 'timing_proposed') && booking.proposedByAdmin && (
                    <View style={{flexDirection: 'row', gap: 12, marginTop: 12}}>
                      <TouchableOpacity
                        style={[styles.chatButton, {flex: 1, backgroundColor: '#10b981', marginTop: 0, opacity: actionLoading?.id === booking.id ? 0.6 : 1 }]}
                        onPress={() => handleAcceptTiming(booking.id)}
                        disabled={actionLoading?.id === booking.id}
                      >
                        {actionLoading?.id === booking.id && actionLoading?.type === 'accept' ? (
                          <FootballLoader size="small" color="#fff" />
                        ) : (
                          <>
                            <Ionicons name="checkmark" size={18} color="#fff" />
                            <Text style={[styles.chatButtonText, {color: '#fff'}]}>{i18n.t('accept') || 'Accept'}</Text>
                          </>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.chatButton, {flex: 1, backgroundColor: '#ef4444', marginTop: 0, opacity: actionLoading?.id === booking.id ? 0.6 : 1 }]}
                        onPress={() => handleRejectTiming(booking.id)}
                        disabled={actionLoading?.id === booking.id}
                      >
                        {actionLoading?.id === booking.id && actionLoading?.type === 'reject' ? (
                          <FootballLoader size="small" color="#fff" />
                        ) : (
                          <>
                            <Ionicons name="close" size={18} color="#fff" />
                            <Text style={[styles.chatButtonText, {color: '#fff'}]}>{i18n.t('reject') || 'Reject'}</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  )}

                  {!booking.__pendingBooking && <TouchableOpacity
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
                  </TouchableOpacity>}
                  
                  </View>
                ))}

              </>
            )}
          </ScrollView>
        </Animated.View>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 60,
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
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    marginBottom: 24,
    gap: 12,
  },
  filterButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    gap: 8,
    minWidth: 0,
  },
  filterButtonActive: {
    backgroundColor: '#fff',
  },
  filterButtonText: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#666',
    textAlign: 'center',
  },
  filterButtonTextActive: {
    color: '#000',
  },
  controlsWrap: {
    overflow: 'hidden',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  sectionTabs: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    marginBottom: 16,
    gap: 10,
  },
  sectionTab: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  sectionTabActive: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderColor: 'rgba(255,255,255,0.2)',
  },
  sectionTabText: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  sectionTabTextActive: {
    color: '#fff',
  },
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
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 18,
    padding: 22,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    overflow: 'hidden',
  },
  bookingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  bookingTypeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bookingType: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
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
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
    color: '#fff',
  },
  bookingName: {
    fontSize: 21,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
  },
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
  pendingPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(59, 130, 246, 0.22)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 10,
  },
  pendingPillText: {
    color: '#dbeafe',
    fontSize: 12,
    fontWeight: '700',
  },
  progressWrap: {
    marginBottom: 12,
  },
  progressTrack: {
    position: 'relative',
    height: 10,
    borderRadius: 999,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#111111',
    overflow: 'visible',
  },
  progressTrackMarkers: {
    position: 'absolute',
    top: 1,
    left: 8,
    right: 8,
    bottom: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 1,
  },
  progressTrackMarker: {
    width: 2,
    height: 5,
    borderRadius: 2,
    backgroundColor: '#d1d5db',
  },
  progressFill: {
    position: 'relative',
    height: '100%',
    borderRadius: 999,
    overflow: 'hidden',
    zIndex: 2,
  },
  progressFillGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  progressShimmer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '22%',
  },
  progressShimmerGradient: {
    flex: 1,
  },
  progressFootball: {
    position: 'absolute',
    top: -6,
    marginLeft: -9,
    shadowColor: '#111111',
    shadowOpacity: 0.26,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
    zIndex: 4,
  },
  progressText: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    color: 'rgba(255, 255, 255, 0.86)',
  },
  bookingDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  bookingDetailText: {
    fontSize: 16,
    lineHeight: 22,
    color: 'rgba(255, 255, 255, 0.88)',
  },
  bookingFooter: {
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  bookingDateTime: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  bookingDateTimeText: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.82)',
  },
  bookingPrice: {
    fontSize: 20,
    fontWeight: 'bold',
    letterSpacing: 0.2,
    color: '#fff',
  },
  chatButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    minHeight: 46,
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
