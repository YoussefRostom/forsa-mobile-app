import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import React, { useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
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
import { auth, db } from '../lib/firebase';
import { resolveUserDisplayName } from '../lib/userDisplayName';
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
  normalizePhoneForAuth,
  normalizePhoneForTwilio,
} from '../lib/validations';
import i18n from '../locales/i18n';
import FootballLoader from '../components/FootballLoader';
import { notifyAdminsOfNewSignup } from '../services/SignupNotificationService';
// OTP functionality commented out - direct Firebase signup enabled
// import OtpModal from '../components/OtpModal';
// import { getBackendUrl } from '../lib/config';

const cities = Object.entries(i18n.t('cities', { returnObjects: true }) as Record<string, string>);

interface Errors {
  parentName?: string;
  email?: string;
  phone?: string;
  password?: string;
  confirmPassword?: string;
  city?: string;
}

const SignupParent = () => {
  const router = useRouter();
  const [parentName, setParentName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
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

  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const handleBack = () => {
    if (router.canGoBack?.()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  const validateField = (field: keyof Errors, value: string) => {
    let error: string | null = null;

    switch (field) {
      case 'parentName':
        error = validateName(value, 'Parent name');
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
      default:
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

    const parentNameError = validateName(parentName, 'Parent name');
    if (parentNameError) {
      newErrors.parentName = parentNameError;
      newMissing.parentName = true;
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

    setErrors(newErrors);
    setMissing(newMissing);

    const hasErrors = Object.keys(newErrors).length > 0;
    if (hasErrors) {
      const fieldOrder: (keyof Errors)[] = ['parentName', 'phone', 'email', 'password', 'city'];
      const firstInvalidField = fieldOrder.find((field) => Boolean(newErrors[field]));
      if (firstInvalidField) {
        requestAnimationFrame(() => scrollToField(firstInvalidField));
      }
    }

    return !hasErrors;
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
      for (const candidate of phoneCandidates) {
        const existingAuth = await lookupPhoneIndex(candidate);
        if (existingAuth) {
          throw { code: 'forsa/phone-already-in-use' };
        }
      }

      // Pre-check: if email provided, ensure it is not already taken
      if (userEmailForIndex) {
        const existingAuth = await lookupEmailIndex(userEmailForIndex);
        if (existingAuth) {
          throw { code: 'forsa/email-already-in-use' };
        }
      }

      // console.log('[Signup] Creating Firebase user with email:', authEmail);
      const userCredential = await createUserWithEmailAndPassword(auth, authEmail, password);
      const user = userCredential.user;
      const uid = user.uid;
      // console.log('[Signup] Firebase user created! UID:', uid);

      // Step 2: Save user data to Firestore
      const userData = {
        uid,
        role: 'parent',
        status: 'active',
        isSuspended: false,
        username: resolveUserDisplayName({ parentName }, 'Parent'),
        email: email && email.trim().length > 0 ? email.trim() : null,
        phone,
        parentName,
        city,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await setDoc(doc(db, 'users', uid), userData, { merge: true });
      await setDoc(doc(db, 'parents', uid), userData);

      // Save email → authEmail mapping for email-based login
      if (userEmailForIndex) {
        await writeEmailIndex(userEmailForIndex, authEmail);
      }
      await writePhoneIndex(phoneForAuth, authEmail);

      try {
        await notifyAdminsOfNewSignup({
          signupUserId: uid,
          role: 'parent',
          userData,
        });
      } catch (error) {
        console.warn('[SignupParent] Failed to notify admins about new signup:', error);
      }

      // Step 3: Generate check-in code (non-blocking)
      try {
        const { ensureCheckInCodeForCurrentUser } = await import('../services/CheckInCodeService');
        await ensureCheckInCodeForCurrentUser();
      } catch { }

      // Step 4: User is already signed in, redirect to dashboard
      // console.log('[Signup] User is logged in and navigating to parent-feed...');
      router.replace('/parent-feed');
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
    Boolean(parentName.trim()),
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
            role="parent"
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
              <Text style={styles.headerTitle}>{i18n.t('signup_parent')}</Text>
              <Text style={styles.headerSubtitle}>{i18n.t('createYourParentAccount') || 'Create your parent account'}</Text>
            </View>
          </View>

          <ScrollView
            ref={scrollViewRef}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="always"
            keyboardDismissMode="none"
            showsVerticalScrollIndicator={false}
          >
            {formError && (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle" size={16} color="#ff3b30" />
                <Text style={styles.errorSubmitText}>{formError}</Text>
              </View>
            )}

            <View style={styles.progressCard}>
              <View style={styles.progressHeaderRow}>
                <View style={styles.progressTitleWrap}>
                  <Text style={styles.progressTitle}>{i18n.t('completeYourParentProfile') || 'Complete your parent profile'}</Text>
                  <Text style={styles.progressSubtitle}>
                    {i18n.t('parentSignupProgressHint') || 'A complete parent profile makes bookings and family follow-up much smoother.'}
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
                    <Ionicons name="people-outline" size={18} color="#000" />
                  </View>
                  <View style={styles.sectionTitleWrap}>
                    <Text style={styles.sectionTitle}>{i18n.t('personalInformation') || 'Personal information'}</Text>
                    <Text style={styles.sectionDescription}>
                      {i18n.t('parentPersonalSectionHint') || 'Add your main contact details so communication and bookings stay easy.'}
                    </Text>
                  </View>
                </View>

              <View style={styles.inputGroup} onLayout={(e) => registerFieldLayout('parentName', e.nativeEvent.layout.y)}>
                <Text style={styles.label}>
                  {i18n.t('parent_name')}
                  <Text style={styles.required}> *</Text>
                </Text>
                <View style={[styles.inputWrapper, focusedField === 'parentName' && styles.inputWrapperFocused, missing.parentName && styles.inputWrapperError]}>
                  <Ionicons name="person-outline" size={20} color="#999" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={parentName}
                    onFocus={() => setFocusedField('parentName')}
                    onBlur={() => setFocusedField(null)}
                    onChangeText={t => { setParentName(t); if (missing.parentName) setMissing(m => ({ ...m, parentName: false })); validateField('parentName', t); }}
                    autoCapitalize="words"
                    placeholder={i18n.t('parent_name_ph')}
                    placeholderTextColor="#999"
                  />
                </View>
                {errors.parentName && <Text style={styles.errorText}>{errors.parentName}</Text>}
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
                    {city ? cities.find(([key]) => key === city)?.[1] || city : i18n.t('selectCity')}
                  </Text>
                  <Ionicons name="chevron-down" size={20} color="#999" />
                </TouchableOpacity>
                {errors.city && <Text style={styles.errorText}>{errors.city}</Text>}

                {/* City Selection Modal */}
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
                        {cities.map(([key, label]) => (
                          <TouchableOpacity
                            key={key}
                            style={[styles.cityOption, city === key && styles.cityOptionSelected]}
                            onPress={() => {
                              setCity(key);
                              if (missing.city) setMissing(m => ({ ...m, city: false }));
                              validateField('city', key);
                              setFocusedField(null);
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
              </View>
              </View>

              <View style={styles.submitPanel}>
                <Text style={styles.submitHint}>{i18n.t('parentSubmitHint') || 'Review your details before creating the account. You can update them later.'}</Text>
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
  required: {
    color: '#ff3b30',
  },
  ageModal: {
    position: 'absolute',
    top: 60,
    left: 0,
    width: 110,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    zIndex: 100,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 6,
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

export default SignupParent;