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
import { collection, query, getDocs, where } from 'firebase/firestore';

const cities = Object.entries(i18n.t('cities', { returnObjects: true }) as Record<string, string>).map(([key, label]) => ({ key, label }));
const cityOptions = cities.filter(({ key }) => !['giza', 'newCairo'].includes(key));
const districtsByCity: Record<string, string[]> = {
  cairo: ['Maadi', 'Nasr City', 'Heliopolis', 'Mokattam', 'New Cairo', 'Rehab', 'Madinaty', 'Shorouk', '6 October', 'Sheikh Zayed', 'Zamalek', 'Dokki', 'Mohandessin', 'Faisal', 'Haram'],
  alexandria: ['Roushdy', 'Smouha', 'Sporting', 'Kafr Abdo', 'Gleem', 'Sidi Bishr', 'Miami', 'Mandara', 'Agami', 'Montaza'],
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

interface Academy {
  id: string;
  name: string;
  academyName: string;
  city: string;
  district?: string;
  address: string;
  description: string;
  fees: any;
  displayFee: number;
  role: string;
  [key: string]: any;
}

export default function AcademySearchScreen() {
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
  const availableDistricts = city ? districtsByCity[city] || [] : [];
  const isDistrictEnabled = Boolean(city && availableDistricts.length > 0);
  const selectedDistrictLabel = selectedDistricts.length === 0
    ? ''
    : selectedDistricts.length <= 2
      ? selectedDistricts.join(', ')
      : (i18n.t('districtsSelectedCount', { count: selectedDistricts.length }) || `${selectedDistricts.length} districts selected`);
  const sortOptions = [
    { key: 'recommended', label: i18n.t('recommendedSort') || 'Recommended' },
    { key: 'nearest', label: i18n.t('nearestToMeSort') || 'Nearest to me' },
    { key: 'nameAsc', label: i18n.t('alphabeticalSort') || 'A to Z' },
    { key: 'lowestFee', label: i18n.t('lowestFeeSort') || 'Lowest fee' },
    { key: 'highestFee', label: i18n.t('highestFeeSort') || 'Highest fee' },
  ];
  const selectedSortLabel = sortOptions.find((option) => option.key === sortBy)?.label || sortOptions[0].label;

  useEffect(() => {
    fetchAcademies();
  }, []);

  const fetchAcademies = async () => {
    try {
      setLoading(true);

      const academyList: Academy[] = [];

      try {
        const academiesRef = collection(db, 'academies');
        const q = query(academiesRef);
        const querySnapshot = await getDocs(q);

        const programsRef = collection(db, 'academy_programs');
        const pQ = query(programsRef, where('type', '==', 'private_training'));
        const programsSnap = await getDocs(pQ);
        const privateProgramsMap: Record<string, any> = {};
        programsSnap.forEach((programDoc) => {
          const data = programDoc.data();
          if (data.academyId) {
            privateProgramsMap[data.academyId] = { id: programDoc.id, ...data };
          }
        });

        querySnapshot.forEach((doc) => {
          const data = doc.data();

          academyList.push({
            ...data,
            id: doc.id,
            name: data.academyName || 'Unnamed Academy',
            academyName: data.academyName || 'Unnamed Academy',
            city: data.city || '',
            district: data.district || '',
            address: data.address || '',
            description: data.description || (i18n.t('noDescriptionAvailable') || 'No description available'),
            fees: data.fees || {},
            displayFee: getLowestNumericFee(data.fees),
            role: data.role || 'academy',
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

  const hasPrivateTraining = (academy: Academy) => {
    const textBlob = JSON.stringify(academy ?? {}).toLowerCase();
    return !!(
      academy.privateTraining ||
      (academy.privateTrainings && academy.privateTrainings.length > 0) ||
      academy.privateTrainerAvailable ||
      academy.hasPrivateTraining ||
      textBlob.includes('private trainer') ||
      textBlob.includes('private training')
    );
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
      );    })
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

      return a.academyName.localeCompare(b.academyName);    })
    .sort((a, b) => {
      const feeA = getAcademyFee(a);
      const feeB = getAcademyFee(b);

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
            </View>
          </View>

          <HamburgerMenu />

          <ScrollView
            style={styles.filtersCard}
            contentContainerStyle={styles.filtersCardContent}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled={true}
            keyboardShouldPersistTaps="handled"
          >
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
                        key={item}
                        style={[styles.modalOption, selectedDistricts.includes(item) && styles.modalOptionSelected]}
                        onPress={() => toggleDistrictSelection(item)}
                      >
                        <Text style={[styles.modalOptionText, selectedDistricts.includes(item) && styles.modalOptionTextSelected]}>
                          {item}
                        </Text>
                        {selectedDistricts.includes(item) && <Ionicons name="checkmark" size={20} color="#fff" />}
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
                    {Array.from({ length: 13 }, (_, i) => 4 + i).map((ageOption) => (
                      <TouchableOpacity
                        key={ageOption}
                        style={[styles.modalOption, age === ageOption.toString() && styles.modalOptionSelected]}
                        onPress={() => {
                          setAge(ageOption.toString());
                          setAgeModal(false);
                        }}
                      >
                        <Text style={[styles.modalOptionText, age === ageOption.toString() && styles.modalOptionTextSelected]}>
                          {ageOption} {i18n.t('years') || 'years'}
                        </Text>
                        {age === ageOption.toString() && <Ionicons name="checkmark" size={20} color="#fff" />}
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
                  onChangeText={setPrice}
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
                  activeOpacity={0.8}
                >
                  <View style={styles.cardHeader}>
                    <View style={styles.cardIcon}>
                      <Ionicons name="school" size={24} color="#000" />
                    </View>
                    <View style={styles.cardHeaderText}>
                      <Text style={styles.cardTitle} numberOfLines={1}>{item.academyName}</Text>
                      <View style={styles.cardLocation}>
                        <Ionicons name="location" size={14} color="#666" />
                        <Text style={styles.cardCity} numberOfLines={1}>{displayCityLabel}</Text>
                      </View>
                    </View>
                  </View>
                  <Text style={styles.cardDesc} numberOfLines={3}>{item.description}</Text>
                  {Number.isFinite(distanceMap[item.id]) && (
                    <Text style={styles.cardDistanceText}>
                      {i18n.t('distanceAway', {
                        distance: distanceMap[item.id] < 10 ? distanceMap[item.id].toFixed(1) : Math.round(distanceMap[item.id]),
                      }) || `${distanceMap[item.id].toFixed(1)} km away`}
                    </Text>
                  )}
                  <View style={styles.cardFooter}>
                    <View style={styles.cardAddressRow}>
                      <Ionicons name="location-outline" size={16} color="#666" style={styles.cardAddressIcon} />
                      <View style={styles.cardAddressTextWrap}>
                        <Text style={styles.cardAddressLabel}>{i18n.t('address') || 'Address'}</Text>
                        <Text style={styles.cardAgeText} numberOfLines={2} ellipsizeMode="tail">
                          {displayAddress || (i18n.t('noAddress') || 'No address')}
                        </Text>
                      </View>
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
    backgroundColor: '#000000',
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
  filtersCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    marginHorizontal: 24,
    marginTop: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    maxHeight: 300,
  },
  filtersCardContent: {
    padding: 20,
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
  filterInputActive: {
    borderColor: '#000',
    backgroundColor: '#efefef',
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
  loadingContainer: {
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
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 5,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  cardHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 4,
    flexShrink: 1,
  },
  cardLocation: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardCity: {
    flex: 1,
    flexShrink: 1,
    fontSize: 14,
    color: '#666',
    marginLeft: 4,
  },
  cardDesc: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 12,
  },
  cardDistanceText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 10,
  },
  cardFooter: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  cardAddressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
  },
  cardAddressIcon: {
    marginTop: 18,
  },
  cardAddressTextWrap: {
    flex: 1,
    minWidth: 0,
    marginLeft: 6,
  },
  cardAddressLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
    marginBottom: 2,
    letterSpacing: 0.3,
  },
  cardAge: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  cardAgeText: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
  },
  cardPrice: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000',
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
