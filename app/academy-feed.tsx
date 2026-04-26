import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { collection, doc, getDoc, onSnapshot, getFirestore, orderBy, query, where } from 'firebase/firestore';
import React, { useRef, useState } from 'react';
import { Animated, Easing, FlatList, Image, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
import { auth } from '../lib/firebase';
import FootballLoader from '../components/FootballLoader';

export default function AcademyFeedScreen() {
  const [feed, setFeed] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [fullScreenMedia, setFullScreenMedia] = useState<{ uri: string; type: 'image' | 'video' } | null>(null);
  const { openMenu } = useHamburgerMenu();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [academyPosts, setAcademyPosts] = useState<any[]>([]);
  const [adminPosts, setAdminPosts] = useState<any[]>([]);
  const [academyPostsReady, setAcademyPostsReady] = useState(false);
  const [adminPostsReady, setAdminPostsReady] = useState(false);
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string>('');
  const [currentUserPhoto, setCurrentUserPhoto] = useState<string | null>(null);

  // Merge academy posts and admin posts (deduplicate by post ID)
  React.useEffect(() => {
    const active = (p: any) => !p.status || p.status === 'active';
    const getTs = (p: any) => p.timestamp?.seconds ?? p.createdAt?.seconds ?? 0;
    
    // Combine both arrays and deduplicate by post ID
    const allPosts = [...academyPosts.filter(active), ...adminPosts.filter(active)];
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
  }, [academyPosts, adminPosts]);

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
      const name = data?.academyName || data?.name || fullName || data?.email || 'Academy';
      setCurrentUserName(name);
      const photo = data?.profilePhoto || data?.profilePic || data?.photo || data?.avatarUrl || null;
      setCurrentUserPhoto(photo);
    }).catch(() => {});
  }, []);

  const getAuthorAvatarUri = (item: any) => {
    const candidate = item?.authorPhoto || item?.ownerPhoto || item?.profilePhoto || item?.profilePic || item?.photo || item?.avatarUrl;
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
  };

  React.useEffect(() => {
    if (academyPostsReady && adminPostsReady) {
      setLoading(false);
    }
  }, [academyPostsReady, adminPostsReady]);

  React.useEffect(() => {
    setLoading(true);
    setAcademyPostsReady(false);
    setAdminPostsReady(false);
    
    // Check if user is authenticated before setting up listener
    const user = auth.currentUser;
    if (!user) {
      setFeed([]);
      setLoading(false);
      return;
    }
    
    const db = getFirestore();
    const postsRef = collection(db, 'posts');
    
    // Academy feed: Show posts where visibleToRoles array-contains "academy" OR ownerRole == "admin" AND status == "active"
    // Note: Firestore doesn't support OR in a single query, so we'll query admin posts separately and merge
    const q = query(
      postsRef,
      where('visibleToRoles', 'array-contains', 'academy'),
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

    // Set up real-time listeners for both queries
    const unsubscribe = onSnapshot(
      q,
      (querySnapshot) => {
        // Check authentication before processing
        if (!auth.currentUser) {
          setAcademyPosts([]);
          setAcademyPostsReady(true);
          setLoading(false);
          return;
        }
        
        const posts = querySnapshot.docs.map(doc => ({ 
          id: doc.id, 
          ...doc.data(),
          type: doc.data().ownerRole || 'unknown'
        }));
        setAcademyPosts(posts);
        setAcademyPostsReady(true);
      },
      (error) => {
        // Check if user is still authenticated before attempting fallback
        if (!auth.currentUser) {
          setFeed([]);
          setAcademyPostsReady(true);
          setLoading(false);
          return;
        }
        
        // Check if error is due to permissions (user logged out)
        if (error.code === 'permission-denied' || error.message?.includes('permission')) {
          // Silently handle permission errors (user likely logged out)
          setAcademyPosts([]);
          setAcademyPostsReady(true);
          setLoading(false);
          return;
        }
        
        console.error('Academy feed listener error:', error);
        // Fallback: try querying without status filter for backward compatibility
        const fallbackQ = query(
          postsRef,
          where('visibleToRoles', 'array-contains', 'academy'),
          orderBy('timestamp', 'desc')
        );

        fallbackUnsubscribe = onSnapshot(
          fallbackQ,
          (snapshot) => {
            // Check authentication again before processing
            if (!auth.currentUser) {
              if (fallbackUnsubscribe) fallbackUnsubscribe();
              setAcademyPosts([]);
              setAcademyPostsReady(true);
              setLoading(false);
              return;
            }
            
            const posts = snapshot.docs
              .map(doc => ({ 
                id: doc.id, 
                ...doc.data(),
                type: doc.data().ownerRole || 'unknown'
              }))
              .filter((post: any) => !post.status || post.status === 'active');
            setAcademyPosts(posts);
            setAcademyPostsReady(true);
          },
          (fallbackError) => {
            // Check if error is due to permissions
            if (fallbackError.code === 'permission-denied' || fallbackError.message?.includes('permission')) {
              // Silently handle permission errors
              if (fallbackUnsubscribe) fallbackUnsubscribe();
              setAcademyPosts([]);
              setAcademyPostsReady(true);
              return;
            }
            console.error('Academy feed fallback error:', fallbackError);
            setAcademyPosts([]);
            setAcademyPostsReady(true);
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
          setAdminPostsReady(true);
          return;
        }
        
        // Filter by status and sort client-side to avoid composite index
        const posts = querySnapshot.docs
          .map(doc => ({ 
            id: doc.id, 
            ...doc.data(),
            type: doc.data().ownerRole || 'unknown'
          }))
          .filter((post: any) => !post.status || post.status === 'active')
          .sort((a: any, b: any) => {
            const getTs = (p: any) => p.timestamp?.seconds ?? p.createdAt?.seconds ?? 0;
            return getTs(b) - getTs(a);
          });
        setAdminPosts(posts);
        setAdminPostsReady(true);
      },
      async (error) => {
        if (!auth.currentUser) {
          setAdminPosts([]);
          setAdminPostsReady(true);
          return;
        }
        
        if (error.code === 'permission-denied' || error.message?.includes('permission')) {
          setAdminPosts([]);
          setAdminPostsReady(true);
          return;
        }
        
        console.error('Academy feed (admin) error:', error?.message);
        setAdminPosts([]);
        setAdminPostsReady(true);
      }
    );

    // Cleanup listeners on unmount
    return () => {
      unsubscribe();
      unsubscribeAdmin();
      if (fallbackUnsubscribe) fallbackUnsubscribe();
    };
  }, []);

  const renderFeedItem = ({ item }: any) => {
    const timestamp = item.timestamp?.seconds 
      ? new Date(item.timestamp.seconds * 1000) 
      : item.createdAt?.seconds 
        ? new Date(item.createdAt.seconds * 1000)
        : null;
    const avatarUri = getAuthorAvatarUri(item);

    return (
      <View style={styles.feedCard}>
        <View style={styles.feedHeader}>
          <View style={styles.feedAuthorContainer}>
            <FeedAuthorAvatar uri={avatarUri} name={item.author} />
            <View style={styles.feedAuthorTextContainer}>
              <Text 
                style={[styles.feedAuthor, item.type === 'agent' && styles.feedAuthorAgent, item.type === 'player' && styles.feedAuthorPlayer]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {item.author || (i18n.t('unknown') || 'Unknown')}
              </Text>
              <Text style={styles.feedType}>
                {item.type === 'agent'
                  ? `(${i18n.t('agent') || 'Agent'})`
                  : item.type === 'player'
                    ? `(${i18n.t('player') || 'Player'})`
                    : `(${i18n.t('academy') || 'Academy'})`}
              </Text>
            </View>
          </View>
          <View style={styles.feedHeaderRight}>
            {timestamp && (
              <Text style={styles.feedTime}>
                {timestamp.toLocaleDateString()}
              </Text>
            )}
            <PostActionsMenu
              postId={item.id}
              postOwnerId={item.ownerId}
              postOwnerRole={item.ownerRole || item.type}
              mediaUrl={item.mediaUrl}
              mediaType={item.mediaType}
              contentText={item.content}
              postTimestamp={item.timestamp || item.createdAt}
            />
          </View>
        </View>
        
        <ZoomableFeedMedia post={item} />
        
        <Text style={styles.feedContent}>{item.content || ''}</Text>

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
          viewerRole="academy"
        />
      </View>
    );
  };

  const selectedCommentsPost = commentsPostId ? feed.find((p) => p.id === commentsPostId) : null;

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
              <Text style={styles.headerTitle}>{i18n.t('feed') || 'Feed'}</Text>
              <Text style={styles.headerSubtitle}>{i18n.t('latestUpdates') || 'Latest updates from the community'}</Text>
            </View>
      </View>

      <UploadProgressBanner />

      <HamburgerMenu />

      {loading ? (
            <View style={styles.loadingState}>
              <FootballLoader size="large" color="#fff" />
              <Text style={styles.loadingText}>{i18n.t('loading') || 'Loading...'}</Text>
            </View>
          ) : feed.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="newspaper-outline" size={64} color="#666" />
              <Text style={styles.emptyText}>{i18n.t('noPosts') || 'No posts yet.'}</Text>
              <Text style={styles.emptySubtext}>{i18n.t('beFirstToPost') || 'Be the first to share something!'}</Text>
            </View>
      ) : (
        <FlatList
          data={feed}
          renderItem={renderFeedItem}
          keyExtractor={item => item.id}
              contentContainerStyle={styles.feedList}
              showsVerticalScrollIndicator={false}
              initialNumToRender={5}
              maxToRenderPerBatch={6}
              windowSize={7}
              removeClippedSubviews={Platform.OS === 'android'}
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
  feedList: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  feedCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
  },
  feedHeader: {
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  feedHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  feedAuthorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    marginRight: 8,
  },
  feedAuthorTextContainer: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  feedAuthor: {
    fontWeight: 'bold',
    fontSize: 16,
    color: '#000',
  },
  feedAuthorAgent: {
    color: '#007AFF',
  },
  feedAuthorPlayer: {
    color: '#bfa100',
  },
  feedType: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  feedContent: {
    fontSize: 15,
    color: '#222',
    lineHeight: 22,
    marginTop: 12,
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
  feedTime: {
    fontSize: 12,
    color: '#999',
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
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    color: '#fff',
    marginTop: 12,
    fontSize: 16,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 40,
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
