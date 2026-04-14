import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useRef, useState, useEffect } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Image, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import SimpleSelect from '../components/SimpleSelect';
import i18n from '../locales/i18n';
import { auth, db } from '../lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { uploadMedia } from '../services/MediaService';

const POSITIONS = ['GK', 'LB', 'CB', 'RB', 'CDM', 'CM', 'CAM', 'RW', 'LW', 'ST'];

const getPositionLabel = (pos: string) => {
  const translated = i18n.t(pos);
  return translated && translated !== pos ? translated : pos;
};

const createProfileSnapshot = (data?: Partial<{
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  position: string;
  dob: string;
  profilePhoto: string | null;
}>) => ({
  firstName: data?.firstName?.trim() || '',
  lastName: data?.lastName?.trim() || '',
  email: data?.email?.trim() || '',
  phone: data?.phone?.trim() || '',
  city: data?.city?.trim() || '',
  position: data?.position?.trim() || '',
  dob: data?.dob?.trim() || '',
  profilePhoto: data?.profilePhoto?.trim() || '',
});

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export default function PlayerProfileScreen() {
  const { openMenu } = useHamburgerMenu();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [position, setPosition] = useState('');
  const [dob, setDob] = useState('');
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null); // Firebase Storage URL
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCityModal, setShowCityModal] = useState(false);
  const [showPositionModal, setShowPositionModal] = useState(false);
  const [showDobPicker, setShowDobPicker] = useState(false);
  const [selectedDobDate, setSelectedDobDate] = useState<Date | null>(null);
  const [initialProfile, setInitialProfile] = useState(() => createProfileSnapshot());

  const accountEmail = auth.currentUser?.email?.trim() || '';
  const accountPhone = auth.currentUser?.phoneNumber?.trim() || '';
  const displayName = [firstName, lastName].filter((item) => item.trim().length > 0).join(' ').trim()
    || (i18n.t('playerRoleLabel') || 'Player');
  const visibleEmail = (email || accountEmail || '').trim();
  const visiblePhone = (phone || accountPhone || '').trim();
  const signInSummary = accountEmail && accountPhone
    ? `${i18n.t('email') || 'Email'}: ${accountEmail}\n${i18n.t('phone') || 'Phone'}: ${accountPhone}`
    : accountPhone
      ? `${i18n.t('signedInWith') || 'Signed in with'} ${accountPhone}`
      : accountEmail
        ? `${i18n.t('signedInWith') || 'Signed in with'} ${accountEmail}`
        : (i18n.t('contactMethodRequired') || 'Add at least one email or phone number.');
  const completionFields = [
    firstName,
    lastName,
    accountEmail || email,
    accountPhone || phone,
    city,
    position,
    dob,
    profilePhoto || profilePhotoUrl,
  ];
  const profileCompletion = Math.round(
    (completionFields.filter((item) => String(item || '').trim().length > 0).length / completionFields.length) * 100
  );
  const currentProfileSnapshot = createProfileSnapshot({
    firstName,
    lastName,
    email: email || accountEmail,
    phone: phone || accountPhone,
    city,
    position,
    dob,
    profilePhoto: profilePhoto || profilePhotoUrl || '',
  });
  const hasChanges = JSON.stringify(currentProfileSnapshot) !== JSON.stringify(initialProfile);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();

    fetchUserData();
  }, []);

  const fetchUserData = async () => {
    try {
      const user = auth.currentUser;

      if (!user) {
        setLoading(false);
        Alert.alert(i18n.t('error') || 'Error', 'User not authenticated');
        return;
      }

      const playerDocRef = doc(db, 'players', user.uid);
      const userDocRef = doc(db, 'users', user.uid);
      const [playerDocSnap, userDocSnap] = await Promise.all([
        getDoc(playerDocRef),
        getDoc(userDocRef),
      ]);

      const mergedData = {
        ...(userDocSnap.exists() ? userDocSnap.data() : {}),
        ...(playerDocSnap.exists() ? playerDocSnap.data() : {}),
      } as Record<string, any>;

      const nextFirstName = mergedData.firstName || '';
      const nextLastName = mergedData.lastName || '';
      const nextEmail = mergedData.email || user.email || '';
      const nextPhone = mergedData.phone || user.phoneNumber || '';
      const nextCity = mergedData.city || '';
      const nextPosition = mergedData.position || '';
      const nextDob = mergedData.dob || '';
      const nextProfilePhoto = mergedData.profilePhoto || null;

      setFirstName(nextFirstName);
      setLastName(nextLastName);
      setEmail(nextEmail);
      setPhone(nextPhone);
      setCity(nextCity);
      setPosition(nextPosition);
      setDob(nextDob);
      setProfilePhoto(nextProfilePhoto);
      setProfilePhotoUrl(nextProfilePhoto);

      if (nextDob) {
        const parsedDob = new Date(nextDob);
        if (!Number.isNaN(parsedDob.getTime())) {
          setSelectedDobDate(parsedDob);
        }
      }

      setInitialProfile(createProfileSnapshot({
        firstName: nextFirstName,
        lastName: nextLastName,
        email: nextEmail,
        phone: nextPhone,
        city: nextCity,
        position: nextPosition,
        dob: nextDob,
        profilePhoto: nextProfilePhoto || '',
      }));
    } catch (error) {
      console.error('Error fetching user data:', error);
      Alert.alert(i18n.t('error') || 'Error', 'Failed to load profile data');
    } finally {
      setLoading(false);
    }
  };

  const pickProfilePhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      // Set local URI for preview (will be uploaded when saving)
      setProfilePhoto(result.assets[0].uri);
    }
  };

  const handleDobPickerChange = (event: any, date: Date | undefined) => {
    if (Platform.OS === 'android') {
      setShowDobPicker(false);
    }
    if (date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      setDob(`${year}-${month}-${day}`);
      setSelectedDobDate(date);
    }
  };

  const handleSave = async () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert(i18n.t('error') || 'Error', 'User not authenticated');
      return;
    }

    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();
    const resolvedEmail = trimmedEmail || user.email || '';
    const resolvedPhone = trimmedPhone || user.phoneNumber || '';

    if (!resolvedEmail && !resolvedPhone) {
      Alert.alert(i18n.t('error') || 'Error', i18n.t('contactMethodRequired') || 'Add at least one email or phone number.');
      return;
    }

    if (trimmedEmail && !isValidEmail(trimmedEmail)) {
      Alert.alert(i18n.t('error') || 'Error', i18n.t('invalidEmail') || 'Please enter a valid email address.');
      return;
    }

    if (!hasChanges) {
      Alert.alert(i18n.t('success') || 'Success', i18n.t('allChangesSaved') || 'Your profile is already up to date.');
      return;
    }

    setUploading(true);
    try {
      let finalProfilePhotoUrl = profilePhotoUrl;

      if (profilePhoto && profilePhoto !== profilePhotoUrl &&
          (profilePhoto.startsWith('file://') || profilePhoto.startsWith('content://'))) {
        try {
          const cloudinaryResponse = await uploadMedia(profilePhoto, 'image');
          finalProfilePhotoUrl = cloudinaryResponse.secure_url;
          setProfilePhotoUrl(finalProfilePhotoUrl);
        } catch (error) {
          console.error('Error uploading profile photo:', error);
          Alert.alert(i18n.t('error') || 'Error', 'Failed to upload profile photo');
          setUploading(false);
          return;
        }
      }

      const updateData = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: resolvedEmail,
        phone: resolvedPhone,
        city: city.trim(),
        position: position.trim(),
        dob: dob.trim(),
        profilePhoto: finalProfilePhotoUrl || '',
        updatedAt: new Date().toISOString(),
      };

      await Promise.all([
        setDoc(doc(db, 'players', user.uid), updateData, { merge: true }),
        setDoc(doc(db, 'users', user.uid), updateData, { merge: true }),
      ]);

      if (finalProfilePhotoUrl) {
        setProfilePhoto(finalProfilePhotoUrl);
      }

      setInitialProfile(createProfileSnapshot({
        ...updateData,
        profilePhoto: finalProfilePhotoUrl || '',
      }));

      Alert.alert(i18n.t('success') || 'Success', i18n.t('profileUpdated') || 'Profile updated successfully!');
    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert(i18n.t('error') || 'Error', 'Failed to save profile');
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a1a' }}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient
        colors={['#000000', '#1a1a1a', '#2d2d2d']}
        style={styles.gradient}
      >
      <HamburgerMenu />
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.menuButton} onPress={openMenu}>
              <Ionicons name="menu" size={24} color="#fff" />
      </TouchableOpacity>
            <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>{i18n.t('editProfile') || 'Edit Profile'}</Text>
              <Text style={styles.headerSubtitle}>{i18n.t('updateYourInformation') || 'Update your information'}</Text>
            </View>
        </View>

          <ScrollView 
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Profile Photo Section */}
            <View style={styles.profileSection}>
              <TouchableOpacity onPress={pickProfilePhoto} style={styles.profileImageContainer}>
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
              <Text style={styles.profileLabel}>{i18n.t('profile_picture') || 'Profile Picture'}</Text>
              <Text style={styles.profilePhotoHint}>{i18n.t('profilePhotoHint') || 'Tap the photo to change it.'}</Text>
            </View>

            <View style={styles.overviewCard}>
              <View style={styles.overviewHeaderRow}>
                <View style={styles.overviewTextWrap}>
                  <Text style={styles.profileName}>{displayName}</Text>
                  <Text style={styles.profileMeta}>{signInSummary}</Text>
                </View>
                <View style={styles.completionBadge}>
                  <Text style={styles.completionBadgeValue}>{profileCompletion}%</Text>
                  <Text style={styles.completionBadgeLabel}>{i18n.t('completeShort') || 'complete'}</Text>
                </View>
              </View>
              <View style={styles.completionTrack}>
                <View style={[styles.completionFill, { width: `${Math.max(profileCompletion, 6)}%` }]} />
              </View>
              <Text style={styles.overviewHint}>
                {i18n.t('profileCompletionHint') || 'Complete your details so coaches, academies, and scouts can review you faster.'}
              </Text>
            </View>

            {/* Form Card */}
            <View style={styles.formCard}>
              <Text style={styles.sectionHeading}>{i18n.t('basicInformation') || 'Basic information'}</Text>
              <Text style={styles.sectionHelper}>{i18n.t('updateYourInformation') || 'Update your information'}</Text>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{i18n.t('first_name') || 'First Name'}</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="person-outline" size={20} color="#999" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
                    placeholder={i18n.t('first_name_ph') || 'Enter first name'}
                    placeholderTextColor="#999"
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{i18n.t('last_name') || 'Last Name'}</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="person-outline" size={20} color="#999" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={lastName}
              onChangeText={setLastName}
              autoCapitalize="words"
                    placeholder={i18n.t('last_name_ph') || 'Enter last name'}
                    placeholderTextColor="#999"
            />
          </View>
              </View>

              <View style={styles.sectionDivider} />
              <Text style={styles.sectionHeading}>{i18n.t('accountAccess') || 'Account access'}</Text>
              <Text style={styles.sectionHelper}>
                {i18n.t('accountAccessHint') || 'Your sign-in email or phone stays protected here so you always know how this account is accessed.'}
              </Text>
              <View style={styles.accountPillRow}>
                {!!accountEmail && (
                  <View style={styles.accountPill}>
                    <Ionicons name="mail-outline" size={14} color="#111827" />
                    <Text style={styles.accountPillText}>{i18n.t('emailSignIn') || 'Email sign-in'}</Text>
                  </View>
                )}
                {!!accountPhone && (
                  <View style={styles.accountPill}>
                    <Ionicons name="call-outline" size={14} color="#111827" />
                    <Text style={styles.accountPillText}>{i18n.t('phoneSignIn') || 'Phone sign-in'}</Text>
                  </View>
                )}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{i18n.t('email') || 'Email'}</Text>
                <View style={[styles.inputWrapper, accountEmail && styles.disabledInputWrapper]}>
                  <Ionicons name="mail-outline" size={20} color={accountEmail ? '#bbb' : '#999'} style={styles.inputIcon} />
                  {accountEmail ? (
                    <Text style={styles.readOnlyValueText} selectable>
                      {visibleEmail || (i18n.t('email_ph') || 'Enter email')}
                    </Text>
                  ) : (
                    <TextInput
                      style={styles.input}
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      placeholder={i18n.t('email_ph') || 'Enter email'}
                      placeholderTextColor="#999"
                    />
                  )}
                </View>
                <Text style={styles.fieldHint}>
                  {accountEmail
                    ? (i18n.t('signInEmailLockedHint') || 'This is your actual sign-in email and is shown in full here.')
                    : (i18n.t('contactEmailHint') || 'Optional contact email for updates and recovery.')}
                </Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{i18n.t('phone') || 'Phone'}</Text>
                <View style={[styles.inputWrapper, styles.disabledInputWrapper]}>
                  <Ionicons name="call-outline" size={20} color="#bbb" style={styles.inputIcon} />
                  <Text style={styles.readOnlyValueText} selectable>
                    {visiblePhone || (i18n.t('phone_ph') || 'Enter phone number')}
                  </Text>
                </View>
                <Text style={styles.fieldHint}>
                  {i18n.t('signInPhoneLockedHint') || 'Phone number cannot be changed here. Contact support if an update is needed.'}
                </Text>
              </View>

              <View style={styles.sectionDivider} />
              <Text style={styles.sectionHeading}>{i18n.t('playerDetailsSection') || 'Player details'}</Text>
              <Text style={styles.sectionHelper}>{i18n.t('profileCompletionHint') || 'Complete your details so coaches, academies, and scouts can review you faster.'}</Text>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{i18n.t('city') || 'City'}</Text>
                <TouchableOpacity
                  style={[styles.inputWrapper, styles.cityPickerWrapper]}
                  onPress={() => setShowCityModal(true)}
                >
                  <Ionicons name="location-outline" size={20} color="#999" style={styles.inputIcon} />
                  <Text style={[styles.cityText, !city && styles.cityPlaceholder]}>
                    {city ? (i18n.t('cities', { returnObjects: true }) as Record<string, string>)[city] || city : i18n.t('selectCity')}
                  </Text>
                  <Ionicons name="chevron-down" size={20} color="#999" />
                </TouchableOpacity>

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
                        {Object.entries(i18n.t('cities', { returnObjects: true }) as Record<string, string>).map(([key, label]) => (
                          <TouchableOpacity
                            key={key}
                            style={[styles.cityOption, city === key && styles.cityOptionSelected]}
                            onPress={() => {
                              setCity(key);
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

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{i18n.t('position') || 'Position'}</Text>
                <TouchableOpacity
                  style={[styles.inputWrapper, styles.cityPickerWrapper]}
                  onPress={() => setShowPositionModal(true)}
                >
                  <Ionicons name="football-outline" size={20} color="#999" style={styles.inputIcon} />
                  <Text style={[styles.inputText, !position && styles.inputPlaceholder]}>
                    {position ? getPositionLabel(position) : (i18n.t('selectPosition') || 'Select position')}
                  </Text>
                  <Ionicons name="chevron-down" size={20} color="#999" />
                </TouchableOpacity>
              </View>
              <SimpleSelect
                visible={showPositionModal}
                options={POSITIONS}
                selected={position}
                onSelect={(val) => {
                  setPosition(val);
                }}
                onClose={() => setShowPositionModal(false)}
                label={i18n.t('position') || 'Position'}
                getLabel={getPositionLabel}
              />

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{i18n.t('dob') || 'Date of Birth'}</Text>
                <TouchableOpacity
                  style={styles.inputWrapper}
                  onPress={() => setShowDobPicker(true)}
                >
                  <Ionicons name="calendar-outline" size={20} color="#999" style={styles.inputIcon} />
                  <Text style={[styles.inputText, !dob && styles.inputPlaceholder]}>
                    {dob || (i18n.t('dob_ph') || 'Select date of birth')}
                  </Text>
                </TouchableOpacity>
                {showDobPicker && Platform.OS === 'android' && (
                  <DateTimePicker
                    value={selectedDobDate || new Date(2000, 0, 1)}
                    mode="date"
                    display="default"
                    onChange={handleDobPickerChange}
                    maximumDate={new Date()}
                    minimumDate={new Date(1920, 0, 1)}
                  />
                )}
                {Platform.OS === 'ios' && showDobPicker && (
                  <Modal
                    visible={true}
                    transparent={true}
                    animationType="slide"
                    onRequestClose={() => setShowDobPicker(false)}
                  >
                    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
                      <View style={{ backgroundColor: '#fff', paddingBottom: 20 }}>
                        <TouchableOpacity
                          style={{ padding: 16, alignItems: 'center' }}
                          onPress={() => setShowDobPicker(false)}
                        >
                          <Text style={{ fontSize: 16, fontWeight: '600', color: '#000' }}>Done</Text>
                        </TouchableOpacity>
                        <DateTimePicker
                          value={selectedDobDate || new Date(2000, 0, 1)}
                          mode="date"
                          display="spinner"
                          onChange={handleDobPickerChange}
                          maximumDate={new Date()}
                          minimumDate={new Date(1920, 0, 1)}
                          textColor="#000"
                        />
                      </View>
                    </View>
                  </Modal>
                )}
              </View>

              <View style={styles.saveStatusRow}>
                <Ionicons
                  name={hasChanges ? 'alert-circle-outline' : 'checkmark-circle-outline'}
                  size={18}
                  color={hasChanges ? '#b45309' : '#15803d'}
                />
                <Text style={[styles.saveStatusText, !hasChanges && styles.saveStatusTextSaved]}>
                  {hasChanges
                    ? (i18n.t('unsavedChangesHint') || 'You have unsaved changes ready to save.')
                    : (i18n.t('allChangesSaved') || 'Your profile is already up to date.')}
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.saveButton, (uploading || !hasChanges) && styles.saveButtonDisabled]}
                onPress={handleSave}
                disabled={uploading || !hasChanges}
                activeOpacity={0.8}
              >
                {uploading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>{i18n.t('saveChanges') || 'Save Changes'}</Text>
                )}
              </TouchableOpacity>
        </View>
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
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  menuButton: {
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
    marginBottom: 4,
  },
  profilePhotoHint: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.72)',
    textAlign: 'center',
  },
  overviewCard: {
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 24,
    padding: 18,
    marginBottom: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 5,
  },
  overviewHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  overviewTextWrap: {
    flex: 1,
  },
  profileName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
  },
  profileMeta: {
    fontSize: 13,
    color: '#4b5563',
    lineHeight: 18,
  },
  completionBadge: {
    minWidth: 72,
    backgroundColor: '#111827',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  completionBadgeValue: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
  completionBadgeLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  completionTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: '#e5e7eb',
    overflow: 'hidden',
    marginTop: 14,
    marginBottom: 10,
  },
  completionFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#111827',
  },
  overviewHint: {
    fontSize: 12,
    color: '#4b5563',
    lineHeight: 18,
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
  sectionHeading: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 6,
  },
  sectionHelper: {
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 18,
    marginBottom: 12,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginBottom: 16,
    marginTop: 2,
  },
  accountPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 18,
  },
  accountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f3f4f6',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  accountPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111827',
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
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#000',
    paddingVertical: 16,
  },
  disabledInputWrapper: {
    backgroundColor: '#efefef',
    borderColor: '#e0e0e0',
    opacity: 0.6,
  },
  disabledInput: {
    color: '#888',
  },
  readOnlyValueText: {
    flex: 1,
    fontSize: 15,
    color: '#374151',
    lineHeight: 21,
    paddingVertical: 16,
  },
  fieldHint: {
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 17,
    marginTop: 8,
  },
  inputText: {
    flex: 1,
    fontSize: 16,
    color: '#000',
    paddingVertical: 16,
  },
  inputPlaceholder: {
    color: '#999',
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
  saveStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 4,
    marginBottom: 10,
  },
  saveStatusText: {
    flex: 1,
    fontSize: 12,
    color: '#92400e',
    lineHeight: 18,
    fontWeight: '600',
  },
  saveStatusTextSaved: {
    color: '#166534',
  },
  saveButton: {
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
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
});
