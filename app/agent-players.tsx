import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Video, ResizeMode } from 'expo-av';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, FlatList, Image, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, Alert } from 'react-native';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import SimpleSelect from '../components/SimpleSelect';
import i18n from '../locales/i18n';
import { db, auth } from '../lib/firebase';
import { startConversationWithUser } from '../services/BookingMessagingService';
import { fetchAgentPlayersPage, type AgentPlayer } from '../services/AgentDataService';
import { collection, onSnapshot, type QueryDocumentSnapshot, type DocumentData } from 'firebase/firestore';
import FootballLoader from '../components/FootballLoader';
import { toggleFollow } from '../services/FollowService';

// Define the Player type for type safety
type Player = AgentPlayer;

const positions = ['GK', 'RB', 'LB', 'CB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST'];
const cityLabels = i18n.t('cities', { returnObjects: true }) as Record<string, string>;
const cityKeys = Object.keys(cityLabels);
const cityAliases: Record<string, string> = {
  asyut: 'assiut',
  faiyum: 'fayoum',
};

const normalizeCityKey = (value?: string) => (value || '').toString().replace(/\s+/g, '').toLowerCase();
const canonicalCityKeys = Object.entries(cityLabels).reduce<Record<string, string>>((acc, [key, label]) => {
  acc[normalizeCityKey(key)] = key;
  acc[normalizeCityKey(String(label))] = key;
  return acc;
}, {
  asyut: 'assiut',
  faiyum: 'fayoum',
});

const getCanonicalCityKey = (value?: string) => {
  const normalizedValue = normalizeCityKey(value);
  if (!normalizedValue) return '';
  return canonicalCityKeys[normalizedValue] || cityAliases[normalizedValue] || value || '';
};

function getAge(dob?: string): number | null {
  if (!dob) return null;
  const parts = dob.split('-');
  if (parts.length !== 3) return null;

  // Support both ISO (yyyy-mm-dd) and legacy dd-mm-yyyy formats
  const year = parts[0].length === 4
    ? parseInt(parts[0], 10)   // ISO: yyyy-mm-dd
    : parseInt(parts[2], 10);  // legacy: dd-mm-yyyy

  if (isNaN(year) || year < 1900 || year > new Date().getFullYear()) return null;
  return new Date().getFullYear() - year;
}

const getPositionLabel = (pos: string) => i18n.locale === 'ar' && i18n.t(`positions.${pos}`) ? i18n.t(`positions.${pos}`) : pos;
const getCityLabel = (cityKey: string) => {
  const canonicalCityKey = getCanonicalCityKey(cityKey);
  return canonicalCityKey ? (cityLabels[canonicalCityKey] || cityKey) : '';
};

export default function AgentPlayersScreen() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [filters, setFilters] = useState<{ [key: string]: string }>({});
  const [showPosition, setShowPosition] = useState(false);
  const [showCity, setShowCity] = useState(false);
  const [showAge, setShowAge] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [followStates, setFollowStates] = useState<Record<string, boolean>>({});
  const favoriteAnims = useRef(new Map<string, Animated.Value>()).current;
  const followAnims = useRef(new Map<string, Animated.Value>()).current;
  const { openMenu } = useHamburgerMenu();
  const router = useRouter();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const currentUid = auth.currentUser?.uid || '';

  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  useEffect(() => {
    loadInitialPlayers();
    AsyncStorage.getItem('agentPlayerFavorites').then(stored => {
      if (stored) setFavorites(JSON.parse(stored));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!currentUid) {
      setFollowStates({});
      return;
    }

    return onSnapshot(
      collection(db, `users/${currentUid}/following`),
      (snap) => {
        const next: Record<string, boolean> = {};
        snap.docs.forEach((docSnap) => {
          next[docSnap.id] = true;
        });
        setFollowStates(next);
      },
      () => setFollowStates({})
    );
  }, [currentUid]);

  const getFavAnim = (id: string) => {
    if (!favoriteAnims.has(id)) favoriteAnims.set(id, new Animated.Value(1));
    return favoriteAnims.get(id)!;
  };

  const getFollowAnim = (id: string) => {
    if (!followAnims.has(id)) followAnims.set(id, new Animated.Value(1));
    return followAnims.get(id)!;
  };

  const toggleFavorite = async (id: string) => {
    const next = favorites.includes(id) ? favorites.filter(f => f !== id) : [...favorites, id];
    setFavorites(next);
    await AsyncStorage.setItem('agentPlayerFavorites', JSON.stringify(next)).catch(() => {});
    const anim = getFavAnim(id);
    Animated.sequence([
      Animated.timing(anim, { toValue: 1.4, duration: 120, useNativeDriver: true }),
      Animated.timing(anim, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();
  };

  const handleToggleFollow = async (player: Player) => {
    const displayName = `${player.firstName || ''} ${player.lastName || ''}`.trim() || 'Player';
    const currentState = !!followStates[player.id];

    setFollowStates((prev) => ({ ...prev, [player.id]: !currentState }));

    if (!currentState) {
      const anim = getFollowAnim(player.id);
      Animated.sequence([
        Animated.timing(anim, { toValue: 1.12, duration: 120, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 1, duration: 120, useNativeDriver: true }),
      ]).start();
    }

    try {
      const isFollowingNow = await toggleFollow(player.id, 'player', displayName, player.profilePhoto || '');
      setFollowStates((prev) => ({ ...prev, [player.id]: isFollowingNow }));
    } catch (error) {
      setFollowStates((prev) => ({ ...prev, [player.id]: currentState }));
      console.error('Agent players follow toggle failed:', error);
    }
  };

  const loadInitialPlayers = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const page = await fetchAgentPlayersPage({ pageSize: 20, cursor: null });
      setPlayers(page.items);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch (e: any) {
      console.error('Error fetching players:', e);
      setPlayers([]);
      setHasMore(false);
      setErrorMessage(i18n.t('failedToLoadPlayers') || 'Failed to load players. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const loadMorePlayers = async () => {
    if (!hasMore || loadingMore || loading) return;
    setLoadingMore(true);
    setErrorMessage(null);
    try {
      const page = await fetchAgentPlayersPage({ pageSize: 20, cursor });
      setPlayers((prev) => [...prev, ...page.items]);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch (e: any) {
      console.error('Error loading more players:', e);
      setErrorMessage(i18n.t('failedToLoadMorePlayers') || 'Failed to load more players.');
    } finally {
      setLoadingMore(false);
    }
  };

  // Filter logic - no dummy player
  const filteredPlayers = players.filter(p => {
    if (favoritesOnly && !favorites.includes(p.id)) return false;
    if (filters.firstName && !(`${p.firstName}`.toLowerCase().includes(filters.firstName.toLowerCase()))) return false;
    if (filters.lastName && !(`${p.lastName}`.toLowerCase().includes(filters.lastName.toLowerCase()))) return false;
    if (filters.position && p.position !== filters.position) return false;
    if (filters.city && getCanonicalCityKey(p.city) !== getCanonicalCityKey(filters.city)) return false;
    if (filters.age && getAge(p.dob) !== Number(filters.age)) return false;
    return true;
  });

  const activeFilterCount = Object.values(filters).filter(Boolean).length + (favoritesOnly ? 1 : 0);

  const clearAllFilters = () => {
    setFilters({});
    setFavoritesOnly(false);
  };

  // Age options (10-30)
  const ageOptions = Array.from({ length: 21 }, (_, i) => (i + 10).toString());

  // Card press handler
  const handleCardPress = (player: Player) => {
    setSelectedPlayer(player);
    setShowProfile(true);
  };

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
              <Text style={styles.headerTitle}>{i18n.t('agentPlayers') || 'Players'}</Text>
              <Text style={styles.headerSubtitle}>{i18n.t('findPlayers') || 'Find and connect with players'}</Text>
            </View>
          </View>

          <HamburgerMenu />
          {/* Player List */}
          <FlatList
            data={filteredPlayers}
            keyExtractor={item => item.id}
            ListHeaderComponent={
              <View style={styles.filterBox}>
                <TouchableOpacity style={styles.filterHeaderRow} activeOpacity={0.8} onPress={() => setShowFilters(v => !v)}>
                  <View style={styles.filterHeaderLeft}>
                    <View style={styles.filterHeaderIconWrap}>
                      <Ionicons name="options-outline" size={18} color="#111" />
                    </View>
                    <View style={styles.filterHeaderTextWrap}>
                      <Text style={styles.filterTitle}>{i18n.t('filterPlayers') || 'Filter Players'}</Text>
                      <Text style={styles.filterSummaryText}>
                        {activeFilterCount > 0
                          ? `${activeFilterCount} ${(i18n.t('filters') || 'filters').toLowerCase()} active`
                          : (i18n.t('smartFiltersLabel') || 'Smart filters')}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.filterHeaderRight}>
                    {activeFilterCount > 0 && (
                      <View style={styles.filterCountBadge}>
                        <Text style={styles.filterCountText}>{activeFilterCount}</Text>
                      </View>
                    )}
                    <Ionicons name={showFilters ? 'chevron-up' : 'chevron-down'} size={22} color="#444" />
                  </View>
                </TouchableOpacity>

                {showFilters && (
                  <>
                    <View style={styles.quickActionsRow}>
                      <TouchableOpacity
                        style={[styles.favoriteOnlyToggle, favoritesOnly && styles.favoriteOnlyToggleActive]}
                        onPress={() => setFavoritesOnly(v => !v)}
                        activeOpacity={0.85}
                      >
                        <Ionicons name={favoritesOnly ? 'star' : 'star-outline'} size={15} color={favoritesOnly ? '#111' : '#666'} />
                        <Text style={[styles.favoriteOnlyText, favoritesOnly && styles.favoriteOnlyTextActive]}>
                          {i18n.t('showFavoritesOnly') || 'Show Favourites Only'}
                        </Text>
                      </TouchableOpacity>

                      {activeFilterCount > 0 && (
                        <TouchableOpacity style={styles.clearFiltersButton} onPress={clearAllFilters} activeOpacity={0.8}>
                          <Text style={styles.clearFiltersText}>{i18n.t('clearFilters') || 'Clear Filters'}</Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    <View style={styles.filterRow}>
                      <View style={styles.filterInputWrapper}>
                        <Ionicons name="person-outline" size={20} color="#999" style={styles.filterIcon} />
                        <TextInput
                          style={styles.filterInput}
                          placeholder={i18n.t('firstName') || 'First Name'}
                          value={filters.firstName || ''}
                          onChangeText={val => setFilters(f => ({ ...f, firstName: val }))}
                          placeholderTextColor="#999"
                        />
                      </View>
                    </View>
                    <View style={styles.filterRow}>
                      <View style={styles.filterInputWrapper}>
                        <Ionicons name="person-outline" size={20} color="#999" style={styles.filterIcon} />
                        <TextInput
                          style={styles.filterInput}
                          placeholder={i18n.t('lastName') || 'Last Name'}
                          value={filters.lastName || ''}
                          onChangeText={val => setFilters(f => ({ ...f, lastName: val }))}
                          placeholderTextColor="#999"
                        />
                      </View>
                    </View>
                    <View style={styles.filterRow}>
                      <TouchableOpacity style={styles.filterInputWrapper} onPress={() => setShowPosition(true)}>
                        <Ionicons name="football-outline" size={20} color="#999" style={styles.filterIcon} />
                        <Text style={[styles.filterText, !filters.position && styles.filterPlaceholder]}>
                          {filters.position ? getPositionLabel(filters.position) : i18n.t('position') || 'Position'}
                        </Text>
                        <Ionicons name="chevron-down" size={20} color="#999" />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.filterRow}>
                      <TouchableOpacity style={styles.filterInputWrapper} onPress={() => setShowCity(true)}>
                        <Ionicons name="location-outline" size={20} color="#999" style={styles.filterIcon} />
                        <Text style={[styles.filterText, !filters.city && styles.filterPlaceholder]}>
                          {filters.city ? getCityLabel(filters.city) : i18n.t('city') || 'City'}
                        </Text>
                        <Ionicons name="chevron-down" size={20} color="#999" />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.filterRow}>
                      <TouchableOpacity style={styles.filterInputWrapper} onPress={() => setShowAge(true)}>
                        <Ionicons name="calendar-outline" size={20} color="#999" style={styles.filterIcon} />
                        <Text style={[styles.filterText, !filters.age && styles.filterPlaceholder]}>
                          {filters.age || i18n.t('age') || 'Age'}
                        </Text>
                        <Ionicons name="chevron-down" size={20} color="#999" />
                      </TouchableOpacity>
                    </View>
                  </>
                )}
                <SimpleSelect
                  visible={showPosition}
                  options={positions}
                  selected={filters.position || ''}
                  onSelect={val => setFilters(f => ({ ...f, position: val }))}
                  onClose={() => setShowPosition(false)}
                  label={i18n.t('position') || 'Position'}
                  getLabel={getPositionLabel}
                />
                <SimpleSelect
                  visible={showCity}
                  options={cityKeys}
                  selected={filters.city || ''}
                  onSelect={val => setFilters(f => ({ ...f, city: val }))}
                  onClose={() => setShowCity(false)}
                  label={i18n.t('city') || 'City'}
                  getLabel={getCityLabel}
                />
                <SimpleSelect
                  visible={showAge}
                  options={ageOptions}
                  selected={filters.age || ''}
                  onSelect={val => setFilters(f => ({ ...f, age: val }))}
                  onClose={() => setShowAge(false)}
                  label={i18n.t('age') || 'Age'}
                />
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity onPress={() => handleCardPress(item)} activeOpacity={0.9}>
                <View style={styles.playerCard}>
                  {/* Dark header strip */}
                  <View style={styles.cardStrip}>
                    {item.profilePhoto ? (
                      <Image source={{ uri: item.profilePhoto }} style={styles.stripPhoto} />
                    ) : (
                      <View style={styles.stripPhotoPlaceholder}>
                        <Ionicons name="person" size={24} color="rgba(255,255,255,0.45)" />
                      </View>
                    )}
                    <View style={styles.stripInfo}>
                      <Text style={styles.stripName} numberOfLines={1}>{item.firstName} {item.lastName}</Text>
                      {!!item.city && (
                        <View style={styles.stripLocationRow}>
                          <Ionicons name="location" size={12} color="rgba(255,255,255,0.5)" />
                          <Text style={styles.stripCity} numberOfLines={1}>{getCityLabel(item.city)}</Text>
                        </View>
                      )}
                    </View>
                    <TouchableOpacity
                      style={styles.favoriteButton}
                      onPress={(e) => { e.stopPropagation(); toggleFavorite(item.id); }}
                      hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                    >
                      <Animated.Text style={{ fontSize: 22, color: favorites.includes(item.id) ? '#FFD700' : 'rgba(255,255,255,0.3)', transform: [{ scale: getFavAnim(item.id) }] }}>
                        ★
                      </Animated.Text>
                    </TouchableOpacity>
                  </View>
                  {/* Card body */}
                  <View style={styles.cardBodyContent}>
                    <View style={styles.badgeRow}>
                      {!!item.position && (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{getPositionLabel(item.position)}</Text>
                        </View>
                      )}
                      {getAge(item.dob) !== null && (
                        <View style={[styles.badge, styles.badgeAlt]}>
                          <Text style={[styles.badgeText, styles.badgeTextAlt]}>{getAge(item.dob)} {i18n.t('yrs') || 'yrs'}</Text>
                        </View>
                      )}
                      {!!item.pinnedVideo && (
                        <View style={[styles.badge, styles.badgeVideo]}>
                          <Ionicons name="videocam" size={11} color="#0f766e" />
                          <Text style={[styles.badgeText, styles.badgeVideoText]}>{i18n.t('pinnedVideo') || 'Video'}</Text>
                        </View>
                      )}
                    </View>
                    <Animated.View style={[styles.followActionRow, { transform: [{ scale: getFollowAnim(item.id) }] }]}>
                      <TouchableOpacity
                        style={[styles.followButton, followStates[item.id] && styles.followButtonActive]}
                        onPress={() => handleToggleFollow(item)}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.followButtonText, followStates[item.id] && styles.followButtonTextActive]}>
                          {followStates[item.id] ? (i18n.t('following') || 'Following') : (i18n.t('follow') || 'Follow')}
                        </Text>
                      </TouchableOpacity>
                    </Animated.View>
                    {item.pinnedVideo && (
                      <View style={styles.videoSection}>
                        <VideoWithNaturalSize uri={item.pinnedVideo} />
                      </View>
                    )}
                    <View style={styles.cardFooterRow}>
                      <Text style={styles.cardFooterHint}>{i18n.t('tapToViewProfile') || 'Tap to view profile'}</Text>
                      <Ionicons name="chevron-forward" size={14} color="#ccc" />
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              loading ? (
                <View style={styles.emptyState}>
                  <FootballLoader size="large" color="#fff" />
                  <Text style={styles.emptyText}>{i18n.t('loading') || 'Loading...'}</Text>
                </View>
              ) : errorMessage ? (
                <View style={styles.emptyState}>
                  <Ionicons name="alert-circle-outline" size={52} color="#fff" />
                  <Text style={styles.emptyText}>{errorMessage}</Text>
                  <TouchableOpacity style={styles.retryButton} onPress={loadInitialPlayers}>
                    <Text style={styles.retryButtonText}>{i18n.t('retry') || 'Retry'}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.emptyState}>
                  <Ionicons name="people-outline" size={64} color="#666" />
                  <Text style={styles.emptyText}>{i18n.t('noPlayersFound') || 'No players found.'}</Text>
                </View>
              )
            }
            ListFooterComponent={
              loading || filteredPlayers.length === 0 ? null : (
                <View style={styles.footerLoaderWrap}>
                  {loadingMore ? (
                    <FootballLoader size="small" color="#fff" />
                  ) : hasMore ? (
                    <TouchableOpacity style={styles.loadMoreButton} onPress={loadMorePlayers}>
                      <Text style={styles.loadMoreButtonText}>{i18n.t('loadMore') || 'Load more'}</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.footerDoneText}>{i18n.t('noMoreResults') || 'No more results'}</Text>
                  )}
                </View>
              )
            }
            contentContainerStyle={styles.listContent}
          />
          {/* Player profile modal */}
          <Modal
            visible={showProfile && !!selectedPlayer}
            transparent
            animationType="slide"
            onRequestClose={() => setShowProfile(false)}
          >
            <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowProfile(false)}>
              {selectedPlayer && (
                <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
                <View style={styles.modalContent}>
                  <View style={styles.modalHandle} />
                  {/* Photo */}
                  <View style={styles.modalPhotoWrap}>
                    {selectedPlayer.profilePhoto ? (
                      <Image source={{ uri: selectedPlayer.profilePhoto }} style={styles.modalPhoto} />
                    ) : (
                      <View style={styles.modalPhotoPlaceholder}>
                        <Ionicons name="person" size={40} color="#999" />
                      </View>
                    )}
                  </View>
                  <Text style={styles.modalTitle}>{selectedPlayer.firstName} {selectedPlayer.lastName}</Text>
                  <View style={styles.modalBadgeRow}>
                    {!!selectedPlayer.position && (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{getPositionLabel(selectedPlayer.position)}</Text>
                      </View>
                    )}
                    {getAge(selectedPlayer.dob) !== null && (
                      <View style={[styles.badge, styles.badgeAlt]}>
                        <Text style={[styles.badgeText, styles.badgeTextAlt]}>{getAge(selectedPlayer.dob)} {i18n.t('yrs') || 'yrs'}</Text>
                      </View>
                    )}
                  </View>
                  {!!selectedPlayer.city && (
                    <View style={styles.modalLocationRow}>
                      <Ionicons name="location" size={13} color="#888" />
                      <Text style={styles.modalCityText}>{getCityLabel(selectedPlayer.city)}</Text>
                    </View>
                  )}
                  <View style={styles.modalActions}>
                    <TouchableOpacity style={[styles.modalBtn, styles.modalBtnPrimary]} onPress={() => {
                      setShowProfile(false);
                      const name = `${selectedPlayer.firstName || ''} ${selectedPlayer.lastName || ''}`.trim();
                      router.push({ pathname: '/agent-user-posts', params: { ownerId: selectedPlayer.id, ownerRole: 'player', userName: name } });
                    }}>
                      <Ionicons name="newspaper-outline" size={17} color="#fff" style={{ marginRight: 7 }} />
                      <Text style={styles.modalBtnText}>{i18n.t('viewProfile') || 'View Posts'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modalBtn, styles.modalBtnPrimary]}
                      onPress={async () => {
                        try {
                          setShowProfile(false);
                          const conversationId = await startConversationWithUser(selectedPlayer.id);
                          const name = `${selectedPlayer.firstName} ${selectedPlayer.lastName}`.trim();
                          router.push({ pathname: '/agent-messages', params: { conversationId, otherUserId: selectedPlayer.id, name } });
                        } catch (error: any) {
                          Alert.alert(i18n.t('error') || 'Error', error.message || (i18n.t('failedToStartConversation') || 'Failed to start conversation'));
                        }
                      }}
                    >
                      <Ionicons name="chatbubble-ellipses" size={17} color="#fff" style={{ marginRight: 7 }} />
                      <Text style={styles.modalBtnText}>{i18n.t('message') || 'Message'}</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity style={[styles.modalBtn, styles.modalBtnClose]} onPress={() => setShowProfile(false)}>
                    <Text style={styles.modalBtnCloseText}>{i18n.t('close') || 'Close'}</Text>
                  </TouchableOpacity>
                </View>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </Modal>
        </Animated.View>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}

// Helper component for natural video size
function VideoWithNaturalSize({ uri }: { uri: string }) {
  const [aspectRatio, setAspectRatio] = React.useState(16 / 9);
  return (
    <Video
      source={{ uri }}
      style={{ width: 320, maxWidth: 400, aspectRatio, borderRadius: 10, backgroundColor: '#222' }}
      resizeMode={ResizeMode.CONTAIN}
      useNativeControls={true}
      shouldPlay={false}
      isLooping={false}
      onLoad={(status: any) => {
        if (status.isLoaded && status.naturalSize?.width && status.naturalSize?.height) {
          const ns = status.naturalSize;
          setAspectRatio(ns.width / ns.height);
        }
      }}
    />
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
    marginLeft: -44, // Negative margin to center title while keeping menu button on left
    paddingHorizontal: 44, // Add padding to ensure title doesn't overlap with menu button
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
  listContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  filterBox: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 16,
    marginHorizontal: 24,
    marginBottom: 16,
    marginTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 5,
  },
  filterTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#000',
    marginBottom: 2,
  },
  filterHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  filterHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  filterHeaderIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  filterHeaderTextWrap: {
    flex: 1,
  },
  filterSummaryText: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '600',
  },
  filterHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 12,
  },
  filterCountBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#111',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 7,
  },
  filterCountText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  quickActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 14,
    marginBottom: 10,
  },
  favoriteOnlyToggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fafafa',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  favoriteOnlyToggleActive: {
    backgroundColor: '#fde68a',
    borderColor: '#facc15',
  },
  favoriteOnlyText: {
    flex: 1,
    color: '#444',
    fontSize: 13,
    fontWeight: '700',
  },
  favoriteOnlyTextActive: {
    color: '#111',
  },
  clearFiltersButton: {
    borderRadius: 12,
    backgroundColor: '#111',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  clearFiltersText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
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
  playerCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 6,
    overflow: 'hidden',
  },
  cardStrip: {
    backgroundColor: '#111',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  stripPhoto: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  stripPhotoPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stripInfo: {
    flex: 1,
    minWidth: 0,
  },
  stripName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 3,
  },
  stripLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  stripCity: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    flexShrink: 1,
  },
  favoriteButton: {
    padding: 4,
  },
  cardBodyContent: {
    padding: 14,
    gap: 10,
  },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  followActionRow: {
    alignItems: 'flex-start',
  },
  followButton: {
    minWidth: 88,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  followButtonActive: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#10b981',
  },
  followButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
  followButtonTextActive: {
    color: '#065f46',
  },
  badge: {
    backgroundColor: '#000',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 12, color: '#fff', fontWeight: '600' },
  badgeAlt: { backgroundColor: '#f0f0f0' },
  badgeTextAlt: { color: '#333' },
  badgeVideo: { backgroundColor: '#f0fdf4', flexDirection: 'row', alignItems: 'center', gap: 4 },
  badgeVideoText: { color: '#0f766e' },
  videoSection: { alignItems: 'center' },
  cardFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 3,
    borderTopWidth: 1,
    borderTopColor: '#f5f5f5',
    paddingTop: 8,
  },
  cardFooterHint: {
    fontSize: 12,
    color: '#ccc',
    fontWeight: '500',
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
  retryButton: {
    marginTop: 16,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryButtonText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '700',
  },
  footerLoaderWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  loadMoreButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  loadMoreButtonText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '700',
  },
  footerDoneText: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 28,
    paddingBottom: 40,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.15,
    shadowRadius: 18,
    elevation: 12,
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
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  modalPhoto: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#f0f0f0',
    borderWidth: 3,
    borderColor: '#000',
  },
  modalPhotoPlaceholder: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#e0e0e0',
  },
  modalTitle: { fontSize: 22, fontWeight: '800', color: '#000', textAlign: 'center', marginBottom: 10 },
  modalBadgeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  modalLocationRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  modalCityText: { fontSize: 14, color: '#888', marginLeft: 4 },
  modalActions: { flexDirection: 'row', gap: 10, width: '100%', marginBottom: 10 },
  modalBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    paddingVertical: 13,
  },
  modalBtnPrimary: { backgroundColor: '#000' },
  modalBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  modalBtnClose: { width: '100%', backgroundColor: '#f5f5f5', borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  modalBtnCloseText: { color: '#555', fontWeight: '600', fontSize: 14 },
  modalInfo: { marginBottom: 20 },
  modalInfoRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  modalLabel: { fontSize: 15, color: '#666' },
  modalValue: { fontSize: 17, color: '#000', fontWeight: '600' },
  modalButton: { backgroundColor: '#000', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
  modalButtonSecondary: { backgroundColor: '#f5f5f5' },
  modalButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  modalButtonTextSecondary: { color: '#666' },
});
