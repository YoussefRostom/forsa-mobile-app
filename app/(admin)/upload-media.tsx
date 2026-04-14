import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import i18n from '../../locales/i18n';
import { uploadAndSaveMedia, ResourceType } from '../../services/MediaService';
import { isAdmin } from '../../services/ModerationService';

type DraftMedia = { uri: string; type: 'image' | 'video'; caption?: string };

const C = {
  bg: '#f0f4f8',
  card: '#ffffff',
  border: '#e2e8f0',
  text: '#1e293b',
  subtext: '#64748b',
  muted: '#94a3b8',
  blue: '#2563eb',
  green: '#16a34a',
  red: '#dc2626',
};

export default function AdminUploadMediaScreen() {
  const router = useRouter();
  const [media, setMedia] = useState<DraftMedia[]>([]);
  const [captionDraft, setCaptionDraft] = useState('');
  const [showCaptionInput, setShowCaptionInput] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<{ uri: string; type: 'image' | 'video' } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ [key: number]: boolean }>({});

  React.useEffect(() => {
    const checkAccess = async () => {
      const admin = await isAdmin();
      if (!admin) {
        Alert.alert('Access Denied', 'You must be an admin to access this screen.');
        router.back();
      }
    };
    checkAccess();
  }, []);

  const handleAddMedia = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const asset = result.assets[0];
      setPendingMedia({
        uri: asset.uri,
        type: asset.type === 'video' ? 'video' : 'image',
      });
      setShowCaptionInput(true);
    }
  };

  const handleSaveCaption = () => {
    if (!pendingMedia) return;
    setMedia((prev) => [...prev, { ...pendingMedia, caption: captionDraft }]);
    setCaptionDraft('');
    setPendingMedia(null);
    setShowCaptionInput(false);
  };

  const handleRemoveMedia = (index: number) => {
    setMedia((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (media.length === 0) {
      Alert.alert(i18n.t('error') || 'Error', i18n.t('pleaseAddMedia') || 'Please add at least one media item');
      return;
    }

    setUploading(true);
    const uploadResults: Array<{ success: boolean; error?: string }> = [];

    try {
      for (let i = 0; i < media.length; i++) {
        const item = media[i];
        setUploadProgress((prev) => ({ ...prev, [i]: true }));
        try {
          await uploadAndSaveMedia(item.uri, item.type as ResourceType, 'public', item.caption || '');
          uploadResults.push({ success: true });
        } catch (error: any) {
          console.error(`Upload failed for item ${i}:`, error);
          uploadResults.push({ success: false, error: error.message || 'Upload failed' });
        } finally {
          setUploadProgress((prev) => ({ ...prev, [i]: false }));
        }
      }

      const successCount = uploadResults.filter((r) => r.success).length;
      const failCount = uploadResults.filter((r) => !r.success).length;

      if (successCount > 0) {
        Alert.alert(
          i18n.t('success') || 'Success',
          `${successCount} media item(s) uploaded successfully${failCount > 0 ? `, ${failCount} failed` : ''}`,
          [{ text: 'OK', onPress: () => { setMedia([]); router.back(); } }]
        );
      } else {
        Alert.alert(i18n.t('error') || 'Error', 'Failed to upload media. Please try again.');
      }
    } catch (error: any) {
      Alert.alert(i18n.t('error') || 'Error', error.message || 'An error occurred during upload');
    } finally {
      setUploading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={S.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={S.scrollView} contentContainerStyle={S.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={S.header}>
          <TouchableOpacity style={S.backButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color={C.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={S.headerTitle}>Upload Media</Text>
            <Text style={S.headerSub}>Publish media visible to users across the app.</Text>
          </View>
        </View>

        <View style={S.instructionsCard}>
          <Ionicons name="information-circle-outline" size={20} color={C.blue} />
          <Text style={S.instructionsText}>
            Add images or videos, include optional captions, then upload everything in one batch.
          </Text>
        </View>

        <TouchableOpacity style={S.addButton} onPress={handleAddMedia} disabled={uploading}>
          <Ionicons name="add-circle-outline" size={24} color="#fff" />
          <Text style={S.addButtonText}>Add Media</Text>
        </TouchableOpacity>

        {showCaptionInput && pendingMedia && (
          <View style={S.captionModal}>
            <View style={S.captionCard}>
              <Text style={S.captionTitle}>Add Caption</Text>
              {pendingMedia.type === 'image' ? (
                <Image source={{ uri: pendingMedia.uri }} style={S.previewImage} />
              ) : (
                <View style={S.previewVideo}>
                  <Ionicons name="videocam" size={42} color="#fff" />
                  <Text style={S.previewText}>Video Selected</Text>
                </View>
              )}

              <TextInput
                style={S.captionInput}
                placeholder="Enter caption (optional)"
                placeholderTextColor={C.muted}
                value={captionDraft}
                onChangeText={setCaptionDraft}
                multiline
                numberOfLines={3}
              />

              <View style={S.captionButtons}>
                <TouchableOpacity
                  style={[S.captionBtn, S.cancelBtn]}
                  onPress={() => {
                    setPendingMedia(null);
                    setCaptionDraft('');
                    setShowCaptionInput(false);
                  }}
                >
                  <Text style={S.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[S.captionBtn, S.saveBtn]} onPress={handleSaveCaption}>
                  <Text style={S.saveBtnText}>Add</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {media.length > 0 && (
          <View style={S.mediaList}>
            <Text style={S.mediaListTitle}>Ready to Upload ({media.length})</Text>
            {media.map((item, index) => (
              <View key={index} style={S.mediaItem}>
                <View style={S.mediaPreview}>
                  {item.type === 'image' ? (
                    <Image source={{ uri: item.uri }} style={S.mediaThumbnail} />
                  ) : (
                    <View style={S.videoThumbnail}>
                      <Ionicons name="videocam" size={26} color="#fff" />
                    </View>
                  )}
                  {uploadProgress[index] && (
                    <View style={S.uploadOverlay}>
                      <ActivityIndicator size="large" color="#fff" />
                    </View>
                  )}
                </View>

                <View style={S.mediaInfo}>
                  <Text style={S.mediaType}>{item.type === 'image' ? 'Image' : 'Video'}</Text>
                  {!!item.caption && <Text style={S.mediaCaption} numberOfLines={2}>{item.caption}</Text>}
                </View>

                <TouchableOpacity style={S.removeButton} onPress={() => handleRemoveMedia(index)} disabled={uploading}>
                  <Ionicons name="close-circle" size={24} color={C.red} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {media.length > 0 && (
          <TouchableOpacity style={[S.submitButton, uploading && S.submitButtonDisabled]} onPress={handleSubmit} disabled={uploading}>
            {uploading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="cloud-upload" size={20} color="#fff" />
                <Text style={S.submitButtonText}>Upload Media</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16, paddingTop: Platform.OS === 'ios' ? 56 : 16, paddingBottom: 30 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  backButton: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: C.text },
  headerSub: { fontSize: 12, color: C.subtext, marginTop: 2 },

  instructionsCard: { flexDirection: 'row', gap: 10, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, marginBottom: 14 },
  instructionsText: { flex: 1, fontSize: 13, color: C.subtext, lineHeight: 18 },

  addButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.text, borderRadius: 12, padding: 14, marginBottom: 14 },
  addButtonText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  captionModal: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  captionCard: { width: '92%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14 },
  captionTitle: { fontSize: 16, fontWeight: '800', color: C.text, marginBottom: 10, textAlign: 'center' },
  previewImage: { width: '100%', height: 180, borderRadius: 10, marginBottom: 12, resizeMode: 'cover' },
  previewVideo: { width: '100%', height: 180, borderRadius: 10, marginBottom: 12, backgroundColor: '#334155', justifyContent: 'center', alignItems: 'center' },
  previewText: { marginTop: 6, color: '#fff', fontSize: 13 },
  captionInput: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 10, color: C.text, fontSize: 14, minHeight: 72, textAlignVertical: 'top' },
  captionButtons: { flexDirection: 'row', gap: 10, marginTop: 12 },
  captionBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  cancelBtn: { backgroundColor: '#e2e8f0' },
  saveBtn: { backgroundColor: C.blue },
  cancelBtnText: { color: '#334155', fontSize: 14, fontWeight: '700' },
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  mediaList: { marginBottom: 14 },
  mediaListTitle: { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 10 },
  mediaItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 10, marginBottom: 8 },
  mediaPreview: { width: 76, height: 76, borderRadius: 10, overflow: 'hidden', marginRight: 10, position: 'relative', backgroundColor: '#e5e7eb' },
  mediaThumbnail: { width: '100%', height: '100%' },
  videoThumbnail: { width: '100%', height: '100%', backgroundColor: '#334155', justifyContent: 'center', alignItems: 'center' },
  uploadOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.6)', justifyContent: 'center', alignItems: 'center' },
  mediaInfo: { flex: 1 },
  mediaType: { fontSize: 14, fontWeight: '700', color: C.text },
  mediaCaption: { marginTop: 2, fontSize: 12, color: C.subtext },
  removeButton: { padding: 6 },

  submitButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.green, borderRadius: 12, padding: 14, marginTop: 6 },
  submitButtonDisabled: { opacity: 0.65 },
  submitButtonText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
