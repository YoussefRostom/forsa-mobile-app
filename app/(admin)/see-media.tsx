import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode } from 'expo-av';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { collection, doc, getDoc, onSnapshot, query, getDocs, where, deleteDoc, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';

const resolveDisplayName = (user: any) => {
  const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();

  return (
    user?.name ||
    user?.academyName ||
    user?.clinicName ||
    user?.parentName ||
    user?.playerName ||
    user?.agentName ||
    fullName ||
    user?.email ||
    user?.phone ||
    'Unknown User'
  );
};
import { isAdmin } from '../../services/ModerationService';

interface MediaItem {
  id: string;
  secureUrl: string;
  resourceType: 'image' | 'video';
  createdAt: any;
  ownerId: string;
  ownerName: string;
  ownerRole: string;
  content?: string;
}

const C = {
  bg: '#f0f4f8',
  card: '#ffffff',
  border: '#e2e8f0',
  text: '#1e293b',
  subtext: '#64748b',
  muted: '#94a3b8',
  red: '#dc2626',
  blue: '#2563eb',
  blueLight: '#eff6ff',
};

export default function AdminAllMediaScreen() {
  const router = useRouter();
  const [mediaList, setMediaList] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [fullScreenMedia, setFullScreenMedia] = useState<{ uri: string; type: 'image' | 'video' } | null>(null);

  const handleDeleteMedia = (mediaId: string) => {
    Alert.alert(
      'Delete Media',
      'Are you sure you want to delete this media? It will be removed from all feeds.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingId(mediaId);
            try {
              await deleteDoc(doc(db, 'media', mediaId));
              const postsRef = collection(db, 'posts');
              const postQuery = query(postsRef, where('mediaId', '==', mediaId));
              const postSnap = await getDocs(postQuery);

              if (!postSnap.empty) {
                const batch = writeBatch(db);
                postSnap.forEach((docSnap) => {
                  batch.delete(docSnap.ref);
                });
                await batch.commit();
              }

              Alert.alert('Success', 'Media and associated posts deleted successfully.');
            } catch (error) {
              console.error('Error deleting media:', error);
              Alert.alert('Error', 'Failed to delete media.');
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  };

  useEffect(() => {
    const checkAccess = async () => {
      const admin = await isAdmin();
      if (!admin) {
        Alert.alert('Access Denied', 'You must be an admin to access this screen.');
        router.back();
      }
    };
    checkAccess();

    const mediaRef = collection(db, 'media');
    const q = query(mediaRef);

    const unsubscribe = onSnapshot(
      q,
      async (snapshot) => {
        const rawMedia: any[] = [];
        snapshot.forEach((docSnap) => {
          rawMedia.push({ id: docSnap.id, ...docSnap.data() });
        });

        rawMedia.sort((a, b) => {
          const aTime = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0;
          const bTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0;
          return bTime - aTime;
        });

        const uniqueOwnerIds = Array.from(new Set(rawMedia.map((m) => m.ownerId).filter(Boolean)));
        const userMap: Record<string, any> = {};

        await Promise.all(
          uniqueOwnerIds.map(async (uid) => {
            try {
              const uDoc = await getDoc(doc(db, 'users', uid));
              if (uDoc.exists()) userMap[uid] = uDoc.data();
            } catch (err) {
              console.warn(`Failed to fetch user ${uid}:`, err);
            }
          })
        );

        const postsRef = collection(db, 'posts');
        const finalMedia = await Promise.all(
          rawMedia.map(async (m) => {
            let uName = 'Unknown User';
            let uRole = 'Guest';

            if (m.ownerId && userMap[m.ownerId]) {
              const uData = userMap[m.ownerId];
              uName = resolveDisplayName(uData);
              uRole = uData.role ? uData.role.charAt(0).toUpperCase() + uData.role.slice(1).toLowerCase() : 'Guest';
            }

            let postContent = '';
            try {
              if (m.ownerId) {
                const postQuery = query(postsRef, where('mediaId', '==', m.id), where('ownerId', '==', m.ownerId));
                const postSnap = await getDocs(postQuery);
                if (!postSnap.empty) postContent = postSnap.docs[0].data().content || '';
              }
            } catch (_err) {}

            return {
              ...m,
              ownerName: uName,
              ownerRole: uRole,
              content: postContent,
            } as MediaItem;
          })
        );

        setMediaList(finalMedia);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching all media:', error);
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

  if (loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator size="large" color={C.blue} />
        <Text style={S.loadingText}>Loading platform media...</Text>
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
          <Text style={S.headerTitle}>All Platform Media</Text>
          <Text style={S.headerSub}>Review uploaded content from all users.</Text>
        </View>
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
            <Text style={S.emptySub}>Once users upload media, it will appear here.</Text>
          </View>
        ) : (
          mediaList.map((media) => (
            <View key={media.id} style={S.mediaCard}>
              <TouchableOpacity style={S.mediaPreview} onPress={() => setFullScreenMedia({ uri: media.secureUrl, type: media.resourceType })}>
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
                <Text style={S.uploaderText} numberOfLines={1}>
                  {media.ownerName} <Text style={S.roleText}>({media.ownerRole})</Text>
                </Text>
                {!!media.content && <Text style={S.mediaCaption} numberOfLines={2}>{media.content}</Text>}
                <Text style={S.mediaDate}>
                  {media.createdAt?.toDate ? media.createdAt.toDate().toLocaleDateString() : 'Unknown date'}
                </Text>
              </View>

              <View style={S.actions}>
                <TouchableOpacity style={S.eyeButton} onPress={() => setFullScreenMedia({ uri: media.secureUrl, type: media.resourceType })}>
                  <Ionicons name="eye-outline" size={19} color={C.subtext} />
                </TouchableOpacity>
                <TouchableOpacity style={S.deleteButton} onPress={() => handleDeleteMedia(media.id)} disabled={deletingId === media.id}>
                  {deletingId === media.id ? <ActivityIndicator size="small" color={C.red} /> : <Ionicons name="trash-outline" size={19} color={C.red} />}
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>

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
  loadingText: { marginTop: 10, color: C.subtext, fontSize: 14 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: Platform.OS === 'ios' ? 56 : 18, paddingHorizontal: 16, paddingBottom: 12 },
  backButton: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: C.text },
  headerSub: { fontSize: 12, color: C.subtext, marginTop: 2 },

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

  mediaCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 10, marginBottom: 10 },
  mediaPreview: { width: 88, height: 88, borderRadius: 10, overflow: 'hidden', marginRight: 10, backgroundColor: '#e5e7eb' },
  mediaThumbnail: { width: '100%', height: '100%' },
  videoThumbnail: { width: '100%', height: '100%', backgroundColor: '#334155', justifyContent: 'center', alignItems: 'center' },
  videoLabel: { color: '#fff', marginTop: 3, fontSize: 11 },
  mediaInfo: { flex: 1 },
  uploaderText: { fontSize: 14, fontWeight: '700', color: C.text },
  roleText: { color: C.subtext, fontWeight: '500' },
  mediaCaption: { fontSize: 13, color: C.subtext, marginTop: 2 },
  mediaDate: { fontSize: 11, color: C.muted, marginTop: 5 },
  actions: { flexDirection: 'row', gap: 6 },
  eyeButton: { width: 34, height: 34, borderRadius: 8, backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center' },
  deleteButton: { width: 34, height: 34, borderRadius: 8, backgroundColor: '#fef2f2', justifyContent: 'center', alignItems: 'center' },

  fullScreenContainer: { flex: 1, backgroundColor: '#000' },
  fullScreenCloseButton: { position: 'absolute', top: Platform.OS === 'ios' ? 56 : 24, right: 16, zIndex: 10, width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center' },
  fullScreenContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  fullScreenImage: { width: '100%', height: '100%' },
  fullScreenVideo: { width: '100%', height: '100%' },
});
