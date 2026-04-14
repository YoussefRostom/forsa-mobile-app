import React, { useState } from 'react';
import { TouchableOpacity, StyleSheet, Modal, View, Text, Alert, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { auth } from '../lib/firebase';
import ReportModal from './ReportModal';
import { updatePost, deletePostByOwner } from '../services/PostService';
import i18n from '../locales/i18n';

interface PostActionsMenuProps {
  postId: string;
  postOwnerId: string;
  postOwnerRole?: string;
  mediaUrl?: string;
  mediaType?: string;
  contentText?: string;
  postTimestamp?: any;
  reportedUserName?: string;
  onPostUpdated?: () => void;
  onPostDeleted?: () => void;
}

export default function PostActionsMenu({
  postId,
  postOwnerId,
  postOwnerRole,
  mediaUrl,
  mediaType,
  contentText,
  postTimestamp,
  reportedUserName,
  onPostUpdated,
  onPostDeleted,
}: PostActionsMenuProps) {
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [showReportPostModal, setShowReportPostModal] = useState(false);
  const [showReportUserModal, setShowReportUserModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editContent, setEditContent] = useState(contentText || '');
  const [saving, setSaving] = useState(false);

  const currentUserId = auth.currentUser?.uid;
  const isOwner = currentUserId === postOwnerId;

  const handleReportPost = () => {
    setShowActionSheet(false);
    setShowReportPostModal(true);
  };

  const handleReportUser = () => {
    setShowActionSheet(false);
    setShowReportUserModal(true);
  };

  const handleEdit = () => {
    setEditContent(contentText || '');
    setShowActionSheet(false);
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    const text = editContent.trim();
    if (!text) return;
    setSaving(true);
    try {
      await updatePost(postId, { content: text });
      setShowEditModal(false);
      onPostUpdated?.();
    } catch (e: any) {
      Alert.alert(i18n.t('error') || 'Error', e?.message || i18n.t('submissionError') || 'Failed to update');
    }
    setSaving(false);
  };

  const handleDelete = () => {
    setShowActionSheet(false);

    if (!isOwner) {
      Alert.alert(i18n.t('error') || 'Error', i18n.t('cannotDeleteOtherUsersPost') || 'You cannot delete another user\'s post.');
      return;
    }

    Alert.alert(
      i18n.t('deletePost') || 'Delete Post',
      i18n.t('deletePostConfirm') || 'Are you sure you want to delete this post?',
      [
        { text: i18n.t('cancel') || 'Cancel', style: 'cancel' },
        {
          text: i18n.t('delete') || 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePostByOwner(postId);
              onPostDeleted?.();
            } catch (e: any) {
              Alert.alert(i18n.t('error') || 'Error', e?.message || 'Failed to delete');
            }
          },
        },
      ]
    );
  };

  const getSnapshot = () => {
    return {
      postOwnerId,
      postOwnerRole: postOwnerRole || undefined,
      mediaUrl: mediaUrl || undefined,
      mediaType: mediaType || undefined,
      contentText: contentText || undefined,
      postTimestamp: postTimestamp || undefined,
      reportedUserName: reportedUserName || undefined,
    };
  };

  return (
    <>
      <TouchableOpacity
        style={styles.menuButton}
        onPress={() => setShowActionSheet(true)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="ellipsis-vertical" size={20} color="#666" />
      </TouchableOpacity>

      {/* Action Sheet Modal */}
      <Modal
        visible={showActionSheet}
        transparent
        animationType="fade"
        onRequestClose={() => setShowActionSheet(false)}
      >
        <TouchableOpacity
          style={styles.actionSheetOverlay}
          activeOpacity={1}
          onPress={() => setShowActionSheet(false)}
        >
          <View style={styles.actionSheetContainer}>
            {isOwner ? (
              <>
                <TouchableOpacity style={styles.actionSheetItem} onPress={handleEdit}>
                  <Ionicons name="pencil-outline" size={20} color="#007AFF" />
                  <Text style={styles.actionSheetText}>{i18n.t('edit') || 'Edit'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionSheetItem} onPress={handleDelete}>
                  <Ionicons name="trash-outline" size={20} color="#FF3B30" />
                  <Text style={[styles.actionSheetText, { color: '#FF3B30' }]}>{i18n.t('delete') || 'Delete'}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity style={styles.actionSheetItem} onPress={handleReportPost}>
                  <Ionicons name="flag-outline" size={20} color="#FF3B30" />
                  <Text style={styles.actionSheetText}>{i18n.t('reportPost') || 'Report Post'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionSheetItem} onPress={handleReportUser}>
                  <Ionicons name="person-remove-outline" size={20} color="#FF3B30" />
                  <Text style={styles.actionSheetText}>{i18n.t('reportUser') || 'Report User'}</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity
              style={[styles.actionSheetItem, styles.actionSheetCancel]}
              onPress={() => setShowActionSheet(false)}
            >
              <Text style={styles.actionSheetCancelText}>{i18n.t('cancel') || 'Cancel'}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Report Post Modal */}
      <ReportModal
        visible={showReportPostModal}
        onClose={() => setShowReportPostModal(false)}
        targetType="post"
        targetId={postId}
        snapshot={getSnapshot()}
        reportedUserName={reportedUserName}
      />

      {/* Report User Modal */}
      <ReportModal
        visible={showReportUserModal}
        onClose={() => setShowReportUserModal(false)}
        targetType="user"
        targetId={postOwnerId}
        snapshot={getSnapshot()}
        reportedUserName={reportedUserName}
      />

      {/* Edit Post Modal */}
      <Modal visible={showEditModal} transparent animationType="fade" onRequestClose={() => !saving && setShowEditModal(false)}>
        <TouchableOpacity
          style={styles.actionSheetOverlay}
          activeOpacity={1}
          onPress={() => !saving && setShowEditModal(false)}
        >
          <View style={[styles.editModalContainer]} onStartShouldSetResponder={() => true}>
            <Text style={styles.editModalTitle}>{i18n.t('editPost') || 'Edit Post'}</Text>
            <TextInput
              style={styles.editInput}
              placeholder={i18n.t('postPlaceholder') || 'Write your post...'}
              value={editContent}
              onChangeText={setEditContent}
              multiline
              numberOfLines={5}
              editable={!saving}
            />
            <View style={styles.editActions}>
              <TouchableOpacity style={styles.editCancelBtn} onPress={() => !saving && setShowEditModal(false)} disabled={saving}>
                <Text style={styles.editCancelText}>{i18n.t('cancel') || 'Cancel'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.editSaveBtn} onPress={handleSaveEdit} disabled={saving || !editContent.trim()}>
                <Text style={styles.editSaveText}>{saving ? (i18n.t('saving') || 'Saving...') : (i18n.t('save') || 'Save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  menuButton: {
    padding: 8,
  },
  actionSheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  actionSheetContainer: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 20,
  },
  actionSheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  actionSheetText: {
    fontSize: 16,
    color: '#000',
    marginLeft: 12,
  },
  actionSheetCancel: {
    borderBottomWidth: 0,
    justifyContent: 'center',
    marginTop: 8,
  },
  actionSheetCancelText: {
    fontSize: 16,
    color: '#FF3B30',
    fontWeight: '600',
  },
  editModalContainer: {
    backgroundColor: '#fff',
    marginHorizontal: 24,
    borderRadius: 16,
    padding: 20,
  },
  editModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    color: '#000',
  },
  editInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: '#000',
    minHeight: 100,
    textAlignVertical: 'top',
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 16,
  },
  editCancelBtn: { paddingVertical: 10, paddingHorizontal: 16 },
  editCancelText: { fontSize: 16, color: '#666' },
  editSaveBtn: { backgroundColor: '#007AFF', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10 },
  editSaveText: { fontSize: 16, fontWeight: '600', color: '#fff' },
});

