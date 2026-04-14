import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { writeEmailIndex } from '../lib/emailIndex';
import { writePhoneIndex } from '../lib/phoneIndex';
import { normalizePhoneForAuth } from '../lib/validations';
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
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
// import { db } from '../lib/firebase'; // Already imported above
import {
  validateAddress,
  validateCity,
  validateEmail,
  validatePassword,
  validatePhone,
  validateRequired,
  normalizePhoneForTwilio
} from '../lib/validations';
import i18n from '../locales/i18n';
// import OtpModal from '../components/OtpModal'; // Removed
import { getBackendUrl } from '../lib/config';

function isValidTimeFormat(time: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(time); // Matches HH:mm from 00:00 to 23:59
}

interface Errors {
  clinicName?: string;
  email?: string;
  password?: string;
  city?: string;
  address?: string;
  phone?: string;
  socialUrl?: string;
  mapUrl?: string;
  coordinates?: string;
  services?: string;
  workingHours?: string;
  doctors?: string;
}

const LOCATION_PICKER_RESULT_KEY = 'clinicSignupLocationPickerResult';
const EXTRA_LOCATION_PICKER_RESULT_KEY = 'clinicSignupExtraLocationPickerResult';
const CLINIC_SIGNUP_DRAFT_KEY = 'clinicSignupDraft';

type ClinicBranchLocation = {
  id: string;
  label: string;
  city: string;
  district?: string;
  address: string;
  mapUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

const districtsByCity: Record<string, Array<{ key: string; label: string }>> = {
  cairo: [
    { key: 'Maadi', label: 'Maadi' },
    { key: 'Nasr City', label: 'Nasr City' },
    { key: 'Heliopolis', label: 'Heliopolis' },
    { key: 'Mokattam', label: 'Mokattam' },
    { key: 'New Cairo', label: 'New Cairo' },
    { key: 'Rehab', label: 'Rehab' },
    { key: 'Madinaty', label: 'Madinaty' },
    { key: 'Shorouk', label: 'Shorouk' },
    { key: '6 October', label: '6 October' },
    { key: 'Sheikh Zayed', label: 'Sheikh Zayed' },
    { key: 'Zamalek', label: 'Zamalek' },
    { key: 'Dokki', label: 'Dokki' },
    { key: 'Mohandessin', label: 'Mohandessin' },
    { key: 'Faisal', label: 'Faisal' },
    { key: 'Haram', label: 'Haram' },
  ],
  alexandria: [
    { key: 'Roushdy', label: 'Roushdy' },
    { key: 'Smouha', label: 'Smouha' },
    { key: 'Sporting', label: 'Sporting' },
    { key: 'Kafr Abdo', label: 'Kafr Abdo' },
    { key: 'Gleem', label: 'Gleem' },
    { key: 'Sidi Bishr', label: 'Sidi Bishr' },
    { key: 'Miami', label: 'Miami' },
    { key: 'Mandara', label: 'Mandara' },
    { key: 'Agami', label: 'Agami' },
    { key: 'Montaza', label: 'Montaza' },
  ],
};

const SignupClinic = () => {
  const router = useRouter();
  const [clinicName, setClinicName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [city, setCity] = useState('');
  const [district, setDistrict] = useState('');
  const [showCityModal, setShowCityModal] = useState(false);
  const [showDistrictModal, setShowDistrictModal] = useState(false);
  const [activeExtraCityId, setActiveExtraCityId] = useState<string | null>(null);
  const [activeExtraDistrictId, setActiveExtraDistrictId] = useState<string | null>(null);
  const pendingExtraLocationIdRef = useRef<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [missing, setMissing] = useState<{ [key: string]: boolean }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [mainLocationSaved, setMainLocationSaved] = useState(false);
  const [savedLocationIds, setSavedLocationIds] = useState<string[]>([]);
  const [draftReady, setDraftReady] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const cityOptions = Object.entries(i18n.t('cities', { returnObjects: true }) as Record<string, string>).map(([key, label]) => ({ key, label }));

  // Only store selected service keys (keep this one, remove duplicate below)
  const allServices = [
    { key: 'spa', label: i18n.t('spa') || 'Spa' },
    { key: 'sauna', label: i18n.t('sauna') || 'Sauna' },
    { key: 'physio', label: i18n.t('physio') || 'Physiotherapy' },
    { key: 'ice_bath', label: i18n.t('ice_bath') || 'Ice Bath' },
    { key: 'massage', label: i18n.t('massage') || 'Massage' },
    { key: 'full_recovery', label: i18n.t('full_recovery') || 'Full Recovery' },
    { key: 'nutrition', label: i18n.t('nutrition') || 'Nutrition' },
    { key: 'rehab', label: i18n.t('rehab') || 'Rehabilitation' },
    { key: 'stretching', label: i18n.t('stretching') || 'Stretching' },
    { key: 'other', label: i18n.t('other') || 'Other' },
  ];

  const [services, setServices] = useState(() =>
    Object.fromEntries(allServices.map(({ key }) => [key, { selected: false, fee: '' }]))
  );
  // Store prices for each service
  const [customServices, setCustomServices] = useState<{ name: string; price: string }[]>([]);
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [workingHours, setWorkingHours] = useState<Record<string, { from: string; to: string; doctors: string; off?: boolean }>>({});
  // Doctors list: array of { name: string, major?: string }
  const [doctors, setDoctors] = useState<{ name: string; major?: string; description?: string; photoUri?: string }[]>([]);
  const [timePicker, setTimePicker] = useState<{ visible: boolean, mode: 'from' | 'to', day: string | null }>({ visible: false, mode: 'from', day: null });
  const [tempTime, setTempTime] = useState(new Date());

  const [description, setDescription] = useState('');
  const [socialUrl, setSocialUrl] = useState('');
  const [mapUrl, setMapUrl] = useState('');
  const [latitudeInput, setLatitudeInput] = useState('');
  const [longitudeInput, setLongitudeInput] = useState('');
  const [locationAutofillLoading, setLocationAutofillLoading] = useState(false);
  const [extraLocations, setExtraLocations] = useState<ClinicBranchLocation[]>([]);
  const cities = Object.entries(i18n.t('cities', { returnObjects: true }) as Record<string, string>);
  const availableDistricts = city ? districtsByCity[city] || [] : [];
  const isDistrictEnabled = Boolean(city && availableDistricts.length > 0);

  const normalizeLookupValue = (value: string) =>
    (value || '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06FF]+/gi, '');

  const normalizeCityKey = (value: string) => normalizeLookupValue(value);
  const findCityKeyFromValue = (value?: string) => {
    const normalized = normalizeCityKey(value || '');
    if (!normalized) return '';

    if (
      normalized.includes('giza') ||
      normalized.includes('newcairo') ||
      normalized.includes('الجيزة') ||
      normalized.includes('القاهرةالجديدة')
    ) {
      return 'cairo';
    }

    const matched = cityOptions.find((option) => {
      const keyNormalized = normalizeCityKey(option.key);
      const labelNormalized = normalizeCityKey(String(option.label));
      return (
        normalized === keyNormalized ||
        normalized === labelNormalized ||
        normalized.includes(labelNormalized) ||
        labelNormalized.includes(normalized)
      );
    });

    return matched?.key || '';
  };

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

  const getDistrictOptionsForCity = (cityKey?: string) => (cityKey ? districtsByCity[cityKey] || [] : []);

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

  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();
  }, []);

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

  const hasMeaningfulText = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;

  React.useEffect(() => {
    const loadDraft = async () => {
      try {
        const signupDraft = await AsyncStorage.getItem(CLINIC_SIGNUP_DRAFT_KEY);
        if (signupDraft) {
          const parsed = JSON.parse(signupDraft);
          if (typeof parsed.clinicName === 'string') setClinicName(parsed.clinicName);
          if (typeof parsed.email === 'string') setEmail(parsed.email);
          if (typeof parsed.password === 'string') setPassword(parsed.password);
          if (typeof parsed.city === 'string') setCity(parsed.city);
          if (typeof parsed.district === 'string') setDistrict(parsed.district);
          if (parsed.errors && typeof parsed.errors === 'object') setErrors(parsed.errors);
          if (parsed.missing && typeof parsed.missing === 'object') setMissing(parsed.missing);
          if (typeof parsed.mainLocationSaved === 'boolean') setMainLocationSaved(parsed.mainLocationSaved);
          if (Array.isArray(parsed.savedLocationIds)) setSavedLocationIds(parsed.savedLocationIds);
          if (parsed.services && typeof parsed.services === 'object') setServices(parsed.services);
          if (Array.isArray(parsed.customServices)) setCustomServices(parsed.customServices);
          if (parsed.profileImage !== undefined) setProfileImage(parsed.profileImage || null);
          if (typeof parsed.address === 'string') setAddress(parsed.address);
          if (typeof parsed.phone === 'string') setPhone(parsed.phone);
          if (parsed.workingHours && typeof parsed.workingHours === 'object') setWorkingHours(parsed.workingHours);
          if (Array.isArray(parsed.doctors)) setDoctors(parsed.doctors);
          if (typeof parsed.description === 'string') setDescription(parsed.description);
          if (typeof parsed.socialUrl === 'string') setSocialUrl(parsed.socialUrl);
          if (typeof parsed.mapUrl === 'string') setMapUrl(parsed.mapUrl);
          if (typeof parsed.latitudeInput === 'string') setLatitudeInput(parsed.latitudeInput);
          if (typeof parsed.longitudeInput === 'string') setLongitudeInput(parsed.longitudeInput);
          if (Array.isArray(parsed.extraLocations)) setExtraLocations(parsed.extraLocations);
        }
      } catch (error) {
        console.warn('Failed to load clinic signup draft', error);
      } finally {
        setDraftReady(true);
      }
    };

    loadDraft();
  }, []);

  React.useEffect(() => {
    if (!draftReady) return;

    const persistDraft = async () => {
      try {
        await AsyncStorage.setItem(
          CLINIC_SIGNUP_DRAFT_KEY,
          JSON.stringify({
            clinicName,
            email,
            password,
            city,
            district,
            errors,
            missing,
            mainLocationSaved,
            savedLocationIds,
            services,
            customServices,
            profileImage,
            address,
            phone,
            workingHours,
            doctors,
            description,
            socialUrl,
            mapUrl,
            latitudeInput,
            longitudeInput,
            extraLocations,
          })
        );
      } catch (error) {
        console.warn('Failed to persist clinic signup draft', error);
      }
    };

    persistDraft();
  }, [
    draftReady,
    clinicName,
    email,
    password,
    city,
    district,
    errors,
    missing,
    mainLocationSaved,
    savedLocationIds,
    services,
    customServices,
    profileImage,
    address,
    phone,
    workingHours,
    doctors,
    description,
    socialUrl,
    mapUrl,
    latitudeInput,
    longitudeInput,
    extraLocations,
  ]);

  useFocusEffect(
    React.useCallback(() => {
      if (!draftReady) {
        return;
      }

      let active = true;

      const consumePickedLocation = async () => {
        try {
          const [primaryStored, extraStored] = await Promise.all([
            AsyncStorage.getItem(LOCATION_PICKER_RESULT_KEY),
            AsyncStorage.getItem(EXTRA_LOCATION_PICKER_RESULT_KEY),
          ]);

          const activePendingExtraLocationId = pendingExtraLocationIdRef.current;

          if (primaryStored && active && !activePendingExtraLocationId) {
            const picked = JSON.parse(primaryStored);
            if (picked?.latitude !== undefined && picked?.longitude !== undefined) {
              setLatitudeInput(String(picked.latitude));
              setLongitudeInput(String(picked.longitude));
            }
            if (hasMeaningfulText(picked?.mapUrl)) {
              setMapUrl(picked.mapUrl.trim());
            }
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
            const pickedMapUrl = hasMeaningfulText(picked?.mapUrl) ? picked.mapUrl.trim() : null;
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
                  mapUrl: pickedMapUrl || location.mapUrl || null,
                  latitude: Number.isFinite(pickedLatitude) ? pickedLatitude : (location.latitude ?? null),
                  longitude: Number.isFinite(pickedLongitude) ? pickedLongitude : (location.longitude ?? null),
                };
              });
            });
            pendingExtraLocationIdRef.current = null;
            await AsyncStorage.removeItem(EXTRA_LOCATION_PICKER_RESULT_KEY);
          }
        } catch (error) {
          console.warn('Failed to restore picked clinic location on signup', error);
        }
      };

      consumePickedLocation();

      return () => {
        active = false;
      };
    }, [city, draftReady])
  );

  React.useEffect(() => {
    if (!district) return;
    const normalizedDistrict = normalizeDistrictValue(city, district);
    if (normalizedDistrict !== district) {
      setDistrict(normalizedDistrict);
    }
  }, [city, district]);

  const validate = () => {
    const newErrors: Errors = {};
    const newMissing: { [key: string]: boolean } = {};

    const clinicNameError = validateRequired(clinicName, i18n.t('clinic_name') || 'Clinic name');
    if (clinicNameError) {
      newErrors.clinicName = clinicNameError;
      newMissing.clinicName = true;
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

    const completedCustomServices = customServices.filter(
      (service) => service.name?.trim() && service.price?.trim()
    );
    const hasSelectedService =
      Object.entries(services).some(([key, service]) => key !== 'other' && service.selected) ||
      (services.other?.selected && completedCustomServices.length > 0);

    if (!hasSelectedService) {
      newErrors.services = i18n.t('atLeastOneServiceRequired') || 'At least one service must be selected';
      newMissing.services = true;
    }

    // Validate that all selected standard services have fees
    const selectedServicesWithoutFees = Object.entries(services)
      .filter(([key, service]) => key !== 'other' && service.selected && (!service.fee || service.fee.trim() === ''))
      .map(([key]) => key);

    const hasIncompleteCustomService = services.other?.selected
      ? customServices.some((service) => {
          const hasAnyValue = Boolean(service.name?.trim() || service.price?.trim());
          return hasAnyValue && (!service.name?.trim() || !service.price?.trim());
        })
      : false;

    if (services.other?.selected && completedCustomServices.length === 0) {
      newErrors.services = i18n.t('customServiceRequired') || 'Add at least one custom service and its price';
      newMissing.services = true;
    } else if (hasIncompleteCustomService) {
      newErrors.services = i18n.t('customServiceIncomplete') || 'Complete the custom service name and price';
      newMissing.services = true;
    } else if (selectedServicesWithoutFees.length > 0) {
      newErrors.services = i18n.t('feeRequiredForSelectedServices') || 'Fee is required for all selected services';
      newMissing.services = true;
    }

    // At least one doctor required, each with name filled
    if (!doctors.length) {
      newErrors.doctors = i18n.t('atLeastOneDoctorRequired') || 'At least one doctor is required';
      newMissing.doctors = true;
    } else {
      const invalidDoctor = doctors.findIndex(d => !d.name || !d.name.trim());
      if (invalidDoctor >= 0) {
        newErrors.doctors = i18n.t('doctorNameRequired') || 'Doctor name is required for all doctors';
        newMissing.doctors = true;
      }
    }

    setErrors(newErrors);
    setMissing(newMissing);
    return Object.keys(newErrors).length === 0;
  };

  const normalizedHours: Record<string, { from: string; to: string; doctors: string; off?: boolean }> = { ...workingHours };
  for (const day of Object.keys(normalizedHours)) {
    const config = normalizedHours[day];
    if (!config.off) {
      if (!config.from) config.from = '09:00';
      if (!config.to) config.to = '17:00';
    }
  }

  const handleBack = () => {
    if (router.canGoBack?.()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  const openMapPicker = async () => {
    pendingExtraLocationIdRef.current = null;
    await AsyncStorage.multiRemove([LOCATION_PICKER_RESULT_KEY, EXTRA_LOCATION_PICKER_RESULT_KEY]);
    const cityLabel = cityOptions.find((option) => option.key === city)?.label || city;
    router.push({
      pathname: '/academy-location-picker',
      params: {
        storageKey: LOCATION_PICKER_RESULT_KEY,
        title: clinicName || (i18n.t('clinic_name') || 'Clinic'),
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
          id: `clinic-location-${Date.now()}-${nextIndex}`,
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

  const updateExtraLocation = (id: string, updates: Partial<ClinicBranchLocation>) => {
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
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== 'granted') {
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
      setMainLocationSaved(false);
      setMissing((prev) => ({ ...prev, latitudeInput: false, longitudeInput: false }));
      setErrors((prev) => {
        const next = { ...prev };
        delete next.coordinates;
        return next;
      });

      const generatedMapUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
      if (!mapUrl.trim()) {
        setMapUrl(generatedMapUrl);
      }

    } catch (locationError) {
      console.warn('Could not fetch current location for clinic signup', locationError);
      Alert.alert(
        i18n.t('error') || 'Error',
        i18n.t('locationUnavailable') || 'Could not get your location right now.'
      );
    } finally {
      setLocationAutofillLoading(false);
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

      // Step 1: Create Firebase Auth user
      const normalizedPhone = normalizePhoneForTwilio(phone);
      const phoneForAuth = normalizePhoneForAuth(normalizedPhone);
      const authEmail = `user_${phoneForAuth}@forsa.app`;

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

      // Step 3: Prepare and save data
      const servicesData: { [key: string]: { selected: boolean; fee: string } } = {};
      Object.entries(services).forEach(([key, val]) => {
        servicesData[key] = { selected: val.selected, fee: val.fee || '' };
      });
      const normalizedCustomServices = customServices
        .map((service) => ({
          name: service.name?.trim() || '',
          price: service.price?.trim() || '',
        }))
        .filter((service) => service.name && service.price);

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

      const clinicLocations = [
        {
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
        role: 'clinic',
        status: 'active',
        isSuspended: false,
        email: email && email.trim().length > 0 ? email.trim() : null,
        phone,
        clinicName,
        city,
        district,
        address,
        description,
        socialUrl: socialUrl.trim() || null,
        mapUrl: mapUrl.trim() || null,
        locations: clinicLocations,
        workingHours: normalizedHours,
        doctors,
        services: servicesData,
        customServices: normalizedCustomServices,
        profilePhoto: profilePhotoUrl,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...geoFields,
      };
      await setDoc(doc(db, 'users', uid), userData, { merge: true });
      await setDoc(doc(db, 'clinics', uid), userData);

      // Save email → authEmail mapping
      if (email && email.trim().length > 0) {
        await writeEmailIndex(email.trim(), authEmail);
      }
      await writePhoneIndex(phoneForAuth, authEmail);

      await AsyncStorage.multiRemove([
        CLINIC_SIGNUP_DRAFT_KEY,
        LOCATION_PICKER_RESULT_KEY,
        EXTRA_LOCATION_PICKER_RESULT_KEY,
      ]);
      router.replace('/clinic-feed');
    } catch (err: any) {
      console.log('[Signup] Error:', err.message);
      let errorMsg = i18n.t('signupFailedMessage');
      if (err.code === 'auth/email-already-in-use') {
        errorMsg = i18n.t('emailAlreadyRegistered') || 'This phone number is already registered';
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

  const handleServiceToggle = (key: string) => {
    const isSelectingOther = key === 'other' && !services[key]?.selected;

    setServices((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        selected: !prev[key].selected,
        fee: !prev[key].selected ? prev[key].fee : '',
      },
    }));

    if (isSelectingOther && customServices.length === 0) {
      setCustomServices([{ name: '', price: '' }]);
    }
  };
  const handleAddCustomService = () => {
    setCustomServices((prev) => [...prev, { name: '', price: '' }]);
  };
  const handleRemoveCustomService = (idx: number) => {
    setCustomServices((prev) => prev.filter((_, i) => i !== idx));
  };
  const handleCustomServiceChange = (idx: number, field: 'name' | 'price', value: string) => {
    setCustomServices((prev) => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  const pickImage = async () => {
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
      setProfileImage(result.assets[0].uri);
    }
  };

  const completedCustomServicesCount = services.other?.selected
    ? customServices.filter((service) => service.name?.trim() && service.price?.trim()).length
    : 0;
  const hasSelectedService =
    Object.entries(services).some(([key, service]) => key !== 'other' && service.selected && service.fee?.trim()) ||
    completedCustomServicesCount > 0;
  const requiredSteps = [
    Boolean(clinicName.trim()),
    Boolean(phone.trim()) && !errors.phone,
    Boolean(city),
    Boolean(address.trim()),
    Boolean(password.trim()) && !errors.password,
    hasSelectedService,
  ];
  const completedRequiredCount = requiredSteps.filter(Boolean).length;
  const completionPercent = Math.round((completedRequiredCount / requiredSteps.length) * 100);
  const selectedServiceCount =
    Object.entries(services).filter(([key, service]) => key !== 'other' && service.selected).length +
    completedCustomServicesCount;
  const totalBranchCount = 1 + extraLocations.length;
  const savedBranchCount = (mainLocationSaved ? 1 : 0) + savedLocationIds.length;
  const completedDoctorCount = doctors.filter((doctor) => doctor.name?.trim()).length;

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
              <Text style={styles.headerTitle}>{i18n.t('signup_clinic')}</Text>
              <Text style={styles.headerSubtitle}>{i18n.t('createYourClinicAccount') || 'Create your clinic account'}</Text>
            </View>
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
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
                  <Text style={styles.progressTitle}>{i18n.t('completeYourClinicProfile') || 'Complete your clinic profile'}</Text>
                  <Text style={styles.progressSubtitle}>
                    {i18n.t('clinicSignupProgressHint') || 'A complete clinic profile helps users understand your services and find the right branch faster.'}
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
                <Text style={styles.overviewStatValue}>{selectedServiceCount}</Text>
                <Text style={styles.overviewStatLabel}>{i18n.t('servicesConfiguredLabel') || 'Services selected'}</Text>
              </View>
              <View style={styles.overviewStatCard}>
                <Text style={styles.overviewStatValue}>{completedDoctorCount}</Text>
                <Text style={styles.overviewStatLabel}>{i18n.t('teamMembersLabel') || 'Doctors added'}</Text>
              </View>
            </View>

            {/* Form Fields */}
            <View style={styles.formCard}>
              <View style={styles.sectionHeaderCard}>
                <View style={styles.sectionStepBadge}>
                  <Text style={styles.sectionStepText}>1</Text>
                </View>
                <View style={styles.sectionHeaderContent}>
                  <Text style={styles.sectionHeading}>{i18n.t('clinicBasicsStep') || 'Clinic basics'}</Text>
                  <Text style={styles.sectionSubheading}>{i18n.t('clinicBasicsHint') || 'Start with the clinic identity and contact details patients will rely on first.'}</Text>
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>
                  {i18n.t('clinic_name')}
                  <Text style={styles.required}> *</Text>
                </Text>
                <View style={[styles.inputWrapper, missing.clinicName && styles.inputWrapperError]}>
                  <Ionicons name="business-outline" size={20} color="#999" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={clinicName}
                    onChangeText={t => { setClinicName(t); if (missing.clinicName) setMissing(m => ({ ...m, clinicName: false })); }}
                    autoCapitalize="words"
                    placeholder={i18n.t('clinic_name_ph') || i18n.t('clinic_name')}
                    placeholderTextColor="#999"
                  />
                </View>
                {errors.clinicName && <Text style={styles.errorText}>{errors.clinicName}</Text>}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>
                  {i18n.t('phone')}
                  <Text style={styles.required}> *</Text>
                </Text>
                <View style={[styles.inputWrapper, missing.phone && styles.inputWrapperError]}>
                  <Ionicons name="call-outline" size={20} color="#999" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={phone}
                    onChangeText={t => { setPhone(t); if (missing.phone) setMissing(m => ({ ...m, phone: false })); }}
                    keyboardType="phone-pad"
                    placeholder={i18n.t('phone_ph')}
                    placeholderTextColor="#999"
                  />
                </View>
                {errors.phone && <Text style={styles.errorText}>{errors.phone}</Text>}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>
                  {i18n.t('email_address') || 'Email Address'} <Text style={{ color: '#999', fontSize: 14 }}>(Optional)</Text>
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
                    }}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    placeholder={i18n.t('email_address_ph') || 'Enter your email address (optional)'}
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
                    onChangeText={t => { setPassword(t); if (missing.password) setMissing(m => ({ ...m, password: false })); }}
                    secureTextEntry
                    placeholder={i18n.t('password_ph')}
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
                  <Text style={styles.sectionHeading}>{i18n.t('clinicBranchesStep') || 'Branch setup'}</Text>
                  <Text style={styles.sectionSubheading}>{i18n.t('clinicBranchesHint') || 'Make every clinic branch easy to discover, compare, and navigate.'}</Text>
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
                    onChangeText={t => { setAddress(t); setMainLocationSaved(false); if (missing.address) setMissing(m => ({ ...m, address: false })); }}
                    autoCapitalize="words"
                    placeholder={i18n.t('address_ph')}
                    placeholderTextColor="#999"
                  />
                </View>
                {errors.address && <Text style={styles.errorText}>{errors.address}</Text>}
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>
                  {i18n.t('description')}
                </Text>
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
                    onChangeText={setSocialUrl}
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
                  {i18n.t('mapCoordinatesHelper') || 'Choose the clinic directly on the map for the best nearest-to-me accuracy, or use your current location.'}
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
                      <ActivityIndicator size="small" color="#000" />
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
                        placeholder={i18n.t('address_ph') || 'Full address'}
                        placeholderTextColor="#999"
                      />
                    </View>
                  </View>

                  <Text style={styles.helperText}>
                    {i18n.t('mapCoordinatesHelper') || 'Choose the clinic directly on the map for the best nearest-to-me accuracy, or use your current location.'}
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
                  <Text style={styles.sectionHeading}>{i18n.t('clinicServicesStep') || 'Services & pricing'}</Text>
                  <Text style={styles.sectionSubheading}>{i18n.t('clinicServicesHint') || 'Present your services and pricing clearly so users can decide faster.'}</Text>
                </View>
              </View>

              <View style={styles.helperCard}>
                <Text style={styles.helperCardTitle}>{i18n.t('clinicServicesHelperTitle') || 'Help users compare quickly'}</Text>
                <Text style={styles.helperCardText}>{i18n.t('clinicServicesHelper') || 'Select the treatments you actively offer and add the starting fee patients should expect at this branch.'}</Text>
                <View style={styles.helperPillRow}>
                  <View style={styles.helperPill}>
                    <Text style={styles.helperPillText}>{selectedServiceCount} {i18n.t('servicesConfiguredLabel') || 'services selected'}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>
                  {i18n.t('services_offered')}
                  <Text style={styles.required}> *</Text>
                </Text>
                <View style={styles.servicesListWrap}>
                  {allServices.map(({ key, label }) => {
                    const selected = services[key]?.selected;
                    const feeMissing = selected && (!services[key]?.fee || services[key]?.fee.trim() === '') && missing.services;
                    return (
                      <View key={key} style={[styles.serviceRow, selected && styles.serviceRowSelected]}>
                        <TouchableOpacity
                          onPress={() => {
                            handleServiceToggle(key);
                            if (missing.services) setMissing(m => ({ ...m, services: false }));
                          }}
                          style={styles.serviceMainRow}
                          activeOpacity={0.8}
                        >
                          <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                            {selected && <Ionicons name="checkmark" size={16} color="#fff" />}
                          </View>
                          <View style={styles.serviceMetaWrap}>
                            <Text style={[styles.serviceLabel, selected && styles.serviceLabelSelected]}>{label}</Text>
                            <Text style={styles.serviceSubtext}>
                              {key === 'other'
                                ? (selected
                                  ? (i18n.t('customServiceSelectedHint') || 'Add any service not listed below with its price')
                                  : (i18n.t('customServiceNotSelectedHint') || 'Tap to add a custom service and price'))
                                : (selected
                                  ? (i18n.t('serviceSelectedHint') || 'Included in your clinic offer')
                                  : (i18n.t('serviceNotSelectedHint') || 'Tap to include this service'))}
                            </Text>
                          </View>
                          <View style={[styles.serviceStatusPill, selected && styles.serviceStatusPillActive]}>
                            <Text style={[styles.serviceStatusText, selected && styles.serviceStatusTextActive]}>
                              {selected ? (i18n.t('selectedStatus') || 'Selected') : (i18n.t('optionalStatus') || 'Optional')}
                            </Text>
                          </View>
                        </TouchableOpacity>

                        {key === 'other' ? (
                          selected ? (
                            <View style={styles.customServicesCard}>
                              <View style={styles.customServicesHeader}>
                                <View style={styles.customServicesTitleWrap}>
                                  <Text style={styles.customServicesTitle}>{i18n.t('customServicesTitle') || 'Custom services'}</Text>
                                  <Text style={styles.customServicesHint}>{i18n.t('customServicesHint') || 'Add the service name and the price patients should expect.'}</Text>
                                </View>
                                <TouchableOpacity
                                  style={styles.customServiceAddButton}
                                  onPress={() => {
                                    handleAddCustomService();
                                    if (missing.services) setMissing(m => ({ ...m, services: false }));
                                  }}
                                  activeOpacity={0.85}
                                >
                                  <Ionicons name="add" size={16} color="#1d4ed8" />
                                  <Text style={styles.customServiceAddText}>{i18n.t('addCustomService') || 'Add service'}</Text>
                                </TouchableOpacity>
                              </View>

                              {customServices.map((service, idx) => (
                                <View key={`custom-${idx}`} style={styles.customServiceRow}>
                                  <TextInput
                                    placeholder={i18n.t('customServiceNamePlaceholder') || 'Service name'}
                                    placeholderTextColor="#999"
                                    value={service.name}
                                    onChangeText={(val) => {
                                      handleCustomServiceChange(idx, 'name', val);
                                      if (missing.services) setMissing(m => ({ ...m, services: false }));
                                    }}
                                    style={styles.customServiceNameInput}
                                  />
                                  <TextInput
                                    placeholder={i18n.t('feePlaceholder') || 'Fee'}
                                    placeholderTextColor="#999"
                                    keyboardType="numeric"
                                    value={service.price}
                                    onChangeText={(val) => {
                                      handleCustomServiceChange(idx, 'price', val);
                                      if (missing.services) setMissing(m => ({ ...m, services: false }));
                                    }}
                                    style={styles.customServicePriceInput}
                                  />
                                  <TouchableOpacity
                                    style={styles.customServiceRemoveButton}
                                    onPress={() => handleRemoveCustomService(idx)}
                                    activeOpacity={0.8}
                                  >
                                    <Ionicons name="trash-outline" size={18} color="#b91c1c" />
                                  </TouchableOpacity>
                                </View>
                              ))}
                            </View>
                          ) : null
                        ) : (
                          <View style={styles.serviceFeeRow}>
                            <Text style={styles.serviceFeeLabel}>{i18n.t('startingFeeLabel') || 'Starting fee'}</Text>
                            <TextInput
                              placeholder={i18n.t('feePlaceholder') || 'Fee'}
                              placeholderTextColor="#999"
                              keyboardType="numeric"
                              value={services[key]?.fee || ''}
                              onChangeText={(val) => {
                                setServices((prev) => ({
                                  ...prev,
                                  [key]: { ...prev[key], fee: val },
                                }));
                                if (missing.services) setMissing(m => ({ ...m, services: false }));
                              }}
                              style={[
                                styles.feeInput,
                                selected && styles.feeInputEnabled,
                                feeMissing && styles.feeInputError
                              ]}
                              editable={!!selected}
                            />
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
                {errors.services && <Text style={styles.errorText}>{errors.services}</Text>}
              </View>

              <View style={styles.sectionHeaderCard}>
                <View style={styles.sectionStepBadge}>
                  <Text style={styles.sectionStepText}>4</Text>
                </View>
                <View style={styles.sectionHeaderContent}>
                  <Text style={styles.sectionHeading}>{i18n.t('clinicTeamStep') || 'Doctors & care team'}</Text>
                  <Text style={styles.sectionSubheading}>{i18n.t('clinicTeamHint') || 'Introduce the specialists patients may meet so your clinic feels more trustworthy and complete.'}</Text>
                </View>
              </View>

              <View style={styles.helperCard}>
                <Text style={styles.helperCardTitle}>{i18n.t('clinicTeamHelperTitle') || 'Build trust with real specialists'}</Text>
                <Text style={styles.helperCardText}>{i18n.t('clinicTeamHelper') || 'Add at least one doctor with a clear specialty so parents and players understand who they will book with.'}</Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>
                  {i18n.t('doctors')} <Text style={{ color: '#e00', fontSize: 13 }}>*</Text>
                </Text>
                <View style={{ width: '100%', marginBottom: 16 }}>
                  {doctors.length > 0 && (
                    <View style={{ flexDirection: 'row', marginBottom: 4 }}>
                      <Text style={{ flex: 2, fontWeight: '600', color: '#111', fontSize: 14, marginRight: 8 }}>{i18n.t('doctor_name') || 'Name'}</Text>
                      <Text style={{ flex: 2, fontWeight: '600', color: '#111', fontSize: 14, marginRight: 8 }}>{i18n.t('doctor_major') || 'Speciality'}</Text>
                      <View style={{ width: 24 }} />
                    </View>
                  )}
                  {doctors.map((doc, idx) => (
                    <View key={idx} style={{ marginBottom: 14, backgroundColor: '#fafbfc', borderRadius: 10, borderWidth: 1, borderColor: '#eee', padding: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                        <TextInput
                          style={{ flex: 2, borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8, fontSize: 15, marginRight: 8, backgroundColor: '#fff' }}
                          placeholder={i18n.t('doctor_name') || 'Doctor Name'}
                          value={doc.name}
                          onChangeText={v => setDoctors(prev => prev.map((d, i) => i === idx ? { ...d, name: v } : d))}
                        />
                        <TextInput
                          style={{ flex: 2, borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8, fontSize: 15, marginRight: 8, backgroundColor: '#fff' }}
                          placeholder={i18n.t('doctor_major') || 'Speciality'}
                          value={doc.major || ''}
                          onChangeText={v => setDoctors(prev => prev.map((d, i) => i === idx ? { ...d, major: v } : d))}
                        />
                        <TouchableOpacity onPress={() => setDoctors(prev => prev.filter((_, i) => i !== idx))} style={{ padding: 6, backgroundColor: '#eee', borderRadius: 6 }}>
                          <Text style={{ color: '#e00', fontWeight: 'bold', fontSize: 18 }}>×</Text>
                        </TouchableOpacity>
                      </View>
                      {/* Doctor Photo Picker */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                        {doc.photoUri ? (
                          <Image source={{ uri: doc.photoUri }} style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 1, borderColor: '#bbb', marginRight: 10 }} />
                        ) : (
                          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#eee', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#bbb', marginRight: 10 }}>
                            <Text style={{ color: '#888', fontSize: 24 }}>+</Text>
                          </View>
                        )}
                        <TouchableOpacity
                          onPress={async () => {
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
                              setDoctors(prev => prev.map((d, i) => i === idx ? { ...d, photoUri: result.assets[0].uri } : d));
                            }
                          }}
                          style={{ paddingVertical: 8, paddingHorizontal: 14, backgroundColor: '#f4f4f4', borderRadius: 8 }}
                        >
                          <Text style={{ color: '#111', fontWeight: 'bold', fontSize: 14 }}>{i18n.t('add_profile_picture') || 'Add Photo'}</Text>
                        </TouchableOpacity>
                      </View>
                      <Text style={{ fontWeight: '600', color: '#111', fontSize: 14, marginBottom: 4 }}>
                        {i18n.t('doctor_description_title') || 'Doctor Description (optional)'}
                      </Text>
                      <TextInput
                        style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8, fontSize: 15, backgroundColor: '#fff', minHeight: 40, textAlignVertical: 'top' }}
                        placeholder={i18n.t('doctor_description') || 'Doctor Description (optional)'}
                        value={doc.description || ''}
                        multiline
                        onChangeText={v => setDoctors(prev => prev.map((d, i) => i === idx ? { ...d, description: v } : d))}
                      />
                    </View>
                  ))}
                  <TouchableOpacity onPress={() => setDoctors(prev => [...prev, { name: '', major: '' }])} style={{ padding: 10, backgroundColor: '#f4f4f4', borderRadius: 8, alignItems: 'center', marginTop: 4 }}>
                    <Text style={{ color: '#111', fontWeight: 'bold', fontSize: 15 }}>+ {i18n.t('add_doctor') || 'Add Doctor'}</Text>
                  </TouchableOpacity>
                </View>
                {errors.doctors && <Text style={styles.errorText}>{errors.doctors}</Text>}
              </View>

              <View style={styles.sectionHeaderCard}>
                <View style={styles.sectionStepBadge}>
                  <Text style={styles.sectionStepText}>5</Text>
                </View>
                <View style={styles.sectionHeaderContent}>
                  <Text style={styles.sectionHeading}>{i18n.t('clinicReviewStep') || 'Review before launch'}</Text>
                  <Text style={styles.sectionSubheading}>{i18n.t('clinicReviewHint') || 'Double-check the details patients will rely on first when choosing your clinic.'}</Text>
                </View>
              </View>

              <View style={styles.reviewCard}>
                <View style={styles.reviewRow}>
                  <Text style={styles.reviewLabel}>{i18n.t('clinic_name')}</Text>
                  <Text style={styles.reviewValue}>{clinicName || '—'}</Text>
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
                  <Text style={styles.reviewLabel}>{i18n.t('servicesConfiguredLabel') || 'Services selected'}</Text>
                  <Text style={styles.reviewValue}>{selectedServiceCount}</Text>
                </View>
                <View style={styles.reviewRow}>
                  <Text style={styles.reviewLabel}>{i18n.t('teamMembersLabel') || 'Doctors added'}</Text>
                  <Text style={styles.reviewValue}>{completedDoctorCount}</Text>
                </View>
              </View>

              <View style={styles.submitPanel}>
                <Text style={styles.submitHint}>{i18n.t('clinicSubmitHint') || 'Review your clinic details before creating the account. You can update them later.'}</Text>
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
                      <ActivityIndicator color="#fff" />
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
  sectionHeading: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  sectionSubheading: {
    fontSize: 14,
    color: '#64748b',
    lineHeight: 20,
  },
  helperCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    marginBottom: 16,
  },
  helperCardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
  },
  helperCardText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#64748b',
  },
  helperPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  helperPill: {
    backgroundColor: '#fff',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#dbe4ee',
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  helperPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
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
  mapActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 2,
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
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 8,
  },
  branchRemoveButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  additionalLocationTitle: {
    fontSize: 14,
    fontWeight: '800',
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
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbe4ee',
    borderStyle: 'dashed',
    paddingVertical: 13,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  addLocationButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
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
  servicesListWrap: {
    gap: 10,
  },
  serviceRow: {
    width: '100%',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 10,
  },
  serviceRowSelected: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  serviceMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#000',
    marginRight: 12,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#000',
    borderColor: '#000',
  },
  serviceMetaWrap: {
    flex: 1,
  },
  serviceLabel: {
    fontSize: 16,
    color: '#000',
    fontWeight: '700',
    marginBottom: 2,
  },
  serviceLabelSelected: {
    color: '#0f172a',
    fontWeight: '800',
  },
  serviceSubtext: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  serviceStatusPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  serviceStatusPillActive: {
    backgroundColor: '#dbeafe',
    borderColor: '#93c5fd',
  },
  serviceStatusText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
  },
  serviceStatusTextActive: {
    color: '#1d4ed8',
  },
  serviceFeeRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  serviceFeeLabel: {
    flex: 1,
    fontSize: 13,
    color: '#475569',
    fontWeight: '700',
  },
  feeInput: {
    width: 110,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 10,
    fontSize: 15,
    color: '#000',
    backgroundColor: '#fff',
    textAlign: 'center',
    fontWeight: '700',
  },
  feeInputEnabled: {
    borderColor: '#94a3b8',
    backgroundColor: '#fff',
  },
  feeInputError: {
    borderColor: '#ff3b30',
    backgroundColor: '#fff5f5',
  },
  customServicesCard: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbeafe',
    gap: 10,
  },
  customServicesHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  customServicesTitleWrap: {
    flex: 1,
  },
  customServicesTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  customServicesHint: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  customServiceAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
  },
  customServiceAddText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1d4ed8',
  },
  customServiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  customServiceNameInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#000',
    backgroundColor: '#fff',
  },
  customServicePriceInput: {
    width: 100,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    fontSize: 14,
    color: '#000',
    backgroundColor: '#fff',
    textAlign: 'center',
    fontWeight: '700',
  },
  customServiceRemoveButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  workingHoursWrapper: {
    gap: 10,
  },
  workingHoursDayCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    position: 'relative',
  },
  workingHoursDayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 12,
  },
  workingHoursDayLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
  },
  workingHoursToggle: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: '#ecfdf5',
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  workingHoursToggleOff: {
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
  },
  workingHoursToggleText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#166534',
  },
  workingHoursToggleTextOff: {
    color: '#b91c1c',
  },
  workingHoursTimeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  workingHoursTimeButton: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  workingHoursTimeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    marginBottom: 3,
  },
  workingHoursTimeValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
  },
  workingHoursClosedText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '700',
  },
  workingHoursDropdown: {
    position: 'absolute',
    top: 62,
    left: 12,
    right: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    zIndex: 100,
    maxHeight: 220,
    elevation: 8,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
  workingHoursDropdownItem: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  workingHoursDropdownItemSelected: {
    backgroundColor: '#f1f5f9',
  },
  workingHoursDropdownItemText: {
    color: '#111827',
    fontSize: 15,
  },
  workingHoursDropdownCancel: {
    padding: 10,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  workingHoursDropdownCancelText: {
    color: '#b91c1c',
    fontWeight: '800',
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

// Simple WorkingHoursInput component implementation
type WorkingHoursInputProps = {
  value: Record<string, { from: string; to: string; doctors: string; off?: boolean }>;
  onChange: (v: Record<string, { from: string; to: string; doctors: string; off?: boolean }>) => void;
};

const daysOfWeek = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'
];

const WorkingHoursInput: React.FC<WorkingHoursInputProps> = ({ value, onChange }) => {
  const [dropdown, setDropdown] = React.useState<{ day: string; mode: 'from' | 'to' } | null>(null);
  const timeOptions: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      timeOptions.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
    }
  }

  const formatTime12Hour = (time24: string): string => {
    if (!time24 || !isValidTimeFormat(time24)) return time24;
    const [hours, minutes] = time24.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const hours12 = hours % 12 || 12;
    return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  const getDisplayTime = (day: string, mode: 'from' | 'to'): string => {
    const time24 = value[day]?.[mode] || '';
    return time24 ? formatTime12Hour(time24) : (i18n.t(mode) || (mode === 'from' ? 'From' : 'To'));
  };

  return (
    <View style={styles.workingHoursWrapper}>
      {daysOfWeek.map((day) => {
        const isOff = !!value[day]?.off;
        const activeDropdown = dropdown && dropdown.day === day;

        return (
          <View key={day} style={[styles.workingHoursDayCard, activeDropdown && { zIndex: 20 }]}> 
            <View style={styles.workingHoursDayHeader}>
              <Text style={styles.workingHoursDayLabel}>{i18n.t(day) || day}</Text>
              <TouchableOpacity
                onPress={() => onChange({ ...value, [day]: { ...value[day], off: !value[day]?.off } })}
                style={[styles.workingHoursToggle, isOff && styles.workingHoursToggleOff]}
                activeOpacity={0.8}
              >
                <Text style={[styles.workingHoursToggleText, isOff && styles.workingHoursToggleTextOff]}>
                  {isOff ? (i18n.t('day_off') || 'Day off') : (i18n.t('open') || 'Open')}
                </Text>
              </TouchableOpacity>
            </View>

            {isOff ? (
              <Text style={styles.workingHoursClosedText}>{i18n.t('workingHoursClosedHint') || 'This day will appear as unavailable.'}</Text>
            ) : (
              <View style={styles.workingHoursTimeRow}>
                <TouchableOpacity
                  style={styles.workingHoursTimeButton}
                  onPress={() => setDropdown({ day, mode: 'from' })}
                  activeOpacity={0.8}
                >
                  <Text style={styles.workingHoursTimeLabel}>{i18n.t('from') || 'From'}</Text>
                  <Text style={styles.workingHoursTimeValue}>{getDisplayTime(day, 'from')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.workingHoursTimeButton}
                  onPress={() => setDropdown({ day, mode: 'to' })}
                  activeOpacity={0.8}
                >
                  <Text style={styles.workingHoursTimeLabel}>{i18n.t('to') || 'To'}</Text>
                  <Text style={styles.workingHoursTimeValue}>{getDisplayTime(day, 'to')}</Text>
                </TouchableOpacity>
              </View>
            )}

            {activeDropdown && (
              <View style={styles.workingHoursDropdown}>
                <ScrollView style={{ maxHeight: 220 }}>
                  {timeOptions.map((t) => (
                    <TouchableOpacity
                      key={t}
                      onPress={() => {
                        onChange({
                          ...value,
                          [day]: {
                            ...value[day],
                            [dropdown.mode]: t,
                          },
                        });
                        setDropdown(null);
                      }}
                      style={[
                        styles.workingHoursDropdownItem,
                        value[day]?.[dropdown.mode] === t && styles.workingHoursDropdownItemSelected,
                      ]}
                    >
                      <Text style={styles.workingHoursDropdownItemText}>{formatTime12Hour(t)}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <TouchableOpacity onPress={() => setDropdown(null)} style={styles.workingHoursDropdownCancel}>
                  <Text style={styles.workingHoursDropdownCancelText}>{i18n.t('cancel') || 'Cancel'}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
};

export default SignupClinic;
