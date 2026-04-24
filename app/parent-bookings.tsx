import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TouchableOpacity, View, Alert, RefreshControl } from 'react-native';
import HamburgerMenu from '../components/HamburgerMenu';
import FootballLoader from '../components/FootballLoader';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import { formatBookingBranch } from '../lib/bookingBranch';
import { getBookingPublicId } from '../lib/bookingId';
import i18n from '../locales/i18n';
import { getBookingStatusMeta } from '../lib/bookingStatus';
import { notifyBookingStatusChange } from '../lib/bookingNotifications';
import { db, auth } from '../lib/firebase';
import { collection, query, where, getDocs, updateDoc, doc, onSnapshot } from 'firebase/firestore';
import { startConversationWithUser } from '../services/BookingMessagingService';
import { findAdminUserId } from '../services/MessagingService';
import { upsertBookingTransaction } from '../services/MonetizationService';
import { getPendingBookings, subscribePendingBookings } from '../lib/pendingBookingStore';

export default function ParentBookingsScreen() {
  const { openMenu } = useHamburgerMenu();
  const [filter, setFilter] = useState<'all' | 'clinic' | 'academy'>('all');
  const router = useRouter();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<{ id: string; type: 'cancel' | 'accept' | 'reject' } | null>(null);
  const [openingAdminChat, setOpeningAdminChat] = useState(false);
  const [pendingVersion, setPendingVersion] = useState(0);
  const meterAnim = useRef(new Animated.Value(0)).current;

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
        query(collection(db, 'bookings'), where('parentId', '==', user.uid)),
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
      query(collection(db, 'bookings'), where('parentId', '==', user.uid)),
      query(collection(db, 'bookings'), where('userId', '==', user.uid)),
    ];

    const unsubscribes = bookingsQueries.map((bookingsQuery) =>
      onSnapshot(
        bookingsQuery,
        () => {
          void fetchBookings();
        },
        (error) => {
          console.error('Error subscribing to parent bookings:', error);
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
    const pendingBookings = getPendingBookings('parent');
    const combined = [...pendingBookings, ...bookings];
    return combined.sort((a, b) => getBookingSortTime(b) - getBookingSortTime(a));
  }, [bookings, pendingVersion]);

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
        await upsertBookingTransaction(bookingId, updatedBooking, auth.currentUser?.uid, `Parent updated booking to ${nextStatus}`);
      }
      if (currentBooking) {
        await notifyBookingStatusChange({
          booking: { ...currentBooking, status: nextStatus },
          nextStatus,
          actorId: auth.currentUser?.uid,
          actorLabel: i18n.t('parent') || 'Parent',
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

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchBookings();
  }, [fetchBookings]);

  const handleAcceptTiming = async (bookingId: string) => {
    const success = await runBookingAction(bookingId, 'confirmed', i18n.t('timingAcceptedSuccess') || 'Timing accepted successfully', 'accept');
    if (!success) return;

    const currentBooking = bookings.find(b => b.id === bookingId);
    if (!currentBooking) return;

    router.push({
      pathname: '/parent-booking-qr',
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
        pathname: '/parent-chat',
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

  const handleCopyBookingId = async (booking: any) => {
    const publicId = getBookingPublicId(booking);
    try {
      await Clipboard.setStringAsync(publicId);
      Alert.alert(i18n.t('copied') || 'Copied', i18n.t('bookingIdCopied') || 'Booking ID copied to clipboard');
    } catch {
      Alert.alert(i18n.t('error') || 'Error', i18n.t('failedToCopy') || 'Failed to copy');
    }
  };

  const filteredBookings = filter === 'all'
    ? bookingsWithPending
    : bookingsWithPending.filter(b => (b.type || b.bookingType) === filter);

  const getStatusMeta = (status: string) => getBookingStatusMeta(status, i18n);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient
        colors={['#000000', '#1a1a1a', '#2d2d2d']}
        style={styles.gradient}
      >
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.menuButton} onPress={openMenu}>
              <Ionicons name="menu" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.headerContent} pointerEvents="box-none">
              <Text style={styles.headerTitle}>{i18n.t('myBookings') || 'My Bookings'}</Text>
              <Text style={styles.headerSubtitle}>{i18n.t('viewAllBookings') || 'View all your clinic and academy bookings'}</Text>
            </View>
          </View>

          <HamburgerMenu />

          {/* Filter Tabs */}
          <View style={styles.filterContainer}>
            <TouchableOpacity
              style={[styles.filterTab, filter === 'all' && styles.filterTabActive]}
              onPress={() => setFilter('all')}
            >
              <Text style={[styles.filterText, filter === 'all' && styles.filterTextActive]}>
                {i18n.t('all') || 'All'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterTab, filter === 'clinic' && styles.filterTabActive]}
              onPress={() => setFilter('clinic')}
            >
              <Ionicons name="medical" size={16} color={filter === 'clinic' ? '#fff' : '#999'} style={styles.filterIcon} />
              <Text style={[styles.filterText, filter === 'clinic' && styles.filterTextActive]}>
                {i18n.t('clinics') || 'Clinics'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterTab, filter === 'academy' && styles.filterTabActive]}
              onPress={() => setFilter('academy')}
            >
              <Ionicons name="school" size={16} color={filter === 'academy' ? '#fff' : '#999'} style={styles.filterIcon} />
              <Text style={[styles.filterText, filter === 'academy' && styles.filterTextActive]}>
                {i18n.t('academies') || 'Academies'}
              </Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <FootballLoader size="large" color="#fff" />
            </View>
          ) : (
            <FlatList
              data={filteredBookings}
              keyExtractor={item => item.id}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
              }
              renderItem={({ item }) => (
                <View style={styles.bookingCard}>
                  {item.__pendingBooking ? (
                    <View style={styles.pendingPill}>
                      <Ionicons name="time-outline" size={14} color="#1d4ed8" />
                      <Text style={styles.pendingPillText}>{i18n.t('bookingProcessing') || 'Processing'}</Text>
                    </View>
                  ) : null}

                  <View style={styles.cardHeader}>
                    <View style={[styles.typeIcon, item.type === 'clinic' ? styles.clinicIcon : styles.academyIcon]}>
                      <Ionicons
                        name={item.type === 'clinic' ? 'medical' : 'school'}
                        size={24}
                        color="#fff"
                      />
                    </View>
                    <View style={styles.cardHeaderText}>
                      <Text style={styles.cardTitle}>{item.name}</Text>
                      <View style={styles.statusBadge}>
                        <View style={[styles.statusDot, { backgroundColor: getStatusMeta(item.status).color }]} />
                        <Text style={[styles.statusText, { color: getStatusMeta(item.status).color }]}>
                          {getStatusMeta(item.status).label}
                        </Text>
                      </View>
                      {getStatusMeta(item.status).note ? (
                        <Text style={{ color: '#6b7280', fontSize: 12, marginTop: 6, lineHeight: 18 }}>
                          {getStatusMeta(item.status).note}
                        </Text>
                      ) : null}
                    </View>
                  </View>

                  {item.__pendingBooking ? (
                    <View style={styles.progressWrap}>
                      {/** Animated processing meter with football pointer */}
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

                            {item.status === 'failed' ? (
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

                            {item.status === 'failed' ? (
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
                        {item.pendingMessage || getStatusMeta(item.status).note || (i18n.t('bookingProcessingNote') || 'Your booking request is being sent right now.')}
                      </Text>
                    </View>
                  ) : null}

                  {!item.__pendingBooking ? (
                    <TouchableOpacity style={styles.bookingIdBadge} onPress={() => void handleCopyBookingId(item)} activeOpacity={0.8}>
                      <Text style={styles.bookingIdText}>{i18n.t('bookingId') || 'Booking ID'}: {getBookingPublicId(item)}</Text>
                    </TouchableOpacity>
                  ) : null}

                  {formatBookingBranch(item) ? (
                    <View style={styles.infoRow}>
                      <Ionicons name="location-outline" size={16} color="#666" />
                      <Text style={styles.infoText}>{i18n.t('branch') || 'Branch'}: {formatBookingBranch(item)}</Text>
                    </View>
                  ) : null}

                  <View style={styles.cardBody}>
                    {item.type === 'clinic' ? (
                      <>
                        <View style={styles.infoRow}>
                          <Ionicons name="person" size={16} color="#666" />
                          <Text style={styles.infoText}>{i18n.t('doctor')}: {item.doctor}</Text>
                        </View>
                        <View style={styles.infoRow}>
                          <Ionicons name="medical-outline" size={16} color="#666" />
                          <Text style={styles.infoText}>{i18n.t('service')}: {item.service || 'General'}</Text>
                        </View>
                      </>
                    ) : (
                      <View style={styles.infoRow}>
                        <Ionicons name="football" size={16} color="#666" />
                        <Text style={styles.infoText}>{i18n.t('program') || 'Program'}: {item.program}</Text>
                      </View>
                    )}

                    <View style={styles.infoRow}>
                      <Ionicons name="calendar" size={16} color="#666" />
                      <Text style={styles.infoText}>{item.date}</Text>
                    </View>
                    {item.time && (
                      <View style={styles.infoRow}>
                        <Ionicons name="time" size={16} color="#666" />
                        <Text style={styles.infoText}>{item.time} {item.shift ? `(${item.shift === 'Day' ? (i18n.t('dayShift') || 'Day') : (i18n.t('nightShift') || 'Night')})` : ''}</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.cardFooter}>
                    <Text style={styles.priceText}>{item.price} EGP</Text>
                      {!item.__pendingBooking && !['cancelled', 'completed', 'no_show', 'refunded', 'failed_payment'].includes(String(item.status || '').toLowerCase()) && (
                      <TouchableOpacity
                        style={[styles.cancelButton, { opacity: actionLoading?.id === item.id ? 0.6 : 1 }]}
                        onPress={() => handleCancelBooking(item.id)}
                        disabled={actionLoading?.id === item.id}
                      >
                        {actionLoading?.id === item.id && actionLoading?.type === 'cancel' ? (
                          <FootballLoader size="small" color="#fff" />
                        ) : (
                          <Text style={styles.cancelButtonText}>{i18n.t('cancel') || 'Cancel'}</Text>
                        )}
                      </TouchableOpacity>
                    )}
                  </View>

                  {!item.__pendingBooking && String(item.status || '').toLowerCase() === 'confirmed' && (
                    <TouchableOpacity
                      style={[styles.chatButton, { backgroundColor: '#2563eb' }]}
                      onPress={() =>
                        router.push({
                          pathname: '/parent-booking-qr',
                          params: {
                            bookingId: item.id,
                            providerName: item.name || item.providerName || 'Provider',
                            date: item.date || '',
                            time: item.time || '',
                          },
                        })
                      }
                      activeOpacity={0.8}
                    >
                      <Ionicons name="qr-code" size={18} color="#fff" />
                      <Text style={[styles.chatButtonText, { color: '#fff', marginLeft: 8 }]}>Show Booking QR</Text>
                    </TouchableOpacity>
                  )}

                  {!item.__pendingBooking && (item.status === 'new_time_proposed' || item.status === 'timing_proposed') && item.proposedByAdmin && (
                    <View style={{flexDirection: 'row', gap: 12, marginTop: 12}}>
                      <TouchableOpacity
                        style={[styles.chatButton, {flex: 1, backgroundColor: '#10b981', marginTop: 0, opacity: actionLoading?.id === item.id ? 0.6 : 1 }]}
                        onPress={() => handleAcceptTiming(item.id)}
                        disabled={actionLoading?.id === item.id}
                      >
                        {actionLoading?.id === item.id && actionLoading?.type === 'accept' ? (
                          <FootballLoader size="small" color="#fff" />
                        ) : (
                          <>
                            <Ionicons name="checkmark" size={18} color="#fff" />
                            <Text style={[styles.chatButtonText, {color: '#fff', marginLeft: 8}]}>{i18n.t('accept') || 'Accept'}</Text>
                          </>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.chatButton, {flex: 1, backgroundColor: '#ef4444', marginTop: 0, opacity: actionLoading?.id === item.id ? 0.6 : 1 }]}
                        onPress={() => handleRejectTiming(item.id)}
                        disabled={actionLoading?.id === item.id}
                      >
                        {actionLoading?.id === item.id && actionLoading?.type === 'reject' ? (
                          <FootballLoader size="small" color="#fff" />
                        ) : (
                          <>
                            <Ionicons name="close" size={18} color="#fff" />
                            <Text style={[styles.chatButtonText, {color: '#fff', marginLeft: 8}]}>{i18n.t('reject') || 'Reject'}</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  )}

                  {!item.__pendingBooking && (item.status === 'new_time_proposed' || item.status === 'timing_proposed') && (
                    <TouchableOpacity
                      style={[styles.chatButton, { opacity: openingAdminChat ? 0.6 : 1 }]}
                      onPress={openAdminChat}
                      disabled={openingAdminChat}
                      activeOpacity={0.8}
                    >
                      {openingAdminChat ? (
                        <FootballLoader size="small" color="#fff" />
                      ) : (
                        <Ionicons name="chatbubbles" size={18} color="#fff" />
                      )}
                      <Text style={[styles.chatButtonText, {color: '#fff', marginLeft: 8}]}>{openingAdminChat ? (i18n.t('loading') || 'Loading...') : (i18n.t('chatToAdmin') || 'Chat to Admin')}</Text>
                    </TouchableOpacity>
                  )}
                  
                  {!item.__pendingBooking && <TouchableOpacity
                    style={[styles.chatButton, { opacity: openingAdminChat ? 0.6 : 1 }]}
                    onPress={openAdminChat}
                    disabled={openingAdminChat}
                    activeOpacity={0.8}
                  >
                    {openingAdminChat ? (
                      <FootballLoader size="small" color="#fff" />
                    ) : (
                      <Ionicons name="chatbubbles" size={18} color="#fff" />
                    )}
                    <Text style={[styles.chatButtonText, {color: '#fff', marginLeft: 8}]}>{openingAdminChat ? (i18n.t('loading') || 'Loading...') : (i18n.t('chatToAdmin') || 'Chat to Admin')}</Text>
                  </TouchableOpacity>}
                </View>
              )}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Ionicons name="calendar-outline" size={64} color="#666" />
                  <Text style={styles.emptyText}>{i18n.t('noBookingsFound') || 'No bookings found'}</Text>
                </View>
              }
            />
          )}
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
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 24,
    paddingBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
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
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 16,
    gap: 8,
  },
  filterTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  filterTabActive: {
    backgroundColor: '#000',
  },
  filterIcon: {
    marginRight: 6,
  },
  filterText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#999',
  },
  filterTextActive: {
    color: '#fff',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  bookingCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 22,
    marginBottom: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 5,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  typeIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  clinicIcon: {
    backgroundColor: '#ef4444',
  },
  academyIcon: {
    backgroundColor: '#3b82f6',
  },
  cardHeaderText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 19,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 4,
  },
  bookingIdBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#eef2ff',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 14,
  },
  bookingIdText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: '#1e3a8a',
  },
  pendingPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#dbeafe',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 12,
  },
  pendingPillText: {
    color: '#1d4ed8',
    fontSize: 12,
    fontWeight: '700',
  },
  progressWrap: {
    marginBottom: 14,
  },
  progressTrack: {
    position: 'relative',
    height: 10,
    borderRadius: 999,
    backgroundColor: '#f9fafb',
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
    color: '#4b5563',
    fontSize: 12,
    lineHeight: 18,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    marginRight: 6,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  cardBody: {
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 15,
    lineHeight: 21,
    color: '#4b5563',
    marginLeft: 8,
  },
  cardFooter: {
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 6,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  priceText: {
    fontSize: 20,
    fontWeight: 'bold',
    letterSpacing: 0.2,
    color: '#000',
  },
  cancelButton: {
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#fee2e2',
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ef4444',
  },
  chatButton: {
    backgroundColor: '#000',
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
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginTop: 16,
  },
});

