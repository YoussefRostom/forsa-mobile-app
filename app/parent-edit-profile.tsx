import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useRef, useState, useEffect } from 'react';
import { Alert, Animated, Easing, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import i18n from '../locales/i18n';
import { auth, db } from '../lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { uploadMedia } from '../services/MediaService';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'react-native';

const cities = Object.entries(i18n.t('cities', { returnObjects: true }) as Record<string, string>).map(([key, label]) => ({ key, label }));

export default function ParentEditProfileScreen() {
  const { openMenu } = useHamburgerMenu();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cityModal, setCityModal] = useState(false);
  const [children, setChildren] = useState<{ name: string; age: string }[]>([{ name: '', age: '' }]);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);
  const [showAgeModalIndex, setShowAgeModalIndex] = useState<number | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const ageOptions = Array.from({ length: 13 }, (_, i) => (4 + i).toString());

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
        return;
      }

      // Try fetching from 'parents' collection first as it's role specific
      const docRef = doc(db, 'parents', user.uid);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        setName(data.parentName || '');
        setEmail(data.email || '');
        setPhone(data.phone || '');
        setCity(data.city || '');
        if (data.profilePhoto) {
          setProfilePhoto(data.profilePhoto);
          setProfilePhotoUrl(data.profilePhoto);
        }
        if (data.children && Array.isArray(data.children) && data.children.length > 0) {
          setChildren(data.children);
        }
      } else {
        // Fallback to 'users' collection if not found in 'parents'
        const userDocRef = doc(db, 'users', user.uid);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
          const data = userDocSnap.data();
          setName(data.parentName || data.name || '');
          setEmail(data.email || '');
          setPhone(data.phone || '');
          setCity(data.city || '');
          if (data.profilePhoto) {
            setProfilePhoto(data.profilePhoto);
            setProfilePhotoUrl(data.profilePhoto);
          }
          if (data.children && Array.isArray(data.children) && data.children.length > 0) {
            setChildren(data.children);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
      Alert.alert(i18n.t('error'), 'Failed to load profile data');
    } finally {
      setLoading(false);
    }
  };

  const handlePickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      setProfilePhoto(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    // Only require phone number - other fields are optional
    if (!phone || !phone.trim()) {
      Alert.alert(i18n.t('error'), i18n.t('phoneRequired') || 'Phone number is required');
      return;
    }

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

      const validChildren = children.filter(c => c.name.trim() !== '' && c.age.trim() !== '');

      const updateData: any = {
        phone: phone.trim(),
        updatedAt: new Date().toISOString()
      };

      // Only include optional fields if they have values
      if (name && name.trim()) updateData.parentName = name.trim();
      if (email && email.trim()) updateData.email = email.trim();
      if (city && city.trim()) updateData.city = city.trim();
      if (validChildren.length > 0) updateData.children = validChildren;
      if (finalProfilePhotoUrl) updateData.profilePhoto = finalProfilePhotoUrl;

      // Update both
      await updateDoc(doc(db, 'parents', user.uid), updateData);
      await updateDoc(doc(db, 'users', user.uid), updateData);

      Alert.alert(i18n.t('success'), i18n.t('profileSaved'));
    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert(i18n.t('error'), 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const handleChildChange = (idx: number, value: string) => {
    setChildren((prev) => prev.map((c, i) => i === idx ? { ...c, name: value } : c));
  };
  const handleChildAgeChange = (idx: number, value: string) => {
    setChildren((prev) => prev.map((c, i) => i === idx ? { ...c, age: value } : c));
    setShowAgeModalIndex(null);
  };
  const handleAddChild = () => setChildren((prev) => [...prev, { name: '', age: '' }]);
  const handleRemoveChild = (idx: number) => {
    if (children.length === 1) return;
    setChildren((prev) => prev.filter((_, i) => i !== idx));
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
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.menuButton} onPress={openMenu}>
              <Ionicons name="menu" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.headerContent}>
              <Text style={styles.headerTitle}>{i18n.t('parentEditProfile') || 'Edit Profile'}</Text>
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
              <TouchableOpacity onPress={handlePickPhoto} style={styles.profileImageContainer}>
                {profilePhoto ? (
                  <Image source={{ uri: profilePhoto }} style={styles.profileImage} />
                ) : (
                  <View style={styles.profileImagePlaceholder}>
                    <Ionicons name="camera" size={32} color="#9ca3af" />
                  </View>
                )}
                <View style={styles.profileImageOverlay}>
                  <Ionicons name="camera" size={18} color="#fff" />
                </View>
              </TouchableOpacity>

              <View style={styles.heroTextWrap}>
                <Text style={styles.heroName} numberOfLines={1}>{name?.trim() || (i18n.t('parent') || 'Parent')}</Text>
                <Text style={styles.heroSub}>{i18n.t('updateYourInformation') || 'Update your information'}</Text>
              </View>

              <View style={styles.heroMetaRow}>
                <View style={styles.heroChip}>
                  <Ionicons name="people-outline" size={14} color="#111827" />
                  <Text style={styles.heroChipText}>{children.length} {(i18n.t('children') || 'Children')}</Text>
                </View>
                <TouchableOpacity style={styles.heroGhostBtn} onPress={handlePickPhoto}>
                  <Ionicons name="image-outline" size={14} color="#111827" />
                  <Text style={styles.heroGhostBtnText}>{i18n.t('upload') || 'Upload'}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{i18n.t('personalInformation') || 'Personal Information'}</Text>
                <Text style={styles.sectionHint}>{i18n.t('requiredField') || 'Keep these details up to date.'}</Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{i18n.t('parent_name')}</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="person-outline" size={20} color="#999" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={name}
                    onChangeText={setName}
                    placeholder={i18n.t('parent_name_ph')}
                    placeholderTextColor="#999"
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{i18n.t('email')}</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="mail-outline" size={20} color="#999" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={setEmail}
                    placeholder={i18n.t('email_ph')}
                    placeholderTextColor="#999"
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>
              </View>

              <View style={[styles.inputGroup, styles.inputGroupNoMargin]}>
                <Text style={styles.label}>{i18n.t('phone')}</Text>
                <View style={[styles.inputWrapper, styles.disabledInputWrapper]}>
                  <Ionicons name="call-outline" size={20} color="#bbb" style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, styles.disabledInput]}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder={i18n.t('phone_ph')}
                    placeholderTextColor="#bbb"
                    keyboardType="phone-pad"
                    editable={false}
                  />
                </View>
                <Text style={styles.fieldHint}>{i18n.t('phoneSecurityHint') || 'Phone number is fixed for account security.'}</Text>
              </View>
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{i18n.t('locationLabel') || 'Location'}</Text>
                <Text style={styles.sectionHint}>{i18n.t('locationExperienceHint') || 'Help academies and clinics find you faster.'}</Text>
              </View>

              <View style={[styles.inputGroup, styles.inputGroupNoMargin]}>
                <Text style={styles.label}>{i18n.t('city')}</Text>
                <TouchableOpacity style={styles.inputWrapper} onPress={() => setCityModal(true)}>
                  <Ionicons name="location-outline" size={20} color="#999" style={styles.inputIcon} />
                  <Text style={[styles.cityText, !city && styles.cityPlaceholder]}>
                    {city ? cities.find(c => c.key === city)?.label || city : i18n.t('selectCity')}
                  </Text>
                  <Ionicons name="chevron-down" size={20} color="#999" />
                </TouchableOpacity>
                <Modal visible={cityModal} transparent animationType="fade" onRequestClose={() => setCityModal(false)}>
                  <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setCityModal(false)}>
                    <View style={styles.modalContent}>
                      <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>{i18n.t('selectCity')}</Text>
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
              </View>
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <View>
                  <Text style={styles.sectionTitle}>{i18n.t('child_names') || 'Children'}</Text>
                  <Text style={styles.sectionHint}>{i18n.t('selectAgeToReview') || 'Add your children details for booking.'}</Text>
                </View>
                <TouchableOpacity onPress={handleAddChild} style={styles.addChildButton}>
                  <Ionicons name="add-circle-outline" size={18} color="#111827" />
                  <Text style={styles.addChildText}> {i18n.t('add_child')}</Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.inputGroup, styles.inputGroupNoMargin]}>
                <Text style={styles.label}>{i18n.t('child_names')}</Text>
                {children.map((child, idx) => (
                  <View key={idx} style={styles.childCard}>
                    <View style={styles.childCardHeader}>
                      <Text style={styles.childCardTitle}>{(i18n.t('childName') || 'Child')} {idx + 1}</Text>
                      {children.length > 1 && (
                        <TouchableOpacity onPress={() => handleRemoveChild(idx)} style={styles.removeButton}>
                          <Ionicons name="trash-outline" size={18} color="#ef4444" />
                        </TouchableOpacity>
                      )}
                    </View>

                    <View style={[styles.inputWrapper, styles.childNameInput]}>
                      <Ionicons name="person-outline" size={20} color="#999" style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder={i18n.t('child_name_ph') + ` ${idx + 1}`}
                        value={child.name}
                        onChangeText={(v) => handleChildChange(idx, v)}
                        autoCapitalize="words"
                        placeholderTextColor="#999"
                      />
                    </View>

                    <View style={styles.inputWrapper}>
                      <Ionicons name="calendar-outline" size={20} color="#999" style={styles.inputIcon} />
                      <TouchableOpacity
                        style={{ flex: 1, justifyContent: 'center', paddingRight: 8 }}
                        onPress={() => setShowAgeModalIndex(idx)}
                      >
                        <Text style={[styles.ageText, !child.age && styles.agePlaceholder]} numberOfLines={1}>
                          {child.age ? `${child.age} yrs` : 'Pick age'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <Modal visible={showAgeModalIndex === idx} transparent animationType="fade" onRequestClose={() => setShowAgeModalIndex(null)}>
                      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowAgeModalIndex(null)}>
                        <View style={styles.ageModalContent}>
                          <View style={styles.ageModalHeader}>
                            <Text style={styles.ageModalTitle}>{i18n.t('selectAge') || 'Select Age'}</Text>
                            <TouchableOpacity onPress={() => setShowAgeModalIndex(null)}>
                              <Ionicons name="close" size={24} color="#000" />
                            </TouchableOpacity>
                          </View>
                          <ScrollView style={styles.ageModalScrollView}>
                            {ageOptions.map((age) => (
                              <TouchableOpacity
                                key={age}
                                style={[styles.ageOption, child.age === age && styles.ageOptionSelected]}
                                onPress={() => handleChildAgeChange(idx, age)}
                              >
                                <Text style={[styles.ageOptionText, child.age === age && styles.ageOptionTextSelected]}>
                                  {age} {i18n.t('years') || 'years'}
                                </Text>
                                {child.age === age && <Ionicons name="checkmark" size={20} color="#fff" />}
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        </View>
                      </TouchableOpacity>
                    </Modal>
                  </View>
                ))}
              </View>
            </View>

            <TouchableOpacity style={[styles.saveBtn, saving && styles.saveBtnDisabled]} onPress={handleSave} disabled={saving}>
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>{i18n.t('save')}</Text>
              )}
            </TouchableOpacity>

            <Text style={styles.bottomSafeHint}>{i18n.t('secureSignupHint') || 'Your details are stored securely.'}</Text>
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
    paddingHorizontal: 16,
    paddingBottom: 44,
  },
  heroCard: {
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 18,
    marginTop: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 5,
  },
  heroTextWrap: {
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 12,
  },
  heroName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
  },
  heroSub: {
    marginTop: 4,
    color: '#6b7280',
    fontSize: 13,
    textAlign: 'center',
  },
  heroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  heroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  heroChipText: {
    color: '#111827',
    fontWeight: '700',
    fontSize: 12,
  },
  heroGhostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  heroGhostBtnText: {
    color: '#111827',
    fontWeight: '700',
    fontSize: 12,
  },
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  sectionHeader: {
    marginBottom: 14,
  },
  sectionHeaderRow: {
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  sectionHint: {
    marginTop: 4,
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 17,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputGroupNoMargin: {
    marginBottom: 0,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1f2937',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 16,
    minHeight: 56,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
    paddingVertical: 16,
  },
  disabledInputWrapper: {
    backgroundColor: '#f3f4f6',
    borderColor: '#e5e7eb',
  },
  disabledInput: {
    color: '#888',
  },
  fieldHint: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 8,
  },
  cityText: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
    paddingVertical: 16,
  },
  cityPlaceholder: {
    color: '#999',
  },
  ageText: {
    fontSize: 16,
    color: '#000',
  },
  agePlaceholder: {
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
  childCard: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 14,
    padding: 10,
    marginBottom: 12,
  },
  childCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  childCardTitle: {
    color: '#111827',
    fontWeight: '700',
    fontSize: 13,
  },
  childNameInput: {
    marginBottom: 10,
  },
  removeButton: {
    marginLeft: 6,
    padding: 4,
  },
  addChildButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  addChildText: {
    color: '#111827',
    fontWeight: '700',
    fontSize: 12,
  },
  saveBtn: {
    backgroundColor: '#111827',
    borderRadius: 14,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  profileImageContainer: {
    position: 'relative',
    marginBottom: 0,
    alignSelf: 'center',
  },
  profileImage: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 4,
    borderColor: '#f9fafb',
  },
  profileImagePlaceholder: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#f9fafb',
  },
  profileImageOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#111827',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#f9fafb',
  },
  bottomSafeHint: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 10,
  },
});
