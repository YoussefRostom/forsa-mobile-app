import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { subscribeComments, addComment, deleteComment, Comment } from '../../services/SocialService';
import i18n from '../../locales/i18n';
import { auth } from '../../lib/firebase';

interface CommentsSheetProps {
  postId: string;
  postOwnerId?: string;
  visible: boolean;
  onClose: () => void;
  currentUserName?: string;
  currentUserPhoto?: string | null;
}

const formatCommentTime = (ts: any) => {
  const date = ts?.toDate
    ? ts.toDate()
    : ts?.seconds
    ? new Date(ts.seconds * 1000)
    : null;
  if (!date) return '';
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
};

const getInitials = (name: string) =>
  (name || 'U')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

export default function CommentsSheet({
  postId,
  postOwnerId,
  visible,
  onClose,
  currentUserName,
  currentUserPhoto,
}: CommentsSheetProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!visible) return;
    const unsub = subscribeComments(postId, (c) => {
      setComments(c);
      // Auto-scroll to bottom when new comments arrive
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    });
    return unsub;
  }, [postId, visible]);

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await addComment(postId, trimmed, currentUserName || 'Player', currentUserPhoto, postOwnerId);
      setText('');
    } catch {
      // silent
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteComment = (comment: Comment) => {
    if (deletingCommentId) return;

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

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.sheet}
      >
        {/* Handle bar */}
        <View style={styles.handle} />

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{i18n.t('comments') || 'Comments'}</Text>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="close" size={22} color="#333" />
          </TouchableOpacity>
        </View>

        {/* Comments list */}
        <FlatList
          ref={listRef}
          data={comments}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>
                {i18n.t('noComments') || 'No comments yet. Be the first!'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.commentRow}>
              {item.authorPhoto ? (
                <Image source={{ uri: item.authorPhoto }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitials}>{getInitials(item.authorName)}</Text>
                </View>
              )}
              <View style={styles.commentBubble}>
                <View style={styles.commentMeta}>
                  <View style={styles.commentMetaMain}>
                    <Text style={styles.commentAuthor}>{item.authorName}</Text>
                    <Text style={styles.commentTime}>{formatCommentTime(item.createdAt)}</Text>
                  </View>
                  {!!auth.currentUser?.uid && (item.authorId === auth.currentUser.uid || postOwnerId === auth.currentUser.uid) ? (
                    <TouchableOpacity
                      style={styles.commentDeleteButton}
                      onPress={() => handleDeleteComment(item)}
                      disabled={deletingCommentId === item.id}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      {deletingCommentId === item.id ? (
                        <ActivityIndicator size="small" color="#ef4444" />
                      ) : (
                        <Ionicons name="trash-outline" size={16} color="#ef4444" />
                      )}
                    </TouchableOpacity>
                  ) : null}
                </View>
                <Text style={styles.commentText}>{item.text}</Text>
              </View>
            </View>
          )}
        />

        {/* Input row */}
        <View style={styles.inputRow}>
          {currentUserPhoto ? (
            <Image source={{ uri: currentUserPhoto }} style={styles.inputAvatar} />
          ) : (
            <View style={styles.inputAvatarFallback}>
              <Text style={styles.avatarInitials}>{getInitials(currentUserName || 'U')}</Text>
            </View>
          )}
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder={i18n.t('writeComment') || 'Write a comment...'}
            placeholderTextColor="#aaa"
            value={text}
            onChangeText={setText}
            multiline
            maxLength={500}
            editable={!submitting}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!text.trim() || submitting) && styles.sendBtnDisabled]}
            onPress={handleSubmit}
            disabled={!text.trim() || submitting}
            activeOpacity={0.7}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="send" size={17} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#f9fafb',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '78%',
    paddingBottom: Platform.OS === 'ios' ? 30 : 14,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ddd',
    marginTop: 10,
    marginBottom: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111',
  },
  list: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 12,
    flexGrow: 1,
  },
  emptyWrap: {
    paddingVertical: 36,
    alignItems: 'center',
  },
  emptyText: {
    color: '#999',
    fontSize: 14,
  },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  avatarFallback: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#111',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  commentBubble: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  commentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 3,
  },
  commentMetaMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    paddingRight: 8,
  },
  commentAuthor: {
    fontWeight: '700',
    fontSize: 13,
    color: '#111',
  },
  commentTime: {
    fontSize: 11,
    color: '#999',
  },
  commentDeleteButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentText: {
    fontSize: 14,
    color: '#222',
    lineHeight: 19,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    gap: 8,
  },
  inputAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  inputAvatarFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#111',
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    minHeight: 58,
    maxHeight: 120,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 14,
    color: '#111',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: '#ccc',
  },
});
