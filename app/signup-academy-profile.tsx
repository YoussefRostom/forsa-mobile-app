import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useOnboarding } from '../context/OnboardingContext';
import { doc, setDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { resolveUserDisplayName } from '../lib/userDisplayName';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { writeEmailIndex, lookupEmailIndex } from '../lib/emailIndex';
import { lookupPhoneIndex, writePhoneIndex } from '../lib/phoneIndex';
import { normalizePhoneForAuth ,
  getPhoneIdentityCandidates,
  formatEgyptPhoneFromLocalInput,
  getEgyptPhoneLocalPart,
  validateAddress,
  validateCity,
  validateEmail,
  validatePassword,
  validatePhone,
  validateRequired,
  normalizePhoneForTwilio
} from '../lib/validations';
import React, { useState, useEffect, useRef } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { uploadMedia } from '../services/MediaService';

import i18n from '../locales/i18n';
import { buildBookingBranchPayload, getBranchSummary, normalizeBookingBranches } from '../lib/bookingBranch';
import FootballLoader from '../components/FootballLoader';
import SignupStepBar from '../components/SignupStepBar';
import { notifyAdminsOfNewSignup } from '../services/SignupNotificationService';

const LOCATION_PICKER_RESULT_KEY = 'academySignupLocationPickerResult';
const EXTRA_LOCATION_PICKER_RESULT_KEY = 'academySignupExtraLocationPickerResult';
const ACADEMY_SIGNUP_DRAFT_KEY = 'academySignupDraft';

type AcademyBranchLocation = {
  id: string;
  label: string;
  city: string;
  district?: string;
  address: string;
  mapUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

const districtsByCity: Record<string, { key: string; label: string }[]> = {
  cairo: [
    { key: 'Maadi', label: 'المعادي' },
    { key: 'Nasr City', label: 'مدينة نصر' },
    { key: 'Heliopolis', label: 'مصر الجديدة' },
    { key: 'Mokattam', label: 'المقطم' },
    { key: 'New Cairo', label: 'القاهرة الجديدة' },
    { key: 'Rehab', label: 'الرحاب' },
    { key: 'Madinaty', label: 'مدينتي' },
    { key: 'Shorouk', label: 'الشروق' },
    { key: '6 October', label: 'السادس من أكتوبر' },
    { key: 'Sheikh Zayed', label: 'الشيخ زايد' },
    { key: 'Zamalek', label: 'الزمالك' },
    { key: 'Dokki', label: 'الدقي' },
    { key: 'Mohandessin', label: 'المهندسين' },
    { key: 'Faisal', label: 'فيصل' },
    { key: 'Haram', label: 'الهرم' },
  ],
  alexandria: [
    { key: 'Roushdy', label: 'رشدي' },
    { key: 'Smouha', label: 'سموحة' },
    { key: 'Sporting', label: 'سبورتنج' },
    { key: 'Kafr Abdo', label: 'كفر عبده' },
    { key: 'Gleem', label: 'جليم' },
    { key: 'Sidi Bishr', label: 'سيدي بشر' },
    { key: 'Miami', label: 'ميامي' },
    { key: 'Mandara', label: 'المندرة' },
    { key: 'Agami', label: 'العجمي' },
    { key: 'Montaza', label: 'المنتزه' },
  ],
};

const SignupAcademy = () => {
  const router = useRouter();
  const { startOnboarding } = useOnboarding();
  const params = useLocalSearchParams();

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

  // Initialize state from params
  const [academyName, setAcademyName] = useState(params.academyName as string || '');
  const [email, setEmail] = useState(params.email as string || '');
  const [phone, setPhone] = useState(params.phone as string || '');
  const [password, setPassword] = useState(params.password as string || '');
  const [city, setCity] = useState(params.city as string || '');
  const [district, setDistrict] = useState(params.district as string || '');
  const [showCityModal, setShowCityModal] = useState(false);
  const [showDistrictModal, setShowDistrictModal] = useState(false);
  const [activeExtraCityId, setActiveExtraCityId] = useState<string | null>(null);
  const [activeExtraDistrictId, setActiveExtraDistrictId] = useState<string | null>(null);
  const pendingExtraLocationIdRef = useRef<string | null>(null);
  const [address, setAddress] = useState(params.address as string || '');
  const [description, setDescription] = useState(params.description as string || '');
  const [socialUrl, setSocialUrl] = useState(
    (params.socialUrl as string) ||
    (params.instagramUrl as string) ||
    (params.facebookUrl as string) ||
    ''
  );
  const [mapUrl, setMapUrl] = useState((params.mapUrl as string) || '');
  const [latitudeInput, setLatitudeInput] = useState((params.latitude as string) || '');
  const [longitudeInput, setLongitudeInput] = useState((params.longitude as string) || '');
  const [locationAutofillLoading, setLocationAutofillLoading] = useState(false);
  const locationPermissionGrantedRef = useRef<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [fees, setFees] = useState<{ [age: string]: string }>(() => {
    try {
      return params.fees ? JSON.parse(params.fees as string) : {};
    } catch {
      return {};
    }
  });
  const [selectedAge, setSelectedAge] = useState<string | null>(null);
  const [profileImage, setProfileImage] = useState<string | null>(params.profileImage as string || null);
  const [missing, setMissing] = useState<{ [key: string]: boolean }>({});
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [extraLocations, setExtraLocations] = useState<AcademyBranchLocation[]>([]);
  const [mainLocationSaved, setMainLocationSaved] = useState(false);
  const [savedLocationIds, setSavedLocationIds] = useState<string[]>([]);
  const [privateTrainings, setPrivateTrainings] = useState<{
    coachName: string; privateTrainingPrice: string; coachBio: string;
    specializations: string; sessionDuration: string; availability: string;
    branchId: string; branchName: string; branchAddress: string;
  }[]>([{ coachName: '', privateTrainingPrice: '', coachBio: '', specializations: '', sessionDuration: '60', availability: '', branchId: '', branchName: '', branchAddress: '' }]);
  const [privateTrainingEnabled, setPrivateTrainingEnabled] = useState(false);
  const [bulkFeeValue, setBulkFeeValue] = useState('');
  const [draftReady, setDraftReady] = useState(false);

  const academyBranchOptions = normalizeBookingBranches([
    {
      id: 'main-branch',
      label: i18n.t('mainLocationLabel') || 'Main branch',
      city,
      district,
      address,
      mapUrl,
      latitude: latitudeInput ? Number(latitudeInput) : null,
      longitude: longitudeInput ? Number(longitudeInput) : null,
    },
    ...extraLocations,
  ]);

  useEffect(() => {
    const loadDraft = async () => {
      try {
        const [trainingDraft, signupDraft] = await Promise.all([
          AsyncStorage.getItem('draftPrivateTrainings'),
          AsyncStorage.getItem(ACADEMY_SIGNUP_DRAFT_KEY),
        ]);

        if (trainingDraft) {
          setPrivateTrainings(JSON.parse(trainingDraft));
          await AsyncStorage.removeItem('draftPrivateTrainings');
        }

        if (signupDraft) {
          const parsed = JSON.parse(signupDraft);
          if (typeof parsed.academyName === 'string') setAcademyName(parsed.academyName);
          if (typeof parsed.email === 'string') setEmail(parsed.email);
          if (typeof parsed.phone === 'string') setPhone(parsed.phone);
          if (typeof parsed.password === 'string') setPassword(parsed.password);
          if (typeof parsed.city === 'string') setCity(parsed.city);
          if (typeof parsed.district === 'string') setDistrict(parsed.district);
          if (typeof parsed.address === 'string') setAddress(parsed.address);
          if (typeof parsed.description === 'string') setDescription(parsed.description);
          if (typeof parsed.socialUrl === 'string') setSocialUrl(parsed.socialUrl);
          if (typeof parsed.mapUrl === 'string') setMapUrl(parsed.mapUrl);
          if (typeof parsed.latitudeInput === 'string') setLatitudeInput(parsed.latitudeInput);
          if (typeof parsed.longitudeInput === 'string') setLongitudeInput(parsed.longitudeInput);
          if (parsed.fees && typeof parsed.fees === 'object') setFees(parsed.fees);
          if (parsed.profileImage !== undefined) setProfileImage(parsed.profileImage || null);
          if (Array.isArray(parsed.extraLocations)) setExtraLocations(parsed.extraLocations);
          if (typeof parsed.mainLocationSaved === 'boolean') setMainLocationSaved(parsed.mainLocationSaved);
          if (Array.isArray(parsed.savedLocationIds)) setSavedLocationIds(parsed.savedLocationIds);
          if (Array.isArray(parsed.privateTrainings)) setPrivateTrainings(parsed.privateTrainings);
          if (typeof parsed.selectedAge === 'string' || parsed.selectedAge === null) setSelectedAge(parsed.selectedAge ?? null);
          if (typeof parsed.privateTrainingEnabled === 'boolean') setPrivateTrainingEnabled(parsed.privateTrainingEnabled);
          if (typeof parsed.bulkFeeValue === 'string') setBulkFeeValue(parsed.bulkFeeValue);
        }
      } catch (e) {
        console.error('Failed to load academy signup draft', e);
      } finally {
        setDraftReady(true);
      }
    };
    loadDraft();
  }, []);

  useEffect(() => {
    const hasTrainingData = privateTrainings.some((training) =>
      Boolean(
        training.coachName.trim() ||
        training.privateTrainingPrice.trim() ||
        training.coachBio.trim() ||
        training.specializations.trim() ||
        training.availability.trim()
      )
    );

    if (hasTrainingData && !privateTrainingEnabled) {
      setPrivateTrainingEnabled(true);
    }
  }, [privateTrainings, privateTrainingEnabled]);

  useEffect(() => {
    if (!draftReady) return;

    const timeoutId = setTimeout(() => {
      const persistDraft = async () => {
        try {
          await AsyncStorage.setItem(
            ACADEMY_SIGNUP_DRAFT_KEY,
            JSON.stringify({
              academyName,
              email,
              phone,
              password,
              city,
              district,
              address,
              description,
              socialUrl,
              mapUrl,
              latitudeInput,
              longitudeInput,
              fees,
              profileImage,
              extraLocations,
              mainLocationSaved,
              savedLocationIds,
              privateTrainings,
              selectedAge,
              privateTrainingEnabled,
              bulkFeeValue,
            })
          );
        } catch (error) {
          console.warn('Failed to persist academy signup draft', error);
        }
      };

      void persistDraft();
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [
    draftReady,
    academyName,
    email,
    phone,
    password,
    city,
    district,
    address,
    description,
    socialUrl,
    mapUrl,
    latitudeInput,
    longitudeInput,
    fees,
    profileImage,
    extraLocations,
    mainLocationSaved,
    savedLocationIds,
    privateTrainings,
    selectedAge,
    privateTrainingEnabled,
    bulkFeeValue,
  ]);

  useFocusEffect(
    React.useCallback(() => {
      if (!draftReady) {
        return;
      }

      let active = true;

      const consumePickedLocations = async () => {
        try {
          const [primaryStored, extraStored] = await Promise.all([
            AsyncStorage.getItem(LOCATION_PICKER_RESULT_KEY),
            AsyncStorage.getItem(EXTRA_LOCATION_PICKER_RESULT_KEY),
          ]);

          const activePendingExtraLocationId = pendingExtraLocationIdRef.current;

          if (primaryStored && active && !activePendingExtraLocationId) {
            const picked = JSON.parse(primaryStored);
            if (picked?.latitude !== undefined && picked?.longitude !== undefined) {
              const nextLatitude = String(picked.latitude);
              const nextLongitude = String(picked.longitude);
              setLatitudeInput(nextLatitude);
              setLongitudeInput(nextLongitude);
              validateCoordinatesField(nextLatitude, nextLongitude);
            }
            if (picked?.mapUrl) setMapUrl(picked.mapUrl);
            setErrors((prev) => {
              const next = { ...prev };
              delete next.coordinates;
              return next;
            });
            setMissing((prev) => ({ ...prev, latitudeInput: false, longitudeInput: false }));
            setMainLocationSaved(false);
            await AsyncStorage.removeItem(LOCATION_PICKER_RESULT_KEY);
          }

          if (extraStored && active) {
            const picked = JSON.parse(extraStored);
            const pickedLatitude = Number(picked?.latitude ?? NaN);
            const pickedLongitude = Number(picked?.longitude ?? NaN);
            const activePendingExtraLocationId =
              (typeof picked?.targetLocationId === 'string' && picked.targetLocationId) || pendingExtraLocationIdRef.current;

            setExtraLocations((prev) => {
              if (!activePendingExtraLocationId) {
                return prev;
              }

              return prev.map((location) => {
                if (location.id !== activePendingExtraLocationId) return location;

                return {
                  ...location,
                  mapUrl: picked?.mapUrl ?? location.mapUrl ?? null,
                  latitude: Number.isFinite(pickedLatitude) ? pickedLatitude : (location.latitude ?? null),
                  longitude: Number.isFinite(pickedLongitude) ? pickedLongitude : (location.longitude ?? null),
                };
              });
            });
            pendingExtraLocationIdRef.current = null;
            await AsyncStorage.removeItem(EXTRA_LOCATION_PICKER_RESULT_KEY);
          }
        } catch (error) {
          console.warn('Failed to restore picked academy location on signup', error);
        }
      };

      consumePickedLocations();

      return () => {
        active = false;
      };
    }, [draftReady])
  );

  const fadeAnim = React.useRef(new Animated.Value(0)).current;

  const updateTraining = (index: number, field: string, value: string) => {
    setPrivateTrainings(prev => prev.map((t, i) => i === index ? { ...t, [field]: value } : t));
  };
  const addTraining = () => {
    setPrivateTrainings(prev => [...prev, { coachName: '', privateTrainingPrice: '', coachBio: '', specializations: '', sessionDuration: '60', availability: '', branchId: '', branchName: '', branchAddress: '' }]);
  };
  const removeTraining = (index: number) => {
    setPrivateTrainings(prev => prev.filter((_, i) => i !== index));
  };

  const handleFeeChange = (age: string, value: string) => {
    const sanitizedValue = value.replace(/[^0-9]/g, '');
    const nextFees = { ...fees, [age]: sanitizedValue };
    setFees(nextFees);

    if (missing.fees && sanitizedValue.trim()) {
      setMissing((prev) => ({ ...prev, fees: false }));
    }

    if (errors.fees && sanitizedValue.trim()) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next.fees;
        return next;
      });
    }
  };

  const applyBulkFeeToEmptyAges = () => {
    const normalizedValue = bulkFeeValue.replace(/[^0-9]/g, '');
    if (!normalizedValue) return;

    setBulkFeeValue(normalizedValue);
    const nextFees = { ...fees };
    ageGroups.forEach((age) => {
      if (!nextFees[age]?.trim()) {
        nextFees[age] = normalizedValue;
      }
    });
    setFees(nextFees);

    setMissing((prev) => ({ ...prev, fees: false }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next.fees;
      return next;
    });
  };

  const clearAllFees = () => {
    setFees({});
    setSelectedAge(null);
    validateFeesField({});
  };

  const cityOptions = Object.entries(i18n.t('cities', { returnObjects: true }) as Record<string, string>).map(([key, label]) => ({ key, label }));
  const availableDistricts = city ? districtsByCity[city] || [] : [];
  const isDistrictEnabled = Boolean(city && availableDistricts.length > 0);

  const normalizeLookupValue = (value: string) =>
    (value || '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06FF]+/gi, '');

  const districtAliasesByCity: Record<string, Record<string, string>> = {
    cairo: {
      maadi: 'Maadi',
      elmaadi: 'Maadi',
      nasrcity: 'Nasr City',
      madinetnasr: 'Nasr City',
      heliopolis: 'Heliopolis',
      masrelgedida: 'Heliopolis',
      newcairo: 'New Cairo',
      fifthsettlement: 'New Cairo',
      tagamoa: 'New Cairo',
      rehab: 'Rehab',
      madinaty: 'Madinaty',
      shorouk: 'Shorouk',
      october: '6 October',
      sixoctober: '6 October',
      zayed: 'Sheikh Zayed',
      sheikhzayed: 'Sheikh Zayed',
      zamalek: 'Zamalek',
      dokki: 'Dokki',
      doqqi: 'Dokki',
      mohandessin: 'Mohandessin',
      faisal: 'Faisal',
      haram: 'Haram',
      mokattam: 'Mokattam',
      muqattam: 'Mokattam',
    },
    alexandria: {
      roushdy: 'Roushdy',
      smouha: 'Smouha',
      sporting: 'Sporting',
      kafrabdo: 'Kafr Abdo',
      gleem: 'Gleem',
      sidibishr: 'Sidi Bishr',
      miami: 'Miami',
      mandara: 'Mandara',
      agami: 'Agami',
      montaza: 'Montaza',
    },
  };

  const normalizeDistrictValue = (cityKey?: string, value?: string, fallbackDistrict = '') => {
    const options = getDistrictOptionsForCity(cityKey);
    if (!options.length) return '';

    const candidates = [value, fallbackDistrict].filter(
      (candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0
    );

    for (const candidate of candidates) {
      const normalized = normalizeLookupValue(candidate);
      if (!normalized) continue;

      const exactMatch = options.find((option) => {
        const keyNormalized = normalizeLookupValue(option.key);
        const labelNormalized = normalizeLookupValue(String(option.label));
        return (
          normalized === keyNormalized ||
          normalized === labelNormalized ||
          normalized.includes(keyNormalized) ||
          normalized.includes(labelNormalized) ||
          keyNormalized.includes(normalized) ||
          labelNormalized.includes(normalized)
        );
      });

      if (exactMatch) {
        return exactMatch.key;
      }

      const aliasMatch = districtAliasesByCity[cityKey || '']?.[normalized];
      if (aliasMatch && options.some((option) => option.key === aliasMatch)) {
        return aliasMatch;
      }
    }

    return '';
  };

  const ageGroups = Array.from({ length: 10 }, (_, i) => (7 + i).toString());

  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);


  // Image picker for profile photo
  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      setProfileImage(result.assets[0].uri);
    }
  };

  useEffect(() => {
    if (!district) return;
    const normalizedDistrict = normalizeDistrictValue(city, district);
    if (normalizedDistrict !== district) {
      setDistrict(normalizedDistrict);
    }
  // normalizeDistrictValue is intentionally derived inline from current city options.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, district]);

  const handleBack = () => router.back();

  const openMapPicker = async () => {
    pendingExtraLocationIdRef.current = null;
    await AsyncStorage.multiRemove([LOCATION_PICKER_RESULT_KEY, EXTRA_LOCATION_PICKER_RESULT_KEY]);
    const cityLabel = cityOptions.find((option) => option.key === city)?.label || city;
    router.push({
      pathname: '/academy-location-picker',
      params: {
        storageKey: LOCATION_PICKER_RESULT_KEY,
        title: academyName || (i18n.t('academy_name') || 'Academy'),
        latitude: latitudeInput,
        longitude: longitudeInput,
        city: cityLabel,
        district,
        address,
        targetLocationId: '',
      },
    });
  };

  const addExtraLocationCard = () => {
    const hasUnsavedExtraLocation = extraLocations.some((location) => !savedLocationIds.includes(location.id));
    if (!mainLocationSaved || hasUnsavedExtraLocation) {
      Alert.alert(
        i18n.t('save') || 'Save',
        i18n.t('saveCurrentLocationFirst') || 'Please save the current location before opening another one.'
      );
      return;
    }

    setExtraLocations((prev) => {
      const nextIndex = prev.length + 2;
      return [
        ...prev,
        {
          id: `location-${Date.now()}-${nextIndex}`,
          label: `${i18n.t('locationLabel') || 'Location'} ${nextIndex}`,
          city: '',
          district: '',
          address: '',
          mapUrl: '',
          latitude: null,
          longitude: null,
        },
      ];
    });
  };

  const updateExtraLocation = (id: string, updates: Partial<AcademyBranchLocation>) => {
    setSavedLocationIds((prev) => prev.filter((savedId) => savedId !== id));
    setExtraLocations((prev) =>
      prev.map((location) => {
        if (location.id !== id) return location;

        const nextCity = updates.city !== undefined ? updates.city : location.city;
        const cityChanged = updates.city !== undefined && updates.city !== location.city;
        const nextDistrict = updates.district !== undefined
          ? normalizeDistrictValue(nextCity, updates.district, cityChanged ? '' : location.district)
          : (cityChanged ? '' : normalizeDistrictValue(nextCity, location.district));

        return {
          ...location,
          ...updates,
          city: nextCity,
          district: nextDistrict,
        };
      })
    );
  };

  const getDistrictOptionsForCity = (cityKey?: string) => (cityKey ? districtsByCity[cityKey] || [] : []);

  const handleSaveMainLocation = () => {
    if (!city) {
      Alert.alert(i18n.t('error') || 'Error', i18n.t('selectCityFirst') || 'Select city first');
      return;
    }

    const addressError = validateAddress(address);
    if (addressError) {
      Alert.alert(i18n.t('error') || 'Error', addressError);
      return;
    }

    setMainLocationSaved(true);
  };

  const handleSaveExtraLocation = (locationId: string) => {
    const target = extraLocations.find((location) => location.id === locationId);
    if (!target) return;

    if (!target.city) {
      Alert.alert(i18n.t('error') || 'Error', i18n.t('selectCityFirst') || 'Select city first');
      return;
    }

    const addressError = validateAddress(target.address || '');
    if (addressError) {
      Alert.alert(i18n.t('error') || 'Error', addressError);
      return;
    }

    setSavedLocationIds((prev) => (prev.includes(locationId) ? prev : [...prev, locationId]));
  };

  const openAdditionalLocationPicker = async (locationId?: string) => {
    const target = extraLocations.find((location) => location.id === locationId);
    const cityLabel = cityOptions.find((option) => option.key === target?.city)?.label || target?.city || '';
    pendingExtraLocationIdRef.current = locationId || null;
    await AsyncStorage.multiRemove([LOCATION_PICKER_RESULT_KEY, EXTRA_LOCATION_PICKER_RESULT_KEY]);
    router.push({
      pathname: '/academy-location-picker',
      params: {
        storageKey: EXTRA_LOCATION_PICKER_RESULT_KEY,
        title: target?.label || (i18n.t('addAnotherLocation') || 'Add another location'),
        latitude: target?.latitude != null ? String(target.latitude) : '',
        longitude: target?.longitude != null ? String(target.longitude) : '',
        city: cityLabel,
        district: target?.district || '',
        address: target?.address || '',
        targetLocationId: locationId || '',
      },
    });
  };

  const removeExtraLocation = (id: string) => {
    setExtraLocations((prev) => prev.filter((location) => location.id !== id));
    setSavedLocationIds((prev) => prev.filter((savedId) => savedId !== id));
    if (pendingExtraLocationIdRef.current === id) {
      pendingExtraLocationIdRef.current = null;
    }
  };

  const handleUseCurrentLocation = async () => {
    try {
      setLocationAutofillLoading(true);
      const hasLocationPermission = await (async () => {
        if (locationPermissionGrantedRef.current === true) return true;
        const currentPermission = await Location.getForegroundPermissionsAsync();
        if (currentPermission.granted) {
          locationPermissionGrantedRef.current = true;
          return true;
        }
        const requestedPermission = await Location.requestForegroundPermissionsAsync();
        if (requestedPermission.granted) {
          locationPermissionGrantedRef.current = true;
          return true;
        }
        locationPermissionGrantedRef.current = false;
        return false;
      })();

      if (!hasLocationPermission) {
        Alert.alert(
          i18n.t('locationPermissionNeeded') || 'Location permission needed',
          i18n.t('locationPermissionMessage') || 'Allow location access to continue.'
        );
        return;
      }

      const currentLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const lat = currentLocation.coords.latitude.toFixed(6);
      const lng = currentLocation.coords.longitude.toFixed(6);

      setLatitudeInput(lat);
      setLongitudeInput(lng);
      validateCoordinatesField(lat, lng);
      setMainLocationSaved(false);
      setMissing((prev) => ({ ...prev, latitudeInput: false, longitudeInput: false }));
      setErrors((prev) => {
        const next = { ...prev };
        delete next.coordinates;
        return next;
      });

      if (!mapUrl.trim()) {
        setMapUrl(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);
      }
    } catch (locationError) {
      console.warn('Could not fetch current location for academy signup', locationError);
      Alert.alert(
        i18n.t('error') || 'Error',
        i18n.t('locationUnavailable') || 'Could not get your location right now.'
      );
    } finally {
      setLocationAutofillLoading(false);
    }
  };

  const validate = () => {
    const newErrors: { [key: string]: string } = {};
    const newMissing: { [key: string]: boolean } = {};

    const academyNameError = validateRequired(academyName, i18n.t('academy_name') || 'Academy name');
    if (academyNameError) {
      newErrors.academyName = academyNameError;
      newMissing.academyName = true;
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

    const addressError = validateAddress(address);
    if (addressError) {
      newErrors.address = addressError;
      newMissing.address = true;
    }

    const socialUrlError = validateRequired(socialUrl, i18n.t('social_url') || 'Website / Social URL');
    if (socialUrlError) {
      newErrors.socialUrl = socialUrlError;
      newMissing.socialUrl = true;
    }

    const parsedLatitude = parseCoordinateValue(latitudeInput);
    const parsedLongitude = parseCoordinateValue(longitudeInput);
    const hasAnyCoordinate = latitudeInput.trim().length > 0 || longitudeInput.trim().length > 0;

    if (hasAnyCoordinate) {
      const coordinatesIncomplete = parsedLatitude === null || parsedLongitude === null;
      const coordinatesInvalid = Number.isNaN(parsedLatitude) || Number.isNaN(parsedLongitude);
      const coordinatesOutOfRange =
        (!coordinatesIncomplete && !coordinatesInvalid) && (
          parsedLatitude! < -90 || parsedLatitude! > 90 || parsedLongitude! < -180 || parsedLongitude! > 180
        );

      if (coordinatesIncomplete) {
        newErrors.coordinates = i18n.t('enterBothCoordinates') || 'Enter both latitude and longitude, or leave both blank.';
        newMissing.latitudeInput = true;
        newMissing.longitudeInput = true;
      } else if (coordinatesInvalid || coordinatesOutOfRange) {
        newErrors.coordinates = i18n.t('invalidCoordinates') || 'Enter valid map coordinates.';
        newMissing.latitudeInput = true;
        newMissing.longitudeInput = true;
      }
    }

    // Profile photo is optional

    // Check that at least one fee is entered
    if (!Object.values(fees).some((v) => v && v.trim() !== '')) {
      newErrors.fees = i18n.t('atLeastOneFeeRequired') || 'At least one fee must be entered';
      newMissing.fees = true;
    }

    setErrors(newErrors);
    setMissing(newMissing);
    return Object.keys(newErrors).length === 0;
  };

  const validateCoordinatesField = (latValue: string, lngValue: string) => {
    const parsedLatitude = parseCoordinateValue(latValue);
    const parsedLongitude = parseCoordinateValue(lngValue);
    const hasAnyCoordinate = latValue.trim().length > 0 || lngValue.trim().length > 0;

    if (!hasAnyCoordinate) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next.coordinates;
        return next;
      });
      setMissing((prev) => ({ ...prev, latitudeInput: false, longitudeInput: false }));
      return;
    }

    const coordinatesIncomplete = parsedLatitude === null || parsedLongitude === null;
    const coordinatesInvalid = Number.isNaN(parsedLatitude) || Number.isNaN(parsedLongitude);
    const coordinatesOutOfRange =
      (!coordinatesIncomplete && !coordinatesInvalid) && (
        parsedLatitude! < -90 || parsedLatitude! > 90 || parsedLongitude! < -180 || parsedLongitude! > 180
      );

    if (coordinatesIncomplete) {
      setErrors((prev) => ({
        ...prev,
        coordinates: i18n.t('enterBothCoordinates') || 'Enter both latitude and longitude, or leave both blank.',
      }));
      setMissing((prev) => ({ ...prev, latitudeInput: true, longitudeInput: true }));
      return;
    }

    if (coordinatesInvalid || coordinatesOutOfRange) {
      setErrors((prev) => ({
        ...prev,
        coordinates: i18n.t('invalidCoordinates') || 'Enter valid map coordinates.',
      }));
      setMissing((prev) => ({ ...prev, latitudeInput: true, longitudeInput: true }));
      return;
    }

    setErrors((prev) => {
      const next = { ...prev };
      delete next.coordinates;
      return next;
    });
    setMissing((prev) => ({ ...prev, latitudeInput: false, longitudeInput: false }));
  };

  const validateFeesField = (nextFees: typeof fees = fees) => {
    const hasFee = Object.values(nextFees).some((value) => value && value.trim() !== '');
    if (!hasFee) {
      setErrors((prev) => ({
        ...prev,
        fees: i18n.t('atLeastOneFeeRequired') || 'At least one fee must be entered',
      }));
      setMissing((prev) => ({ ...prev, fees: true }));
      return;
    }

    setErrors((prev) => {
      const next = { ...prev };
      delete next.fees;
      return next;
    });
    setMissing((prev) => ({ ...prev, fees: false }));
  };

  const validateField = (field: string, value: string) => {
    let error: string | null = null;

    switch (field) {
      case 'academyName':
        error = validateRequired(value, i18n.t('academy_name') || 'Academy name');
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
      case 'address':
        error = validateAddress(value);
        break;
      case 'socialUrl':
        error = validateRequired(value, i18n.t('social_url') || 'Website / Social URL');
        break;
      default:
        break;
    }

    if (error) {
      setErrors((prev) => ({ ...prev, [field]: error as string }));
      setMissing((prev) => ({ ...prev, [field]: true }));
    } else {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
      setMissing((prev) => ({ ...prev, [field]: false }));
    }
  };

  const handleSignup = async () => {
    if (!validate()) {
      Alert.alert(i18n.t('missingFields'), i18n.t('fillAllRequiredFields'));
      return;
    }
    try {
      setLoading(true);
      setFormError('');

      // Step 1: Create Firebase Auth user — use real email when provided (unique per user), else phone-based
      const normalizedPhone = normalizePhoneForTwilio(phone);
      const phoneForAuth = normalizePhoneForAuth(normalizedPhone);
      const authEmail =
        email && email.trim().length > 0
          ? email.trim().toLowerCase()
          : `user_${phoneForAuth}@forsa.app`;

      // Prevent duplicates across legacy/raw and canonical phone identities
      const normalizedEmail = email.trim();
      const phoneCandidates = getPhoneIdentityCandidates(phone);
      const [existingPhoneMatches, existingEmailAuth] = await Promise.all([
        Promise.all(phoneCandidates.map((candidate) => lookupPhoneIndex(candidate))),
        normalizedEmail ? lookupEmailIndex(normalizedEmail) : Promise.resolve(null),
      ]);
      if (existingPhoneMatches.some(Boolean)) {
        throw { code: 'forsa/phone-already-in-use' };
      }
      if (existingEmailAuth) {
        throw { code: 'forsa/email-already-in-use' };
      }

      const userCredential = await createUserWithEmailAndPassword(auth, authEmail, password);
      const uid = userCredential.user.uid;

      // Step 2: Upload profile photo to Cloudinary
      let profilePhotoUrl = '';
      if (profileImage) {
        try {
          const cloudinaryResponse = await uploadMedia(profileImage, 'image');
          profilePhotoUrl = cloudinaryResponse.secure_url;
        } catch (error: any) {
          console.error('Error uploading profile photo:', error);
          throw new Error('Failed to upload profile photo. Please try again.');
        }
      }

      // Step 3: Save extended profile to Firestore
      let geoFields: any = {};
      const manualLatitude = parseCoordinateValue(latitudeInput);
      const manualLongitude = parseCoordinateValue(longitudeInput);
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

      const academyLocations = [
        {
          id: 'main-branch',
          label: i18n.t('mainLocationLabel') || 'Main location',
          city,
          district,
          address,
          mapUrl: mapUrl.trim() || null,
          latitude: geoFields.latitude ?? null,
          longitude: geoFields.longitude ?? null,
          coordinates:
            geoFields.latitude != null && geoFields.longitude != null
              ? { latitude: geoFields.latitude, longitude: geoFields.longitude }
              : null,
        },
        ...extraLocations.map((location) => ({
          id: location.id,
          label: location.label,
          city: location.city,
          district: location.district || '',
          address: location.address,
          mapUrl: location.mapUrl || null,
          latitude: Number.isFinite(Number(location.latitude)) ? Number(location.latitude) : null,
          longitude: Number.isFinite(Number(location.longitude)) ? Number(location.longitude) : null,
          coordinates:
            Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude))
              ? { latitude: Number(location.latitude), longitude: Number(location.longitude) }
              : null,
        })),
      ].filter((location) => Boolean(location.address || location.mapUrl || (location.latitude != null && location.longitude != null)));

      const userData = {
        uid,
        role: 'academy',
        status: 'active',
        isSuspended: false,
        username: resolveUserDisplayName({ academyName }, 'Academy'),
        email: email && email.trim().length > 0 ? email.trim() : null,
        phone,
        academyName,
        city,
        district,
        address,
        description,
        socialUrl: socialUrl.trim() || null,
        mapUrl: mapUrl.trim() || null,
        locations: academyLocations,
        fees,
        profilePhoto: profilePhotoUrl,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...geoFields,
      };
      await Promise.all([
        setDoc(doc(db, 'users', uid), userData, { merge: true }),
        setDoc(doc(db, 'academies', uid), userData),
        normalizedEmail ? writeEmailIndex(normalizedEmail, authEmail) : Promise.resolve(),
        writePhoneIndex(phoneForAuth, authEmail),
      ]);

      // Save email → authEmail mapping for sign-in by email
      // Save phone → authEmail mapping so sign-in by phone works (e.g. account created with email + phone)
      startOnboarding('academy');

      void notifyAdminsOfNewSignup({
        signupUserId: uid,
        role: 'academy',
        userData,
      }).catch((error) => {
        console.warn('[SignupAcademy] Failed to notify admins about new signup:', error);
      });

      void Promise.all([
        Promise.all(
          privateTrainings.map(async (training) => {
            if (!training.coachName || !training.privateTrainingPrice) return;
            try {
              const selectedBranch = academyBranchOptions.find((branch) => branch.id === training.branchId) || null;
              const programData = {
                academyId: uid,
                name: 'Private Training',
                type: 'private_training',
                fee: parseFloat(training.privateTrainingPrice),
                description: `Private training sessions with ${training.coachName}`,
                coachName: training.coachName,
                coachBio: training.coachBio || null,
                specializations: training.specializations ? training.specializations.split(',').map((s: string) => s.trim()) : [],
                maxParticipants: 1,
                duration: parseInt(training.sessionDuration) || 60,
                availability: training.availability ? { general: training.availability } : null,
                ...buildBookingBranchPayload(
                  selectedBranch || {
                    id: training.branchId,
                    name: training.branchName,
                    address: training.branchAddress,
                  }
                ),
                isActive: true,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              };
              await addDoc(collection(db, 'academy_programs'), programData);
            } catch (programError) {
              console.error('Error creating private training program:', programError);
            }
          })
        ),
        AsyncStorage.multiRemove([
          ACADEMY_SIGNUP_DRAFT_KEY,
          LOCATION_PICKER_RESULT_KEY,
          EXTRA_LOCATION_PICKER_RESULT_KEY,
        ]),
      ]).catch((error) => {
        console.warn('[SignupAcademy] Deferred setup failed:', error);
      });
    } catch (err: any) {
      console.log('[Signup] Error:', err.message);
      let errorMsg = i18n.t('signupFailedMessage');
      if (err.code === 'auth/email-already-in-use') {
        // Academy uses real email as Firebase auth email when provided
        errorMsg = email && email.trim().length > 0
          ? (i18n.t('emailAlreadyRegistered') || 'This email is already registered')
          : (i18n.t('phoneAlreadyRegistered') || 'This phone number is already registered. Please use a different number or sign in.');
      } else if (err.code === 'forsa/phone-already-in-use') {
        errorMsg = i18n.t('phoneAlreadyRegistered') || 'This phone number is already registered. Please use a different number or sign in.';
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

  const hasEnteredFee = Object.values(fees).some((value) => value && value.trim() !== '');
  const requiredSteps = [
    Boolean(academyName.trim()),
    Boolean(phone.trim()) && !errors.phone,
    Boolean(city),
    Boolean(address.trim()),
    Boolean(password.trim()) && !errors.password,
    Boolean(socialUrl.trim()),
    hasEnteredFee,
  ];
  const completedRequiredCount = requiredSteps.filter(Boolean).length;
  const completionPercent = Math.round((completedRequiredCount / requiredSteps.length) * 100);
  const filledFeeCount = Object.values(fees).filter((value) => value && value.trim() !== '').length;
  const totalBranchCount = 1 + extraLocations.length;
  const savedBranchCount = (mainLocationSaved ? 1 : 0) + savedLocationIds.length;
  const activePrivateTrainingCount = privateTrainings.filter((training) =>
    Boolean(
      training.coachName.trim() ||
      training.privateTrainingPrice.trim() ||
      training.coachBio.trim() ||
      training.specializations.trim() ||
      training.availability.trim()
    )
  ).length;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient
        colors={['#000000', '#1a1a1a', '#2d2d2d']}
        style={styles.gradient}
      >
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={handleBack}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.headerContent}>
              <Text style={styles.headerTitle}>{i18n.t('signup_academy')}</Text>
              <Text style={styles.headerSubtitle}>{i18n.t('createYourAcademyAccount')}</Text>
            </View>
          </View>

          <SignupStepBar
            currentStep={2}
            totalSteps={3}
            stepLabels={['Account Type', 'Your Profile', 'Get Started']}
          />

          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              showsVerticalScrollIndicator={false}
            >
            {formError && (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle" size={16} color="#ff3b30" />
                <Text style={styles.errorSubmitText}>{formError}</Text>
              </View>
            )}

            {/* Profile Picture Picker */}
            <View style={styles.profileSection}>
              <TouchableOpacity onPress={pickImage} style={styles.profileImageContainer}>
                {profileImage ? (
                  <Image source={{ uri: profileImage }} style={styles.profileImage} />
                ) : (
                  <View style={styles.profileImagePlaceholder}>
                    <Ionicons name="camera" size={32} color="#999" />
                  </View>
                )}
                <View style={styles.profileImageOverlay}>
                  <Ionicons name="camera" size={20} color="#fff" />
                </View>
              </TouchableOpacity>
              <Text style={styles.profileLabel}>
                {i18n.t('add_profile_picture')}
              </Text>
              <Text style={styles.profileHint}>
                {profileImage
                  ? (i18n.t('profilePhotoReady') || 'Great — your profile photo is ready.')
                  : (i18n.t('profilePhotoRecommended') || 'Optional, but highly recommended so your profile looks complete and professional.')}
              </Text>
              <View style={[styles.profileStatusPill, profileImage && styles.profileStatusPillSuccess]}>
                <Ionicons
                  name={profileImage ? 'checkmark-circle' : 'sparkles-outline'}
                  size={16}
                  color={profileImage ? '#166534' : '#374151'}
                />
                <Text style={[styles.profileStatusText, profileImage && styles.profileStatusTextSuccess]}>
                  {profileImage ? (i18n.t('profileReady') || 'Profile image added') : (i18n.t('optionalRecommended') || 'Optional but recommended')}
                </Text>
              </View>
            </View>

            <View style={styles.progressCard}>
              <View style={styles.progressHeaderRow}>
                <View style={styles.progressTitleWrap}>
                  <Text style={styles.progressTitle}>{i18n.t('completeYourAcademyProfile') || 'Complete your academy profile'}</Text>
                  <Text style={styles.progressSubtitle}>
                    {i18n.t('academySignupProgressHint') || 'A complete academy profile helps families understand your branches, fees, and training offer faster.'}
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
            <View style={styles.overviewStatsRow}>
              <View style={styles.overviewStatCard}>
                <Text style={styles.overviewStatValue}>{savedBranchCount}/{totalBranchCount}</Text>
                <Text style={styles.overviewStatLabel}>{i18n.t('savedBranchesLabel') || 'Branches saved'}</Text>
              </View>
              <View style={styles.overviewStatCard}>
                <Text style={styles.overviewStatValue}>{filledFeeCount}</Text>
                <Text style={styles.overviewStatLabel}>{i18n.t('feeGroupsLabel') || 'Fee groups set'}</Text>
              </View>
              <View style={styles.overviewStatCard}>
                <Text style={styles.overviewStatValue}>{activePrivateTrainingCount}</Text>
                <Text style={styles.overviewStatLabel}>{i18n.t('privateTrainingOffersLabel') || 'Private offers'}</Text>
              </View>
            </View>

            {/* Form Fields */}
            <View style={styles.formCard}>
              <View style={styles.sectionHeaderCard}>
                <View style={styles.sectionStepBadge}>
                  <Text style={styles.sectionStepText}>1</Text>
                </View>
                <View style={styles.sectionHeaderContent}>
                  <Text style={styles.sectionHeading}>{i18n.t('academyBasicsStep') || 'Academy basics'}</Text>
                  <Text style={styles.sectionSubheading}>{i18n.t('academyBasicsHint') || 'Start with the identity and contact details families will trust first.'}</Text>
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>
                  {i18n.t('academy_name')}
                  <Text style={styles.required}> *</Text>
                </Text>
                <View style={[styles.inputWrapper, missing.academyName && styles.inputWrapperError]}>
                  <Ionicons name="school-outline" size={20} color="#999" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={academyName}
                    onChangeText={t => { setAcademyName(t); if (missing.academyName) setMissing(m => ({ ...m, academyName: false })); validateField('academyName', t); }}
                    autoCapitalize="words"
                    placeholder={i18n.t('academy_name_placeholder')}
                    placeholderTextColor="#999"
                  />
                </View>
                {errors.academyName && <Text style={styles.errorText}>{errors.academyName}</Text>}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>
                  {i18n.t('phone')}
                  <Text style={styles.required}> *</Text>
                </Text>
                <View style={[styles.inputWrapper, missing.phone && styles.inputWrapperError]}>
                  <Ionicons name="call-outline" size={20} color="#999" style={styles.inputIcon} />
                  <Text style={{ color: '#999', fontSize: 16, fontWeight: '600', marginRight: 8 }}>+2</Text>
                  <TextInput
                    style={styles.input}
                    value={getEgyptPhoneLocalPart(phone)}
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
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>
                  {i18n.t('email_address')} <Text style={{ color: '#999', fontSize: 14 }}>({i18n.t('optional')})</Text>
                </Text>
                <View style={[styles.inputWrapper, missing.email && styles.inputWrapperError]}>
                  <Ionicons name="mail-outline" size={20} color="#999" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={t => {
                      setEmail(t);
                      if (missing.email) setMissing(m => ({ ...m, email: false }));
                      // Clear error if field is empty (since it's optional)
                      if (!t || t.trim().length === 0) {
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

              <View style={styles.inputGroup}>
                <Text style={styles.label}>
                  {i18n.t('password')}
                  <Text style={styles.required}> *</Text>
                </Text>
                <View style={[styles.inputWrapper, missing.password && styles.inputWrapperError]}>
                  <Ionicons name="lock-closed-outline" size={20} color="#999" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={password}
                    onChangeText={t => { setPassword(t); if (missing.password) setMissing(m => ({ ...m, password: false })); validateField('password', t); }}
                    secureTextEntry
                    placeholder={i18n.t('password_placeholder')}
                    placeholderTextColor="#999"
                  />
                </View>
                {errors.password && <Text style={styles.errorText}>{errors.password}</Text>}
              </View>

              <View style={styles.sectionHeaderCard}>
                <View style={styles.sectionStepBadge}>
                  <Text style={styles.sectionStepText}>2</Text>
                </View>
                <View style={styles.sectionHeaderContent}>
                  <Text style={styles.sectionHeading}>{i18n.t('academyBranchesStep') || 'Branch setup'}</Text>
                  <Text style={styles.sectionSubheading}>{i18n.t('academyBranchesHint') || 'Make your main and extra branches easy to discover, compare, and navigate.'}</Text>
                </View>
              </View>

              <View style={styles.branchSectionCard}>
                <View style={styles.branchSectionHeader}>
                  <Text style={styles.branchSectionTitle}>{i18n.t('mainLocationLabel') || 'Main branch'}</Text>
                  <Text style={styles.branchSectionSubtitle}>{i18n.t('branchLocationHelper') || 'Add the full city, district, address, and map pin for this branch.'}</Text>
                </View>

                <View style={styles.locationOverviewCard}>
                  <View style={styles.locationOverviewIcon}>
                    <Ionicons name="navigate-outline" size={18} color="#111827" />
                  </View>
                  <View style={styles.locationOverviewContent}>
                    <Text style={styles.locationOverviewTitle}>{i18n.t('locationExperienceTitle') || 'Make this location easy to find'}</Text>
                    <Text style={styles.locationOverviewText}>{i18n.t('locationExperienceHint') || 'This address and map pin will be shown in search, maps, and directions.'}</Text>
                  </View>
                </View>

                <View style={styles.locationHighlightsRow}>
                  {city ? (
                    <View style={styles.locationHighlightChip}>
                      <Ionicons name="business-outline" size={14} color="#334155" />
                      <Text style={styles.locationHighlightText}>{i18n.t(`cities.${city}`)}</Text>
                    </View>
                  ) : null}
                  {district ? (
                    <View style={styles.locationHighlightChip}>
                      <Ionicons name="location-outline" size={14} color="#334155" />
                      <Text style={styles.locationHighlightText}>{district}</Text>
                    </View>
                  ) : null}
                  <View style={[styles.locationHighlightChip, latitudeInput && longitudeInput && styles.locationHighlightChipSuccess]}>
                    <Ionicons
                      name={latitudeInput && longitudeInput ? 'checkmark-circle' : 'radio-button-off-outline'}
                      size={14}
                      color={latitudeInput && longitudeInput ? '#166534' : '#475569'}
                    />
                    <Text style={[styles.locationHighlightText, latitudeInput && longitudeInput && styles.locationHighlightTextSuccess]}>
                      {latitudeInput && longitudeInput
                        ? (i18n.t('searchReady') || 'Search-ready')
                        : (i18n.t('needsMapPin') || 'Needs map pin')}
                    </Text>
                  </View>
                </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>
                  {i18n.t('city')}
                  <Text style={styles.required}> *</Text>
                </Text>
                <TouchableOpacity
                  style={[styles.inputWrapper, styles.cityPickerWrapper, missing.city && styles.inputWrapperError]}
                  onPress={() => setShowCityModal(true)}
                >
                  <Ionicons name="location-outline" size={20} color="#999" style={styles.inputIcon} />
                  <Text style={[styles.cityText, !city && styles.cityPlaceholder]}>
                    {city ? i18n.t(`cities.${city}`) : i18n.t('selectCity') || 'Select City'}
                  </Text>
                  <Ionicons name="chevron-down" size={20} color="#999" />
                </TouchableOpacity>
                {errors.city && <Text style={styles.errorText}>{errors.city}</Text>}
                <Modal visible={showCityModal} transparent animationType="fade" onRequestClose={() => setShowCityModal(false)}>
                  <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowCityModal(false)}>
                    <View style={styles.modalContent}>
                      <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>{i18n.t('selectCity')}</Text>
                        <TouchableOpacity onPress={() => setShowCityModal(false)}>
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
                              setMainLocationSaved(false);
                              if (missing.city) setMissing(m => ({ ...m, city: false }));
                              validateField('city', option.key);
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
              <View style={styles.inputGroup}>
                <Text style={styles.label}>
                  {i18n.t('district') || 'District'}
                </Text>
                <TouchableOpacity
                  style={[styles.inputWrapper, styles.cityPickerWrapper, !isDistrictEnabled && styles.inputDisabled]}
                  onPress={() => isDistrictEnabled && setShowDistrictModal(true)}
                  disabled={!isDistrictEnabled}
                >
                  <Ionicons name="location-outline" size={20} color={isDistrictEnabled ? '#999' : '#666'} style={styles.inputIcon} />
                  <Text style={[styles.cityText, !district && styles.cityPlaceholder, !isDistrictEnabled && styles.disabledText]}>
                    {district || (!city
                      ? (i18n.t('selectCityFirst') || 'Select city first')
                      : (availableDistricts.length
                        ? (i18n.t('selectDistrict') || 'Select District')
                        : (i18n.t('noDistrictsAvailable') || 'No districts available')))}
                  </Text>
                  <Ionicons name="chevron-down" size={20} color={isDistrictEnabled ? '#999' : '#666'} />
                </TouchableOpacity>
                <Modal visible={showDistrictModal} transparent animationType="fade" onRequestClose={() => setShowDistrictModal(false)}>
                  <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowDistrictModal(false)}>
                    <View style={styles.modalContent}>
                      <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>{i18n.t('selectDistrict') || 'Select District'}</Text>
                        <TouchableOpacity onPress={() => setShowDistrictModal(false)}>
                          <Ionicons name="close" size={24} color="#000" />
                        </TouchableOpacity>
                      </View>
                      <ScrollView style={styles.modalScrollView}>
                        {availableDistricts.length ? availableDistricts.map(option => (
                          <TouchableOpacity
                            key={option.key}
                            style={[styles.cityOption, district === option.key && styles.cityOptionSelected]}
                            onPress={() => {
                              setDistrict(option.key);
                              setMainLocationSaved(false);
                              setShowDistrictModal(false);
                            }}
                          >
                            <Text style={[styles.cityOptionText, district === option.key && styles.cityOptionTextSelected]}>
                              {option.label}
                            </Text>
                            {district === option.key && <Ionicons name="checkmark" size={20} color="#fff" />}
                          </TouchableOpacity>
                        )) : (
                          <View style={styles.emptyInfoBox}>
                            <Text style={styles.emptyInfoText}>{i18n.t('noDistrictsAvailable') || 'No districts available'}</Text>
                          </View>
                        )}
                      </ScrollView>
                    </View>
                  </TouchableOpacity>
                </Modal>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>
                  {i18n.t('address')}
                  <Text style={styles.required}> *</Text>
                </Text>
                <View style={[styles.inputWrapper, missing.address && styles.inputWrapperError]}>
                  <Ionicons name="map-outline" size={20} color="#999" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={address}
                    onChangeText={t => { setAddress(t); setMainLocationSaved(false); if (missing.address) setMissing(m => ({ ...m, address: false })); validateField('address', t); }}
                    autoCapitalize="words"
                    placeholder={i18n.t('address_placeholder')}
                    placeholderTextColor="#999"
                  />
                </View>
                {errors.address && <Text style={styles.errorText}>{errors.address}</Text>}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{i18n.t('description')}</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="document-text-outline" size={20} color="#999" style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    value={description}
                    onChangeText={setDescription}
                    multiline
                    numberOfLines={4}
                    placeholder={i18n.t('description_placeholder')}
                    placeholderTextColor="#999"
                  />
                </View>
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>{i18n.t('social_url') || 'Website / Social URL'}<Text style={styles.required}> *</Text></Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="link-outline" size={20} color="#999" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={socialUrl}
                    onChangeText={t => { setSocialUrl(t); if (missing.socialUrl) setMissing(m => ({ ...m, socialUrl: false })); validateField('socialUrl', t); }}
                    autoCapitalize="none"
                    placeholder="https://example.com or https://instagram.com/yourprofile"
                    placeholderTextColor="#999"
                  />
                </View>
                {errors.socialUrl && <Text style={styles.errorText}>{errors.socialUrl}</Text>}
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>{i18n.t('mapCoordinatesOptional') || 'Location on map'}</Text>
                <Text style={styles.helperText}>
                  {i18n.t('mapCoordinatesHelper') || 'Choose the academy directly on the map for the best nearest-to-me accuracy, or use your current location.'}
                </Text>
                <View style={styles.mapActionsRow}>
                  <TouchableOpacity
                    style={styles.mapPickerButton}
                    onPress={openMapPicker}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="map-outline" size={18} color="#fff" />
                    <Text style={styles.mapPickerButtonText}>{i18n.t('chooseOnMap') || 'Choose on map'}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.locationAutofillButton, locationAutofillLoading && styles.locationAutofillButtonDisabled]}
                    onPress={handleUseCurrentLocation}
                    disabled={locationAutofillLoading}
                    activeOpacity={0.85}
                  >
                    {locationAutofillLoading ? (
                      <FootballLoader size="small" color="#000" />
                    ) : (
                      <Ionicons name="locate-outline" size={18} color="#000" />
                    )}
                    <Text style={styles.locationAutofillButtonText}>
                      {locationAutofillLoading
                        ? (i18n.t('gettingCurrentLocation') || 'Getting current location...')
                        : (i18n.t('useCurrentLocation') || 'Use current location')}
                    </Text>
                  </TouchableOpacity>
                </View>
                <View style={[styles.mapStatusPill, latitudeInput && longitudeInput && styles.mapStatusPillSuccess]}>
                  <Ionicons
                    name={latitudeInput && longitudeInput ? 'checkmark-circle' : 'pin-outline'}
                    size={18}
                    color={latitudeInput && longitudeInput ? '#15803d' : '#6b7280'}
                  />
                  <Text style={styles.mapStatusText}>
                    {latitudeInput && longitudeInput
                      ? (i18n.t('mapPinSelected') || 'Map pin selected successfully')
                      : (i18n.t('mapPinNotSelected') || 'No map pin selected yet')}
                  </Text>
                </View>

                {errors.coordinates && <Text style={styles.errorText}>{errors.coordinates}</Text>}
                <TouchableOpacity
                  style={[
                    styles.addLocationButton,
                    { marginTop: 4 },
                    mainLocationSaved && { backgroundColor: '#ecfdf5', borderColor: '#86efac', borderStyle: 'solid' as const }
                  ]}
                  onPress={handleSaveMainLocation}
                  activeOpacity={0.85}
                >
                  <Ionicons name={mainLocationSaved ? 'checkmark-circle' : 'save-outline'} size={18} color={mainLocationSaved ? '#166534' : '#000'} />
                  <Text style={[styles.addLocationButtonText, mainLocationSaved && { color: '#166534' }]}>
                    {mainLocationSaved ? (i18n.t('savedLabel') || 'Saved') : (i18n.t('save') || 'Save')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {extraLocations.map((location) => {
              const branchDistricts = getDistrictOptionsForCity(location.city);
              const isBranchDistrictEnabled = Boolean(location.city && branchDistricts.length > 0);
              const isBranchSaved = savedLocationIds.includes(location.id);

              return (
                <View key={location.id} style={styles.branchSectionCard}>
                  <View style={styles.additionalLocationHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.additionalLocationTitle}>{location.label}</Text>
                      <Text style={styles.branchSectionSubtitle}>{i18n.t('branchLocationHelper') || 'Add the full city, district, address, and map pin for this branch.'}</Text>
                    </View>
                    <TouchableOpacity style={styles.branchRemoveButton} onPress={() => removeExtraLocation(location.id)}>
                      <Ionicons name="trash-outline" size={16} color="#b91c1c" />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.locationHighlightsRow}>
                    {location.city ? (
                      <View style={styles.locationHighlightChip}>
                        <Ionicons name="business-outline" size={14} color="#334155" />
                        <Text style={styles.locationHighlightText}>{i18n.t(`cities.${location.city}`)}</Text>
                      </View>
                    ) : null}
                    {location.district ? (
                      <View style={styles.locationHighlightChip}>
                        <Ionicons name="location-outline" size={14} color="#334155" />
                        <Text style={styles.locationHighlightText}>{location.district}</Text>
                      </View>
                    ) : null}
                    <View style={[styles.locationHighlightChip, location.latitude != null && location.longitude != null && styles.locationHighlightChipSuccess]}>
                      <Ionicons
                        name={location.latitude != null && location.longitude != null ? 'checkmark-circle' : 'radio-button-off-outline'}
                        size={14}
                        color={location.latitude != null && location.longitude != null ? '#166534' : '#475569'}
                      />
                      <Text style={[styles.locationHighlightText, location.latitude != null && location.longitude != null && styles.locationHighlightTextSuccess]}>
                        {location.latitude != null && location.longitude != null
                          ? (i18n.t('searchReady') || 'Search-ready')
                          : (i18n.t('needsMapPin') || 'Needs map pin')}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>{i18n.t('city')}<Text style={styles.required}> *</Text></Text>
                    <TouchableOpacity
                      style={[styles.inputWrapper, styles.cityPickerWrapper]}
                      onPress={() => setActiveExtraCityId(location.id)}
                    >
                      <Ionicons name="location-outline" size={20} color="#999" style={styles.inputIcon} />
                      <Text style={[styles.cityText, !location.city && styles.cityPlaceholder]}>
                        {location.city ? i18n.t(`cities.${location.city}`) : (i18n.t('selectCity') || 'Select City')}
                      </Text>
                      <Ionicons name="chevron-down" size={20} color="#999" />
                    </TouchableOpacity>
                    <Modal visible={activeExtraCityId === location.id} transparent animationType="fade" onRequestClose={() => setActiveExtraCityId(null)}>
                      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setActiveExtraCityId(null)}>
                        <View style={styles.modalContent}>
                          <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>{i18n.t('selectCity') || 'Select City'}</Text>
                            <TouchableOpacity onPress={() => setActiveExtraCityId(null)}>
                              <Ionicons name="close" size={24} color="#000" />
                            </TouchableOpacity>
                          </View>
                          <ScrollView style={styles.modalScrollView}>
                            {cityOptions.map((option) => (
                              <TouchableOpacity
                                key={option.key}
                                style={[styles.cityOption, location.city === option.key && styles.cityOptionSelected]}
                                onPress={() => {
                                  updateExtraLocation(location.id, { city: option.key });
                                  setActiveExtraCityId(null);
                                }}
                              >
                                <Text style={[styles.cityOptionText, location.city === option.key && styles.cityOptionTextSelected]}>
                                  {option.label}
                                </Text>
                                {location.city === option.key && <Ionicons name="checkmark" size={20} color="#fff" />}
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        </View>
                      </TouchableOpacity>
                    </Modal>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>{i18n.t('district') || 'District'}</Text>
                    <TouchableOpacity
                      style={[styles.inputWrapper, styles.cityPickerWrapper, !isBranchDistrictEnabled && styles.inputDisabled]}
                      onPress={() => isBranchDistrictEnabled && setActiveExtraDistrictId(location.id)}
                      disabled={!isBranchDistrictEnabled}
                    >
                      <Ionicons name="location-outline" size={20} color={isBranchDistrictEnabled ? '#999' : '#666'} style={styles.inputIcon} />
                      <Text style={[styles.cityText, !location.district && styles.cityPlaceholder, !isBranchDistrictEnabled && styles.disabledText]}>
                        {location.district || (!location.city
                          ? (i18n.t('selectCityFirst') || 'Select city first')
                          : (branchDistricts.length
                            ? (i18n.t('selectDistrict') || 'Select District')
                            : (i18n.t('noDistrictsAvailable') || 'No districts available')))}
                      </Text>
                      <Ionicons name="chevron-down" size={20} color={isBranchDistrictEnabled ? '#999' : '#666'} />
                    </TouchableOpacity>
                    <Modal visible={activeExtraDistrictId === location.id} transparent animationType="fade" onRequestClose={() => setActiveExtraDistrictId(null)}>
                      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setActiveExtraDistrictId(null)}>
                        <View style={styles.modalContent}>
                          <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>{i18n.t('selectDistrict') || 'Select District'}</Text>
                            <TouchableOpacity onPress={() => setActiveExtraDistrictId(null)}>
                              <Ionicons name="close" size={24} color="#000" />
                            </TouchableOpacity>
                          </View>
                          <ScrollView style={styles.modalScrollView}>
                            {branchDistricts.length ? branchDistricts.map((option) => (
                              <TouchableOpacity
                                key={option.key}
                                style={[styles.cityOption, location.district === option.key && styles.cityOptionSelected]}
                                onPress={() => {
                                  updateExtraLocation(location.id, { district: option.key });
                                  setActiveExtraDistrictId(null);
                                }}
                              >
                                <Text style={[styles.cityOptionText, location.district === option.key && styles.cityOptionTextSelected]}>
                                  {option.label}
                                </Text>
                                {location.district === option.key && <Ionicons name="checkmark" size={20} color="#fff" />}
                              </TouchableOpacity>
                            )) : (
                              <View style={styles.emptyInfoBox}>
                                <Text style={styles.emptyInfoText}>{i18n.t('noDistrictsAvailable') || 'No districts available'}</Text>
                              </View>
                            )}
                          </ScrollView>
                        </View>
                      </TouchableOpacity>
                    </Modal>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>{i18n.t('address')}<Text style={styles.required}> *</Text></Text>
                    <View style={styles.inputWrapper}>
                      <Ionicons name="map-outline" size={20} color="#999" style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        value={location.address}
                        onChangeText={(value) => updateExtraLocation(location.id, { address: value })}
                        autoCapitalize="words"
                        placeholder={i18n.t('address_placeholder') || 'Full address'}
                        placeholderTextColor="#999"
                      />
                    </View>
                  </View>

                  <Text style={styles.helperText}>
                    {i18n.t('mapCoordinatesHelper') || 'Choose the academy directly on the map for the best nearest-to-me accuracy, or use your current location.'}
                  </Text>
                  <View style={styles.mapActionsRow}>
                    <TouchableOpacity
                      style={styles.mapPickerButton}
                      onPress={() => openAdditionalLocationPicker(location.id)}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="map-outline" size={18} color="#fff" />
                      <Text style={styles.mapPickerButtonText}>{i18n.t('chooseOnMap') || 'Choose on map'}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={[styles.mapStatusPill, location.latitude != null && location.longitude != null && styles.mapStatusPillSuccess]}>
                    <Ionicons
                      name={location.latitude != null && location.longitude != null ? 'checkmark-circle' : 'pin-outline'}
                      size={18}
                      color={location.latitude != null && location.longitude != null ? '#15803d' : '#6b7280'}
                    />
                    <Text style={styles.mapStatusText}>
                      {location.latitude != null && location.longitude != null
                        ? (i18n.t('mapPinSelected') || 'Map pin selected successfully')
                        : (i18n.t('mapPinNotSelected') || 'No map pin selected yet')}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.addLocationButton,
                      { marginTop: 6 },
                      isBranchSaved && { backgroundColor: '#ecfdf5', borderColor: '#86efac', borderStyle: 'solid' as const }
                    ]}
                    onPress={() => handleSaveExtraLocation(location.id)}
                    activeOpacity={0.85}
                  >
                    <Ionicons name={isBranchSaved ? 'checkmark-circle' : 'save-outline'} size={18} color={isBranchSaved ? '#166534' : '#000'} />
                    <Text style={[styles.addLocationButtonText, isBranchSaved && { color: '#166534' }]}>
                      {isBranchSaved ? (i18n.t('savedLabel') || 'Saved') : (i18n.t('save') || 'Save')}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}

            <TouchableOpacity style={styles.addLocationButton} onPress={addExtraLocationCard}>
              <Ionicons name="add-circle-outline" size={18} color="#000" />
              <Text style={styles.addLocationButtonText}>{i18n.t('addAnotherLocation') || 'Add another location'}</Text>
            </TouchableOpacity>

              <View style={styles.sectionHeaderCard}>
                <View style={styles.sectionStepBadge}>
                  <Text style={styles.sectionStepText}>3</Text>
                </View>
                <View style={styles.sectionHeaderContent}>
                  <Text style={styles.sectionHeading}>{i18n.t('academyPricingStep') || 'Pricing & programs'}</Text>
                  <Text style={styles.sectionSubheading}>{i18n.t('academyPricingHint') || 'Set clear monthly fees and optional programs so families understand your offer quickly.'}</Text>
                </View>
              </View>

              <View style={styles.pricingSummaryCard}>
                <View style={styles.pricingSummaryHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pricingSummaryTitle}>{i18n.t('monthlyFeesPerAgeGroup')}</Text>
                    <Text style={styles.pricingSummaryText}>{i18n.t('academyPricingHelper') || 'Add fees for the age groups you currently serve. You can refine the full pricing table later.'}</Text>
                  </View>
                  <View style={styles.pricingSummaryBadge}>
                    <Text style={styles.pricingSummaryBadgeText}>{filledFeeCount}/{ageGroups.length}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.feeQuickActionsCard}>
                <Text style={styles.feeQuickActionsTitle}>{i18n.t('quickPricingHelper') || 'Quick pricing helper'}</Text>
                <Text style={styles.helperText}>{i18n.t('quickPricingHelperHint') || 'Enter one monthly fee and apply it to any empty age groups to save time.'}</Text>
                <View style={styles.feeQuickActionsRow}>
                  <View style={styles.feeQuickInputWrap}>
                    <Ionicons name="cash-outline" size={18} color="#6b7280" />
                    <TextInput
                      style={styles.feeCardInput}
                      value={bulkFeeValue}
                      onChangeText={(value) => setBulkFeeValue(value.replace(/[^0-9]/g, ''))}
                      keyboardType="numeric"
                      placeholder={i18n.t('feePlaceholder') || 'Monthly fee'}
                      placeholderTextColor="#9ca3af"
                      maxLength={6}
                    />
                  </View>
                  <TouchableOpacity
                    style={[styles.feeQuickActionButton, !bulkFeeValue.trim() && styles.feeQuickActionButtonDisabled]}
                    onPress={applyBulkFeeToEmptyAges}
                    disabled={!bulkFeeValue.trim()}
                  >
                    <Text style={styles.feeQuickActionButtonText}>{i18n.t('applyToEmptyAges') || 'Apply to empty'}</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.feeClearButton} onPress={clearAllFees}>
                  <Text style={styles.feeClearButtonText}>{i18n.t('clearAllFees') || 'Clear all fees'}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.feeGrid}>
                {ageGroups.map((age) => {
                  const hasFee = Boolean(fees[age]?.trim());
                  return (
                    <View key={age} style={[styles.feeCard, hasFee && styles.feeCardFilled]}>
                      <View style={styles.feeCardHeader}>
                        <Text style={styles.feeCardTitle}>{`U${age}`}</Text>
                        {hasFee ? (
                          <View style={styles.feeFilledPill}>
                            <Text style={styles.feeFilledPillText}>{i18n.t('savedLabel') || 'Saved'}</Text>
                          </View>
                        ) : null}
                      </View>
                      <TextInput
                        style={styles.feeCardInput}
                        value={fees[age] || ''}
                        onChangeText={(value) => handleFeeChange(age, value)}
                        keyboardType="numeric"
                        placeholder={i18n.t('feePlaceholder') || 'Monthly fee'}
                        placeholderTextColor="#9ca3af"
                        maxLength={6}
                      />
                      <Text style={styles.feeCardCurrency}>{i18n.t('monthlyFeeCaption') || 'EGP / month'}</Text>
                    </View>
                  );
                })}
              </View>
              {errors.fees && <Text style={styles.errorText}>{errors.fees}</Text>}

              <View style={styles.sectionHeaderCard}>
                <View style={styles.sectionStepBadge}>
                  <Text style={styles.sectionStepText}>4</Text>
                </View>
                <View style={styles.sectionHeaderContent}>
                  <Text style={styles.sectionHeading}>{i18n.t('academyPrivateTrainingStep') || 'Private training (optional)'}</Text>
                  <Text style={styles.sectionSubheading}>{i18n.t('academyPrivateTrainingHint') || 'Enable this if you want to highlight coaches and one-to-one sessions during signup.'}</Text>
                </View>
              </View>

              <View style={styles.choiceRow}>
                <TouchableOpacity
                  style={[styles.choiceChip, privateTrainingEnabled && styles.choiceChipActive]}
                  onPress={() => setPrivateTrainingEnabled(true)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.choiceChipText, privateTrainingEnabled && styles.choiceChipTextActive]}>{i18n.t('offerPrivateTraining') || 'Offer private training'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.choiceChip, !privateTrainingEnabled && styles.choiceChipActive]}
                  onPress={() => setPrivateTrainingEnabled(false)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.choiceChipText, !privateTrainingEnabled && styles.choiceChipTextActive]}>{i18n.t('setupLater') || 'Set up later'}</Text>
                </TouchableOpacity>
              </View>

              {privateTrainingEnabled ? (
                <>
                  <View style={styles.optionalSectionCard}>
                    <Ionicons name="flash-outline" size={18} color="#111827" />
                    <View style={styles.optionalSectionContent}>
                      <Text style={styles.optionalSectionTitle}>{i18n.t('privateTrainingDesc') || 'Add coach & private session details.'}</Text>
                      <Text style={styles.optionalSectionText}>
                        {activePrivateTrainingCount > 0
                          ? `${activePrivateTrainingCount} ${i18n.t('privateTrainingOffersLabel') || 'private offers'} ${i18n.t('savedLabel') || 'saved'}`
                          : (i18n.t('privateTrainingOptionalHint') || 'This section is optional. Add one or more coaches if you already offer private sessions.')}
                      </Text>
                    </View>
                  </View>

                  {privateTrainings.map((training, index) => (
                <View key={index} style={styles.trainingBlock}>
                  {privateTrainings.length > 1 && (
                    <View style={styles.trainingBlockHeader}>
                      <Text style={styles.trainingBlockTitle}>Training #{index + 1}</Text>
                      <TouchableOpacity onPress={() => removeTraining(index)} style={styles.removeTrainingBtn}>
                        <Ionicons name="trash-outline" size={20} color="#ff3b30" />
                      </TouchableOpacity>
                    </View>
                  )}
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>{i18n.t('coachName') || 'Coach Name'}</Text>
                    <View style={styles.inputWrapper}>
                      <Ionicons name="person-outline" size={20} color="#999" style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        value={training.coachName}
                        onChangeText={(v) => updateTraining(index, 'coachName', v)}
                        placeholder={i18n.t('coachNamePlaceholder') || 'Coach name'}
                        placeholderTextColor="#999"
                      />
                    </View>
                  </View>
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>{i18n.t('privateTrainingPrice') || 'Price per Session'}</Text>
                    <View style={styles.inputWrapper}>
                      <Ionicons name="cash-outline" size={20} color="#999" style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        value={training.privateTrainingPrice}
                        onChangeText={(v) => updateTraining(index, 'privateTrainingPrice', v.replace(/[^0-9]/g, ''))}
                        keyboardType="numeric"
                        placeholder={i18n.t('privateTrainingPricePlaceholder') || 'e.g., 500'}
                        placeholderTextColor="#999"
                      />
                    </View>
                  </View>
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>{i18n.t('coachBio') || 'Coach Bio'}</Text>
                    <View style={[styles.inputWrapper, { minHeight: 90 }]}>
                      <Ionicons name="document-text-outline" size={20} color="#999" style={styles.inputIcon} />
                      <TextInput
                        style={[styles.input, { height: 80 }]}
                        value={training.coachBio}
                        onChangeText={(v) => updateTraining(index, 'coachBio', v)}
                        multiline
                        numberOfLines={4}
                        placeholder={i18n.t('coachBioPlaceholder') || 'Brief coach biography'}
                        placeholderTextColor="#999"
                      />
                    </View>
                  </View>
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>{i18n.t('specializations') || 'Specializations'}</Text>
                    <View style={styles.inputWrapper}>
                      <Ionicons name="list-outline" size={20} color="#999" style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        value={training.specializations}
                        onChangeText={(v) => updateTraining(index, 'specializations', v)}
                        placeholder={i18n.t('specializationsPlaceholder') || 'Comma-separated (e.g., Strength, Agility)'}
                        placeholderTextColor="#999"
                      />
                    </View>
                  </View>
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>{i18n.t('sessionDuration') || 'Session Duration (min)'}</Text>
                    <View style={styles.inputWrapper}>
                      <Ionicons name="time-outline" size={20} color="#999" style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        value={training.sessionDuration}
                        onChangeText={(v) => updateTraining(index, 'sessionDuration', v.replace(/[^0-9]/g, ''))}
                        keyboardType="numeric"
                        placeholder="60"
                        placeholderTextColor="#999"
                      />
                    </View>
                  </View>
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>{i18n.t('availability') || 'Availability'}</Text>
                    <View style={[styles.inputWrapper, { minHeight: 90 }]}>
                      <Ionicons name="calendar-outline" size={20} color="#999" style={styles.inputIcon} />
                      <TextInput
                        style={[styles.input, { height: 80 }]}
                        value={training.availability}
                        onChangeText={(v) => updateTraining(index, 'availability', v)}
                        multiline
                        numberOfLines={4}
                        placeholder={i18n.t('availabilityPlaceholder') || 'e.g., Mon-Fri 4-8 PM'}
                        placeholderTextColor="#999"
                      />
                    </View>
                  </View>
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>{i18n.t('trainerBranch') || 'Trainer Branch'}</Text>
                    {academyBranchOptions.length > 0 ? (
                      <View style={styles.branchChoiceList}>
                        {academyBranchOptions.map((branch) => {
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
                              activeOpacity={0.85}
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

                  <TouchableOpacity style={styles.addTrainingButton} onPress={addTraining}>
                    <Ionicons name="add-circle-outline" size={20} color="#111827" />
                    <Text style={styles.addTrainingButtonText}>{i18n.t('addAnotherPrivateTraining') || 'Add another private training'}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <View style={styles.optionalSectionCard}>
                  <Ionicons name="sparkles-outline" size={18} color="#111827" />
                  <View style={styles.optionalSectionContent}>
                    <Text style={styles.optionalSectionTitle}>{i18n.t('setupLater') || 'Set up later'}</Text>
                    <Text style={styles.optionalSectionText}>{i18n.t('privateTrainingOptionalHint') || 'Private training is optional. You can publish your academy basics first and add coaches later.'}</Text>
                  </View>
                </View>
              )}

              <View style={styles.sectionHeaderCard}>
                <View style={styles.sectionStepBadge}>
                  <Text style={styles.sectionStepText}>5</Text>
                </View>
                <View style={styles.sectionHeaderContent}>
                  <Text style={styles.sectionHeading}>{i18n.t('academyReviewStep') || 'Review before launch'}</Text>
                  <Text style={styles.sectionSubheading}>{i18n.t('academyReviewHint') || 'Double-check the essentials families will see first on your public profile.'}</Text>
                </View>
              </View>

              <View style={styles.reviewCard}>
                <View style={styles.reviewRow}>
                  <Text style={styles.reviewLabel}>{i18n.t('academy_name')}</Text>
                  <Text style={styles.reviewValue}>{academyName || '—'}</Text>
                </View>
                <View style={styles.reviewRow}>
                  <Text style={styles.reviewLabel}>{i18n.t('mainLocationLabel') || 'Main branch'}</Text>
                  <Text style={styles.reviewValue}>{city ? i18n.t(`cities.${city}`) : '—'}</Text>
                </View>
                <View style={styles.reviewRow}>
                  <Text style={styles.reviewLabel}>{i18n.t('savedBranchesLabel') || 'Branches saved'}</Text>
                  <Text style={styles.reviewValue}>{savedBranchCount}/{totalBranchCount}</Text>
                </View>
                <View style={styles.reviewRow}>
                  <Text style={styles.reviewLabel}>{i18n.t('feeGroupsLabel') || 'Fee groups set'}</Text>
                  <Text style={styles.reviewValue}>{filledFeeCount}</Text>
                </View>
                <View style={styles.reviewRow}>
                  <Text style={styles.reviewLabel}>{i18n.t('privateTrainingOffersLabel') || 'Private offers'}</Text>
                  <Text style={styles.reviewValue}>{privateTrainingEnabled ? activePrivateTrainingCount : 0}</Text>
                </View>
              </View>

              <View style={styles.submitPanel}>
                <Text style={styles.submitHint}>{i18n.t('academySubmitHint') || 'Review your academy details before creating the account. You can update them later.'}</Text>
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
          </TouchableWithoutFeedback>
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
  overviewStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 18,
  },
  overviewStatCard: {
    flex: 1,
    minWidth: 92,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  overviewStatValue: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 4,
  },
  overviewStatLabel: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  sectionHeaderCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    marginBottom: 16,
  },
  sectionStepBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  sectionStepText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  sectionHeaderContent: {
    flex: 1,
  },
  pricingSummaryCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    marginBottom: 14,
  },
  pricingSummaryHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  pricingSummaryTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
  },
  pricingSummaryText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#64748b',
  },
  pricingSummaryBadge: {
    backgroundColor: '#111827',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  pricingSummaryBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  feeQuickActionsCard: {
    backgroundColor: '#f9fafb',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 14,
    marginBottom: 14,
  },
  feeQuickActionsTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 6,
  },
  feeQuickActionsRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  feeQuickInputWrap: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  feeQuickActionButton: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#111827',
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feeQuickActionButtonDisabled: {
    opacity: 0.5,
  },
  feeQuickActionButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  feeClearButton: {
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  feeClearButtonText: {
    color: '#b91c1c',
    fontSize: 13,
    fontWeight: '700',
  },
  feeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 4,
  },
  feeCard: {
    width: '48%',
    minWidth: 135,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 12,
  },
  feeCardFilled: {
    borderColor: '#86efac',
    backgroundColor: '#f0fdf4',
  },
  feeCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  },
  feeCardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
  },
  feeFilledPill: {
    backgroundColor: '#dcfce7',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  feeFilledPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#166534',
  },
  feeCardInput: {
    fontSize: 16,
    color: '#111827',
    fontWeight: '700',
    paddingVertical: 0,
  },
  feeCardCurrency: {
    marginTop: 8,
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '600',
  },
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  choiceChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  choiceChipActive: {
    backgroundColor: '#111827',
    borderColor: '#111827',
  },
  choiceChipText: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '700',
  },
  choiceChipTextActive: {
    color: '#fff',
  },
  optionalSectionCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    marginBottom: 14,
  },
  optionalSectionContent: {
    flex: 1,
  },
  optionalSectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
  },
  optionalSectionText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#64748b',
  },
  reviewCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    marginBottom: 10,
  },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  reviewLabel: {
    flex: 1,
    fontSize: 13,
    color: '#64748b',
    fontWeight: '700',
  },
  reviewValue: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: 14,
    color: '#111827',
    fontWeight: '800',
  },
  required: {
    color: '#ff3b30',
  },
  sectionHeader: {
    marginBottom: 16,
  },
  sectionHeading: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111',
    marginBottom: 4,
  },
  sectionSubheading: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  trainingBlock: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    backgroundColor: '#fcfcfd',
  },
  trainingBlockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  trainingBlockTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  removeTrainingBtn: {
    padding: 4,
  },
  addTrainingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 20,
    gap: 8,
    backgroundColor: '#f8fafc',
  },
  addTrainingButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
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
  inputGroup: {
    marginBottom: 20,
  },
  branchChoiceList: {
    gap: 8,
  },
  branchChoiceButton: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  branchChoiceButtonSelected: {
    borderColor: '#111827',
    backgroundColor: '#f3f4f6',
  },
  branchChoiceText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#374151',
    fontWeight: '600',
  },
  branchChoiceTextSelected: {
    color: '#111827',
  },
  branchChoiceHint: {
    fontSize: 13,
    lineHeight: 18,
    color: '#6b7280',
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
  inputWrapperError: {
    borderColor: '#ff3b30',
    backgroundColor: '#fff5f5',
  },
  inputDisabled: {
    backgroundColor: '#f0f0f0',
    borderColor: '#e5e7eb',
  },
  disabledText: {
    color: '#666',
  },
  helperText: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 19,
    marginBottom: 12,
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
    marginTop: 2,
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
    backgroundColor: '#111827',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 46,
  },
  mapPickerButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },
  locationAutofillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d1d5db',
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 46,
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
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 4,
  },
  mapStatusPillSuccess: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
  },
  mapStatusText: {
    flex: 1,
    fontSize: 13,
    color: '#0f172a',
    fontWeight: '700',
  },
  branchSectionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 3,
  },
  branchSectionHeader: {
    marginBottom: 12,
  },
  branchSectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  branchSectionSubtitle: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 19,
  },
  locationOverviewCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    marginBottom: 12,
  },
  locationOverviewIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e5e7eb',
  },
  locationOverviewContent: {
    flex: 1,
  },
  locationOverviewTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 2,
  },
  locationOverviewText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  locationHighlightsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  locationHighlightChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  locationHighlightChipSuccess: {
    backgroundColor: '#ecfdf5',
    borderColor: '#86efac',
  },
  locationHighlightText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  locationHighlightTextSuccess: {
    color: '#166534',
  },
  additionalLocationsList: {
    gap: 8,
    marginTop: 10,
  },
  additionalLocationCard: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  additionalLocationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  branchRemoveButton: {
    padding: 4,
    marginLeft: 8,
  },
  additionalLocationTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  additionalLocationText: {
    fontSize: 13,
    color: '#4b5563',
    lineHeight: 18,
  },
  addLocationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    backgroundColor: '#eef2f7',
    paddingVertical: 11,
    paddingHorizontal: 14,
    marginTop: 10,
  },
  addLocationButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  emptyInfoBox: {
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyInfoText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  cityPickerWrapper: {
    paddingHorizontal: 16,
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
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
    paddingTop: 16,
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
  feeBubblesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
    width: '100%',
    gap: 8,
  },
  feeBubble: {
    backgroundColor: '#f5f5f5',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginHorizontal: 2,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: '#e0e0e0',
    minWidth: 60,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  feeBubbleSelected: {
    backgroundColor: '#000',
    borderColor: '#000',
  },
  feeBubbleText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 18,
  },
  feeBubbleTextSelected: {
    color: '#fff',
  },
  feeBubbleInputBox: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#000',
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'flex-start',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    minWidth: 140,
    zIndex: 10,
  },
  feeBubbleInput: {
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontSize: 16,
    color: '#000',
    minWidth: 80,
    marginTop: 4,
    textAlign: 'left',
    fontWeight: '600',
  },
  feeInputLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 6,
    fontWeight: '500',
  },
});

export default SignupAcademy;
