import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import React, { useRef, useState, useEffect } from 'react';
import { Alert, Animated, Easing, FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import i18n from '../locales/i18n';
import { db } from '../lib/firebase';
import { collection, getDocs, query } from 'firebase/firestore';

const cities = Object.entries(i18n.t('cities', { returnObjects: true }) as Record<string, string>).map(([key, label]) => ({ key, label }));
const cityOptions = cities.filter(({ key }) => !['giza', 'newCairo'].includes(key));
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
const allDistrictOptions = Object.values(districtsByCity)
  .flat()
  .filter((option, index, list) => list.findIndex((item) => item.key === option.key) === index);
const servicesList = [
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

const normalizeCityKey = (value: string) => (value || '').toString().replace(/\s+/g, '').toLowerCase();
const cityMatchesFilter = (clinicCity: string, selectedCity: string) => {
  if (!selectedCity) return true;

  const normalizedClinicCity = normalizeCityKey(clinicCity);
  const normalizedSelectedCity = normalizeCityKey(selectedCity);

  if (normalizedSelectedCity === 'cairo') {
    return ['cairo', 'giza', 'newcairo'].includes(normalizedClinicCity);
  }

  return normalizedClinicCity === normalizedSelectedCity;
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

const getClinicLocationCandidates = (clinic: any): Coordinates[] => {
  const direct = parseLocationCoordinates(clinic);
  const nested = Array.isArray(clinic?.locations)
    ? clinic.locations
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

const getRelevantClinicLocation = (
  clinic: Clinic,
  selectedCity: string,
  selectedDistrict: string,
  preferredOrigin?: Coordinates | null
) => {
  const candidateLocations = Array.isArray(clinic.locations) && clinic.locations.length
    ? clinic.locations
    : [clinic];

  let matches = candidateLocations.filter((location) => {
    const branchCity = location?.city || clinic.city || '';
    const branchDistrict = location?.district || clinic.district || '';
    const cityOk = !selectedCity || cityMatchesFilter(branchCity, selectedCity);
    const districtOk = !selectedDistrict || branchDistrict === selectedDistrict;
    return cityOk && districtOk;
  });

  if (!matches.length && selectedCity) {
    matches = candidateLocations.filter((location) =>
      cityMatchesFilter(location?.city || clinic.city || '', selectedCity)
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

  return matches[0] || clinic;
};

interface Clinic {
  id: string;
  clinicName: string;
  name: string;
  city: string;
  district?: string;
  address: string;
  description: string;
  services: string[];
  minPrice: number;
  servicePrices: Record<string, number>;
  locations?: Array<{ city?: string; district?: string; address?: string }>;
}

export default function ClinicSearchScreen() {
  const { openMenu } = useHamburgerMenu();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [cityModal, setCityModal] = useState(false);
  const [district, setDistrict] = useState('');
  const [districtModal, setDistrictModal] = useState(false);
  const [service, setService] = useState('');
  const [serviceModal, setServiceModal] = useState(false);
  const [price, setPrice] = useState('');
  const [sortBy, setSortBy] = useState('recommended');
  const [sortModal, setSortModal] = useState(false);
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [distanceMap, setDistanceMap] = useState<Record<string, number>>({});
  const [locationLoading, setLocationLoading] = useState(false);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const availableDistricts = city ? districtsByCity[city] || [] : [];
  const isDistrictEnabled = Boolean(city && availableDistricts.length > 0);
  const sortOptions = [
    { key: 'recommended', label: i18n.t('recommendedSort') || 'Recommended' },
    { key: 'nearest', label: i18n.t('nearestToMeSort') || 'Nearest to me' },
    { key: 'nameAsc', label: i18n.t('alphabeticalSort') || 'A to Z' },
    { key: 'lowestPrice', label: i18n.t('lowestFeeSort') || 'Lowest price' },
    { key: 'highestPrice', label: i18n.t('highestFeeSort') || 'Highest price' },
  ];
  const selectedSortLabel = locationLoading
    ? (i18n.t('gettingCurrentLocation') || 'Getting current location...')
    : (sortOptions.find((option) => option.key === sortBy)?.label || sortOptions[0].label);

  useEffect(() => {
    if (city && district && !availableDistricts.some((item) => item.key === district)) {
      setDistrict('');
    }
  }, [city]);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();

    fetchClinics();
  }, []);

  const fetchClinics = async () => {
    try {
      setLoading(true);

      const clinicsRef = collection(db, 'clinics');
      const q = query(clinicsRef);
      const querySnapshot = await getDocs(q);

      const clinicList: Clinic[] = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();

        // Extract services that are selected
        const clinicServices: string[] = [];
        const servicePrices: Record<string, number> = {};
        let minServicePrice = Infinity;

        if (data.services) {
          Object.entries(data.services).forEach(([key, val]: [string, any]) => {
            if (val.selected) {
              clinicServices.push(key);
              const fee = parseFloat(val.fee);
              if (!isNaN(fee)) {
                servicePrices[key] = fee;
                if (fee < minServicePrice) {
                  minServicePrice = fee;
                }
              }
            }
          });
        }

        clinicList.push({
          id: doc.id,
          clinicName: data.clinicName || data.name || 'Unnamed Clinic',
          name: data.name || data.clinicName || 'Unnamed Clinic',
          city: data.city || '',
          district: data.district || '',
          address: data.address || '',
          description: data.description || (i18n.t('noDescriptionAvailable') || 'No description available'),
          services: clinicServices,
          minPrice: minServicePrice === Infinity ? 0 : minServicePrice,
          servicePrices,
          locations: Array.isArray(data.locations) ? data.locations : [],
        });
      });

      setClinics(clinicList);
    } catch (error) {
      console.error('Error fetching clinics:', error);
    } finally {
      setLoading(false);
    }
  };

  const getServicePrice = (clinic: Clinic, selectedService: string): number => {
    if (!selectedService) return clinic.minPrice;
    return clinic.servicePrices[selectedService] ?? Infinity;
  };

  const resolveDistances = async (origin: Coordinates) => {
    const entries = clinics.map((clinic) => {
      const candidates = getClinicLocationCandidates(clinic);
      if (!candidates.length) return null;

      const nearestDistance = Math.min(
        ...candidates.map((coords) => calculateDistanceKm(origin, coords))
      );

      return [clinic.id, nearestDistance] as const;
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

  const filtered = clinics
    .filter((c) => {
      const currentPrice = getServicePrice(c, service);
      const matchesCity = !city || (Array.isArray(c.locations) && c.locations.length
        ? c.locations.some((location) => cityMatchesFilter(location?.city || c.city || '', city))
        : cityMatchesFilter(c.city || '', city));
      const matchesDistrict = !district || (Array.isArray(c.locations) && c.locations.length
        ? c.locations.some((location) => (location?.district || c.district) === district)
        : c.district === district);

      return (
        (!name || c.clinicName.toLowerCase().includes(name.toLowerCase()) || c.name.toLowerCase().includes(name.toLowerCase())) &&
        matchesCity &&
        matchesDistrict &&
        (!service || c.services.includes(service)) &&
        (!price || currentPrice <= parseInt(price, 10))
      );
    })
    .sort((a, b) => {
      const priceA = getServicePrice(a, service);
      const priceB = getServicePrice(b, service);

      if (sortBy === 'nearest') {
        const distanceA = distanceMap[a.id] ?? Number.POSITIVE_INFINITY;
        const distanceB = distanceMap[b.id] ?? Number.POSITIVE_INFINITY;

        if (distanceA !== distanceB) {
          return distanceA - distanceB;
        }

        return a.clinicName.localeCompare(b.clinicName);
      }

      if (sortBy === 'nameAsc') {
        return a.clinicName.localeCompare(b.clinicName);
      }

      if (sortBy === 'lowestPrice') {
        return priceA - priceB;
      }

      if (sortBy === 'highestPrice') {
        return priceB - priceA;
      }

      const serviceCountDiff = (b.services?.length || 0) - (a.services?.length || 0);
      if (serviceCountDiff !== 0) return serviceCountDiff;

      const priceDiff = priceA - priceB;
      if (priceDiff !== 0) return priceDiff;

      return a.clinicName.localeCompare(b.clinicName);
    });

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
              <Text style={styles.headerTitle}>{i18n.t('searchClinics') || 'Search Clinics'}</Text>
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
                  placeholder={i18n.t('clinicNameLabel') || 'Clinic Name'}
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
                    {sortOptions.map((item) => (
                      <TouchableOpacity
                        key={item.key}
                        style={[styles.modalOption, sortBy === item.key && styles.modalOptionSelected]}
                        onPress={() => void handleSortSelection(item.key)}
                      >
                        <Text style={[styles.modalOptionText, sortBy === item.key && styles.modalOptionTextSelected]}>
                          {item.label}
                        </Text>
                        {sortBy === item.key && <Ionicons name="checkmark" size={20} color="#fff" />}
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
                          setDistrict('');
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
                <Text style={[styles.filterText, !district && styles.filterPlaceholder, !isDistrictEnabled && styles.filterInputDisabledText]}>
                  {district || (!city
                    ? (i18n.t('selectCityFirst') || 'Select city first')
                    : (availableDistricts.length ? (i18n.t('district') || 'District') : (i18n.t('noDistrictsAvailable') || 'No districts available')))}
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
                      {district ? (
                        <TouchableOpacity style={styles.modalClearButton} onPress={() => setDistrict('')}>
                          <Text style={styles.modalClearText}>{i18n.t('clear') || 'Clear'}</Text>
                        </TouchableOpacity>
                      ) : null}
                      <TouchableOpacity onPress={() => setDistrictModal(false)}>
                        <Ionicons name="close" size={24} color="#000" />
                      </TouchableOpacity>
                    </View>
                  </View>
                  <ScrollView style={styles.modalScrollView}>
                    {availableDistricts.length ? availableDistricts.map((item) => (
                      <TouchableOpacity
                        key={item.key}
                        style={[styles.modalOption, district === item.key && styles.modalOptionSelected]}
                        onPress={() => {
                          setDistrict(item.key);
                          setDistrictModal(false);
                        }}
                      >
                        <Text style={[styles.modalOptionText, district === item.key && styles.modalOptionTextSelected]}>
                          {item.label}
                        </Text>
                        {district === item.key && <Ionicons name="checkmark" size={20} color="#fff" />}
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
              <TouchableOpacity style={styles.filterInputWrapper} onPress={() => setServiceModal(true)}>
                <Ionicons name="medical-outline" size={20} color="#999" style={styles.filterIcon} />
                <Text style={[styles.filterText, !service && styles.filterPlaceholder]}>
                  {service ? servicesList.find(s => s.key === service)?.label : i18n.t('service') || 'Service'}
                </Text>
                <Ionicons name="chevron-down" size={20} color="#999" />
              </TouchableOpacity>
            </View>

            <Modal visible={serviceModal} transparent animationType="fade" onRequestClose={() => setServiceModal(false)}>
              <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setServiceModal(false)}>
                <View style={styles.modalContent}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>{i18n.t('selectService') || 'Select Service'}</Text>
                    <TouchableOpacity onPress={() => setServiceModal(false)}>
                      <Ionicons name="close" size={24} color="#000" />
                    </TouchableOpacity>
                  </View>
                  <ScrollView style={styles.modalScrollView}>
                    {servicesList.map((item) => (
                      <TouchableOpacity
                        key={item.key}
                        style={[styles.modalOption, service === item.key && styles.modalOptionSelected]}
                        onPress={() => {
                          setService(item.key);
                          setServiceModal(false);
                        }}
                      >
                        <Text style={[styles.modalOptionText, service === item.key && styles.modalOptionTextSelected]}>
                          {item.label}
                        </Text>
                        {service === item.key && <Ionicons name="checkmark" size={20} color="#fff" />}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </TouchableOpacity>
            </Modal>

            <View style={styles.filterRow}>
              <View style={[styles.filterInputWrapper, !service && styles.filterInputDisabled]}>
                <Ionicons name="cash-outline" size={20} color={service ? '#999' : '#666'} style={styles.filterIcon} />
                <TextInput
                  style={[styles.filterInput, !service && styles.filterInputDisabledText]}
                  value={price}
                  onChangeText={(text) => setPrice(text.trim())}
                  placeholder={i18n.t('maxPrice') || 'Max Price'}
                  placeholderTextColor={service ? '#999' : '#666'}
                  keyboardType="numeric"
                  editable={!!service}
                />
              </View>
            </View>
          </ScrollView>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#fff" />
              <Text style={styles.loadingText}>{i18n.t('loadingClinics') || 'Loading clinics...'}</Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={item => item.id}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const displayLocation = getRelevantClinicLocation(
                  item,
                  city,
                  district,
                  sortBy === 'nearest' ? userLocation : null
                );
                const displayCityLabel = getCityLabel(displayLocation?.city || item.city);
                const displayDistrict = displayLocation?.district || item.district || '';
                const displayAddress = [displayDistrict, displayCityLabel, displayLocation?.address || item.address]
                  .filter(Boolean)
                  .join(', ');
                const branchCount = Array.isArray(item.locations) && item.locations.length ? item.locations.length : 1;

                return (
                  <TouchableOpacity
                    onPress={() => router.push({ pathname: '/clinic-details', params: { clinic: JSON.stringify(item) } })}
                    style={styles.card}
                    activeOpacity={0.8}
                  >
                    <View style={styles.cardHeader}>
                      <View style={styles.cardIcon}>
                        <Ionicons name="medical" size={24} color="#000" />
                      </View>
                      <View style={styles.cardHeaderText}>
                        <Text style={styles.cardTitle}>{item.clinicName}</Text>
                        <View style={styles.cardLocation}>
                          <Ionicons name="location" size={14} color="#666" />
                          <Text style={styles.cardCity}>
                            {displayCityLabel}{branchCount > 1 ? ` • ${branchCount} ${i18n.t('locationLabel') || 'branches'}` : ''}
                          </Text>
                        </View>
                      </View>
                    </View>
                    <Text style={styles.cardDesc}>{item.description}</Text>
                    {Number.isFinite(distanceMap[item.id]) && (
                      <Text style={styles.cardDistanceText}>
                        {i18n.t('distanceAway', {
                          distance: distanceMap[item.id] < 10 ? distanceMap[item.id].toFixed(1) : Math.round(distanceMap[item.id]),
                        }) || `${distanceMap[item.id].toFixed(1)} km away`}
                      </Text>
                    )}
                    <View style={styles.cardFooter}>
                      <View style={styles.cardAddress}>
                        <Ionicons name="location-outline" size={16} color="#666" />
                        <Text style={styles.cardAddressText}>
                          {displayAddress || (i18n.t('noAddress') || 'No address')}
                        </Text>
                      </View>
                      <View style={styles.cardServices}>
                        <Ionicons name="list" size={16} color="#666" />
                        <Text style={styles.cardServicesText}>{item.services.length} {i18n.t('services') || 'services'}</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Ionicons name="medical-outline" size={64} color="#666" />
                  <Text style={styles.emptyText}>{i18n.t('noClinicsFound') || 'No clinics found'}</Text>
                  <Text style={styles.emptySubtext}>{i18n.t('tryAdjustingFilters') || 'Try adjusting your filters'}</Text>
                </View>
              }
            />
          )}
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
  filtersCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    maxHeight: 300, // Limit height to enable scrolling
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
  modalClearButton: {
    marginRight: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f3f4f6',
  },
  modalClearText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
  },
  modalEmptyState: {
    padding: 20,
    alignItems: 'center',
  },
  modalEmptyText: {
    fontSize: 14,
    color: '#666',
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
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 4,
  },
  cardLocation: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardCity: {
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
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 10,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  cardServices: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardServicesText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 4,
  },
  cardAddress: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  cardAddressText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 4,
    flex: 1,
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
