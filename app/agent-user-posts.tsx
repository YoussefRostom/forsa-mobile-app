import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { collection, doc, getDoc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  FlatList,
  Image,
  Modal,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import FootballLoader from '../components/FootballLoader';
import CommentsSheet from '../components/feed/CommentsSheet';
import FeedVideoPreview from '../components/feed/FeedVideoPreview';
import PostRecentCommentsPreview from '../components/feed/PostRecentCommentsPreview';
import PostSocialActions from '../components/feed/PostSocialActions';
import ZoomableFeedMedia from '../components/feed/ZoomableFeedMedia';
import PostActionsMenu from '../components/PostActionsMenu';
import { auth, db } from '../lib/firebase';
import { fetchUserProfileByRole } from '../services/AgentDataService';
import { toggleFollow } from '../services/FollowService';

import i18n from '../locales/i18n';
import SuspendedBadge from '../components/SuspendedBadge';
import { isSuspendedEntity } from '../lib/suspension';

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_GAP = 2;
const GRID_ITEM_SIZE = Math.floor((SCREEN_WIDTH - GRID_GAP * 2) / 3);

const formatCount = (value: number) => {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
};

const getTimestamp = (post: any) => post?.pinnedAt?.seconds || post?.timestamp?.seconds || post?.createdAt?.seconds || 0;

const sortProfilePosts = (items: any[]) => [...items].sort((a, b) => {
  const pinnedDiff = Number(!!b.isPinned) - Number(!!a.isPinned);
  if (pinnedDiff !== 0) return pinnedDiff;
  return getTimestamp(b) - getTimestamp(a);
});

const isRepostEntry = (post: any) => Boolean(
  post?.isRepost ||
  post?.originalPostId ||
  post?.repostedAt
);

const getInitials = (name: string) => (
  name.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('') || 'U'
);

const getDisplayName = (profile: any, fallback: string) => {
  const full = `${profile?.firstName || ''} ${profile?.lastName || ''}`.trim();
  return profile?.name || profile?.displayName || full || fallback || 'Player';
};

const getHandle = (profile: any, name: string) => (
  profile?.username || String(name || 'player').toLowerCase().replace(/[^a-z0-9_]+/gi, '')
);

const getCityLabel = (cityKey: string) => {
  const key = String(cityKey || '').trim();
  if (!key) return '';
  const translated = String(i18n.t(`cities.${key}`));
  return translated && translated !== `cities.${key}` ? translated : key;
};

const getPositionLabel = (positionKey: string) => {
  const key = String(positionKey || '').trim();
  if (!key) return '';
  const translated = String(i18n.t(`positions.${key}`));
  return translated && translated !== `positions.${key}` ? translated : key;
};

const getAgeFromDob = (dob?: string) => {
  const value = String(dob || '').trim();
  if (!value) return null;
  const parts = value.split(/[-/]/).map((part) => parseInt(part, 10));
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;

  const year = parts[0] > 1900 ? parts[0] : parts[2];
  const month = parts[1];
  const day = parts[0] > 1900 ? parts[2] : parts[0];
  const dobDate = new Date(year, month - 1, day);
  if (Number.isNaN(dobDate.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - year;
  const hasHadBirthday =
    today.getMonth() > dobDate.getMonth() ||
    (today.getMonth() === dobDate.getMonth() && today.getDate() >= dobDate.getDate());
  if (!hasHadBirthday) age -= 1;
  return age >= 0 ? age : null;
};

const getPostDateLabel = (post: any) => {
  const raw = post?.timestamp || post?.createdAt || post?.pinnedAt;
  const date = raw?.toDate ? raw.toDate() : raw?.seconds ? new Date(raw.seconds * 1000) : null;
  return date ? date.toLocaleDateString() : '';
};

import { ActionSheetIOS, Alert } from 'react-native';
// import { blockUser, unblockUser } from '../services/BlockService';

export default function AgentUserPostsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ ownerId: string; ownerRole: string; userName: string; focusPostId?: string }>();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [posts, setPosts] = useState<any[]>([]);
  const [profileData, setProfileData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [activeTab, setActiveTab] = useState<'posts' | 'videos' | 'reposts'>('posts');
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState('');
  const [currentUserPhoto, setCurrentUserPhoto] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState('player');
  const profileTabs: Array<'posts' | 'videos' | 'reposts'> = ['posts', 'videos', 'reposts'];
  // Block state removed

  // Show action sheet for report only
  const showMoreMenu = () => {
    const options = [i18n.t('cancel') || 'Cancel', i18n.t('reportUser') || 'Report User'];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          destructiveButtonIndex: 1,
          cancelButtonIndex: 0,
          userInterfaceStyle: 'dark',
        },
        (buttonIndex) => {
          if (buttonIndex === 1) handleReportUser();
        }
      );
    } else {
      setMenuVisible(true);
    }
  };


  const handleReportUser = () => {
    Alert.alert(i18n.t('reportUser') || 'Report User', i18n.t('reportUserDesc') || 'This will flag the user for review.', [
      { text: i18n.t('cancel') || 'Cancel', style: 'cancel' },
      { text: i18n.t('report') || 'Report', style: 'destructive', onPress: () => {/* TODO: Implement actual report logic */} },
    ]);
  };




  const ownerId = String(params.ownerId || '');
  const ownerRole = String(params.ownerRole || 'player').toLowerCase();

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 450,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    getDoc(doc(db, 'users', user.uid))
      .then((snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        const fullName = `${data?.firstName || ''} ${data?.lastName || ''}`.trim();
        const name = data?.username || data?.name || fullName || data?.email || 'User';
        setCurrentUserName(name);
        setCurrentUserPhoto(data?.profilePhoto || data?.profilePic || data?.photo || null);
        setCurrentUserRole(String(data?.role || 'player').toLowerCase());
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!ownerId || !auth.currentUser) {
      setLoading(false);
      setLoadingProfile(false);
      return;
    }

    setLoadingProfile(true);
    fetchUserProfileByRole(ownerId, ownerRole)
      .then(setProfileData)
      .catch(() => setProfileData(null))
      .finally(() => setLoadingProfile(false));

    const postsRef = collection(db, 'posts');
    const q = query(postsRef, where('ownerId', '==', ownerId), orderBy('timestamp', 'desc'));
    const unsubPosts = onSnapshot(q, (snap) => {
      const list = snap.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((post: any) => !post.status || post.status === 'active');
      setPosts(list);
      setLoading(false);
    }, () => {
      setPosts([]);
      setLoading(false);
    });

    const unsubFollowers = onSnapshot(collection(db, `users/${ownerId}/followers`), (snap) => {
      setFollowersCount(snap.size);
    }, () => setFollowersCount(0));

    const unsubFollowing = onSnapshot(collection(db, `users/${ownerId}/following`), (snap) => {
      setFollowingCount(snap.size);
    }, () => setFollowingCount(0));

    const currentUid = auth.currentUser?.uid;
    const unsubFollowState = currentUid && currentUid !== ownerId
      ? onSnapshot(doc(db, `users/${currentUid}/following/${ownerId}`), (snap) => setIsFollowing(snap.exists()), () => setIsFollowing(false))
      : () => {};

    return () => {
      unsubPosts();
      unsubFollowers();
      unsubFollowing();
      unsubFollowState();
    };
  }, [ownerId, ownerRole]);

  const displayName = getDisplayName(profileData, String(params.userName || 'Player'));
  const handle = getHandle(profileData, displayName);
  const photo = profileData?.profilePhoto || profileData?.profilePic || profileData?.photo || null;
  const bio = profileData?.description || profileData?.bio || '';
  const city = getCityLabel(profileData?.city || '');
  const playerPosition = ownerRole === 'player' ? getPositionLabel(profileData?.position || '') : '';
  const playerAge = ownerRole === 'player' ? getAgeFromDob(profileData?.dob) : null;
  const profileSuspended = isSuspendedEntity(profileData);
  const visiblePosts = useMemo(() => {
    if (activeTab === 'videos') {
      return sortProfilePosts(posts.filter((post: any) => !isRepostEntry(post) && post.mediaType === 'video'));
    }
    if (activeTab === 'reposts') {
      return sortProfilePosts(posts.filter((post: any) => isRepostEntry(post)));
    }
    return sortProfilePosts(posts.filter((post: any) => !isRepostEntry(post)));
  }, [activeTab, posts]);
  const selectedPost = selectedPostId ? visiblePosts.find((post: any) => post.id === selectedPostId) || null : null;
  const detailPosts = useMemo(() => {
    if (!selectedPostId) return [];
    const startIndex = visiblePosts.findIndex((post: any) => post.id === selectedPostId);
    return startIndex >= 0 ? visiblePosts.slice(startIndex) : visiblePosts;
  }, [selectedPostId, visiblePosts]);
  const selectedCommentsPost = commentsPostId
    ? visiblePosts.find((post: any) => post.id === commentsPostId) || posts.find((post: any) => post.id === commentsPostId) || null
    : null;

  useEffect(() => {
    if (!params.focusPostId || !posts.length) return;
    const match = posts.find((post: any) => post.id === params.focusPostId || post.originalPostId === params.focusPostId);
    if (!match) return;
    setActiveTab(isRepostEntry(match) ? 'reposts' : match.mediaType === 'video' ? 'videos' : 'posts');
    setSelectedPostId(match.id);
  }, [params.focusPostId, posts]);

  const handleToggleFollow = async () => {
    if (!ownerId || ownerId === auth.currentUser?.uid) return;
    setIsFollowing((prev) => !prev);
    try {
      await toggleFollow(ownerId, ownerRole, displayName, photo || '');
    } catch (error) {
      setIsFollowing((prev) => !prev);
      console.error('[PublicProfile] Follow toggle failed:', error);
    }
  };

  const handleMessage = () => {
    if (!ownerId || ownerId === auth.currentUser?.uid) return;
    router.push({
      pathname: '/player-chat',
      params: { otherUserId: ownerId, name: displayName },
    } as any);
  };

  const switchProfileTabBySwipe = React.useCallback((direction: 'left' | 'right') => {
    setActiveTab((current) => {
      const currentIndex = profileTabs.indexOf(current);
      if (currentIndex === -1) return current;
      const nextIndex = direction === 'left'
        ? Math.min(profileTabs.length - 1, currentIndex + 1)
        : Math.max(0, currentIndex - 1);
      return profileTabs[nextIndex] || current;
    });
  }, []);

  const profileSwipeResponder = React.useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dx) > 18 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.35,
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx <= -48) {
          switchProfileTabBySwipe('left');
        } else if (gestureState.dx >= 48) {
          switchProfileTabBySwipe('right');
        }
      },
    })
  ).current;

  const renderPostTile = ({ item }: { item: any }) => {
    const isVideo = item.mediaType === 'video';
    return (
      <TouchableOpacity
        activeOpacity={0.9}
        style={styles.gridItem}
        onPress={() => setSelectedPostId(item.id)}
      >
        {isVideo ? (
          <FeedVideoPreview uri={item.mediaUrl} style={styles.videoGridTile} iconSize={24} />
        ) : item.mediaUrl ? (
          <Image source={{ uri: item.mediaUrl }} style={styles.gridMedia} />
        ) : (
          <View style={styles.gridTextFallback}>
            <Text style={styles.gridTextFallbackText} numberOfLines={5}>{item.content || 'Post'}</Text>
          </View>
        )}
        {item.isPinned && (
          <View style={styles.pinBadge}>
            <Ionicons name="pin" size={18} color="#fff" />
          </View>
        )}
        {isVideo && (
          <View style={styles.videoBadge}>
            <Ionicons name="play" size={13} color="#fff" />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderDetailPost = ({ item }: { item: any }) => {
    const timestampLabel = getPostDateLabel(item);
    const initials = getInitials(displayName);

    return (
      <View style={styles.detailPostCard}>
        <View style={styles.detailPostHeader}>
          <View style={styles.detailAuthorRow}>
            {photo ? (
              <Image source={{ uri: photo }} style={styles.detailAvatar} />
            ) : (
              <View style={styles.detailAvatarFallback}>
                <Text style={styles.detailAvatarInitials}>{initials}</Text>
              </View>
            )}
            <View style={styles.detailAuthorText}>
              <Text style={styles.detailAuthorName}>{displayName}</Text>
              {!!timestampLabel && <Text style={styles.detailPostDate}>{timestampLabel}</Text>}
            </View>
          </View>
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

        <ZoomableFeedMedia post={item} />

        <PostSocialActions
          post={item}
          onCommentPress={() => setCommentsPostId(item.id)}
          currentUserName={currentUserName}
          currentUserPhoto={currentUserPhoto}
          viewerRole={currentUserRole}
        />

        {!!item.content && (
          <View style={styles.detailCaptionWrap}>
            <Text style={styles.detailCaptionName}>{displayName}</Text>
            <Text style={styles.detailCaptionText}>{item.content}</Text>
          </View>
        )}

        <PostRecentCommentsPreview
          postId={item.id}
          onPressOpenComments={() => setCommentsPostId(item.id)}
        />

        {item.isRepost && (
          <View style={styles.detailRepostBadge}>
            <Ionicons name="repeat-outline" size={13} color="#34d399" />
            <Text style={styles.detailRepostText}>
              {i18n.t('repostedBy') || 'Reposted'}{item.originalAuthorName ? ` · ${item.originalAuthorName}` : ''}
            </Text>
          </View>
        )}
      </View>
    );
  };

  if (loading || loadingProfile) {
    return (
      <View style={styles.loaderWrap}>
        <FootballLoader size="large" color="#fff" />
      </View>
    );
  }



  return (
    <View style={styles.container}>
      <LinearGradient colors={['#05090c', '#071014', '#05090c']} style={styles.gradient}>
        <Animated.View style={{ flex: 1, opacity: fadeAnim }} {...profileSwipeResponder.panHandlers}>
          <FlatList
            data={visiblePosts}
            renderItem={renderPostTile}
            keyExtractor={(item) => item.id}
            numColumns={3}
            columnWrapperStyle={styles.gridRow}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
              <View style={styles.profileWrap}>
                <View style={styles.topBar}>
                  <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
                    <Ionicons name="chevron-back" size={32} color="#fff" />
                  </TouchableOpacity>
                  <Text style={styles.topHandle} numberOfLines={1}>{handle}</Text>
                  <TouchableOpacity style={styles.iconButton} onPress={showMoreMenu}>
                    <Ionicons name="ellipsis-horizontal" size={25} color="#fff" />
                  </TouchableOpacity>
                </View>
      {/* Android custom menu modal */}
      {Platform.OS !== 'ios' && menuVisible && (
        <Modal
          visible={menuVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setMenuVisible(false)}
        >
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: '#222', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18 }}>
              <TouchableOpacity onPress={handleReportUser} style={{ paddingVertical: 16 }}>
                <Text style={{ color: '#ff5252', fontSize: 18, fontWeight: '700', textAlign: 'center' }}>{i18n.t('reportUser') || 'Report User'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setMenuVisible(false)} style={{ paddingVertical: 16 }}>
                <Text style={{ color: '#fff', fontSize: 18, textAlign: 'center' }}>{i18n.t('cancel') || 'Cancel'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}


                {/* Modern, centered, animated profile header */}
                <View style={styles.profileHeaderModern}>
                  <Animated.View style={[styles.avatarRingWrap, { opacity: fadeAnim, transform: [{ scale: fadeAnim }] }]}>  
                    <LinearGradient
                      colors={["#38bdf8", "#6366f1", "#a21caf"]}
                      style={styles.avatarRingModern}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    >
                      {photo ? (
                        <Image source={{ uri: photo }} style={styles.avatarModern} />
                      ) : (
                        <View style={styles.avatarFallbackModern}>
                          <Ionicons name="person" size={48} color="#d1d5db" />
                        </View>
                      )}
                    </LinearGradient>
                  </Animated.View>
                  <Text style={styles.displayNameModern}>{displayName}</Text>
                  {profileSuspended && <SuspendedBadge />}
                  {!!city && <Text style={styles.cityTextModern}>{city}</Text>}
                  {(!!playerPosition || playerAge !== null) && (
                    <Text style={styles.playerMetaTextModern}>
                      {[playerPosition, playerAge !== null ? `${i18n.t('age') || 'Age'} ${playerAge}` : ''].filter(Boolean).join(' · ')}
                    </Text>
                  )}
                  <View style={styles.statsRowModern}>
                    <View style={styles.statBlockModern}>
                      <Text style={styles.statValueModern}>{formatCount(posts.length)}</Text>
                      <Text style={styles.statLabelModern}>{i18n.t('post') || 'Posts'}</Text>
                    </View>
                    <View style={styles.statBlockModern}>
                      <Text style={styles.statValueModern}>{formatCount(followersCount)}</Text>
                      <Text style={styles.statLabelModern}>{i18n.t('followers') || 'Followers'}</Text>
                    </View>
                    <View style={styles.statBlockModern}>
                      <Text style={styles.statValueModern}>{formatCount(followingCount)}</Text>
                      <Text style={styles.statLabelModern}>{i18n.t('following') || 'Following'}</Text>
                    </View>
                  </View>
                </View>

                {!!bio && <Text style={styles.bioText}>{bio}</Text>}
                {!!city && (
                  <View style={styles.linkRow}>
                    <Ionicons name="location-outline" size={18} color="#fff" />
                    <Text style={styles.linkText}>{city}</Text>
                  </View>
                )}
                {(!!playerPosition || playerAge !== null) && (
                  <View style={styles.linkRow}>
                    <Ionicons name="shield-outline" size={18} color="#fff" />
                    <Text style={styles.linkText}>
                      {[playerPosition, playerAge !== null ? `${i18n.t('age') || 'Age'} ${playerAge}` : ''].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                )}

                {ownerId !== auth.currentUser?.uid && (
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={[styles.followButton, isFollowing && styles.followingButton]}
                      onPress={handleToggleFollow}
                      activeOpacity={0.88}
                    >
                      <Text style={[styles.followButtonText, isFollowing && styles.followingButtonText]}>
                        {isFollowing ? (i18n.t('following') || 'Following') : (i18n.t('follow') || 'Follow')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.messageButton} onPress={handleMessage} activeOpacity={0.88}>
                      <Text style={styles.messageButtonText}>{i18n.t('message') || 'Message'}</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <View style={styles.profileTabs}>
                  <TouchableOpacity
                    style={[styles.profileTab, activeTab === 'posts' && styles.profileTabActive]}
                    onPress={() => setActiveTab('posts')}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="grid" size={28} color={activeTab === 'posts' ? '#fff' : '#8b949e'} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.profileTab, activeTab === 'videos' && styles.profileTabActive]}
                    onPress={() => setActiveTab('videos')}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="play-circle-outline" size={30} color={activeTab === 'videos' ? '#fff' : '#8b949e'} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.profileTab, activeTab === 'reposts' && styles.profileTabActive]}
                    onPress={() => setActiveTab('reposts')}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="repeat-outline" size={30} color={activeTab === 'reposts' ? '#fff' : '#8b949e'} />
                  </TouchableOpacity>
                </View>
              </View>
            }
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons
                  name={activeTab === 'videos' ? 'play-circle-outline' : activeTab === 'reposts' ? 'repeat-outline' : 'images-outline'}
                  size={48}
                  color="#6b7280"
                />
                <Text style={styles.emptyText}>
                  {activeTab === 'videos'
                    ? (i18n.t('noVideosYet') || 'No videos yet.')
                    : activeTab === 'reposts'
                      ? (i18n.t('noRepostsYet') || 'No reposts yet.')
                      : (i18n.t('noPosts') || 'No posts yet.')}
                </Text>
              </View>
            }
          />
        </Animated.View>
      </LinearGradient>

      <Modal visible={!!selectedPost} transparent={false} animationType="slide" onRequestClose={() => setSelectedPostId(null)}>
        <View style={styles.postViewerContainer}>
          <View style={styles.postViewerHeader}>
            <TouchableOpacity style={styles.postViewerBackButton} onPress={() => setSelectedPostId(null)}>
              <Ionicons name="chevron-back" size={28} color="#fff" />
            </TouchableOpacity>
            <View style={styles.postViewerHeaderTextWrap}>
              <Text style={styles.postViewerTitle}>{i18n.t('posts') || 'Posts'}</Text>
              <Text style={styles.postViewerSubtitle} numberOfLines={1}>{handle}</Text>
            </View>
            <View style={styles.postViewerHeaderSpacer} />
          </View>

          <FlatList
            data={detailPosts}
            renderItem={renderDetailPost}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.postViewerListContent}
          />
        </View>
      </Modal>

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
  container: { flex: 1, backgroundColor: '#05090c' },
  gradient: { flex: 1 },
  loaderWrap: { flex: 1, backgroundColor: '#05090c', justifyContent: 'center', alignItems: 'center' },
  listContent: { paddingBottom: 28 },
  profileWrap: { paddingTop: Platform.OS === 'ios' ? 54 : 28 },
  topBar: {
    height: 54,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  topHandle: { flex: 1, color: '#fff', fontSize: 28, fontWeight: '900', marginHorizontal: 8 },
  profileHeaderModern: {
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 18,
    paddingVertical: 18,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 28,
    marginHorizontal: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
  avatarRingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  avatarRingModern: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    borderWidth: 3,
    borderColor: '#fff',
    overflow: 'hidden',
  },
  avatarModern: {
    width: 104,
    height: 104,
    borderRadius: 52,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: '#222',
  },
  avatarFallbackModern: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: '#222',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  displayNameModern: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 6,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  cityTextModern: {
    fontSize: 15,
    color: '#a5b4fc',
    marginTop: 2,
    marginBottom: 4,
    textAlign: 'center',
  },
  playerMetaTextModern: {
    fontSize: 13,
    color: '#d1d5db',
    marginBottom: 8,
    textAlign: 'center',
    fontWeight: '700',
  },
  statsRowModern: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    marginBottom: 2,
    gap: 18,
  },
  statBlockModern: {
    alignItems: 'center',
    marginHorizontal: 10,
    paddingHorizontal: 8,
  },
  statValueModern: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 2,
  },
  statLabelModern: {
    fontSize: 13,
    color: '#a5b4fc',
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  bioText: { color: '#fff', fontSize: 18, fontWeight: '700', lineHeight: 23, paddingHorizontal: 18, marginTop: 16 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, marginTop: 8 },
  linkText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  actionRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 18, marginTop: 18 },
  followButton: {
    flex: 1,
    height: 44,
    borderRadius: 9,
    backgroundColor: '#405cff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  followingButton: { backgroundColor: '#26303a', borderWidth: 1, borderColor: '#374151' },
  followButtonText: { color: '#fff', fontSize: 18, fontWeight: '900' },
  followingButtonText: { color: '#fff' },
  messageButton: {
    flex: 1,
    height: 44,
    borderRadius: 9,
    backgroundColor: '#26303a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageButtonText: { color: '#fff', fontSize: 18, fontWeight: '900' },
  profileTabs: {
    height: 62,
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  profileTab: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center' },
  profileTabActive: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: '#fff',
  },
  gridRow: { gap: GRID_GAP },
  gridItem: {
    width: GRID_ITEM_SIZE,
    height: GRID_ITEM_SIZE,
    marginBottom: GRID_GAP,
    backgroundColor: '#111827',
  },
  gridMedia: { width: '100%', height: '100%' },
  videoGridTile: {
    flex: 1,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridTextFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 8, backgroundColor: '#17202b' },
  gridTextFallbackText: { color: '#fff', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  pinBadge: { position: 'absolute', top: 8, right: 8, transform: [{ rotate: '35deg' }] },
  videoBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 70 },
  emptyText: { color: '#d1d5db', fontSize: 16, fontWeight: '800', marginTop: 12 },
  postViewerContainer: {
    flex: 1,
    backgroundColor: '#05090c',
  },
  postViewerHeader: {
    paddingTop: Platform.OS === 'ios' ? 54 : 24,
    paddingHorizontal: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#17212b',
    flexDirection: 'row',
    alignItems: 'center',
  },
  postViewerBackButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postViewerHeaderTextWrap: {
    flex: 1,
    alignItems: 'center',
  },
  postViewerHeaderSpacer: {
    width: 42,
  },
  postViewerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
  },
  postViewerSubtitle: {
    color: '#e5e7eb',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  postViewerListContent: {
    paddingBottom: 30,
  },
  detailPostCard: {
    borderBottomWidth: 1,
    borderBottomColor: '#17212b',
    paddingBottom: 10,
    marginBottom: 6,
  },
  detailPostHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  detailAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  detailAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    marginRight: 10,
  },
  detailAvatarFallback: {
    width: 38,
    height: 38,
    borderRadius: 19,
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f2937',
  },
  detailAvatarInitials: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 13,
  },
  detailAuthorText: {
    flex: 1,
    minWidth: 0,
  },
  detailAuthorName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
  },
  detailPostDate: {
    color: '#d1d5db',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  detailCaptionWrap: {
    paddingHorizontal: 14,
    paddingTop: 4,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  detailCaptionName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
  },
  detailCaptionText: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 22,
    flexShrink: 1,
  },
  detailRepostBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 14,
    marginTop: 8,
  },
  detailRepostText: {
    color: '#a7f3d0',
    fontSize: 12,
    fontWeight: '700',
  },
});
