import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useRef, useState, useEffect } from 'react';
import { Alert, Animated, Easing, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, ActivityIndicator, Image } from 'react-native';
import i18n from '../locales/i18n';
import { auth, db } from '../lib/firebase';
import { doc, getDoc, collection, addDoc } from 'firebase/firestore';
import { notifyProviderAndAdmins, createNotification } from '../services/NotificationService';
import { upsertBookingTransaction } from '../services/MonetizationService';

export default function ParentPrivateTrainingDetailsScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const [program, setProgram] = useState<any>(null);
  const [academy, setAcademy] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [sendingPrivateBooking, setSendingPrivateBooking] = useState(false);

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
  }, [params.id]);

  const fetchDetails = async (id: string) => {
    try {
      setLoading(true);
      const docRef = doc(db, 'academy_programs', id);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const progData = { id: docSnap.id, ...docSnap.data() };
        setProgram(progData);
        
        if (progData.academyId) {
          const accDoc = await getDoc(doc(db, 'academies', progData.academyId));
          if (accDoc.exists()) {
            setAcademy({ id: accDoc.id, ...accDoc.data() });
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
        <ActivityIndicator size="large" color="#fff" />
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

    try {
      setSendingPrivateBooking(true);

      // Fetch user name from Firestore
      let playerName = user.displayName || 'Parent';
      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          playerName = userData.name || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || playerName;
        }
      } catch (err) {}

      const providerName = academy.academyName || academy.name;

      const bookingData = {
        parentId: user.uid,
        playerName: playerName,
        customerName: playerName,
        providerId: academy.id,
        providerName: providerName,
        type: 'academy',
        programId: program.id,
        status: 'pending',
        date: new Date().toISOString().split('T')[0],
        createdAt: new Date().toISOString(),
        name: providerName,
        city: academy.city,
        program: program.name,
        coachName: program.coachName,
        sessionType: 'private',
        price: Number(program.fee),
        duration: program.duration,
      };

      const bookingRef = await addDoc(collection(db, 'bookings'), bookingData);
      await upsertBookingTransaction(bookingRef.id, bookingData, user.uid, 'Parent private training booking created');
      setSendingPrivateBooking(false);
      Alert.alert(
        i18n.t('bookingRequestSent') || 'Booking Request Sent',
        i18n.t('privateTrainingBookingDesc') || 'Your private training booking request has been sent. You will be notified once the academy responds.',
        [{ text: i18n.t('done') || 'OK', onPress: () => router.back() }]
      );

      (async () => {
        try {
          await notifyProviderAndAdmins(
            academy.id,
            'New booking request',
            `${playerName} requested private training: ${program.name}`,
            'booking',
            { bookingId: bookingRef.id },
            user.uid
          );
          await createNotification({
            userId: user.uid,
            title: 'Booking request sent',
            body: `${providerName} – ${program.name} with ${program.coachName}`,
            type: 'booking',
            data: { bookingId: bookingRef.id },
          });
        } catch (e) {
          console.warn('Notification create failed:', e);
        }
      })();
    } catch (error) {
      console.error('Private training booking error:', error);
      Alert.alert(i18n.t('error'), i18n.t('bookingFailed') || 'Failed to send booking request. Please try again.');
    } finally {
      setSendingPrivateBooking(false);
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
            </View>

            <TouchableOpacity
              style={[styles.reserveButton, sendingPrivateBooking && styles.reserveButtonDisabled]}
              onPress={handleBookPrivateTraining}
              activeOpacity={0.8}
              disabled={sendingPrivateBooking}
            >
              {sendingPrivateBooking ? (
                <ActivityIndicator size="small" color="#fff" />
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
  reserveButton: { backgroundColor: '#000', borderRadius: 12, height: 56, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  reserveIcon: { marginRight: 8 },
  reserveButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  reserveButtonDisabled: { backgroundColor: '#666', opacity: 0.6 }
});
