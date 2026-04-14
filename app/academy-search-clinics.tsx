import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useRef, useState, useEffect } from 'react';
import { Animated, Easing, FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator, RefreshControl } from 'react-native';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import i18n from '../locales/i18n';
import { db } from '../lib/firebase';
import { collection, getDocs, query } from 'firebase/firestore';

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
}

export default function AcademySearchClinicsScreen() {
  const { openMenu } = useHamburgerMenu();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [cityModal, setCityModal] = useState(false);
  const [service, setService] = useState('');
  const [serviceModal, setServiceModal] = useState(false);
  const [price, setPrice] = useState('');
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const router = useRouter();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();

    fetchClinics();
  }, []);

  const fetchClinics = async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setLoadError(null);
      const clinicsRef = collection(db, 'clinics');
      const q = query(clinicsRef);
      const querySnapshot = await getDocs(q);

      const clinicList: Clinic[] = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
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
  };

  const getServicePrice = (clinic: Clinic, selectedService: string): number => {
    if (!selectedService) return clinic.minPrice;
    return clinic.servicePrices[selectedService] ?? Infinity;
  };

  const filtered = clinics.filter(c => {
    const currentPrice = getServicePrice(c, service);
    const maxPrice = parseInt(price.trim());
    const passes = (
      (!name || c.clinicName.toLowerCase().includes(name.toLowerCase())) &&
      (!city || String(c.city || '').toLowerCase() === String(city || '').toLowerCase()) &&
      (!service || c.services.includes(service)) &&
      (!price.trim() || isNaN(maxPrice) || currentPrice <= maxPrice)
    );
    return passes;
  });

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
                  onPress={() => router.push({ pathname: '/academy-clinic-details', params: { id: item.id } })}
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
                        <Text style={styles.cardCity}>{cities.find(c => c.key === item.city)?.label || item.city}</Text>
                      </View>
                    </View>
                  </View>
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
  },
  filtersCardContent: { padding: 20 },
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
  retryButtonText: {
    fontSize: 14,
    color: '#111',
    fontWeight: '700',
  },
});
