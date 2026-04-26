import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useOnboarding } from '../context/OnboardingContext';
import React, { useRef, useState } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { buildPersonDisplayName } from '../lib/userDisplayName';
import { uploadMedia } from '../services/MediaService';
import { writeEmailIndex, lookupEmailIndex } from '../lib/emailIndex';
import { lookupPhoneIndex, writePhoneIndex } from '../lib/phoneIndex';
import {
  getPhoneIdentityCandidates,
  formatEgyptPhoneFromLocalInput,
  getEgyptPhoneLocalPart,
  validateCity,
  validateEmail,
  validatePassword,
  validatePhone,
  validateName,
  normalizePhoneForAuth,
  normalizePhoneForTwilio,
} from '../lib/validations';
import i18n from '../locales/i18n';
import FootballLoader from '../components/FootballLoader';
import SignupStepBar from '../components/SignupStepBar';
import { notifyAdminsOfNewSignup } from '../services/SignupNotificationService';
// OTP functionality commented out - direct Firebase signup enabled
// import OtpModal from '../components/OtpModal';
// import { getBackendUrl } from '../lib/config';


interface Errors {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  password?: string;
  city?: string;
  profilePhoto?: string;
}

const SignupAgent = () => {
  const router = useRouter();
  const { startOnboarding } = useOnboarding();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [agency, setAgency] = useState('');
  const [license, setLicense] = useState('');
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [city, setCity] = useState('');
  const [showCityModal, setShowCityModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [missing, setMissing] = useState<{ [key: string]: boolean }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  // OTP functionality commented out - direct Firebase signup enabled
  // const [showOtpModal, setShowOtpModal] = useState(false);
  // const [otpPhone, setOtpPhone] = useState('');
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scrollViewRef = useRef<ScrollView | null>(null);
  const fieldLayouts = useRef<Record<string, number>>({});

  const cityOptions = Object.entries(i18n.t('cities', { returnObjects: true }) as Record<string, string>).map(([key, label]) => ({ key, label }));

  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const validateField = (field: keyof Errors, value: string) => {
    let error: string | null = null;

    switch (field) {
      case 'firstName':
        error = validateName(value, 'First name');
        break;
      case 'lastName':
        error = validateName(value, 'Last name');
        break;
      case 'email':
        if (value && value.trim().length > 0) {
          error = validateEmail(value);
        }
        break;
      case 'phone':
        error = validatePhone(value);
        break;
      case 'password':
        error = validatePassword(value);
        break;
      case 'city':
        error = validateCity(value);
        break;
      case 'profilePhoto':
        break;
    }

    if (error) {
      setErrors(prev => ({ ...prev, [field]: error }));
      setMissing(prev => ({ ...prev, [field]: true }));
    } else {
      setErrors(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
      setMissing(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
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

    const cityError = validateCity(city);
    if (cityError) {
      newErrors.city = cityError;
      newMissing.city = true;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      newErrors.password = passwordError;
      newMissing.password = true;
    }

    // Profile photo is optional

    setErrors(newErrors);
    setMissing(newMissing);

    const hasErrors = Object.keys(newErrors).length > 0;
    if (hasErrors) {
      const fieldOrder: (keyof Errors)[] = ['firstName', 'lastName', 'phone', 'city', 'email', 'password'];
      const firstInvalidField = fieldOrder.find((field) => Boolean(newErrors[field]));
      if (firstInvalidField) {
        requestAnimationFrame(() => scrollToField(firstInvalidField));
      }
    }

    return !hasErrors;
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      setProfilePhoto(result.assets[0].uri);
      if (missing.profilePhoto) setMissing(m => ({ ...m, profilePhoto: false }));
    }
  };

  const handleBack = () => {
    if (router.canGoBack?.()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  // OTP functionality commented out - direct Firebase signup enabled
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
      const userEmailForIndex = email && email.trim().length > 0 ? email.trim() : null;

      // Prevent duplicates across legacy/raw and canonical phone identities
      const phoneCandidates = getPhoneIdentityCandidates(phone);
      const [existingPhoneMatches, existingEmailAuth] = await Promise.all([
        Promise.all(phoneCandidates.map((candidate) => lookupPhoneIndex(candidate))),
        userEmailForIndex ? lookupEmailIndex(userEmailForIndex) : Promise.resolve(null),
      ]);
      if (existingPhoneMatches.some(Boolean)) {
        throw { code: 'forsa/phone-already-in-use' };
      }

      // Pre-check: if email provided, ensure it is not already taken
      if (existingEmailAuth) {
        throw { code: 'forsa/email-already-in-use' };
      }

      // console.log('[Signup] Creating Firebase user with email:', authEmail);
      const userCredential = await createUserWithEmailAndPassword(auth, authEmail, password);
      const user = userCredential.user;
      const uid = user.uid;
      // console.log('[Signup] Firebase user created! UID:', uid);

      // Step 2: Upload profile photo to Cloudinary
      let profilePhotoUrl = '';
      if (profilePhoto) {
        try {
          const cloudinaryResponse = await uploadMedia(profilePhoto, 'image');
          profilePhotoUrl = cloudinaryResponse.secure_url;
        } catch (error: any) {
          console.error('Error uploading profile photo:', error);
          throw new Error('Failed to upload profile photo. Please try again.');
        }
      }

      // Step 3: Save user data to Firestore
      const userData = {
        uid,
        role: 'agent',
        status: 'active',
        isSuspended: false,
        username: buildPersonDisplayName(firstName, lastName) || 'Agent',
        email: email && email.trim().length > 0 ? email.trim() : null,
        phone,
        firstName,
        lastName,
        agency,
        license,
        city,
        profilePhoto: profilePhotoUrl,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await Promise.all([
        setDoc(doc(db, 'users', uid), userData, { merge: true }),
        setDoc(doc(db, 'agents', uid), userData),
        userEmailForIndex ? writeEmailIndex(userEmailForIndex, authEmail) : Promise.resolve(),
        writePhoneIndex(phoneForAuth, authEmail),
      ]);

      // Save email → authEmail mapping for email-based login
      // Step 4: User is already signed in, redirect to dashboard
      // console.log('[Signup] User is logged in and navigating to agent-feed...');
      startOnboarding('agent');

      void notifyAdminsOfNewSignup({
        signupUserId: uid,
        role: 'agent',
        userData,
      }).catch((error) => {
        console.warn('[SignupAgent] Failed to notify admins about new signup:', error);
      });
    } catch (err: any) {
      // console.log('[Signup] Error:', err.message, err);
      let errorMsg = i18n.t('signupFailedMessage');
      if (err.code === 'auth/email-already-in-use') {
        errorMsg = String(i18n.t('phoneAlreadyRegistered'));
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
  // const handleOtpVerified = async (uid: string, _token: string, _refreshToken: string) => {
  //   ... commented out ...
  // };

  const requiredSteps = [
    Boolean(firstName.trim()),
    Boolean(lastName.trim()),
    Boolean(phone.trim()) && !errors.phone,
    Boolean(city),
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
            role="agent"
            email={email && email.trim().length > 0 ? email.trim() : undefined}
            onClose={() => setShowOtpModal(false)}
            onVerified={handleOtpVerified}
          />
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={handleBack}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.headerContent}>
              <Text style={styles.headerTitle}>{i18n.t('signup_agent')}</Text>
              <Text style={styles.headerSubtitle}>{i18n.t('createYourAgentAccount') || 'Create your agent account'}</Text>
            </View>
          </View>

          <SignupStepBar
            currentStep={2}
            totalSteps={3}
            stepLabels={['Account Type', 'Your Profile', 'Get Started']}
          />

          <ScrollView
            ref={scrollViewRef}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
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
                  <Text style={styles.progressTitle}>{i18n.t('completeYourAgentProfile') || 'Complete your agent profile'}</Text>
                  <Text style={styles.progressSubtitle}>
                    {i18n.t('agentSignupProgressHint') || 'A complete profile helps players and academies trust your account faster.'}
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
                      {i18n.t('agentPersonalSectionHint') || 'Add your core details clearly so people know who they are contacting.'}
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
                      {city ? i18n.t(`cities.${city}`) : i18n.t('selectCity') || 'Select City'}
                    </Text>
                    <Ionicons name="chevron-down" size={20} color="#999" />
                  </TouchableOpacity>
                  {errors.city && <Text style={styles.errorText}>{errors.city}</Text>}
                  <Modal
                    visible={showCityModal}
                    transparent
                    animationType="fade"
                    onRequestClose={() => { setShowCityModal(false); setFocusedField(null); }}
                  >
                    <TouchableOpacity
                      style={styles.modalOverlay}
                      activeOpacity={1}
                      onPress={() => { setShowCityModal(false); setFocusedField(null); }}
                    >
                      <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                          <Text style={styles.modalTitle}>{i18n.t('selectCity')}</Text>
                          <TouchableOpacity onPress={() => { setShowCityModal(false); setFocusedField(null); }}>
                            <Ionicons name="close" size={24} color="#000" />
                          </TouchableOpacity>
                        </View>
                        <ScrollView style={styles.modalScrollView}>
                          {cityOptions.map(option => (
                            <TouchableOpacity
                              key={option.key}
                              style={[styles.cityOption, city === option.key && styles.cityOptionSelected]}
                              onPress={() => {
                                setCity(option.key);
                                validateField('city', option.key);
                                setFocusedField(null);
                                setShowCityModal(false);
                              }}
                            >
                              <Text style={[styles.cityOptionText, city === option.key && styles.cityOptionTextSelected]}>
                                {option.label}
                              </Text>
                              {city === option.key && <Ionicons name="checkmark" size={20} color="#fff" />}
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    </TouchableOpacity>
                  </Modal>
                </View>
              </View>

              <View style={styles.sectionDivider} />

              <View style={styles.sectionBlock}>
                <View style={styles.sectionHeaderRow}>
                  <View style={styles.sectionIconBadge}>
                    <Ionicons name="briefcase-outline" size={18} color="#000" />
                  </View>
                  <View style={styles.sectionTitleWrap}>
                    <Text style={styles.sectionTitle}>{i18n.t('professionalDetails') || 'Professional details'}</Text>
                    <Text style={styles.sectionDescription}>
                      {i18n.t('agentProfessionalSectionHint') || 'Add your agency and registration details to look more credible and complete.'}
                    </Text>
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>{i18n.t('agencyName')} <Text style={styles.optionalText}>({i18n.t('optional') || 'optional'})</Text></Text>
                  <View style={[styles.inputWrapper, focusedField === 'agency' && styles.inputWrapperFocused]}>
                    <Ionicons name="business-outline" size={20} color="#999" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      value={agency}
                      onFocus={() => setFocusedField('agency')}
                      onBlur={() => setFocusedField(null)}
                      onChangeText={setAgency}
                      autoCapitalize="words"
                      placeholder={i18n.t('agencyName_ph') || i18n.t('agencyName')}
                      placeholderTextColor="#999"
                    />
                  </View>
                  <Text style={styles.fieldHelperText}>{i18n.t('agencyHint') || 'If you represent an agency, add its name so players can recognize you quickly.'}</Text>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>{i18n.t('licenseNumber')} <Text style={styles.optionalText}>({i18n.t('optional') || 'optional'})</Text></Text>
                  <View style={[styles.inputWrapper, focusedField === 'license' && styles.inputWrapperFocused]}>
                    <Ionicons name="document-outline" size={20} color="#999" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      value={license}
                      onFocus={() => setFocusedField('license')}
                      onBlur={() => setFocusedField(null)}
                      onChangeText={setLicense}
                      autoCapitalize="none"
                      placeholder={i18n.t('licenseNumber_ph') || i18n.t('licenseNumber')}
                      placeholderTextColor="#999"
                    />
                  </View>
                  <Text style={styles.fieldHelperText}>{i18n.t('licenseHint') || 'Optional, but adding a registration or license number can strengthen trust.'}</Text>
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
                      {i18n.t('agentAccountSectionHint') || 'Use contact details that are professional, reachable, and easy to maintain.'}
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
                  <Text style={styles.fieldHelperText}>{i18n.t('phoneSecurityHint') || 'Use a number you can access easily for sign-in and updates.'}</Text>
                </View>

                <View style={styles.inputGroup} onLayout={(e) => registerFieldLayout('email', e.nativeEvent.layout.y)}>
                  <Text style={styles.label}>
                    {i18n.t('email_address')} <Text style={styles.optionalText}>({i18n.t('optional')})</Text>
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
                        validateField('email', t);
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
                  <Text style={styles.fieldHelperText}>{i18n.t('passwordSecurityHint') || 'Use at least 6 characters so your account stays secure.'}</Text>
                </View>
              </View>

              <View style={styles.submitPanel}>
                <Text style={styles.submitHint}>{i18n.t('agentSubmitHint') || 'Review your details before creating your account. You can update them later.'}</Text>
                <View style={styles.submitTrustRow}>
                  <Ionicons name="shield-checkmark-outline" size={16} color="#166534" />
                  <Text style={styles.submitTrustText}>{i18n.t('secureSignupHint') || 'Your details are stored securely.'}</Text>
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
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#000',
    paddingVertical: 16,
  },
  optionalText: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '500',
  },
  fieldHelperText: {
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 18,
    marginTop: 8,
    marginLeft: 2,
  },
  cityPickerWrapper: {
    paddingHorizontal: 16,
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
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
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

export default SignupAgent;
