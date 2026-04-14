import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
  ScrollView,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import i18n from '../locales/i18n';
import { createCheckInFromScan, type CreateCheckInOptions } from '../services/CheckInService';
import { getCurrentUserRole } from '../services/UserRoleService';

// Try to import expo-camera
// Silently fallback to manual input if not available (no warnings)
let CameraView: any = null;
let useCameraPermissions: any = null;
let hasCameraModule = false;

const MANUAL_CODE_PLACEHOLDER = 'FC-XXXXXXXXXX or booking code (6-7 chars)';
const MANUAL_CODE_HINT = 'Enter FC code or short booking code (6-7 chars).';

const deriveShortBookingCode = (bookingId: string) =>
  String(bookingId || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(-7);

try {
  const expoCamera = require('expo-camera');
  if (expoCamera && expoCamera.CameraView && expoCamera.useCameraPermissions) {
    CameraView = expoCamera.CameraView;
    useCameraPermissions = expoCamera.useCameraPermissions;
    hasCameraModule = true;
  } else {
    console.warn('expo-camera module loaded but components are missing');
    hasCameraModule = false;
  }
} catch (error) {
  // Silent fallback - UI will show manual input option with installation instructions
  hasCameraModule = false;
}

// Manual input component (no camera hooks)
function ManualCheckInScreen({ onCheckIn, processing }: { onCheckIn: (code: string) => void; processing: boolean }) {
  const router = useRouter();
  const [manualCode, setManualCode] = useState('');

  const handleSubmit = () => {
    if (!manualCode.trim()) {
      Alert.alert(i18n.t('error') || 'Error', i18n.t('manualCheckInHint') || MANUAL_CODE_HINT);
      return;
    }
    onCheckIn(manualCode.trim());
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{i18n.t('checkIn') || 'Check-in'}</Text>
        <View style={{ width: 40 }} />
      </View>
      <View style={styles.manualInputContainer}>
        <Ionicons name="qr-code-outline" size={64} color="#fff" />
        <Text style={styles.manualInputTitle}>{i18n.t('enterCheckInCode') || 'Enter Check-in Code'}</Text>
        <Text style={styles.manualInputText}>
          {i18n.t('manualCheckInHint') || MANUAL_CODE_HINT}
        </Text>
        <TextInput
          style={styles.codeInput}
          placeholder={MANUAL_CODE_PLACEHOLDER}
          placeholderTextColor="#999"
          value={manualCode}
          onChangeText={setManualCode}
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!processing}
        />
        <TouchableOpacity
          style={[styles.submitButton, processing && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={processing || !manualCode.trim()}
        >
          {processing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitButtonText}>{i18n.t('checkIn') || 'Check-in'}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Camera-based scanner component (uses camera hooks)
// This component should only be rendered when useCameraPermissions is available
function CameraScannerScreen({ onCheckIn, processing }: { onCheckIn: (code: string) => void; processing: boolean }) {
  const router = useRouter();
  const [scanned, setScanned] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [useFallback, setUseFallback] = useState(false);
  const scanLockRef = useRef(false);
  const lastScanRef = useRef<{ data: string; timestamp: number }>({ data: '', timestamp: 0 });
  
  // Always call the hook - this component should only render when module is available
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => {
    // Check if camera components are valid and set ready immediately
    if (CameraView) {
      setCameraReady(true);
    } else {
      // If components aren't available, use fallback after short delay
      const timer = setTimeout(() => {
        setUseFallback(true);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  const resetScanner = () => {
    scanLockRef.current = false;
    setScanned(false);
  };

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    if (scanLockRef.current || scanned || processing) return;

    const normalizedData = String(data || '').trim();
    const now = Date.now();
    if (
      lastScanRef.current.data === normalizedData &&
      now - lastScanRef.current.timestamp < 2500
    ) {
      return;
    }

    lastScanRef.current = { data: normalizedData, timestamp: now };
    scanLockRef.current = true;
    setScanned(true);

    try {
      if (!normalizedData.startsWith('forsa_checkin:') && !normalizedData.startsWith('forsa_checkin_booking:')) {
        Alert.alert(
          i18n.t('invalidQrCode') || 'Invalid QR Code',
          i18n.t('invalidCheckInQr') || 'This QR code is not a valid check-in code.',
          [{ text: i18n.t('ok') || 'OK', onPress: resetScanner }]
        );
        return;
      }

      await onCheckIn(normalizedData);
    } catch (error: any) {
      Alert.alert(i18n.t('checkInFailed') || 'Check-in Failed', error.message || (i18n.t('checkInFailedTryAgain') || 'Failed to process check-in. Please try again.'));
      resetScanner();
    }
  };

  const handleManualSubmit = () => {
    if (!manualCode.trim()) {
      Alert.alert(i18n.t('error') || 'Error', i18n.t('manualCheckInHint') || MANUAL_CODE_HINT);
      return;
    }
    setShowManualInput(false);
    onCheckIn(manualCode.trim());
    setManualCode('');
  };

  // Check if camera components are available and ready
  const isCameraAvailable = !useFallback && cameraReady && !!CameraView;
  
  // If fallback is needed, show manual input
  if (useFallback) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{i18n.t('checkIn') || 'Check-in'}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.manualInputContainer}>
          <Ionicons name="qr-code-outline" size={64} color="#fff" />
          <Text style={styles.manualInputTitle}>{i18n.t('enterCheckInCode') || 'Enter Check-in Code'}</Text>
          <Text style={styles.manualInputText}>
            {i18n.t('cameraUnavailableManual') || 'Camera unavailable. You can still enter the check-in code manually.'}
          </Text>
          <TextInput
            style={styles.codeInput}
            placeholder={MANUAL_CODE_PLACEHOLDER}
            placeholderTextColor="#999"
            value={manualCode}
            onChangeText={setManualCode}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!processing}
          />
          <TouchableOpacity
            style={[styles.submitButton, processing && styles.submitButtonDisabled]}
            onPress={handleManualSubmit}
            disabled={processing || !manualCode.trim()}
          >
            {processing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>{i18n.t('checkIn') || 'Check-in'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // If camera components aren't available, show manual input
  if (!isCameraAvailable) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{i18n.t('checkIn') || 'Check-in'}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.manualInputContainer}>
          <Ionicons name="qr-code-outline" size={64} color="#fff" />
          <Text style={styles.manualInputTitle}>{i18n.t('enterCheckInCode') || 'Enter Check-in Code'}</Text>
          <Text style={styles.manualInputText}>
            {i18n.t('cameraUnavailableManual') || 'Camera unavailable. You can still enter the check-in code manually.'}
          </Text>
          <TextInput
            style={styles.codeInput}
            placeholder={MANUAL_CODE_PLACEHOLDER}
            placeholderTextColor="#999"
            value={manualCode}
            onChangeText={setManualCode}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!processing}
          />
          <TouchableOpacity
            style={[styles.submitButton, processing && styles.submitButtonDisabled]}
            onPress={handleManualSubmit}
            disabled={processing || !manualCode.trim()}
          >
            {processing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>{i18n.t('checkIn') || 'Check-in'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (permission === null) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{i18n.t('scanCheckIn') || 'Scan Check-in'}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.loadingText}>{i18n.t('checkingPermissions') || 'Checking permissions...'}</Text>
        </View>
      </View>
    );
  }

  if (!permission.granted) {
    const canAskAgain = permission.canAskAgain !== false;

    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{i18n.t('scanCheckIn') || 'Scan Check-in'}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.permissionContainer}>
          <Ionicons name="camera-outline" size={64} color="#fff" />
          <Text style={styles.permissionTitle}>{i18n.t('cameraAccessNeeded') || 'Camera access needed'}</Text>
          <Text style={styles.permissionText}>
            {i18n.t('cameraCheckInHelp') || 'Allow camera access to scan QR codes for check-ins, or enter the code manually below.'}
          </Text>
          <TouchableOpacity
            style={styles.permissionButton}
            onPress={async () => {
              if (canAskAgain && requestPermission) {
                await requestPermission();
                return;
              }

              await Linking.openSettings();
            }}
          >
            <Text style={styles.permissionButtonText}>
              {canAskAgain ? (i18n.t('allowCameraAccess') || 'Allow Camera Access') : (i18n.t('openSettings') || 'Open Settings')}
            </Text>
          </TouchableOpacity>
          <View style={styles.manualFallback}>
            <Text style={styles.manualFallbackText}>{i18n.t('enterCodeManually') || 'Enter Code Manually'}:</Text>
            <TextInput
              style={styles.codeInputSmall}
              placeholder={MANUAL_CODE_PLACEHOLDER}
              placeholderTextColor="#999"
              value={manualCode}
              onChangeText={setManualCode}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!processing}
            />
            <TouchableOpacity
              style={[styles.submitButtonSmall, (processing || !manualCode.trim()) && styles.submitButtonDisabled]}
              onPress={() => {
                if (!manualCode.trim()) {
                  Alert.alert(i18n.t('error') || 'Error', i18n.t('manualCheckInHint') || MANUAL_CODE_HINT);
                  return;
                }
                setShowManualInput(false);
                onCheckIn(manualCode.trim());
                setManualCode('');
              }}
              disabled={processing || !manualCode.trim()}
            >
              {processing ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.submitButtonTextSmall}>{i18n.t('checkIn') || 'Check-in'}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{i18n.t('scanCheckIn') || 'Scan Check-in'}</Text>
        <View style={{ width: 40 }} />
      </View>

      {isCameraAvailable && permission?.granted ? (
        <CameraView
          style={styles.camera}
          facing="back"
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
          barcodeScannerSettings={{
            barcodeTypes: ['qr'],
          }}
        >
          <View style={styles.overlay}>
            <View style={styles.scanArea}>
              <View style={styles.corner} />
              <View style={[styles.corner, styles.topRight]} />
              <View style={[styles.corner, styles.bottomLeft]} />
              <View style={[styles.corner, styles.bottomRight]} />
            </View>
            <Text style={styles.instructionText}>
              {i18n.t('positionQrWithinFrame') || 'Position the QR code within the frame'}
            </Text>
          </View>
        </CameraView>
      ) : (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.loadingText}>
            {!permission?.granted ? (i18n.t('cameraWaiting') || 'Waiting for camera access...') : (i18n.t('cameraUnavailableManual') || 'Camera unavailable. You can still enter the check-in code manually.')}
          </Text>
          <TouchableOpacity
            style={styles.fallbackButton}
            onPress={() => setShowManualInput(true)}
          >
            <Text style={styles.fallbackButtonText}>{i18n.t('enterCodeManually') || 'Enter Code Manually'}</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity
        style={styles.manualInputButton}
        onPress={() => setShowManualInput(true)}
      >
        <Ionicons name="keypad-outline" size={20} color="#fff" />
        <Text style={styles.manualInputButtonText}>{i18n.t('enterCodeManually') || 'Enter Code Manually'}</Text>
      </TouchableOpacity>

      {scanned && !processing && (
        <TouchableOpacity style={styles.scanOnceButton} onPress={resetScanner}>
          <Ionicons name="scan" size={20} color="#fff" />
          <Text style={styles.scanOnceButtonText}>{i18n.t('scanAgain') || 'Scan Next QR'}</Text>
        </TouchableOpacity>
      )}

      {/* Manual Input Modal */}
      <Modal
        visible={showManualInput}
        transparent
        animationType="slide"
        onRequestClose={() => setShowManualInput(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{i18n.t('enterCheckInCode') || 'Enter Check-in Code'}</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowManualInput(false);
                  setManualCode('');
                }}
                style={styles.modalCloseButton}
              >
                <Ionicons name="close" size={24} color="#000" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>
              {i18n.t('manualCheckInHint') || MANUAL_CODE_HINT}
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder={MANUAL_CODE_PLACEHOLDER}
              placeholderTextColor="#999"
              value={manualCode}
              onChangeText={setManualCode}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!processing}
              autoFocus
            />
            <TouchableOpacity
              style={[styles.modalSubmitButton, (processing || !manualCode.trim()) && styles.submitButtonDisabled]}
              onPress={handleManualSubmit}
              disabled={processing || !manualCode.trim()}
            >
              {processing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.modalSubmitButtonText}>{i18n.t('checkIn') || 'Check-in'}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

type ProviderService = { name: string; price: number };

export default function ScanCheckInScreen() {
  const router = useRouter();
  const [processing, setProcessing] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [walkInModalVisible, setWalkInModalVisible] = useState(false);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [pendingBookingId, setPendingBookingId] = useState<string | null>(null);
  const [walkInCustomerType, setWalkInCustomerType] = useState('walk_in');
  const [providerServices, setProviderServices] = useState<ProviderService[]>([]);
  const [adminCommissionRate, setAdminCommissionRate] = useState(15);
  const [selectedService, setSelectedService] = useState<ProviderService | null>(null);
  const [servicesLoading, setServicesLoading] = useState(false);

  useEffect(() => {
    checkUserRole();
  }, []);

  const loadProviderServicesAndCommission = async (role: string) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setServicesLoading(true);
    try {
      const services: ProviderService[] = [];

      if (role === 'clinic') {
        const clinicSnap = await getDoc(doc(db, 'clinics', uid));
        if (clinicSnap.exists()) {
          const data = clinicSnap.data();
          // Predefined clinic services
          if (data.services) {
            Object.entries(data.services).forEach(([key, val]: [string, any]) => {
              if (val?.selected && val?.fee) {
                services.push({ name: key.replace(/_/g, ' '), price: parseFloat(val.fee) || 0 });
              }
            });
          }
          // Custom clinic services
          if (Array.isArray(data.customServices)) {
            data.customServices.forEach((s: any) => {
              if (s?.name && s?.price) {
                services.push({ name: s.name, price: parseFloat(s.price) || 0 });
              }
            });
          }
        }
      } else if (role === 'academy') {
        // Age-group pricing from users/{uid}.fees or .prices
        const userSnap = await getDoc(doc(db, 'users', uid));
        if (userSnap.exists()) {
          const data = userSnap.data();
          const fees: Record<string, any> = data.fees || data.prices || {};
          Object.entries(fees).forEach(([age, price]) => {
            const p = parseFloat(String(price)) || 0;
            if (p > 0) services.push({ name: `U${age} Training`, price: p });
          });
        }
        // Private training programs
        const programsSnap = await getDocs(
          query(collection(db, 'academy_programs'), where('academyId', '==', uid), where('isActive', '==', true))
        );
        programsSnap.docs.forEach((d) => {
          const pd = d.data();
          if (pd.fee > 0) {
            services.push({ name: pd.name || `Private Training (${pd.coachName || ''})`, price: pd.fee });
          }
        });
      }

      setProviderServices(services);

      // Load admin commission rate
      const settingsSnap = await getDoc(doc(db, 'settings', 'admin'));
      if (settingsSnap.exists()) {
        const raw = settingsSnap.data();
        const rate =
          raw?.checkInCommission?.value ??
          raw?.bookingCommission?.value ??
          raw?.commissionRate ??
          15;
        setAdminCommissionRate(Number(rate) || 15);
      }
    } catch (err) {
      console.warn('Failed to load provider services:', err);
    } finally {
      setServicesLoading(false);
    }
  };

  const checkUserRole = async () => {
    try {
      const role = await getCurrentUserRole();
      setUserRole(role);
      
      if (role !== 'academy' && role !== 'clinic') {
        Alert.alert(
          i18n.t('accessDenied') || 'Access Denied',
          i18n.t('onlyAcademyClinicCanScan') || 'Only academy and clinic staff can scan check-in codes.',
          [{ text: i18n.t('ok') || 'OK', onPress: () => router.back() }]
        );
      } else {
        loadProviderServicesAndCommission(role);
      }
    } catch (error) {
      console.error('Error checking user role:', error);
      Alert.alert(i18n.t('error') || 'Error', i18n.t('failedVerifyPermissions') || 'Failed to verify permissions');
      router.back();
    }
  };

  const parseScannedPayload = (value: string) => {
    const trimmed = value.trim();

    if (trimmed.startsWith('forsa_checkin_booking:')) {
      const pieces = trimmed.split(':');
      const bookingId = pieces[1] || '';
      const bookingCode = pieces.slice(2).join(':');
      return { cleanCode: bookingCode, bookingId: bookingId || null };
    }

    if (trimmed.startsWith('forsa_checkin:')) {
      return { cleanCode: trimmed.replace('forsa_checkin:', ''), bookingId: null };
    }

    return { cleanCode: trimmed, bookingId: null };
  };

  const resolveShortBookingManualCode = async (typedCode: string) => {
    const staffId = auth.currentUser?.uid;
    if (!staffId) return null;

    const normalized = typedCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (!/^[A-Z0-9]{6,7}$/.test(normalized)) {
      return null;
    }

    const bookingsSnap = await getDocs(query(collection(db, 'bookings'), where('providerId', '==', staffId)));
    const candidates = bookingsSnap.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as any))
      .filter((booking) => {
        const status = String(booking.status || '').toLowerCase();
        const allowed = ['pending', 'confirmed', 'new_time_proposed', 'timing_proposed', 'player_accepted'];
        const notCheckedIn = !booking.checkedInAt && !booking.lastCheckInId && String(booking.attendanceStatus || '').toLowerCase() !== 'checked_in';
        return allowed.includes(status) && notCheckedIn;
      })
      .sort((a, b) => {
        const aTime = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
        const bTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
        return bTime - aTime;
      });

    const matchedBooking = candidates.find((booking) => deriveShortBookingCode(booking.id) === normalized);
    if (!matchedBooking) {
      throw new Error('Invalid booking manual code. Please verify the 6-7 character code.');
    }

    const customerId = matchedBooking.playerId || matchedBooking.parentId || matchedBooking.userId || matchedBooking.academyId;
    if (!customerId) {
      throw new Error('Booking is missing customer info.');
    }

    const customerSnap = await getDoc(doc(db, 'users', customerId));
    if (!customerSnap.exists()) {
      throw new Error('Customer not found for this booking.');
    }

    const customerCode = String((customerSnap.data() as any)?.checkInCode || '').trim();
    if (!customerCode || !customerCode.startsWith('FC-')) {
      throw new Error('Customer check-in code is missing for this booking.');
    }

    return {
      linkedBookingId: matchedBooking.id,
      cleanCode: customerCode,
    };
  };

  const processCheckInCode = async (code: string, options?: CreateCheckInOptions) => {
    if (processing) return;

    const parsed = parseScannedPayload(code);
    let cleanCode = parsed.cleanCode;
    let linkedBookingId = options?.linkedBookingId || parsed.bookingId || null;

    if (!linkedBookingId && !cleanCode.startsWith('FC-')) {
      const resolved = await resolveShortBookingManualCode(String(code || ''));
      if (resolved) {
        cleanCode = resolved.cleanCode;
        linkedBookingId = resolved.linkedBookingId;
      }
    }

    // Personal code scan (no bookingId embedded in QR): always go straight to the
    // walk-in service modal. The academy/clinic must clarify what service was provided.
    // Do NOT attempt to auto-link a booking — personal codes are reusable across visits.
    if (!linkedBookingId && !options?.walkInService) {
      setPendingCode(cleanCode);
      setPendingBookingId(null);
      setWalkInModalVisible(true);
      return;
    }
  
    setProcessing(true);

    try {
      if (!cleanCode || cleanCode.length < 5 || !cleanCode.startsWith('FC-')) {
        throw new Error(i18n.t('invalidCheckInFormat') || 'Invalid check-in code format. Use a code that starts with "FC-".');
      }

      const nextOptions: CreateCheckInOptions = {
        ...(options || {}),
        linkedBookingId,
      };

      const checkIn = await createCheckInFromScan(cleanCode, nextOptions);
      const userName = checkIn.userName || 'User';
      const isBookingScan = Boolean(linkedBookingId);

      Alert.alert(
        isBookingScan
          ? (i18n.t('bookingCompletedTitle') || 'Booking Completed')
          : (i18n.t('checkInSuccessful') || 'Check-in Successful'),
        isBookingScan
          ? (i18n.t('bookingCompletedMessage', { name: userName }) || `${userName}'s booking is completed and locked.`)
          : (i18n.t('checkInSuccessMessage', { name: userName }) || `${userName} has been checked in successfully.`),
        [
          {
            text: i18n.t('ok') || 'OK',
            onPress: () => {
              setProcessing(false);
            },
          },
        ]
      );
    } catch (error: any) {
      if (error?.code === 'service-details-required') {
        const parsed = parseScannedPayload(code);
        setPendingCode(parsed.cleanCode);
        setPendingBookingId(parsed.bookingId || null);
        setWalkInModalVisible(true);
        setProcessing(false);
        return;
      }

      console.error('Error processing check-in:', error);
      Alert.alert(
        i18n.t('checkInFailed') || 'Check-in Failed',
        error.message || (i18n.t('checkInFailedTryAgain') || 'Failed to process check-in. Please try again.'),
        [
          {
            text: i18n.t('ok') || 'OK',
            onPress: () => {
              setProcessing(false);
            },
          },
        ]
      );
    }
  };

  const submitWalkInService = async () => {
    if (!pendingCode) return;

    if (!selectedService) {
      Alert.alert('Select a Service', 'Please choose the service that was provided.');
      return;
    }

    setWalkInModalVisible(false);
    await processCheckInCode(pendingCode, {
      linkedBookingId: pendingBookingId,
      walkInService: {
        serviceName: selectedService.name,
        grossAmount: selectedService.price,
        commissionPercentage: adminCommissionRate,
      },
      walkInCustomerType: walkInCustomerType.trim() || 'walk_in',
    });

    setPendingCode(null);
    setPendingBookingId(null);
    setSelectedService(null);
    setWalkInCustomerType('walk_in');
  };

  if (userRole && userRole !== 'academy' && userRole !== 'clinic') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{i18n.t('scanCheckIn') || 'Scan Check-in'}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.errorContainer}>
          <Ionicons name="lock-closed-outline" size={64} color="#fff" />
          <Text style={styles.errorText}>{i18n.t('accessDenied') || 'Access Denied'}</Text>
          <Text style={styles.errorSubtext}>
            {i18n.t('onlyAcademyClinicCanScan') || 'Only academy and clinic staff can scan check-in codes.'}
          </Text>
        </View>
      </View>
    );
  }

  // Show manual input if camera module is not available, otherwise show camera scanner
  // Check if all required camera components are available
  const canUseCamera = hasCameraModule && !!CameraView && !!useCameraPermissions;
  
  if (!canUseCamera) {
    return <ManualCheckInScreen onCheckIn={processCheckInCode} processing={processing} />;
  }

  return (
    <>
      <CameraScannerScreen onCheckIn={processCheckInCode} processing={processing} />

      <Modal
        transparent
        visible={walkInModalVisible}
        animationType="slide"
        onRequestClose={() => setWalkInModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Service Details Required</Text>
            <Text style={styles.modalSubtitle}>
              Select the service provided. Commission ({adminCommissionRate}%) is applied automatically.
            </Text>

            {servicesLoading ? (
              <ActivityIndicator color="#007AFF" style={{ marginVertical: 16 }} />
            ) : providerServices.length === 0 ? (
              <Text style={{ color: '#999', textAlign: 'center', marginVertical: 12 }}>
                No services found. Please add services to your profile first.
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
                {providerServices.map((svc, idx) => {
                  const isSelected = selectedService?.name === svc.name;
                  return (
                    <TouchableOpacity
                      key={idx}
                      style={[
                        styles.servicePickerRow,
                        isSelected && styles.servicePickerRowSelected,
                      ]}
                      onPress={() => setSelectedService(svc)}
                    >
                      <Text style={[styles.servicePickerName, isSelected && { color: '#fff' }]}>
                        {svc.name}
                      </Text>
                      <Text style={[styles.servicePickerPrice, isSelected && { color: '#cef' }]}>
                        {svc.price} EGP
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            <TextInput
              style={[styles.modalInput, { marginTop: 12 }]}
              placeholder="Customer type (walk_in / parent / player)"
              placeholderTextColor="#999"
              value={walkInCustomerType}
              onChangeText={setWalkInCustomerType}
              autoCapitalize="none"
            />

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
              <TouchableOpacity
                style={[styles.modalSubmitButton, { backgroundColor: '#64748b', flex: 1 }]}
                onPress={() => {
                  setWalkInModalVisible(false);
                  setPendingCode(null);
                  setPendingBookingId(null);
                }}
              >
                <Text style={styles.modalSubmitButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSubmitButton, { flex: 1 }]}
                onPress={submitWalkInService}
              >
                <Text style={styles.modalSubmitButtonText}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {processing && (
        <Modal transparent visible={processing} animationType="fade">
          <View style={styles.processingOverlay}>
            <View style={styles.processingBox}>
              <ActivityIndicator size="large" color="#007AFF" />
              <Text style={styles.processingText}>{i18n.t('processingCheckIn') || 'Processing check-in...'}</Text>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 50,
    paddingBottom: 16,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#fff',
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 20,
    marginBottom: 12,
  },
  permissionText: {
    fontSize: 16,
    color: '#ccc',
    textAlign: 'center',
    marginBottom: 32,
  },
  permissionButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  errorText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 20,
    marginBottom: 12,
  },
  errorSubtext: {
    fontSize: 16,
    color: '#ccc',
    textAlign: 'center',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanArea: {
    width: 250,
    height: 250,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: '#007AFF',
    borderWidth: 4,
    top: 0,
    left: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  topRight: {
    top: 0,
    right: 0,
    left: 'auto',
    borderLeftWidth: 0,
    borderRightWidth: 4,
    borderBottomWidth: 0,
    borderTopWidth: 4,
  },
  bottomLeft: {
    top: 'auto',
    bottom: 0,
    left: 0,
    borderTopWidth: 0,
    borderBottomWidth: 4,
    borderRightWidth: 0,
  },
  bottomRight: {
    top: 'auto',
    bottom: 0,
    right: 0,
    left: 'auto',
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
  },
  instructionText: {
    marginTop: 40,
    fontSize: 16,
    color: '#fff',
    textAlign: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  processingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  processingBox: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    minWidth: 200,
  },
  processingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#333',
  },
  manualInputContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  manualInputTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 20,
    marginBottom: 12,
  },
  manualInputText: {
    fontSize: 16,
    color: '#ccc',
    textAlign: 'center',
    marginBottom: 32,
  },
  codeInput: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    fontSize: 18,
    color: '#000',
    textAlign: 'center',
    fontFamily: 'monospace',
    letterSpacing: 1,
    marginBottom: 20,
  },
  codeInputSmall: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#000',
    textAlign: 'center',
    fontFamily: 'monospace',
    marginBottom: 12,
  },
  submitButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  submitButtonSmall: {
    backgroundColor: '#007AFF',
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: '#666',
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  submitButtonTextSmall: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  installNote: {
    marginTop: 24,
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
  },
  manualFallback: {
    marginTop: 32,
    width: '100%',
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.2)',
  },
  manualFallbackText: {
    fontSize: 14,
    color: '#ccc',
    marginBottom: 12,
    textAlign: 'center',
  },
  manualInputButton: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 122, 255, 0.9)',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    gap: 8,
  },
  manualInputButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  scanOnceButton: {
    position: 'absolute',
    bottom: 95,
    left: 20,
    right: 20,
    backgroundColor: '#16a34a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  scanOnceButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  fallbackButton: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: 'rgba(0, 122, 255, 0.8)',
    borderRadius: 8,
  },
  fallbackButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000',
  },
  modalCloseButton: {
    padding: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
  },
  modalInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 16,
    fontSize: 18,
    color: '#000',
    textAlign: 'center',
    fontFamily: 'monospace',
    letterSpacing: 1,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  modalSubmitButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  modalSubmitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  servicePickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d0d0d0',
    marginBottom: 6,
    backgroundColor: '#f9f9f9',
  },
  servicePickerRowSelected: {
    backgroundColor: '#007AFF',
    borderColor: '#005BB5',
  },
  servicePickerName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#222',
    flex: 1,
  },
  servicePickerPrice: {
    fontSize: 14,
    color: '#555',
    marginLeft: 8,
  },
});
