import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { collection, doc, getDoc, onSnapshot, getFirestore, orderBy, query, where } from 'firebase/firestore';
import React, { useRef } from 'react';
import { Animated, Easing, FlatList, Image, KeyboardAvoidingView, Modal, PanResponder, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import PostActionsMenu from '../components/PostActionsMenu';
import CommentsSheet from '../components/feed/CommentsSheet';
import FeedAuthorAvatar from '../components/feed/FeedAuthorAvatar';
import PostSocialActions from '../components/feed/PostSocialActions';
import UploadProgressBanner from '../components/UploadProgressBanner';
import ZoomableFeedMedia from '../components/feed/ZoomableFeedMedia';
import i18n from '../locales/i18n';
import { auth, db } from '../lib/firebase';
import { getUserDisplayName } from '../services/AgentDataService';
import FootballLoader from '../components/FootballLoader';
import { toggleFollow } from '../services/FollowService';

export default function AgentFeedScreen() {
  const router = useRouter();
  const { openMenu } = useHamburgerMenu();
  const [feed, setFeed] = React.useState<any[]>([]);
  const [activeFeedSector, setActiveFeedSector] = React.useState<'general' | 'following'>('general');
  const [loading, setLoading] = React.useState(true);
  const [userNames, setUserNames] = React.useState<{ [key: string]: string }>({});
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [fullScreenMedia, setFullScreenMedia] = React.useState<{ uri: string; type: 'image' | 'video' } | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [agentPosts, setAgentPosts] = React.useState<any[]>([]);
  const [adminPosts, setAdminPosts] = React.useState<any[]>([]);
  const [commentsPostId, setCommentsPostId] = React.useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = React.useState<string>('');
  const [currentUserPhoto, setCurrentUserPhoto] = React.useState<string | null>(null);
  const [followStates, setFollowStates] = React.useState<Record<string, boolean>>({});
  const [followedUserIds, setFollowedUserIds] = React.useState<string[]>([]);
  const followAnim = React.useRef<Record<string, Animated.Value>>({}).current;
  const feedSectors: Array<'general' | 'following'> = ['general', 'following'];

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
  }, [fadeAnim]);

  React.useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;
    const db = getFirestore();
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      const fullName = `${data?.firstName || ''} ${data?.lastName || ''}`.trim();
      const name = data?.agentName || data?.name || fullName || data?.email || 'Agent';
      setCurrentUserName(name);
      const photo = data?.profilePhoto || data?.profilePic || data?.photo || data?.avatarUrl || null;
      setCurrentUserPhoto(photo);
    }).catch(() => {});
  }, []);

  React.useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setFollowedUserIds([]);
      setFollowStates({});
      return;
    }

    return onSnapshot(
      collection(db, `users/${uid}/following`),
      (snap) => {
        const ids = snap.docs.map((docSnap) => docSnap.id);
        const nextStates: Record<string, boolean> = {};
        ids.forEach((id) => {
          nextStates[id] = true;
        });
        setFollowedUserIds(ids);
        setFollowStates((prev) => ({ ...prev, ...nextStates }));
      },
      () => {
        setFollowedUserIds([]);
        setFollowStates({});
      }
    );
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
                  } catch {
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

  const getAuthorAvatarUri = (item: any) => {
    const candidate = item?.authorPhoto || item?.ownerPhoto || item?.profilePhoto || item?.profilePic || item?.photo || item?.avatarUrl;
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
  };

  const visibleFeed = React.useMemo(() => {
    if (activeFeedSector === 'general') return feed;
    const followed = new Set(followedUserIds);
    return feed.filter((post) => post.ownerId && followed.has(post.ownerId));
  }, [activeFeedSector, feed, followedUserIds]);

  const handleToggleFollow = async (item: any) => {
    const targetUid = item.ownerId;
    if (!targetUid) return;

    const targetName = userNames[targetUid] || item.author || 'User';
    const targetPhoto = item.authorPhoto || item.ownerPhoto || item.profilePhoto || item.profilePic || item.photo || item.avatarUrl || '';

    setFollowStates((prev) => ({ ...prev, [targetUid]: !prev[targetUid] }));

    if (!followAnim[targetUid]) {
      followAnim[targetUid] = new Animated.Value(1);
    }

    if (!followStates[targetUid]) {
      Animated.sequence([
        Animated.timing(followAnim[targetUid], {
          toValue: 1.15,
          duration: 160,
          useNativeDriver: true,
        }),
        Animated.timing(followAnim[targetUid], {
          toValue: 1,
          duration: 160,
          useNativeDriver: true,
        }),
      ]).start();
    }

    try {
      const isFollowingNow = await toggleFollow(targetUid, item.ownerRole || 'player', targetName, targetPhoto);
      setFollowStates((prev) => ({ ...prev, [targetUid]: isFollowingNow }));
    } catch (error) {
      setFollowStates((prev) => ({ ...prev, [targetUid]: !prev[targetUid] }));
      console.error('Agent feed follow/unfollow error:', error);
    }
  };

  const handleRetry = () => {
    setRefreshKey((prev) => prev + 1);
  };

  const switchFeedSectorBySwipe = React.useCallback((direction: 'left' | 'right') => {
    setActiveFeedSector((current) => {
      const currentIndex = feedSectors.indexOf(current);
      if (currentIndex === -1) return current;
      const nextIndex = direction === 'left'
        ? Math.min(feedSectors.length - 1, currentIndex + 1)
        : Math.max(0, currentIndex - 1);
      return feedSectors[nextIndex] || current;
    });
  }, []);

  const feedSwipeResponder = React.useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dx) > 18 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.35,
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx <= -48) {
          switchFeedSectorBySwipe('left');
        } else if (gestureState.dx >= 48) {
          switchFeedSectorBySwipe('right');
        }
      },
    })
  ).current;

  const selectedCommentsPost = commentsPostId ? feed.find((p) => p.id === commentsPostId) : null;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient
        colors={['#000000', '#1a1a1a', '#2d2d2d']}
        style={styles.gradient}
      >
        <Animated.View style={{ flex: 1, opacity: fadeAnim }} {...feedSwipeResponder.panHandlers}>
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

      <UploadProgressBanner />

      <HamburgerMenu />

      {!loading && (
        <View style={styles.feedSectorRow}>
          <TouchableOpacity
            style={[styles.feedSectorButton, activeFeedSector === 'general' && styles.feedSectorButtonActive]}
            onPress={() => setActiveFeedSector('general')}
            activeOpacity={0.85}
          >
            <Ionicons
              name="globe-outline"
              size={15}
              color={activeFeedSector === 'general' ? '#111827' : '#d1d5db'}
            />
            <Text style={[styles.feedSectorText, activeFeedSector === 'general' && styles.feedSectorTextActive]}>
              {i18n.t('generalFeed') || 'General'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.feedSectorButton, activeFeedSector === 'following' && styles.feedSectorButtonActive]}
            onPress={() => setActiveFeedSector('following')}
            activeOpacity={0.85}
          >
            <Ionicons
              name="people-outline"
              size={15}
              color={activeFeedSector === 'following' ? '#111827' : '#d1d5db'}
            />
            <Text style={[styles.feedSectorText, activeFeedSector === 'following' && styles.feedSectorTextActive]}>
              {i18n.t('following') || 'Following'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
            <View style={styles.loadingState}>
              <FootballLoader size="large" color="#fff" />
              <Text style={styles.loadingText}>{i18n.t('loading') || 'Loading...'}</Text>
            </View>
      ) : (
        <FlatList
          data={visibleFeed}
              renderItem={({ item }: any) => {
                const timestamp = item.timestamp?.seconds 
                  ? new Date(item.timestamp.seconds * 1000) 
                  : item.createdAt?.seconds 
                    ? new Date(item.createdAt.seconds * 1000)
                    : null;

                const userName = userNames[item.ownerId] || item.author || 'User';
                const role = item.ownerRole || '';
                const avatarUri = getAuthorAvatarUri(item);

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
                const canFollow = !!(item.ownerId && item.ownerRole !== 'admin' && auth.currentUser?.uid !== item.ownerId);
                const isFollowing = !!followStates[item.ownerId];

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
                        <FeedAuthorAvatar uri={avatarUri} name={userName} size={46} />
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
                        {canFollow && (
                          <Animated.View style={{ transform: [{ scale: followAnim[item.ownerId] || 1 }] }}>
                            <TouchableOpacity
                              style={[styles.followBtn, isFollowing ? styles.following : styles.notFollowing]}
                              onPress={() => handleToggleFollow(item)}
                              activeOpacity={0.85}
                            >
                              <Text style={[styles.followBtnText, isFollowing ? styles.followBtnTextFollowing : styles.followBtnTextDefault]}>
                                {isFollowing ? (i18n.t('following') || 'Following') : (i18n.t('follow') || 'Follow')}
                              </Text>
                            </TouchableOpacity>
                          </Animated.View>
                        )}
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

                    {item.isRepost && (
                      <View style={styles.repostBanner}>
                        <Ionicons name="repeat-outline" size={13} color="#047857" />
                        <Text style={styles.repostBannerText}>
                          {i18n.t('repostedBy') || 'Reposted'}{item.originalAuthorName ? ` · ${item.originalAuthorName}` : ''}
                        </Text>
                      </View>
                    )}

                    <PostSocialActions
                      post={item}
                      onCommentPress={() => setCommentsPostId(item.id)}
                      currentUserName={currentUserName}
                      currentUserPhoto={currentUserPhoto}
                      viewerRole="agent"
                    />

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
                  <Text style={styles.emptyText}>
                    {errorMessage || (activeFeedSector === 'following'
                      ? (i18n.t('noFollowingPosts') || 'No followed posts yet.')
                      : (i18n.t('noPosts') || 'No posts yet'))}
                  </Text>
                  <Text style={styles.emptySubtext}>
                    {errorMessage
                      ? (i18n.t('tapToRetry') || 'Tap retry to try again.')
                      : activeFeedSector === 'following'
                        ? (i18n.t('followPeopleToSeePosts') || 'Follow people to build this feed.')
                        : (i18n.t('beFirstToPost') || 'Be the first to share something!')}
                  </Text>
                  {!!errorMessage && (
                    <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
                      <Text style={styles.retryButtonText}>{i18n.t('retry') || 'Retry'}</Text>
                    </TouchableOpacity>
                  )}
                  {!errorMessage && activeFeedSector === 'following' && (
                    <TouchableOpacity style={styles.retryButton} onPress={() => router.push('/agent-players' as any)}>
                      <Text style={styles.retryButtonText}>{i18n.t('agentPlayers') || 'Players'}</Text>
                    </TouchableOpacity>
                  )}
    </View>
              }
            />
          )}
        </Animated.View>
      </LinearGradient>

      {commentsPostId && (
        <CommentsSheet
          postId={commentsPostId}
          postOwnerId={selectedCommentsPost?.ownerId}
          visible={!!commentsPostId}
          onClose={() => setCommentsPostId(null)}
          currentUserName={currentUserName}
          currentUserPhoto={currentUserPhoto}
        />
      )}

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
  feedSectorRow: {
    flexDirection: 'row',
    gap: 6,
    marginHorizontal: 24,
    marginBottom: 12,
    padding: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  feedSectorButton: {
    flex: 1,
    height: 34,
    borderRadius: 12,
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  feedSectorButtonActive: {
    backgroundColor: '#fff',
    borderColor: '#fff',
  },
  feedSectorText: {
    color: '#d1d5db',
    fontSize: 13,
    fontWeight: '800',
  },
  feedSectorTextActive: {
    color: '#111827',
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
  stripNameCol: {
    flex: 1,
    minWidth: 0,
    marginLeft: 11,
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
    gap: 6,
  },
  followBtn: {
    minWidth: 78,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  following: {
    backgroundColor: '#ecfdf5',
    borderColor: '#10b981',
  },
  notFollowing: {
    backgroundColor: '#fff',
    borderColor: '#d1d5db',
  },
  followBtnText: {
    fontSize: 12,
    fontWeight: '800',
  },
  followBtnTextDefault: {
    color: '#111827',
  },
  followBtnTextFollowing: {
    color: '#065f46',
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
  repostBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
    paddingHorizontal: 16,
  },
  repostBannerText: {
    fontSize: 12,
    color: '#047857',
    fontWeight: '600',
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
