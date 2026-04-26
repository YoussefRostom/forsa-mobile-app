import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useFocusEffect } from 'expo-router';
import { doc, getDoc, updateDoc, collection, query, where, getDocs, deleteDoc, addDoc } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import i18n from '../locales/i18n';
import { buildBookingBranchPayload, getBranchSummary, normalizeBookingBranches } from '../lib/bookingBranch';
import { resolveUserDisplayName } from '../lib/userDisplayName';
import { auth, db } from '../lib/firebase';
import { uploadMedia } from '../services/MediaService';
import * as ImagePicker from 'expo-image-picker';
import FootballLoader from '../components/FootballLoader';

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 15) {
    TIME_OPTIONS.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
  }
}

const LOCATION_PICKER_RESULT_KEY = 'academyEditLocationPickerResult';
export default function AcademyEditProfileScreen({ academyName: academyNameProp }: { academyName?: string }) {
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [academyName, setAcademyName] = useState(academyNameProp || '');
  const [description, setDescription] = useState('');
  const [mapUrl, setMapUrl] = useState('');
  const [latitudeInput, setLatitudeInput] = useState('');
  const [longitudeInput, setLongitudeInput] = useState('');
  const [prices, setPrices] = useState<{ [key: string]: string }>({});
  const [selected, setSelected] = useState<string[]>([]);
  const { openMenu } = useHamburgerMenu();
  const [profilePic, setProfilePic] = useState<string | null>(null);
  const [profilePicUrl, setProfilePicUrl] = useState<string | null>(null);
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [editingContactPerson, setEditingContactPerson] = useState(false);
  const [schedule, setSchedule] = useState<{ [age: string]: { day: string; time: string } }>({});
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [initialProfileState, setInitialProfileState] = useState('');
  const [initialEmail, setInitialEmail] = useState('');
  const [initialPhone, setInitialPhone] = useState('');

  const parseCoordinateValue = (value: string): number | null => {
    const normalized = value.trim().replace(/,/g, '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  };

  const extractCoordinatesFromMapUrl = (url: string): { latitude: number; longitude: number } | null => {
    if (!url?.trim()) return null;

    const decodedUrl = decodeURIComponent(url.trim());
    const patterns = [
      /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
      /[?&](?:q|query|destination)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
      /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    ];

    for (const pattern of patterns) {
      const match = decodedUrl.match(pattern);
      if (match) {
        const latitude = Number(match[1]);
        const longitude = Number(match[2]);
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          return { latitude, longitude };
        }
      }
    }

    return null;
  };

  const [privateTrainings, setPrivateTrainings] = useState<any[]>([]);
  const [deletedTrainings, setDeletedTrainings] = useState<string[]>([]);
  const [academyLocations, setAcademyLocations] = useState<any[]>([]);

  const serializeAcademyState = (state: {
    academyName: string;
    description: string;
    mapUrl: string;
    latitudeInput: string;
    longitudeInput: string;
    contactPerson: string;
    phone: string;
    email: string;
    prices: { [key: string]: string };
    selected: string[];
    schedule: { [age: string]: { day: string; time: string } };
    profilePic: string;
    profilePicUrl: string;
    privateTrainings: any[];
  }) => {
    const sortedPrices = Object.keys(state.prices)
      .sort()
      .reduce((acc: Record<string, string>, key) => {
        acc[key] = state.prices[key];
        return acc;
      }, {});

    const normalizedTrainings = state.privateTrainings.map((training) => ({
      id: training?.id || '',
      coachName: (training?.coachName || '').trim(),
      privateTrainingPrice: String(training?.privateTrainingPrice || '').trim(),
      coachBio: (training?.coachBio || '').trim(),
      specializations: (training?.specializations || '').trim(),
      sessionDuration: String(training?.sessionDuration || '').trim(),
      availability: (training?.availability || '').trim(),
      branchId: (training?.branchId || '').trim(),
      branchName: (training?.branchName || '').trim(),
      branchAddress: (training?.branchAddress || '').trim(),
    }));

    return JSON.stringify({
      academyName: state.academyName.trim(),
      description: state.description.trim(),
      mapUrl: state.mapUrl.trim(),
      latitudeInput: state.latitudeInput.trim(),
      longitudeInput: state.longitudeInput.trim(),
      contactPerson: state.contactPerson.trim(),
      phone: state.phone.trim(),
      email: state.email.trim(),
      prices: sortedPrices,
      selected: [...state.selected].sort(),
      schedule: state.schedule,
      profilePic: state.profilePic.trim(),
      profilePicUrl: state.profilePicUrl.trim(),
      privateTrainings: normalizedTrainings,
    });
  };

  const updateTraining = (index: number, field: string, value: string) => {
    setPrivateTrainings(prev => prev.map((t, i) => i === index ? { ...t, [field]: value } : t));
  };
  const addTraining = () => {
    setPrivateTrainings(prev => [...prev, { coachName: '', privateTrainingPrice: '', coachBio: '', specializations: '', sessionDuration: '60', availability: '', branchId: '', branchName: '', branchAddress: '' }]);
  };
  const removeTraining = (index: number) => {
    const trainingToRemove = privateTrainings[index];
    if (trainingToRemove.id) {
      setDeletedTrainings(prev => [...prev, trainingToRemove.id]);
    }
    setPrivateTrainings(prev => prev.filter((_, i) => i !== index));
  };

  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  useFocusEffect(
    React.useCallback(() => {
      let active = true;

      const consumePickedLocation = async () => {
        try {
          const stored = await AsyncStorage.getItem(LOCATION_PICKER_RESULT_KEY);
          if (!stored || !active) return;

          const picked = JSON.parse(stored);
          if (picked?.latitude !== undefined && picked?.longitude !== undefined) {
            setLatitudeInput(String(picked.latitude));
            setLongitudeInput(String(picked.longitude));
            if (picked.mapUrl) {
              setMapUrl(picked.mapUrl);
            }
          }

          await AsyncStorage.removeItem(LOCATION_PICKER_RESULT_KEY);
        } catch (error) {
          console.warn('Failed to restore picked academy location on edit profile', error);
        }
      };

      consumePickedLocation();

      return () => {
        active = false;
      };
    }, [])
  );

  useEffect(() => {
    async function fetchProfile() {
      setLoading(true);
      setFetchError(null);
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) {
          setFetchError(i18n.t('couldNotLoadData') || 'Not signed in.');
          setInitialProfileState(serializeAcademyState({
            academyName: '',
            description: '',
            mapUrl: '',
            latitudeInput: '',
            longitudeInput: '',
            contactPerson: '',
            phone: '',
            email: '',
            prices: {},
            selected: [],
            schedule: {},
            profilePic: '',
            profilePicUrl: '',
            privateTrainings: [],
          }));
          return;
        }
        const docRef = doc(db, 'academies', uid);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) {
          setFetchError(i18n.t('couldNotLoadData') || 'Academy profile not found.');
          return;
        }
        const data = docSnap.data();
        const feesOrPrices = data.fees || data.prices || {};
        const nextSelected = Object.keys(feesOrPrices).length ? Object.keys(feesOrPrices) : [];
        const nextSchedule = data.schedule || {};
        setPrices(feesOrPrices);
        setSelected(nextSelected);
        setSchedule(nextSchedule);
        const photoUrl = data.profilePhoto || data.profilePic;
        if (photoUrl) {
          setProfilePic(photoUrl);
          setProfilePicUrl(photoUrl);
        }
        if (data.academyName) setAcademyName(data.academyName);
        // Removed city from main profile (now managed per-branch)
        if (data.description) setDescription(data.description);
        if (data.contactPerson) setContactPerson(data.contactPerson);
        if (data.phone) setPhone(data.phone);
        if (data.email) setEmail(data.email);
        setInitialPhone(data.phone || '');
        setInitialEmail(data.email || '');
        if (data.mapUrl) setMapUrl(data.mapUrl);
        setAcademyLocations(normalizeBookingBranches(data.locations || []));

        const savedLatitude = data.latitude ?? data.coordinates?.latitude;
        const savedLongitude = data.longitude ?? data.coordinates?.longitude;
        if (savedLatitude !== undefined && savedLatitude !== null) setLatitudeInput(String(savedLatitude));
        if (savedLongitude !== undefined && savedLongitude !== null) setLongitudeInput(String(savedLongitude));

        // Fetch private trainings
        const programsQuery = query(collection(db, 'academy_programs'), where('academyId', '==', uid), where('type', '==', 'private_training'), where('isActive', '==', true));
        const programsSnap = await getDocs(programsQuery);
        const pData = programsSnap.docs.map(d => {
          const pd = d.data();
          return {
            id: d.id,
            coachName: pd.coachName || '',
            privateTrainingPrice: pd.fee ? pd.fee.toString() : '',
            coachBio: pd.coachBio || '',
            specializations: pd.specializations ? pd.specializations.join(', ') : '',
            sessionDuration: pd.duration ? pd.duration.toString() : '60',
            availability: pd.availability && pd.availability.general ? pd.availability.general : '',
            branchId: pd.branchId || '',
            branchName: pd.branchName || '',
            branchAddress: pd.branchAddress || '',
          };
        });
        const nextTrainings = pData.length > 0
          ? pData
          : [{ coachName: '', privateTrainingPrice: '', coachBio: '', specializations: '', sessionDuration: '60', availability: '', branchId: '', branchName: '', branchAddress: '' }];

        setPrivateTrainings(nextTrainings);

        setInitialProfileState(serializeAcademyState({
          academyName: data.academyName || '',
          // Removed city from main profile (now managed per-branch)
          description: data.description || '',
          mapUrl: data.mapUrl || '',
          latitudeInput: savedLatitude !== undefined && savedLatitude !== null ? String(savedLatitude) : '',
          longitudeInput: savedLongitude !== undefined && savedLongitude !== null ? String(savedLongitude) : '',
          contactPerson: data.contactPerson || '',
          phone: data.phone || '',
          email: data.email || '',
          prices: feesOrPrices,
          selected: nextSelected,
          schedule: nextSchedule,
          profilePic: photoUrl || '',
          profilePicUrl: photoUrl || '',
          privateTrainings: nextTrainings,
        }));
      } catch (e: any) {
        setFetchError(e?.message || i18n.t('couldNotLoadData') || 'Could not load academy data.');
      } finally {
        setLoading(false);
      }
    }
    fetchProfile();
  }, []);


  const handlePickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      setProfilePic(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      Alert.alert(i18n.t('error') || 'Error', 'User not authenticated');
      return;
    }
    setSaving(true);
    try {
  
      let finalProfilePicUrl = profilePicUrl;
  
      // Upload profile photo if it's a new local image
      if (
        profilePic &&
        profilePic !== profilePicUrl &&
        (profilePic.startsWith('file://') ||
          profilePic.startsWith('content://'))
      ) {
        try {
          const cloudinaryResponse = await uploadMedia(profilePic, 'image');
          finalProfilePicUrl = cloudinaryResponse.secure_url;
          setProfilePicUrl(finalProfilePicUrl);
        } catch (error) {
          console.error('Error uploading profile photo:', error);
          Alert.alert(i18n.t('error') || 'Error', 'Failed to upload profile photo');
          setSaving(false);
          return;
        }
      }
  
      const academyRef = doc(db, 'academies', uid);

      const feesObj: { [key: string]: string | number } = {};
      Object.entries(prices).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') {
          feesObj[k] = isNaN(Number(v)) ? v : Number(v);
        }
      });

      const manualLatitude = parseCoordinateValue(latitudeInput);
      const manualLongitude = parseCoordinateValue(longitudeInput);
      const hasAnyCoordinate = latitudeInput.trim().length > 0 || longitudeInput.trim().length > 0;

      if (hasAnyCoordinate) {
        const coordinatesIncomplete = manualLatitude === null || manualLongitude === null;
        const coordinatesInvalid = Number.isNaN(manualLatitude) || Number.isNaN(manualLongitude);
        const coordinatesOutOfRange =
          (!coordinatesIncomplete && !coordinatesInvalid) && (
            manualLatitude! < -90 || manualLatitude! > 90 || manualLongitude! < -180 || manualLongitude! > 180
          );

        if (coordinatesIncomplete) {
          Alert.alert(i18n.t('error') || 'Error', i18n.t('enterBothCoordinates') || 'Enter both latitude and longitude, or leave both blank.');
          setSaving(false);
          return;
        }

        if (coordinatesInvalid || coordinatesOutOfRange) {
          Alert.alert(i18n.t('error') || 'Error', i18n.t('invalidCoordinates') || 'Enter valid map coordinates.');
          setSaving(false);
          return;
        }
      }

      let geoFields: any = {};
      const hasManualCoordinates =
        manualLatitude !== null &&
        manualLongitude !== null &&
        !Number.isNaN(manualLatitude) &&
        !Number.isNaN(manualLongitude);

      if (hasManualCoordinates) {
        geoFields = {
          latitude: manualLatitude,
          longitude: manualLongitude,
          coordinates: {
            latitude: manualLatitude,
            longitude: manualLongitude,
          },
        };
      } else {
        const parsedFromMapUrl = extractCoordinatesFromMapUrl(mapUrl);
        if (parsedFromMapUrl) {
          geoFields = {
            latitude: parsedFromMapUrl.latitude,
            longitude: parsedFromMapUrl.longitude,
            coordinates: {
              latitude: parsedFromMapUrl.latitude,
              longitude: parsedFromMapUrl.longitude,
            },
          };
        }
      }

      const updateData: any = {
        fees: feesObj,
        schedule,
        contactPerson: contactPerson || null,
        phone: initialPhone || null,
        email: initialEmail || null,
        emailLowercase: initialEmail.trim().toLowerCase() || null,
        academyName: academyName || null,
        username: resolveUserDisplayName({ academyName }, 'Academy'),
        // Removed city from main profile (now managed per-branch)
        description: description || null,
        mapUrl: mapUrl.trim() || null,
        updatedAt: new Date().toISOString(),
        ...geoFields,
      };
      if (finalProfilePicUrl) {
        updateData.profilePhoto = finalProfilePicUrl;
        updateData.profilePic = finalProfilePicUrl;
      }

      await updateDoc(academyRef, updateData);

      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, updateData);

      // Handle private trainings update
      for (const training of privateTrainings) {
        if (training.coachName && training.privateTrainingPrice) {
          const selectedBranch = academyLocations.find((branch) => branch.id === training.branchId) || null;
          const programData: any = {
            academyId: uid,
            name: 'Private Training',
            type: 'private_training',
            fee: parseFloat(training.privateTrainingPrice) || 0,
            description: `Private training sessions with ${training.coachName}`,
            coachName: training.coachName,
            coachBio: training.coachBio || null,
            specializations: typeof training.specializations === 'string' ? training.specializations.split(',').map((s: string) => s.trim()) : (training.specializations || []),
            maxParticipants: 1,
            duration: parseInt(training.sessionDuration) || 60,
            availability: typeof training.availability === 'string' ? { general: training.availability } : (training.availability || null),
            ...buildBookingBranchPayload(selectedBranch || training),
            isActive: true,
            updatedAt: new Date().toISOString(),
          };

          if (training.id) {
            await updateDoc(doc(db, 'academy_programs', training.id), programData);
          } else {
            programData.createdAt = new Date().toISOString();
            await addDoc(collection(db, 'academy_programs'), programData);
          }
        }
      }

      // Handle deletions
      for (const tId of deletedTrainings) {
        await deleteDoc(doc(db, 'academy_programs', tId));
      }

      Alert.alert(
        i18n.t('success') || 'Success',
        i18n.t('profileUpdated') || 'Profile updated successfully'
      );

      if (finalProfilePicUrl) {
        setProfilePic(finalProfilePicUrl);
        setProfilePicUrl(finalProfilePicUrl);
      }
      setEmail(initialEmail || '');
      setPhone(initialPhone || '');
      setInitialEmail(initialEmail || '');
      setInitialPhone(initialPhone || '');
      setInitialProfileState(serializeAcademyState({
        academyName,
        // Removed city from main profile (now managed per-branch)
        description,
        mapUrl,
        latitudeInput,
        longitudeInput,
        contactPerson,
        phone: initialPhone || '',
        email: initialEmail || '',
        prices,
        selected,
        schedule,
        profilePic: finalProfilePicUrl || profilePic || '',
        profilePicUrl: finalProfilePicUrl || profilePicUrl || '',
        privateTrainings,
      }));
  
      if (router.canGoBack()) {
        router.back();
      }
    } catch (error) {
      console.error('Error updating academy profile:', error);
      Alert.alert(i18n.t('error') || 'Error', 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }}>
        <FootballLoader size="large" color="#fff" />
      </View>
    );
  }
  if (fetchError) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }}>
        <Text style={{ color: '#ff3b30' }}>{fetchError}</Text>
      </View>
    );
  }

  const hasUnsavedChanges =
    initialProfileState !== '' &&
    serializeAcademyState({
      academyName,
      // Removed city from main profile (now managed per-branch)
      description,
      mapUrl,
      latitudeInput,
      longitudeInput,
      contactPerson,
      phone,
      email,
      prices,
      selected,
      schedule,
      profilePic: profilePic || '',
      profilePicUrl: profilePicUrl || '',
      privateTrainings,
    }) !== initialProfileState;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient
        colors={['#000000', '#1a1a1a', '#2d2d2d']}
        style={styles.gradient}
      >
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.menuButton} onPress={openMenu}>
              <Ionicons name="menu" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.headerContent}>
              <Text style={styles.headerTitle}>{i18n.t('editProfile') || 'Edit Profile'}</Text>
              <Text style={styles.headerSubtitle}>{i18n.t('updateYourInformation') || 'Update your academy information'}</Text>
              </View>
          </View>

          <HamburgerMenu />

          <ScrollView 
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.formCard}>
              {/* Profile Picture */}
              <View style={styles.profileSection}>
                <TouchableOpacity onPress={handlePickPhoto} style={styles.profileImageContainer}>
                  {profilePic ? (
                    <Image source={{ uri: profilePic }} style={styles.profileImage} />
                  ) : (
                    <View style={styles.profileImagePlaceholder}>
                      <Ionicons name="camera" size={32} color="#999" />
                    </View>
                  )}
                  <View style={styles.profileImageOverlay}>
                    <Ionicons name="camera" size={16} color="#fff" />
            </View>
          </TouchableOpacity>
        <TouchableOpacity onPress={handlePickPhoto}>
                  <Text style={styles.changeProfileText}>{i18n.t('changeProfilePicture')}</Text>
        </TouchableOpacity>
      </View>
              <View style={styles.overviewCard}>
                <Text style={styles.overviewTitle}>{academyName || (i18n.t('academyNameLabel') || 'Academy')}</Text>
                <Text style={styles.overviewHint}>{i18n.t('academySignupProgressHint') || 'A complete academy profile helps families understand your branches and pricing faster.'}</Text>
              </View>
              <Text style={styles.sectionHeading}>{i18n.t('basicInformation') || 'Basic information'}</Text>

              {/* Academy Name (editable) */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>{i18n.t('academyNameLabel') || 'Academy Name'}</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="school-outline" size={20} color="#999" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={academyName}
                    onChangeText={setAcademyName}
                    placeholder={i18n.t('academy_name_placeholder') || 'Academy name'}
                    placeholderTextColor="#999"
                  />
                </View>
              </View>

              {/* Email */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>{i18n.t('email') || 'Email'}</Text>
                <View style={[styles.inputWrapper, styles.disabledInputWrapper]}>
                  <Ionicons name="mail-outline" size={20} color="#999" style={styles.inputIcon} />
                  <Text style={styles.readOnlyValueText} selectable>
                    {email || '-'}
                  </Text>
                </View>
                <Text style={styles.helperText}>{i18n.t('signInEmailLockedHint') || 'Email changes are locked for now.'}</Text>
              </View>

              {/* Phone */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>{i18n.t('phone') || 'Phone'}</Text>
                <View style={[styles.inputWrapper, styles.disabledInputWrapper]}>
                  <Ionicons name="call-outline" size={20} color="#999" style={styles.inputIcon} />
                  <Text style={styles.readOnlyValueText} selectable>
                    {phone || '-'}
                  </Text>
                </View>
                <Text style={styles.helperText}>{i18n.t('signInPhoneLockedHint') || 'Phone number changes are locked for now.'}</Text>
              </View>

              {/* Description */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>{i18n.t('description') || 'Description'}</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="document-text-outline" size={20} color="#999" style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { minHeight: 72 }]}
                    value={description}
                    onChangeText={setDescription}
                    placeholder={i18n.t('description') || 'Description'}
                    placeholderTextColor="#999"
                    multiline
                  />
                </View>
              </View>


              {/* Edit Branches Button */}
              <View style={styles.inputGroup}>
                <Text style={styles.sectionHeading}>{i18n.t('academyBranchesStep') || 'Branch setup'}</Text>
                <Text style={styles.label}>{i18n.t('branches') || 'Branches'}</Text>
                <TouchableOpacity
                  style={styles.linkButton}
                  onPress={() => router.push('/academy-branches')}
                >
                  <Text style={styles.linkButtonText}>{i18n.t('editBranches') || 'Edit Branches'}</Text>
                </TouchableOpacity>
              </View>

              {/* Contact Person */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>{i18n.t('contactPerson')}</Text>
        {editingContactPerson ? (
                  <View style={styles.inputWrapper}>
                    <Ionicons name="person-outline" size={20} color="#999" style={styles.inputIcon} />
            <TextInput
                      style={styles.input}
              value={contactPerson}
              onChangeText={setContactPerson}
              placeholder={i18n.t('contactPersonPlaceholder')}
                      placeholderTextColor="#999"
              autoFocus
            />
                    <TouchableOpacity onPress={() => setEditingContactPerson(false)}>
                      <Ionicons name="checkmark-circle" size={24} color="#000" />
            </TouchableOpacity>
          </View>
        ) : (
                  <TouchableOpacity 
                    style={styles.inputWrapper}
                    onPress={() => setEditingContactPerson(true)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="person-outline" size={20} color="#999" style={styles.inputIcon} />
                    <Text style={[styles.input, !contactPerson && styles.placeholderText]}>
                      {contactPerson || i18n.t('contactPersonPlaceholder')}
                    </Text>
                    <Ionicons name="create-outline" size={20} color="#999" />
            </TouchableOpacity>
        )}
      </View>

              {/* Edit Prices Button */}
              {/* Edit Prices Button (Restored) */}
              <View style={styles.inputGroup}>
                <Text style={styles.sectionHeading}>{i18n.t('academyPricingStep') || 'Pricing & programs'}</Text>
                <Text style={styles.label}>{i18n.t('feesPerAgeGroup') || 'Fees per Age Group'}</Text>
                <TouchableOpacity
                  style={styles.linkButton}
                  onPress={() => router.push('/academy-edit-prices')}
                >
                  <Text style={styles.linkButtonText}>{i18n.t('editPrices') || 'Edit Prices'}</Text>
                </TouchableOpacity>
              </View>

              {/* Private Trainings */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>{i18n.t('privateTraining') || 'Private Training'}</Text>
                {privateTrainings.map((training, index) => (
                  <View key={index} style={styles.trainingCard}>
                    {privateTrainings.length > 1 && (
                      <View style={styles.trainingCardHeader}>
                        <Text style={styles.trainingCardTitle}>Training #{index + 1}</Text>
                        <TouchableOpacity onPress={() => removeTraining(index)} style={{ padding: 4 }}>
                          <Ionicons name="trash-outline" size={20} color="#ff3b30" />
                        </TouchableOpacity>
                      </View>
                    )}
                    <View style={styles.inputGroupSmall}>
                      <Text style={styles.labelSmall}>{i18n.t('coachName') || 'Coach Name'}</Text>
                      <TextInput style={styles.inputSmall} value={training.coachName} onChangeText={v => updateTraining(index, 'coachName', v)} placeholder="Coach Name" placeholderTextColor="#aaa" />
                    </View>
                    <View style={styles.inputGroupSmall}>
                      <Text style={styles.labelSmall}>{i18n.t('privateTrainingPrice') || 'Price per Session'}</Text>
                      <TextInput style={styles.inputSmall} value={training.privateTrainingPrice} onChangeText={v => updateTraining(index, 'privateTrainingPrice', v.replace(/[^0-9]/g, ''))} keyboardType="numeric" placeholder="Price" placeholderTextColor="#aaa" />
                    </View>
                    <View style={styles.inputGroupSmall}>
                      <Text style={styles.labelSmall}>{i18n.t('coachBio') || 'Coach Bio'}</Text>
                      <TextInput style={[styles.inputSmall, { height: 60 }]} value={training.coachBio} onChangeText={v => updateTraining(index, 'coachBio', v)} multiline placeholder="Bio" placeholderTextColor="#aaa" />
                    </View>
                    <View style={styles.inputGroupSmall}>
                      <Text style={styles.labelSmall}>{i18n.t('specializations') || 'Specializations'}</Text>
                      <TextInput style={styles.inputSmall} value={training.specializations} onChangeText={v => updateTraining(index, 'specializations', v)} placeholder="Comma-separated" placeholderTextColor="#aaa" />
                    </View>
                    <View style={styles.inputGroupSmall}>
                      <Text style={styles.labelSmall}>{i18n.t('sessionDuration') || 'Duration (min)'}</Text>
                      <TextInput style={styles.inputSmall} value={training.sessionDuration} onChangeText={v => updateTraining(index, 'sessionDuration', v.replace(/[^0-9]/g, ''))} keyboardType="numeric" placeholder="60" placeholderTextColor="#aaa" />
                    </View>
                    <View style={styles.inputGroupSmall}>
                      <Text style={styles.labelSmall}>{i18n.t('trainerBranch') || 'Trainer Branch'}</Text>
                      {academyLocations.length > 0 ? (
                        <View style={styles.branchChoiceList}>
                          {academyLocations.map((branch) => {
                            const isSelected = training.branchId === branch.id;
                            return (
                              <TouchableOpacity
                                key={branch.id}
                                style={[styles.branchChoiceButton, isSelected && styles.branchChoiceButtonSelected]}
                                onPress={() => {
                                  const payload = buildBookingBranchPayload(branch);
                                  updateTraining(index, 'branchId', payload.branchId || '');
                                  updateTraining(index, 'branchName', payload.branchName || '');
                                  updateTraining(index, 'branchAddress', payload.branchAddress || '');
                                }}
                                activeOpacity={0.8}
                              >
                                <Text style={[styles.branchChoiceText, isSelected && styles.branchChoiceTextSelected]}>{getBranchSummary(branch)}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      ) : (
                        <Text style={styles.branchChoiceHint}>{i18n.t('addBranchesFirst') || 'Add academy branches first to assign private trainers.'}</Text>
                      )}
                    </View>
                  </View>
                ))}
                <TouchableOpacity style={styles.addTrainingBtn} onPress={addTraining}>
                  <Ionicons name="add-circle-outline" size={20} color="#000" />
                  <Text style={styles.addTrainingBtnText}>{i18n.t('addAnotherTraining') || 'Add Private Training'}</Text>
                </TouchableOpacity>
              </View>

              {hasUnsavedChanges && (
                <View style={styles.unsavedBanner}>
                  <Ionicons name="alert-circle-outline" size={16} color="#7c2d12" />
                  <Text style={styles.unsavedBannerText}>{i18n.t('unsavedChangesHint') || 'Changes are not saved yet.'}</Text>
                </View>
              )}

              <TouchableOpacity
                style={[styles.saveButton, saving && styles.saveButtonDisabled]}
                onPress={handleSave}
                disabled={saving}
                activeOpacity={0.8}
              >
                {saving ? (
                  <FootballLoader color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>{i18n.t('save') || 'Save'}</Text>
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
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  formCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    marginTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  profileSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  profileImageContainer: {
    position: 'relative',
    marginBottom: 12,
  },
  profileImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 4,
    borderColor: '#fff',
  },
  profileImagePlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#fff',
  },
  profileImageOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#fff',
  },
  changeProfileText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },
  overviewCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 14,
    marginBottom: 18,
  },
  overviewTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
  },
  overviewHint: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 18,
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
  disabledInputWrapper: {
    backgroundColor: '#f9fafb',
    borderColor: '#e5e7eb',
  },
  readOnlyValueText: {
    flex: 1,
    fontSize: 16,
    color: '#6b7280',
    paddingVertical: 16,
  },
  sectionHeading: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 12,
    marginTop: 4,
  },
  readOnlyInput: {
    backgroundColor: '#f9f9f9',
    opacity: 0.7,
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
  helperText: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
    marginBottom: 10,
  },
  coordinateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  mapActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  coordinateField: {
    flex: 1,
    minWidth: 140,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#f5f5f5',
    paddingHorizontal: 16,
    minHeight: 56,
  },
  mapPickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#e5e7eb',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  mapPickerButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000',
  },
  locationAutofillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  locationAutofillButtonDisabled: {
    opacity: 0.7,
  },
  locationAutofillButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000',
  },
  mapStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 2,
  },
  mapStatusText: {
    flex: 1,
    fontSize: 13,
    color: '#111827',
    fontWeight: '600',
  },
  readOnlyText: {
    flex: 1,
    fontSize: 16,
    color: '#666',
    paddingVertical: 16,
  },
  placeholderText: {
    color: '#999',
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
  bubbleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  bubble: {
    backgroundColor: '#f5f5f5',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    minWidth: 60,
    borderWidth: 2,
    borderColor: '#e0e0e0',
  },
  bubbleSelected: {
    backgroundColor: '#000',
    borderColor: '#000',
  },
  bubbleText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 16,
    marginBottom: 4,
  },
  bubbleTextSelected: {
    color: '#fff',
  },
  priceInput: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    fontSize: 14,
    color: '#000',
    minWidth: 60,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#ddd',
    textAlign: 'center',
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  setBtn: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginTop: 4,
  },
  setBtnText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 12,
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
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 10,
    minHeight: 44,
  },
  scheduleRowNarrow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 6,
    marginBottom: 14,
  },
  scheduleAgeLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#000',
    minWidth: 48,
    width: 48,
  },
  schedulePickersWrap: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    minWidth: 0,
  },
  schedulePickerControl: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 0,
  },
  schedulePickerText: {
    fontSize: 14,
    color: '#000',
    flexShrink: 1,
  },
  schedulePickerPlaceholder: {
    color: '#999',
  },
  trainingCard: {
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  trainingCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  trainingCardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000',
  },
  inputGroupSmall: {
    marginBottom: 12,
  },
  labelSmall: {
    fontSize: 14,
    color: '#333',
    marginBottom: 4,
    fontWeight: '600',
  },
  branchChoiceList: {
    gap: 8,
  },
  branchChoiceButton: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  branchChoiceButtonSelected: {
    borderColor: '#000',
    backgroundColor: '#f3f4f6',
  },
  branchChoiceText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#374151',
    fontWeight: '600',
  },
  branchChoiceTextSelected: {
    color: '#000',
  },
  branchChoiceHint: {
    fontSize: 13,
    lineHeight: 18,
    color: '#6b7280',
  },
  inputSmall: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    color: '#000',
  },
  addTrainingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: '#000',
    borderStyle: 'dashed',
    borderRadius: 12,
    gap: 8,
  },
  addTrainingBtnText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000',
  },
  linkButton: {
    backgroundColor: '#111827',
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 8,
    alignItems: 'center',
  },
  linkButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  schedulePickerBtn: {
    flex: 1,
    minWidth: 72,
    borderWidth: 2,
    borderColor: '#e0e0e0',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
  },
  scheduleDropdown: {
    position: 'absolute',
    top: 44,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#e0e0e0',
    borderRadius: 12,
    zIndex: 100,
    maxHeight: 220,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
  },
  scheduleDropdownScroll: {
    maxHeight: 180,
  },
  scheduleDropdownItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  scheduleDropdownItemSelected: {
    backgroundColor: '#f0f0f0',
  },
  scheduleDropdownItemText: {
    color: '#000',
    fontSize: 15,
  },
  scheduleDropdownCancel: {
    padding: 12,
    alignItems: 'center',
    borderTopWidth: 2,
    borderTopColor: '#e0e0e0',
    backgroundColor: '#fafafa',
  },
  scheduleDropdownCancelText: {
    color: '#000',
    fontWeight: '600',
    fontSize: 15,
  },
  scheduleDropdownNarrow: {
    top: 76,
    left: 0,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
});
