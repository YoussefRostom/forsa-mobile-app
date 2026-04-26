import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Modal,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  deleteComment,
  subscribeLikes,
  subscribeComments,
  subscribeReposts,
  LikeEntry,
  RepostEntry,
} from '../../services/SocialService';
import type { Comment } from '../../services/SocialService';
import i18n from '../../locales/i18n';
import { auth } from '../../lib/firebase';

type TabKey = 'likes' | 'comments' | 'reposts';

interface PostInteractionsSheetProps {
  postId: string | null;
  postOwnerId?: string | null;
  visible: boolean;
  onClose: () => void;
  initialTab?: TabKey;
}

const AVATAR_SIZE = 42;

function AvatarCircle({ photo, name }: { photo?: string | null; name?: string | null }) {
  if (photo) {
    return <Image source={{ uri: photo }} style={styles.avatar} />;
  }
  const safeName = name || '';
  const initials = safeName
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase();
  return (
    <View style={styles.avatarFallback}>
      <Text style={styles.avatarInitials}>{initials || '?'}</Text>
    </View>
  );
}

export default function PostInteractionsSheet({
  postId,
  postOwnerId,
  visible,
  onClose,
  initialTab = 'likes',
}: PostInteractionsSheetProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [likes, setLikes] = useState<LikeEntry[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [reposts, setReposts] = useState<RepostEntry[]>([]);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);

  const slideAnim = useRef(new Animated.Value(400)).current;

  useEffect(() => {
    if (visible) {
      setActiveTab(initialTab);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: 400,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, initialTab]);

  useEffect(() => {
    if (!visible || !postId) return;

    const unsubLikes = subscribeLikes(postId, setLikes);
    const unsubComments = subscribeComments(postId, setComments);
    const unsubReposts = subscribeReposts(postId, setReposts);

    return () => {
      unsubLikes();
      unsubComments();
      unsubReposts();
    };
  }, [visible, postId]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => gs.dy > 8,
      onPanResponderMove: (_, gs) => {
        if (gs.dy > 0) slideAnim.setValue(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 100) {
          onClose();
        } else {
          Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  const tabs: { key: TabKey; label: string; icon: any; count: number }[] = [
    { key: 'likes', label: i18n.t('likes') || 'Likes', icon: 'heart', count: likes.length },
    { key: 'comments', label: i18n.t('comments') || 'Comments', icon: 'chatbubble', count: comments.length },
    { key: 'reposts', label: i18n.t('reposts') || 'Reposts', icon: 'repeat', count: reposts.length },
  ];

  const tabColor: Record<TabKey, string> = {
    likes: '#ef4444',
    comments: '#38bdf8',
    reposts: '#34d399',
  };

  function renderLike({ item }: { item: LikeEntry }) {
    return (
      <View style={styles.row}>
        <AvatarCircle photo={item.actorPhoto} name={item.actorName} />
        <View style={styles.rowInfo}>
          <Text style={styles.rowName}>{item.actorName || 'Unknown'}</Text>
        </View>
        <Ionicons name="heart" size={16} color="#ef4444" />
      </View>
    );
  }

  const handleDeleteComment = (comment: Comment) => {
    if (!postId || deletingCommentId) return;

    Alert.alert(
      i18n.t('deleteComment') || 'Delete Comment',
      i18n.t('deleteCommentConfirm') || 'Are you sure you want to delete this comment?',
      [
        { text: i18n.t('cancel') || 'Cancel', style: 'cancel' },
        {
          text: i18n.t('delete') || 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingCommentId(comment.id);
              await deleteComment(postId, comment.id);
            } catch {
              Alert.alert(i18n.t('error') || 'Error', i18n.t('failedToDeleteComment') || 'Failed to delete comment');
            } finally {
              setDeletingCommentId(null);
            }
          },
        },
      ]
    );
  };

  function renderComment({ item }: { item: Comment }) {
    const currentUid = auth.currentUser?.uid;
    const canDelete = !!currentUid && (item.authorId === currentUid || postOwnerId === currentUid);
    return (
      <View style={styles.row}>
        <AvatarCircle photo={item.authorPhoto} name={item.authorName} />
        <View style={styles.rowInfo}>
          <Text style={styles.rowName}>{item.authorName || 'Unknown'}</Text>
          <Text style={styles.rowSub} numberOfLines={2}>{item.text}</Text>
        </View>
        {canDelete ? (
          <TouchableOpacity
            style={styles.rowAction}
            onPress={() => handleDeleteComment(item)}
            disabled={deletingCommentId === item.id}
            activeOpacity={0.7}
          >
            {deletingCommentId === item.id ? (
              <ActivityIndicator size="small" color="#ef4444" />
            ) : (
              <Ionicons name="trash-outline" size={16} color="#ef4444" />
            )}
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  function renderRepost({ item }: { item: RepostEntry }) {
    return (
      <View style={styles.row}>
        <AvatarCircle photo={item.actorPhoto} name={item.actorName} />
        <View style={styles.rowInfo}>
          <Text style={styles.rowName}>{item.actorName || 'Unknown'}</Text>
        </View>
        <Ionicons name="repeat" size={16} color="#34d399" />
      </View>
    );
  }

  function renderEmpty() {
    const labels: Record<TabKey, string> = {
      likes: i18n.t('noLikesYet') || 'No likes yet',
      comments: i18n.t('noComments') || 'No comments yet',
      reposts: i18n.t('noRepostsYet') || 'No reposts yet',
    };
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>{labels[activeTab]}</Text>
      </View>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
        {/* drag handle */}
        <View {...panResponder.panHandlers} style={styles.handleBar}>
          <View style={styles.handle} />
        </View>

        {/* tabs */}
        <View style={styles.tabsRow}>
          {tabs.map((t) => {
            const isActive = activeTab === t.key;
            return (
              <TouchableOpacity
                key={t.key}
                style={[styles.tab, isActive && { borderBottomColor: tabColor[t.key], borderBottomWidth: 2 }]}
                onPress={() => setActiveTab(t.key)}
                activeOpacity={0.8}
              >
                <Ionicons name={t.icon} size={15} color={isActive ? tabColor[t.key] : '#6b7280'} />
                <Text style={[styles.tabText, isActive && { color: tabColor[t.key] }]}>
                  {t.label} {t.count > 0 ? `(${t.count})` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* list */}
        {activeTab === 'likes' && (
          <FlatList
            data={likes}
            keyExtractor={(item) => item.userId}
            renderItem={renderLike}
            ListEmptyComponent={renderEmpty}
            contentContainerStyle={styles.listContent}
          />
        )}
        {activeTab === 'comments' && (
          <FlatList
            data={comments}
            keyExtractor={(item) => item.id}
            renderItem={renderComment}
            ListEmptyComponent={renderEmpty}
            contentContainerStyle={styles.listContent}
          />
        )}
        {activeTab === 'reposts' && (
          <FlatList
            data={reposts}
            keyExtractor={(item) => item.userId}
            renderItem={renderRepost}
            ListEmptyComponent={renderEmpty}
            contentContainerStyle={styles.listContent}
          />
        )}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
    minHeight: 300,
  },
  handleBar: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#4b5563',
  },
  tabsRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    marginHorizontal: 16,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 11,
  },
  tabText: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    paddingBottom: 30,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: '#262b35',
  },
  avatarFallback: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: '#262b35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    color: '#d1d5db',
    fontSize: 15,
    fontWeight: '700',
  },
  rowInfo: { flex: 1 },
  rowAction: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowName: { color: '#f3f4f6', fontSize: 14, fontWeight: '600' },
  rowSub: { color: '#9ca3af', fontSize: 12, marginTop: 2 },
  emptyWrap: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { color: '#6b7280', fontSize: 14 },
});
