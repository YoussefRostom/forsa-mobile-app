import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { useRouter } from 'expo-router';
import { collection, query, where, onSnapshot, getDocs, getFirestore } from 'firebase/firestore';
import { auth } from '../../lib/firebase';
import { isAdmin } from '../../services/ModerationService';
import { updateMediaCaption, deleteAdminMedia, type MediaDoc } from '../../services/MediaService';

const C = {
  bg: '#f0f4f8',
  card: '#ffffff',
  border: '#e2e8f0',
  text: '#1e293b',
  subtext: '#64748b',
  muted: '#94a3b8',
  blue: '#2563eb',
  blueLight: '#eff6ff',
  red: '#dc2626',
  redLight: '#fef2f2',
};

type OwnedMedia = MediaDoc & { postId?: string | null; content?: string };

export default function AdminMyMediaScreen() {
  const router = useRouter();
  const [mediaList, setMediaList] = useState<OwnedMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingMedia, setEditingMedia] = useState<{ id: string; content: string; postId: string | null } | null>(null);
  const [editCaption, setEditCaption] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [fullScreenMedia, setFullScreenMedia] = useState<{ uri: string; type: 'image' | 'video' } | null>(null);

  useEffect(() => {
    const checkAccess = async () => {
      const admin = await isAdmin();
      if (!admin) {
        Alert.alert('Access Denied', 'You must be an admin to access this screen.');
        router.back();
      }
    };
    checkAccess();

    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      return;
    }

    const db = getFirestore();
    const mediaRef = collection(db, 'media');
    const q = query(mediaRef, where('ownerId', '==', user.uid));

    const unsubscribe = onSnapshot(
      q,
      async (snapshot) => {
        const media: MediaDoc[] = [];
        snapshot.forEach((snap) => {
          media.push({ id: snap.id, ...snap.data() } as MediaDoc);
        });

        media.sort((a, b) => {
          const aTime = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
          const bTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
          return bTime - aTime;
        });

        const postsRef = collection(db, 'posts');
        const withPosts = await Promise.all(
          media.map(async (m) => {
            const postQuery = query(postsRef, where('mediaId', '==', m.id), where('ownerId', '==', user.uid));
            const postSnap = await getDocs(postQuery);
            const post = postSnap.docs[0];
            return {
              ...m,
              postId: post?.id || null,
              content: post?.data()?.content || '',
            } as OwnedMedia;
          })
        );

        setMediaList(withPosts);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching media:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const stats = useMemo(() => {
    const images = mediaList.filter((m) => m.resourceType === 'image').length;
    const videos = mediaList.filter((m) => m.resourceType === 'video').length;
    return { total: mediaList.length, images, videos };
  }, [mediaList]);

  const handleEdit = (media: OwnedMedia) => {
    setEditingMedia({ id: media.id, content: media.content || '', postId: media.postId || null });
    setEditCaption(media.content || '');
  };

  const handleSaveEdit = async () => {
    if (!editingMedia) return;
    setSaving(true);
    try {
      await updateMediaCaption(editingMedia.id, editingMedia.postId, editCaption);
      setEditingMedia(null);
      setEditCaption('');
      Alert.alert('Success', 'Caption updated successfully.');
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to update caption.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (media: OwnedMedia) => {
    Alert.alert(
      'Delete Media',
      'Are you sure you want to delete this media? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(media.id);
            try {
              await deleteAdminMedia(media.id, media.postId || null);
              Alert.alert('Success', 'Media deleted successfully.');
            } catch (error: any) {
              Alert.alert('Error', error?.message || 'Failed to delete media.');
            } finally {
              setDeleting(null);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator size="large" color={C.blue} />
        <Text style={S.loadingText}>Loading your media...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={S.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={S.header}>
        <TouchableOpacity style={S.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.headerTitle}>My Media</Text>
          <Text style={S.headerSub}>Manage media uploaded from this admin account.</Text>
        </View>
        <TouchableOpacity style={S.headerAction} onPress={() => router.push('/(admin)/upload-media')}>
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={S.statsRow}>
        <View style={S.statCard}><Text style={S.statLabel}>Total</Text><Text style={S.statValue}>{stats.total}</Text></View>
        <View style={S.statCard}><Text style={S.statLabel}>Images</Text><Text style={[S.statValue, { color: C.blue }]}>{stats.images}</Text></View>
        <View style={S.statCard}><Text style={S.statLabel}>Videos</Text><Text style={[S.statValue, { color: '#0d9488' }]}>{stats.videos}</Text></View>
      </View>

      <ScrollView style={S.scrollView} contentContainerStyle={S.scrollContent} showsVerticalScrollIndicator={false}>
        {mediaList.length === 0 ? (
          <View style={S.emptyContainer}>
            <View style={S.emptyIcon}><Ionicons name="images-outline" size={30} color={C.muted} /></View>
            <Text style={S.emptyTitle}>No media uploaded yet</Text>
            <Text style={S.emptySub}>Upload your first media item to start publishing content.</Text>
            <TouchableOpacity style={S.primaryButton} onPress={() => router.push('/(admin)/upload-media')}>
              <Text style={S.primaryButtonText}>Upload Media</Text>
            </TouchableOpacity>
          </View>
        ) : (
          mediaList.map((media) => (
            <View key={media.id} style={S.mediaCard}>
              <TouchableOpacity
                style={S.mediaPreview}
                onPress={() => setFullScreenMedia({ uri: media.secureUrl, type: media.resourceType })}
              >
                {media.resourceType === 'image' ? (
                  <Image source={{ uri: media.secureUrl }} style={S.mediaThumbnail} />
                ) : (
                  <View style={S.videoThumbnail}>
                    <Ionicons name="videocam" size={28} color="#fff" />
                    <Text style={S.videoLabel}>Video</Text>
                  </View>
                )}
              </TouchableOpacity>

              <View style={S.mediaInfo}>
                <Text style={S.mediaType}>{media.resourceType === 'image' ? 'Image' : 'Video'}</Text>
                {!!media.content && <Text style={S.mediaCaption} numberOfLines={2}>{media.content}</Text>}
                <Text style={S.mediaDate}>
                  {media.createdAt?.toDate ? media.createdAt.toDate().toLocaleDateString() : 'Unknown date'}
                </Text>
              </View>

              <View style={S.actions}>
                <TouchableOpacity style={S.editButton} onPress={() => handleEdit(media)} disabled={deleting === media.id}>
                  <Ionicons name="create-outline" size={18} color={C.blue} />
                </TouchableOpacity>
                <TouchableOpacity style={S.deleteButton} onPress={() => handleDelete(media)} disabled={deleting === media.id}>
                  {deleting === media.id ? (
                    <ActivityIndicator size="small" color={C.red} />
                  ) : (
                    <Ionicons name="trash-outline" size={18} color={C.red} />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={!!editingMedia} transparent animationType="slide" onRequestClose={() => setEditingMedia(null)}>
        <View style={S.modalOverlay}>
          <View style={S.modalContent}>
            <Text style={S.modalTitle}>Edit Caption</Text>
            <TextInput
              style={S.captionInput}
              placeholder="Enter caption"
              placeholderTextColor={C.muted}
              value={editCaption}
              onChangeText={setEditCaption}
              multiline
              numberOfLines={4}
            />
            <View style={S.modalActions}>
              <TouchableOpacity
                style={[S.modalButton, S.cancelButton]}
                onPress={() => {
                  setEditingMedia(null);
                  setEditCaption('');
                }}
              >
                <Text style={S.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[S.modalButton, S.saveButton]} onPress={handleSaveEdit} disabled={saving}>
                {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={S.saveButtonText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!fullScreenMedia} transparent={false} animationType="fade" onRequestClose={() => setFullScreenMedia(null)}>
        <View style={S.fullScreenContainer}>
          <TouchableOpacity style={S.fullScreenCloseButton} onPress={() => setFullScreenMedia(null)} activeOpacity={0.7}>
            <Ionicons name="close" size={30} color="#fff" />
          </TouchableOpacity>
          {fullScreenMedia && (
            <View style={S.fullScreenContent}>
              {fullScreenMedia.type === 'video' ? (
                <Video source={{ uri: fullScreenMedia.uri }} style={S.fullScreenVideo} useNativeControls resizeMode={ResizeMode.CONTAIN} isLooping={false} />
              ) : (
                <Image source={{ uri: fullScreenMedia.uri }} style={S.fullScreenImage} resizeMode="contain" />
              )}
            </View>
          )}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 10, fontSize: 14, color: C.subtext },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: Platform.OS === 'ios' ? 56 : 18,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backButton: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: C.text },
  headerSub: { fontSize: 12, color: C.subtext, marginTop: 2 },
  headerAction: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.text, justifyContent: 'center', alignItems: 'center' },

  statsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 8 },
  statCard: { flex: 1, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingVertical: 10, paddingHorizontal: 10 },
  statLabel: { fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  statValue: { marginTop: 2, fontSize: 17, fontWeight: '800', color: C.text },

  scrollView: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 28 },
  emptyContainer: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 20 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.border, justifyContent: 'center', alignItems: 'center' },
  emptyTitle: { marginTop: 12, fontSize: 16, fontWeight: '700', color: C.text },
  emptySub: { marginTop: 4, color: C.subtext, textAlign: 'center' },
  primaryButton: { marginTop: 16, backgroundColor: C.text, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  primaryButtonText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  mediaCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 10, marginBottom: 10 },
  mediaPreview: { width: 88, height: 88, borderRadius: 10, overflow: 'hidden', marginRight: 10, backgroundColor: '#e5e7eb' },
  mediaThumbnail: { width: '100%', height: '100%' },
  videoThumbnail: { width: '100%', height: '100%', backgroundColor: '#334155', justifyContent: 'center', alignItems: 'center' },
  videoLabel: { color: '#fff', marginTop: 3, fontSize: 11 },
  mediaInfo: { flex: 1 },
  mediaType: { fontSize: 14, fontWeight: '700', color: C.text },
  mediaCaption: { fontSize: 13, color: C.subtext, marginTop: 2 },
  mediaDate: { fontSize: 11, color: C.muted, marginTop: 5 },
  actions: { flexDirection: 'row', gap: 6 },
  editButton: { width: 34, height: 34, borderRadius: 8, backgroundColor: C.blueLight, justifyContent: 'center', alignItems: 'center' },
  deleteButton: { width: 34, height: 34, borderRadius: 8, backgroundColor: C.redLight, justifyContent: 'center', alignItems: 'center' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: '90%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 16 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: C.text, marginBottom: 10 },
  captionInput: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 10, color: C.text, fontSize: 14, minHeight: 92, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  modalButton: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  cancelButton: { backgroundColor: '#e2e8f0' },
  saveButton: { backgroundColor: C.blue },
  cancelButtonText: { color: '#334155', fontSize: 14, fontWeight: '700' },
  saveButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  fullScreenContainer: { flex: 1, backgroundColor: '#000' },
  fullScreenCloseButton: { position: 'absolute', top: Platform.OS === 'ios' ? 56 : 24, right: 16, zIndex: 10, width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center' },
  fullScreenContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  fullScreenImage: { width: '100%', height: '100%' },
  fullScreenVideo: { width: '100%', height: '100%' },
});
