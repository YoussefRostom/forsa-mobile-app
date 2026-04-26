import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { toggleLike, subscribeIsLiked, repostPost, subscribeIsReposted } from '../../services/SocialService';
import { auth } from '../../lib/firebase';
import i18n from '../../locales/i18n';

interface PostSocialActionsProps {
  post: any;
  onCommentPress: () => void;
  currentUserName?: string;
  currentUserPhoto?: string | null;
  viewerRole?: string;
}

export default function PostSocialActions({
  post,
  onCommentPress,
  currentUserName,
  currentUserPhoto,
  viewerRole,
}: PostSocialActionsProps) {
  const [isLiked, setIsLiked] = useState(false);
  const [isReposted, setIsReposted] = useState(false);
  const [likesCount, setLikesCount] = useState<number>(post.likesCount || 0);
  const commentsCount = Number(post.commentsCount || 0);
  const [repostsCount, setRepostsCount] = useState<number>(post.repostsCount || 0);
  const [liking, setLiking] = useState(false);
  const [reposting, setReposting] = useState(false);

  useEffect(() => {
    const unsub = subscribeIsLiked(post.id, setIsLiked);
    return unsub;
  }, [post.id]);

  useEffect(() => {
    const unsub = subscribeIsReposted(post.id, setIsReposted);
    return unsub;
  }, [post.id]);

  useEffect(() => {
    setLikesCount(Number(post.likesCount || 0));
    setRepostsCount(Number(post.repostsCount || 0));
  }, [post.likesCount, post.repostsCount]);

  const handleLike = async () => {
    if (liking) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLiking(true);
    const wasLiked = isLiked;
    // Optimistic update
    setIsLiked(!wasLiked);
    setLikesCount((c) => (wasLiked ? Math.max(0, c - 1) : c + 1));
    try {
      await toggleLike(post.id, post.ownerId, currentUserName || 'Someone', currentUserPhoto);
    } catch {
      // Revert on failure
      setIsLiked(wasLiked);
      setLikesCount((c) => (wasLiked ? c + 1 : Math.max(0, c - 1)));
    } finally {
      setLiking(false);
    }
  };

  const handleRepost = async () => {
    if (reposting) return;
    setReposting(true);
    const wasReposted = isReposted;
    setIsReposted(!wasReposted);
    setRepostsCount((c) => (wasReposted ? Math.max(0, c - 1) : c + 1));
    try {
      const reposted = await repostPost(post, currentUserName || 'Player', currentUserPhoto, viewerRole || 'player');
      setIsReposted(reposted);
      Alert.alert(
        i18n.t('success') || 'Success',
        reposted
          ? (i18n.t('repostSuccess') || 'Post reposted to your feed!')
          : (i18n.t('repostRemoved') || 'Repost removed.')
      );
    } catch (e: any) {
      setIsReposted(wasReposted);
      setRepostsCount((c) => (wasReposted ? c + 1 : Math.max(0, c - 1)));
      if (e?.message === 'CANNOT_REPOST_OWN') {
        Alert.alert(i18n.t('info') || 'Info', i18n.t('cannotRepostOwnPost') || "You can't repost your own post.");
      } else {
        Alert.alert(i18n.t('error') || 'Error', i18n.t('repostFailed') || 'Failed to repost.');
      }
    } finally {
      setReposting(false);
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.action} onPress={handleLike} activeOpacity={0.8} disabled={liking}>
        <Ionicons
          name={isLiked ? 'heart' : 'heart-outline'}
          size={22}
          color={isLiked ? '#e53e3e' : '#666'}
        />
        {likesCount > 0 && (
          <Text style={[styles.count, isLiked && styles.countLiked]}>{likesCount}</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.action} onPress={onCommentPress} activeOpacity={0.8}>
        <Ionicons name="chatbubble-outline" size={21} color="#666" />
        {commentsCount > 0 && <Text style={styles.count}>{commentsCount}</Text>}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.action}
        onPress={handleRepost}
        activeOpacity={0.8}
        disabled={reposting}
      >
        {reposting ? (
          <ActivityIndicator size="small" color="#666" />
        ) : (
          <Ionicons
            name={isReposted ? 'repeat' : 'repeat-outline'}
            size={22}
            color={isReposted ? '#047857' : '#666'}
          />
        )}
        {repostsCount > 0 && (
          <Text style={[styles.count, { color: '#047857' }]}>{repostsCount}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 14,
    marginTop: 12,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minWidth: 70,
    paddingVertical: 6,
    borderRadius: 10,
  },
  count: {
    fontSize: 12,
    color: '#4b5563',
    fontWeight: '600',
  },
  countLiked: {
    color: '#e53e3e',
  },
});
