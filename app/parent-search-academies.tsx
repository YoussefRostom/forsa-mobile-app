import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import i18n from '../locales/i18n';
import { db } from '../lib/firebase';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';

const cities = Object.entries(i18n.t('cities', { returnObjects: true }) as Record<string, string>).map(([key, label]) => ({ key, label }));
const ageGroups = Array.from({ length: 11 }, (_, i) => (7 + i).toString());

interface Academy {
  id: string;
  academyName: string;
  city: string;
  address: string;
  description: string;
  fees: any;
  displayFee: number;
  role: string;
  privateTraining?: any;
}

export default function ParentSearchAcademiesScreen() {
  const { openMenu } = useHamburgerMenu();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [cityModal, setCityModal] = useState(false);
  const [age, setAge] = useState('');
  const [ageModal, setAgeModal] = useState(false);
  const [price, setPrice] = useState('');
  const [academies, setAcademies] = useState<Academy[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

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
            address: data.address || '',
            description: data.description || 'No description available',
            fees: data.fees || {},
            displayFee: typeof data.fees === 'object' ? Object.values(data.fees)[0] as number : (data.fees || 0),
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
    if (age && academy.fees) {
      const fee = academy.fees[age];
      return fee ? Number(fee) : academy.displayFee;
    }
    return academy.displayFee;
  };

  // Filter academies based on search criteria
  const filtered = academies.filter(a => {
    const fee = getAcademyFee(a);
    return (
      (!name || a.academyName.toLowerCase().includes(name.toLowerCase())) &&
      (!city || a.city === city) &&
      (!age || (a.fees && a.fees[age] !== undefined)) &&
      (!price || fee <= parseInt(price))
    );
  });

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient
        colors={['#000000', '#1a1a1a', '#2d2d2d']}
        style={styles.gradient}
      >
        <View style={{ flex: 1 }}>
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
          </ScrollView>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#fff" />
              <Text style={styles.loadingText}>Loading academies...</Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={item => item.id}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <>
                  <TouchableOpacity
                  style={styles.card}
                  onPress={() => router.push({ pathname: '/parent-academy-details', params: { id: item.id } })}
                  activeOpacity={0.8}
                >
                  <View style={styles.cardHeader}>
                    <View style={styles.cardIcon}>
                      <Ionicons name="school" size={24} color="#000" />
                    </View>
                    <View style={styles.cardHeaderText}>
                      <Text style={styles.cardTitle}>{item.academyName}</Text>
                      <View style={styles.cardLocation}>
                        <Ionicons name="location" size={14} color="#666" />
                        <Text style={styles.cardCity}>{item.city}</Text>
                      </View>
                    </View>
                  </View>
                  <Text style={styles.cardDesc}>{item.description}</Text>
                  <View style={styles.cardFooter}>
                    <View style={styles.cardAge}>
                      <Ionicons name="location-outline" size={16} color="#666" />
                      <Text style={styles.cardAgeText}>{item.address || 'No address'}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              </>
              )}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Ionicons name="school-outline" size={64} color="#666" />
                  <Text style={styles.emptyText}>{i18n.t('noAcademiesFound') || 'No academies found'}</Text>
                  <Text style={styles.emptySubtext}>Try adjusting your filters</Text>
                </View>
              }
            />
          )}
        </View>
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
  privateTrainingCard: {
    marginBottom: 16,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#f6c23e',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
    marginTop: -8, // tuck slightly under academy card
  },
  privateTrainingGradient: {
    padding: 16,
  },
  privateCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  privateCardTitle: {
    color: '#f6c23e',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  privateCardCoach: {
    color: '#fff',
    fontSize: 14,
    marginBottom: 4,
  },
  privateCardPrice: {
    color: '#ccc',
    fontSize: 14,
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
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  cardAge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardAgeText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 4,
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
