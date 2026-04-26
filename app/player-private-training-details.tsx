import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useRef, useState, useEffect } from 'react';
import { Alert, Animated, Easing, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, KeyboardAvoidingView } from 'react-native';
import i18n from '../locales/i18n';
import { auth, db } from '../lib/firebase';
import { resolveUserDisplayName } from '../lib/userDisplayName';
import { buildBookingBranchPayload, getBranchAddressLine, getBranchSummary, normalizeBookingBranches, resolveRecordBranch } from '../lib/bookingBranch';
import { doc, getDoc } from 'firebase/firestore';
import { createBookingWithTransaction, getLocalDateInput } from '../services/MonetizationService';
import FootballLoader from '../components/FootballLoader';
import SuspendedBadge from '../components/SuspendedBadge';
import { isSuspendedEntity } from '../lib/suspension';

export default function PlayerPrivateTrainingDetailsScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const [program, setProgram] = useState<any>(null);
  const [academy, setAcademy] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [bookingLoading, setBookingLoading] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState('');

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();

    if (params.id) {
      fetchDetails(params.id as string);
    }
  }, [fadeAnim, params.id]);

  const branches = normalizeBookingBranches(academy?.locations);
  const assignedProgramBranch = resolveRecordBranch(program, branches);
  const selectedBranch = branches.find((branch) => branch.id === selectedBranchId) || null;
  const academySuspended = isSuspendedEntity(academy);

  useEffect(() => {
    const defaultBranchId = assignedProgramBranch?.id || branches[0]?.id || '';
    setSelectedBranchId((current) => (branches.some((branch) => branch.id === current) ? current : defaultBranchId));
  }, [academy, program]);

  const fetchDetails = async (id: string) => {
    try {
      setLoading(true);
      const docRef = doc(db, 'academy_programs', id);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const progData: any = { id: docSnap.id, ...docSnap.data() };
        setProgram(progData);
        
        if (progData.academyId) {
          const [accDoc, userDoc] = await Promise.all([
            getDoc(doc(db, 'academies', progData.academyId)),
            getDoc(doc(db, 'users', progData.academyId)),
          ]);
          const userData = userDoc.exists() ? userDoc.data() : {};
          if (accDoc.exists()) {
            setAcademy({ id: accDoc.id, ...accDoc.data(), isSuspended: userData?.isSuspended === true, status: userData?.status || '' });
          }
        }
      }
    } catch (error) {
      console.error('Error fetching details:', error);
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

  if (!program || !academy) {
    return (
      <View style={styles.errorContainer}>
        <LinearGradient colors={['#000000', '#1a1a1a', '#2d2d2d']} style={styles.gradient}>
          <View style={styles.errorContent}>
            <Ionicons name="alert-circle-outline" size={64} color="#fff" />
            <Text style={styles.errorText}>{i18n.t('privateTrainingNotFound') || 'Private Training not found.'}</Text>
            <TouchableOpacity style={styles.backButtonLarge} onPress={() => router.back()}>
              <Text style={styles.backButtonText}>{i18n.t('goBack') || 'Go Back'}</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </View>
    );
  }

  const handleBookPrivateTraining = async () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert(i18n.t('error'), i18n.t('loginRequired') || 'You must be logged in to book');
      return;
    }
    if (academySuspended) {
      Alert.alert(i18n.t('error') || 'Error', i18n.t('suspendedProviderBookingUnavailable') || 'This provider is suspended and cannot receive bookings right now.');
      return;
    }

    const bookingBranch = assignedProgramBranch || selectedBranch;

    if (branches.length > 0 && !bookingBranch) {
      Alert.alert(i18n.t('error') || 'Error', i18n.t('selectBranch') || 'Please select a branch');
      return;
    }

    Alert.alert(
      i18n.t('keepAppOpenTitle') || 'Keep App Open',
      i18n.t('keepAppOpenBookingMessage') || 'Please keep the app open until the reservation finishes.'
    );

    try {
      setBookingLoading(true);

      // Fetch user name from Firestore
      let playerName = user.displayName || 'Player';
      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          playerName = resolveUserDisplayName(userData, 'Player');
        }
      } catch {}

      const providerName = academy.academyName || academy.name;

      const bookingData = {
        playerId: user.uid,
        parentId: user.uid,
        playerName: playerName,
        customerName: playerName,
        providerId: academy.id,
        providerName: providerName,
        type: 'academy',
        programId: program.id,
        status: 'pending',
        date: getLocalDateInput(),
        createdAt: new Date().toISOString(),
        name: providerName,
        city: bookingBranch?.city || academy.city,
        ...buildBookingBranchPayload(bookingBranch),
        program: program.name,
        coachName: program.coachName,
        sessionType: 'private',
        price: Number(program.fee),
        duration: program.duration,
      };

      await createBookingWithTransaction(bookingData, user.uid, 'Player private training booking created');

      Alert.alert(
        i18n.t('bookingRequestSent') || 'Booking Request Sent',
        i18n.t('privateTrainingBookingDesc') || 'Your private training booking request has been sent. You will be notified once the academy responds.',
        [{ text: i18n.t('done') || 'OK', onPress: () => router.push('/player-bookings') }]
      );
    } catch (error) {
      console.error('Private training booking error:', error);
      const message = error instanceof Error ? error.message : (i18n.t('bookingFailed') || 'Failed to send booking request. Please try again.');
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
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.headerContent}>
              <Text style={styles.headerTitle}>
                {program.type === 'private_training' && (!program.name || program.name === 'Private Training')
                  ? (i18n.t('privateTraining') || 'Private Training')
                  : program.name}
              </Text>
              <Text style={styles.headerSubtitle}>{i18n.t('privateTrainingDetails') || 'Private Training Details'}</Text>
            </View>
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Main Content Card */}
            <View style={styles.detailsCard}>
              <View style={styles.detailRow}>
                <View style={styles.detailIcon}>
                  <Ionicons name="school" size={20} color="#000" />
                </View>
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>{i18n.t('academyLabel') || 'Academy'}</Text>
                  <Text style={styles.detailValue}>{academy.academyName || academy.name}</Text>
                  {academySuspended && <SuspendedBadge tone="light" />}
                </View>
              </View>

              <View style={styles.detailRow}>
                <View style={styles.detailIcon}>
                  <Ionicons name="person" size={20} color="#000" />
                </View>
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>{i18n.t('coachName') || 'Coach Name'}</Text>
                  <Text style={styles.detailValue}>{program.coachName}</Text>
                </View>
              </View>

              {program.coachBio && (
                <View style={styles.detailRow}>
                  <View style={styles.detailIcon}>
                    <Ionicons name="document-text" size={20} color="#000" />
                  </View>
                  <View style={styles.detailContent}>
                    <Text style={styles.detailLabel}>{i18n.t('coachBio') || 'Coach Bio'}</Text>
                    <Text style={styles.detailValue}>{program.coachBio}</Text>
                  </View>
                </View>
              )}

              {program.specializations && program.specializations.length > 0 && (
                <View style={styles.detailRow}>
                  <View style={styles.detailIcon}>
                    <Ionicons name="star" size={20} color="#000" />
                  </View>
                  <View style={styles.detailContent}>
                    <Text style={styles.detailLabel}>{i18n.t('specializations') || 'Specializations'}</Text>
                    <Text style={styles.detailValue}>{program.specializations.join(', ')}</Text>
                  </View>
                </View>
              )}

              <View style={styles.detailRow}>
                <View style={styles.detailIcon}>
                  <Ionicons name="cash" size={20} color="#000" />
                </View>
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>{i18n.t('sessionFee') || 'Session Fee'}</Text>
                  <Text style={styles.detailValue}>{program.fee} EGP</Text>
                </View>
              </View>

              <View style={styles.detailRow}>
                <View style={styles.detailIcon}>
                  <Ionicons name="time" size={20} color="#000" />
                </View>
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>{i18n.t('durationLabel') || 'Duration'}</Text>
                  <Text style={styles.detailValue}>{program.duration} {i18n.t('minutesShort') || 'minutes'}</Text>
                </View>
              </View>

              {program.availability && program.availability.general && (
                <View style={styles.detailRow}>
                  <View style={styles.detailIcon}>
                    <Ionicons name="calendar" size={20} color="#000" />
                  </View>
                  <View style={styles.detailContent}>
                    <Text style={styles.detailLabel}>{i18n.t('availability') || 'Availability'}</Text>
                    <Text style={styles.detailValue}>{program.availability.general}</Text>
                  </View>
                </View>
              )}

              {assignedProgramBranch ? (
                <View style={styles.detailRow}>
                  <View style={styles.detailIcon}>
                    <Ionicons name="location-outline" size={20} color="#000" />
                  </View>
                  <View style={styles.detailContent}>
                    <Text style={styles.detailLabel}>{i18n.t('branch') || 'Branch'}</Text>
                    <Text style={styles.detailValue}>{getBranchSummary(assignedProgramBranch)}</Text>
                  </View>
                </View>
              ) : branches.length > 0 && (
                <View style={styles.branchSection}>
                  <Text style={styles.branchSectionTitle}>{i18n.t('selectBranch') || 'Select Branch'}</Text>
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
              )}
            </View>

            <TouchableOpacity
              style={[styles.reserveButton, (bookingLoading || academySuspended) && styles.reserveButtonDisabled]}
              onPress={handleBookPrivateTraining}
              activeOpacity={0.8}
              disabled={bookingLoading || academySuspended}
            >
              {bookingLoading ? (
                <FootballLoader size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="calendar-outline" size={20} color="#fff" style={styles.reserveIcon} />
                  <Text style={styles.reserveButtonText}>{i18n.t('bookSession') || 'Book Session'} - {program.fee} EGP</Text>
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
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 4, textAlign: 'center' },
  headerSubtitle: { fontSize: 14, color: 'rgba(255, 255, 255, 0.7)', textAlign: 'center' },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 40 },
  detailsCard: { backgroundColor: '#fff', borderRadius: 24, padding: 24, marginTop: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20, elevation: 10 },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 20, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  detailIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f0f0f0', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  detailContent: { flex: 1 },
  detailLabel: { fontSize: 14, fontWeight: '600', color: '#666', marginBottom: 4 },
  detailValue: { fontSize: 16, color: '#000', lineHeight: 22 },
  branchSection: { marginTop: 4, gap: 10 },
  branchSectionTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 2 },
  branchOption: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#fafafa' },
  branchOptionSelected: { borderColor: '#000', backgroundColor: '#f3f4f6' },
  branchOptionTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  branchOptionTitleSelected: { color: '#000' },
  branchOptionSubtitle: { marginTop: 4, fontSize: 13, lineHeight: 18, color: '#6b7280' },
  branchOptionSubtitleSelected: { color: '#374151' },
  reserveButton: { backgroundColor: '#000', borderRadius: 12, height: 56, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  reserveIcon: { marginRight: 8 },
  reserveButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  reserveButtonDisabled: { backgroundColor: '#666', opacity: 0.6 }
});
