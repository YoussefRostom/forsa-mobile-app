import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useRef, useState, useEffect } from 'react';
import { Alert, Animated, Easing, KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DateTimePickerModal from "react-native-modal-datetime-picker";
import i18n from '../locales/i18n';
import { auth, db } from '../lib/firebase';
import { resolveUserDisplayName } from '../lib/userDisplayName';
import { buildBookingBranchPayload, getBranchAddressLine, getBranchSummary, normalizeBookingBranches } from '../lib/bookingBranch';
import { doc, getDoc } from 'firebase/firestore';
import { createBookingWithTransaction, getLocalDateInput } from '../services/MonetizationService';
import { addPendingBooking, completePendingBooking, failPendingBooking } from '../lib/pendingBookingStore';
import FootballLoader from '../components/FootballLoader';
import ReportModal from '../components/ReportModal';
import SuspendedBadge from '../components/SuspendedBadge';
import { isSuspendedEntity } from '../lib/suspension';

function createMinimumBookingDate() {
  const minimumDate = new Date();
  minimumDate.setHours(minimumDate.getHours() + 2);
  minimumDate.setSeconds(0, 0);
  return minimumDate;
}

export default function ClinicDetailsScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const [clinic, setClinic] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [selectedServiceIndex, setSelectedServiceIndex] = useState(0);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [bookingComments, setBookingComments] = useState('');
  const [minimumBookingDate] = useState(() => createMinimumBookingDate());
  const [preferredTime, setPreferredTime] = useState<Date | null>(() => new Date(createMinimumBookingDate()));
  const [selectedShift, setSelectedShift] = useState<'Day' | 'Night' | null>(null);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const cityLabels = i18n.t('cities', { returnObjects: true }) as Record<string, string>;

  const hideDatePicker = () => {
    setShowTimePicker(false);
  };

  const handleConfirm = (date: Date) => {
    setPreferredTime(date < minimumBookingDate ? new Date(minimumBookingDate) : date);
    hideDatePicker();
  };

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();

    // Support both id param and clinic JSON string to get the ID
    let clinicId = params.id as string;
    if (!clinicId && params.clinic) {
      try {
        const parsed = JSON.parse(params.clinic as string);
        clinicId = parsed.id;
      } catch { }
    }

    if (clinicId) {
      fetchClinicDetails(clinicId);
    } else {
      setLoading(false);
    }
  }, [fadeAnim, params.id, params.clinic]);

  const branches = normalizeBookingBranches(clinic?.locations);
  const selectedBranch = branches.find((branch) => branch.id === selectedBranchId) || null;
  const clinicSuspended = isSuspendedEntity(clinic);

  useEffect(() => {
    const defaultBranchId = branches[0]?.id || '';
    setSelectedBranchId((current) => (branches.some((branch) => branch.id === current) ? current : defaultBranchId));
  }, [clinic]);

  const fetchClinicDetails = async (id: string) => {
    try {
      setLoading(true);
      const docRef = doc(db, 'clinics', id);
      const [docSnap, userSnap] = await Promise.all([getDoc(docRef), getDoc(doc(db, 'users', id))]);
      const userData = userSnap.exists() ? userSnap.data() : {};

      if (docSnap.exists()) {
        const data = docSnap.data();

        // Transform services data
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

        // Transform working hours
        const workingHoursList: any[] = [];
        if (data.workingHours) {
          const daysOrder = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
          daysOrder.forEach(day => {
            if (data.workingHours[day]) {
              const dayData = data.workingHours[day];
              workingHoursList.push({
                day: i18n.t(day) || day,
                from: dayData.off ? 'Closed' : dayData.from,
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
          name: data.clinicName || data.name || 'Clinic',
          city: data.city || '',
          district: data.district || '',
          address: data.address || '',
          email: data.email || null,
          phone: data.phone || '',
          desc: data.description || '',
          socialUrl: data.socialUrl || data.instagramUrl || data.facebookUrl || null,
          mapUrl: data.mapUrl || null,
          latitude: data.latitude ?? data.coordinates?.latitude ?? null,
          longitude: data.longitude ?? data.coordinates?.longitude ?? null,
          coordinates: data.coordinates || null,
          locations: Array.isArray(data.locations) ? data.locations : [],
          services: servicesList,
          workingHours: workingHoursList,
          doctors: Array.from(doctorNames),
          isSuspended: userData?.isSuspended === true,
          status: userData?.status || '',
        });
      } else {
      }
    } catch (error) {
      console.error('Error fetching clinic details:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
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
      Alert.alert(i18n.t('error') || 'Error', 'No phone number available');
    }
  };

  const openExternalLink = async (url: string) => {
    if (!url) return;
    const isAbsoluteUrl = /^(https?:\/\/|geo:|maps:|comgooglemaps:\/\/)/i.test(url);
    const fullUrl = isAbsoluteUrl ? url : `https://${url}`;
    const canOpen = await Linking.canOpenURL(fullUrl);
    if (canOpen) {
      await Linking.openURL(fullUrl);
    } else {
      Alert.alert(i18n.t('error') || 'Error', i18n.t('invalidUrl') || 'Cannot open this link.');
    }
  };

  const getCityLabel = (city?: string) => {
    if (!city) return '';
    return cityLabels?.[city] || city;
  };

  const getClinicCoordinates = (target: any) => {
    const latitude = target?.coordinates?.latitude ?? target?.latitude;
    const longitude = target?.coordinates?.longitude ?? target?.longitude;
    return {
      latitude: typeof latitude === 'number' && Number.isFinite(latitude) ? latitude : null,
      longitude: typeof longitude === 'number' && Number.isFinite(longitude) ? longitude : null,
    };
  };

  const buildMapQuery = (target: any) => {
    return [target?.name, target?.address, target?.district, target?.city]
      .filter(Boolean)
      .join(', ');
  };

  const buildLocationTarget = (location?: any) => {
    if (!clinic) return null;

    const latitude = location?.latitude;
    const longitude = location?.longitude;

    return {
      ...clinic,
      city: location?.city || clinic.city,
      district: location?.district || clinic.district,
      address: location?.address || clinic.address,
      mapUrl: location?.mapUrl || clinic.mapUrl,
      latitude: typeof latitude === 'number' && Number.isFinite(latitude) ? latitude : clinic.latitude ?? null,
      longitude: typeof longitude === 'number' && Number.isFinite(longitude) ? longitude : clinic.longitude ?? null,
      coordinates:
        typeof latitude === 'number' && Number.isFinite(latitude) && typeof longitude === 'number' && Number.isFinite(longitude)
          ? { latitude, longitude }
          : clinic.coordinates || null,
    };
  };

  const buildMapsUrl = (target: any, directions = false) => {
    if (!target) return '';
    if (target.mapUrl) return target.mapUrl;

    const { latitude, longitude } = getClinicCoordinates(target);
    if (latitude !== null && longitude !== null) {
      return directions
        ? `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`
        : `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
    }

    const query = buildMapQuery(target);
    if (!query) return '';

    return directions
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  };

  const handleViewOnMap = (target: any = clinic) => {
    if (!target) return;

    const { latitude, longitude } = getClinicCoordinates(target);
    const hasCoordinates = latitude !== null && longitude !== null;
    const query = buildMapQuery(target);

    if (!hasCoordinates && !query && !target.mapUrl) {
      Alert.alert(i18n.t('error') || 'Error', i18n.t('mapNotAvailable') || 'Map location is not available yet.');
      return;
    }

    const params: Record<string, string> = {
      title: target.name || clinic?.name || '',
      address: target.address || '',
      city: target.city || '',
      district: target.district || '',
      mapUrl: target.mapUrl || '',
    };

    if (hasCoordinates) {
      params.latitude = String(latitude);
      params.longitude = String(longitude);
    }

    router.push({ pathname: '/academy-map-view', params });
  };

  const handleOpenInMaps = async (target: any = clinic) => {
    const url = buildMapsUrl(target, true);
    if (!url) {
      Alert.alert(i18n.t('error') || 'Error', i18n.t('mapNotAvailable') || 'Map location is not available yet.');
      return;
    }
    await openExternalLink(url);
  };

  const handleReserve = async () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert(i18n.t('error') || 'Error', i18n.t('loginRequired') || 'You must be logged in to book');
      return;
    }
    if (clinicSuspended) {
      Alert.alert(i18n.t('error') || 'Error', i18n.t('suspendedProviderBookingUnavailable') || 'This provider is suspended and cannot receive bookings right now.');
      return;
    }

    if (branches.length > 0 && !selectedBranch) {
      Alert.alert(i18n.t('error') || 'Error', i18n.t('selectBranch') || 'Please select a branch');
      return;
    }

    Alert.alert(
      i18n.t('keepAppOpenTitle') || 'Keep App Open',
      i18n.t('keepAppOpenBookingMessage') || 'Please keep the app open until the reservation finishes.'
    );

    const doctorName = i18n.t('noSpecificDoctor') || 'No specific doctor';
    const serviceList = clinic.services && clinic.services.length > 0 ? clinic.services : [];
    const selectedService = serviceList[selectedServiceIndex];
    const serviceName = selectedService ? selectedService.name : 'General';
    const servicePrice = selectedService ? Number(selectedService.fee) || 0 : 0;

    setBookingLoading(true);

    let playerName = user.displayName || 'Player';
    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        playerName = resolveUserDisplayName(userData, 'Player');
      }
    } catch { }

    const pendingId = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = new Date().toISOString();
    const bookingData = {
      playerId: user.uid,
      parentId: user.uid,
      playerName: playerName,
      customerName: playerName,
      providerId: clinic.id,
      providerName: clinic.name,
      type: 'clinic',
      status: 'pending',
      date: preferredTime ? getLocalDateInput(preferredTime) : getLocalDateInput(),
      time: preferredTime ? preferredTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null,
      preferredTime: preferredTime ? preferredTime.toISOString() : null,
      createdAt,
      name: clinic.name,
      city: selectedBranch?.city || clinic.city,
      ...buildBookingBranchPayload(selectedBranch),
      doctor: doctorName,
      service: serviceName,
      price: servicePrice,
      shift: selectedShift,
      comments: bookingComments.trim() || null,
      clientRequestId: pendingId,
    };

    addPendingBooking({
      id: pendingId,
      viewerRole: 'player',
      type: 'clinic',
      name: clinic.name,
      providerName: clinic.name,
      createdAt,
      date: bookingData.date,
      time: bookingData.time,
      shift: bookingData.shift,
      doctor: bookingData.doctor,
      service: bookingData.service,
      price: bookingData.price,
      city: bookingData.city,
      branchId: bookingData.branchId,
      branchName: bookingData.branchName,
      branchAddress: bookingData.branchAddress,
    });

    router.push('/player-bookings');

    void createBookingWithTransaction(bookingData, user.uid, 'Clinic booking created')
      .then(() => {
        completePendingBooking(pendingId);
      })
      .catch((error) => {
        console.error('Error creating booking:', error);
        const message = error instanceof Error ? error.message : (i18n.t('bookingFailed') || 'Failed to create booking');
        failPendingBooking(pendingId, message);
        Alert.alert(i18n.t('error') || 'Error', message);
      });
  };

  const reviewService = clinic?.services?.[selectedServiceIndex] || null;
  const reviewPrice = reviewService ? Number(reviewService.fee) || 0 : 0;

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
            <TouchableOpacity
              style={styles.reportButton}
              onPress={() => setReportModalVisible(true)}
              activeOpacity={0.85}
            >
              <Ionicons name="flag-outline" size={18} color="#dc2626" />
              <Text style={styles.reportButtonText}>{i18n.t('reportClinic') || 'Report Clinic'}</Text>
            </TouchableOpacity>
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
                  <Text style={styles.detailLabel}>{i18n.t('city') || 'City'}</Text>
                  <Text style={styles.detailValue}>{getCityLabel(clinic.city)}</Text>
                </View>
              </View>

              {clinic.district && (
                <View style={styles.detailRow}>
                  <View style={styles.detailIcon}>
                    <Ionicons name="location-outline" size={20} color="#000" />
                  </View>
                  <View style={styles.detailContent}>
                    <Text style={styles.detailLabel}>{i18n.t('district') || 'District'}</Text>
                    <Text style={styles.detailValue}>{clinic.district}</Text>
                  </View>
                </View>
              )}

              {/* Services with Individual Pricing */}
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
                  <Text style={styles.detailValue}>{clinic.address || [clinic.district, getCityLabel(clinic.city)].filter(Boolean).join(', ')}</Text>
                </View>
              </View>

              {!(Array.isArray(clinic.locations) && clinic.locations.length > 1) ? (
                <View style={styles.mapActionsRow}>
                  <TouchableOpacity style={styles.mapActionButton} onPress={handleViewOnMap}>
                    <Ionicons name="map-outline" size={18} color="#000" />
                    <Text style={styles.mapActionButtonText}>{i18n.t('viewOnMap') || 'View on map'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.mapActionButton, styles.mapActionButtonPrimary]} onPress={handleOpenInMaps}>
                    <Ionicons name="navigate-outline" size={18} color="#fff" />
                    <Text style={styles.mapActionButtonPrimaryText}>{i18n.t('openInMaps') || 'Open in Maps'}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {Array.isArray(clinic.locations) && clinic.locations.length > 1 ? (
                <View style={styles.locationsList}>
                  {clinic.locations.map((location: any, index: number) => {
                    const branchTarget = buildLocationTarget(location);
                    return (
                      <View key={`${location.label || 'location'}-${index}`} style={styles.locationItemCard}>
                        <View style={styles.locationItemTopRow}>
                          <Text style={styles.locationItemTitle}>
                            {location.label || `${i18n.t('locationLabel') || 'Location'} ${index + 1}`}
                          </Text>
                          {index === 0 ? (
                            <View style={styles.primaryBranchBadge}>
                              <Text style={styles.primaryBranchBadgeText}>{i18n.t('mainLocationLabel') || 'Main location'}</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={styles.locationItemText}>
                          {[location.address, location.district, getCityLabel(location.city)].filter(Boolean).join(', ')}
                        </Text>
                        <View style={styles.locationCardActions}>
                          <TouchableOpacity style={styles.locationCardActionButton} onPress={() => handleViewOnMap(branchTarget)}>
                            <Ionicons name="map-outline" size={16} color="#000" />
                            <Text style={styles.locationCardActionText}>{i18n.t('viewOnMap') || 'View on map'}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={[styles.locationCardActionButton, styles.locationCardActionPrimary]} onPress={() => handleOpenInMaps(branchTarget)}>
                            <Ionicons name="navigate-outline" size={16} color="#fff" />
                            <Text style={styles.locationCardActionPrimaryText}>{i18n.t('openInMaps') || 'Open in Maps'}</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : null}

              {clinic.phone ? (
                <View style={styles.detailRow}>
                  <View style={styles.detailIcon}>
                    <Ionicons name="call" size={20} color="#000" />
                  </View>
                  <View style={styles.detailContent}>
                    <Text style={styles.detailLabel}>{i18n.t('phone') || 'Phone'}</Text>
                    <Text style={styles.detailValue}>{clinic.phone}</Text>
                  </View>
                </View>
              ) : null}

              <View style={styles.detailRow}>
                <View style={styles.detailIcon}>
                  <Ionicons name="mail" size={20} color="#000" />
                </View>
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>{i18n.t('email') || 'Email'}</Text>
                  <Text style={styles.detailValue}>{clinic.email || 'N/A'}</Text>
                </View>
              </View>
              {clinic.socialUrl ? (
                <TouchableOpacity style={styles.detailRow} onPress={() => openExternalLink(clinic.socialUrl)}>
                  <View style={styles.detailIcon}>
                    <Ionicons name="link-outline" size={20} color="#000" />
                  </View>
                  <View style={styles.detailContent}>
                    <Text style={styles.detailLabel}>{i18n.t('social_url') || 'Website / Social URL'}</Text>
                    <Text style={styles.detailValue}>{clinic.socialUrl}</Text>
                  </View>
                </TouchableOpacity>
              ) : null}
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

              {branches.length > 0 && (
                <>
                  <Text style={styles.bookingLabel}>{i18n.t('selectBranch') || 'Select branch'}</Text>
                  <View style={styles.branchOptions}>
                    {branches.map((branch) => {
                      const addressLine = getBranchAddressLine(branch);
                      const isSelected = selectedBranchId === branch.id;
                      return (
                        <TouchableOpacity
                          key={branch.id}
                          style={[styles.branchOption, isSelected && styles.branchOptionSelected]}
                          onPress={() => setSelectedBranchId(branch.id)}
                          activeOpacity={0.8}
                        >
                          <Text style={[styles.branchOptionTitle, isSelected && styles.branchOptionTitleSelected]}>{branch.name}</Text>
                          {!!addressLine && <Text style={[styles.branchOptionSubtitle, isSelected && styles.branchOptionSubtitleSelected]}>{addressLine}</Text>}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
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
                date={preferredTime || minimumBookingDate}
                onConfirm={handleConfirm}
                onCancel={hideDatePicker}
                minimumDate={minimumBookingDate}
                is24Hour={false}
                isDarkModeEnabled={false}
                buttonTextColorIOS="#0f766e"
                textColor="#000"
              />

              <Text style={styles.bookingLabel}>{i18n.t('shiftPreference') || 'Shift Preference'}</Text>
              <Text style={styles.bookingHelperText}>{i18n.t('shiftPreferenceHint') || 'If your preferred date and time are not available, this helps the clinic choose the time range that suits you best.'}</Text>
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

              <View style={styles.bookingSummaryCard}>
                <Text style={styles.bookingSummaryTitle}>{i18n.t('reviewBooking') || 'Review Before Sending'}</Text>
                <Text style={styles.bookingSummaryText}>{i18n.t('clinicNameLabel') || 'Clinic'}: {clinic.name}</Text>
                {selectedBranch ? <Text style={styles.bookingSummaryText}>{i18n.t('branch') || 'Branch'}: {getBranchSummary(selectedBranch)}</Text> : null}
                <Text style={styles.bookingSummaryText}>{i18n.t('service') || 'Service'}: {reviewService?.name || (i18n.t('notSelectedYet') || 'Not selected yet')}</Text>
                <Text style={styles.bookingSummaryText}>{i18n.t('preferredDateTime') || 'Preferred Date & Time'}: {preferredTime ? preferredTime.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : (i18n.t('notSelectedYet') || 'Not selected yet')}</Text>
                <Text style={styles.bookingSummaryText}>{i18n.t('shiftPreference') || 'Shift Preference'}: {selectedShift ? (selectedShift === 'Day' ? (i18n.t('dayShift') || 'Before 3PM') : (i18n.t('nightShift') || 'After 3PM')) : (i18n.t('notSelectedYet') || 'Not selected yet')}</Text>
                <Text style={styles.bookingSummaryText}>{i18n.t('fee') || 'Fee'}: {reviewPrice ? `${reviewPrice} EGP` : '—'}</Text>
              </View>

              <TouchableOpacity
                style={[styles.reserveButton, (bookingLoading || !selectedShift || !preferredTime || clinicSuspended) && styles.reserveButtonDisabled]}
                onPress={() => handleReserve()}
                disabled={bookingLoading || !clinic.services || clinic.services.length === 0 || !selectedShift || !preferredTime || clinicSuspended}
                activeOpacity={0.8}
              >
                {bookingLoading ? (
                  <FootballLoader size="small" color="#fff" />
                ) : (
                  <Text style={styles.reserveButtonText}>{i18n.t('reserve') || 'Send Booking Request'}</Text>
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
        <ReportModal
          visible={reportModalVisible}
          onClose={() => setReportModalVisible(false)}
          targetType="clinic"
          targetId={clinic.id}
          targetLabel={clinic.name}
          snapshot={{
            reportedTargetName: clinic.name,
            reportedTargetRole: 'clinic',
          }}
        />
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
  callButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 16,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  reportButton: {
    marginTop: 12,
    marginBottom: 12,
    backgroundColor: '#fff1f2',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#fecdd3',
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  reportButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#b91c1c',
  },
  detailsCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    marginTop: 20,
    marginBottom: 16,
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
  hoursCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  doctorsCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000',
    marginLeft: 12,
  },
  hoursRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  hoursDay: {
    fontSize: 16,
    color: '#000',
    fontWeight: '500',
  },
  hoursTime: {
    fontSize: 16,
    color: '#666',
  },
  doctorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  doctorIcon: {
    marginRight: 12,
  },
  doctorName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  serviceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  serviceName: {
    fontSize: 16,
    color: '#000',
    flex: 1,
  },
  serviceFee: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000',
    marginLeft: 12,
  },
  mapActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: -4,
    marginBottom: 18,
  },
  mapActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  mapActionButtonPrimary: {
    backgroundColor: '#000',
  },
  mapActionButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000',
  },
  mapActionButtonPrimaryText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  locationsList: {
    gap: 8,
    marginTop: 12,
  },
  locationItemCard: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  locationItemTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  locationItemText: {
    fontSize: 13,
    color: '#4b5563',
    lineHeight: 18,
  },
  locationItemTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 6,
  },
  primaryBranchBadge: {
    backgroundColor: '#111827',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  primaryBranchBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  locationCardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  locationCardActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#eef2f7',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  locationCardActionPrimary: {
    backgroundColor: '#000',
  },
  locationCardActionText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '700',
  },
  locationCardActionPrimaryText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  bookingCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  suspensionNotice: {
    marginBottom: 14,
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  suspensionNoticeText: {
    color: '#b91c1c',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  bookingLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
    marginTop: 4,
  },
  bookingHelperText: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 18,
    marginTop: -2,
    marginBottom: 12,
  },
  branchOptions: {
    marginBottom: 12,
    gap: 8,
  },
  branchOption: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 14,
    backgroundColor: '#fafafa',
  },
  branchOptionSelected: {
    borderColor: '#000',
    backgroundColor: '#f3f4f6',
  },
  branchOptionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  branchOptionTitleSelected: {
    color: '#000',
  },
  branchOptionSubtitle: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: '#6b7280',
  },
  branchOptionSubtitleSelected: {
    color: '#374151',
  },
  serviceOptions: {
    marginBottom: 12,
  },
  serviceOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f5f5f5',
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
  },
  serviceOptionSelected: {
    backgroundColor: '#e0e0e0',
    borderWidth: 2,
    borderColor: '#000',
  },
  serviceOptionText: {
    fontSize: 16,
    color: '#000',
    flex: 1,
  },
  serviceOptionFee: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },
  bookingHint: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
    marginBottom: 12,
  },
  commentsInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    color: '#000',
    minHeight: 80,
    textAlignVertical: 'top',
  },
  bookingSummaryCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  bookingSummaryTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000',
    marginBottom: 8,
  },
  bookingSummaryText: {
    fontSize: 14,
    color: '#374151',
    marginBottom: 4,
    lineHeight: 19,
  },
  timePickerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecfeff',
    borderWidth: 1,
    borderColor: '#99f6e4',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  timeIcon: {
    marginRight: 10,
  },
  timeText: {
    fontSize: 16,
    color: '#115e59',
    flex: 1,
  },
  timePlaceholder: {
    color: '#0f766e',
  },
  iosDatePickerModal: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 10,
  },
  iosDatePickerHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    backgroundColor: '#f5f5f5',
  },
  iosDatePicker: {
    height: 200,
    backgroundColor: '#fff',
  },
  datePickerButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#000',
    borderRadius: 8,
  },
  datePickerButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  reserveButton: {
    backgroundColor: '#000',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  reserveButtonDisabled: {
    opacity: 0.6,
  },
  reserveButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: 'bold',
  },
});
