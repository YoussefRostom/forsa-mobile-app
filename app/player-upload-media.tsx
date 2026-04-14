import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useState } from 'react';
import { Alert, ActivityIndicator, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { collection, getDocs } from 'firebase/firestore';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import { auth, db } from '../lib/firebase';
import i18n from '../locales/i18n';
import { uploadAndSaveMedia, ResourceType, type TaggedUserMeta } from '../services/MediaService';
import { getCurrentUserRole } from '../services/UserRoleService';

type MediaItem = {
  uri: string;
  type: 'image' | 'video';
  caption?: string;
};

type UploadStatus = 'queued' | 'uploading' | 'success' | 'failed';

type TaggableUser = TaggedUserMeta;

const MAX_MEDIA_ITEMS = 1;
const CAPTION_LIMIT = 120;
const MAX_IMAGE_SIZE_MB = 12;
const MAX_VIDEO_SIZE_MB = 500;
const MAX_VIDEO_DURATION_SEC = 600;
const MAX_TAGGED_USERS = 5;

const resolveDisplayName = (data: any) => {
  return data?.academyName || data?.agentName || data?.clinicName || data?.parentName || data?.name ||
    (data?.firstName && data?.lastName ? `${data.firstName} ${data.lastName}`.trim() : data?.firstName) ||
    data?.email || 'User';
};

const formatEtaLabel = (seconds: number | null) => {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
  }

  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
};

const reindexRecord = <T,>(record: Record<number, T>, removedIndex: number) => {
  const next: Record<number, T> = {};
  Object.entries(record).forEach(([key, value]) => {
    const numericKey = Number(key);
    if (numericKey === removedIndex) return;
    next[numericKey > removedIndex ? numericKey - 1 : numericKey] = value;
  });
  return next;
};

const validateSelectedAsset = (asset: ImagePicker.ImagePickerAsset) => {
  const assetType = asset.type === 'video' ? 'video' : 'image';
  const sizeMb = asset.fileSize ? asset.fileSize / 1024 / 1024 : null;

  if (asset.mimeType) {
    const isExpectedMime = assetType === 'video'
      ? asset.mimeType.startsWith('video/')
      : asset.mimeType.startsWith('image/');

    if (!isExpectedMime) {
      return 'unsupportedMediaType';
    }
  }

  if (assetType === 'image' && sizeMb && sizeMb > MAX_IMAGE_SIZE_MB) {
    return 'imageTooLarge';
  }

  if (assetType === 'video' && sizeMb && sizeMb > MAX_VIDEO_SIZE_MB) {
    return 'videoTooLarge';
  }

  if (assetType === 'video' && asset.duration && asset.duration / 1000 > MAX_VIDEO_DURATION_SEC) {
    return 'videoTooLong';
  }

  return null;
};

const getCaptionMentionQuery = (text: string) => {
  const match = text.match(/(?:^|\s)@([^\s@]*)$/);
  return match ? match[1] : null;
};

const insertMentionIntoCaption = (text: string, userName: string) => {
  const mentionQuery = getCaptionMentionQuery(text);

  if (mentionQuery === null) {
    const trimmed = text.trimEnd();
    return `${trimmed}${trimmed.length > 0 ? ' ' : ''}@${userName} `;
  }

  const mentionStart = text.lastIndexOf(`@${mentionQuery}`);
  if (mentionStart === -1) {
    return text;
  }

  return `${text.slice(0, mentionStart)}@${userName} `;
};

export default function PlayerUploadMediaScreen() {
  const router = useRouter();
  const { openMenu } = useHamburgerMenu();
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [captionDraft, setCaptionDraft] = useState('');
  const [showCaptionInput, setShowCaptionInput] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<{ uri: string; type: 'image' | 'video' } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ [key: number]: number }>({});
  const [uploadStatus, setUploadStatus] = useState<Record<number, UploadStatus>>({});
  const [overallProgress, setOverallProgress] = useState(0);
  const [estimatedSecondsRemaining, setEstimatedSecondsRemaining] = useState<number | null>(null);
  const [activeUploadIndex, setActiveUploadIndex] = useState<number | null>(null);
  const [editingMediaIndex, setEditingMediaIndex] = useState<number | null>(null);
  const [taggedUsers, setTaggedUsers] = useState<TaggableUser[]>([]);
  const [availableUsers, setAvailableUsers] = useState<TaggableUser[]>([]);
  const [loadingTagUsers, setLoadingTagUsers] = useState(true);

  const canAddMore = media.length < MAX_MEDIA_ITEMS;
  const remainingSlots = Math.max(0, MAX_MEDIA_ITEMS - media.length);
  const failedCount = Object.values(uploadStatus).filter((status) => status === 'failed').length;
  const successCountVisible = Object.values(uploadStatus).filter((status) => status === 'success').length;
  const taggedAcademyCount = taggedUsers.filter((user) => user.role === 'academy').length;
  const eligibleTaggableUsers = availableUsers
    .filter((user) => ['player', 'academy'].includes(String(user.role || '').toLowerCase()))
    .filter((user) => !taggedUsers.some((tagged) => tagged.id === user.id));
  const activeCaptionMention = getCaptionMentionQuery(captionDraft);
  const captionMentionNormalized = (activeCaptionMention ?? '').trim().toLowerCase();
  const captionMentionSuggestions = activeCaptionMention === null
    ? []
    : eligibleTaggableUsers
      .filter((user) => {
        if (!captionMentionNormalized) return true;
        return user.name.toLowerCase().includes(captionMentionNormalized) || String(user.role || '').toLowerCase().includes(captionMentionNormalized);
      })
      .slice(0, 6);

  useEffect(() => {
    let mounted = true;

    const loadTaggableUsers = async () => {
      const user = auth.currentUser;
      if (!user) {
        if (mounted) setLoadingTagUsers(false);
        return;
      }

      try {
        const snapshot = await getDocs(collection(db, 'users'));
        const users = snapshot.docs
          .map((docSnap) => {
            const data = docSnap.data();
            return {
              id: docSnap.id,
              name: resolveDisplayName(data),
              role: String(data?.role || '').toLowerCase() || undefined,
            } as TaggableUser;
          })
          .filter((entry) => entry.id !== user.uid && entry.name)
          .sort((a, b) => a.name.localeCompare(b.name));

        if (mounted) {
          setAvailableUsers(users);
        }
      } catch (error) {
        console.error('Error loading users for tagging:', error);
      } finally {
        if (mounted) {
          setLoadingTagUsers(false);
        }
      }
    };

    loadTaggableUsers();

    return () => {
      mounted = false;
    };
  }, []);

  const resetCaptionEditor = (clearTags = false) => {
    setCaptionDraft('');
    setShowCaptionInput(false);
    setPendingMedia(null);
    setEditingMediaIndex(null);

    if (clearTags) {
      setTaggedUsers([]);
    }
  };

  const openCaptionEditor = (item: MediaItem, index: number | null = null) => {
    setPendingMedia({ uri: item.uri, type: item.type });
    setCaptionDraft(item.caption || '');
    setEditingMediaIndex(index);
    setShowCaptionInput(true);
  };

  const handleAddMedia = async () => {
    if (!canAddMore) {
      Alert.alert(
        i18n.t('uploadLimitReached') || 'Upload limit reached',
        i18n.t('mediaLimitReached') || `You can add up to ${MAX_MEDIA_ITEMS} items at a time.`
      );
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        i18n.t('permissionDenied') || 'Permission denied',
        i18n.t('mediaLibraryPermissionRequired') || 'Media library permission is required.'
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsEditing: true,
      quality: 0.8,
      videoMaxDuration: MAX_VIDEO_DURATION_SEC,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const asset = result.assets[0];
      const validationKey = validateSelectedAsset(asset);

      if (validationKey) {
        const fallbackMessageMap: Record<string, string> = {
          unsupportedMediaType: 'Please choose a valid image or video file.',
          imageTooLarge: `Images must be ${MAX_IMAGE_SIZE_MB}MB or smaller.`,
          videoTooLarge: `Videos must be ${MAX_VIDEO_SIZE_MB}MB or smaller.`,
          videoTooLong: `Videos must be ${MAX_VIDEO_DURATION_SEC} seconds or shorter.`,
        };

        Alert.alert(
          i18n.t('error') || 'Error',
          i18n.t(validationKey) || fallbackMessageMap[validationKey]
        );
        return;
      }

      openCaptionEditor({
        uri: asset.uri,
        type: asset.type === 'video' ? 'video' : 'image',
        caption: '',
      });
    }
  };

  const handleSaveCaption = () => {
    if (!pendingMedia) return;

    const nextItem: MediaItem = {
      ...pendingMedia,
      caption: captionDraft.trim(),
    };

    if (editingMediaIndex !== null) {
      setMedia((prev) => prev.map((item, index) => (index === editingMediaIndex ? nextItem : item)));
    } else {
      setMedia([nextItem]);
    }

    resetCaptionEditor();
  };

  const handleEditMedia = (index: number) => {
    const selectedItem = media[index];
    if (!selectedItem) return;
    openCaptionEditor(selectedItem, index);
  };

  const handleAddTaggedUser = (user: TaggableUser) => {
    if (taggedUsers.some((entry) => entry.id === user.id)) return true;

    const normalizedRole = String(user.role || '').toLowerCase();
    if (!['player', 'academy'].includes(normalizedRole)) {
      Alert.alert(
        i18n.t('tagLimitReachedTitle') || 'Tag limit reached',
        i18n.t('playersTagRestriction') || 'Players can only tag other players or one academy. Agents cannot be tagged.'
      );
      return false;
    }

    if (normalizedRole === 'academy' && taggedAcademyCount >= 1) {
      Alert.alert(
        i18n.t('academyTagLimitTitle') || 'Academy tag limit',
        i18n.t('academyTagLimitMessage') || 'You can only tag one academy in a post.'
      );
      return false;
    }

    if (taggedUsers.length >= MAX_TAGGED_USERS) {
      Alert.alert(i18n.t('tagLimitReachedTitle') || 'Tag limit reached', i18n.t('tagLimitReached') || `You can tag up to ${MAX_TAGGED_USERS} people in one post.`);
      return false;
    }

    setTaggedUsers((prev) => [...prev, user]);
    return true;
  };

  const handleSelectCaptionMention = (user: TaggableUser) => {
    const wasAdded = handleAddTaggedUser(user);
    if (!wasAdded) return;

    setCaptionDraft((prev) => insertMentionIntoCaption(prev, user.name));
  };

  const handleRemoveTaggedUser = (userId: string) => {
    setTaggedUsers((prev) => prev.filter((entry) => entry.id !== userId));
  };

  const handleSubmit = async () => {
    if (media.length === 0) {
      Alert.alert(i18n.t('error') || 'Error', i18n.t('pleaseAddMedia') || 'Please add at least one media item');
      return;
    }

    const indicesToUpload = media
      .map((_, index) => index)
      .filter((index) => uploadStatus[index] !== 'success');

    if (indicesToUpload.length === 0) {
      Alert.alert(i18n.t('success') || 'Success', i18n.t('allUploadsAlreadyComplete') || 'All selected media items have already been uploaded.');
      return;
    }

    setUploading(true);
    setOverallProgress(0);
    setEstimatedSecondsRemaining(null);
    setActiveUploadIndex(indicesToUpload[0] ?? 0);
    setUploadStatus((prev) => {
      const next = { ...prev };
      indicesToUpload.forEach((index) => {
        next[index] = 'queued';
      });
      return next;
    });

    const uploadResults: Array<{ success: boolean; error?: string }> = [];
    const startedAt = Date.now();

    try {
      for (let step = 0; step < indicesToUpload.length; step++) {
        const i = indicesToUpload[step];
        const item = media[i];
        if (!item) continue;

        setActiveUploadIndex(i);
        setUploadProgress((prev) => ({ ...prev, [i]: 0 }));
        setUploadStatus((prev) => ({ ...prev, [i]: 'uploading' }));

        try {
          const allowedTaggedUsers = taggedUsers
            .filter((entry) => ['player', 'academy'].includes(String(entry.role || '').toLowerCase()))
            .filter((entry, index, array) => String(entry.role || '').toLowerCase() !== 'academy' || array.findIndex((candidate) => candidate.role === 'academy') === index)
            .slice(0, MAX_TAGGED_USERS);

          await uploadAndSaveMedia(
            item.uri,
            item.type as ResourceType,
            'public',
            item.caption || '',
            (progress) => {
              const safeProgress = Math.max(0, Math.min(100, progress));
              const overall = ((step + safeProgress / 100) / indicesToUpload.length) * 100;
              const roundedOverall = Math.round(overall);

              setUploadProgress((prev) => ({ ...prev, [i]: safeProgress }));
              setOverallProgress(roundedOverall);

              if (overall > 1) {
                const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
                const estimatedRemaining = Math.max(0, Math.round((elapsedSeconds / overall) * (100 - overall)));
                setEstimatedSecondsRemaining(estimatedRemaining);
              }
            },
            allowedTaggedUsers
          );

          setUploadProgress((prev) => ({ ...prev, [i]: 100 }));
          setUploadStatus((prev) => ({ ...prev, [i]: 'success' }));
          uploadResults.push({ success: true });
        } catch (error: any) {
          console.error(`Upload failed for item ${i}:`, error);
          setUploadStatus((prev) => ({ ...prev, [i]: 'failed' }));
          uploadResults.push({
            success: false,
            error: error.message || 'Upload failed',
          });
        }
      }

      const successCount = uploadResults.filter((result) => result.success).length;
      const failCount = uploadResults.length - successCount;

      if (successCount > 0) {
        const successMessage = failCount > 0
          ? (i18n.t('uploadPartialSuccess', { successCount, failCount }) || `${successCount} item(s) uploaded successfully. ${failCount} item(s) are still saved here so you can retry them.`)
          : (i18n.t('uploadSuccessCount', { count: successCount }) || `${successCount} media item(s) uploaded successfully.`);

        Alert.alert(
          i18n.t('success') || 'Success',
          successMessage,
          [
            {
              text: i18n.t('ok') || 'OK',
              onPress: async () => {
                if (failCount > 0) return;
                try {
                  setMedia([]);
                  setUploadStatus({});
                  setUploadProgress({});
                  setTaggedUsers([]);
                  const role = await getCurrentUserRole();
                  const feedRoute = `/${role}-feed`;
                  router.replace(feedRoute as any);
                } catch (error) {
                  console.error('Error getting user role, redirecting to player feed:', error);
                  router.replace('/player-feed' as any);
                }
              },
            },
          ]
        );
      } else {
        const firstError = uploadResults.find((result) => !result.success)?.error;
        Alert.alert(
          i18n.t('error') || 'Error',
          firstError
            ? `${i18n.t('uploadAllFailedPrefix') || 'All uploads failed.'} ${firstError}`
            : (i18n.t('uploadFailedTryAgain') || 'All uploads failed. Please try again.')
        );
      }
    } catch (error: any) {
      console.error('Upload error:', error);
      Alert.alert(
        i18n.t('error') || 'Error',
        error.message || (i18n.t('uploadFailedTryAgain') || 'Failed to upload media. Please try again.')
      );
    } finally {
      setUploading(false);
      setOverallProgress(0);
      setEstimatedSecondsRemaining(null);
      setActiveUploadIndex(null);
    }
  };

  const handleRemoveMedia = (index: number) => {
    Alert.alert(
      i18n.t('removeMedia') || 'Remove Media',
      i18n.t('removeMediaConfirm') || 'Are you sure you want to remove this media?',
      [
        { text: i18n.t('cancel') || 'Cancel', style: 'cancel' },
        {
          text: i18n.t('remove') || 'Remove',
          style: 'destructive',
          onPress: () => {
            const nextMedia = media.filter((_, i) => i !== index);
            setMedia(nextMedia);
            setUploadProgress((prev) => reindexRecord(prev, index));
            setUploadStatus((prev) => reindexRecord(prev, index));

            if (nextMedia.length === 0) {
              setTaggedUsers([]);
            }
          },
        },
      ]
    );
  };

  const handleClearAllMedia = () => {
    Alert.alert(
      i18n.t('clearAllMedia') || 'Clear all media',
      i18n.t('clearAllMediaConfirm') || 'Remove all selected items from this upload batch?',
      [
        { text: i18n.t('cancel') || 'Cancel', style: 'cancel' },
        {
          text: i18n.t('clearAll') || 'Clear All',
          style: 'destructive',
          onPress: () => {
            setMedia([]);
            setUploadProgress({});
            setUploadStatus({});
            resetCaptionEditor(true);
          },
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient
        colors={['#000000', '#1a1a1a', '#2d2d2d']}
        style={styles.gradient}
      >
        <View style={{ flex: 1 }}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.menuButton} onPress={openMenu}>
              <Ionicons name="menu" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.headerContent}>
              <Text style={styles.headerTitle}>{i18n.t('uploadMedia') || 'Upload Media'}</Text>
              <Text style={styles.headerSubtitle}>{i18n.t('showcaseYourSkills') || 'Showcase your skills with photos and videos'}</Text>
            </View>
          </View>

          <HamburgerMenu />

          <ScrollView 
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.tipCard}>
              <View style={styles.tipIconWrap}>
                <Ionicons name="sparkles-outline" size={22} color="#000" />
              </View>
              <View style={styles.tipTextWrap}>
                <Text style={styles.tipTitle}>{i18n.t('mediaUploadHintTitle') || 'Build a stronger player profile'}</Text>
                <Text style={styles.tipText}>
                  {i18n.t('mediaUploadHint') || 'Add up to 6 photos or videos to showcase your training, matches, and highlights.'}
                </Text>
              </View>
            </View>

            <View style={styles.rulesRow}>
              <View style={styles.ruleChip}>
                <Ionicons name="albums-outline" size={14} color="#111827" />
                <Text style={styles.ruleChipText}>{i18n.t('uploadRuleItems') || 'Up to 6 items'}</Text>
              </View>
              <View style={styles.ruleChip}>
                <Ionicons name="image-outline" size={14} color="#111827" />
                <Text style={styles.ruleChipText}>{i18n.t('uploadRuleImages') || 'Images ≤ 12MB'}</Text>
              </View>
              <View style={styles.ruleChip}>
                <Ionicons name="videocam-outline" size={14} color="#111827" />
                <Text style={styles.ruleChipText}>{i18n.t('uploadRuleVideos') || 'Videos ≤ 500MB / 600s'}</Text>
              </View>
            </View>

            {uploading && media.length > 0 && (
              <View style={styles.progressCard}>
                <View style={styles.progressHeaderRow}>
                  <Text style={styles.progressTitle}>{i18n.t('uploadInProgress') || 'Upload in progress'}</Text>
                  <Text style={styles.progressPercent}>{overallProgress}%</Text>
                </View>
                <Text style={styles.progressSubtitle}>
                  {i18n.t('uploadingItemProgress', {
                    current: (activeUploadIndex ?? 0) + 1,
                    total: media.length,
                  }) || `Uploading item ${(activeUploadIndex ?? 0) + 1} of ${media.length}`}
                </Text>
                <Text style={styles.progressEtaText}>
                  {estimatedSecondsRemaining !== null
                    ? `${i18n.t('estimatedTimeLeft') || 'Estimated time left'}: ${formatEtaLabel(estimatedSecondsRemaining)}`
                    : (i18n.t('preparingUploadStatus') || 'Preparing upload...')}
                </Text>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${Math.max(overallProgress, 4)}%` }]} />
                </View>
              </View>
            )}

            <View style={styles.mediaCard}>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.sectionTitleWrap}>
                  <Text style={styles.sectionTitle}>{i18n.t('mediaSection') || 'Media'}</Text>
                  <Text style={styles.sectionSubtitle}>
                    {media.length === 0
                      ? (i18n.t('singlePostHint') || 'Add one photo or video for this post, then tag people if needed.')
                      : `${media.length}/${MAX_MEDIA_ITEMS} ${i18n.t('itemsReadyToUpload') || 'post ready to upload'}`}
                  </Text>
                </View>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{media.length}/{MAX_MEDIA_ITEMS}</Text>
                </View>
              </View>

              <View style={styles.mediaGrid}>
                {media.length === 0 ? (
                  <TouchableOpacity
                    style={styles.emptyMedia}
                    onPress={handleAddMedia}
                    activeOpacity={0.85}
                    disabled={!canAddMore}
                  >
                    <Ionicons name="images-outline" size={52} color="#999" />
                    <Text style={styles.placeholder}>{i18n.t('noMedia') || 'No media uploaded yet.'}</Text>
                    <Text style={styles.placeholderHint}>
                      {i18n.t('tapToChooseMedia') || 'Tap here to choose one photo or video for this post.'}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  media.map((item, idx) => (
                    <TouchableOpacity
                      key={idx}
                      style={styles.mediaThumb}
                      activeOpacity={0.85}
                      onPress={() => handleEditMedia(idx)}
                    >
                      <TouchableOpacity
                        style={styles.removeButton}
                        onPress={() => handleRemoveMedia(idx)}
                      >
                        <Ionicons name="close-circle" size={24} color="#ff3b30" />
                      </TouchableOpacity>

                      {item.type === 'image' ? (
                        <Image source={{ uri: item.uri }} style={styles.mediaImg} />
                      ) : (
                        <View style={styles.videoThumb}>
                          <Ionicons name="play-circle" size={32} color="#fff" />
                        </View>
                      )}

                      <View style={styles.typeBadge}>
                        <Text style={styles.typeBadgeText}>{item.type === 'video' ? (i18n.t('video') || 'Video') : (i18n.t('image') || 'Image')}</Text>
                      </View>

                      {uploadStatus[idx] === 'success' && !uploading && (
                        <View style={[styles.resultBadge, styles.successBadge]}>
                          <Ionicons name="checkmark" size={12} color="#fff" />
                          <Text style={styles.resultBadgeText}>{i18n.t('uploadedStatus') || 'Uploaded'}</Text>
                        </View>
                      )}

                      {uploadStatus[idx] === 'failed' && !uploading && (
                        <View style={[styles.resultBadge, styles.failedBadge]}>
                          <Ionicons name="alert-circle" size={12} color="#fff" />
                          <Text style={styles.resultBadgeText}>{i18n.t('failedStatus') || 'Failed'}</Text>
                        </View>
                      )}

                      {(uploadProgress[idx] ?? 0) > 0 && (uploadProgress[idx] ?? 0) < 100 && (
                        <View style={styles.uploadingOverlay}>
                          <ActivityIndicator size="small" color="#fff" />
                          <Text style={styles.uploadingOverlayText}>{Math.round(uploadProgress[idx] ?? 0)}%</Text>
                          <Text style={styles.uploadingOverlaySubtext}>{i18n.t('uploading') || 'Uploading...'}</Text>
                        </View>
                      )}

                      <Text style={[styles.captionText, !item.caption && styles.captionPlaceholderText]} numberOfLines={2}>
                        {item.caption || (i18n.t('tapToEditCaptionHint') || 'Tap to add or edit a caption')}
                      </Text>
                    </TouchableOpacity>
                  ))
                )}
              </View>

              {media.length > 0 && (
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.clearBtn}
                    onPress={handleClearAllMedia}
                    activeOpacity={0.8}
                    disabled={uploading}
                  >
                    <Ionicons name="trash-outline" size={18} color="#111827" />
                    <Text style={styles.clearBtnText}>{i18n.t('removeCurrentPost') || 'Remove Current'}</Text>
                  </TouchableOpacity>
                </View>
              )}

              <Text style={styles.helperText}>
                {failedCount > 0
                  ? `${failedCount} ${i18n.t('failedUploadsWaiting') || 'failed item(s) waiting for retry.'}`
                  : canAddMore
                    ? (i18n.t('uploadSlotsRemaining', { count: remainingSlots }) || 'Add one photo or video for this post.')
                    : (i18n.t('mediaLimitReached') || 'You can only prepare one post at a time.')}
              </Text>

              {!!successCountVisible && !uploading && (
                <Text style={styles.successSummaryText}>{`${successCountVisible} ${i18n.t('uploadedItemsReady') || 'item(s) already uploaded successfully.'}`}</Text>
              )}
            </View>

            {showCaptionInput && pendingMedia && (
              <View style={styles.captionCard}>
                <Text style={styles.captionLabel}>
                  {editingMediaIndex !== null ? (i18n.t('editCaption') || 'Edit caption') : (i18n.t('caption') || 'Caption')}
                </Text>
                <Text style={styles.captionHelper}>
                  {i18n.t('captionOptionalHelper') || 'Optional, but helpful for coaches and scouts reviewing your profile.'}
                </Text>
                <View style={styles.previewContainer}>
                  {pendingMedia.type === 'image' ? (
                    <Image source={{ uri: pendingMedia.uri }} style={styles.previewImage} />
                  ) : (
                    <View style={styles.previewVideo}>
                      <Ionicons name="videocam" size={40} color="#fff" />
                    </View>
                  )}
                  <Text style={styles.previewMetaText}>{pendingMedia.type === 'video' ? (i18n.t('video') || 'Video') : (i18n.t('image') || 'Image')}</Text>
                </View>
                <TextInput
                  style={styles.captionInput}
                  placeholder={i18n.t('caption') || 'Caption'}
                  value={captionDraft}
                  onChangeText={setCaptionDraft}
                  maxLength={CAPTION_LIMIT}
                  placeholderTextColor="#999"
                  multiline
                />

                {taggedUsers.length > 0 && (
                  <View style={styles.selectedTagsWrap}>
                    {taggedUsers.map((user) => (
                      <View key={user.id} style={styles.selectedTagChip}>
                        <Text style={styles.selectedTagText}>{`@${user.name}`}</Text>
                        <TouchableOpacity onPress={() => handleRemoveTaggedUser(user.id)} disabled={uploading}>
                          <Ionicons name="close" size={14} color="#111827" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

                {activeCaptionMention !== null && (
                  loadingTagUsers ? (
                    <Text style={styles.tagStateText}>{i18n.t('loadingPeople') || 'Loading people...'}</Text>
                  ) : captionMentionSuggestions.length > 0 ? (
                    <View style={styles.suggestionList}>
                      {captionMentionSuggestions.map((user) => (
                        <TouchableOpacity
                          key={user.id}
                          style={styles.suggestionItem}
                          onPress={() => handleSelectCaptionMention(user)}
                          disabled={uploading}
                        >
                          <View>
                            <Text style={styles.suggestionName}>{user.name}</Text>
                            {!!user.role && <Text style={styles.suggestionRole}>{user.role}</Text>}
                          </View>
                          <Ionicons name="at-circle-outline" size={18} color="#111827" />
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.tagStateText}>{i18n.t('noUserMatches') || 'No users match that search yet.'}</Text>
                  )
                )}

                <Text style={styles.captionCount}>{captionDraft.length}/{CAPTION_LIMIT}</Text>
                <View style={styles.captionActions}>
                  <TouchableOpacity
                    style={styles.cancelBtn}
                    onPress={() => resetCaptionEditor(media.length === 0)}
                  >
                    <Text style={styles.cancelBtnText}>{i18n.t('cancel') || 'Cancel'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveBtn} onPress={handleSaveCaption}>
                    <Text style={styles.saveBtnText}>
                      {editingMediaIndex !== null ? (i18n.t('save') || 'Save') : (i18n.t('addToUploads') || 'Add to Uploads')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {media.length > 0 && (
              <TouchableOpacity
                style={[styles.submitBtn, uploading && styles.submitBtnDisabled]}
                onPress={handleSubmit}
                activeOpacity={0.8}
                disabled={uploading}
              >
                {uploading ? (
                  <View style={styles.uploadingContainer}>
                    <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />
                    <Text style={styles.submitBtnText}>{i18n.t('uploading') || 'Uploading...'}</Text>
                  </View>
                ) : (
                  <Text style={styles.submitBtnText}>
                    {failedCount > 0
                      ? `${i18n.t('retryFailedUploads') || 'Retry Failed Uploads'} (${failedCount})`
                      : `${i18n.t('uploadMedia') || 'Upload Media'} (${media.length})`}
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </LinearGradient>
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
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  progressCard: {
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 4,
  },
  progressHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  progressTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  progressPercent: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
  },
  progressSubtitle: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 6,
  },
  progressEtaText: {
    fontSize: 12,
    color: '#111827',
    fontWeight: '600',
    marginBottom: 10,
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: '#e5e7eb',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#111827',
  },
  mediaCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  tipCard: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 4,
  },
  rulesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  tagCard: {
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
  },
  tagCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  tagCardHelper: {
    fontSize: 12,
    lineHeight: 18,
    color: '#6b7280',
    marginBottom: 10,
  },
  tagInput: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
    backgroundColor: '#fff',
  },
  selectedTagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  selectedTagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#eef2ff',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  selectedTagText: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '600',
  },
  tagMetaText: {
    marginTop: 8,
    fontSize: 12,
    color: '#6b7280',
  },
  tagStateText: {
    marginTop: 10,
    fontSize: 12,
    color: '#6b7280',
  },
  suggestionList: {
    marginTop: 10,
    gap: 8,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#f3f4f6',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  suggestionName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  suggestionRole: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
    textTransform: 'capitalize',
  },
  ruleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  ruleChipText: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '600',
  },
  tipIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  tipTextWrap: {
    flex: 1,
  },
  tipTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000',
    marginBottom: 4,
  },
  tipText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#555',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
  },
  sectionTitleWrap: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
  },
  countBadge: {
    backgroundColor: '#111827',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  countBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  mediaGrid: {
    flexDirection: 'column',
    gap: 12,
    marginBottom: 16,
  },
  emptyMedia: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 40,
  },
  placeholder: {
    fontSize: 16,
    color: '#777',
    marginTop: 12,
    fontWeight: '600',
  },
  placeholderHint: {
    fontSize: 13,
    color: '#999',
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 12,
  },
  mediaThumb: {
    width: '100%',
    marginBottom: 8,
    position: 'relative',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionBtnPrimary: {
    flex: 1,
  },
  removeButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    zIndex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
  },
  mediaImg: {
    width: '100%',
    height: 220,
    borderRadius: 14,
    resizeMode: 'cover',
    backgroundColor: '#f0f0f0',
  },
  videoThumb: {
    width: '100%',
    height: 220,
    borderRadius: 14,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeBadge: {
    position: 'absolute',
    left: 6,
    bottom: 34,
    backgroundColor: 'rgba(17, 24, 39, 0.9)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  resultBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  successBadge: {
    backgroundColor: 'rgba(22, 163, 74, 0.95)',
  },
  failedBadge: {
    backgroundColor: 'rgba(220, 38, 38, 0.95)',
  },
  resultBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  uploadingOverlayText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  uploadingOverlaySubtext: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    opacity: 0.95,
  },
  typeBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  captionText: {
    fontSize: 12,
    color: '#666',
    marginTop: 8,
    textAlign: 'left',
    minHeight: 20,
  },
  captionPlaceholderText: {
    color: '#999',
  },
  addBtn: {
    backgroundColor: '#000',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  clearBtnText: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '700',
  },
  addBtnDisabled: {
    opacity: 0.55,
  },
  addBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
    letterSpacing: 0.5,
  },
  helperText: {
    marginTop: 10,
    textAlign: 'center',
    color: '#666',
    fontSize: 12,
  },
  successSummaryText: {
    marginTop: 6,
    textAlign: 'center',
    color: '#15803d',
    fontSize: 12,
    fontWeight: '600',
  },
  captionCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  captionLabel: {
    fontSize: 18,
    color: '#000',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  captionHelper: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
    marginBottom: 12,
  },
  previewContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  previewMetaText: {
    marginTop: 8,
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
  previewImage: {
    width: 150,
    height: 150,
    borderRadius: 16,
    backgroundColor: '#f0f0f0',
  },
  previewVideo: {
    width: 150,
    height: 150,
    borderRadius: 16,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captionInput: {
    width: '100%',
    borderWidth: 2,
    borderColor: '#f5f5f5',
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#f5f5f5',
    color: '#000',
    marginBottom: 8,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  captionCount: {
    textAlign: 'right',
    color: '#888',
    fontSize: 12,
    marginBottom: 12,
  },
  captionActions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: '#000',
    fontWeight: '600',
    fontSize: 16,
  },
  saveBtn: {
    flex: 1,
    backgroundColor: '#000',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  saveBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  submitBtn: {
    backgroundColor: '#000',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  uploadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

