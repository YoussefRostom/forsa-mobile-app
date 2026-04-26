import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import { auth, db } from '../lib/firebase';
import { resolveUserDisplayName } from '../lib/userDisplayName';
import i18n from '../locales/i18n';
import { uploadMedia } from '../services/MediaService';
import FootballLoader from '../components/FootballLoader';

type ClinicProfileState = {
  clinicName: string;
  email: string;
  phone: string;
  description: string;
  contactPerson: string;
  profilePhoto: string;
};

const initialState: ClinicProfileState = {
  clinicName: '',
  email: '',
  phone: '',
  description: '',
  contactPerson: '',
  profilePhoto: '',
};

export default function ClinicEditProfileScreen() {
  const router = useRouter();
  const { openMenu } = useHamburgerMenu();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<ClinicProfileState>(initialState);
  const [initialSnapshot, setInitialSnapshot] = useState<string>('');
  const [initialEmail, setInitialEmail] = useState('');
  const [initialPhone, setInitialPhone] = useState('');

  const setField = (key: keyof ClinicProfileState, value: string) => setState((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    const fetchProfile = async () => {
      setLoading(true);
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) throw new Error(i18n.t('couldNotLoadData') || 'Could not load clinic data.');
        const [clinicSnap, userSnap] = await Promise.all([getDoc(doc(db, 'clinics', uid)), getDoc(doc(db, 'users', uid))]);
        const clinicData = clinicSnap.exists() ? clinicSnap.data() : {};
        const userData = userSnap.exists() ? userSnap.data() : {};
        const merged = { ...userData, ...clinicData };
        const nextState: ClinicProfileState = {
          clinicName: String(merged.clinicName || ''),
          email: String(merged.email || ''),
          phone: String(merged.phone || ''),
          description: String(merged.description || ''),
          contactPerson: String(merged.contactPerson || ''),
          profilePhoto: String(merged.profilePhoto || ''),
        };
        setState(nextState);
        setInitialSnapshot(JSON.stringify(nextState));
        setInitialEmail(nextState.email);
        setInitialPhone(nextState.phone);
      } catch (e: any) {
        Alert.alert(i18n.t('error') || 'Error', e?.message || (i18n.t('couldNotLoadData') || 'Could not load clinic data.'));
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  const hasUnsavedChanges = useMemo(() => JSON.stringify(state) !== initialSnapshot, [state, initialSnapshot]);

  const safeUpdate = async (target: 'clinics' | 'users', uid: string, data: Record<string, any>) => {
    const ref = doc(db, target, uid);
    try {
      await updateDoc(ref, data);
    } catch {
      await setDoc(ref, data, { merge: true });
    }
  };

  const handlePickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(i18n.t('permissionDenied') || 'Permission denied', i18n.t('mediaLibraryPermissionRequired') || 'Media library permission is required.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      setField('profilePhoto', result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setSaving(true);
    try {
      let profilePhotoUrl = state.profilePhoto;
      if (profilePhotoUrl && !profilePhotoUrl.startsWith('http')) {
        const uploaded = await uploadMedia(profilePhotoUrl, 'image');
        profilePhotoUrl = uploaded.secure_url;
      }

      const payload = {
        clinicName: state.clinicName.trim(),
        username: resolveUserDisplayName({ clinicName: state.clinicName }, 'Clinic'),
        email: initialEmail || null,
        emailLowercase: initialEmail.trim().toLowerCase() || null,
        phone: initialPhone || null,
        description: state.description.trim(),
        contactPerson: state.contactPerson.trim() || null,
        profilePhoto: profilePhotoUrl || null,
        updatedAt: new Date().toISOString(),
      };

      await safeUpdate('clinics', uid, payload);
      await safeUpdate('users', uid, payload);

      const next = {
        ...state,
        email: initialEmail || '',
        phone: initialPhone || '',
        profilePhoto: profilePhotoUrl || '',
      };
      setState(next);
      setInitialSnapshot(JSON.stringify(next));
      setInitialEmail(next.email);
      setInitialPhone(next.phone);
      Alert.alert(i18n.t('success') || 'Success', i18n.t('profileUpdated') || 'Profile updated!');
    } catch (e: any) {
      Alert.alert(i18n.t('error') || 'Error', e?.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loaderWrap}>
        <FootballLoader size="large" color="#fff" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient colors={['#000000', '#1a1a1a', '#2d2d2d']} style={styles.gradient}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.menuButton} onPress={openMenu}>
            <Ionicons name="menu" size={24} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle}>{i18n.t('editProfile') || 'Edit Profile'}</Text>
            <Text style={styles.headerSubtitle}>{i18n.t('updateYourInformation') || 'Update your information'}</Text>
          </View>
        </View>

        <HamburgerMenu />

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.formCard}>
            <View style={styles.profileSection}>
              <TouchableOpacity onPress={handlePickPhoto} style={styles.profileImageContainer}>
                {state.profilePhoto ? (
                  <Image source={{ uri: state.profilePhoto }} style={styles.profileImage} />
                ) : (
                  <View style={styles.profileImagePlaceholder}>
                    <Ionicons name="camera" size={32} color="#999" />
                  </View>
                )}
              </TouchableOpacity>
              <TouchableOpacity onPress={handlePickPhoto}>
                <Text style={styles.changeProfileText}>{i18n.t('changeProfilePicture') || 'Change profile picture'}</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionHeading}>{i18n.t('basicInformation') || 'Basic information'}</Text>

            <InputField label={i18n.t('clinicNameLabel') || 'Clinic Name'} value={state.clinicName} onChangeText={(v) => setField('clinicName', v)} />
            <InputField label={i18n.t('email') || 'Email'} value={state.email} onChangeText={(v) => setField('email', v)} keyboardType="email-address" editable={false} />
            <Text style={styles.contactHint}>{i18n.t('signInEmailLockedHint') || 'Email changes are locked for now.'}</Text>
            <InputField label={i18n.t('phone') || 'Phone'} value={state.phone} onChangeText={(v) => setField('phone', v)} keyboardType="phone-pad" editable={false} />
            <Text style={styles.contactHint}>{i18n.t('signInPhoneLockedHint') || 'Phone number changes are locked for now.'}</Text>
            <InputField label={i18n.t('description') || 'Description'} value={state.description} onChangeText={(v) => setField('description', v)} multiline />
            <InputField label={i18n.t('contactPerson') || 'Contact'} value={state.contactPerson} onChangeText={(v) => setField('contactPerson', v)} />

            <Text style={styles.sectionHeading}>{i18n.t('clinicBranchesStep') || 'Branch setup'}</Text>
            <TouchableOpacity style={styles.linkButton} onPress={() => router.push('/clinic-branches')}>
              <Text style={styles.linkButtonText}>{i18n.t('editBranches') || 'Edit Branches'}</Text>
            </TouchableOpacity>

            <Text style={styles.sectionHeading}>{i18n.t('clinicServicesStep') || 'Services & pricing'}</Text>
            <TouchableOpacity style={styles.linkButton} onPress={() => router.push('/clinic-edit-services')}>
              <Text style={styles.linkButtonText}>{i18n.t('editServices') || 'Edit Services'}</Text>
            </TouchableOpacity>

            {hasUnsavedChanges && (
              <View style={styles.unsavedBanner}>
                <Ionicons name="alert-circle-outline" size={16} color="#7c2d12" />
                <Text style={styles.unsavedBannerText}>{i18n.t('unsavedChangesHint') || 'Changes are not saved yet.'}</Text>
              </View>
            )}

            <TouchableOpacity style={[styles.saveButton, saving && styles.saveButtonDisabled]} onPress={handleSave} disabled={saving}>
              {saving ? <FootballLoader color="#fff" /> : <Text style={styles.saveButtonText}>{i18n.t('save') || 'Save'}</Text>}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}

function InputField({
  label,
  value,
  onChangeText,
  keyboardType,
  multiline,
  editable = true,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'phone-pad';
  multiline?: boolean;
  editable?: boolean;
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputWrapper, !editable && styles.disabledInputWrapper]}>
        <TextInput
          style={[styles.input, multiline && styles.inputMultiline, !editable && styles.disabledInput]}
          value={value}
          onChangeText={onChangeText}
          placeholder={label}
          placeholderTextColor="#999"
          keyboardType={keyboardType || 'default'}
          multiline={multiline}
          editable={editable}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  gradient: { flex: 1 },
  loaderWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111' },
  header: { paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingHorizontal: 24, paddingBottom: 20, flexDirection: 'row', alignItems: 'center' },
  menuButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  headerContent: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 4, textAlign: 'center' },
  headerSubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.7)', textAlign: 'center' },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 40 },
  formCard: { backgroundColor: '#fff', borderRadius: 24, padding: 24, marginTop: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20, elevation: 10 },
  profileSection: { alignItems: 'center', marginBottom: 18 },
  profileImageContainer: { marginBottom: 8 },
  profileImage: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#f3f4f6' },
  profileImagePlaceholder: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center' },
  changeProfileText: { color: '#111827', fontWeight: '700' },
  sectionHeading: { fontSize: 16, fontWeight: '800', color: '#111827', marginTop: 8, marginBottom: 8 },
  inputGroup: { marginBottom: 12 },
  label: { fontSize: 13, color: '#374151', fontWeight: '600', marginBottom: 6 },
  inputWrapper: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, backgroundColor: '#f9fafb', paddingHorizontal: 12 },
  disabledInputWrapper: { backgroundColor: '#f3f4f6' },
  input: { color: '#111827', minHeight: 44, fontSize: 15 },
  disabledInput: { color: '#6b7280' },
  inputMultiline: { minHeight: 72, textAlignVertical: 'top', paddingTop: 10 },
  contactHint: { color: '#6b7280', fontSize: 12, marginTop: -4, marginBottom: 12 },
  linkButton: { backgroundColor: '#111827', borderRadius: 12, minHeight: 46, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  linkButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  unsavedBanner: { marginTop: 4, marginBottom: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#ffedd5', flexDirection: 'row', gap: 8, alignItems: 'center' },
  unsavedBannerText: { color: '#7c2d12', fontSize: 12, fontWeight: '600' },
  saveButton: { backgroundColor: '#111827', borderRadius: 14, minHeight: 54, alignItems: 'center', justifyContent: 'center' },
  saveButtonDisabled: { opacity: 0.65 },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
