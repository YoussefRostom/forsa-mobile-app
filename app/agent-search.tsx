// Agent type
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Picker } from '@react-native-picker/picker';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, FlatList, Image, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { type QueryDocumentSnapshot, type DocumentData } from 'firebase/firestore';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import SuspendedBadge from '../components/SuspendedBadge';
import i18n from '../locales/i18n';
import { fetchAgentsPage, type AgentDirectoryEntry } from '../services/AgentDataService';
type AgentRecord = AgentDirectoryEntry;

// Backend fetch for agents
// const AGENT_API_URL = 'http://192.168.1.31:4000/api/agents';
// Use the same city list as academy search
const cityLabels = i18n.t('cities', { returnObjects: true }) as Record<string, string>;
const cities = [
  { key: '', label: i18n.t('cityPlaceholder') || 'City' },
  ...Object.entries(cityLabels).map(([key, label]) => ({ key, label }))
];

// Skeleton loader for agent card
function AgentCardSkeleton() {
  const pulseAnim = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.7, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, [pulseAnim]);
  return (
    <Animated.View style={[styles.card, { opacity: pulseAnim, flexDirection: 'row', alignItems: 'center' }]}> 
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#ddd', marginRight: 12 }} />
      <View style={{ flex: 1 }}>
        <View style={{ width: 120, height: 18, backgroundColor: '#e0e0e0', borderRadius: 8, marginBottom: 8 }} />
        <View style={{ width: 80, height: 14, backgroundColor: '#e0e0e0', borderRadius: 8, marginBottom: 6 }} />
        <View style={{ width: '80%', height: 14, backgroundColor: '#e0e0e0', borderRadius: 8 }} />
      </View>
    </Animated.View>
  );
}

export default function AgentSearchScreen() {
  const router = useRouter();
  const { openMenu } = useHamburgerMenu();
  const [search, setSearch] = useState('');
  const [city, setCity] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [results, setResults] = useState<AgentRecord[]>([]);
  const [allAgents, setAllAgents] = useState<AgentRecord[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const favoriteAnims = useRef(new Map<string, Animated.Value>()).current;
  const [modalAgent, setModalAgent] = useState<AgentRecord | null>(null);
  const [remainingTexts, setRemainingTexts] = useState(2);

  useEffect(() => {
    loadInitialAgents();
    // Load favorites from local storage
    (async () => {
      try {
        const stored = await AsyncStorage.getItem('agentFavorites');
        if (stored) setFavorites(JSON.parse(stored));
      } catch {}
    })();
    // Load remaining texts for this month
    (async () => {
      try {
        const now = new Date();
        const key = `remainingAgentTexts_${now.getFullYear()}_${now.getMonth()}`;
        const stored = await AsyncStorage.getItem(key);
        setRemainingTexts(stored !== null ? parseInt(stored, 10) : 2);
      } catch {}
    })();
  }, []);

  const loadInitialAgents = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const page = await fetchAgentsPage({ pageSize: 20, cursor: null });
      setAllAgents(page.items);
      setResults(page.items);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch (err) {
      console.error('Failed to fetch agents:', err);
      setAllAgents([]);
      setResults([]);
      setHasMore(false);
      setErrorMessage(i18n.t('failedToLoadAgents') || 'Failed to load agents. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const loadMoreAgents = async () => {
    if (loading || loadingMore || !hasMore) return;
    setLoadingMore(true);
    setErrorMessage(null);
    try {
      const page = await fetchAgentsPage({ pageSize: 20, cursor });
      const merged = [...allAgents, ...page.items];
      setAllAgents(merged);
      setCursor(page.cursor);
      setHasMore(page.hasMore);

      let filtered = merged.filter(a =>
        (!search || a.name.toLowerCase().includes(search.toLowerCase())) &&
        (!city || a.city === city)
      );
      if (showFavoritesOnly) {
        filtered = filtered.filter(a => favorites.includes(a.id));
      }
      setResults(filtered);
    } catch (err) {
      console.error('Failed to load more agents:', err);
      setErrorMessage(i18n.t('failedToLoadMoreAgents') || 'Failed to load more agents.');
    } finally {
      setLoadingMore(false);
    }
  };

  const handleSearch = () => {
    let filtered = allAgents.filter(a =>
      (!search || a.name.toLowerCase().includes(search.toLowerCase())) &&
      (!city || a.city === city)
    );
    if (showFavoritesOnly) {
      filtered = filtered.filter(a => favorites.includes(a.id));
    }
    setResults(filtered);
  };

  const handleClearFilters = () => {
    setSearch('');
    setCity('');
    setShowFavoritesOnly(false);
    setResults(allAgents);
  };

  const getFavoriteAnimation = (agentId: string) => {
    if (!favoriteAnims.has(agentId)) {
      favoriteAnims.set(agentId, new Animated.Value(1));
    }
    return favoriteAnims.get(agentId)!;
  };

  const toggleFavorite = async (agentId: string) => {
    const newFavorites = favorites.includes(agentId)
      ? favorites.filter((id) => id !== agentId)
      : [...favorites, agentId];
    setFavorites(newFavorites);
    await AsyncStorage.setItem('agentFavorites', JSON.stringify(newFavorites));
    const anim = getFavoriteAnimation(agentId);
    Animated.sequence([
      Animated.timing(anim, { toValue: 1.5, duration: 150, useNativeDriver: true }),
      Animated.timing(anim, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
  };

  const handleAgentPress = (agent: AgentRecord) => {
    if (agent.isSuspended) {
      Alert.alert(
        i18n.t('suspendedBadge') || 'Suspended',
        i18n.t('suspendedUserUnavailable') || 'This profile is suspended and unavailable right now.'
      );
      return;
    }

    setModalAgent(agent);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <HamburgerMenu />
      <View style={styles.headerContainer}>
        <TouchableOpacity style={styles.menuButton} onPress={openMenu} activeOpacity={0.8}>
          <View style={styles.menuButtonInner}>
            <View style={styles.menuLine} />
            <View style={styles.menuLine} />
            <View style={styles.menuLine} />
          </View>
        </TouchableOpacity>
        <View style={styles.titleContainer}>
          <Text style={styles.titleText}>{i18n.t('agentSearchTitle')}</Text>
        </View>
      </View>
      {/* Remove outer ScrollView, use FlatList for scrolling */}
      <FlatList
        ListHeaderComponent={
          <View style={{ backgroundColor: '#000', paddingBottom: 16, paddingHorizontal: 0 }}>
            <View style={styles.filtersContainer}>
              <TouchableOpacity
                style={styles.filterHeader}
                onPress={() => setDropdownOpen((prev) => !prev)}
                activeOpacity={0.7}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="filter" size={20} color="#000" style={{ marginRight: 8 }} />
                  <Text style={styles.filterHeaderText}>{i18n.t('filters') || 'Filters'}</Text>
                </View>
                <Ionicons name={dropdownOpen ? 'chevron-up' : 'chevron-down'} size={22} color="#000" />
              </TouchableOpacity>
              {dropdownOpen && (
                <View style={styles.filterDropdown}>
                  {/* Name search */}
                  <View style={styles.filterSection}>
                    <Text style={styles.filterLabel}>{i18n.t('agentNamePlaceholder') || 'Agent Name'}</Text>
                    <View style={styles.searchInputWrap}>
                      <Ionicons name="search" size={20} color="#888" style={{ marginRight: 8 }} />
                      <TextInput
                        style={styles.pillInput}
                        placeholder={i18n.t('agentNamePlaceholder')}
                        value={search}
                        onChangeText={setSearch}
                        placeholderTextColor="#888"
                        returnKeyType="search"
                        onSubmitEditing={handleSearch}
                      />
                    </View>
                  </View>
                  {/* City filter */}
                  <View style={styles.filterSection}>
                    <Text style={styles.filterLabel}>{i18n.t('city') || 'City'}</Text>
                    <View style={styles.pickerContainer}>
                      <Picker
                        selectedValue={city}
                        onValueChange={setCity}
                        style={{ color: '#000', fontSize: 16 }}
                        mode="dropdown"
                      >
                        {cities.map((c) => (
                          <Picker.Item key={c.key} label={c.label} value={c.key} color="#000" />
                        ))}
                      </Picker>
                    </View>
                  </View>
                  {/* Favourites toggle */}
                  <View style={styles.filterSection}>
                    <TouchableOpacity
                      style={styles.favoriteToggle}
                      onPress={() => setShowFavoritesOnly(prev => !prev)}
                      activeOpacity={0.7}
                    >
                      <Animated.Text style={{ fontSize: 28, color: showFavoritesOnly ? '#ffd700' : '#aaa', marginRight: 8, transform: [{ scale: showFavoritesOnly ? 1.2 : 1 }] }}>
                        ★
                      </Animated.Text>
                      <Text style={styles.favoriteToggleText}>{i18n.t('showFavoritesOnly') || 'Show Favourites Only'}</Text>
                    </TouchableOpacity>
                  </View>
                  {/* Search/Clear buttons */}
                  <View style={styles.filterActions}>
                    <TouchableOpacity 
                      style={[styles.searchBtn, styles.searchBtnPrimary]} 
                      onPress={() => { setDropdownOpen(false); handleSearch(); }}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="search" size={18} color="#fff" style={{ marginRight: 6 }} />
                      <Text style={styles.searchBtnText}>{i18n.t('search')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.searchBtn, styles.searchBtnSecondary]}
                      onPress={() => { handleClearFilters(); setDropdownOpen(false); }}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="close-circle" size={18} color="#fff" style={{ marginRight: 6 }} />
                      <Text style={styles.searchBtnText}>{i18n.t('clearFilters') || 'Clear Filters'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          </View>
        }
        data={results}
        keyExtractor={item => item.id}
        renderItem={loading ? undefined : ({ item }) => (
          <TouchableOpacity
            style={[styles.card, item.isSuspended && styles.cardSuspended]}
            onPress={() => handleAgentPress(item)}
            activeOpacity={0.85}
          >
            <TouchableOpacity
              style={styles.favBtn}
              onPress={(e) => { e.stopPropagation(); toggleFavorite(item.id); }}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            >
              <Animated.Text style={{ fontSize: 22, color: favorites.includes(item.id) ? '#ffd700' : 'rgba(255,255,255,0.35)', transform: [{ scale: getFavoriteAnimation(item.id) }] }}>
                ★
              </Animated.Text>
            </TouchableOpacity>
            <View style={styles.cardHeader}>
              {item.profilePic ? (
                <Image source={{ uri: item.profilePic }} style={styles.cardAvatar} />
              ) : (
                <View style={styles.cardAvatarPlaceholder}>
                  <Ionicons name="person" size={26} color="#666" />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                {!!item.city && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                    <Ionicons name="location" size={12} color="rgba(255,255,255,0.5)" />
                    <Text style={styles.cardCity}>{cityLabels[item.city] || item.city}</Text>
                  </View>
                )}
                {item.isSuspended ? (
                  <View style={styles.cardBadgeWrap}>
                    <SuspendedBadge />
                  </View>
                ) : null}
              </View>
            </View>
            {!!item.description && (
              <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
            )}
            <View style={styles.cardFooter}>
              <Ionicons name="chatbubble-ellipses-outline" size={14} color="rgba(255,255,255,0.45)" />
              <Text style={styles.cardFooterText}>{i18n.t('tapToViewDetails') || 'Tap to view details'}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          loading ? (
            <View style={{ paddingTop: 20 }}>
              <AgentCardSkeleton />
              <AgentCardSkeleton />
              <AgentCardSkeleton />
            </View>
          ) : errorMessage ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="alert-circle-outline" size={48} color="#bbb" style={{ marginBottom: 8 }} />
              <Text style={styles.empty}>{errorMessage}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={loadInitialAgents}>
                <Text style={styles.retryButtonText}>{i18n.t('retry') || 'Retry'}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.emptyWrap}>
              <Ionicons name="alert-circle-outline" size={48} color="#bbb" style={{ marginBottom: 8 }} />
              <Text style={styles.empty}>{i18n.t('noResults')}</Text>
            </View>
          )
        }
        ListFooterComponent={
          loading || results.length === 0 ? null : (
            <View style={styles.footerWrap}>
              {loadingMore ? (
                <Text style={styles.footerInfoText}>{i18n.t('loading') || 'Loading...'}</Text>
              ) : hasMore ? (
                <TouchableOpacity style={styles.loadMoreButton} onPress={loadMoreAgents}>
                  <Text style={styles.loadMoreButtonText}>{i18n.t('loadMore') || 'Load more'}</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.footerInfoText}>{i18n.t('noMoreResults') || 'No more results'}</Text>
              )}
            </View>
          )
        }
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 40, backgroundColor: '#000', paddingTop: 8, paddingHorizontal: 16 }}
        style={{ marginTop: 0 }}
      />
      {/* Agent detail modal — rendered once at root level, not inside renderItem */}
      <Modal
        visible={!!modalAgent}
        animationType="slide"
        transparent
        onRequestClose={() => setModalAgent(null)}
      >
        <View style={styles.modalOverlay}>
          {modalAgent && (
            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              {/* Photo */}
              <View style={styles.modalPhotoWrap}>
                {modalAgent.profilePic ? (
                  <Image source={{ uri: modalAgent.profilePic }} style={styles.modalPhoto} />
                ) : (
                  <View style={styles.modalPhotoPlaceholder}>
                    <Ionicons name="person" size={40} color="#999" />
                  </View>
                )}
              </View>
              <Text style={styles.modalName}>{modalAgent.name}</Text>
              {!!modalAgent.city && (
                <View style={styles.modalLocationRow}>
                  <Ionicons name="location" size={13} color="#888" />
                  <Text style={styles.modalCity}>{cityLabels[modalAgent.city] || modalAgent.city}</Text>
                </View>
              )}
              {!!modalAgent.description && (
                <Text style={styles.modalDesc}>{modalAgent.description}</Text>
              )}
              <Text style={styles.modalTextsLeft}>
                {i18n.t('remainingTexts', { count: remainingTexts }) || `${remainingTexts} contacts remaining this month`}
              </Text>
              <TouchableOpacity
                style={styles.modalPrimaryBtn}
                activeOpacity={0.85}
                onPress={async () => {
                  if (modalAgent.isSuspended) {
                    Alert.alert(
                      i18n.t('suspendedBadge') || 'Suspended',
                      i18n.t('suspendedUserUnavailable') || 'This profile is suspended and unavailable right now.'
                    );
                    return;
                  }
                  if (remainingTexts > 0) {
                    const newCount = remainingTexts - 1;
                    try {
                      const now = new Date();
                      await AsyncStorage.setItem(`remainingAgentTexts_${now.getFullYear()}_${now.getMonth()}`, String(newCount));
                    } catch {}
                    setRemainingTexts(newCount);
                    setModalAgent(null);
                    router.push({ pathname: '/agent-details', params: { id: modalAgent.id } });
                  } else {
                    Alert.alert(
                      i18n.t('paywallTitle') || 'Out of contacts',
                      i18n.t('paywallMsg') || 'You have used your free contacts for this month.'
                    );
                  }
                }}
              >
                <Ionicons name="person" size={18} color="#000" style={{ marginRight: 8 }} />
                <Text style={styles.modalPrimaryBtnText}>{i18n.t('viewProfile') || 'View Profile'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalCloseBtn} activeOpacity={0.8} onPress={() => setModalAgent(null)}>
                <Text style={styles.modalCloseBtnText}>{i18n.t('cancel') || 'Close'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>
      {/* Fixed Forsa Logo */}
      <Image source={require('../assets/forsa-logo.png')} style={styles.forsaLogo} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', padding: 0 },
  headerContainer: {
    backgroundColor: '#000',
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    paddingTop: 60,
    paddingBottom: 32,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 0,
    zIndex: 10,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  menuButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    zIndex: 100,
  },
  menuButtonInner: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#000',
  },
  menuLine: {
    width: 28,
    height: 4,
    backgroundColor: '#000',
    marginVertical: 3,
    borderRadius: 2,
  },
  titleContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -44,
    paddingHorizontal: 44,
  },
  titleText: {
    color: '#fff',
    fontSize: 32,
    fontWeight: 'bold',
    letterSpacing: 1,
    textAlign: 'center',
  },
  headerWrap: {
    backgroundColor: '#222',
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    paddingTop: 24,
    paddingBottom: 10,
    paddingHorizontal: 0,
    width: '100%',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
    zIndex: 10,
  },
  hamburgerBox: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#000',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
    marginTop: 8,
    flexDirection: 'column', // ensure vertical stacking
  },
  line: {
    width: 28,
    height: 4,
    backgroundColor: '#000',
    marginVertical: 3,
    borderRadius: 2,
    alignSelf: 'center', // ensure lines are centered
  },
  filtersContainer: {
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
    marginHorizontal: 16,
    marginTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    alignSelf: 'stretch',
  },
  filterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  filterHeaderText: {
    fontWeight: 'bold',
    fontSize: 18,
    color: '#000',
  },
  filterDropdown: {
    backgroundColor: '#f8f8f8',
    borderRadius: 16,
    marginTop: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    width: '100%',
  },
  filterSection: {
    marginBottom: 16,
  },
  filterLabel: {
    fontWeight: '600',
    fontSize: 15,
    color: '#333',
    marginBottom: 10,
  },
  pickerContainer: {
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    overflow: 'hidden',
  },
  favoriteToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  favoriteToggleText: {
    fontSize: 15,
    color: '#333',
    fontWeight: '500',
  },
  filterActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  filterRowSingle: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 6,
  },
  searchInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f4f4f4',
    borderRadius: 28,
    paddingHorizontal: 10,
    minHeight: 44,
    marginRight: 0,
    marginBottom: 8,
    width: '100%',
  },
  pillInput: {
    flex: 1,
    borderRadius: 28,
    backgroundColor: 'transparent',
    paddingVertical: 10,
    paddingHorizontal: 0,
    fontSize: 16,
    color: '#000',
    borderWidth: 0,
    marginBottom: 0,
    marginTop: 0,
    marginHorizontal: 0,
    textAlign: 'left',
  },
  searchBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    flexDirection: 'row',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  searchBtnPrimary: {
    backgroundColor: '#000',
  },
  searchBtnSecondary: {
    backgroundColor: '#e74c3c',
  },
  searchBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  emptyWrap: {
    alignItems: 'center',
    marginTop: 40,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#111',
    borderRadius: 18,
    padding: 18,
    marginBottom: 14,
    shadowColor: '#fff',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    position: 'relative',
  },
  cardSuspended: {
    borderColor: '#fecaca',
    opacity: 0.86,
  },
  cardBadgeWrap: {
    marginTop: 8,
  },
  favBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 2,
    padding: 6,
  },
  cardAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginRight: 14,
    backgroundColor: '#333',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  cardAvatarPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginRight: 14,
    backgroundColor: '#222',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  cardTitle: { fontWeight: '700', fontSize: 17, color: '#fff', marginBottom: 0 },
  cardCity: { color: 'rgba(255,255,255,0.55)', fontSize: 13, marginLeft: 4 },
  cardDesc: { color: 'rgba(255,255,255,0.65)', fontSize: 14, marginTop: 10, lineHeight: 19 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 5 },
  cardFooterText: { color: 'rgba(255,255,255,0.3)', fontSize: 12 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 28,
    paddingBottom: 40,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 14,
  },
  modalHandle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e0e0e0',
    marginBottom: 20,
  },
  modalPhotoWrap: {
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  modalPhoto: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#f0f0f0',
    borderWidth: 3,
    borderColor: '#000',
  },
  modalPhotoPlaceholder: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#e0e0e0',
  },
  modalName: { fontSize: 22, fontWeight: '800', color: '#000', textAlign: 'center', marginBottom: 4 },
  modalLocationRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  modalCity: { fontSize: 14, color: '#888', marginLeft: 3 },
  modalDesc: { fontSize: 14, color: '#555', textAlign: 'center', lineHeight: 20, marginBottom: 14, paddingHorizontal: 8 },
  modalTextsLeft: { fontSize: 13, color: '#999', marginBottom: 18, textAlign: 'center' },
  modalPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 32,
    width: '100%',
    marginBottom: 10,
  },
  modalPrimaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  modalCloseBtn: {
    width: '100%',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  modalCloseBtnText: { color: '#555', fontWeight: '600', fontSize: 15 },
  empty: { color: '#888', textAlign: 'center', marginTop: 40 },
  retryButton: {
    marginTop: 14,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryButtonText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 14,
  },
  footerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  loadMoreButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  loadMoreButtonText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 14,
  },
  footerInfoText: {
    color: '#bbb',
    fontSize: 12,
  },
  forsaLogo: {
    position: 'absolute',
    bottom: 18,
    left: '50%',
    transform: [{ translateX: -24 }],
    width: 48,
    height: 48,
    opacity: 0.22,
    tintColor: '#000',
    zIndex: 1,
  },
});
