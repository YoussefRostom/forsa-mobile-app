import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { uploadMedia } from '../services/MediaService';
import { auth, db } from '../lib/firebase';
import { buildPersonDisplayName } from '../lib/userDisplayName';
import { writeEmailIndex, lookupEmailIndex } from '../lib/emailIndex';
import { lookupPhoneIndex, writePhoneIndex } from '../lib/phoneIndex';
import {
  getPhoneIdentityCandidates,
  formatEgyptPhoneFromLocalInput,
  getEgyptPhoneLocalPart,
  validateCity,
  validateEmail,
  validateName,
  validatePassword,
  validatePhone,
  validateRequired,
  normalizePhoneForAuth,
  normalizePhoneForTwilio,
} from '../lib/validations';
import i18n from '../locales/i18n';
import FootballLoader from '../components/FootballLoader';
import { notifyAdminsOfNewSignup } from '../services/SignupNotificationService';
// OTP functionality commented out - direct Firebase signup enabled
// import OtpModal from '../components/OtpModal';
// import { getBackendUrl } from '../lib/config';

const POSITIONS = [
  'GK', 'LB', 'CB', 'RB', 'CDM', 'CM', 'CAM', 'RW', 'LW', 'ST'
];

interface Errors {
  firstName?: string;
  lastName?: string;
  dob?: string;
  position?: string;
  email?: string;
  phone?: string;
  password?: string;
  profilePhoto?: string;
  nationalIdPhoto?: string;
  city?: string;
}



const SignupPlayer = () => {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [position, setPosition] = useState('');
  const [altPositions, setAltPositions] = useState<string[]>([]);
  const [highlightVideo, setHighlightVideo] = useState('');
  const [preferredFoot] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [city, setCity] = useState('');
  const [showCityModal, setShowCityModal] = useState(false);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [nationalIdPhoto, setNationalIdPhoto] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [missing, setMissing] = useState<{ [key: string]: boolean }>({});
  const [focusedField, setFocusedField] = useState<string | null>(null);
  // OTP functionality commented out - direct Firebase signup enabled
  // const [showOtpModal, setShowOtpModal] = useState(false);
  // const [otpPhone, setOtpPhone] = useState('');  // normalized E.164 phone

  // Animation for transitions
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scrollViewRef = useRef<ScrollView | null>(null);
  const fieldLayouts = useRef<Record<string, number>>({});
  const cityLabels = useMemo(
    () => (i18n.t('cities', { returnObjects: true }) as Record<string, string>) || {},
    []
  );
  const cityEntries = useMemo(() => Object.entries(cityLabels), [cityLabels]);

  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  // Format date for display
  const formatDate = (date: Date | null): string => {
    if (!date) return '';
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  // Format date for database (YYYY-MM-DD)
  const formatDateForDB = (date: Date | null): string => {
    if (!date) return '';
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${year}-${month}-${day}`;
  };

  // Real-time validation
  const validateField = (field: string, value: any) => {
    let error: string | null = null;

    switch (field) {
      case 'firstName':
        error = validateName(value, 'First name');
        break;
      case 'lastName':
        error = validateName(value, 'Last name');
        break;
      case 'email':
        // Email is now optional - only validate if provided
        if (value && value.trim().length > 0) {
          error = validateEmail(value);
        }
        break;
      case 'phone':
        // Phone is now required
        error = validatePhone(value);
        break;
      case 'password':
        error = validatePassword(value);
        break;
      case 'city':
        error = validateCity(value);
        break;
      case 'dob':
        if (!dob) {
          error = String(i18n.t('validationDobRequired'));
        } else {
          const today = new Date();
          const age = today.getFullYear() - dob.getFullYear();
          if (age < 5 || age > 100) {
            error = String(i18n.t('validationValidDob'));
          }
        }
        break;
      case 'position':
        error = validateRequired(value, 'Position');
        break;
      case 'profilePhoto':
        // Profile photo is optional
        break;
      case 'nationalIdPhoto':
        // National ID photo is optional
        break;
    }

    if (error) {
      setErrors(prev => ({ ...prev, [field]: error }));
      setMissing(prev => ({ ...prev, [field]: true }));
    } else {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field as keyof Errors];
        return newErrors;
      });
      setMissing(prev => {
        const newMissing = { ...prev };
        delete newMissing[field];
        return newMissing;
      });
    }
    return error === null;
  };

  const registerFieldLayout = (field: keyof Errors, y: number) => {
    fieldLayouts.current[field] = y;
  };

  const scrollToField = (field: keyof Errors) => {
    const y = fieldLayouts.current[field];
    scrollViewRef.current?.scrollTo({
      y: typeof y === 'number' ? Math.max(0, y - 120) : 0,
      animated: true,
    });
  };

  const validate = () => {
    const newErrors: Errors = {};
    const newMissing: { [key: string]: boolean } = {};

    const firstNameError = validateName(firstName, 'First name');
    if (firstNameError) {
      newErrors.firstName = firstNameError;
      newMissing.firstName = true;
    }

    const lastNameError = validateName(lastName, 'Last name');
    if (lastNameError) {
      newErrors.lastName = lastNameError;
      newMissing.lastName = true;
    }

    if (!dob) {
      newErrors.dob = String(i18n.t('validationDobRequired'));
      newMissing.dob = true;
    } else {
      const today = new Date();
      const age = today.getFullYear() - dob.getFullYear();
      if (age < 5 || age > 100) {
        newErrors.dob = String(i18n.t('validationValidDob'));
        newMissing.dob = true;
      }
    }

    const positionError = validateRequired(position, 'Position');
    if (positionError) {
      newErrors.position = positionError;
      newMissing.position = true;
    }

    // Email is optional - only validate if provided
    if (email && email.trim().length > 0) {
      const emailError = validateEmail(email);
      if (emailError) {
        newErrors.email = emailError;
        newMissing.email = true;
      }
    }

    // Phone is now required
    const phoneError = validatePhone(phone);
    if (phoneError) {
      newErrors.phone = phoneError;
      newMissing.phone = true;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      newErrors.password = passwordError;
      newMissing.password = true;
    }

    const cityError = validateCity(city);
    if (cityError) {
      newErrors.city = cityError;
      newMissing.city = true;
    }

    // Profile photo is optional
    // National ID photo is optional

    setErrors(newErrors);
    setMissing(newMissing);

    const hasErrors = Object.keys(newErrors).length > 0;
    if (hasErrors) {
      const fieldOrder: (keyof Errors)[] = ['firstName', 'lastName', 'dob', 'position', 'city', 'phone', 'email', 'password'];
      const firstInvalidField = fieldOrder.find((field) => Boolean(newErrors[field]));
      if (firstInvalidField) {
        requestAnimationFrame(() => scrollToField(firstInvalidField));
      }
    }

    return !hasErrors;
  };


  // OTP functionality commented out - direct Firebase signup enabled
  // const handleSignup = async () => {
  //   ... OTP code commented out ...
  // };

  /** Direct Firebase signup - OTP functionality commented out */
  const handleSignup = async () => {
    if (!validate()) {
      Alert.alert(i18n.t('missingFields'), i18n.t('fillAllRequiredFields'));
      return;
    }

    try {
      setLoading(true);
      setFormError('');

      // Step 1: Create Firebase Auth user directly (no OTP)
      const normalizedPhone = normalizePhoneForTwilio(phone);
      const phoneForAuth = normalizePhoneForAuth(normalizedPhone);
      const authEmail = `user_${phoneForAuth}@forsa.app`;

      // Prevent duplicates across legacy/raw and canonical phone identities
      const phoneCandidates = getPhoneIdentityCandidates(phone);
      for (const candidate of phoneCandidates) {
        const existingAuth = await lookupPhoneIndex(candidate);
        if (existingAuth) {
          throw { code: 'forsa/phone-already-in-use' };
        }
      }

      // Pre-check: if email provided, ensure it is not already taken
      if (email && email.trim().length > 0) {
        const existingAuth = await lookupEmailIndex(email.trim());
        if (existingAuth) {
          throw { code: 'forsa/email-already-in-use' };
        }
      }

      // console.log('[Signup] Creating Firebase user with email:', authEmail);
      const userCredential = await createUserWithEmailAndPassword(auth, authEmail, password);
      const user = userCredential.user;
      const uid = user.uid;
      // console.log('[Signup] Firebase user created! UID:', uid);

      // Step 2: Upload images to Cloudinary
      const dobString = formatDateForDB(dob);
      let profilePhotoUrl = '';
      let nationalIdPhotoUrl = '';
      if (profilePhoto) {
        // console.log('[Signup] Uploading profile photo to Cloudinary...');
        try {
          const cloudinaryResponse = await uploadMedia(profilePhoto, 'image');
          profilePhotoUrl = cloudinaryResponse.secure_url;
        } catch (error: any) {
          console.error('Error uploading profile photo:', error);
          throw new Error('Failed to upload profile photo. Please try again.');
        }
      }
      if (nationalIdPhoto) {
        // console.log('[Signup] Uploading national ID photo to Cloudinary...');
        try {
          const cloudinaryResponse = await uploadMedia(nationalIdPhoto, 'image');
          nationalIdPhotoUrl = cloudinaryResponse.secure_url;
        } catch (error: any) {
          console.error('Error uploading national ID photo:', error);
          // Don't throw here, national ID photo is optional
        }
      }

      // Step 3: Save extended player profile to Firestore
      const userData = {
        uid,
        role: 'player',
        status: 'active',
        isSuspended: false,
        username: buildPersonDisplayName(firstName, lastName),
        email: email && email.trim().length > 0 ? email.trim() : null,
        phone,
        firstName,
        lastName,
        dob: dobString,
        preferredFoot,
        position,
        altPositions,
        city,
        profilePhoto: profilePhotoUrl,
        nationalIdPhoto: nationalIdPhotoUrl,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      // console.log('[Signup] Saving to Firestore...');
      await setDoc(doc(db, 'users', uid), userData, { merge: true });
      await setDoc(doc(db, 'players', uid), { ...userData, highlightVideo: highlightVideo || '' });

      // Save email → authEmail mapping for email-based login
      if (email && email.trim().length > 0) {
        await writeEmailIndex(email.trim(), authEmail);
      }
      await writePhoneIndex(phoneForAuth, authEmail);

      try {
        await notifyAdminsOfNewSignup({
          signupUserId: uid,
          role: 'player',
          userData,
        });
      } catch (error) {
        console.warn('[SignupPlayer] Failed to notify admins about new signup:', error);
      }

      // console.log('[Signup] Firestore saved! User is logged in and navigating to player-feed...');

      // Step 4: Generate check-in code (non-blocking)
      try {
        const { ensureCheckInCodeForCurrentUser } = await import('../services/CheckInCodeService');
        await ensureCheckInCodeForCurrentUser();
      } catch { }

      // Step 5: User is already signed in via createUserWithEmailAndPassword, redirect to dashboard
      router.replace('/player-feed');
    } catch (err: any) {
      // console.log('[Signup] Error in handleSignup:', err.message, err);
      let errorMsg = i18n.t('signupFailedMessage');
      if (err.code === 'auth/email-already-in-use') {
        errorMsg = i18n.t('phoneAlreadyRegistered') || 'This phone number is already registered';
      } else if (err.code === 'forsa/phone-already-in-use') {
        errorMsg = i18n.t('phoneAlreadyRegistered') || 'This phone number is already registered';
      } else if (err.code === 'forsa/email-already-in-use') {
        errorMsg = i18n.t('emailAlreadyRegistered') || 'This email is already registered';
      } else if (err.code === 'auth/weak-password') {
        errorMsg = i18n.t('weakPassword') || 'Password is too weak';
      } else if (err.message) {
        errorMsg = err.message;
      }
      setFormError(errorMsg);
      Alert.alert(i18n.t('signupFailed'), errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // OTP functionality commented out - direct Firebase signup enabled
  // /** Called by OtpModal after OTP is successfully verified and Firebase user is created by backend */
  // const handleOtpVerified = async (uid: string, token: string, refreshToken: string) => {
  //   ... commented out ...
  // };



  const handleBack = () => {
    if (router.canGoBack?.()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  const onDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (selectedDate) {
      setDob(selectedDate);
      validateField('dob', selectedDate);
    }
  };

  // Image picker for profile photo
  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      setProfilePhoto(result.assets[0].uri);
    }
  };

  // Image picker for national ID photo
  const pickNationalIdPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.7,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      setNationalIdPhoto(result.assets[0].uri);
    }
  };

  // Toggle alternate positions
  const handleAltPositionToggle = (pos: string) => {
    setAltPositions(prev =>
      prev.includes(pos) ? prev.filter(p => p !== pos) : [...prev, pos]
    );
  };

  const requiredSteps = [
    Boolean(firstName.trim() && lastName.trim()),
    Boolean(dob),
    Boolean(position),
    Boolean(city),
    Boolean(phone.trim()) && !errors.phone,
    Boolean(password.trim()) && !errors.password,
  ];
  const completedRequiredCount = requiredSteps.filter(Boolean).length;
  const completionPercent = Math.round((completedRequiredCount / requiredSteps.length) * 100);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient
        colors={['#000000', '#1a1a1a', '#2d2d2d']}
        style={styles.gradient}
      >
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>

          {/* OTP Modal */}
          {/* OTP functionality commented out - direct Firebase signup enabled */}
          {/* <OtpModal
            visible={showOtpModal}
            phone={otpPhone}
            password={password}
            role="player"
            email={email && email.trim().length > 0 ? email.trim() : undefined}
            onClose={() => setShowOtpModal(false)}
            onVerified={handleOtpVerified}
          /> */}
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={handleBack}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.headerContent}>
              <Text style={styles.headerTitle}>{i18n.t('signup_player')}</Text>
              <Text style={styles.headerSubtitle}>{i18n.t('createYourPlayerAccount')}</Text>
            </View>
          </View>

          <ScrollView
            ref={scrollViewRef}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="never"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            {formError && (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle" size={16} color="#ff3b30" />
                <Text style={styles.errorSubmitText}>{formError}</Text>
              </View>
            )}

            <View style={styles.profileSection}>
              <TouchableOpacity onPress={pickImage} style={styles.profileImageContainer}>
                {profilePhoto ? (
                  <Image source={{ uri: profilePhoto }} style={styles.profileImage} />
                ) : (
                  <View style={styles.profileImagePlaceholder}>
                    <Ionicons name="camera" size={32} color="#999" />
                  </View>
                )}
                <View style={styles.profileImageOverlay}>
                  <Ionicons name="camera" size={20} color="#fff" />
                </View>
              </TouchableOpacity>
              <Text style={styles.profileLabel}>{i18n.t('profile_picture')}</Text>
              <Text style={styles.profileHint}>
                {profilePhoto
                  ? (i18n.t('profilePhotoReady') || 'Great — your profile photo is ready.')
                  : (i18n.t('profilePhotoRecommended') || 'Optional, but highly recommended so your profile looks complete and professional.')}
              </Text>
              <View style={[styles.profileStatusPill, profilePhoto && styles.profileStatusPillSuccess]}>
                <Ionicons
                  name={profilePhoto ? 'checkmark-circle' : 'sparkles-outline'}
                  size={16}
                  color={profilePhoto ? '#166534' : '#374151'}
                />
                <Text style={[styles.profileStatusText, profilePhoto && styles.profileStatusTextSuccess]}>
                  {profilePhoto ? (i18n.t('profileReady') || 'Profile image added') : (i18n.t('optionalRecommended') || 'Optional but recommended')}
                </Text>
              </View>
            </View>

            <View style={styles.progressCard}>
              <View style={styles.progressHeaderRow}>
                <View style={styles.progressTitleWrap}>
                  <Text style={styles.progressTitle}>{i18n.t('completeYourProfile') || 'Complete your player profile'}</Text>
                  <Text style={styles.progressSubtitle}>
                    {i18n.t('playerSignupProgressHint') || 'A complete profile helps academies and clinics review you faster.'}
                  </Text>
                </View>
                <View style={styles.progressBadge}>
                  <Text style={styles.progressBadgeText}>{completedRequiredCount}/{requiredSteps.length}</Text>
                </View>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${completionPercent}%` }]} />
              </View>
            </View>

            <View style={styles.formCard}>
              <View style={styles.sectionBlock}>
                <View style={styles.sectionHeaderRow}>
                  <View style={styles.sectionIconBadge}>
                    <Ionicons name="person-circle-outline" size={18} color="#000" />
                  </View>
                  <View style={styles.sectionTitleWrap}>
                    <Text style={styles.sectionTitle}>{i18n.t('personalInformation') || 'Personal information'}</Text>
                    <Text style={styles.sectionDescription}>
                      {i18n.t('playerPersonalSectionHint') || 'Keep your core details accurate and easy to verify.'}
                    </Text>
                  </View>
                </View>

                <View style={styles.inputGroup} onLayout={(e) => registerFieldLayout('firstName', e.nativeEvent.layout.y)}>
                  <Text style={styles.label}>
                    {i18n.t('first_name')}
                    <Text style={styles.required}> *</Text>
                  </Text>
                  <View style={[styles.inputWrapper, focusedField === 'firstName' && styles.inputWrapperFocused, missing.firstName && styles.inputWrapperError]}>
                    <Ionicons name="person-outline" size={20} color="#999" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      value={firstName}
                      onFocus={() => setFocusedField('firstName')}
                      onBlur={() => setFocusedField(null)}
                      onChangeText={t => { setFirstName(t); if (missing.firstName) setMissing(m => ({ ...m, firstName: false })); validateField('firstName', t); }}
                      autoCapitalize="words"
                      placeholder={i18n.t('first_name_ph')}
                      placeholderTextColor="#999"
                    />
                  </View>
                  {errors.firstName && <Text style={styles.errorText}>{errors.firstName}</Text>}
                </View>

                <View style={styles.inputGroup} onLayout={(e) => registerFieldLayout('lastName', e.nativeEvent.layout.y)}>
                  <Text style={styles.label}>
                    {i18n.t('last_name')}
                    <Text style={styles.required}> *</Text>
                  </Text>
                  <View style={[styles.inputWrapper, focusedField === 'lastName' && styles.inputWrapperFocused, missing.lastName && styles.inputWrapperError]}>
                    <Ionicons name="person-outline" size={20} color="#999" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      value={lastName}
                      onFocus={() => setFocusedField('lastName')}
                      onBlur={() => setFocusedField(null)}
                      onChangeText={t => { setLastName(t); if (missing.lastName) setMissing(m => ({ ...m, lastName: false })); validateField('lastName', t); }}
                      autoCapitalize="words"
                      placeholder={i18n.t('last_name_ph')}
                      placeholderTextColor="#999"
                    />
                  </View>
                  {errors.lastName && <Text style={styles.errorText}>{errors.lastName}</Text>}
                </View>

                <View style={styles.inputGroup} onLayout={(e) => registerFieldLayout('dob', e.nativeEvent.layout.y)}>
                  <Text style={styles.label}>
                    {i18n.t('dob')}
                    <Text style={styles.required}> *</Text>
                  </Text>
                  <TouchableOpacity
                    style={[styles.inputWrapper, focusedField === 'dob' && styles.inputWrapperFocused, styles.datePickerWrapper, missing.dob && styles.inputWrapperError]}
                    onPress={() => { setFocusedField('dob'); setShowDatePicker(true); }}
                  >
                    <Ionicons
                      name="calendar-outline"
                      size={20}
                      color={dob ? '#1d4ed8' : '#64748b'}
                      style={styles.inputIcon}
                    />
                    <Text style={[styles.dateText, dob ? styles.dateTextSelected : styles.datePlaceholder]}>
                      {dob ? formatDate(dob) : i18n.t('dob_ph') || 'Select date of birth'}
                    </Text>
                  </TouchableOpacity>
                  {errors.dob && <Text style={styles.errorText}>{errors.dob}</Text>}
                  {showDatePicker && Platform.OS === 'android' && (
                    <DateTimePicker
                      value={dob || new Date(2010, 0, 1)}
                      mode="date"
                      display="default"
                      onChange={onDateChange}
                      maximumDate={new Date()}
                      minimumDate={new Date(1920, 0, 1)}
                    />
                  )}
                  {Platform.OS === 'ios' && showDatePicker && (
                    <Modal
                      visible={showDatePicker}
                      transparent={true}
                      animationType="slide"
                      onRequestClose={() => setShowDatePicker(false)}
                    >
                      <View style={styles.iosDatePickerModal}>
                        <View style={styles.iosDatePickerHeader}>
                          <TouchableOpacity
                            style={styles.datePickerButton}
                            onPress={() => setShowDatePicker(false)}
                          >
                            <Text style={styles.datePickerButtonText}>{i18n.t('done') || 'Done'}</Text>
                          </TouchableOpacity>
                        </View>
                        <DateTimePicker
                          value={dob || new Date(2010, 0, 1)}
                          mode="date"
                          display="spinner"
                          onChange={onDateChange}
                          maximumDate={new Date()}
                          minimumDate={new Date(1920, 0, 1)}
                          style={styles.iosDatePicker}
                          textColor="#000"
                        />
                      </View>
                    </Modal>
                  )}
                </View>

                <View style={styles.inputGroup} onLayout={(e) => registerFieldLayout('city', e.nativeEvent.layout.y)}>
                  <Text style={styles.label}>
                    {i18n.t('city')}
                    <Text style={styles.required}> *</Text>
                  </Text>
                  <TouchableOpacity
                    style={[styles.inputWrapper, focusedField === 'city' && styles.inputWrapperFocused, styles.cityPickerWrapper, missing.city && styles.inputWrapperError]}
                    onPress={() => { setFocusedField('city'); setShowCityModal(true); }}
                  >
                    <Ionicons name="location-outline" size={20} color="#999" style={styles.inputIcon} />
                    <Text style={[styles.cityText, !city && styles.cityPlaceholder]}>
                      {city ? cityLabels[city] || city : i18n.t('selectCity')}
                    </Text>
                    <Ionicons name="chevron-down" size={20} color="#999" />
                  </TouchableOpacity>
                  {errors.city && <Text style={styles.errorText}>{errors.city}</Text>}

                  {showCityModal && (
                    <Modal
                      visible={showCityModal}
                      transparent={true}
                      animationType="fade"
                      onRequestClose={() => setShowCityModal(false)}
                    >
                      <TouchableOpacity
                        style={styles.modalOverlay}
                        activeOpacity={1}
                        onPress={() => setShowCityModal(false)}
                      >
                        <View style={styles.modalContent}>
                          <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>{i18n.t('selectCity')}</Text>
                            <TouchableOpacity onPress={() => setShowCityModal(false)}>
                              <Ionicons name="close" size={24} color="#000" />
                            </TouchableOpacity>
                          </View>
                          <ScrollView style={styles.modalScrollView} showsVerticalScrollIndicator={true}>
                            {cityEntries.map(([key, label]) => (
                              <TouchableOpacity
                                key={key}
                                style={[styles.cityOption, city === key && styles.cityOptionSelected]}
                                onPress={() => {
                                  setCity(key);
                                  if (missing.city) setMissing(m => ({ ...m, city: false }));
                                  validateField('city', key);
                                  setShowCityModal(false);
                                }}
                              >
                                <Text style={[styles.cityOptionText, city === key && styles.cityOptionTextSelected]}>
                                  {label}
                                </Text>
                                {city === key && (
                                  <Ionicons name="checkmark" size={20} color="#fff" />
                                )}
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        </View>
                      </TouchableOpacity>
                    </Modal>
                  )}
                </View>
              </View>

              <View style={styles.sectionDivider} />

              <View style={styles.sectionBlock}>
                <View style={styles.sectionHeaderRow}>
                  <View style={styles.sectionIconBadge}>
                    <Ionicons name="football-outline" size={18} color="#000" />
                  </View>
                  <View style={styles.sectionTitleWrap}>
                    <Text style={styles.sectionTitle}>{i18n.t('playerProfile') || 'Football profile'}</Text>
                    <Text style={styles.sectionDescription}>
                      {i18n.t('playerFootballSectionHint') || 'Show your main role clearly and add your highlight link if available.'}
                    </Text>
                  </View>
                </View>

                <View style={styles.inputGroup} onLayout={(e) => registerFieldLayout('position', e.nativeEvent.layout.y)}>
                  <Text style={styles.label}>
                    {i18n.t('position')}
                    <Text style={styles.required}> *</Text>
                  </Text>
                  <View style={styles.positionsRow}>
                    {POSITIONS.map(pos => (
                      <TouchableOpacity
                        key={pos}
                        style={[styles.positionBtn, position === pos && styles.positionBtnSelected]}
                        onPress={() => { setPosition(pos); if (missing.position) setMissing(m => ({ ...m, position: false })); validateField('position', pos); }}
                      >
                        <Text style={[styles.positionBtnText, position === pos && styles.positionBtnTextSelected]}>{i18n.t(pos)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {errors.position && <Text style={styles.errorText}>{errors.position}</Text>}
                  {position ? (
                    <View style={styles.selectionInfoRow}>
                      <View style={styles.selectionInfoPill}>
                        <Ionicons name="checkmark-circle" size={15} color="#166534" />
                        <Text style={styles.selectionInfoText}>
                          {i18n.t('primaryPositionSelected', { position: i18n.t(position) })}
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <Text style={styles.fieldHelperText}>{i18n.t('primaryPositionHint')}</Text>
                  )}
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>{i18n.t('alternate_positions')}</Text>
                  <View style={styles.positionsRow}>
                    {POSITIONS.map(pos => (
                      <TouchableOpacity
                        key={pos}
                        style={[styles.positionBtn, altPositions.includes(pos) && styles.positionBtnSelected]}
                        onPress={() => handleAltPositionToggle(pos)}
                      >
                        <Text style={[styles.positionBtnText, altPositions.includes(pos) && styles.positionBtnTextSelected]}>{i18n.t(pos)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={styles.fieldHelperText}>
                    {altPositions.length > 0
                      ? i18n.t('alternatePositionsSelected', { count: altPositions.length })
                      : i18n.t('alternatePositionsHint')}
                  </Text>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>{i18n.t('highlight_video')}</Text>
                  <View style={styles.inputWrapper}>
                    <Ionicons name="videocam-outline" size={20} color="#999" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      value={highlightVideo}
                      onChangeText={setHighlightVideo}
                      autoCapitalize="none"
                      placeholder={i18n.t('highlight_video_ph')}
                      placeholderTextColor="#999"
                    />
                  </View>
                  <View style={styles.mediaTipCard}>
                    <Ionicons name="sparkles-outline" size={16} color="#111827" style={styles.mediaTipIcon} />
                    <Text style={styles.mediaTipText}>{i18n.t('highlightVideoHint')}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.sectionDivider} />

              <View style={styles.sectionBlock}>
                <View style={styles.sectionHeaderRow}>
                  <View style={styles.sectionIconBadge}>
                    <Ionicons name="shield-checkmark-outline" size={18} color="#000" />
                  </View>
                  <View style={styles.sectionTitleWrap}>
                    <Text style={styles.sectionTitle}>{i18n.t('accountDetails') || 'Account details'}</Text>
                    <Text style={styles.sectionDescription}>
                      {i18n.t('playerAccountSectionHint') || 'These details are used to secure your account and keep your profile reachable.'}
                    </Text>
                  </View>
                </View>

                <View style={styles.inputGroup} onLayout={(e) => registerFieldLayout('phone', e.nativeEvent.layout.y)}>
                  <Text style={styles.label}>
                    {i18n.t('phone')}
                    <Text style={styles.required}> *</Text>
                  </Text>
                  <View style={[styles.inputWrapper, focusedField === 'phone' && styles.inputWrapperFocused, missing.phone && styles.inputWrapperError]}>
                    <Ionicons name="call-outline" size={20} color="#999" style={styles.inputIcon} />
                    <Text style={{ color: '#999', fontSize: 16, fontWeight: '600', marginRight: 8 }}>+2</Text>
                    <TextInput
                      style={styles.input}
                      value={getEgyptPhoneLocalPart(phone)}
                      onFocus={() => setFocusedField('phone')}
                      onBlur={() => setFocusedField(null)}
                      onChangeText={t => {
                        const nextPhone = formatEgyptPhoneFromLocalInput(t);
                        setPhone(nextPhone);
                        if (missing.phone) setMissing(m => ({ ...m, phone: false }));
                        validateField('phone', nextPhone);
                      }}
                      keyboardType="phone-pad"
                      placeholder="01XXXXXXXXX"
                      placeholderTextColor="#999"
                    />
                  </View>
                  {errors.phone && <Text style={styles.errorText}>{errors.phone}</Text>}
                  <Text style={styles.fieldHelperText}>{i18n.t('phoneSecurityHint')}</Text>
                </View>

                <View style={styles.inputGroup} onLayout={(e) => registerFieldLayout('email', e.nativeEvent.layout.y)}>
                  <Text style={styles.label}>
                    {i18n.t('email_address')} <Text style={{ color: '#999', fontSize: 14 }}>({i18n.t('optional')})</Text>
                  </Text>
                  <View style={[styles.inputWrapper, focusedField === 'email' && styles.inputWrapperFocused, missing.email && styles.inputWrapperError]}>
                    <Ionicons name="mail-outline" size={20} color="#999" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      value={email}
                      onFocus={() => setFocusedField('email')}
                      onBlur={() => setFocusedField(null)}
                      onChangeText={t => {
                        setEmail(t);
                        if (missing.email) setMissing(m => ({ ...m, email: false }));
                        if (t && t.trim().length > 0) {
                          validateField('email', t);
                        } else {
                          setErrors(prev => {
                            const newErrors = { ...prev };
                            delete newErrors.email;
                            return newErrors;
                          });
                          setMissing(prev => {
                            const newMissing = { ...prev };
                            delete newMissing.email;
                            return newMissing;
                          });
                        }
                      }}
                      autoCapitalize="none"
                      keyboardType="email-address"
                      placeholder={i18n.t('email_address_ph')}
                      placeholderTextColor="#999"
                    />
                  </View>
                  {errors.email && <Text style={styles.errorText}>{errors.email}</Text>}
                </View>

                <View style={styles.inputGroup} onLayout={(e) => registerFieldLayout('password', e.nativeEvent.layout.y)}>
                  <Text style={styles.label}>
                    {i18n.t('password')}
                    <Text style={styles.required}> *</Text>
                  </Text>
                  <View style={[styles.inputWrapper, focusedField === 'password' && styles.inputWrapperFocused, missing.password && styles.inputWrapperError]}>
                    <Ionicons name="lock-closed-outline" size={20} color="#999" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      value={password}
                      onFocus={() => setFocusedField('password')}
                      onBlur={() => setFocusedField(null)}
                      onChangeText={t => { setPassword(t); if (missing.password) setMissing(m => ({ ...m, password: false })); validateField('password', t); }}
                      secureTextEntry
                      placeholder={i18n.t('password_ph')}
                      placeholderTextColor="#999"
                    />
                  </View>
                  {errors.password && <Text style={styles.errorText}>{errors.password}</Text>}
                  <Text style={styles.fieldHelperText}>{i18n.t('passwordSecurityHint')}</Text>
                </View>
              </View>

              <View style={styles.sectionDivider} />

              <View style={styles.sectionBlock}>
                <View style={styles.sectionHeaderRow}>
                  <View style={styles.sectionIconBadge}>
                    <Ionicons name="document-text-outline" size={18} color="#000" />
                  </View>
                  <View style={styles.sectionTitleWrap}>
                    <Text style={styles.sectionTitle}>{i18n.t('verification') || 'Verification'}</Text>
                    <Text style={styles.sectionDescription}>
                      {i18n.t('playerVerificationHint') || 'Upload your ID if you want a more complete and trusted profile later on.'}
                    </Text>
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>{i18n.t('national_id_photo')}</Text>
                  <TouchableOpacity onPress={pickNationalIdPhoto} style={styles.nationalIdContainer}>
                    {nationalIdPhoto ? (
                      <Image source={{ uri: nationalIdPhoto }} style={styles.nationalIdImage} />
                    ) : (
                      <View style={styles.nationalIdPlaceholder}>
                        <Ionicons name="document-outline" size={32} color="#999" />
                        <Text style={styles.nationalIdText}>{i18n.t('upload_national_id')}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                  <View style={[styles.verificationStatusRow, nationalIdPhoto && styles.verificationStatusRowReady]}>
                    <Ionicons
                      name={nationalIdPhoto ? 'checkmark-circle' : 'time-outline'}
                      size={15}
                      color={nationalIdPhoto ? '#166534' : '#92400e'}
                    />
                    <Text style={[styles.verificationStatusText, nationalIdPhoto && styles.verificationStatusTextReady]}>
                      {nationalIdPhoto ? i18n.t('nationalIdReady') : i18n.t('nationalIdPending')}
                    </Text>
                  </View>
                  <Text style={styles.uploadHelperText}>
                    {i18n.t('optionalVerificationHint') || 'Optional for now — adding it can help speed up future verification.'}
                  </Text>
                </View>
              </View>

              <View style={styles.submitPanel}>
                <Text style={styles.submitHint}>
                  {i18n.t('playerSubmitHint') || 'We are only polishing the experience — all your current fields stay exactly as they are.'}
                </Text>
                <View style={styles.submitTrustRow}>
                  <Ionicons name="shield-checkmark-outline" size={16} color="#166534" />
                  <Text style={styles.submitTrustText}>{i18n.t('secureSignupHint')}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.signupButton, loading && styles.signupButtonDisabled]}
                  onPress={handleSignup}
                  disabled={loading}
                  activeOpacity={0.8}
                >
                  <View style={styles.signupButtonContent}>
                    {loading ? (
                      <FootballLoader color="#fff" />
                    ) : (
                      <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                    )}
                    <Text style={styles.signupButtonText}>{loading ? i18n.t('creatingAccount') : i18n.t('signup')}</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </Animated.View>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
};

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
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerContent: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  profileSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  profileImageContainer: {
    position: 'relative',
    marginBottom: 12,
  },
  profileImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 4,
    borderColor: '#fff',
  },
  profileImagePlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#fff',
  },
  profileImageOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#fff',
  },
  profileLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  profileHint: {
    marginTop: 6,
    fontSize: 13,
    color: 'rgba(255,255,255,0.72)',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 12,
  },
  profileStatusPill: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  profileStatusPillSuccess: {
    backgroundColor: '#ecfdf5',
  },
  profileStatusText: {
    color: '#e5e7eb',
    fontSize: 12,
    fontWeight: '700',
  },
  profileStatusTextSuccess: {
    color: '#166534',
  },
  progressCard: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 18,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  progressHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  progressTitleWrap: {
    flex: 1,
  },
  progressTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  progressSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.72)',
    lineHeight: 18,
  },
  progressBadge: {
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  progressBadgeText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '700',
  },
  progressTrack: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#fff',
    borderRadius: 999,
  },
  required: {
    color: '#ff3b30',
  },
  formCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  sectionBlock: {
    marginBottom: 4,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  sectionIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  sectionTitleWrap: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  sectionDescription: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 18,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: '#eceff3',
    marginVertical: 18,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#f5f5f5',
    paddingHorizontal: 16,
    minHeight: 56,
  },
  inputWrapperFocused: {
    borderColor: '#111827',
    backgroundColor: '#ffffff',
  },
  inputWrapperError: {
    borderColor: '#ff3b30',
    backgroundColor: '#fff5f5',
  },
  pickerWrapper: {
    paddingHorizontal: 0,
  },
  cityPickerWrapper: {
    justifyContent: 'space-between',
  },
  cityText: {
    flex: 1,
    fontSize: 16,
    color: '#000',
    paddingVertical: 16,
  },
  cityPlaceholder: {
    color: '#999',
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 20,
    width: '90%',
    maxHeight: '70%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
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
  cityOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  cityOptionSelected: {
    backgroundColor: '#000',
  },
  cityOptionText: {
    fontSize: 16,
    color: '#000',
  },
  cityOptionTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#000',
    paddingVertical: 16,
  },
  datePickerWrapper: {
    justifyContent: 'space-between',
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  dateText: {
    flex: 1,
    fontSize: 16,
    color: '#1e293b',
    paddingVertical: 16,
  },
  dateTextSelected: {
    color: '#1d4ed8',
    fontWeight: '600',
  },
  datePlaceholder: {
    color: '#64748b',
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
  picker: {
    flex: 1,
    color: '#000',
  },
  pickerItem: {
    color: '#000',
  },
  errorText: {
    color: '#ff3b30',
    fontSize: 12,
    marginTop: 6,
    marginLeft: 4,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff5f5',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  errorSubmitText: {
    color: '#ff3b30',
    fontSize: 14,
    marginLeft: 8,
    flex: 1,
  },
  positionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  positionBtn: {
    borderWidth: 1.5,
    borderColor: '#d1d5db',
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
    margin: 2,
    backgroundColor: '#f9fafb',
  },
  positionBtnSelected: {
    backgroundColor: '#111827',
    borderColor: '#111827',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  positionBtnText: {
    color: '#111827',
    fontWeight: '700',
    fontSize: 13,
  },
  positionBtnTextSelected: {
    color: '#fff',
  },
  fieldHelperText: {
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 18,
    marginTop: 8,
    marginLeft: 2,
  },
  selectionInfoRow: {
    flexDirection: 'row',
    marginTop: 8,
  },
  selectionInfoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ecfdf5',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  selectionInfoText: {
    color: '#166534',
    fontSize: 12,
    fontWeight: '700',
  },
  mediaTipCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  mediaTipIcon: {
    marginRight: 8,
    marginTop: 1,
  },
  mediaTipText: {
    flex: 1,
    color: '#374151',
    fontSize: 12,
    lineHeight: 18,
  },
  nationalIdContainer: {
    width: '100%',
    marginBottom: 8,
  },
  nationalIdImage: {
    width: '100%',
    height: 150,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#e0e0e0',
  },
  nationalIdPlaceholder: {
    width: '100%',
    height: 150,
    borderRadius: 12,
    backgroundColor: '#f5f5f5',
    borderWidth: 2,
    borderColor: '#e0e0e0',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nationalIdText: {
    marginTop: 8,
    color: '#999',
    fontSize: 14,
  },
  uploadHelperText: {
    marginTop: 8,
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 18,
  },
  verificationStatusRow: {
    marginTop: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fffbeb',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  verificationStatusRowReady: {
    backgroundColor: '#ecfdf5',
  },
  verificationStatusText: {
    color: '#92400e',
    fontSize: 12,
    fontWeight: '700',
  },
  verificationStatusTextReady: {
    color: '#166534',
  },
  submitPanel: {
    marginTop: 4,
  },
  submitHint: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 18,
    marginBottom: 12,
  },
  submitTrustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0fdf4',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  submitTrustText: {
    marginLeft: 8,
    flex: 1,
    fontSize: 12,
    color: '#166534',
    fontWeight: '600',
    lineHeight: 18,
  },
  signupButton: {
    backgroundColor: '#000',
    borderRadius: 12,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  signupButtonDisabled: {
    opacity: 0.6,
  },
  signupButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  signupButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
});

export default SignupPlayer;