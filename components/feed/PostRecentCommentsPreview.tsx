import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Comment, subscribeComments } from '../../services/SocialService';
import i18n from '../../locales/i18n';

interface PostRecentCommentsPreviewProps {
  postId: string;
  onPressOpenComments: () => void;
}

const MAX_VISIBLE_COMMENTS = 2;

export default function PostRecentCommentsPreview({
  postId,
  onPressOpenComments,
}: PostRecentCommentsPreviewProps) {
  const [comments, setComments] = useState<Comment[]>([]);

  useEffect(() => {
    if (!postId) {
      setComments([]);
      return;
    }

    const unsubscribe = subscribeComments(postId, setComments);
    return unsubscribe;
  }, [postId]);

  const visibleComments = useMemo(
    () => comments.slice(-MAX_VISIBLE_COMMENTS),
    [comments]
  );

  if (!visibleComments.length) return null;

  return (
    <View style={styles.container}>
      {comments.length > MAX_VISIBLE_COMMENTS ? (
        <TouchableOpacity onPress={onPressOpenComments} activeOpacity={0.8}>
          <Text style={styles.viewAllText}>
            {i18n.t('viewAllComments') || 'View all comments'}
          </Text>
        </TouchableOpacity>
      ) : null}

      {visibleComments.map((comment) => (
        <TouchableOpacity
          key={comment.id}
          style={styles.commentRow}
          onPress={onPressOpenComments}
          activeOpacity={0.82}
        >
          <Text style={styles.commentAuthor}>{comment.authorName || 'User'}</Text>
          <Text style={styles.commentText} numberOfLines={2}>
            {comment.text}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 14,
    marginTop: 8,
    gap: 6,
  },
  viewAllText: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  commentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  commentAuthor: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
    marginRight: 6,
  },
  commentText: {
    color: '#e5e7eb',
    fontSize: 14,
    lineHeight: 21,
    flexShrink: 1,
  },
});
