import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { collection, doc, getDoc, getFirestore, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import React, { useRef } from 'react';
import { Animated, Easing, FlatList, Image, Platform, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import FootballLoader from '../components/FootballLoader';
import HamburgerMenu from '../components/HamburgerMenu';
import FloatingHamburgerButton from '../components/FloatingHamburgerButton';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import { useScrollAwareHeader } from '../hooks/useScrollAwareHeader';
import PostActionsMenu from '../components/PostActionsMenu';
import CommentsSheet from '../components/feed/CommentsSheet';
import PostSocialActions from '../components/feed/PostSocialActions';
import ZoomableFeedMedia from '../components/feed/ZoomableFeedMedia';
import { auth } from '../lib/firebase';
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
  switch (String(role || '').toLowerCase()) {
    case 'player':
      return {
        icon: 'person-outline' as const,
        label: i18n.t('playerRoleLabel') || 'Player',
        backgroundColor: '#eff6ff',
        color: '#1d4ed8',
      };
    case 'parent':
      return {
        icon: 'people-outline' as const,
        label: i18n.t('parentRoleLabel') || 'Parent',
        backgroundColor: '#ecfdf5',
        color: '#047857',
      };
    case 'agent':
      return {
        icon: 'briefcase-outline' as const,
        label: i18n.t('agentRoleLabel') || 'Agent',
        backgroundColor: '#fff7ed',
        color: '#c2410c',
      };
    case 'academy':
      return {
        icon: 'school-outline' as const,
        label: i18n.t('academyRoleLabel') || 'Academy',
        backgroundColor: '#eff6ff',
        color: '#1d4ed8',
      };
    case 'clinic':
      return {
        icon: 'medkit-outline' as const,
        label: i18n.t('clinicRoleLabel') || 'Clinic',
        backgroundColor: '#ecfeff',
        color: '#0e7490',
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
        backgroundColor: '#eff6ff',
        color: '#1d4ed8',
      };
  }
};

export default function ParentFeedScreen() {
  const router = useRouter();
  const { openMenu } = useHamburgerMenu();
  const [feed, setFeed] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const { onScroll: onScrollAware, floatingMenuAnim } = useScrollAwareHeader();
  const [parentPosts, setParentPosts] = React.useState<any[]>([]);
  const [adminPosts, setAdminPosts] = React.useState<any[]>([]);
  const [commentsPostId, setCommentsPostId] = React.useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = React.useState<string>('');
  const [currentUserPhoto, setCurrentUserPhoto] = React.useState<string | null>(null);

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
      const name = data?.name || fullName || data?.email || 'Parent';
      setCurrentUserName(name);
      const photo = data?.profilePhoto || data?.profilePic || data?.photo || data?.avatarUrl || null;
      setCurrentUserPhoto(photo);
    }).catch(() => {});
  }, []);

  const handleRefresh = React.useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 700);
  }, []);

  React.useEffect(() => {
    const active = (p: any) => !p.status || p.status === 'active';
    const getTs = (p: any) => p.timestamp?.seconds ?? p.createdAt?.seconds ?? 0;

    const allPosts = [...parentPosts.filter(active), ...adminPosts.filter(active)];
    const uniquePostsMap = new Map<string, any>();

    allPosts.forEach((post) => {
      if (post.id) uniquePostsMap.set(post.id, post);
    });

    const merged = Array.from(uniquePostsMap.values()).sort((a, b) => getTs(b) - getTs(a));
    setFeed(merged);
  }, [parentPosts, adminPosts]);

  React.useEffect(() => {
    setLoading(true);
    const user = auth.currentUser;
    if (!user) {
      setParentPosts([]);
      setAdminPosts([]);
      setLoading(false);
      return;
    }

    const db = getFirestore();
    const postsRef = collection(db, 'posts');
    const qParent = query(
      postsRef,
      where('visibleToRoles', 'array-contains', 'parent'),
      where('status', '==', 'active'),
      orderBy('timestamp', 'desc')
    );
    const qAdmin = query(postsRef, where('ownerRole', '==', 'admin'));
    let unsubParentFallback: (() => void) | null = null;

    const unsubParent = onSnapshot(
      qParent,
      (snap) => {
        if (!auth.currentUser) {
          setParentPosts([]);
          return;
        }

        const posts = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((post: any) => !post.status || post.status === 'active');
        setParentPosts(posts);
      },
      (err: any) => {
        if (err?.code === 'permission-denied' || err?.message?.includes('permission')) {
          setParentPosts([]);
          return;
        }

        const needsIndex = String(err?.message || '').toLowerCase().includes('requires an index');
        if (!needsIndex) {
          console.error('Parent feed (parent posts) error:', err?.message);
          setParentPosts([]);
          return;
        }

        // Fallback avoids composite index by removing filters/sort from server query.
        const fallbackQ = query(postsRef, where('visibleToRoles', 'array-contains', 'parent'));
        unsubParentFallback = onSnapshot(
          fallbackQ,
          (snap) => {
            if (!auth.currentUser) {
              setParentPosts([]);
              return;
            }

            const posts = snap.docs
              .map((d) => ({ id: d.id, ...d.data() }))
              .filter((post: any) => !post.status || post.status === 'active')
              .sort((a: any, b: any) => {
                const getTs = (p: any) => p.timestamp?.seconds ?? p.createdAt?.seconds ?? 0;
                return getTs(b) - getTs(a);
              });
            setParentPosts(posts);
          },
          (fallbackErr: any) => {
            if (fallbackErr?.code === 'permission-denied' || fallbackErr?.message?.includes('permission')) {
              setParentPosts([]);
              return;
            }
            console.error('Parent feed (parent fallback) error:', fallbackErr?.message);
            setParentPosts([]);
          }
        );
      }
    );

    const unsubAdmin = onSnapshot(
      qAdmin,
      (snap) => {
        if (!auth.currentUser) {
          setAdminPosts([]);
          return;
        }

        const posts = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((post: any) => !post.status || post.status === 'active')
          .sort((a: any, b: any) => {
            const getTs = (p: any) => p.timestamp?.seconds ?? p.createdAt?.seconds ?? 0;
            return getTs(b) - getTs(a);
          });
        setAdminPosts(posts);
      },
      (err: any) => {
        if (err?.code === 'permission-denied' || err?.message?.includes('permission')) {
          setAdminPosts([]);
          return;
        }
        console.error('Parent feed (admin posts) error:', err?.message);
        setAdminPosts([]);
      }
    );

    const t = setTimeout(() => setLoading(false), 800);

    return () => {
      unsubParent();
      if (unsubParentFallback) unsubParentFallback();
      unsubAdmin();
      clearTimeout(t);
    };
  }, []);

  const renderFeedItem = (item: any) => {
    const timestamp = item.timestamp?.seconds
      ? new Date(item.timestamp.seconds * 1000)
      : item.createdAt?.seconds
        ? new Date(item.createdAt.seconds * 1000)
        : null;
    const roleMeta = getRoleBadgeMeta(item.ownerRole || item.authorRole || item.role);
    const avatarUri = getAuthorAvatarUri(item);
    const taggedNames = Array.isArray(item.taggedUserNames)
      ? item.taggedUserNames.filter(Boolean)
      : Array.isArray(item.taggedUsers)
        ? item.taggedUsers.map((entry: any) => (typeof entry === 'string' ? entry : entry?.name)).filter(Boolean)
        : [];

    return (
      <View key={item.id} style={styles.feedItem}>
        <View style={styles.feedHeader}>
          <View style={styles.feedAuthorContainer}>
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
          </View>
          <View style={styles.feedHeaderRight}>
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
          viewerRole="parent"
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
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
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
              data={feed}
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

                  <View style={styles.composerCard}>
                    <View style={styles.composerTopRow}>
                      <View style={styles.composerAvatar}>
                        <Ionicons name="people" size={18} color="#111827" />
                      </View>
                      <View style={styles.composerTextWrap}>
                        <Text style={styles.composerTitle}>{i18n.t('exploreForYourChild') || 'Explore options for your child'}</Text>
                        <Text style={styles.composerSubtitle}>{i18n.t('findAcademiesClinicsFast') || 'Quickly jump to academies, clinics, and active bookings.'}</Text>
                      </View>
                    </View>

                    <View style={styles.quickActionRow}>
                      <TouchableOpacity style={styles.primaryActionButton} onPress={() => router.push('/parent-search-academies' as any)}>
                        <Ionicons name="school-outline" size={16} color="#fff" />
                        <Text style={styles.primaryActionText}>{i18n.t('searchAcademies') || 'Search Academies'}</Text>
                      </TouchableOpacity>

                      <TouchableOpacity style={styles.secondaryActionButton} onPress={() => router.push('/parent-search-clinics' as any)}>
                        <Ionicons name="medkit-outline" size={16} color="#111827" />
                        <Text style={styles.secondaryActionText}>{i18n.t('searchClinics') || 'Search Clinics'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              }
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Ionicons name="document-text-outline" size={64} color="rgba(255, 255, 255, 0.3)" />
                  <Text style={styles.emptyText}>{i18n.t('noPosts') || 'No posts yet.'}</Text>
                  <Text style={styles.emptySubtext}>{i18n.t('checkBackSoon') || 'Check back soon for updates from academies and clinics.'}</Text>
                  <TouchableOpacity style={styles.emptyActionButton} onPress={() => router.push('/parent-bookings' as any)}>
                    <Text style={styles.emptyActionText}>{i18n.t('viewMyBookings') || 'View My Bookings'}</Text>
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
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000',
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
    marginTop: 8,
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
