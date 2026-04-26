import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useRef, useState, useEffect } from 'react';
import { Alert, Animated, Easing, Image, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import i18n from '../locales/i18n';
import { buildPersonDisplayName } from '../lib/userDisplayName';
import { auth, db } from '../lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { uploadMedia } from '../services/MediaService';
import FootballLoader from '../components/FootballLoader';

const cities = Object.entries(i18n.t('cities', { returnObjects: true }) as Record<string, string>).map(([key, label]) => ({ key, label }));

export default function AgentEditProfileScreen() {
  const router = useRouter();
  const { openMenu } = useHamburgerMenu();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [agency, setAgency] = useState('');
  const [license, setLicense] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState('');
  const [cityModal, setCityModal] = useState(false);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);
  const [initialProfileState, setInitialProfileState] = useState('');
  const [initialEmail, setInitialEmail] = useState('');
  const [initialPhone, setInitialPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();

    fetchUserData();
  }, [fadeAnim]);

  const fetchUserData = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        setInitialProfileState(JSON.stringify({
          firstName: '',
          lastName: '',
          email: '',
          phone: '',
          agency: '',
          license: '',
          description: '',
          city: '',
          profilePhoto: '',
          profilePhotoUrl: '',
        }));
        setLoading(false);
        return;
      }

      // Try fetching from 'agents' collection first
      const docRef = doc(db, 'agents', user.uid);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        const nextFirstName = data.firstName || '';
        const nextLastName = data.lastName || '';
        const nextEmail = data.email || '';
        const nextPhone = data.phone || '';
        const nextAgency = data.agency || '';
        const nextLicense = data.license || '';
        const nextDescription = data.description || '';
        const nextCity = data.city || '';
        const nextPhoto = data.profilePhoto || '';

        setFirstName(nextFirstName);
        setLastName(nextLastName);
        setEmail(nextEmail);
        setPhone(nextPhone);
        setInitialEmail(nextEmail);
        setInitialPhone(nextPhone);
        setAgency(nextAgency);
        setLicense(nextLicense);
        setDescription(nextDescription);
        setCity(nextCity);
        if (nextPhoto) {
          setProfilePhoto(nextPhoto);
          setProfilePhotoUrl(nextPhoto);
        }
        setInitialProfileState(JSON.stringify({
          firstName: nextFirstName.trim(),
          lastName: nextLastName.trim(),
          email: nextEmail.trim(),
          phone: nextPhone.trim(),
          agency: nextAgency.trim(),
          license: nextLicense.trim(),
          description: nextDescription.trim(),
          city: nextCity.trim(),
          profilePhoto: nextPhoto.trim(),
          profilePhotoUrl: nextPhoto.trim(),
        }));
      } else {
        // Fallback to 'users' collection
        const userDocRef = doc(db, 'users', user.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          const data = userDocSnap.data();
          const nextFirstName = data.firstName || '';
          const nextLastName = data.lastName || '';
          const nextEmail = data.email || '';
          const nextPhone = data.phone || '';
          const nextAgency = data.agency || '';
          const nextLicense = data.license || '';
          const nextDescription = data.description || '';
          const nextCity = data.city || '';
          const nextPhoto = data.profilePhoto || '';

          setFirstName(nextFirstName);
          setLastName(nextLastName);
          setEmail(nextEmail);
          setPhone(nextPhone);
          setInitialEmail(nextEmail);
          setInitialPhone(nextPhone);
          setAgency(nextAgency);
          setLicense(nextLicense);
          setDescription(nextDescription);
          setCity(nextCity);
          if (nextPhoto) {
            setProfilePhoto(nextPhoto);
            setProfilePhotoUrl(nextPhoto);
          }
          setInitialProfileState(JSON.stringify({
            firstName: nextFirstName.trim(),
            lastName: nextLastName.trim(),
            email: nextEmail.trim(),
            phone: nextPhone.trim(),
            agency: nextAgency.trim(),
            license: nextLicense.trim(),
            description: nextDescription.trim(),
            city: nextCity.trim(),
            profilePhoto: nextPhoto.trim(),
            profilePhotoUrl: nextPhoto.trim(),
          }));
        } else {
          setInitialProfileState(JSON.stringify({
            firstName: '',
            lastName: '',
            email: '',
            phone: '',
            agency: '',
            license: '',
            description: '',
            city: '',
            profilePhoto: '',
            profilePhotoUrl: '',
          }));
        }
      }
    } catch (error) {
      console.error('Error fetching agent data:', error);
      Alert.alert(i18n.t('error'), 'Failed to load profile data');
    } finally {
      setLoading(false);
    }
  };

  const handlePickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      setProfilePhoto(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const user = auth.currentUser;
      if (!user) {
        Alert.alert(i18n.t('error'), 'User not authenticated');
        return;
      }

      let finalProfilePhotoUrl = profilePhotoUrl;

      // Upload profile photo if it's a new local image
      if (profilePhoto && profilePhoto !== profilePhotoUrl && 
          (profilePhoto.startsWith('file://') || profilePhoto.startsWith('content://'))) {
        try {
          const cloudinaryResponse = await uploadMedia(profilePhoto, 'image');
          finalProfilePhotoUrl = cloudinaryResponse.secure_url;
          setProfilePhotoUrl(finalProfilePhotoUrl);
        } catch (error) {
          console.error('Error uploading profile photo:', error);
          Alert.alert(i18n.t('error'), 'Failed to upload profile photo');
          setSaving(false);
          return;
        }
      }

      const updateData: any = {
        phone: initialPhone || null,
        email: initialEmail || null,
        emailLowercase: initialEmail.trim().toLowerCase() || null,
        updatedAt: new Date().toISOString(),
        username: buildPersonDisplayName(firstName, lastName) || 'Agent',
      };

      // Only include optional fields if they have values
      if (firstName && firstName.trim()) updateData.firstName = firstName.trim();
      if (lastName && lastName.trim()) updateData.lastName = lastName.trim();
      if (agency && agency.trim()) updateData.agency = agency.trim();
      if (license && license.trim()) updateData.license = license.trim();
      if (description.trim()) updateData.description = description.trim();
      if (city && city.trim()) updateData.city = city.trim();
      if (finalProfilePhotoUrl) updateData.profilePhoto = finalProfilePhotoUrl;

      // Update both collections
      await updateDoc(doc(db, 'agents', user.uid), updateData);
      await updateDoc(doc(db, 'users', user.uid), updateData);

      if (finalProfilePhotoUrl) {
        setProfilePhoto(finalProfilePhotoUrl);
        setProfilePhotoUrl(finalProfilePhotoUrl);
      }
      setEmail(initialEmail || '');
      setPhone(initialPhone || '');
      setInitialEmail(initialEmail || '');
      setInitialPhone(initialPhone || '');
      setInitialProfileState(JSON.stringify({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: initialEmail || '',
        phone: initialPhone || '',
        agency: agency.trim(),
        license: license.trim(),
        description: description.trim(),
        city: city.trim(),
        profilePhoto: (finalProfilePhotoUrl || profilePhoto || '').trim(),
        profilePhotoUrl: (finalProfilePhotoUrl || profilePhotoUrl || '').trim(),
      }));

      Alert.alert(i18n.t('success'), i18n.t('profileUpdated') || 'Profile updated successfully');
      router.back();
    } catch (error) {
      console.error('Error updating agent profile:', error);
      Alert.alert(i18n.t('error'), 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a1a' }}>
        <FootballLoader size="large" color="#fff" />
      </View>
    );
  }

  const displayName = `${firstName || ''} ${lastName || ''}`.trim() || (i18n.t('agent') || 'Agent');
  const completionFields = [firstName, lastName, email, agency, license, description, city, profilePhotoUrl || profilePhoto].filter(Boolean).length;
  const completionPercent = Math.round((completionFields / 8) * 100);
  const cityLabel = city ? cities.find(c => c.key === city)?.label || city : (i18n.t('selectCity') || 'Select City');
  const currentProfileState = JSON.stringify({
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    email: email.trim(),
    phone: phone.trim(),
    agency: agency.trim(),
    license: license.trim(),
    description: description.trim(),
    city: city.trim(),
    profilePhoto: (profilePhoto || '').trim(),
    profilePhotoUrl: (profilePhotoUrl || '').trim(),
  });
  const hasUnsavedChanges = initialProfileState !== '' && currentProfileState !== initialProfileState;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient
        colors={['#000000', '#1a1a1a', '#2d2d2d']}
        style={styles.gradient}
      >
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.menuButton} onPress={openMenu}>
              <Ionicons name="menu" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.headerContent}>
              <Text style={styles.headerTitle}>{i18n.t('agentEditProfile') || 'Edit Profile'}</Text>
              <Text style={styles.headerSubtitle}>{i18n.t('updateYourInformation') || 'Update your information'}</Text>
            </View>
          </View>

          <HamburgerMenu />

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.heroCard}>
              <View style={styles.heroTop}>
                <TouchableOpacity onPress={handlePickPhoto} style={styles.profileImageContainer}>
                  {profilePhoto ? (
                    <Image source={{ uri: profilePhoto }} style={styles.profileImage} />
                  ) : (
                    <View style={styles.profileImagePlaceholder}>
                      <Ionicons name="camera" size={30} color="#999" />
                    </View>
                  )}
                  <View style={styles.profileImageOverlay}>
                    <Ionicons name="camera" size={16} color="#fff" />
                  </View>
                </TouchableOpacity>
                <View style={styles.heroTextWrap}>
                  <Text style={styles.heroName}>{displayName}</Text>
                  <Text style={styles.heroSub}>{agency?.trim() || (i18n.t('agentEditProfile') || 'Agent Profile')}</Text>
                  <View style={styles.completionRow}>
                    <View style={styles.completionTrack}>
                      <View style={[styles.completionFill, { width: `${completionPercent}%` }]} />
                    </View>
                    <Text style={styles.completionText}>{completionPercent}%</Text>
                  </View>
                </View>
              </View>
              <Text style={styles.profileLabel}>{i18n.t('uploadProfilePic') || 'Tap photo to update your profile picture'}</Text>
            </View>

            <View style={styles.formCard}>
              <Text style={styles.sectionTitle}>Identity</Text>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{i18n.t('firstName')}</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="person-outline" size={20} color="#777" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={firstName}
                    onChangeText={setFirstName}
                    placeholder={i18n.t('firstName')}
                    placeholderTextColor="#999"
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{i18n.t('lastName')}</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="person-outline" size={20} color="#777" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={lastName}
                    onChangeText={setLastName}
                    placeholder={i18n.t('lastName')}
                    placeholderTextColor="#999"
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{i18n.t('email')}</Text>
                <View style={[styles.inputWrapper, styles.disabledInputWrapper]}>
                  <Ionicons name="mail-outline" size={20} color="#777" style={styles.inputIcon} />
                  <Text style={styles.readOnlyValueText} selectable>
                    {email || '-'}
                  </Text>
                </View>
                <Text style={styles.phoneHelperText}>{i18n.t('signInEmailLockedHint') || 'Email changes are locked for now.'}</Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{i18n.t('phone')}</Text>
                <View style={[styles.inputWrapper, styles.disabledInputWrapper]}>
                  <Ionicons name="call-outline" size={20} color="#777" style={styles.inputIcon} />
                  <Text style={styles.readOnlyValueText} selectable>
                    {phone || '-'}
                  </Text>
                </View>
                <Text style={styles.phoneHelperText}>{i18n.t('signInPhoneLockedHint') || 'Phone number changes are locked for now.'}</Text>
              </View>

              <Text style={styles.sectionTitle}>Professional</Text>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{i18n.t('agencyName')}</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="business-outline" size={20} color="#777" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={agency}
                    onChangeText={setAgency}
                    placeholder={i18n.t('agencyName')}
                    placeholderTextColor="#999"
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{i18n.t('licenseNumber')}</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="document-text-outline" size={20} color="#777" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={license}
                    onChangeText={setLicense}
                    placeholder={i18n.t('licenseNumber')}
                    placeholderTextColor="#999"
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{i18n.t('city')}</Text>
                <TouchableOpacity style={styles.inputWrapper} onPress={() => setCityModal(true)}>
                  <Ionicons name="location-outline" size={20} color="#777" style={styles.inputIcon} />
                  <Text style={[styles.cityText, !city && styles.cityPlaceholder]}>{cityLabel}</Text>
                  <Ionicons name="chevron-down" size={20} color="#888" />
                </TouchableOpacity>
              </View>

              <View style={styles.inputGroup}>
                <View style={styles.bioLabelRow}>
                  <Text style={styles.label}>{i18n.t('description') || 'Bio / Description'}</Text>
                  <Text style={styles.bioCount}>{description.length}/220</Text>
                </View>
                <View style={[styles.inputWrapper, styles.textAreaWrapper]}>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    value={description}
                    onChangeText={setDescription}
                    maxLength={220}
                    placeholder={i18n.t('descriptionPlaceholder') || 'Tell players what makes you different...'}
                    placeholderTextColor="#999"
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                  />
                </View>
              </View>

              {hasUnsavedChanges && (
                <View style={styles.unsavedBanner}>
                  <Ionicons name="alert-circle-outline" size={16} color="#7c2d12" />
                  <Text style={styles.unsavedBannerText}>{i18n.t('unsavedChangesHint') || 'Changes are not saved yet.'}</Text>
                </View>
              )}

              <TouchableOpacity style={[styles.saveBtn, saving && styles.saveBtnDisabled]} onPress={handleSave} disabled={saving}>
                {saving ? (
                  <FootballLoader color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={18} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={styles.saveBtnText}>{i18n.t('save') || 'Save'}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <Modal visible={cityModal} transparent animationType="fade" onRequestClose={() => setCityModal(false)}>
              <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setCityModal(false)}>
                <View style={styles.modalContent}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>{i18n.t('selectCity') || 'Select City'}</Text>
                    <TouchableOpacity onPress={() => setCityModal(false)}>
                      <Ionicons name="close" size={24} color="#000" />
                    </TouchableOpacity>
                  </View>
                  <ScrollView style={styles.modalScrollView}>
                    {cities.map((item) => (
                      <TouchableOpacity
                        key={item.key}
                        style={[styles.cityOption, city === item.key && styles.cityOptionSelected]}
                        onPress={() => {
                          setCity(item.key);
                          setCityModal(false);
                        }}
                      >
                        <Text style={[styles.cityOptionText, city === item.key && styles.cityOptionTextSelected]}>
                          {item.label}
                        </Text>
                        {city === item.key && <Ionicons name="checkmark" size={20} color="#fff" />}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </TouchableOpacity>
            </Modal>
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
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuButton: {
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
    marginLeft: -44,
    paddingHorizontal: 44,
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
    paddingBottom: 48,
  },
  heroCard: {
    borderRadius: 22,
    overflow: 'hidden',
    marginBottom: 18,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  heroTop: {
    backgroundColor: '#111',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroTextWrap: {
    flex: 1,
    marginLeft: 12,
  },
  heroName: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 4,
  },
  heroSub: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    marginBottom: 10,
  },
  completionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  completionTrack: {
    flex: 1,
    height: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
    marginRight: 8,
  },
  completionFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#34d399',
  },
  completionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  profileImageContainer: {
    position: 'relative',
  },
  profileImage: {
    width: 98,
    height: 98,
    borderRadius: 49,
    borderWidth: 3,
    borderColor: '#fff',
  },
  profileImagePlaceholder: {
    width: 98,
    height: 98,
    borderRadius: 49,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#fff',
  },
  profileImageOverlay: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  profileLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4b5563',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  formCard: {
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 24,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    color: '#6b7280',
    marginBottom: 12,
    textTransform: 'uppercase',
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
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    paddingHorizontal: 16,
    minHeight: 56,
  },
  textAreaWrapper: {
    alignItems: 'flex-start',
    minHeight: 110,
    paddingVertical: 8,
  },
  textArea: {
    minHeight: 90,
    paddingVertical: 8,
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
    backgroundColor: '#f3f4f6',
    borderColor: '#e5e7eb',
    opacity: 0.8,
  },
  readOnlyValueText: {
    flex: 1,
    fontSize: 16,
    color: '#888',
    paddingVertical: 16,
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
  phoneHelperText: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 8,
  },
  bioLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bioCount: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '600',
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
  saveBtn: {
    backgroundColor: '#000',
    borderRadius: 12,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  unsavedBanner: {
    marginTop: 8,
    marginBottom: 12,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ffedd5',
    borderWidth: 1,
    borderColor: '#fdba74',
  },
  unsavedBannerText: {
    flex: 1,
    color: '#7c2d12',
    fontSize: 12,
    fontWeight: '700',
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
});
