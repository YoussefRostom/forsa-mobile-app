import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import React, { useRef, useState, useEffect } from 'react';
import { ActivityIndicator, Animated, Easing, FlatList, Image, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import PostActionsMenu from '../components/PostActionsMenu';
import i18n from '../locales/i18n';
import { db, auth } from '../lib/firebase';
import { fetchUserProfileByRole } from '../services/AgentDataService';

function getAge(dob?: string): number | null {
  if (!dob) return null;
  const parts = dob.split('-');
  if (parts.length !== 3) return null;
  // Support ISO (yyyy-mm-dd) and legacy (dd-mm-yyyy)
  const year = parts[0].length === 4
    ? parseInt(parts[0], 10)
    : parseInt(parts[2], 10);
  if (isNaN(year) || year < 1900 || year > new Date().getFullYear()) return null;
  return new Date().getFullYear() - year;
}

const getPositionLabel = (pos: string) => i18n.locale === 'ar' && i18n.t(`positions.${pos}`) ? i18n.t(`positions.${pos}`) : pos;
const getCityLabel = (cityKey: string) => cityKey ? (i18n.t(`cities.${cityKey}`) || cityKey) : '';

export default function AgentUserPostsScreen() {
  const router = useRouter();
  const { openMenu } = useHamburgerMenu();
  const params = useLocalSearchParams<{ ownerId: string; ownerRole: string; userName: string }>();
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileData, setProfileData] = useState<any>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fullScreenMedia, setFullScreenMedia] = useState<{ uri: string; type: 'image' | 'video' } | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();
  }, []);

  useEffect(() => {
    setErrorMessage(null);

    if (!params.ownerId) {
      setLoading(false);
      setLoadingProfile(false);
      return;
    }

    // Check if user is authenticated before setting up listener
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      setLoadingProfile(false);
      setPosts([]);
      setProfileData(null);
      return;
    }

    // Fetch user profile data
    const fetchProfile = async () => {
      setLoadingProfile(true);
      try {
        // Check authentication again before fetching
        if (!auth.currentUser) {
          setProfileData(null);
          return;
        }
        const data = await fetchUserProfileByRole(params.ownerId, params.ownerRole || 'player');
        setProfileData(data);
      } catch (error) {
        // Only log error if user is still authenticated
        if (auth.currentUser) {
          console.error('Error fetching profile:', error);
        }
        setProfileData(null);
        setErrorMessage(i18n.t('failedToLoadProfile') || 'Failed to load profile. Please try again.');
      } finally {
        setLoadingProfile(false);
      }
    };
    fetchProfile();

    // Fetch posts
    setLoading(true);
    const postsRef = collection(db, 'posts');
    
    // Query posts by ownerId only (without status filter to avoid composite index requirement)
    // We'll filter by status client-side
    const q = query(
      postsRef,
      where('ownerId', '==', params.ownerId),
      orderBy('timestamp', 'desc')
    );

    // Set up real-time listener
    const unsubscribe = onSnapshot(
      q,
      (querySnapshot) => {
        // Check authentication before processing
        if (!auth.currentUser) {
          setPosts([]);
          setLoading(false);
          return;
        }
        
        const userPosts = querySnapshot.docs
          .map(doc => ({ 
            id: doc.id, 
            ...doc.data() 
          }))
          // Filter out deleted/inactive posts client-side
          .filter((post: any) => !post.status || post.status === 'active');
        setPosts(userPosts);
        setLoading(false);
      },
      (error) => {
        // Check if error is due to permissions (user logged out)
        if (error.code === 'permission-denied' || error.message?.includes('permission')) {
          // Silently handle permission errors (user likely logged out)
          setPosts([]);
          setLoading(false);
          return;
        }
        console.error('Error fetching user posts:', error);
        setPosts([]);
        setErrorMessage(i18n.t('failedToLoadPosts') || 'Failed to load posts. Please try again.');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [params.ownerId, params.ownerRole, refreshKey]);

  const handleRetry = () => {
    setRefreshKey((prev) => prev + 1);
  };

  const playerName = profileData?.firstName
    ? `${profileData.firstName} ${profileData.lastName || ''}`.trim()
    : (params.userName || 'Player');

  const mediaPosts = posts.filter((p: any) => !!p.mediaUrl);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient colors={['#000000', '#1a1a1a', '#2d2d2d']} style={styles.gradient}>
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>

          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.headerTitle} numberOfLines={1}>{playerName}</Text>
          </View>

          <HamburgerMenu />

          {(loading || loadingProfile) ? (
            <View style={styles.loadingState}>
              <ActivityIndicator size="large" color="#fff" />
              <Text style={styles.loadingText}>{i18n.t('loading') || 'Loading...'}</Text>
            </View>
          ) : (
            <FlatList
              data={posts}
              keyExtractor={(item: any) => item.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
              ListHeaderComponent={
                <>
                  {/* Player hero card */}
                  {params.ownerRole === 'player' && profileData && (
                    <View style={styles.heroCard}>
                      {/* Dark strip with photo */}
                      <View style={styles.heroStrip}>
                        {profileData.profilePhoto ? (
                          <Image source={{ uri: profileData.profilePhoto }} style={styles.heroPhoto} />
                        ) : (
                          <View style={styles.heroPhotoPlaceholder}>
                            <Ionicons name="person" size={44} color="rgba(255,255,255,0.4)" />
                          </View>
                        )}
                      </View>
                      {/* White body */}
                      <View style={styles.heroBody}>
                        <Text style={styles.heroName}>{profileData.firstName || ''} {profileData.lastName || ''}</Text>
                        <View style={styles.heroBadgeRow}>
                          {!!profileData.position && (
                            <View style={styles.heroBadge}>
                              <Text style={styles.heroBadgeText}>{getPositionLabel(profileData.position)}</Text>
                            </View>
                          )}
                          {getAge(profileData.dob) !== null && (
                            <View style={[styles.heroBadge, styles.heroBadgeAlt]}>
                              <Text style={[styles.heroBadgeText, styles.heroBadgeAltText]}>{getAge(profileData.dob)} {i18n.t('yrs') || 'yrs'}</Text>
                            </View>
                          )}
                        </View>
                        {!!profileData.city && (
                          <View style={styles.heroLocationRow}>
                            <Ionicons name="location" size={14} color="#888" />
                            <Text style={styles.heroCity}>{getCityLabel(profileData.city)}</Text>
                          </View>
                        )}
                        {!!profileData.description && (
                          <Text style={styles.heroBio} numberOfLines={3}>{profileData.description}</Text>
                        )}
                      </View>
                    </View>
                  )}

                  {/* Footage filmstrip */}
                  {mediaPosts.length > 0 && (
                    <View style={styles.footageSection}>
                      <View style={styles.footageTitleRow}>
                        <Ionicons name="videocam" size={15} color="rgba(255,255,255,0.8)" />
                        <Text style={styles.footageTitle}>{i18n.t('footage') || 'Footage'}</Text>
                        <View style={styles.footageCountBadge}>
                          <Text style={styles.footageCountText}>{mediaPosts.length}</Text>
                        </View>
                      </View>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.footageScroll}>
                        {mediaPosts.map((post: any) => (
                          <TouchableOpacity
                            key={`footage-${post.id}`}
                            style={styles.footageThumb}
                            onPress={() => setFullScreenMedia({ uri: post.mediaUrl, type: post.mediaType === 'video' ? 'video' : 'image' })}
                            activeOpacity={0.85}
                          >
                            {post.mediaType === 'video' ? (
                              <View style={styles.footageVideoPlaceholder}>
                                <Ionicons name="play-circle" size={38} color="rgba(255,255,255,0.9)" />
                                <View style={styles.footageVideoChip}>
                                  <Ionicons name="videocam" size={10} color="#fff" />
                                </View>
                              </View>
                            ) : (
                              <Image source={{ uri: post.mediaUrl }} style={styles.footageImage} />
                            )}
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}

                  {/* Posts section label */}
                  <View style={styles.sectionHeader}>
                    <Ionicons name="newspaper-outline" size={14} color="rgba(255,255,255,0.5)" />
                    <Text style={styles.sectionTitle}>{i18n.t('allPosts') || 'Posts'}</Text>
                    {posts.length > 0 && (
                      <View style={styles.footageCountBadge}>
                        <Text style={styles.footageCountText}>{posts.length}</Text>
                      </View>
                    )}
                  </View>
                </>
              }
              renderItem={({ item }: any) => {
                const timestamp = item.timestamp?.seconds
                  ? new Date(item.timestamp.seconds * 1000)
                  : item.createdAt?.seconds
                    ? new Date(item.createdAt.seconds * 1000)
                    : null;

                return (
                  <View style={styles.feedCard}>
                    {/* Date + actions row */}
                    <View style={styles.feedTopRow}>
                      {timestamp && (
                        <>
                          <Ionicons name="time-outline" size={12} color="#bbb" />
                          <Text style={styles.feedDate}>{timestamp.toLocaleDateString()}</Text>
                        </>
                      )}
                      <View style={{ flex: 1 }} />
                      <PostActionsMenu
                        postId={item.id}
                        postOwnerId={item.ownerId}
                        postOwnerRole={item.ownerRole}
                        mediaUrl={item.mediaUrl}
                        mediaType={item.mediaType}
                        contentText={item.content}
                        postTimestamp={item.timestamp || item.createdAt}
                      />
                    </View>

                    {/* Media */}
                    {item.mediaUrl && (
                      <View style={styles.mediaContainer}>
                        {item.mediaType === 'video' ? (
                          <Video
                            source={{ uri: item.mediaUrl }}
                            style={styles.mediaVideo}
                            useNativeControls
                            resizeMode={ResizeMode.CONTAIN}
                            isLooping={false}
                          />
                        ) : (
                          <Image
                            source={{ uri: item.mediaUrl }}
                            style={styles.mediaImage}
                            resizeMode="cover"
                          />
                        )}
                        <TouchableOpacity
                          style={styles.fullScreenButton}
                          onPress={() => setFullScreenMedia({ uri: item.mediaUrl, type: item.mediaType === 'video' ? 'video' : 'image' })}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="expand" size={20} color="#fff" />
                        </TouchableOpacity>
                      </View>
                    )}

                    {!!item.content && (
                      <Text style={styles.feedContent}>{item.content}</Text>
                    )}
                  </View>
                );
              }}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Ionicons name={errorMessage ? 'alert-circle-outline' : 'newspaper-outline'} size={64} color="#666" />
                  <Text style={styles.emptyText}>{errorMessage || (i18n.t('noPosts') || 'No posts yet')}</Text>
                  <Text style={styles.emptySubtext}>{errorMessage ? (i18n.t('tapToRetry') || 'Tap retry to try again.') : (i18n.t('userHasNoPosts') || 'This user has not posted anything yet')}</Text>
                  {!!errorMessage && (
                    <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
                      <Text style={styles.retryButtonText}>{i18n.t('retry') || 'Retry'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              }
            />
          )}
        </Animated.View>
      </LinearGradient>

      {/* Full Screen Media Viewer */}
      <Modal
        visible={!!fullScreenMedia}
        transparent={false}
        animationType="fade"
        onRequestClose={() => setFullScreenMedia(null)}
        statusBarTranslucent={true}
      >
        <TouchableOpacity
          style={styles.fullScreenContainer}
          activeOpacity={1}
          onPress={() => setFullScreenMedia(null)}
        >
          <TouchableOpacity
            style={styles.fullScreenCloseButton}
            onPress={() => setFullScreenMedia(null)}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={32} color="#fff" />
          </TouchableOpacity>
          {fullScreenMedia && (
            <View style={styles.fullScreenContent} pointerEvents="none">
              {fullScreenMedia.type === 'video' ? (
                <Video
                  source={{ uri: fullScreenMedia.uri }}
                  style={styles.fullScreenVideo}
                  useNativeControls
                  resizeMode={ResizeMode.CONTAIN}
                  isLooping={false}
                />
              ) : (
                <Image
                  source={{ uri: fullScreenMedia.uri }}
                  style={styles.fullScreenImage}
                  resizeMode="contain"
                />
              )}
            </View>
          )}
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  gradient: { flex: 1 },

  // Header
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 20,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
  },

  // List
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 50,
  },

  // Hero card
  heroCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    marginBottom: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 8,
  },
  heroStrip: {
    backgroundColor: '#111',
    alignItems: 'center',
    paddingTop: 28,
    paddingBottom: 36,
  },
  heroPhoto: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: '#333',
  },
  heroPhotoPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  heroBody: {
    padding: 20,
    marginTop: -20,
    alignItems: 'center',
  },
  heroName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#000',
    marginBottom: 10,
    textAlign: 'center',
  },
  heroBadgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  heroBadge: {
    backgroundColor: '#000',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  heroBadgeText: { fontSize: 13, color: '#fff', fontWeight: '700' },
  heroBadgeAlt: { backgroundColor: '#f0f0f0' },
  heroBadgeAltText: { color: '#333' },
  heroLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 8,
  },
  heroCity: { fontSize: 14, color: '#888' },
  heroBio: {
    fontSize: 14,
    color: '#555',
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 4,
  },

  // Footage filmstrip
  footageSection: {
    marginBottom: 16,
  },
  footageTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  footageTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.8)',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  footageCountBadge: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  footageCountText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '700',
  },
  footageScroll: {
    paddingRight: 8,
    gap: 10,
  },
  footageThumb: {
    width: 130,
    height: 130,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },
  footageImage: {
    width: '100%',
    height: '100%',
  },
  footageVideoPlaceholder: {
    flex: 1,
    backgroundColor: '#222',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footageVideoChip: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 8,
    padding: 4,
  },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.6)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Feed cards
  feedCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    marginBottom: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
  },
  feedTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  feedDate: {
    fontSize: 12,
    color: '#bbb',
  },
  feedContent: {
    fontSize: 14,
    color: '#333',
    lineHeight: 21,
    paddingHorizontal: 16,
    paddingBottom: 14,
    paddingTop: 6,
  },
  mediaContainer: {
    width: '100%',
    backgroundColor: '#000',
  },
  mediaImage: {
    width: '100%',
    height: 280,
    backgroundColor: '#000',
  },
  mediaVideo: {
    width: '100%',
    height: 280,
    backgroundColor: '#000',
  },
  fullScreenButton: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 18,
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },

  // Loading / empty
  loadingState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#fff', fontSize: 16, marginTop: 12 },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 18, fontWeight: '600', color: '#fff', marginTop: 16 },
  emptySubtext: { fontSize: 14, color: 'rgba(255,255,255,0.6)', marginTop: 8 },
  retryButton: { marginTop: 14, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  retryButtonText: { color: '#000', fontWeight: '700', fontSize: 14 },

  // Fullscreen viewer
  fullScreenContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenCloseButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 40,
    right: 20,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenContent: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenImage: { width: '100%', height: '100%' },
  fullScreenVideo: { width: '100%', height: '100%' },
});

