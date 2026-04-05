import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useRef, useState, useEffect } from 'react';
import { Alert, Animated, Easing, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import i18n from '../locales/i18n';
import { auth, db } from '../lib/firebase';
import { doc, getDoc, collection, addDoc, query, where, getDocs } from 'firebase/firestore';
import { notifyProviderAndAdmins, createNotification } from '../services/NotificationService';

export default function ParentAcademyDetailsScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const [academy, setAcademy] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [selectedAge, setSelectedAge] = useState<string>('');
  const [ageModalVisible, setAgeModalVisible] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [programs, setPrograms] = useState<any[]>([]);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();

    if (params.id) {
      fetchAcademyDetails(params.id as string);
    }
  }, [params.id]);

  const fetchAcademyDetails = async (id: string) => {
    try {
      setLoading(true);
      const docRef = doc(db, 'academies', id);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        setAcademy({
          id: docSnap.id,
          name: data.academyName || data.name,
          city: data.city,
          address: data.address,
          description: data.description,
          desc: data.description, // UI uses desc
          fees: data.fees || {},
          contact: data.phone,
        });

        try {
          const programsQuery = query(
            collection(db, 'academy_programs'),
            where('academyId', '==', docSnap.id)
          );
          const programsSnapshot = await getDocs(programsQuery);
          const programsData = programsSnapshot.docs
            .map((d: any) => ({
              id: d.id,
              ...d.data(),
            }))
            .filter((prog: any) => prog.isActive !== false);
          setPrograms(programsData);
        } catch (programError) {
          console.error('Error fetching programs:', programError);
          setPrograms([]);
        }

      } else {
      }
    } catch (error) {
      console.error('Error fetching academy details:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (!academy) {
    return (
      <View style={styles.errorContainer}>
        <LinearGradient colors={['#000000', '#1a1a1a', '#2d2d2d']} style={styles.gradient}>
          <View style={styles.errorContent}>
            <Ionicons name="alert-circle-outline" size={64} color="#fff" />
            <Text style={styles.errorText}>{i18n.t('academyNotFound') || 'Academy not found.'}</Text>
            <TouchableOpacity style={styles.backButtonLarge} onPress={() => router.back()}>
              <Text style={styles.backButtonText}>{i18n.t('goBack') || 'Go Back'}</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </View>
    );
  }

  const handleReserve = async () => {
    if (!selectedAge) {
      Alert.alert(
        i18n.t('error') || 'Error',
        i18n.t('pleaseSelectAge') || 'Please select an age group for booking'
      );
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      Alert.alert(i18n.t('error'), i18n.t('loginRequired') || 'You must be logged in to book');
      return;
    }

    const price = academy?.fees[selectedAge] || 0;

    try {
      setBookingLoading(true);
      const bookingData = {
        parentId: user.uid,
        providerId: academy.id,
        type: 'academy',
        status: 'pending',
        date: new Date().toISOString().split('T')[0],
        createdAt: new Date().toISOString(),
        name: academy.name,
        city: academy.city,
        ageGroup: selectedAge,
        program: `${selectedAge} years`,
        price: Number(price),
      };

      const bookingRef = await addDoc(collection(db, 'bookings'), bookingData);
      const providerId = academy.id;
      try {
        await notifyProviderAndAdmins(
          providerId,
          i18n.t('newBookingRequest') || 'New booking request',
          `${i18n.t('parent') || 'Parent'} ${i18n.t('requestedBooking') || 'requested a booking'}`,
          'booking',
          { bookingId: bookingRef.id },
          user.uid
        );
        await createNotification({
          userId: user.uid,
          title: i18n.t('bookingRequestSent') || 'Booking request sent',
          body: `${academy.name}`,
          type: 'booking',
          data: { bookingId: bookingRef.id },
        });
      } catch (e) {
        console.warn('Notification create failed:', e);
      }

      Alert.alert(
        i18n.t('reservation') || 'Reservation',
        `${i18n.t('reservationSuccess') || 'Reservation request sent!'}\n${i18n.t('ageGroup') || 'Age Group'}: ${selectedAge} ${i18n.t('years') || 'years'}\n${i18n.t('price') || 'Price'}: ${price} EGP`,
        [{ text: i18n.t('ok') || 'OK', onPress: () => router.push('/parent-bookings') }]
      );
    } catch (error) {
      console.error('Error creating academy booking:', error);
      Alert.alert(i18n.t('error'), i18n.t('bookingFailed') || 'Failed to create booking');
    } finally {
      setBookingLoading(false);
    }
  };

  const handleBookPrivateTraining = async (program: any) => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert(i18n.t('error'), i18n.t('loginRequired') || 'You must be logged in to book');
      return;
    }

    try {
      setBookingLoading(true);

      // Fetch user name from Firestore
      let playerName = user.displayName || 'Parent';
      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          playerName = userData.name || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || playerName;
        }
      } catch (err) {
      }

      const bookingData = {
        parentId: user.uid,
        playerName: playerName,
        customerName: playerName,
        providerId: academy!.id,
        providerName: academy!.name,
        type: 'academy',
        programId: program.id,
        status: 'pending',
        date: new Date().toISOString().split('T')[0],
        createdAt: new Date().toISOString(),
        name: academy!.name,
        city: academy!.city,
        program: program.name,
        coachName: program.coachName,
        sessionType: 'private',
        price: Number(program.fee),
        duration: program.duration,
      };

      const bookingRef = await addDoc(collection(db, 'bookings'), bookingData);
      const providerId = academy!.id;
      try {
        await notifyProviderAndAdmins(
          providerId,
          i18n.t('newBookingRequest') || 'New booking request',
          `${playerName} ${i18n.t('requestedPrivateTraining') || 'requested private training'}: ${program.name}`,
          'booking',
          { bookingId: bookingRef.id },
          user.uid
        );
        await createNotification({
          userId: user.uid,
          title: i18n.t('bookingRequestSent') || 'Booking request sent',
          body: `${academy!.name} – ${program.name} with ${program.coachName}`,
          type: 'booking',
          data: { bookingId: bookingRef.id },
        });
      } catch (e) {
        console.warn('Notification create failed:', e);
      }

      Alert.alert(
        i18n.t('bookingRequestSent') || 'Booking Request Sent',
        i18n.t('privateTrainingBookingDesc') || 'Your private training booking request has been sent. You will be notified once the academy responds.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (error) {
      console.error('Private training booking error:', error);
      Alert.alert(i18n.t('error'), i18n.t('bookingFailed') || 'Failed to send booking request. Please try again.');
    } finally {
      setBookingLoading(false);
    }
  };

  // Helper to sort age keys numerically
  const availableAges = academy && academy.fees ? Object.keys(academy.fees).sort((a, b) => parseInt(a) - parseInt(b)) : [];
  const selectedPrice = selectedAge && academy && academy.fees ? (academy.fees[selectedAge] || 0) : 0;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient
        colors={['#000000', '#1a1a1a', '#2d2d2d']}
        style={styles.gradient}
      >
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.headerContent}>
              <Text style={styles.headerTitle}>{academy.name}</Text>
              <Text style={styles.headerSubtitle}>{i18n.t('academyDetails') || 'Academy Information'}</Text>
            </View>
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.detailsCard}>
              <View style={styles.detailRow}>
                <View style={styles.detailIcon}>
                  <Ionicons name="school" size={20} color="#000" />
                </View>
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>{i18n.t('academyNameLabel') || 'Academy Name'}</Text>
                  <Text style={styles.detailValue}>{academy.name}</Text>
                </View>
              </View>

              <View style={styles.detailRow}>
                <View style={styles.detailIcon}>
                  <Ionicons name="location" size={20} color="#000" />
                </View>
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>{i18n.t('city')}</Text>
                  <Text style={styles.detailValue}>{academy.city}</Text>
                </View>
              </View>

              {/* Age Groups & Fees Section */}
              <View style={styles.detailRow}>
                <View style={styles.detailIcon}>
                  <Ionicons name="cash" size={20} color="#000" />
                </View>
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>{i18n.t('monthlyFees') || 'Monthly Fees (per age group)'}</Text>
                  {availableAges.length > 0 ? (
                    availableAges.map(age => (
                      <View key={age} style={styles.feeRow}>
                        <Text style={styles.feeAgeText}>{age} {i18n.t('years') || 'years'}</Text>
                        <Text style={styles.feePriceText}>{academy.fees[age]} EGP</Text>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.detailValue}>{i18n.t('noFeesAvailable') || 'No fees available'}</Text>
                  )}
                </View>
              </View>

              <View style={styles.detailRow}>
                <View style={styles.detailIcon}>
                  <Ionicons name="document-text" size={20} color="#000" />
                </View>
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>{i18n.t('description') || 'Description'}</Text>
                  <Text style={styles.detailValue}>{academy.desc}</Text>
                </View>
              </View>

              <View style={styles.detailRow}>
                <View style={styles.detailIcon}>
                  <Ionicons name="map" size={20} color="#000" />
                </View>
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>{i18n.t('address') || 'Address'}</Text>
                  <Text style={styles.detailValue}>{academy.address}</Text>
                </View>
              </View>

              <View style={styles.detailRow}>
                <View style={styles.detailIcon}>
                  <Ionicons name="call" size={20} color="#000" />
                </View>
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>{i18n.t('contactPerson') || 'Contact'}</Text>
                  <Text style={styles.detailValue}>{academy.contact}</Text>
                </View>
              </View>

              <View style={styles.detailRow}>
                <View style={styles.detailIcon}>
                  <Ionicons name="mail" size={20} color="#000" />
                </View>
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>{i18n.t('email')}</Text>
                  <Text style={styles.detailValue}>{academy.email}</Text>
                </View>
              </View>
            </View>

            {/* Private Training Programs Section */}
            {programs.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="fitness-outline" size={20} color="#000" />
                  <Text style={styles.sectionTitle}>{i18n.t('privateTraining') || 'Private Training'}</Text>
                </View>
                <View style={styles.programsContainer}>
                  {programs.filter(p => p.type === 'private_training').map((program) => (
                    <View key={program.id} style={styles.programCard}>
                      <View style={styles.programHeader}>
                        <Text style={styles.programName}>{program.name}</Text>
                        <Text style={styles.programPrice}>{program.fee} EGP</Text>
                      </View>
                      {program.coachName && (
                        <Text style={styles.programCoach}>Coach: {program.coachName}</Text>
                      )}
                      {program.description && (
                        <Text style={styles.programDescription}>{program.description}</Text>
                      )}
                      {program.specializations && program.specializations.length > 0 && (
                        <View style={styles.specializationsContainer}>
                          <Text style={styles.specializationsLabel}>{i18n.t('specializations') || 'Specializations'}:</Text>
                          <Text style={styles.specializationsText}>{program.specializations.join(', ')}</Text>
                        </View>
                      )}
                      <View style={styles.programDetails}>
                        <Text style={styles.programDetail}>
                          <Ionicons name="time-outline" size={14} color="#666" /> {program.duration} min
                        </Text>
                        <Text style={styles.programDetail}>
                          <Ionicons name="people-outline" size={14} color="#666" /> Max {program.maxParticipants}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.bookProgramButton}
                        onPress={() => handleBookPrivateTraining(program)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.bookProgramButtonText}>{i18n.t('bookNow') || 'Book Now'}</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Age Selection for Booking */}
            <View style={styles.bookingSection}>
              <Text style={styles.bookingSectionTitle}>{i18n.t('selectAgeForBooking') || 'Select Age Group for Booking'}</Text>
              <TouchableOpacity
                style={[styles.ageSelectButton, selectedAge && styles.ageSelectButtonActive]}
                onPress={() => setAgeModalVisible(true)}
                activeOpacity={0.8}
              >
                <Ionicons name="calendar-outline" size={20} color={selectedAge ? "#000" : "#999"} />
                <Text style={[styles.ageSelectText, !selectedAge && styles.ageSelectPlaceholder]}>
                  {selectedAge
                    ? `${selectedAge} ${i18n.t('years') || 'years'} - ${selectedPrice} EGP`
                    : i18n.t('selectAgeGroup') || 'Select Age Group'
                  }
                </Text>
                <Ionicons name="chevron-down" size={20} color="#999" />
              </TouchableOpacity>
              {selectedAge && (
                <View style={styles.selectedAgeInfo}>
                  <Text style={styles.selectedAgeText}>
                    {i18n.t('selectedAge') || 'Selected'}: {selectedAge} {i18n.t('years') || 'years'}
                  </Text>
                  <Text style={styles.selectedPriceText}>
                    {i18n.t('price') || 'Price'}: {selectedPrice} EGP/{i18n.t('month') || 'month'}
                  </Text>
                </View>
              )}
            </View>

            {/* Age Selection Modal */}
            <Modal
              visible={ageModalVisible}
              transparent
              animationType="fade"
              onRequestClose={() => setAgeModalVisible(false)}
            >
              <TouchableOpacity
                style={styles.modalOverlay}
                activeOpacity={1}
                onPress={() => setAgeModalVisible(false)}
              >
                <View style={styles.modalContent}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>{i18n.t('selectAgeGroup') || 'Select Age Group'}</Text>
                    <TouchableOpacity onPress={() => setAgeModalVisible(false)}>
                      <Ionicons name="close" size={24} color="#000" />
                    </TouchableOpacity>
                  </View>
                  <ScrollView style={styles.modalScrollView}>
                    {availableAges.map((age) => (
                      <TouchableOpacity
                        key={age}
                        style={[styles.modalOption, selectedAge === age && styles.modalOptionSelected]}
                        onPress={() => {
                          setSelectedAge(age);
                          setAgeModalVisible(false);
                        }}
                      >
                        <View style={styles.modalOptionContent}>
                          <Text style={[styles.modalOptionText, selectedAge === age && styles.modalOptionTextSelected]}>
                            {age} {i18n.t('years') || 'years'}
                          </Text>
                          <Text style={[styles.modalOptionPrice, selectedAge === age && styles.modalOptionPriceSelected]}>
                            {academy.fees[age]} EGP
                          </Text>
                        </View>
                        {selectedAge === age && <Ionicons name="checkmark" size={20} color="#fff" />}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </TouchableOpacity>
            </Modal>

            <TouchableOpacity
              style={[styles.reserveButton, (!selectedAge || bookingLoading) && styles.reserveButtonDisabled]}
              onPress={handleReserve}
              activeOpacity={0.8}
              disabled={!selectedAge || bookingLoading}
            >
              {bookingLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="calendar" size={20} color="#fff" style={styles.reserveIcon} />
                  <Text style={styles.reserveButtonText}>
                    {selectedAge
                      ? `${i18n.t('reserveNow') || 'Reserve Now'} - ${selectedPrice} EGP`
                      : i18n.t('selectAgeToBook') || 'Select Age to Book'
                    }
                  </Text>
                </>
              )}
            </TouchableOpacity>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  errorContainer: {
    flex: 1,
  },
  errorContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 18,
    color: '#fff',
    marginTop: 16,
    marginBottom: 20,
  },
  backButtonLarge: {
    backgroundColor: '#fff',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  backButtonText: {
    color: '#000',
    fontWeight: 'bold',
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 24,
    paddingBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
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
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  detailsCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    marginTop: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  detailIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  detailContent: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 16,
    color: '#000',
    lineHeight: 22,
  },
  reserveButton: {
    backgroundColor: '#000',
    borderRadius: 12,
    height: 56,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  reserveIcon: {
    marginRight: 8,
  },
  reserveButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  reserveButtonDisabled: {
    backgroundColor: '#666',
    opacity: 0.6,
  },
  bookingSection: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    marginTop: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  bookingSectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 16,
  },
  ageSelectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f8f8',
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: '#e0e0e0',
    gap: 12,
  },
  ageSelectButtonActive: {
    borderColor: '#000',
  },
  ageSelectText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  ageSelectPlaceholder: {
    color: '#999',
    fontWeight: 'normal',
  },
  selectedAgeInfo: {
    marginTop: 16,
    padding: 16,
    backgroundColor: '#f0f8ff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#000',
  },
  selectedAgeText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  selectedPriceText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000',
  },
  feeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  feeAgeText: {
    fontSize: 16,
    color: '#000',
  },
  feePriceText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 20,
    width: '85%',
    maxHeight: '70%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000',
  },
  modalScrollView: {
    maxHeight: 400,
  },
  modalOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  modalOptionSelected: {
    backgroundColor: '#000',
  },
  modalOptionContent: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalOptionText: {
    fontSize: 16,
    color: '#000',
  },
  modalOptionTextSelected: {
    color: '#fff',
    fontWeight: 'bold',
  },
  modalOptionPrice: {
    fontSize: 16,
    color: '#666',
    marginLeft: 16,
  },
  modalOptionPriceSelected: {
    color: '#fff',
    fontWeight: 'bold',
  },
  section: {
    marginBottom: 32,
    marginTop: 20
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
  },
  programsContainer: {
    gap: 16,
  },
  programCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
    borderColor: '#f0f0f0',
  },
  programHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  programName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000',
    flex: 1,
  },
  programPrice: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#10b981',
    marginLeft: 8,
  },
  programCoach: {
    fontSize: 16,
    color: '#333',
    fontWeight: '600',
    marginBottom: 8,
  },
  programDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
    lineHeight: 20,
  },
  specializationsContainer: {
    backgroundColor: '#f8f8f8',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  specializationsLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#666',
    marginBottom: 4,
  },
  specializationsText: {
    fontSize: 14,
    color: '#333',
  },
  programDetails: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 20,
  },
  programDetail: {
    fontSize: 14,
    color: '#666',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  bookProgramButton: {
    backgroundColor: '#000',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  bookProgramButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
