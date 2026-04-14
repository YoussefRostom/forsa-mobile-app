import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { collection, onSnapshot, getFirestore, orderBy, query, where } from 'firebase/firestore';
import React, { useRef } from 'react';
import { ActivityIndicator, Animated, Easing, FlatList, Image, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import PostActionsMenu from '../components/PostActionsMenu';
import ZoomableFeedMedia from '../components/feed/ZoomableFeedMedia';
import i18n from '../locales/i18n';
import { db, auth } from '../lib/firebase';
import { getUserDisplayName } from '../services/AgentDataService';

export default function AgentFeedScreen() {
  const router = useRouter();
  const { openMenu } = useHamburgerMenu();
  const [feed, setFeed] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [userNames, setUserNames] = React.useState<{ [key: string]: string }>({});
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [fullScreenMedia, setFullScreenMedia] = React.useState<{ uri: string; type: 'image' | 'video' } | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [agentPosts, setAgentPosts] = React.useState<any[]>([]);
  const [adminPosts, setAdminPosts] = React.useState<any[]>([]);

  // Merge agent posts and admin posts (deduplicate by post ID)
  React.useEffect(() => {
    const active = (p: any) => !p.status || p.status === 'active';
    const getTs = (p: any) => p.timestamp?.seconds ?? p.createdAt?.seconds ?? 0;
    
    // Combine both arrays and deduplicate by post ID
    const allPosts = [...agentPosts.filter(active), ...adminPosts.filter(active)];
    const uniquePostsMap = new Map<string, any>();
    
    // Use Map to ensure unique posts by ID (later posts override earlier ones)
    allPosts.forEach(post => {
      if (post.id) {
        uniquePostsMap.set(post.id, post);
      }
    });
    
    // Convert back to array and sort by timestamp
    const merged = Array.from(uniquePostsMap.values())
      .sort((a, b) => getTs(b) - getTs(a));
    setFeed(merged);
    
    // Fetch user names for merged posts
    const namePromises = merged.map(async (post: any) => {
      if (post.ownerId && post.ownerRole) {
        const name = await getUserDisplayName(post.ownerId, post.ownerRole);
        return { key: post.ownerId, name };
      }
      return null;
    });
    
    Promise.all(namePromises).then(nameResults => {
      const namesMap: { [key: string]: string } = {};
      nameResults.forEach(result => {
        if (result) {
          namesMap[result.key] = result.name;
        }
      });
      setUserNames(namesMap);
    });
  }, [agentPosts, adminPosts]);

  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();
  }, []);

  React.useEffect(() => {
    setLoading(true);
    setErrorMessage(null);

    // Check if user is authenticated before setting up listener
    const user = auth.currentUser;
    if (!user) {
      setFeed([]);
      setLoading(false);
      return;
    }
    
    const db = getFirestore();
    const postsRef = collection(db, 'posts');
    
    // Agent feed: Show posts where visibleToRoles array-contains "agent" AND status == "active"
    const q = query(
      postsRef,
      where('visibleToRoles', 'array-contains', 'agent'),
      where('status', '==', 'active'),
      orderBy('timestamp', 'desc')
    );

    // Admin posts query (visible to all users)
    // Query only by ownerRole to avoid composite index requirement
    // Filter by status and sort client-side
    const qAdmin = query(
      postsRef,
      where('ownerRole', '==', 'admin')
    );

    let fallbackUnsubscribe: (() => void) | null = null;

    // Set up real-time listener for agent posts
    const unsubscribe = onSnapshot(
      q,
      (querySnapshot) => {
        if (!auth.currentUser) {
          setAgentPosts([]);
          return;
        }
        
        const posts = querySnapshot.docs.map(doc => ({ 
          id: doc.id, 
          ...doc.data() 
        }));
        setAgentPosts(posts);
      },
      (error) => {
        // Check if user is still authenticated before attempting fallback
        if (!auth.currentUser) {
          setFeed([]);
          setLoading(false);
          return;
        }
        
        // Check if error is due to permissions (user logged out)
        if (error.code === 'permission-denied' || error.message?.includes('permission')) {
          console.error('Agent feed listener error (permission denied):', error);
          setFeed([]);
          setLoading(false);
          return;
        }
        
        console.error('Agent feed listener error:', error);
        // Fallback: try querying without status filter for backward compatibility
        const fallbackQ = query(
          postsRef,
          where('visibleToRoles', 'array-contains', 'agent'),
          orderBy('timestamp', 'desc')
        );
        
        fallbackUnsubscribe = onSnapshot(
          fallbackQ,
          async (snapshot) => {
            // Check authentication again before processing
            if (!auth.currentUser) {
              if (fallbackUnsubscribe) fallbackUnsubscribe();
              setFeed([]);
              setLoading(false);
              return;
            }
            
            const posts = snapshot.docs
              .map(doc => ({ id: doc.id, ...doc.data() }))
              .filter((post: any) => !post.status || post.status === 'active');
            setFeed(posts);
            
            // Fetch user names for all posts (only if authenticated)
            if (auth.currentUser) {
              const namePromises = posts.map(async (post: any) => {
                if (post.ownerId && post.ownerRole) {
                  try {
                    const name = await getUserDisplayName(post.ownerId, post.ownerRole);
                    return { key: post.ownerId, name };
                  } catch (err) {
                    // Silently handle errors when fetching user names
                    return null;
                  }
                }
                return null;
              });
              
              const nameResults = await Promise.all(namePromises);
              const namesMap: { [key: string]: string } = {};
              nameResults.forEach(result => {
                if (result) {
                  namesMap[result.key] = result.name;
                }
              });
              setUserNames(namesMap);
            }
            setLoading(false);
          },
          (fallbackError) => {
            // Check if error is due to permissions
            if (fallbackError.code === 'permission-denied' || fallbackError.message?.includes('permission')) {
              console.error('Agent feed fallback error (permission denied):', fallbackError);
            } else {
              console.error('Agent feed fallback error:', fallbackError);
            }
            setFeed([]);
            setErrorMessage(i18n.t('failedToLoadFeed') || 'Failed to load feed. Please try again.');
            setLoading(false);
          }
        );
      }
    );

    // Set up listener for admin posts
    const unsubscribeAdmin = onSnapshot(
      qAdmin,
      (querySnapshot) => {
        if (!auth.currentUser) {
          setAdminPosts([]);
          return;
        }
        
        // Filter by status and sort client-side to avoid composite index
        const posts = querySnapshot.docs
          .map(doc => ({ 
            id: doc.id, 
            ...doc.data() 
          }))
          .filter((post: any) => !post.status || post.status === 'active')
          .sort((a: any, b: any) => {
            const getTs = (p: any) => p.timestamp?.seconds ?? p.createdAt?.seconds ?? 0;
            return getTs(b) - getTs(a);
          });
        setAdminPosts(posts);
      },
      async (error) => {
        if (!auth.currentUser) {
          setAdminPosts([]);
          return;
        }
        
        if (error.code === 'permission-denied' || error.message?.includes('permission')) {
          setAdminPosts([]);
          return;
        }
        
        console.error('Agent feed (admin) error:', error?.message);
        setAdminPosts([]);
      }
    );

    // Stop loading after both queries have run
    const t = setTimeout(() => setLoading(false), 800);

    // Cleanup listeners on unmount
    return () => {
      unsubscribe();
      if (fallbackUnsubscribe) fallbackUnsubscribe();
      unsubscribeAdmin();
      clearTimeout(t);
    };
  }, [refreshKey]);

  const handleRetry = () => {
    setRefreshKey((prev) => prev + 1);
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
              <Text style={styles.headerTitle}>{i18n.t('agentFeed') || 'Feed'}</Text>
              <Text style={styles.headerSubtitle}>{i18n.t('latestUpdates') || 'Latest updates from players'}</Text>
            </View>
      </View>

      <HamburgerMenu />

      {loading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator size="large" color="#fff" />
              <Text style={styles.loadingText}>{i18n.t('loading') || 'Loading...'}</Text>
            </View>
      ) : (
        <FlatList
          data={feed}
              renderItem={({ item }: any) => {
                const timestamp = item.timestamp?.seconds 
                  ? new Date(item.timestamp.seconds * 1000) 
                  : item.createdAt?.seconds 
                    ? new Date(item.createdAt.seconds * 1000)
                    : null;

                const userName = userNames[item.ownerId] || item.author || 'User';
                const role = item.ownerRole || '';

                // Initials from display name
                const initials = userName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();

                // Role badge colour
                const roleBadgeColor: Record<string, { bg: string; text: string }> = {
                  player:  { bg: '#22c55e', text: '#fff' },
                  admin:   { bg: '#3b82f6', text: '#fff' },
                  academy: { bg: '#f97316', text: '#fff' },
                  clinic:  { bg: '#a855f7', text: '#fff' },
                  agent:   { bg: '#eab308', text: '#000' },
                };
                const badge = roleBadgeColor[role] ?? { bg: '#555', text: '#fff' };

                const canViewProfile = !!(item.ownerId && item.ownerRole);

                return (
                  <View style={styles.feedCard}>
                    {/* Author strip */}
                    <View style={styles.cardStrip}>
                      <TouchableOpacity
                        style={styles.stripLeft}
                        activeOpacity={0.75}
                        onPress={() => canViewProfile && router.push({
                          pathname: '/agent-user-posts',
                          params: { ownerId: item.ownerId, ownerRole: item.ownerRole, userName }
                        })}
                      >
                        <View style={styles.initialsCircle}>
                          <Text style={styles.initialsText}>{initials || '?'}</Text>
                        </View>
                        <View style={styles.stripNameCol}>
                          <Text style={styles.stripName} numberOfLines={1}>{userName}</Text>
                          {!!role && (
                            <View style={[styles.roleBadge, { backgroundColor: badge.bg }]}>
                              <Text style={[styles.roleBadgeText, { color: badge.text }]}>{role.toUpperCase()}</Text>
                            </View>
                          )}
                        </View>
                      </TouchableOpacity>
                      <View style={styles.stripRight}>
                        {timestamp && (
                          <Text style={styles.stripDate}>
                            {timestamp.toLocaleDateString()}
                          </Text>
                        )}
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
                    </View>

                    {/* Media */}
                    <ZoomableFeedMedia post={item} />

                    {/* Content */}
                    {!!item.content && (
                      <Text style={styles.feedContent}>{item.content}</Text>
                    )}

                    {/* View profile footer */}
                    {canViewProfile && (
                      <TouchableOpacity
                        style={styles.viewProfileRow}
                        activeOpacity={0.7}
                        onPress={() => router.push({
                          pathname: '/agent-user-posts',
                          params: { ownerId: item.ownerId, ownerRole: item.ownerRole, userName }
                        })}
                      >
                        <Ionicons name="person-outline" size={14} color="#555" />
                        <Text style={styles.viewProfileText}>{i18n.t('viewProfile') || 'View Profile'} →</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              }}
          keyExtractor={item => item.id}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              initialNumToRender={5}
              maxToRenderPerBatch={6}
              windowSize={7}
              removeClippedSubviews={Platform.OS === 'android'}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Ionicons name={errorMessage ? 'alert-circle-outline' : 'newspaper-outline'} size={64} color="#666" />
                  <Text style={styles.emptyText}>{errorMessage || (i18n.t('noPosts') || 'No posts yet')}</Text>
                  <Text style={styles.emptySubtext}>{errorMessage ? (i18n.t('tapToRetry') || 'Tap retry to try again.') : (i18n.t('beFirstToPost') || 'Be the first to share something!')}</Text>
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
        <View style={styles.fullScreenContainer}>
          <TouchableOpacity
            style={styles.fullScreenCloseButton}
            onPress={() => setFullScreenMedia(null)}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={32} color="#fff" />
          </TouchableOpacity>
          {fullScreenMedia && (
            <View style={styles.fullScreenContent}>
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
        </View>
      </Modal>
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
  feedCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    marginBottom: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 6,
    overflow: 'hidden',
  },
  cardStrip: {
    backgroundColor: '#111',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  stripLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  initialsCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 11,
    flexShrink: 0,
  },
  initialsText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
  },
  stripNameCol: {
    flex: 1,
    minWidth: 0,
  },
  stripName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  stripRight: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  stripDate: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.55)',
    marginBottom: 2,
  },
  feedContent: {
    fontSize: 15,
    color: '#222',
    lineHeight: 22,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  viewProfileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    marginTop: 4,
  },
  viewProfileText: {
    fontSize: 13,
    color: '#555',
    fontWeight: '600',
  },
  // legacy kept for ZoomableFeedMedia compatibility
  feedHeader: { flexDirection: 'row' },
  feedHeaderRight: { flexDirection: 'row' },
  feedAuthorContainer: { flexDirection: 'row' },
  feedAuthor: { fontSize: 16, fontWeight: 'bold', color: '#000' },
  feedTime: { fontSize: 12, color: '#999' },
  mediaContainer: {
    width: '100%',
    marginVertical: 12,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#f0f0f0',
  },
  mediaImage: {
    width: '100%',
    height: 300,
    backgroundColor: '#000',
  },
  mediaVideo: {
    width: '100%',
    height: 300,
    backgroundColor: '#000',
  },
  loadingState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#fff',
    fontSize: 16,
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
  retryButton: {
    marginTop: 14,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  retryButtonText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 14,
  },
  fullScreenButton: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  fullScreenContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    height: '100%',
  },
  fullScreenCloseButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 40,
    right: 20,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenContent: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenImage: {
    width: '100%',
    height: '100%',
  },
  fullScreenVideo: {
    width: '100%',
    height: '100%',
  },
});
