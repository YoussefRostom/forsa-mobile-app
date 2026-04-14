import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import React, { useEffect, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import i18n from '../locales/i18n';
import { db } from '../lib/firebase';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';

const cities = Object.entries(i18n.t('cities', { returnObjects: true }) as Record<string, string>).map(([key, label]) => ({ key, label }));
const cityOptions = cities.filter(({ key }) => !['giza', 'newCairo'].includes(key));
const ageGroups = Array.from({ length: 11 }, (_, i) => (7 + i).toString());
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

const normalizeCityKey = (value: string) => (value || '').toString().replace(/\s+/g, '').toLowerCase();
const cityMatchesFilter = (academyCity: string, selectedCity: string) => {
  if (!selectedCity) return true;

  const normalizedAcademyCity = normalizeCityKey(academyCity);
  const normalizedSelectedCity = normalizeCityKey(selectedCity);

  if (normalizedSelectedCity === 'cairo') {
    return ['cairo', 'giza', 'newcairo'].includes(normalizedAcademyCity);
  }

  return normalizedAcademyCity === normalizedSelectedCity;
};

type Coordinates = { latitude: number; longitude: number };

const extractCoordinatesFromMapUrl = (mapUrl?: string | null): Coordinates | null => {
  if (!mapUrl) return null;

  const decodedUrl = decodeURIComponent(String(mapUrl));
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

const parseLocationCoordinates = (location: any): Coordinates | null => {
  const latitude = Number(
    location?.latitude ??
    location?.lat ??
    location?.coordinates?.latitude ??
    location?.coordinates?.lat ??
    location?.location?.latitude ??
    location?.location?.lat
  );
  const longitude = Number(
    location?.longitude ??
    location?.lng ??
    location?.coordinates?.longitude ??
    location?.coordinates?.lng ??
    location?.location?.longitude ??
    location?.location?.lng
  );

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return { latitude, longitude };
  }

  return extractCoordinatesFromMapUrl(location?.mapUrl ?? location?.mapsUrl ?? null);
};

const getAcademyLocationCandidates = (academy: any): Coordinates[] => {
  const direct = parseLocationCoordinates(academy);
  const nested = Array.isArray(academy?.locations)
    ? academy.locations
        .map((location: any) => parseLocationCoordinates(location))
        .filter(Boolean) as Coordinates[]
    : [];

  return [...(direct ? [direct] : []), ...nested].filter(
    (coords, index, list) =>
      list.findIndex(
        (candidate) =>
          candidate.latitude === coords.latitude && candidate.longitude === coords.longitude
      ) === index
  );
};

const getAcademyCoordinates = (academy: any): Coordinates | null => {
  return getAcademyLocationCandidates(academy)[0] || null;
};

const getCityLabel = (value?: string) => {
  if (!value) return '';
  const normalizedValue = normalizeCityKey(value);
  const match = cities.find(
    ({ key, label }) =>
      normalizeCityKey(key) === normalizedValue ||
      normalizeCityKey(String(label)) === normalizedValue
  );
  return match?.label || value;
};

const getRelevantDisplayLocation = (
  academy: any,
  selectedCity: string,
  selectedDistricts: string[],
  preferredOrigin?: Coordinates | null
) => {
  const candidateLocations = Array.isArray(academy?.locations) && academy.locations.length
    ? academy.locations
    : [academy];

  let matches = candidateLocations.filter((location: any) => {
    const branchCity = location?.city || academy?.city || '';
    const branchDistrict = location?.district || '';
    const cityOk = !selectedCity || cityMatchesFilter(branchCity, selectedCity);
    const districtOk = !selectedDistricts.length || selectedDistricts.includes(branchDistrict);
    return cityOk && districtOk;
  });

  if (!matches.length && selectedCity) {
    matches = candidateLocations.filter((location: any) =>
      cityMatchesFilter(location?.city || academy?.city || '', selectedCity)
    );
  }

  if (!matches.length) {
    matches = candidateLocations;
  }

  if (preferredOrigin) {
    matches = [...matches].sort((a: any, b: any) => {
      const coordsA = parseLocationCoordinates(a);
      const coordsB = parseLocationCoordinates(b);
      const distA = coordsA ? calculateDistanceKm(preferredOrigin, coordsA) : Number.POSITIVE_INFINITY;
      const distB = coordsB ? calculateDistanceKm(preferredOrigin, coordsB) : Number.POSITIVE_INFINITY;
      return distA - distB;
    });
  }

  return matches[0] || academy;
};

const calculateDistanceKm = (from: Coordinates, to: Coordinates) => {
  const earthRadiusKm = 6371;
  const dLat = ((to.latitude - from.latitude) * Math.PI) / 180;
  const dLon = ((to.longitude - from.longitude) * Math.PI) / 180;
  const lat1 = (from.latitude * Math.PI) / 180;
  const lat2 = (to.latitude * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const getLowestNumericFee = (fees: any) => {
  if (typeof fees === 'number' && Number.isFinite(fees) && fees > 0) {
    return fees;
  }

  if (!fees || typeof fees !== 'object') {
    return 0;
  }

  const numericValues = Object.values(fees)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  return numericValues.length ? Math.min(...numericValues) : 0;
};

const formatFeeLabel = (fee: number) => {
  if (!Number.isFinite(fee) || fee <= 0) {
    return i18n.t('contactForFees') || 'Contact for fees';
  }

  return i18n.t('startingFromPrice', { price: fee }) || `From ${fee} EGP`;
};

interface Academy {
  id: string;
  academyName: string;
  city: string;
  district?: string;
  address: string;
  description: string;
  fees: any;
  displayFee: number;
  role: string;
  mapUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  coordinates?: any;
  locations?: any[];
  privateTraining?: any;
  privateTrainings?: any[];
}

export default function PlayerSearchScreen() {
  const { openMenu } = useHamburgerMenu();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [cityModal, setCityModal] = useState(false);
  const [selectedDistricts, setSelectedDistricts] = useState<string[]>([]);
  const [districtModal, setDistrictModal] = useState(false);
  const [age, setAge] = useState('');
  const [ageModal, setAgeModal] = useState(false);
  const [price, setPrice] = useState('');
  const [privateOnly, setPrivateOnly] = useState(false);
  const [sortBy, setSortBy] = useState('recommended');
  const [sortModal, setSortModal] = useState(false);
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [distanceMap, setDistanceMap] = useState<Record<string, number>>({});
  const [locationLoading, setLocationLoading] = useState(false);
  const [academies, setAcademies] = useState<Academy[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const selectedCityLabel = city ? cities.find(c => c.key === city)?.label || city : '';
  const availableDistricts = city ? districtsByCity[city] || [] : [];
  const isDistrictEnabled = Boolean(city && availableDistricts.length > 0);
  const selectedDistrictLabel = selectedDistricts.length === 0
    ? ''
    : selectedDistricts.length <= 2
      ? selectedDistricts.join(', ')
      : (i18n.t('districtsSelectedCount', { count: selectedDistricts.length }) || `${selectedDistricts.length} districts selected`);
  const hasActiveFilters = Boolean(name || city || selectedDistricts.length || age || price || privateOnly);
  const sortOptions = [
    { key: 'recommended', label: i18n.t('recommendedSort') || 'Recommended' },
    { key: 'nearest', label: i18n.t('nearestToMeSort') || 'Nearest to me' },
    { key: 'nameAsc', label: i18n.t('alphabeticalSort') || 'A to Z' },
    { key: 'lowestFee', label: i18n.t('lowestFeeSort') || 'Lowest fee' },
    { key: 'highestFee', label: i18n.t('highestFeeSort') || 'Highest fee' },
  ];
  const selectedSortLabel = sortOptions.find((option) => option.key === sortBy)?.label || sortOptions[0].label;

  // Fetch academies from Firestore
  useEffect(() => {
    fetchAcademies();
  }, []);

  const fetchAcademies = async () => {
    try {
      setLoading(true);

      const academyList: Academy[] = [];

      // Query 'academies' collection directly as per registration logic
      // in signup-academy-profile.tsx
      try {
        const academiesRef = collection(db, 'academies');
        const q = query(academiesRef);
        const querySnapshot = await getDocs(q);

        const programsRef = collection(db, 'academy_programs');
        const pQ = query(programsRef, where('type', '==', 'private_training'));
        const programsSnap = await getDocs(pQ);
        const privateProgramsMap: Record<string, any> = {};
        programsSnap.forEach(doc => {
          const data = doc.data();
          if (data.academyId) {
            privateProgramsMap[data.academyId] = { id: doc.id, ...data };
          }
        });

        querySnapshot.forEach((doc) => {
          const data = doc.data();

          academyList.push({
            id: doc.id,
            academyName: data.academyName || 'Unnamed Academy',
            city: data.city || '',
            district: data.district || '',
            address: data.address || '',
            description: data.description || (i18n.t('noDescriptionAvailable') || 'No description available'),
            fees: data.fees || {},
            displayFee: getLowestNumericFee(data.fees),
            role: data.role || 'academy',
            mapUrl: data.mapUrl || null,
            latitude: data.latitude ?? data.coordinates?.latitude ?? null,
            longitude: data.longitude ?? data.coordinates?.longitude ?? null,
            coordinates: data.coordinates || null,
            locations: Array.isArray(data.locations) ? data.locations : [],
            privateTraining: privateProgramsMap[doc.id] || null,
          });
        });
      } catch (error) {
        console.error('Error fetching from academies collection:', error);
      }

      setAcademies(academyList);
    } catch (error) {
      console.error('Error in fetchAcademies:', error);
    } finally {
      setLoading(false);
    }
  };

  const getAcademyFee = (academy: Academy) => {
    if (age && academy.fees && academy.fees[age] !== undefined) {
      const selectedAgeFee = Number(academy.fees[age]);
      if (Number.isFinite(selectedAgeFee) && selectedAgeFee > 0) {
        return selectedAgeFee;
      }
    }

    const lowestRegularFee = getLowestNumericFee(academy.fees);
    return lowestRegularFee || academy.displayFee || 0;
  };

  // Filter academies based on search criteria
  const hasPrivateTraining = (academy: Academy) => {
    return !!(
      (academy.privateTrainings && academy.privateTrainings.length > 0) ||
      academy.privateTraining
    );
  };

  const clearAllFilters = () => {
    setName('');
    setCity('');
    setSelectedDistricts([]);
    setAge('');
    setPrice('');
    setPrivateOnly(false);
  };

  const toggleDistrictSelection = (districtKey: string) => {
    setSelectedDistricts((prev) => (
      prev.includes(districtKey)
        ? prev.filter((value) => value !== districtKey)
        : [...prev, districtKey]
    ));
  };

  const resolveDistances = async (origin: Coordinates) => {
    const entries = academies.map((academy) => {
      const candidates = getAcademyLocationCandidates(academy);
      if (!candidates.length) return null;

      const nearestDistance = Math.min(
        ...candidates.map((coords) => calculateDistanceKm(origin, coords))
      );

      return [academy.id, nearestDistance] as const;
    });

    setDistanceMap(Object.fromEntries(entries.filter(Boolean) as Array<readonly [string, number]>));
  };

  const handleSortSelection = async (sortKey: string) => {
    if (sortKey === 'nearest') {
      try {
        setLocationLoading(true);
        let origin = userLocation;

        if (!origin) {
          const permission = await Location.requestForegroundPermissionsAsync();
          if (permission.status !== 'granted') {
            Alert.alert(
              i18n.t('locationPermissionNeeded') || 'Location permission needed',
              i18n.t('locationPermissionMessage') || 'Allow location access to sort results by nearest to you.'
            );
            return;
          }

          const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          origin = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          };
          setUserLocation(origin);
        }

        await resolveDistances(origin);
      } catch (error) {
        console.error('Error getting user location:', error);
        Alert.alert(
          i18n.t('error') || 'Error',
          i18n.t('locationUnavailable') || 'Could not get your location right now.'
        );
        return;
      } finally {
        setLocationLoading(false);
      }
    }

    setSortBy(sortKey);
    setSortModal(false);
  };

  const filtered = academies
    .filter(a => {
      const fee = getAcademyFee(a);
      return (
        (!name || a.academyName.toLowerCase().includes(name.toLowerCase())) &&
        (!(city) || (Array.isArray(a.locations) && a.locations.length
          ? a.locations.some((location: any) => cityMatchesFilter(location?.city || a.city, city))
          : cityMatchesFilter(a.city, city))) &&
        (!selectedDistricts.length || (Array.isArray(a.locations) && a.locations.length
          ? a.locations.some((location: any) => selectedDistricts.includes(location?.district || ''))
          : selectedDistricts.includes(a.district || ''))) &&
        (!age || (a.fees && a.fees[age] !== undefined)) &&
        (!price || fee <= parseInt(price)) &&
        (!privateOnly || hasPrivateTraining(a))
      );
    })
    .sort((a, b) => {
      const feeA = getAcademyFee(a);
      const feeB = getAcademyFee(b);

      if (sortBy === 'nearest') {
        const distanceA = distanceMap[a.id] ?? Number.POSITIVE_INFINITY;
        const distanceB = distanceMap[b.id] ?? Number.POSITIVE_INFINITY;

        if (distanceA !== distanceB) {
          return distanceA - distanceB;
        }

        return a.academyName.localeCompare(b.academyName);
      }

      if (sortBy === 'nameAsc') {
        return a.academyName.localeCompare(b.academyName);
      }

      if (sortBy === 'lowestFee') {
        return feeA - feeB;
      }

      if (sortBy === 'highestFee') {
        return feeB - feeA;
      }

      const privateDiff = Number(hasPrivateTraining(b)) - Number(hasPrivateTraining(a));
      if (privateDiff !== 0) return privateDiff;

      const feeDiff = feeA - feeB;
      if (feeDiff !== 0) return feeDiff;

      return a.academyName.localeCompare(b.academyName);
    });

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient
        colors={['#000000', '#1a1a1a', '#2d2d2d']}
        style={styles.gradient}
      >
        <ScrollView
          style={styles.screenScroll}
          contentContainerStyle={styles.screenContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.menuButton} onPress={openMenu}>
              <Ionicons name="menu" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.headerContent}>
              <Text style={styles.headerTitle}>{i18n.t('searchAcademies') || 'Search Academies'}</Text>
              <Text style={styles.headerSubtitle}>{i18n.t('findPerfectAcademy') || 'Find the perfect academy for your child'}</Text>
            </View>
          </View>

          <HamburgerMenu />

          <View style={styles.heroCard}>
            <View style={styles.heroIconWrap}>
              <Ionicons name="school-outline" size={22} color="#111827" />
            </View>
            <View style={styles.heroTextWrap}>
              <Text style={styles.heroTitle}>{i18n.t('searchAcademies') || 'Search Academies'}</Text>
              <Text style={styles.heroText}>{i18n.t('academySearchHint') || 'Search by city, age, price, and private training availability.'}</Text>
            </View>
          </View>

          <ScrollView
            style={styles.filtersCard}
            contentContainerStyle={styles.filtersCardContent}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled={true}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.filtersHeaderRow}>
              <View style={styles.filtersHeadingWrap}>
                <Text style={styles.filtersTitle}>{i18n.t('smartFiltersLabel') || 'Smart filters'}</Text>
                <Text style={styles.filtersSubtitle}>{i18n.t('refineAcademyResults') || 'Refine the list to find the best fit faster.'}</Text>
              </View>
              {hasActiveFilters && (
                <TouchableOpacity style={styles.clearFiltersButton} onPress={clearAllFilters}>
                  <Text style={styles.clearFiltersText}>{i18n.t('clearFilters') || 'Clear filters'}</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.filterRow}>
              <View style={styles.filterInputWrapper}>
                <Ionicons name="search-outline" size={20} color="#999" style={styles.filterIcon} />
                <TextInput
                  style={styles.filterInput}
                  value={name}
                  onChangeText={setName}
                  placeholder={i18n.t('academyNameLabel') || 'Academy Name'}
                  placeholderTextColor="#999"
                />
                {!!name && (
                  <TouchableOpacity onPress={() => setName('')}>
                    <Ionicons name="close-circle" size={18} color="#999" />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <View style={styles.filterRow}>
              <TouchableOpacity style={styles.filterInputWrapper} onPress={() => setSortModal(true)}>
                <Ionicons name="swap-vertical-outline" size={20} color="#999" style={styles.filterIcon} />
                <Text style={styles.filterText}>{selectedSortLabel}</Text>
                <Ionicons name="chevron-down" size={20} color="#999" />
              </TouchableOpacity>
            </View>

            <Modal visible={sortModal} transparent animationType="fade" onRequestClose={() => setSortModal(false)}>
              <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSortModal(false)}>
                <View style={styles.modalContent}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>{i18n.t('sortResults') || 'Sort results'}</Text>
                    <TouchableOpacity onPress={() => setSortModal(false)}>
                      <Ionicons name="close" size={24} color="#000" />
                    </TouchableOpacity>
                  </View>
                  <ScrollView style={styles.modalScrollView}>
                    {sortOptions.map((option) => (
                      <TouchableOpacity
                        key={option.key}
                        style={[styles.modalOption, sortBy === option.key && styles.modalOptionSelected]}
                        onPress={() => void handleSortSelection(option.key)}
                      >
                        <Text style={[styles.modalOptionText, sortBy === option.key && styles.modalOptionTextSelected]}>
                          {option.label}
                        </Text>
                        {sortBy === option.key && <Ionicons name="checkmark" size={20} color="#fff" />}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </TouchableOpacity>
            </Modal>

            <View style={styles.filterRow}>
              <TouchableOpacity style={styles.filterInputWrapper} onPress={() => setCityModal(true)}>
                <Ionicons name="location-outline" size={20} color="#999" style={styles.filterIcon} />
                <Text style={[styles.filterText, !city && styles.filterPlaceholder]}>
                  {city ? cities.find(c => c.key === city)?.label || city : i18n.t('city')}
                </Text>
                <Ionicons name="chevron-down" size={20} color="#999" />
              </TouchableOpacity>
            </View>

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
                    {cityOptions.map((item) => (
                      <TouchableOpacity
                        key={item.key}
                        style={[styles.modalOption, city === item.key && styles.modalOptionSelected]}
                        onPress={() => {
                          setCity(item.key);
                          setSelectedDistricts([]);
                          setCityModal(false);
                        }}
                      >
                        <Text style={[styles.modalOptionText, city === item.key && styles.modalOptionTextSelected]}>
                          {item.label}
                        </Text>
                        {city === item.key && <Ionicons name="checkmark" size={20} color="#fff" />}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </TouchableOpacity>
            </Modal>

            <View style={styles.filterRow}>
              <TouchableOpacity
                style={[styles.filterInputWrapper, !isDistrictEnabled && styles.filterInputDisabled]}
                onPress={() => isDistrictEnabled && setDistrictModal(true)}
                disabled={!isDistrictEnabled}
              >
                <Ionicons name="location-outline" size={20} color={isDistrictEnabled ? '#999' : '#666'} style={styles.filterIcon} />
                <Text
                  style={[styles.filterText, !selectedDistrictLabel && styles.filterPlaceholder, !isDistrictEnabled && styles.filterInputDisabledText]}
                  numberOfLines={1}
                >
                  {selectedDistrictLabel || (!city
                    ? (i18n.t('selectCityFirst') || 'Select city first')
                    : (availableDistricts.length
                      ? (i18n.t('district') || 'District')
                      : (i18n.t('noDistrictsAvailable') || 'No districts available')))}
                </Text>
                <Ionicons name="chevron-down" size={20} color={isDistrictEnabled ? '#999' : '#666'} />
              </TouchableOpacity>
            </View>

            <Modal visible={districtModal} transparent animationType="fade" onRequestClose={() => setDistrictModal(false)}>
              <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setDistrictModal(false)}>
                <View style={styles.modalContent}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>{i18n.t('selectDistrict') || 'Select district'}</Text>
                    <View style={styles.modalHeaderActions}>
                      {selectedDistricts.length > 0 && (
                        <TouchableOpacity style={styles.modalClearButton} onPress={() => setSelectedDistricts([])}>
                          <Text style={styles.modalClearText}>{i18n.t('clear') || 'Clear'}</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity onPress={() => setDistrictModal(false)}>
                        <Ionicons name="close" size={24} color="#000" />
                      </TouchableOpacity>
                    </View>
                  </View>
                  <ScrollView style={styles.modalScrollView}>
                    {availableDistricts.length > 0 ? availableDistricts.map((item) => (
                      <TouchableOpacity
                        key={item.key}
                        style={[styles.modalOption, selectedDistricts.includes(item.key) && styles.modalOptionSelected]}
                        onPress={() => toggleDistrictSelection(item.key)}
                      >
                        <Text style={[styles.modalOptionText, selectedDistricts.includes(item.key) && styles.modalOptionTextSelected]}>
                          {item.label}
                        </Text>
                        {selectedDistricts.includes(item.key) && <Ionicons name="checkmark" size={20} color="#fff" />}
                      </TouchableOpacity>
                    )) : (
                      <View style={styles.modalEmptyState}>
                        <Text style={styles.modalEmptyText}>{i18n.t('noDistrictsAvailable') || 'No districts available'}</Text>
                      </View>
                    )}
                  </ScrollView>
                </View>
              </TouchableOpacity>
            </Modal>

            <View style={styles.filterRow}>
              <TouchableOpacity style={styles.filterInputWrapper} onPress={() => setAgeModal(true)}>
                <Ionicons name="person-outline" size={20} color="#999" style={styles.filterIcon} />
                <Text style={[styles.filterText, !age && styles.filterPlaceholder]}>
                  {age ? `${age} ${i18n.t('years') || 'years'}` : (i18n.t('selectAge') || 'Select age')}
                </Text>
                <Ionicons name="chevron-down" size={20} color="#999" />
              </TouchableOpacity>
            </View>

            <Modal visible={ageModal} transparent animationType="fade" onRequestClose={() => setAgeModal(false)}>
              <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setAgeModal(false)}>
                <View style={styles.modalContent}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>{i18n.t('selectAge') || 'Select age'}</Text>
                    <TouchableOpacity onPress={() => setAgeModal(false)}>
                      <Ionicons name="close" size={24} color="#000" />
                    </TouchableOpacity>
                  </View>
                  <ScrollView style={styles.modalScrollView}>
                    {ageGroups.map((ageOption) => (
                      <TouchableOpacity
                        key={ageOption}
                        style={[styles.modalOption, age === ageOption && styles.modalOptionSelected]}
                        onPress={() => {
                          setAge(ageOption);
                          setAgeModal(false);
                        }}
                      >
                        <Text style={[styles.modalOptionText, age === ageOption && styles.modalOptionTextSelected]}>
                          {ageOption} {i18n.t('years') || 'years'}
                        </Text>
                        {age === ageOption && <Ionicons name="checkmark" size={20} color="#fff" />}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </TouchableOpacity>
            </Modal>

            <View style={styles.filterRow}>
              <View style={[styles.filterInputWrapper, !age && styles.filterInputDisabled]}>
                <Ionicons name="cash-outline" size={20} color={age ? '#999' : '#666'} style={styles.filterIcon} />
                <TextInput
                  style={[styles.filterInput, !age && styles.filterInputDisabledText]}
                  value={price}
                  onChangeText={(text) => setPrice(text.trim())}
                  placeholder={i18n.t('maxPrice') || 'Max Price'}
                  placeholderTextColor={age ? '#999' : '#666'}
                  keyboardType="numeric"
                  editable={!!age}
                />
              </View>
            </View>
            <View style={styles.filterRow}>
              <TouchableOpacity style={[styles.filterInputWrapper, privateOnly && styles.filterInputActive]} onPress={() => setPrivateOnly(prev => !prev)}>
                <Ionicons name={privateOnly ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={privateOnly ? '#000' : '#999'} style={styles.filterIcon} />
                <Text style={[styles.filterText, privateOnly && styles.filterTextActive]}>{i18n.t('privateTrainerOnly') || 'Only private trainers'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>

          {!loading && (
            <View style={styles.resultsSummaryRow}>
              <Text style={styles.resultsSummaryText}>
                {i18n.t('resultsFoundCount', { count: filtered.length }) || `${filtered.length} academies found`}
              </Text>
              <View style={styles.resultsChipsRow}>
                {selectedCityLabel ? (
                  <View style={styles.summaryChip}>
                    <Text style={styles.summaryChipText}>{selectedCityLabel}</Text>
                  </View>
                ) : null}
                {selectedDistricts.length ? (
                  <View style={styles.summaryChip}>
                    <Text style={styles.summaryChipText}>{selectedDistrictLabel}</Text>
                  </View>
                ) : null}
                {sortBy === 'nearest' ? (
                  <View style={styles.summaryChip}>
                    <Text style={styles.summaryChipText}>
                      {locationLoading ? (i18n.t('locatingYou') || 'Locating you...') : (i18n.t('nearestToMeSort') || 'Nearest to me')}
                    </Text>
                  </View>
                ) : null}
                {privateOnly ? (
                  <View style={styles.summaryChip}>
                    <Text style={styles.summaryChipText}>{i18n.t('privateTrainerOnly') || 'Only private trainers'}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          )}

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#fff" />
              <Text style={styles.loadingText}>{i18n.t('loadingAcademies') || 'Loading academies...'}</Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={item => item.id}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              scrollEnabled={false}
              renderItem={({ item }) => {
                const displayLocation = getRelevantDisplayLocation(
                  item,
                  city,
                  selectedDistricts,
                  sortBy === 'nearest' ? userLocation : null
                );
                const displayCityLabel = getCityLabel(displayLocation?.city || item.city);
                const displayDistrict = displayLocation?.district || item.district || '';
                const displayAddress = [displayDistrict, displayCityLabel, displayLocation?.address || item.address]
                  .filter(Boolean)
                  .join(', ');

                return (
                <TouchableOpacity
                  style={styles.card}
                  onPress={() => router.push({ pathname: '/academy-details', params: { academy: JSON.stringify(item) } })}
                  activeOpacity={0.9}
                >
                  {/* Dark header strip */}
                  <View style={styles.cardHeaderStrip}>
                    <View style={styles.cardIconCircle}>
                      <Ionicons name="school" size={20} color="#fff" />
                    </View>
                    <View style={styles.cardHeaderInfo}>
                      <Text style={styles.cardTitle} numberOfLines={1}>{item.academyName}</Text>
                      <View style={styles.cardLocationRow}>
                        <Ionicons name="location" size={12} color="rgba(255,255,255,0.65)" />
                        <Text style={styles.cardLocationText} numberOfLines={1}>
                          {[displayDistrict, displayCityLabel].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                    </View>
                  </View>
                  {/* Card body */}
                  <View style={styles.cardBody}>
                    {/* Info chips */}
                    <View style={styles.cardChipsRow}>
                      <View style={styles.chip}>
                        <Ionicons name="cash-outline" size={12} color="#555" />
                        <Text style={styles.chipText}>{formatFeeLabel(getAcademyFee(item))}</Text>
                      </View>
                      {Number.isFinite(distanceMap[item.id]) && (
                        <View style={styles.chip}>
                          <Ionicons name="navigate-outline" size={12} color="#555" />
                          <Text style={styles.chipText}>
                            {i18n.t('distanceAway', { distance: distanceMap[item.id] < 10 ? distanceMap[item.id].toFixed(1) : Math.round(distanceMap[item.id]) })}
                          </Text>
                        </View>
                      )}
                      {age && item.fees?.[age] !== undefined && (
                        <View style={[styles.chip, styles.chipHighlight]}>
                          <Ionicons name="person-outline" size={12} color="#166534" />
                          <Text style={[styles.chipText, styles.chipHighlightText]}>{i18n.t('matchingAgeLabel', { age })}</Text>
                        </View>
                      )}
                    </View>
                    {/* Private training banner */}
                    {hasPrivateTraining(item) && (
                      <View style={styles.privateBanner}>
                        <Ionicons name="flash" size={14} color="#0f766e" />
                        <Text style={styles.privateBannerText}>{i18n.t('privateTrainingAvailable') || 'Private Training Available'}</Text>
                      </View>
                    )}
                    {/* Description */}
                    {!!item.description && (
                      <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
                    )}
                    {/* Address */}
                    {!!displayAddress && (
                      <View style={styles.cardAddressRow}>
                        <Ionicons name="location-outline" size={13} color="#bbb" />
                        <Text style={styles.cardAddressText} numberOfLines={1}>{displayAddress}</Text>
                      </View>
                    )}
                    {/* CTA */}
                    <View style={styles.cardCTA}>
                      <Text style={styles.cardCTAText}>{i18n.t('viewDetails') || 'View Details'}</Text>
                      <Ionicons name="arrow-forward" size={15} color="#fff" />
                    </View>
                  </View>
                </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Ionicons name="school-outline" size={64} color="#666" />
                  <Text style={styles.emptyText}>{i18n.t('noAcademiesFound') || 'No academies found'}</Text>
                  <Text style={styles.emptySubtext}>{i18n.t('tryAdjustingFilters') || 'Try adjusting your filters'}</Text>
                </View>
              }
            />
          )}
        </ScrollView>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000', // Ensure dark background is set immediately to prevent glitch
  },
  gradient: {
    flex: 1,
  },
  screenScroll: {
    flex: 1,
  },
  screenContent: {
    paddingBottom: 12,
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
    zIndex: 1,
  },
  headerContent: {
    flex: 1,
    alignItems: 'center',
    marginLeft: -44, // Negative margin to center title while keeping menu button on left
    paddingHorizontal: 44, // Add padding to ensure title doesn't overlap with menu
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
  heroCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 18,
    marginHorizontal: 24,
    marginTop: 12,
    marginBottom: 12,
    padding: 16,
  },
  heroIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroTextWrap: {
    flex: 1,
  },
  heroTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
  },
  heroText: {
    fontSize: 13,
    color: '#4b5563',
    lineHeight: 18,
  },
  filtersCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    marginHorizontal: 24,
    marginTop: 0,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    maxHeight: 320, // Limit height to enable scrolling
  },
  filtersCardContent: {
    padding: 20,
  },
  filtersHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 12,
  },
  filtersHeadingWrap: {
    flex: 1,
  },
  filtersTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
  },
  filtersSubtitle: {
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 17,
  },
  clearFiltersButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#f3f4f6',
  },
  clearFiltersText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111827',
  },
  filterRow: {
    marginBottom: 12,
  },
  filterInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#f5f5f5',
    paddingHorizontal: 16,
    minHeight: 56,
  },
  filterIcon: {
    marginRight: 12,
  },
  filterInput: {
    flex: 1,
    fontSize: 16,
    color: '#000',
    paddingVertical: 16,
  },
  filterText: {
    flex: 1,
    fontSize: 16,
    color: '#000',
    paddingVertical: 16,
  },
  filterTextActive: {
    color: '#000',
    fontWeight: '700',
  },
  filterPlaceholder: {
    color: '#999',
  },
  filterInputDisabled: {
    backgroundColor: '#e8e8e8',
    borderColor: '#d0d0d0',
  },
  filterInputActive: {
    backgroundColor: '#e0ffe0',
    borderColor: '#90ee90',
  },
  filterInputDisabledText: {
    color: '#ccc',
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
  modalHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modalClearButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f3f4f6',
  },
  modalClearText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111827',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000',
  },
  modalScrollView: {
    maxHeight: 400,
  },
  modalOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  modalOptionSelected: {
    backgroundColor: '#000',
  },
  modalOptionText: {
    fontSize: 16,
    color: '#000',
  },
  modalOptionTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  modalEmptyState: {
    padding: 20,
    alignItems: 'center',
  },
  modalEmptyText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  resultsSummaryRow: {
    marginHorizontal: 24,
    marginBottom: 12,
    gap: 8,
  },
  resultsSummaryText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  resultsChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  summaryChip: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  summaryChipText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    fontSize: 16,
    color: '#fff',
    marginTop: 16,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 6,
    overflow: 'hidden',
  },
  cardHeaderStrip: {
    backgroundColor: '#111',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  cardIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardHeaderInfo: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 3,
  },
  cardLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardLocationText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.65)',
    flexShrink: 1,
  },
  cardBody: {
    padding: 16,
    gap: 10,
  },
  cardChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#f3f4f6',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: {
    fontSize: 12,
    color: '#333',
    fontWeight: '600',
  },
  chipHighlight: {
    backgroundColor: '#dcfce7',
  },
  chipHighlightText: {
    color: '#166534',
  },
  privateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#f0fdf4',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#22c55e',
  },
  privateBannerText: {
    fontSize: 13,
    color: '#0f766e',
    fontWeight: '700',
    flex: 1,
  },
  cardDesc: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 19,
  },
  cardAddressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  cardAddressText: {
    fontSize: 12,
    color: '#aaa',
    flexShrink: 1,
  },
  cardCTA: {
    backgroundColor: '#000',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    marginTop: 2,
  },
  cardCTAText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 8,
  },
});
