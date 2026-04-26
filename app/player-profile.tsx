
// Place these inside StyleSheet.create({ ... })
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import React, { useMemo, useRef, useState } from 'react';
import {
  Animated,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Modal,
  PanResponder,
  Platform,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { collection, doc, getDoc, getDocs, getFirestore, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import FootballLoader from '../components/FootballLoader';
import CommentsSheet from '../components/feed/CommentsSheet';
import PostInteractionsSheet from '../components/feed/PostInteractionsSheet';
import PostRecentCommentsPreview from '../components/feed/PostRecentCommentsPreview';
import PostSocialActions from '../components/feed/PostSocialActions';
import ZoomableFeedMedia from '../components/feed/ZoomableFeedMedia';
import i18n from '../locales/i18n';
import { auth } from '../lib/firebase';
import { toggleFollow } from '../services/FollowService';
import { resolveUserDisplayName } from '../lib/userDisplayName';

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_GAP = 2;
const GRID_ITEM_SIZE = Math.floor((SCREEN_WIDTH - GRID_GAP * 2) / 3);

const formatCount = (value: number) => {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
};

const getDisplayName = (data: Record<string, any>) => {
  const fullName = `${data?.firstName || ''} ${data?.lastName || ''}`.trim();
  return data?.name || fullName || i18n.t('playerRoleLabel') || 'Player';
};

const getPostTimestamp = (post: any) => post?.pinnedAt?.seconds || post?.timestamp?.seconds || post?.createdAt?.seconds || 0;
const formatProfilePostDate = (value: any) => {
  const date = value?.toDate
    ? value.toDate()
    : value?.seconds
      ? new Date(value.seconds * 1000)
      : value
        ? new Date(value)
        : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
};

const sortProfilePosts = (items: any[]) => [...items].sort((a, b) => {
  const pinnedDiff = Number(!!b.isPinned) - Number(!!a.isPinned);
  if (pinnedDiff !== 0) return pinnedDiff;
  return getPostTimestamp(b) - getPostTimestamp(a);
});

const isRepostEntry = (post: any) => Boolean(
  post?.isRepost ||
  post?.originalPostId ||
  post?.repostedAt
);

type SocialUser = {
  id: string;
  name: string;
  role: string;
  photo: string | null;
  city: string;
};

const getUserPhoto = (data: Record<string, any>) => {
  const photo = data.profilePhoto || data.profilePic || data.photo || data.avatarUrl;
  return typeof photo === 'string' && photo.length > 0 ? photo : null;
};

const getInitials = (name: string) => (
  name.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('') || 'U'
);

export default function PlayerProfileScreen() {
  const router = useRouter();
  const { openMenu } = useHamburgerMenu();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState('');
  const [userHandle, setUserHandle] = useState('');
  const [userCity, setUserCity] = useState('');
  const [userPhoto, setUserPhoto] = useState<string | null>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [selectedPost, setSelectedPost] = useState<any | null>(null);
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);
  const [activeSector, setActiveSector] = useState<'posts' | 'videos' | 'reposts' | 'tagged'>('posts');
  const [interactionsPost, setInteractionsPost] = useState<any | null>(null);
  const [interactionsTab, setInteractionsTab] = useState<'likes' | 'comments' | 'reposts'>('likes');
  const [followers, setFollowers] = useState<SocialUser[]>([]);
  const [following, setFollowing] = useState<SocialUser[]>([]);
  const [followingIds, setFollowingIds] = useState<string[]>([]);
  const [taggedPosts, setTaggedPosts] = useState<any[]>([]);
  const [socialListMode, setSocialListMode] = useState<'followers' | 'following' | null>(null);
  const followAnim = useRef(new Animated.Value(1)).current;
  const user = auth.currentUser;
  const profileSectors: Array<'posts' | 'videos' | 'reposts' | 'tagged'> = ['posts', 'videos', 'reposts', 'tagged'];

  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  React.useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      return;
    }

    const db = getFirestore();

    // Load profile identity
    Promise.all([
      getDoc(doc(db, 'users', user.uid)),
      getDoc(doc(db, 'players', user.uid)),
    ]).then(([userSnap, playerSnap]) => {
      const merged = {
        ...(userSnap.exists() ? userSnap.data() : {}),
        ...(playerSnap.exists() ? playerSnap.data() : {}),
      } as Record<string, any>;

      const display = getDisplayName(merged);
      const fallbackHandle = display.toLowerCase().replace(/\s+/g, '');
      setUserName(display);
      setUserHandle(merged?.username || fallbackHandle);
      setUserCity(merged?.city || '');
      setUserPhoto(merged?.profilePhoto || merged?.profilePic || merged?.photo || null);
    }).catch(() => {});

    // Realtime own posts
    const postsRef = collection(db, 'posts');
    const q = query(
      postsRef,
      where('ownerId', '==', user.uid),
      orderBy('timestamp', 'desc')
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((p: any) => !p.status || p.status === 'active');
        setPosts(list);
        setLoading(false);
      },
      async () => {
        try {
          const fallback = query(postsRef, where('ownerId', '==', user.uid));
          const snap = await getDocs(fallback);
          const list = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((p: any) => !p.status || p.status === 'active')
            .sort((a: any, b: any) => {
              const aTs = a.timestamp?.seconds ?? a.createdAt?.seconds ?? 0;
              const bTs = b.timestamp?.seconds ?? b.createdAt?.seconds ?? 0;
              return bTs - aTs;
            });
          setPosts(list);
        } catch {
          setPosts([]);
        } finally {
          setLoading(false);
        }
      }
    );

    const taggedQ = query(
      postsRef,
      where('taggedUserIds', 'array-contains', user.uid),
      orderBy('timestamp', 'desc')
    );
    const unsubTagged = onSnapshot(taggedQ, (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((p: any) => !p.status || p.status === 'active');
      setTaggedPosts(list);
    }, () => setTaggedPosts([]));

    return () => {
      unsub();
      unsubTagged();
    };
  }, []);

  React.useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const db = getFirestore();
    const resolveUsers = async (ids: string[], embedded: Record<string, any>) => {
      const users = await Promise.all(
        ids.map(async (id): Promise<SocialUser> => {
          try {
            const snap = await getDoc(doc(db, 'users', id));
            const data = snap.exists() ? snap.data() : {};
            return {
              id,
              name: resolveUserDisplayName(data, embedded[id]?.actorName || id.slice(0, 8)),
              role: String(data?.role || embedded[id]?.role || 'player').toLowerCase(),
              photo: getUserPhoto(data) || embedded[id]?.actorPhoto || null,
              city: String(data?.city || embedded[id]?.city || ''),
            };
          } catch {
            return {
              id,
              name: embedded[id]?.actorName || id.slice(0, 8),
              role: String(embedded[id]?.role || 'player').toLowerCase(),
              photo: embedded[id]?.actorPhoto || null,
              city: '',
            };
          }
        })
      );

      return users.sort((a, b) => a.name.localeCompare(b.name));
    };

    const unsubFollowers = onSnapshot(collection(db, `users/${uid}/followers`), (snap) => {
      const embedded: Record<string, any> = {};
      const ids = snap.docs.map((docSnap) => {
        embedded[docSnap.id] = docSnap.data();
        return docSnap.id;
      });
      resolveUsers(ids, embedded).then(setFollowers).catch(() => setFollowers([]));
    }, () => setFollowers([]));

    const unsubFollowing = onSnapshot(collection(db, `users/${uid}/following`), (snap) => {
      const embedded: Record<string, any> = {};
      const ids = snap.docs.map((docSnap) => {
        embedded[docSnap.id] = docSnap.data();
        return docSnap.id;
      });
      setFollowingIds(ids);
      resolveUsers(ids, embedded).then(setFollowing).catch(() => setFollowing([]));
    }, () => {
      setFollowingIds([]);
      setFollowing([]);
    });

    return () => {
      unsubFollowers();
      unsubFollowing();
    };
  }, []);

  const originalPosts = useMemo(() => sortProfilePosts(posts.filter((p: any) => !isRepostEntry(p))), [posts]);
  const videoPosts = useMemo(
    () => sortProfilePosts(posts.filter((p: any) => !isRepostEntry(p) && p.mediaType === 'video')),
    [posts]
  );
  const repostPosts = useMemo(() => sortProfilePosts(posts.filter((p: any) => isRepostEntry(p))), [posts]);
  const visiblePosts = activeSector === 'posts'
    ? originalPosts
    : activeSector === 'videos'
      ? videoPosts
      : activeSector === 'reposts'
        ? repostPosts
        : taggedPosts;
  const pinnedCount = originalPosts.filter((p: any) => !!p.isPinned).length;
  const selectedPostIndex = selectedPost ? visiblePosts.findIndex((post: any) => post.id === selectedPost.id) : -1;
  const detailPosts = selectedPostIndex >= 0 ? visiblePosts.slice(selectedPostIndex) : [];
  const selectedCommentsPost = commentsPostId ? visiblePosts.find((p) => p.id === commentsPostId) || posts.find((p) => p.id === commentsPostId) || taggedPosts.find((p) => p.id === commentsPostId) : null;

  const handleTogglePin = async (post: any) => {
    if (!user || isRepostEntry(post)) return;

    const nextPinned = !post.isPinned;
    if (nextPinned && pinnedCount >= 3) {
      Alert.alert(
        i18n.t('pinLimitTitle') || 'Pin limit reached',
        i18n.t('pinLimitMessage') || 'You can pin up to 3 posts on your profile.'
      );
      return;
    }

    try {
      await updateDoc(doc(getFirestore(), 'posts', post.id), {
        isPinned: nextPinned,
        pinnedAt: nextPinned ? serverTimestamp() : null,
      });
    } catch (error) {
      console.error('[PlayerProfile] Failed to toggle pin:', error);
      Alert.alert(i18n.t('error') || 'Error', i18n.t('pinPostFailed') || 'Could not update pinned post.');
    }
  };

  const renderGridItem = ({ item }: { item: any }) => {
    const likes = Number(item.likesCount || 0);
    const comments = Number(item.commentsCount || 0);
    const isVideo = item.mediaType === 'video';

    return (
      <TouchableOpacity
        activeOpacity={0.85}
        style={styles.gridItem}
        onPress={() => setSelectedPost(item)}
      >
        {isVideo ? (
          <View style={styles.videoGridTile}>
            <Ionicons name="play" size={24} color="#fff" />
          </View>
        ) : item.mediaUrl ? (
          <Image source={{ uri: item.mediaUrl }} style={styles.gridMedia} />
        ) : (
          <View style={styles.gridTextFallback}>
            <Text numberOfLines={4} style={styles.gridTextFallbackText}>{item.content || 'Post'}</Text>
          </View>
        )}

        {isVideo && (
          <View style={styles.videoBadge}>
            <Ionicons name="play" size={12} color="#fff" />
          </View>
        )}

        {item.isPinned && (
          <View style={styles.pinnedBadge}>
            <Ionicons name="pin" size={18} color="#fff" />
          </View>
        )}

        {activeSector === 'posts' && (
          <TouchableOpacity
            style={[styles.pinButton, item.isPinned && styles.pinButtonActive]}
            onPress={(event: any) => {
              event.stopPropagation?.();
              void handleTogglePin(item);
            }}
            activeOpacity={0.85}
          >
            <Ionicons name={item.isPinned ? 'pin' : 'pin-outline'} size={15} color="#fff" />
          </TouchableOpacity>
        )}

        <View style={styles.gridOverlay}>
          <View style={styles.gridStatInline}>
            <Ionicons name="heart" size={12} color="#fff" />
            <Text style={styles.gridStatText}>{formatCount(likes)}</Text>
          </View>
          <View style={styles.gridStatInline}>
            <Ionicons name="chatbubble" size={12} color="#fff" />
            <Text style={styles.gridStatText}>{formatCount(comments)}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const handleToggleFollow = async (target: SocialUser) => {
    Animated.sequence([
      Animated.timing(followAnim, { toValue: 1.08, duration: 140, useNativeDriver: true }),
      Animated.timing(followAnim, { toValue: 1, duration: 140, useNativeDriver: true }),
    ]).start();

    await toggleFollow(target.id, target.role, target.name, target.photo || '');
  };

  const handleShareProfile = async () => {
    const currentUserId = auth.currentUser?.uid;
    if (!currentUserId) return;

    const profileUrl = Linking.createURL(`/profile/${currentUserId}`);
    const handle = userHandle ? `@${userHandle}` : userName || 'Player';
    try {
      await Share.share({
        message: `${handle} on Forsa\n${profileUrl}`,
        url: profileUrl,
      });
    } catch (error) {
      console.warn('[Profile] Share failed:', error);
    }
  };

  const switchProfileSector = React.useCallback((direction: 'left' | 'right') => {
    setActiveSector((current) => {
      const currentIndex = profileSectors.indexOf(current);
      if (currentIndex === -1) return current;

      const nextIndex = direction === 'left'
        ? Math.min(profileSectors.length - 1, currentIndex + 1)
        : Math.max(0, currentIndex - 1);

      return profileSectors[nextIndex] || current;
    });
  }, [profileSectors]);

  const profileSectorSwipeResponder = React.useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dx) > 42 &&
        Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.8,
      onPanResponderRelease: (_, gestureState) => {
        const shouldGoLeft = gestureState.dx <= -56 && Math.abs(gestureState.vx) > 0.08;
        const shouldGoRight = gestureState.dx >= 56 && Math.abs(gestureState.vx) > 0.08;

        if (shouldGoLeft) {
          switchProfileSector('left');
        } else if (shouldGoRight) {
          switchProfileSector('right');
        }
      },
    })
  ).current;

  if (loading) {
    return (
      <View style={styles.loaderWrap}>
        <FootballLoader size="large" color="#fff" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#000000', '#121212', '#1e1e1e']} style={styles.gradient}>
        <HamburgerMenu />

        <FlatList
          data={visiblePosts}
          renderItem={renderGridItem}
          keyExtractor={(item) => item.id}
          numColumns={3}
          columnWrapperStyle={styles.gridRow}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          {...profileSectorSwipeResponder.panHandlers}
          ListHeaderComponent={(
            <View>
              <View style={styles.topBar}>
                <TouchableOpacity style={styles.topActionButton} onPress={() => router.push('/player-upload-media' as any)}>
                  <Ionicons name="add" size={32} color="#fff" />
                </TouchableOpacity>
                <View style={styles.topIdentity}>
                  <Text style={styles.topHandle} numberOfLines={1}>{userHandle || 'player'}</Text>
                </View>
                <TouchableOpacity style={styles.topActionButton} onPress={() => router.push('/notifications' as any)}>
                  <Ionicons name="notifications-outline" size={25} color="#fff" />
                  {followers.length > 0 && (
                    <View style={styles.notificationDot}>
                      <Text style={styles.notificationDotText}>{Math.min(followers.length, 9)}</Text>
                    </View>
                  )}
                </TouchableOpacity>
                <TouchableOpacity style={styles.topActionButton} onPress={openMenu}>
                  <Ionicons name="menu" size={30} color="#fff" />
                </TouchableOpacity>
              </View>

              <View style={styles.profileHeaderModern}>
                <Animated.View style={[styles.avatarRingWrap, { opacity: fadeAnim, transform: [{ scale: fadeAnim }] }]}>
                  <LinearGradient
                    colors={["#38bdf8", "#6366f1", "#a21caf"]}
                    style={styles.avatarRing}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    {userPhoto ? (
                      <Image source={{ uri: userPhoto }} style={styles.avatarModern} />
                    ) : (
                      <View style={styles.avatarFallbackModern}>
                        <Ionicons name="person" size={40} color="#d1d5db" />
                      </View>
                    )}
                    <TouchableOpacity
                      style={styles.avatarAddButtonModern}
                      onPress={() => router.push('/player-upload-media' as any)}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="add" size={18} color="#fff" />
                    </TouchableOpacity>
                  </LinearGradient>
                </Animated.View>
                <Text style={styles.displayNameModern}>{userName || (i18n.t('playerRoleLabel') || 'Player')}</Text>
                {!!userCity && <Text style={styles.cityTextModern}>{userCity}</Text>}
                <View style={styles.statsRowModern}>
                  <View style={styles.statBlockModern}>
                    <Text style={styles.statValueModern}>{formatCount(posts.length)}</Text>
                    <Text style={styles.statLabelModern}>{i18n.t('post') || 'Posts'}</Text>
                  </View>
                  <TouchableOpacity style={styles.statBlockModern} onPress={() => setSocialListMode('followers')} activeOpacity={0.8}>
                    <Text style={styles.statValueModern}>{formatCount(followers.length)}</Text>
                    <Text style={styles.statLabelModern}>{i18n.t('followers') || 'Followers'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.statBlockModern} onPress={() => setSocialListMode('following')} activeOpacity={0.8}>
                    <Text style={styles.statValueModern}>{formatCount(following.length)}</Text>
                    <Text style={styles.statLabelModern}>{i18n.t('following') || 'Following'}</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.ctaRow}>
                <TouchableOpacity
                  style={styles.editBtn}
                  onPress={() => router.push('/player-edit-profile' as any)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.editBtnText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                    {i18n.t('editProfile') || 'Edit Profile'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.shareBtn}
                  onPress={handleShareProfile}
                  activeOpacity={0.85}
                >
                  <Text style={styles.shareBtnText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                    {i18n.t('shareProfile') || 'Share profile'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.profileTabsRow}>
                <TouchableOpacity
                  style={[styles.profileTab, activeSector === 'posts' && styles.profileTabActive]}
                  onPress={() => setActiveSector('posts')}
                  activeOpacity={0.85}
                >
                  <Ionicons name="grid" size={29} color={activeSector === 'posts' ? '#fff' : '#8b949e'} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.profileTab, activeSector === 'videos' && styles.profileTabActive]}
                  onPress={() => setActiveSector('videos')}
                  activeOpacity={0.85}
                >
                  <Ionicons name="play-circle-outline" size={31} color={activeSector === 'videos' ? '#fff' : '#8b949e'} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.profileTab, activeSector === 'reposts' && styles.profileTabActive]}
                  onPress={() => setActiveSector('reposts')}
                  activeOpacity={0.85}
                >
                  <Ionicons name="repeat-outline" size={31} color={activeSector === 'reposts' ? '#fff' : '#8b949e'} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.profileTab, activeSector === 'tagged' && styles.profileTabActive]}
                  onPress={() => setActiveSector('tagged')}
                  activeOpacity={0.85}
                >
                  <Ionicons name="id-card-outline" size={31} color={activeSector === 'tagged' ? '#fff' : '#8b949e'} />
                </TouchableOpacity>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="images-outline" size={48} color="#6b7280" />
              <Text style={styles.emptyText}>
                {activeSector === 'posts'
                  ? (i18n.t('noPosts') || 'No posts yet.')
                  : activeSector === 'videos'
                    ? (i18n.t('noVideosYet') || 'No videos yet.')
                    : activeSector === 'reposts'
                      ? (i18n.t('noRepostsYet') || 'No reposts yet.')
                      : (i18n.t('noTaggedPostsYet') || 'No tagged posts yet.')}
              </Text>
              {activeSector === 'posts' && (
                <TouchableOpacity style={styles.emptyAction} onPress={() => router.push('/player-upload-media' as any)}>
                  <Text style={styles.emptyActionText}>{i18n.t('uploadMedia') || 'Upload Media'}</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      </LinearGradient>

      <Modal
        visible={!!selectedPost}
        transparent={false}
        animationType="slide"
        onRequestClose={() => setSelectedPost(null)}
      >
        <View style={styles.postViewerScreen}>
          <View style={styles.postViewerHeader}>
            <TouchableOpacity style={styles.postViewerBackButton} onPress={() => setSelectedPost(null)}>
              <Ionicons name="arrow-back" size={28} color="#fff" />
            </TouchableOpacity>
            <View style={styles.postViewerHeaderTextWrap}>
              <Text style={styles.postViewerTitle}>{i18n.t('posts') || 'Posts'}</Text>
              <Text style={styles.postViewerSubtitle} numberOfLines={1}>{userHandle || 'player'}</Text>
            </View>
            <View style={styles.postViewerHeaderSpacer} />
          </View>

          <FlatList
            data={detailPosts}
            keyExtractor={(item) => `detail-${item.id}`}
            contentContainerStyle={styles.postViewerList}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <View style={styles.postViewerCard}>
                <View style={styles.postViewerCardHeader}>
                  <View style={styles.postViewerIdentity}>
                    {userPhoto ? (
                      <Image source={{ uri: userPhoto }} style={styles.postViewerAvatar} />
                    ) : (
                      <View style={styles.postViewerAvatarFallback}>
                        <Text style={styles.postViewerAvatarFallbackText}>{getInitials(item.author || userName || 'U')}</Text>
                      </View>
                    )}
                    <View style={styles.postViewerIdentityText}>
                      <Text style={styles.postViewerAuthor}>{item.author || userName || 'User'}</Text>
                      <Text style={styles.postViewerDate}>{formatProfilePostDate(item.timestamp || item.createdAt)}</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.postViewerStatsAction}
                    onPress={() => {
                      setInteractionsPost(item);
                      setInteractionsTab('likes');
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="ellipsis-horizontal" size={22} color="#fff" />
                  </TouchableOpacity>
                </View>

                {item.mediaUrl ? (
                  <View style={styles.postViewerMediaWrap}>
                    <ZoomableFeedMedia post={item} />
                  </View>
                ) : (
                  <View style={styles.postViewerTextOnly}>
                    <Text style={styles.postViewerTextOnlyContent}>{item.content || item.contentText || 'Post'}</Text>
                  </View>
                )}

                <View style={styles.postViewerActionsWrap}>
                  <PostSocialActions
                    post={item}
                    onCommentPress={() => setCommentsPostId(item.id)}
                    currentUserName={userName}
                    currentUserPhoto={userPhoto}
                    viewerRole="player"
                  />
                </View>

                <View style={styles.postViewerStatsRow}>
                  <TouchableOpacity
                    style={styles.postViewerStatsChip}
                    onPress={() => {
                      setInteractionsPost(item);
                      setInteractionsTab('likes');
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="heart" size={15} color="#f87171" />
                    <Text style={styles.postViewerStatsText}>{item.likesCount || 0}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.postViewerStatsChip}
                    onPress={() => {
                      setInteractionsPost(item);
                      setInteractionsTab('comments');
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="chatbubble-outline" size={15} color="#7dd3fc" />
                    <Text style={styles.postViewerStatsText}>{item.commentsCount || 0}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.postViewerStatsChip}
                    onPress={() => {
                      setInteractionsPost(item);
                      setInteractionsTab('reposts');
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="repeat" size={15} color="#86efac" />
                    <Text style={styles.postViewerStatsText}>{item.repostsCount || 0}</Text>
                  </TouchableOpacity>
                </View>

                {!!(item.content || item.contentText) && item.mediaUrl ? (
                  <View style={styles.postViewerCaptionBlock}>
                    <Text style={styles.postViewerCaptionAuthor}>{item.author || userName || 'User'}</Text>
                    <Text style={styles.postViewerCaptionText}>{item.content || item.contentText}</Text>
                  </View>
                ) : null}

                <PostRecentCommentsPreview
                  postId={item.id}
                  onPressOpenComments={() => setCommentsPostId(item.id)}
                />
              </View>
            )}
          />

          <CommentsSheet
            postId={commentsPostId || ''}
            postOwnerId={selectedCommentsPost?.ownerId}
            visible={!!commentsPostId}
            onClose={() => setCommentsPostId(null)}
            currentUserName={userName}
            currentUserPhoto={userPhoto}
          />

          <PostInteractionsSheet
            postId={interactionsPost?.id || null}
            postOwnerId={interactionsPost?.ownerId || null}
            visible={!!interactionsPost}
            onClose={() => setInteractionsPost(null)}
            initialTab={interactionsTab}
          />
        </View>
      </Modal>

      <Modal
        visible={!!socialListMode}
        transparent
        animationType="slide"
        onRequestClose={() => setSocialListMode(null)}
      >
        <View style={styles.socialModalBackdrop}>
          <View style={styles.socialModalCard}>
            <View style={styles.socialSheetHandle} />
            <View style={styles.socialModalHeader}>
              <Text style={styles.socialModalTitle}>
                {socialListMode === 'followers'
                  ? (i18n.t('followers') || 'Followers')
                  : (i18n.t('following') || 'Following')}
              </Text>
              <TouchableOpacity style={styles.socialModalClose} onPress={() => setSocialListMode(null)}>
                <Ionicons name="close" size={20} color="#111827" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={socialListMode === 'followers' ? followers : following}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => {
                const isFollowing = followingIds.includes(item.id);
                return (
                  <View style={styles.socialUserRow}>
                    {item.photo ? (
                      <Image source={{ uri: item.photo }} style={styles.socialAvatar} />
                    ) : (
                      <View style={styles.socialAvatarFallback}>
                        <Text style={styles.socialAvatarInitials}>{getInitials(item.name)}</Text>
                      </View>
                    )}
                    <View style={styles.socialUserTextWrap}>
                      <Text style={styles.socialUserName} numberOfLines={1}>{item.name}</Text>
                      <Text style={styles.socialUserMeta} numberOfLines={1}>
                        {item.role}{item.city ? ` · ${item.city}` : ''}
                      </Text>
                    </View>
                    {item.id !== auth.currentUser?.uid && (
                      <Animated.View style={{ transform: [{ scale: followAnim }] }}>
                        <TouchableOpacity
                          style={[styles.socialFollowBtn, isFollowing && styles.socialFollowBtnActive]}
                          onPress={() => handleToggleFollow(item).catch((error) => console.error('[Profile] Follow toggle failed:', error))}
                          activeOpacity={0.85}
                        >
                          <Text style={[styles.socialFollowText, isFollowing && styles.socialFollowTextActive]}>
                            {isFollowing ? (i18n.t('following') || 'Following') : (i18n.t('follow') || 'Follow')}
                          </Text>
                        </TouchableOpacity>
                      </Animated.View>
                    )}
                  </View>
                );
              }}
              ListEmptyComponent={
                <View style={styles.socialEmptyWrap}>
                  <Ionicons name="people-outline" size={44} color="#9ca3af" />
                  <Text style={styles.socialEmptyText}>
                    {socialListMode === 'followers'
                      ? (i18n.t('noFollowersYet') || 'No followers yet.')
                      : (i18n.t('notFollowingAnyoneYet') || 'Not following anyone yet.')}
                  </Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
    // --- Modern grid and profile tab styles (must be inside StyleSheet.create) ---
    gridRow: { gap: GRID_GAP },
    gridItem: {
      width: GRID_ITEM_SIZE,
      height: GRID_ITEM_SIZE,
      backgroundColor: '#111',
      marginBottom: GRID_GAP,
      position: 'relative',
    },
    gridMedia: { width: '100%', height: '100%' },
    videoGridTile: {
      flex: 1,
      backgroundColor: '#111827',
      alignItems: 'center',
      justifyContent: 'center',
    },
    gridTextFallback: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 8, backgroundColor: '#1f2937' },
    gridTextFallbackText: { color: '#e5e7eb', fontSize: 12, textAlign: 'center' },
    gridOverlay: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 8,
      paddingVertical: 6,
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    gridStatInline: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    gridStatText: { color: '#fff', fontSize: 11, fontWeight: '700' },
    videoBadge: {
      position: 'absolute',
      bottom: 6,
      right: 6,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    // --- Modern top bar, notification, CTA, and profile tab styles ---
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 18,
      paddingTop: Platform.OS === 'ios' ? 52 : 34,
      paddingBottom: 10,
    },
    topActionButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: 'rgba(255,255,255,0.08)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    topIdentity: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 8,
    },
    topHandle: { color: '#fff', fontSize: 20, fontWeight: '900', maxWidth: '82%' },
    notificationDot: {
      position: 'absolute',
      top: -3,
      right: -1,
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: '#ff2d55',
      borderWidth: 2,
      borderColor: '#05090c',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 4,
    },
    notificationDotText: { color: '#fff', fontSize: 11, fontWeight: '900' },
    ctaRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 22, marginTop: 16, marginBottom: 18 },
    editBtn: {
      flex: 1,
      height: 44,
      borderRadius: 9,
      backgroundColor: '#262b35',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: '#3b4250',
    },
    editBtnText: { color: '#fff', fontSize: 15, fontWeight: '900', width: '100%', textAlign: 'center' },
    shareBtn: {
      flex: 1,
      height: 44,
      borderRadius: 9,
      backgroundColor: '#262b35',
      alignItems: 'center',
      justifyContent: 'center',
    },
    shareBtnText: { color: '#fff', fontSize: 15, fontWeight: '900', width: '100%', textAlign: 'center' },
    profileTabsRow: {
      height: 60,
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: 1,
      borderBottomColor: '#1f2937',
    },
    profileTab: {
      flex: 1,
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    },
    profileTabActive: {
      borderBottomWidth: 2,
      borderBottomColor: '#fff',
    },
  container: { flex: 1, backgroundColor: '#000' },
  gradient: { flex: 1 },
  loaderWrap: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  listContent: { paddingBottom: 30 },
  profileSectorPager: { flex: 1 },
  /* Modern Profile Header Styles */
  profileHeaderModern: {
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 14,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 22,
    marginHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
  avatarRingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  avatarRing: {
    width: 102,
    height: 102,
    borderRadius: 51,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    borderWidth: 3,
    borderColor: '#fff',
    overflow: 'hidden',
  },
  avatarModern: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: '#222',
  },
  avatarFallbackModern: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#222',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  avatarAddButtonModern: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: '#6366f1',
    borderRadius: 14,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 3,
  },
  displayNameModern: {
    fontSize: 21,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 4,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  cityTextModern: {
    fontSize: 14,
    color: '#a5b4fc',
    marginTop: 2,
    marginBottom: 6,
    textAlign: 'center',
  },
  statsRowModern: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 2,
    gap: 12,
  },
  statBlockModern: {
    alignItems: 'center',
    marginHorizontal: 6,
    paddingHorizontal: 6,
  },
  statValueModern: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 2,
  },
  statLabelModern: {
    fontSize: 12,
    color: '#a5b4fc',
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  // ...existing code...
  pinnedBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    transform: [{ rotate: '35deg' }],
  },
  pinButton: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  pinButtonActive: {
    backgroundColor: 'rgba(37,99,235,0.9)',
    borderColor: '#93c5fd',
  },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 70 },
  emptyText: { color: '#d1d5db', fontSize: 16, marginTop: 10, marginBottom: 14 },
  emptyAction: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  emptyActionText: { color: '#111', fontWeight: '700' },
  postViewerScreen: {
    flex: 1,
    backgroundColor: '#0b0f14',
  },
  postViewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 56 : 28,
    paddingHorizontal: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  postViewerBackButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postViewerHeaderTextWrap: {
    flex: 1,
    alignItems: 'center',
  },
  postViewerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
  },
  postViewerSubtitle: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13,
    marginTop: 2,
    fontWeight: '700',
  },
  postViewerHeaderSpacer: {
    width: 42,
  },
  postViewerList: {
    paddingBottom: 40,
  },
  postViewerCard: {
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#0b0f14',
  },
  postViewerCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
  },
  postViewerIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  postViewerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1f2937',
  },
  postViewerAvatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
  },
  postViewerAvatarFallbackText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
  postViewerIdentityText: {
    marginLeft: 10,
    flex: 1,
  },
  postViewerAuthor: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  postViewerDate: {
    color: 'rgba(255,255,255,0.74)',
    fontSize: 12,
    marginTop: 2,
    fontWeight: '600',
  },
  postViewerStatsAction: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postViewerMediaWrap: {
    backgroundColor: '#000',
  },
  postViewerTextOnly: {
    marginHorizontal: 14,
    marginTop: 4,
    borderRadius: 18,
    backgroundColor: '#111827',
    padding: 18,
  },
  postViewerTextOnlyContent: {
    color: '#f9fafb',
    fontSize: 16,
    lineHeight: 24,
  },
  postViewerActionsWrap: {
    paddingHorizontal: 10,
    marginTop: 2,
  },
  postViewerStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 14,
    marginTop: 2,
  },
  postViewerStatsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  postViewerStatsText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  postViewerCaptionBlock: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 14,
    marginTop: 10,
  },
  postViewerCaptionAuthor: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
    marginRight: 6,
  },
  postViewerCaptionText: {
    color: '#f3f4f6',
    fontSize: 14,
    lineHeight: 21,
    flexShrink: 1,
  },
  fullScreenContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenCloseButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 52 : 34,
    right: 18,
    zIndex: 20,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenMedia: {
    width: '100%',
    height: '100%',
  },
  fullScreenStatsBar: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 40 : 24,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  fullScreenStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fullScreenStatText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 16 },
  modalCard: { backgroundColor: '#fff', borderRadius: 18, overflow: 'hidden' },
  modalClose: { position: 'absolute', right: 12, top: 12, zIndex: 10, backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 16, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  modalMedia: { width: '100%', height: 340, backgroundColor: '#111' },
  modalTextWrap: { padding: 18 },
  modalText: { color: '#111', fontSize: 15, lineHeight: 22 },
  modalStatsRow: { flexDirection: 'row', gap: 18, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' },
  modalStat: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  modalStatText: { fontSize: 14, fontWeight: '700', color: '#111827' },
  modalCaption: { color: '#374151', fontSize: 14, lineHeight: 20, paddingHorizontal: 16, paddingBottom: 16 },
  socialModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  socialModalCard: {
    maxHeight: '78%',
    minHeight: '42%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    overflow: 'hidden',
  },
  socialSheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#d1d5db',
    marginTop: 9,
    marginBottom: 3,
  },
  socialModalHeader: {
    height: 52,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  socialModalTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '900',
  },
  socialModalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialUserRow: {
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f9fafb',
  },
  socialAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#e5e7eb',
  },
  socialAvatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialAvatarInitials: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  socialUserTextWrap: {
    flex: 1,
    minWidth: 0,
    marginHorizontal: 10,
  },
  socialUserName: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '900',
  },
  socialUserMeta: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 3,
    textTransform: 'capitalize',
  },
  socialFollowBtn: {
    minWidth: 78,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  socialFollowBtnActive: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#10b981',
  },
  socialFollowText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
  },
  socialFollowTextActive: {
    color: '#065f46',
  },
  socialEmptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
  },
  socialEmptyText: {
    color: '#6b7280',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 12,
  },
  followBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 8,
    marginLeft: 8,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  followBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
});
