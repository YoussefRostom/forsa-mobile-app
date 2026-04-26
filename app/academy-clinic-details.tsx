import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useRef, useState, useEffect } from 'react';
import { Alert, Animated, Easing, KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DateTimePickerModal from "react-native-modal-datetime-picker";
import i18n from '../locales/i18n';
import { auth, db } from '../lib/firebase';
import { resolveUserDisplayName } from '../lib/userDisplayName';
import { doc, getDoc } from 'firebase/firestore';
import { createBookingWithTransaction, getLocalDateInput } from '../services/MonetizationService';
import FootballLoader from '../components/FootballLoader';
import SuspendedBadge from '../components/SuspendedBadge';
import { isSuspendedEntity } from '../lib/suspension';

export default function AcademyClinicDetailsScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const [clinic, setClinic] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [selectedServiceIndex, setSelectedServiceIndex] = useState(0);
  const [bookingComments, setBookingComments] = useState('');
  const [preferredTime, setPreferredTime] = useState<Date | null>(null);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [selectedShift, setSelectedShift] = useState<'Day' | 'Night' | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const clinicSuspended = isSuspendedEntity(clinic);

  const hideDatePicker = () => {
    setShowTimePicker(false);
  };

  const handleConfirm = (date: Date) => {
    setPreferredTime(date);
    hideDatePicker();
  };

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();

    if (params.id) {
      fetchClinicDetails(params.id as string);
    }
  }, [fadeAnim, params.id]);

  const fetchClinicDetails = async (id: string) => {
    try {
      setLoading(true);
      const docRef = doc(db, 'clinics', id);
      const [docSnap, userSnap] = await Promise.all([getDoc(docRef), getDoc(doc(db, 'users', id))]);
      const userData = userSnap.exists() ? userSnap.data() : {};

      if (docSnap.exists()) {
        const data = docSnap.data();

        const servicesList: any[] = [];
        if (data.services) {
          Object.entries(data.services).forEach(([key, val]: [string, any]) => {
            if (val.selected) {
              servicesList.push({
                name: i18n.t(key) || key,
                fee: val.fee
              });
            }
          });
        }

        const workingHoursList: any[] = [];
        if (data.workingHours) {
          const daysOrder = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
          daysOrder.forEach(day => {
            if (data.workingHours[day]) {
              const dayData = data.workingHours[day];
              workingHoursList.push({
                day: i18n.t(day) || day,
                from: dayData.off ? (i18n.t('closed') || 'Closed') : dayData.from,
                to: dayData.off ? '' : dayData.to,
                off: dayData.off
              });
            }
          });
        }

        const doctorNames = new Set<string>();
        if (data.doctors) {
          data.doctors.forEach((d: any) => {
            if (d.name) doctorNames.add(d.name.trim());
          });
        }
        if (data.workingHours) {
          Object.values(data.workingHours).forEach((dayData: any) => {
            if (dayData.doctors) {
              dayData.doctors.split(',').forEach((docName: string) => {
                if (docName.trim()) doctorNames.add(docName.trim());
              });
            }
          });
        }

        setClinic({
          id: docSnap.id,
          name: data.clinicName,
          city: data.city,
          address: data.address,
          email: data.email,
          phone: data.phone,
          desc: data.description,
          services: servicesList,
          workingHours: workingHoursList,
          doctors: Array.from(doctorNames),
          isSuspended: userData?.isSuspended === true,
          status: userData?.status || '',
        });
      }
    } catch (error) {
      console.error('Error fetching clinic details:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading && !clinic) {
    return (
      <View style={styles.loadingContainer}>
        <FootballLoader size="large" color="#fff" />
      </View>
    );
  }

  if (!clinic) {
    return (
      <View style={styles.errorContainer}>
        <LinearGradient colors={['#000000', '#1a1a1a', '#2d2d2d']} style={styles.gradient}>
          <View style={styles.errorContent}>
            <Ionicons name="alert-circle-outline" size={64} color="#fff" />
            <Text style={styles.errorText}>{i18n.t('clinicNotFound') || 'Clinic not found.'}</Text>
            <TouchableOpacity style={styles.backButtonLarge} onPress={() => router.back()}>
              <Text style={styles.backButtonText}>{i18n.t('goBack') || 'Go Back'}</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </View>
    );
  }

  const handleCall = () => {
    if (clinic.phone) {
      Linking.openURL(`tel:${clinic.phone}`);
    } else {
      Alert.alert(i18n.t('error'), i18n.t('noPhoneAvailable') || 'No phone number available');
    }
  };

  const handleReserve = async () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert(i18n.t('error'), i18n.t('loginRequired') || 'You must be logged in to book');
      return;
    }
    if (clinicSuspended) {
      Alert.alert(i18n.t('error') || 'Error', i18n.t('suspendedProviderBookingUnavailable') || 'This provider is suspended and cannot receive bookings right now.');
      return;
    }

    Alert.alert(
      i18n.t('keepAppOpenTitle') || 'Keep App Open',
      i18n.t('keepAppOpenBookingMessage') || 'Please keep the app open until the reservation finishes.'
    );

    const doctorName = i18n.t('noSpecificDoctor') || 'No specific doctor';
    const serviceList = clinic.services && clinic.services.length > 0 ? clinic.services : [];
    const selectedService = serviceList[selectedServiceIndex];
    const serviceName = selectedService ? selectedService.name : (i18n.t('generalService') || 'General');
    const servicePrice = selectedService ? Number(selectedService.fee) || 0 : 0;

    try {
      setBookingLoading(true);

      let academyName = user.displayName || (i18n.t('academy') || 'Academy');
      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          academyName = resolveUserDisplayName(userData, i18n.t('academy') || 'Academy');
        }
      } catch {
      }

      const bookingData = {
        academyId: user.uid,
        customerName: academyName,
        providerId: clinic.id,
        providerName: clinic.name,
        type: 'clinic',
        status: 'pending',
        date: preferredTime ? getLocalDateInput(preferredTime) : getLocalDateInput(),
        time: preferredTime ? preferredTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null,
        preferredTime: preferredTime ? preferredTime.toISOString() : null,
        createdAt: new Date().toISOString(),
        name: clinic.name,
        city: clinic.city,
        doctor: doctorName,
        service: serviceName,
        price: servicePrice,
        shift: selectedShift,
        comments: bookingComments.trim() || null,
      };

      await createBookingWithTransaction(bookingData, user.uid, 'Academy-to-clinic booking created');

      Alert.alert(
        i18n.t('reservation') || 'Reservation',
        `${i18n.t('reservationSuccess') || 'Reservation request sent!'}\n${i18n.t('service') || 'Service'}: ${serviceName}`,
        [{ text: i18n.t('ok') || 'OK', onPress: () => router.push('/academy-bookings') }]
      );
    } catch (error) {
      console.error('Error creating clinic booking:', error);
      const message = error instanceof Error ? error.message : (i18n.t('bookingFailed') || 'Failed to create booking');
      Alert.alert(i18n.t('error'), message);
    } finally {
      setBookingLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient
        colors={['#000000', '#1a1a1a', '#2d2d2d']}
        style={styles.gradient}
      >
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.headerContent}>
              <Text style={styles.headerTitle}>{clinic.name}</Text>
              <Text style={styles.headerSubtitle}>{i18n.t('clinicDetails') || 'Clinic Information'}</Text>
              {clinicSuspended && <SuspendedBadge />}
            </View>
            <TouchableOpacity style={styles.callButton} onPress={handleCall}>
              <Ionicons name="call" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.detailsCard}>
              <View style={styles.detailRow}>
                <View style={styles.detailIcon}>
                  <Ionicons name="medical" size={20} color="#000" />
                </View>
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>{i18n.t('clinicNameLabel') || 'Clinic Name'}</Text>
                  <Text style={styles.detailValue}>{clinic.name}</Text>
                </View>
              </View>

              <View style={styles.detailRow}>
                <View style={styles.detailIcon}>
                  <Ionicons name="location" size={20} color="#000" />
                </View>
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>{i18n.t('city')}</Text>
                  <Text style={styles.detailValue}>{clinic.city}</Text>
                </View>
              </View>

              <View style={styles.detailRow}>
                <View style={styles.detailIcon}>
                  <Ionicons name="cash" size={20} color="#000" />
                </View>
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>{i18n.t('services') || 'Services & Fees'}</Text>
                  {clinic.services.map((service: any, idx: number) => (
                    <View key={idx} style={styles.serviceRow}>
                      <Text style={styles.serviceName}>{service.name}</Text>
                      <Text style={styles.serviceFee}>{service.fee} EGP</Text>
                    </View>
                  ))}
                </View>
              </View>

              <View style={styles.detailRow}>
                <View style={styles.detailIcon}>
                  <Ionicons name="document-text" size={20} color="#000" />
                </View>
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>{i18n.t('description') || 'Description'}</Text>
                  <Text style={styles.detailValue}>{clinic.desc}</Text>
                </View>
              </View>

              <View style={styles.detailRow}>
                <View style={styles.detailIcon}>
                  <Ionicons name="map" size={20} color="#000" />
                </View>
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>{i18n.t('address') || 'Address'}</Text>
                  <Text style={styles.detailValue}>{clinic.address}</Text>
                </View>
              </View>

              <View style={styles.detailRow}>
                <View style={styles.detailIcon}>
                  <Ionicons name="mail" size={20} color="#000" />
                </View>
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>{i18n.t('email')}</Text>
                  <Text style={styles.detailValue}>{clinic.email || (i18n.t('notAvailable') || 'N/A')}</Text>
                </View>
              </View>
            </View>

            {/* Book appointment: service, comments, reserve */}
            <View style={styles.bookingCard}>
              {clinicSuspended && (
                <View style={styles.suspensionNotice}>
                  <Text style={styles.suspensionNoticeText}>{i18n.t('suspendedProviderBookingUnavailable') || 'This provider is suspended and cannot receive bookings right now.'}</Text>
                </View>
              )}
              <View style={styles.cardHeader}>
                <Ionicons name="calendar" size={24} color="#000" />
                <Text style={styles.cardTitle}>{i18n.t('bookAppointment') || 'Book appointment'}</Text>
              </View>

              <Text style={styles.bookingLabel}>{i18n.t('selectService') || 'Select service'}</Text>
              {clinic.services && clinic.services.length > 0 ? (
                <View style={styles.serviceOptions}>
                  {clinic.services.map((svc: any, idx: number) => (
                    <TouchableOpacity
                      key={idx}
                      style={[styles.serviceOption, selectedServiceIndex === idx && styles.serviceOptionSelected]}
                      onPress={() => setSelectedServiceIndex(idx)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.serviceOptionText}>{svc.name}</Text>
                      <Text style={styles.serviceOptionFee}>{svc.fee} EGP</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <Text style={styles.bookingHint}>{i18n.t('noServicesListed') || 'No services listed'}</Text>
              )}

              <Text style={styles.bookingLabel}>{i18n.t('preferredDateTime') || 'Preferred Date & Time'}</Text>
              <TouchableOpacity
                style={styles.timePickerContainer}
                onPress={() => setShowTimePicker(true)}
              >
                <Ionicons name="calendar-outline" size={20} color="#0f766e" style={styles.timeIcon} />
                <Text style={[styles.timeText, !preferredTime && styles.timePlaceholder]}>
                  {preferredTime ? preferredTime.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : (i18n.t('selectDateAndTime') || 'Select preferred date & time')}
                </Text>
              </TouchableOpacity>
              
              <DateTimePickerModal
                isVisible={showTimePicker}
                mode="datetime"
                date={preferredTime || new Date()}
                onConfirm={handleConfirm}
                onCancel={hideDatePicker}
                is24Hour={false}
                isDarkModeEnabled={false}
                buttonTextColorIOS="#0f766e"
                textColor="#000"
              />

              <Text style={styles.bookingLabel}>{i18n.t('shiftPreference') || 'Shift Preference'}</Text>
              <View style={{flexDirection: 'row', gap: 12, marginBottom: 16}}>
                <TouchableOpacity
                  style={[styles.serviceOption, {flex: 1, marginBottom: 0, justifyContent: 'center'}, selectedShift === 'Day' && styles.serviceOptionSelected]}
                  onPress={() => setSelectedShift('Day')}
                >
                  <Ionicons name="sunny" size={20} color={selectedShift === 'Day' ? '#000' : '#666'} style={{marginRight: 8}}/>
                  <Text style={[styles.serviceOptionText, {textAlign: 'center', flex: 0, color: selectedShift === 'Day' ? '#000' : '#666'}]}>{i18n.t('dayShift') || 'Before 3PM'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.serviceOption, {flex: 1, marginBottom: 0, justifyContent: 'center'}, selectedShift === 'Night' && styles.serviceOptionSelected]}
                  onPress={() => setSelectedShift('Night')}
                >
                  <Ionicons name="moon" size={20} color={selectedShift === 'Night' ? '#000' : '#666'} style={{marginRight: 8}}/>
                  <Text style={[styles.serviceOptionText, {textAlign: 'center', flex: 0, color: selectedShift === 'Night' ? '#000' : '#666'}]}>{i18n.t('nightShift') || 'After 3PM'}</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.bookingLabel}>{i18n.t('additionalComments') || 'Additional comments (optional)'}</Text>
              <TextInput
                style={styles.commentsInput}
                placeholder={i18n.t('commentsPlaceholder') || 'Any special requests or notes...'}
                placeholderTextColor="#999"
                value={bookingComments}
                onChangeText={setBookingComments}
                multiline
                numberOfLines={3}
              />

              <TouchableOpacity
                style={[styles.reserveButton, (bookingLoading || !selectedShift || !preferredTime || clinicSuspended) && styles.reserveButtonDisabled]}
                onPress={() => handleReserve()}
                disabled={bookingLoading || !clinic.services || clinic.services.length === 0 || !selectedShift || !preferredTime || clinicSuspended}
                activeOpacity={0.8}
              >
                {bookingLoading ? (
                  <FootballLoader size="small" color="#fff" />
                ) : (
                  <Text style={styles.reserveButtonText}>{i18n.t('reserve') || 'Reserve'}</Text>
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.doctorsCard}>
              <View style={styles.cardHeader}>
                <Ionicons name="people" size={24} color="#000" />
                <Text style={styles.cardTitle}>{i18n.t('doctors') || 'Doctors'}</Text>
              </View>
              {clinic.doctors && clinic.doctors.length > 0 ? (
                clinic.doctors.map((doctor: string, idx: number) => (
                  <View key={idx} style={styles.doctorButton}>
                    <Ionicons name="person" size={20} color="#000" style={styles.doctorIcon} />
                    <Text style={styles.doctorName}>{doctor}</Text>
                  </View>
                ))
              ) : (
                <Text style={{ color: '#666', fontStyle: 'italic', padding: 8 }}>{i18n.t('noDoctorsListed') || 'No doctors listed'}</Text>
              )}
            </View>
          </ScrollView>
        </Animated.View>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  gradient: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a1a' },
  errorContainer: { flex: 1 },
  errorContent: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 18, color: '#fff', marginTop: 16, marginBottom: 20 },
  backButtonLarge: { backgroundColor: '#fff', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 },
  backButtonText: { color: '#000', fontWeight: 'bold' },
  header: { paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingHorizontal: 24, paddingBottom: 20, flexDirection: 'row', alignItems: 'center' },
  backButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255, 255, 255, 0.1)', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  headerContent: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 4, textAlign: 'center' },
  headerSubtitle: { fontSize: 14, color: 'rgba(255, 255, 255, 0.7)', textAlign: 'center' },
  callButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255, 255, 255, 0.1)', justifyContent: 'center', alignItems: 'center', marginLeft: 16 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 40 },
  detailsCard: { backgroundColor: '#fff', borderRadius: 24, padding: 24, marginTop: 20, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20, elevation: 10 },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 20, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  detailIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f0f0f0', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  detailContent: { flex: 1 },
  detailLabel: { fontSize: 14, fontWeight: '600', color: '#666', marginBottom: 4 },
  detailValue: { fontSize: 16, color: '#000', lineHeight: 22 },
  hoursCard: { backgroundColor: '#fff', borderRadius: 24, padding: 24, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20, elevation: 10 },
  doctorsCard: { backgroundColor: '#fff', borderRadius: 24, padding: 24, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20, elevation: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  cardTitle: { fontSize: 20, fontWeight: 'bold', color: '#000', marginLeft: 12 },
  hoursRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  hoursDay: { fontSize: 16, color: '#000', fontWeight: '500' },
  hoursTime: { fontSize: 16, color: '#666' },
  doctorButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f5f5f5', borderRadius: 12, padding: 16, marginBottom: 12 },
  doctorIcon: { marginRight: 12 },
  doctorName: { flex: 1, fontSize: 16, fontWeight: '600', color: '#000' },
  serviceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  serviceName: { fontSize: 16, color: '#000', flex: 1 },
  serviceFee: { fontSize: 16, fontWeight: 'bold', color: '#000', marginLeft: 12 },
  bookingCard: { backgroundColor: '#fff', borderRadius: 24, padding: 24, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20, elevation: 10 },
  suspensionNotice: { marginBottom: 14, backgroundColor: '#fef2f2', borderColor: '#fecaca', borderWidth: 1, borderRadius: 12, padding: 12 },
  suspensionNoticeText: { color: '#b91c1c', fontSize: 13, lineHeight: 18, fontWeight: '600' },
  bookingLabel: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 8, marginTop: 4 },
  serviceOptions: { marginBottom: 12 },
  serviceOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f5f5f5', padding: 14, borderRadius: 12, marginBottom: 8 },
  serviceOptionSelected: { backgroundColor: '#e0e0e0', borderWidth: 2, borderColor: '#000' },
  serviceOptionText: { fontSize: 16, color: '#000', flex: 1 },
  serviceOptionFee: { fontSize: 14, fontWeight: '600', color: '#000' },
  bookingHint: { fontSize: 14, color: '#666', fontStyle: 'italic', marginBottom: 12 },
  timePickerContainer: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#99f6e4', borderRadius: 12, padding: 14, marginBottom: 16, backgroundColor: '#ecfeff' },
  timeIcon: { marginRight: 10 },
  timeText: { fontSize: 15, color: '#115e59', flex: 1 },
  timePlaceholder: { color: '#0f766e' },
  commentsInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 12, padding: 12, fontSize: 15, color: '#000', minHeight: 80, textAlignVertical: 'top' },
  reserveButton: { backgroundColor: '#000', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 20 },
  reserveButtonDisabled: { opacity: 0.6 },
  reserveButtonText: { color: '#fff', fontSize: 17, fontWeight: 'bold' },
});
