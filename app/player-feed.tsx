import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, getFirestore, onSnapshot, orderBy, query } from 'firebase/firestore';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useRef } from 'react';
import { Animated, Easing, FlatList, Image, PanResponder, Platform, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import HamburgerMenu from '../components/HamburgerMenu';
import FloatingHamburgerButton from '../components/FloatingHamburgerButton';
import FootballLoader from '../components/FootballLoader';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import { useScrollAwareHeader } from '../hooks/useScrollAwareHeader';
import PostActionsMenu from '../components/PostActionsMenu';
import PostSocialActions from '../components/feed/PostSocialActions';
import CommentsSheet from '../components/feed/CommentsSheet';
import UploadProgressBanner from '../components/UploadProgressBanner';
import ZoomableFeedMedia from '../components/feed/ZoomableFeedMedia';
import { auth, db } from '../lib/firebase';
import {
  toggleFollow,
  subscribeIsFollowing
} from '../services/FollowService';
import i18n from '../locales/i18n';

const formatPostTime = (timestamp: Date | null) => {
  if (!timestamp) return '';

  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp.getTime()) / 1000));

  if (diffSeconds < 60) return i18n.t('justNow') || 'Just now';
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h`;
  if (diffSeconds < 604800) return `${Math.floor(diffSeconds / 86400)}d`;

  return timestamp.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const getAuthorInitials = (name?: string) => {
  const safeName = String(name || 'User').trim();
  if (!safeName) return 'U';

  return safeName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
};

const getAuthorAvatarUri = (item: any) => {
  const candidate = item?.authorPhoto || item?.ownerPhoto || item?.profilePhoto || item?.profilePic || item?.photo || item?.avatarUrl;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
};

const getRoleBadgeMeta = (role?: string) => {
  switch (role) {
    case 'academy':
      return {
        icon: 'school-outline' as const,
        label: i18n.t('academyRoleLabel') || 'Academy',
        backgroundColor: '#eff6ff',
        color: '#1d4ed8',
      };
    case 'admin':
      return {
        icon: 'shield-checkmark-outline' as const,
        label: i18n.t('adminRoleLabel') || 'Admin',
        backgroundColor: '#fef3c7',
        color: '#b45309',
      };
    default:
      return {
        icon: 'person-outline' as const,
        label: i18n.t('playerRoleLabel') || 'Player',
        backgroundColor: '#ecfdf5',
        color: '#047857',
      };
  }
};

const getFollowButtonTextStyle = (isFollowing: boolean) => [
  styles.followBtnText,
  isFollowing ? styles.followBtnTextFollowing : styles.followBtnTextDefault,
];

export default function PlayerFeedScreen() {
  const router = useRouter();
  const { openMenu } = useHamburgerMenu();
  const [feed, setFeed] = React.useState<any[]>([]);
  const [activeFeedSector, setActiveFeedSector] = React.useState<'general' | 'following'>('general');
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const { onScroll: onScrollAware, floatingMenuAnim } = useScrollAwareHeader();

  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const [playerPosts, setPlayerPosts] = React.useState<any[]>([]);
  const [academyPosts, setAcademyPosts] = React.useState<any[]>([]);
  const [adminPosts, setAdminPosts] = React.useState<any[]>([]);
  const [commentsPostId, setCommentsPostId] = React.useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = React.useState<string>('');
  const [currentUserPhoto, setCurrentUserPhoto] = React.useState<string | null>(null);
  const [followStates, setFollowStates] = React.useState<Record<string, boolean>>({});
  const [followedUserIds, setFollowedUserIds] = React.useState<string[]>([]);
  const followAnim = React.useRef<Record<string, Animated.Value>>({}).current;
  const feedSectors: Array<'general' | 'following'> = ['general', 'following'];

  // Fetch current user profile for commenting/reposting
  React.useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      const fullName = `${data?.firstName || ''} ${data?.lastName || ''}`.trim();
      const name = data?.name || fullName || data?.email || 'Player';
      setCurrentUserName(name);
      const photo = data?.profilePhoto || data?.profilePic || data?.photo || data?.avatarUrl || null;
      setCurrentUserPhoto(photo);
    }).catch(() => {});
  }, []);

  const openUploadMedia = () => {
    router.push('/player-upload-media' as any);
  };

  const openMyMedia = () => {
    router.push('/player-my-media' as any);
  };

  const handleRefresh = React.useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 700);
  }, []);

  // Merge and sort: player's posts + all academy posts + admin posts (deduplicate by post ID)
  React.useEffect(() => {
    const active = (p: any) => !p.status || p.status === 'active';
    const getTs = (p: any) => p.timestamp?.seconds ?? p.createdAt?.seconds ?? 0;
    
    // Combine all arrays and deduplicate by post ID
    const allPosts = [...playerPosts.filter(active), ...academyPosts.filter(active), ...adminPosts.filter(active)];
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
  }, [playerPosts, academyPosts, adminPosts]);

  React.useEffect(() => {
    setLoading(true);
    const user = auth.currentUser;
    if (!user) {
      setPlayerPosts([]);
      setAcademyPosts([]);
      setLoading(false);
      return;
    }

    const db = getFirestore();
    const postsRef = collection(db, 'posts');

    const getTs = (p: any) => p.timestamp?.seconds ?? p.createdAt?.seconds ?? 0;
    const normalizePosts = (docs: any[]) => docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((post: any) => !post.status || post.status === 'active')
      .sort((a: any, b: any) => getTs(b) - getTs(a));

    const allPostsQuery = query(postsRef, orderBy('timestamp', 'desc'));

    const unsubPosts = onSnapshot(
      allPostsQuery,
      (snap) => {
        setPlayerPosts(normalizePosts(snap.docs));
        setAcademyPosts([]);
        setAdminPosts([]);
        setLoading(false);
      },
      async (err: any) => {
        if (err?.code === 'permission-denied' || err?.message?.includes('permission')) {
          setPlayerPosts([]);
          setLoading(false);
          return;
        }

        try {
          const snap = await getDocs(postsRef);
          setPlayerPosts(normalizePosts(snap.docs));
          setAcademyPosts([]);
          setAdminPosts([]);
        } catch {
          setPlayerPosts([]);
        } finally {
          setLoading(false);
        }
      }
    );

    return () => {
      unsubPosts();
    };
  }, []);

  React.useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setFollowedUserIds([]);
      return;
    }

    const followingRef = collection(db, `users/${uid}/following`);
    return onSnapshot(
      followingRef,
      (snap) => {
        setFollowedUserIds(snap.docs.map((docSnap) => docSnap.id));
      },
      () => setFollowedUserIds([])
    );
  }, []);

  const visibleFeed = React.useMemo(() => {
    if (activeFeedSector === 'general') return feed;
    const followed = new Set(followedUserIds);
    return feed.filter((post) => post.ownerId && followed.has(post.ownerId));
  }, [activeFeedSector, feed, followedUserIds]);

  // Subscribe to follow state for all visible player authors
  React.useEffect(() => {
    // Only subscribe for player posts
    const subs: Record<string, ReturnType<typeof subscribeIsFollowing>> = {};
    const playerAuthors = feed
      .filter((p) => p.ownerId && auth.currentUser?.uid !== p.ownerId && p.ownerRole !== 'admin')
      .map((p) => p.ownerId);
    playerAuthors.forEach((uid) => {
      if (!subs[uid] && !(uid in followStates)) {
        subs[uid] = subscribeIsFollowing(uid, (isFollowing) => {
          setFollowStates((prev) => ({ ...prev, [uid]: isFollowing }));
        });
      }
    });
    return () => {
      Object.values(subs).forEach((unsub) => unsub && unsub());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed]);

  const handleToggleFollow = async (targetUid: string, targetRole: string, targetName: string, targetPhoto: string) => {
    // Optimistic UI update
    setFollowStates((prev) => {
      const current = !!prev[targetUid];
      return { ...prev, [targetUid]: !current };
    });
    // Animate if following
    if (!followAnim[targetUid]) followAnim[targetUid] = new Animated.Value(1);
    if (!followStates[targetUid]) {
      Animated.sequence([
        Animated.timing(followAnim[targetUid], {
          toValue: 1.2,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(followAnim[targetUid], {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        })
      ]).start();
    }
    try {
      await toggleFollow(targetUid, targetRole, targetName, targetPhoto);
    } catch (e) {
      // Rollback on error
      setFollowStates((prev) => {
        const current = !!prev[targetUid];
        return { ...prev, [targetUid]: !current };
      });
      // Log the error for debugging
      console.error('Follow/unfollow error:', e);
    }
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

  const renderFeedItem = (item: any) => {
    const timestamp = item.timestamp?.seconds
      ? new Date(item.timestamp.seconds * 1000)
      : item.createdAt?.seconds
        ? new Date(item.createdAt.seconds * 1000)
        : null;
    const roleMeta = getRoleBadgeMeta(item.ownerRole);
    const avatarUri = getAuthorAvatarUri(item);
    const taggedNames = Array.isArray(item.taggedUserNames)
      ? item.taggedUserNames.filter(Boolean)
      : Array.isArray(item.taggedUsers)
        ? item.taggedUsers.map((entry: any) => (typeof entry === 'string' ? entry : entry?.name)).filter(Boolean)
        : [];

    return (
      <View key={item.id} style={styles.feedItem}>
        <View style={styles.feedHeader}>
          <TouchableOpacity
            style={styles.feedAuthorContainer}
            onPress={() => {
              if (item.ownerId && item.ownerRole !== 'admin') {
                router.push({
                  pathname: '/agent-user-posts',
                  params: {
                    ownerId: item.ownerId,
                    ownerRole: item.ownerRole || 'player',
                    userName: item.author || 'Player',
                  },
                });
              }
            }}
            activeOpacity={item.ownerId && item.ownerRole !== 'admin' ? 0.75 : 1}
          >
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.authorAvatarImage} />
            ) : (
              <View style={styles.authorAvatarFallback}>
                <Text style={styles.authorAvatarFallbackText}>{getAuthorInitials(item.author)}</Text>
              </View>
            )}
            <View style={styles.feedAuthorTextWrap}>
              <Text
                style={styles.feedAuthor}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {item.author || 'Anonymous'}
              </Text>
              <View style={styles.feedMetaRow}>
                <View style={[styles.roleBadge, { backgroundColor: roleMeta.backgroundColor }]}> 
                  <Ionicons name={roleMeta.icon} size={12} color={roleMeta.color} />
                  <Text style={[styles.roleBadgeText, { color: roleMeta.color }]}>{roleMeta.label}</Text>
                </View>
                {timestamp && <Text style={styles.feedTime}>{formatPostTime(timestamp)}</Text>}
              </View>
            </View>
          </TouchableOpacity>
          <View style={styles.feedHeaderRight}>
            {/* Follow/Unfollow CTA for post owners, not self/admin */}
            {item.ownerId && item.ownerRole !== 'admin' && auth.currentUser?.uid !== item.ownerId && (
              <Animated.View style={{ transform: [{ scale: followAnim[item.ownerId] || 1 }] }}>
                <TouchableOpacity
                  style={[styles.followBtn, followStates[item.ownerId] ? styles.following : styles.notFollowing]}
                  onPress={() => handleToggleFollow(
                    item.ownerId,
                    item.ownerRole || 'user',
                    item.author || '',
                    avatarUri || ''
                  )}
                  activeOpacity={0.85}
                >
                  <Text style={getFollowButtonTextStyle(!!followStates[item.ownerId])}>
                    {followStates[item.ownerId] ? (i18n.t('following') || 'Following') : (i18n.t('follow') || 'Follow')}
                  </Text>
                </TouchableOpacity>
              </Animated.View>
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

        <ZoomableFeedMedia post={item} />

        {item.content && (
          <Text style={styles.feedContent}>{item.content}</Text>
        )}

        {taggedNames.length > 0 && (
          <Text style={styles.taggedUsersText}>
            {i18n.t('taggedInPost', { names: taggedNames.map((name: string) => `@${name}`).join(', ') }) || `Tagged: ${taggedNames.map((name: string) => `@${name}`).join(', ')}`}
          </Text>
        )}

        {/* Repost banner */}
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
        />
      </View>
    );
  };

  const selectedCommentsPost = commentsPostId ? feed.find((p) => p.id === commentsPostId) : null;

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#000000', '#1a1a1a', '#2d2d2d']}
        style={styles.gradient}
      >
      <HamburgerMenu />
      <FloatingHamburgerButton onPress={openMenu} translateY={floatingMenuAnim} />
        <Animated.View style={{ flex: 1, opacity: fadeAnim }} {...feedSwipeResponder.panHandlers}>
          {/* Feed Content */}
          {loading ? (
            <View style={styles.loadingContainer}>
              {[1, 2, 3].map((card) => (
                <View key={`skeleton-${card}`} style={[styles.feedItem, styles.skeletonCard]}>
                  <View style={styles.skeletonHeader}>
                    <View style={styles.skeletonAvatar} />
                    <View style={styles.skeletonTextWrap}>
                      <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
                      <View style={[styles.skeletonLine, styles.skeletonLineTiny]} />
                    </View>
                  </View>
                  <View style={styles.skeletonMedia} />
                  <View style={[styles.skeletonLine, styles.skeletonLineBody]} />
                  <View style={[styles.skeletonLine, styles.skeletonLineMedium]} />
                </View>
              ))}
            </View>
          ) : (
            <FlatList
              data={visibleFeed}
              renderItem={({ item }) => renderFeedItem(item)}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              onScroll={onScrollAware}
              scrollEventThrottle={16}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={handleRefresh}
                  tintColor="transparent"
                  colors={["transparent"]}
                  progressBackgroundColor="transparent"
                />
              }
              initialNumToRender={5}
              maxToRenderPerBatch={6}
              windowSize={7}
              removeClippedSubviews={Platform.OS === 'android'}
              ListHeaderComponent={
                <View style={styles.listIntroWrap}>
                  {refreshing ? (
                    <View style={styles.refreshBallWrap}>
                      <FootballLoader size="small" color="#fff" />
                    </View>
                  ) : null}

                  <View style={styles.header}>
                    <TouchableOpacity style={styles.menuButton} onPress={openMenu}>
                      <Ionicons name="menu" size={24} color="#fff" />
                    </TouchableOpacity>
                    <View style={styles.headerContent}>
                      <Text style={styles.headerTitle}>{i18n.t('feed') || 'Feed'}</Text>
                      <Text style={styles.headerSubtitle}>{i18n.t('latestUpdates') || 'Latest updates from the community'}</Text>
                    </View>
                  </View>

                  <UploadProgressBanner />

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

                  <View style={styles.composerCard}>
                    <View style={styles.composerTopRow}>
                      <View style={styles.composerAvatar}>
                        <Ionicons name="person" size={18} color="#111827" />
                      </View>
                      <View style={styles.composerTextWrap}>
                        <Text style={styles.composerTitle}>{i18n.t('shareYourHighlight') || 'Share your next highlight'}</Text>
                        <Text style={styles.composerSubtitle}>{i18n.t('feedFreshMoments') || 'Post a photo or video in a cleaner, more modern way.'}</Text>
                      </View>
                    </View>

                    <View style={styles.quickActionRow}>
                      <TouchableOpacity style={styles.primaryActionButton} onPress={openUploadMedia}>
                        <Ionicons name="add-circle-outline" size={16} color="#fff" />
                        <Text style={styles.primaryActionText}>{i18n.t('uploadMedia') || 'Upload Media'}</Text>
                      </TouchableOpacity>

                      <TouchableOpacity style={styles.secondaryActionButton} onPress={openMyMedia}>
                        <Ionicons name="images-outline" size={16} color="#111827" />
                        <Text style={styles.secondaryActionText}>{i18n.t('myMedia') || 'My media'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              }
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Ionicons name="document-text-outline" size={64} color="rgba(255, 255, 255, 0.3)" />
                  <Text style={styles.emptyText}>
                    {activeFeedSector === 'following'
                      ? (i18n.t('noFollowingPosts') || 'No followed posts yet.')
                      : (i18n.t('noPosts') || 'No posts yet.')}
                  </Text>
                  <Text style={styles.emptySubtext}>
                    {activeFeedSector === 'following'
                      ? (i18n.t('followPeopleToSeePosts') || 'Follow people to build this feed.')
                      : (i18n.t('beFirstToPost') || 'Be the first to share something!')}
                  </Text>
                  <TouchableOpacity
                    style={styles.emptyActionButton}
                    onPress={activeFeedSector === 'following' ? () => router.push('/user-search' as any) : openUploadMedia}
                  >
                    <Text style={styles.emptyActionText}>
                      {activeFeedSector === 'following'
                        ? (i18n.t('searchUsers') || 'Search Users')
                        : (i18n.t('uploadMedia') || 'Upload Media')}
                    </Text>
                  </TouchableOpacity>
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
    </View>
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
    paddingTop: Platform.OS === 'ios' ? 60 : 32,
    paddingHorizontal: 6,
    paddingBottom: 16,
  },
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerContent: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingBottom: 40,
  },
  listIntroWrap: {
    marginBottom: 12,
  },
  refreshBallWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 10,
  },
  composerCard: {
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
    marginHorizontal: 2,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  feedSectorRow: {
    flexDirection: 'row',
    gap: 6,
    marginHorizontal: 2,
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
  composerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  composerAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  composerTextWrap: {
    flex: 1,
  },
  composerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 3,
  },
  composerSubtitle: {
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 17,
  },
  quickActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#111827',
    borderRadius: 14,
    paddingVertical: 12,
  },
  primaryActionText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  secondaryActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#f9fafb',
    borderRadius: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  secondaryActionText: {
    color: '#111827',
    fontWeight: '700',
    fontSize: 13,
  },
  loadingContainer: {
    paddingVertical: 12,
  },
  skeletonCard: {
    overflow: 'hidden',
  },
  skeletonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  skeletonAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#e5e7eb',
    marginRight: 10,
  },
  skeletonTextWrap: {
    flex: 1,
  },
  skeletonLine: {
    height: 10,
    borderRadius: 999,
    backgroundColor: '#e5e7eb',
  },
  skeletonLineShort: {
    width: '42%',
    marginBottom: 8,
  },
  skeletonLineTiny: {
    width: '28%',
  },
  skeletonMedia: {
    height: 240,
    borderRadius: 16,
    backgroundColor: '#e5e7eb',
    marginBottom: 12,
  },
  skeletonLineBody: {
    width: '88%',
    marginBottom: 8,
  },
  skeletonLineMedium: {
    width: '62%',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  emptyText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    marginTop: 24,
    textAlign: 'center',
  },
  emptySubtext: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  emptyActionButton: {
    marginTop: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  emptyActionText: {
    color: '#111827',
    fontWeight: '700',
    fontSize: 14,
  },
  feedItem: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  feedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  feedHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  followBtn: {
    minWidth: 78,
    height: 34,
    borderRadius: 17,
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
  authorAvatarImage: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#e5e7eb',
  },
  authorAvatarFallback: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  authorAvatarFallbackText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  feedAuthorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    marginRight: 8,
  },
  feedAuthorTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  feedAuthor: {
    fontWeight: 'bold',
    color: '#000',
    fontSize: 16,
    flexShrink: 1,
    marginBottom: 4,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  feedMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  feedTime: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '600',
  },
  feedContent: {
    fontSize: 15,
    color: '#222',
    lineHeight: 22,
    marginTop: 12,
  },
  taggedUsersText: {
    fontSize: 13,
    color: '#1d4ed8',
    marginTop: 8,
    fontWeight: '600',
  },
  repostBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 2,
  },
  repostBannerText: {
    fontSize: 12,
    color: '#047857',
    fontWeight: '600',
  },
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
