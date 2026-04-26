import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { useRouter } from 'expo-router';
import { collection, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import i18n from '../locales/i18n';
import FootballLoader from '../components/FootballLoader';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import { updateMediaCaption, deleteAdminMedia, type MediaDoc } from '../services/MediaService';

const CAPTION_LIMIT = 160;

const formatMediaDate = (createdAt: any) => {
  const timestamp = createdAt?.toDate
    ? createdAt.toDate()
    : createdAt?.seconds
      ? new Date(createdAt.seconds * 1000)
      : null;

  if (!timestamp) return '—';

  const diffMs = Date.now() - timestamp.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return i18n.t('justNow') || 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;

  return timestamp.toLocaleDateString();
};

export default function PlayerMyMediaScreen() {
  const router = useRouter();
  const { openMenu } = useHamburgerMenu();
  const [mediaList, setMediaList] = useState<(MediaDoc & { postId: string | null; content: string })[]>([]);
  const [activeFilter, setActiveFilter] = useState<'photos' | 'videos'>('photos');
  const [loading, setLoading] = useState(true);
  const [editingMedia, setEditingMedia] = useState<{ id: string; content: string; postId: string | null } | null>(null);
  const [editCaption, setEditCaption] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [fullScreenMedia, setFullScreenMedia] = useState<{ uri: string; type: 'image' | 'video' } | null>(null);

  const imageCount = mediaList.filter((item) => item.resourceType === 'image').length;
  const videoCount = mediaList.filter((item) => item.resourceType === 'video').length;
  const photoMedia = mediaList.filter((item) => item.resourceType === 'image');
  const videoMedia = mediaList.filter((item) => item.resourceType === 'video');
  const filteredMedia = activeFilter === 'photos' ? photoMedia : videoMedia;
  const unchangedCaption = editingMedia ? editCaption.trim() === (editingMedia.content || '').trim() : false;

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      return;
    }

    const mediaRef = collection(db, 'media');
    const q = query(mediaRef, where('ownerId', '==', user.uid));

    const unsubscribe = onSnapshot(
      q,
      async (snapshot) => {
        const media: (MediaDoc & { postId: string | null; content: string })[] = [];
        snapshot.forEach((doc) => {
          media.push({
            id: doc.id,
            ...doc.data(),
          } as MediaDoc & { postId: string | null; content: string });
        });

        media.sort((a, b) => {
          const aTime = a.createdAt?.toDate ? a.createdAt.toDate().getTime() :
            (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
          const bTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() :
            (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
          return bTime - aTime;
        });

        const postsRef = collection(db, 'posts');
        const postsWithMedia = await Promise.all(
          media.map(async (m) => {
            const postQuery = query(
              postsRef,
              where('mediaId', '==', m.id),
              where('ownerId', '==', user.uid)
            );
            const postSnap = await getDocs(postQuery);
            const post = postSnap.docs[0];
            return {
              ...m,
              postId: post?.id || null,
              content: post?.data()?.content || '',
            };
          })
        );

        setMediaList(postsWithMedia);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching media:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const handleEdit = (media: any) => {
    setEditingMedia({ id: media.id, content: media.content || '', postId: media.postId });
    setEditCaption(media.content || '');
  };

  const handleSaveEdit = async () => {
    if (!editingMedia) return;

    const nextCaption = editCaption.trim();
    if (nextCaption === (editingMedia.content || '').trim()) {
      setEditingMedia(null);
      setEditCaption('');
      return;
    }

    setSaving(true);
    try {
      await updateMediaCaption(editingMedia.id, editingMedia.postId, nextCaption);
      setEditingMedia(null);
      setEditCaption('');
      Alert.alert(i18n.t('success') || 'Success', i18n.t('captionUpdated') || 'Caption updated successfully');
    } catch (error: any) {
      Alert.alert(i18n.t('error') || 'Error', error.message || 'Failed to update caption');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (media: any) => {
    Alert.alert(
      i18n.t('deleteMedia') || 'Delete post',
      i18n.t('deleteMediaConfirm') || 'Are you sure you want to delete this post? This cannot be undone.',
      [
        { text: i18n.t('cancel') || 'Cancel', style: 'cancel' },
        {
          text: i18n.t('delete') || 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(media.id);
            try {
              await deleteAdminMedia(media.id, media.postId);
              Alert.alert(i18n.t('success') || 'Success', i18n.t('mediaDeleted') || 'Post deleted successfully');
            } catch (error: any) {
              Alert.alert(i18n.t('error') || 'Error', error.message || 'Failed to delete');
            } finally {
              setDeleting(null);
            }
          },
        },
      ]
    );
  };

  const renderMediaCard = (media: MediaDoc & { postId: string | null; content: string }) => (
    <View key={media.id} style={styles.mediaCard}>
      <TouchableOpacity
        style={styles.mediaPreview}
        onPress={() =>
          setFullScreenMedia({
            uri: media.secureUrl,
            type: media.resourceType,
          })
        }
        activeOpacity={0.9}
      >
        {media.resourceType === 'image' ? (
          <Image source={{ uri: media.secureUrl }} style={styles.mediaThumbnail} />
        ) : (
          <View style={styles.videoThumbnail}>
            <Ionicons name="play-circle" size={34} color="#fff" />
            <Text style={styles.videoLabel}>{i18n.t('video') || 'Video'}</Text>
          </View>
        )}
        <View style={styles.previewBadge}>
          <Text style={styles.previewBadgeText}>
            {media.resourceType === 'image' ? (i18n.t('image') || 'Image') : (i18n.t('video') || 'Video')}
          </Text>
        </View>
      </TouchableOpacity>

      <View style={styles.mediaInfo}>
        <View style={styles.mediaMetaRow}>
          <Text style={styles.mediaType}>
            {media.resourceType === 'image' ? (i18n.t('image') || 'Image') : (i18n.t('video') || 'Video')}
          </Text>
          <Text style={styles.mediaDate}>{formatMediaDate(media.createdAt)}</Text>
        </View>

        <Text style={[styles.mediaCaption, !media.content && styles.mediaCaptionPlaceholder]} numberOfLines={3}>
          {media.content || (i18n.t('noCaptionYet') || 'No caption yet. Tap edit to add one.')}
        </Text>

        <Text style={styles.mediaHint}>{i18n.t('tapToPreviewMedia') || 'Tap the preview to open full screen.'}</Text>

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.editButton}
            onPress={() => handleEdit(media)}
            disabled={deleting === media.id}
          >
            <Ionicons name="create-outline" size={16} color="#4e73df" />
            <Text style={styles.editButtonText}>{i18n.t('editCaption') || 'Edit caption'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => handleDelete(media)}
            disabled={deleting === media.id}
          >
            {deleting === media.id ? (
              <FootballLoader size="small" color="#e74a3b" />
            ) : (
              <>
                <Ionicons name="trash-outline" size={16} color="#e74a3b" />
                <Text style={styles.deleteButtonText}>{i18n.t('delete') || 'Delete'}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <FootballLoader size="large" color="#fff" />
        <Text style={styles.loadingText}>{i18n.t('loading') || 'Loading...'}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <LinearGradient colors={['#000000', '#1a1a1a', '#2d2d2d']} style={styles.gradient}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.menuButton} onPress={openMenu}>
            <Ionicons name="menu" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{i18n.t('myMedia') || 'My Media'}</Text>
          <View style={styles.placeholder} />
        </View>

        <HamburgerMenu />

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heroCard}>
            <View style={styles.heroIconWrap}>
              <Ionicons name="images-outline" size={22} color="#111827" />
            </View>
            <View style={styles.heroTextWrap}>
              <Text style={styles.heroTitle}>{i18n.t('mediaLibraryTitle') || 'Your media library'}</Text>
              <Text style={styles.heroText}>
                {mediaList.length === 0
                  ? (i18n.t('mediaLibraryHint') || 'Upload your best training, match, and highlight moments here.')
                  : (i18n.t('myMediaSummary', { count: mediaList.length }) || `${mediaList.length} post(s) ready on your profile.`)}
              </Text>
            </View>
          </View>

          {mediaList.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="images-outline" size={64} color="#666" />
              <Text style={styles.emptyText}>{i18n.t('noMediaYet') || 'No posts yet'}</Text>
              <Text style={styles.emptySubtext}>{i18n.t('uploadMediaToSee') || 'Upload media to see your posts here'}</Text>
              <TouchableOpacity
                style={styles.uploadButton}
                onPress={() => router.push('/player-upload-media')}
              >
                <Ionicons name="add-circle-outline" size={18} color="#fff" />
                <Text style={styles.uploadButtonText}>{i18n.t('uploadMedia') || 'Upload Media'}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.statsRow}>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{mediaList.length}</Text>
                  <Text style={styles.statLabel}>{i18n.t('post') || 'Post'}</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{imageCount}</Text>
                  <Text style={styles.statLabel}>{i18n.t('photos') || 'Photos'}</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{videoCount}</Text>
                  <Text style={styles.statLabel}>{i18n.t('videos') || 'Videos'}</Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.uploadAnotherButton}
                onPress={() => router.push('/player-upload-media')}
                activeOpacity={0.85}
              >
                <Ionicons name="add-circle-outline" size={18} color="#111827" />
                <Text style={styles.uploadAnotherText}>{i18n.t('addAnotherPost') || 'Add another post'}</Text>
              </TouchableOpacity>

              <View style={styles.filterTabs}>
                <TouchableOpacity
                  style={[styles.filterTab, activeFilter === 'photos' && styles.filterTabActive]}
                  onPress={() => setActiveFilter('photos')}
                  activeOpacity={0.85}
                >
                  <Ionicons name="images-outline" size={16} color={activeFilter === 'photos' ? '#111827' : '#fff'} />
                  <Text style={[styles.filterTabText, activeFilter === 'photos' && styles.filterTabTextActive]}>
                    {i18n.t('PhotoSection') || i18n.t('photos') || 'Photos'} ({photoMedia.length})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterTab, activeFilter === 'videos' && styles.filterTabActive]}
                  onPress={() => setActiveFilter('videos')}
                  activeOpacity={0.85}
                >
                  <Ionicons name="play-circle-outline" size={16} color={activeFilter === 'videos' ? '#111827' : '#fff'} />
                  <Text style={[styles.filterTabText, activeFilter === 'videos' && styles.filterTabTextActive]}>
                    {i18n.t('VideoSection') || i18n.t('videos') || 'Videos'} ({videoMedia.length})
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.mediaSection}>
                {filteredMedia.length === 0 ? (
                  <View style={styles.sectionEmptyState}>
                    <Text style={styles.sectionEmptyText}>
                      {activeFilter === 'photos'
                        ? (i18n.t('noPhotos') || 'No photos uploaded yet.')
                        : (i18n.t('noVideos') || 'No videos uploaded yet.')}
                    </Text>
                  </View>
                ) : (
                  filteredMedia.map(renderMediaCard)
                )}
              </View>
            </>
          )}
        </ScrollView>

        {/* Edit caption modal */}
        <Modal
          visible={!!editingMedia}
          transparent
          animationType="slide"
          onRequestClose={() => setEditingMedia(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>{i18n.t('editCaption') || 'Edit caption'}</Text>
              <Text style={styles.modalHint}>{i18n.t('updateCaptionHint') || 'Update the caption shown on your feed.'}</Text>
              <TextInput
                style={styles.captionInput}
                placeholder={i18n.t('captionPlaceholder') || 'Caption'}
                placeholderTextColor="#999"
                value={editCaption}
                onChangeText={setEditCaption}
                multiline
                numberOfLines={4}
                maxLength={CAPTION_LIMIT}
              />
              <Text style={styles.captionCount}>{editCaption.length}/{CAPTION_LIMIT}</Text>
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={() => { setEditingMedia(null); setEditCaption(''); }}
                >
                  <Text style={styles.cancelButtonText}>{i18n.t('cancel') || 'Cancel'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, styles.saveButton, (saving || unchangedCaption) && styles.modalSaveDisabled]}
                  onPress={handleSaveEdit}
                  disabled={saving || unchangedCaption}
                >
                  {saving ? <FootballLoader size="small" color="#fff" /> : <Text style={styles.saveButtonText}>{i18n.t('saveCaptionChanges') || (i18n.t('save') || 'Save')}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Full screen viewer */}
        <Modal
          visible={!!fullScreenMedia}
          transparent={false}
          animationType="fade"
          onRequestClose={() => setFullScreenMedia(null)}
          statusBarTranslucent
        >
          <View style={styles.fullScreenContainer}>
            <TouchableOpacity style={styles.fullScreenCloseButton} onPress={() => setFullScreenMedia(null)} activeOpacity={0.7}>
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
                  <Image source={{ uri: fullScreenMedia.uri }} style={styles.fullScreenImage} resizeMode="contain" />
                )}
              </View>
            )}
          </View>
        </Modal>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  gradient: { flex: 1 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  loadingText: { color: '#fff', marginTop: 12, fontSize: 16 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  menuButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  placeholder: { width: 40 },
  scrollView: { flex: 1 },
  scrollContent: { padding: 20 },
  heroCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
  },
  heroIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroTextWrap: {
    flex: 1,
  },
  heroTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
  },
  heroText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#4b5563',
  },
  emptyContainer: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 20,
  },
  emptyText: { color: '#f3f4f6', fontSize: 20, marginTop: 16, fontWeight: '700' },
  emptySubtext: { color: '#cbd5e1', fontSize: 14, marginBottom: 24, textAlign: 'center', lineHeight: 20 },
  uploadButton: {
    backgroundColor: '#000',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  uploadButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  statValue: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 4,
  },
  statLabel: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600',
  },
  uploadAnotherButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  uploadAnotherText: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '700',
  },
  filterTabs: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  filterTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  filterTabActive: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderColor: 'rgba(255,255,255,0.92)',
  },
  filterTabText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  filterTabTextActive: {
    color: '#111827',
  },
  mediaSection: {
    marginBottom: 18,
  },
  sectionEmptyState: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sectionEmptyText: {
    color: '#cbd5e1',
    fontSize: 14,
    textAlign: 'center',
  },
  mediaCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    alignItems: 'stretch',
  },
  mediaPreview: {
    width: 116,
    height: 116,
    borderRadius: 12,
    overflow: 'hidden',
    marginRight: 12,
    position: 'relative',
  },
  mediaThumbnail: { width: '100%', height: '100%', resizeMode: 'cover' },
  videoThumbnail: {
    width: '100%',
    height: '100%',
    backgroundColor: '#2d2d2d',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoLabel: { color: '#fff', fontSize: 12, marginTop: 4, fontWeight: '700' },
  previewBadge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    backgroundColor: 'rgba(17,24,39,0.88)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  previewBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  mediaInfo: { flex: 1, justifyContent: 'space-between' },
  mediaMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  mediaType: { fontSize: 16, fontWeight: '700', color: '#fff' },
  mediaCaption: { fontSize: 14, color: '#e5e7eb', marginBottom: 6, lineHeight: 19 },
  mediaCaptionPlaceholder: {
    color: '#9ca3af',
    fontStyle: 'italic',
  },
  mediaHint: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 10,
  },
  mediaDate: { fontSize: 12, color: '#cbd5e1', fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(78, 115, 223, 0.2)',
  },
  editButtonText: {
    color: '#c7d2fe',
    fontSize: 12,
    fontWeight: '700',
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(231, 74, 59, 0.2)',
  },
  deleteButtonText: {
    color: '#fecaca',
    fontSize: 12,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    width: '90%',
    maxWidth: 400,
  },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 8, textAlign: 'center' },
  modalHint: {
    fontSize: 13,
    color: '#cbd5e1',
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 12,
  },
  captionInput: {
    backgroundColor: '#2d2d2d',
    borderRadius: 10,
    padding: 12,
    color: '#fff',
    fontSize: 16,
    marginBottom: 8,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  captionCount: {
    color: '#9ca3af',
    fontSize: 12,
    textAlign: 'right',
    marginBottom: 14,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  modalButton: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center' },
  cancelButton: { backgroundColor: '#444' },
  saveButton: { backgroundColor: '#4e73df' },
  modalSaveDisabled: { opacity: 0.55 },
  cancelButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  fullScreenContainer: { flex: 1, backgroundColor: '#000' },
  fullScreenCloseButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    right: 20,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  fullScreenImage: { width: '100%', height: '100%' },
  fullScreenVideo: { width: '100%', height: '100%' },
});
