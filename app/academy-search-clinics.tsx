import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import Slider from '@react-native-community/slider';
import React, { useRef, useState, useEffect } from 'react';
import { Alert, Animated, Easing, FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, RefreshControl } from 'react-native';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import i18n from '../locales/i18n';
import { db } from '../lib/firebase';
import { collection, getDocs, query } from 'firebase/firestore';
import FootballLoader from '../components/FootballLoader';
import SuspendedBadge from '../components/SuspendedBadge';
import { isSuspendedEntity } from '../lib/suspension';

const cities = Object.entries(i18n.t('cities', { returnObjects: true }) as Record<string, string>).map(([key, label]) => ({ key, label }));
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

interface Clinic {
  id: string;
  clinicName: string;
  city: string;
  address: string;
  description: string;
  services: string[];
  minPrice: number;
  servicePrices: Record<string, number>;
  isSuspended?: boolean;
  status?: string;
}

export default function AcademySearchClinicsScreen() {
  const { openMenu } = useHamburgerMenu();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [cityModal, setCityModal] = useState(false);
  const [service, setService] = useState('');
  const [serviceModal, setServiceModal] = useState(false);
  const [price, setPrice] = useState<number | null>(null);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const router = useRouter();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const maxAvailablePrice = React.useMemo(() => {
    let maxPrice = 0;

    clinics.forEach((clinic) => {
      if (clinic?.servicePrices && typeof clinic.servicePrices === 'object') {
        Object.values(clinic.servicePrices).forEach((value) => {
          const numericValue = Number(value);
          if (Number.isFinite(numericValue) && numericValue > maxPrice) {
            maxPrice = numericValue;
          }
        });
      }

      const numericMinPrice = Number(clinic?.minPrice);
      if (Number.isFinite(numericMinPrice) && numericMinPrice > maxPrice) {
        maxPrice = numericMinPrice;
      }
    });

    return Math.max(0, Math.round(maxPrice));
  }, [clinics]);

  const fetchClinics = React.useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setLoadError(null);
      const clinicsRef = collection(db, 'clinics');
      const q = query(clinicsRef);
      const [querySnapshot, usersSnapshot] = await Promise.all([
        getDocs(q),
        getDocs(collection(db, 'users')),
      ]);
      const userMap = new Map(usersSnapshot.docs.map((userDoc) => [userDoc.id, userDoc.data()]));

      const clinicList: Clinic[] = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const userData = userMap.get(docSnap.id);
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
          id: docSnap.id,
          clinicName: data.clinicName || 'Unnamed Clinic',
          city: data.city || '',
          address: data.address || '',
          description: data.description || (i18n.t('noDescriptionAvailable') || 'No description available'),
          services: clinicServices,
          minPrice: minServicePrice === Infinity ? 0 : minServicePrice,
          servicePrices,
          isSuspended: isSuspendedEntity({ ...data, ...userData }),
          status: userData?.status || data.status || '',
        });
      });

      setClinics(clinicList);
    } catch (error) {
      console.error('Error fetching clinics:', error);
      setLoadError(i18n.t('failedLoadClinics') || 'Failed to load clinics. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  useEffect(() => {
    fetchClinics();
  }, [fetchClinics]);

  useEffect(() => {
    if (maxAvailablePrice <= 0) {
      setPrice(null);
      return;
    }

    setPrice((prev) => {
      if (prev === null) return maxAvailablePrice;
      return Math.min(maxAvailablePrice, Math.max(0, Math.round(prev)));
    });
  }, [maxAvailablePrice]);

  const getServicePrice = (clinic: Clinic, selectedService: string): number => {
    if (!selectedService) return clinic.minPrice;
    return clinic.servicePrices[selectedService] ?? Infinity;
  };

  const sliderMaxPrice = Math.max(1, maxAvailablePrice);
  const selectedMaxPrice = price ?? maxAvailablePrice;
  const hasPriceFilter = maxAvailablePrice > 0 && selectedMaxPrice < maxAvailablePrice;

  const filtered = clinics.filter(c => {
    const currentPrice = getServicePrice(c, service);
    const passes = (
      (!name || c.clinicName.toLowerCase().includes(name.toLowerCase())) &&
      (!city || String(c.city || '').toLowerCase() === String(city || '').toLowerCase()) &&
      (!service || c.services.includes(service)) &&
      (!hasPriceFilter || currentPrice <= selectedMaxPrice)
    );
    return passes;
  });
  const hasActiveFilters = Boolean(name || city || service || hasPriceFilter);

  const clearAllFilters = () => {
    setName('');
    setCity('');
    setService('');
    setPrice(null);
  };

  const handleClinicPress = (clinic: Clinic) => {
    if (clinic.isSuspended) {
      Alert.alert(
        i18n.t('suspendedBadge') || 'Suspended',
        i18n.t('suspendedProviderUnavailable') || 'This provider is suspended and unavailable right now.'
      );
      return;
    }

    router.push({ pathname: '/academy-clinic-details', params: { id: clinic.id } });
  };

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
              <Text style={styles.headerTitle}>{i18n.t('searchClinics') || 'Search Clinics'}</Text>
              <Text style={styles.headerSubtitle}>{i18n.t('academyBookClinicsSubtitle') || 'Book clinic appointments for your academy'}</Text>
            </View>
          </View>

          <HamburgerMenu />

          <ScrollView
            style={styles.filtersCard}
            contentContainerStyle={styles.filtersCardContent}
            showsVerticalScrollIndicator={true}
            nestedScrollEnabled={true}
            scrollEnabled={true}
            keyboardShouldPersistTaps="handled"
          >
            {hasActiveFilters ? (
              <View style={styles.filtersHeaderRow}>
                <TouchableOpacity style={styles.clearFiltersButton} onPress={clearAllFilters}>
                  <Text style={styles.clearFiltersText}>{i18n.t('clearFilters') || 'Clear filters'}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
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
                    {cities.map((item) => (
                      <TouchableOpacity
                        key={item.key}
                        style={[styles.modalOption, city === item.key && styles.modalOptionSelected]}
                        onPress={() => {
                          setCity(item.key);
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
              <View style={styles.priceMeterCard}>
                <View style={styles.priceMeterHeader}>
                  <View style={styles.priceMeterTitleWrap}>
                    <Ionicons name="cash-outline" size={18} color="#111827" />
                    <Text style={styles.priceMeterLabel}>{i18n.t('maxPrice') || 'Max Price'}</Text>
                  </View>
                  <Text style={styles.priceMeterValue}>{Math.round(selectedMaxPrice)} EGP</Text>
                </View>
                <Slider
                  style={styles.priceMeterSlider}
                  minimumValue={0}
                  maximumValue={sliderMaxPrice}
                  step={1}
                  value={Math.min(sliderMaxPrice, Math.max(0, selectedMaxPrice))}
                  onValueChange={(value) => setPrice(Math.round(value))}
                  minimumTrackTintColor="#111827"
                  maximumTrackTintColor="#d1d5db"
                  thumbTintColor="#111827"
                  disabled={maxAvailablePrice === 0}
                />
              </View>
            </View>
            <View style={styles.priceRangeMetaRow}>
              <Text style={styles.priceRangeMetaText}>0 EGP</Text>
              <Text style={styles.priceRangeMetaText}>{maxAvailablePrice} EGP</Text>
            </View>
          </ScrollView>

          {loading ? (
            <View style={styles.loadingContainer}>
              <FootballLoader size="large" color="#fff" />
              <Text style={styles.loadingText}>{i18n.t('loadingClinics') || 'Loading clinics...'}</Text>
            </View>
          ) : loadError && clinics.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="alert-circle-outline" size={64} color="#f59e0b" />
              <Text style={styles.emptyText}>{i18n.t('error') || 'Error'}</Text>
              <Text style={styles.emptySubtext}>{loadError}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={() => fetchClinics()} activeOpacity={0.8}>
                <Text style={styles.retryButtonText}>{i18n.t('retry') || 'Retry'}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={item => item.id}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => fetchClinics(true)}
                  tintColor="#fff"
                />
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => handleClinicPress(item)}
                  style={[styles.card, item.isSuspended && styles.cardSuspended]}
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
                        <Text style={styles.cardCity}>{cities.find(c => c.key === item.city)?.label || item.city}</Text>
                      </View>
                    </View>
                  </View>
                  {item.isSuspended && (
                    <View style={styles.cardSuspendedBadgeRow}>
                      <SuspendedBadge tone="light" />
                    </View>
                  )}
                  <Text style={styles.cardDesc}>{item.description}</Text>
                  <View style={styles.cardFooter}>
                    <View style={styles.cardServices}>
                      <Ionicons name="list" size={16} color="#666" />
                      <Text style={styles.cardServicesText}>{item.services.length} {i18n.t('services') || 'services'}</Text>
                    </View>
                    <Text style={styles.cardPrice}>{i18n.t('price')}: {item.minPrice > 0 ? `${item.minPrice} EGP` : 'N/A'}</Text>
                  </View>
                </TouchableOpacity>
              )}
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
  container: { flex: 1 },
  gradient: { flex: 1 },
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
  headerContent: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 4, textAlign: 'center' },
  headerSubtitle: { fontSize: 14, color: 'rgba(255, 255, 255, 0.7)', textAlign: 'center' },
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
    maxHeight: 300,
    flexGrow: 0,
    overflow: 'hidden',
  },
  filtersCardContent: { padding: 20, paddingBottom: 24 },
  filtersHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 12,
  },
  clearFiltersButton: {
    backgroundColor: '#f3f4f6',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  clearFiltersText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
  },
  filterRow: { marginBottom: 12 },
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
  filterIcon: { marginRight: 12 },
  filterInput: { flex: 1, fontSize: 16, color: '#000', paddingVertical: 16 },
  filterText: { flex: 1, fontSize: 16, color: '#000', paddingVertical: 16 },
  filterPlaceholder: { color: '#999' },
  filterInputDisabled: { backgroundColor: '#e8e8e8', borderColor: '#d0d0d0' },
  filterInputDisabledText: { color: '#ccc' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#fff', borderRadius: 20, width: '90%', maxHeight: '70%', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20, elevation: 10 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#e0e0e0' },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#000' },
  modalScrollView: { maxHeight: 400 },
  modalOption: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  modalOptionSelected: { backgroundColor: '#000' },
  modalOptionText: { fontSize: 16, color: '#000' },
  modalOptionTextSelected: { color: '#fff', fontWeight: '600' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60 },
  loadingText: { fontSize: 16, color: '#fff', marginTop: 16 },
  listContent: { paddingHorizontal: 20, paddingBottom: 40 },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 20, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 5 },
  cardSuspended: { opacity: 0.82, borderWidth: 1, borderColor: '#fecaca' },
  cardSuspendedBadgeRow: { marginBottom: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  cardIcon: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#f0f0f0', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  cardHeaderText: { flex: 1 },
  cardTitle: { fontSize: 18, fontWeight: 'bold', color: '#000', marginBottom: 4 },
  cardLocation: { flexDirection: 'row', alignItems: 'center' },
  cardCity: { fontSize: 14, color: '#666', marginLeft: 4 },
  cardDesc: { fontSize: 14, color: '#666', lineHeight: 20, marginBottom: 12 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  cardServices: { flexDirection: 'row', alignItems: 'center' },
  cardServicesText: { fontSize: 14, color: '#666', marginLeft: 4 },
  cardPrice: { fontSize: 16, fontWeight: 'bold', color: '#000' },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 18, fontWeight: '600', color: '#fff', marginTop: 16 },
  emptySubtext: { fontSize: 14, color: 'rgba(255, 255, 255, 0.6)', marginTop: 8 },
  retryButton: {
    marginTop: 18,
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  priceMeterCard: {
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#f5f5f5',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
  },
  priceMeterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  priceMeterTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  priceMeterLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  priceMeterValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111827',
  },
  priceMeterSlider: {
    width: '100%',
    height: 34,
  },
  priceRangeMetaRow: {
    marginTop: -4,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
  },
  priceRangeMetaText: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '600',
  },
  retryButtonText: {
    fontSize: 14,
    color: '#111',
    fontWeight: '700',
  },
});
