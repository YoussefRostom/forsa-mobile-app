import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { subscribeReportsForAdmin, updateReportStatus, Report, ReportStatus } from '../../services/ReportService';
import { removePost, suspendUser, unsuspendUser, isAdmin } from '../../services/ModerationService';
import { auth, db } from '../../lib/firebase';
import { Video, ResizeMode } from 'expo-av';
import { Timestamp, doc, getDoc } from 'firebase/firestore';
import { formatTimestamp } from '../../lib/dateUtils';
import i18n from '../../locales/i18n';

export default function AdminReportsScreen() {
  const router = useRouter();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<ReportStatus | null>('open');
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [showActionModal, setShowActionModal] = useState(false);
  const [actionNote, setActionNote] = useState('');
  const [performingAction, setPerformingAction] = useState(false);
  const [isUserAdmin, setIsUserAdmin] = useState(false);
  const [reporterNames, setReporterNames] = useState<Record<string, string>>({});
  const [targetUserSuspended, setTargetUserSuspended] = useState<boolean | null>(null);

  useEffect(() => {
    // Check if user is admin
    const checkAdmin = async () => {
      const admin = await isAdmin();
      setIsUserAdmin(admin);
      if (!admin) {
        Alert.alert(i18n.t('accessDenied'), i18n.t('accessDeniedMessage'));
        router.back();
        return;
      }
    };
    checkAdmin();
  }, []);

  useEffect(() => {
    if (!isUserAdmin) return;

    setLoading(true);
    const unsubscribe = subscribeReportsForAdmin(statusFilter, async (reportsData) => {
      setReports(reportsData);
      
      // Fetch reporter names for all unique reporter IDs
      const uniqueReporterIds = [...new Set(reportsData.map(r => r.reporterId))];
      const nameMap: Record<string, string> = {};
      
      await Promise.all(
        uniqueReporterIds.map(async (reporterId) => {
          try {
            const userDoc = await getDoc(doc(db, 'users', reporterId));
            if (userDoc.exists()) {
              const userData = userDoc.data();
              let name = '';
              
              // Try role-specific name fields first
              if (userData.agentName) {
                name = userData.agentName;
              } else if (userData.academyName) {
                name = userData.academyName;
              } else if (userData.clinicName) {
                name = userData.clinicName;
              } else if (userData.parentName) {
                name = userData.parentName;
              } else if (userData.playerName) {
                name = userData.playerName;
              }
              // Fallback to firstName/lastName
              else if (userData.firstName && userData.lastName) {
                name = `${userData.firstName} ${userData.lastName}`;
              } else if (userData.firstName || userData.lastName) {
                name = userData.firstName || userData.lastName;
              }
              // Fallback to email or phone
              else if (userData.email) {
                name = userData.email.split('@')[0];
              } else if (userData.phone) {
                name = userData.phone;
              } else {
                name = reporterId.substring(0, 8);
              }
              
              nameMap[reporterId] = name;
            } else {
              nameMap[reporterId] = reporterId.substring(0, 8);
            }
          } catch (error) {
            console.error('Error fetching reporter name:', error);
            nameMap[reporterId] = reporterId.substring(0, 8);
          }
        })
      );
      
      setReporterNames(nameMap);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [statusFilter, isUserAdmin]);

  const handleAction = async (action: string) => {
    if (!selectedReport || !auth.currentUser) return;

    setPerformingAction(true);
    try {
      const adminId = auth.currentUser.uid;
      let resolutionAction: 'none' | 'post_removed' | 'user_suspended' | 'user_unsuspended' | 'dismissed' = 'none';
      let targetUserId: string | null = null;

      switch (action) {
        case 'remove_post':
          if (selectedReport.targetType === 'post') {
            await removePost(selectedReport.targetId, adminId, actionNote);
            resolutionAction = 'post_removed';
            targetUserId = selectedReport.snapshot?.postOwnerId || null;
          }
          break;

        case 'suspend_user':
          targetUserId = selectedReport.targetType === 'user' 
            ? selectedReport.targetId 
            : selectedReport.snapshot?.postOwnerId || null;
          if (targetUserId) {
            await suspendUser(targetUserId, adminId, actionNote || 'Reported content');
            resolutionAction = 'user_suspended';
          }
          break;

        case 'unsuspend_user':
          targetUserId = selectedReport.targetType === 'user' 
            ? selectedReport.targetId 
            : selectedReport.snapshot?.postOwnerId || null;
          if (targetUserId) {
            await unsuspendUser(targetUserId, adminId, actionNote);
            resolutionAction = 'user_unsuspended';
          }
          break;

        case 'mark_reviewed':
          await updateReportStatus(selectedReport.id, {
            status: 'reviewed',
            assignedAdminId: adminId,
          });
          setShowActionModal(false);
          setSelectedReport(null);
          setActionNote('');
          Alert.alert(i18n.t('success') || 'Success', i18n.t('reportMarkedReviewed'));
          return;

        case 'dismiss':
          resolutionAction = 'dismissed';
          break;
      }

      // Update report with resolution
      await updateReportStatus(selectedReport.id, {
        status: 'resolved',
        assignedAdminId: adminId,
        resolution: {
          action: resolutionAction,
          note: actionNote || null,
          actedBy: adminId,
          actedAt: Timestamp.now(),
        },
      });

      setShowActionModal(false);
      setSelectedReport(null);
      setActionNote('');
      Alert.alert(i18n.t('success') || 'Success', i18n.t('actionSuccess'));
    } catch (error: any) {
      Alert.alert(i18n.t('error') || 'Error', error.message || i18n.t('actionError'));
    } finally {
      setPerformingAction(false);
    }
  };

  const getTargetUserId = (report: Report | null): string | null => {
    if (!report) return null;
    if (report.targetType === 'user') return report.targetId;
    return report.snapshot?.postOwnerId ?? null;
  };

  const openActionModal = async (report: Report) => {
    setSelectedReport(report);
    setActionNote('');
    setShowActionModal(true);
    setTargetUserSuspended(null);
    const targetUserId = getTargetUserId(report);
    if (targetUserId) {
      try {
        const userSnap = await getDoc(doc(db, 'users', targetUserId));
        const targetUser = userSnap.exists() ? userSnap.data() : null;
        setTargetUserSuspended(
          !!targetUser && (
            targetUser?.isSuspended === true ||
            String(targetUser?.status || '').toLowerCase() === 'suspended'
          )
        );
      } catch {
        setTargetUserSuspended(false);
      }
    } else {
      setTargetUserSuspended(false);
    }
  };

  const formatDate = (timestamp: unknown) =>
    formatTimestamp(timestamp, { fallback: 'Unknown' });

  const renderReportItem = ({ item }: { item: Report }) => {
    const isPost = item.targetType === 'post';
    const snapshot = item.snapshot || {};

    return (
      <TouchableOpacity
        style={styles.reportCard}
        onPress={() => openActionModal(item)}
      >
        <View style={styles.reportHeader}>
          <View style={styles.reportHeaderLeft}>
            <Ionicons
              name={isPost ? 'document-text' : 'person'}
              size={20}
              color={item.status === 'open' ? '#FF3B30' : '#999'}
            />
            <Text style={styles.reportType}>
              {isPost ? i18n.t('postReport') : i18n.t('userReport')}
            </Text>
            <View style={[styles.statusBadge, styles[`status${item.status}`]]}>
              <Text style={styles.statusText}>{item.status}</Text>
            </View>
          </View>
          <Text style={styles.reportDate}>{formatDate(item.createdAt)}</Text>
        </View>

        <Text style={styles.reportReason}>
          <Text style={styles.label}>Reason: </Text>
          {item.reason}
        </Text>

        {item.details && (
          <Text style={styles.reportDetails} numberOfLines={2}>
            {item.details}
          </Text>
        )}

        {isPost && snapshot.mediaUrl && (
          <View style={styles.mediaPreview}>
            {snapshot.mediaType === 'video' ? (
              <Video
                source={{ uri: snapshot.mediaUrl }}
                style={styles.mediaThumbnail}
                useNativeControls={false}
                resizeMode={ResizeMode.COVER}
                shouldPlay={false}
              />
            ) : (
              <Image
                source={{ uri: snapshot.mediaUrl }}
                style={styles.mediaThumbnail}
                resizeMode="cover"
              />
            )}
            {snapshot.contentText && (
              <Text style={styles.caption} numberOfLines={2}>
                {snapshot.contentText}
              </Text>
            )}
          </View>
        )}

        {!isPost && snapshot.reportedUserName && (
          <Text style={styles.reportedUser}>
            <Text style={styles.label}>User: </Text>
            {snapshot.reportedUserName}
          </Text>
        )}

        <View style={styles.reportFooter}>
          <View style={styles.reporterInfoContainer}>
            <Ionicons name="person-outline" size={14} color="#666" />
            <Text style={styles.reporterInfo}>
              {i18n.t('reportedBy')} {reporterNames[item.reporterId] || item.reporterId.substring(0, 8)}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#999" />
        </View>
      </TouchableOpacity>
    );
  };

  if (!isUserAdmin) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>{i18n.t('checkingPermissions')}</Text>
      </View>
    );
  }

  const openCount = reports.filter((r) => r.status === 'open').length;
  const reviewedCount = reports.filter((r) => r.status === 'reviewed').length;
  const resolvedCount = reports.filter((r) => r.status === 'resolved').length;

  return (
    <View style={styles.container}>
      <View style={styles.headerBlock}>
        <Text style={styles.pageTitle}>Reports</Text>
        <Text style={styles.pageSubTitle}>Review, resolve, and document moderation actions.</Text>
      </View>

      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Open</Text>
          <Text style={[styles.summaryValue, { color: '#dc2626' }]}>{openCount}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Reviewed</Text>
          <Text style={[styles.summaryValue, { color: '#d97706' }]}>{reviewedCount}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Resolved</Text>
          <Text style={[styles.summaryValue, { color: '#16a34a' }]}>{resolvedCount}</Text>
        </View>
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterContainer}>
        <TouchableOpacity
          style={[styles.filterTab, statusFilter === 'open' && styles.filterTabActive]}
          onPress={() => setStatusFilter('open')}
        >
          <Text style={[styles.filterText, statusFilter === 'open' && styles.filterTextActive]}>
            {i18n.t('filterOpen')} ({openCount})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, statusFilter === 'reviewed' && styles.filterTabActive]}
          onPress={() => setStatusFilter('reviewed')}
        >
          <Text style={[styles.filterText, statusFilter === 'reviewed' && styles.filterTextActive]}>
            {i18n.t('filterReviewed')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, statusFilter === 'resolved' && styles.filterTabActive]}
          onPress={() => setStatusFilter('resolved')}
        >
          <Text style={[styles.filterText, statusFilter === 'resolved' && styles.filterTextActive]}>
            {i18n.t('filterResolved')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, statusFilter === null && styles.filterTabActive]}
          onPress={() => setStatusFilter(null)}
        >
          <Text style={[styles.filterText, statusFilter === null && styles.filterTextActive]}>
            {i18n.t('filterAll')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Reports List */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>{i18n.t('loadingReports')}</Text>
        </View>
      ) : reports.length === 0 ? (
        <View style={styles.centerContainer}>
          <Ionicons name="document-text-outline" size={64} color="#ccc" />
          <Text style={styles.emptyText}>{i18n.t('noReportsFound')}</Text>
        </View>
      ) : (
        <FlatList
          data={reports}
          renderItem={renderReportItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
        />
      )}

      {/* Action Modal */}
      <Modal
        visible={showActionModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowActionModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{i18n.t('moderationActions')}</Text>
              <TouchableOpacity onPress={() => setShowActionModal(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalContent}>
              {selectedReport && (
                <>
                  <Text style={styles.modalLabel}>{i18n.t('reportDetailsLabel')}</Text>
                  <Text style={styles.modalText}>
                    {i18n.t('reportType')} {selectedReport.targetType === 'post' ? i18n.t('postReport') : i18n.t('userReport')}
                  </Text>
                  <Text style={styles.modalText}>{i18n.t('reportReasonLabel')} {selectedReport.reason}</Text>
                  {selectedReport.details && (
                    <Text style={styles.modalText}>{i18n.t('reportDetailsLabel2')} {selectedReport.details}</Text>
                  )}

                  <Text style={styles.modalLabel}>{i18n.t('adminNoteOptional')}</Text>
                  <TextInput
                    style={styles.noteInput}
                    placeholder={i18n.t('adminNotePlaceholder')}
                    value={actionNote}
                    onChangeText={setActionNote}
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                  />
                </>
              )}

              <View style={styles.actionButtons}>
                {selectedReport?.targetType === 'post' && (
                  <TouchableOpacity
                    style={[styles.actionButton, styles.removeButton]}
                    onPress={() => handleAction('remove_post')}
                    disabled={performingAction}
                  >
                    <Ionicons name="trash-outline" size={20} color="#fff" />
                    <Text style={styles.actionButtonText}>{i18n.t('removePost')}</Text>
                  </TouchableOpacity>
                )}

                {selectedReport && targetUserSuspended !== true && getTargetUserId(selectedReport) && (
                  <TouchableOpacity
                    style={[styles.actionButton, styles.suspendButton]}
                    onPress={() => handleAction('suspend_user')}
                    disabled={performingAction}
                  >
                    <Ionicons name="ban-outline" size={20} color="#fff" />
                    <Text style={styles.actionButtonText}>{i18n.t('suspendUser')}</Text>
                  </TouchableOpacity>
                )}

                {targetUserSuspended === true && (
                  <TouchableOpacity
                    style={[styles.actionButton, styles.unsuspendButton]}
                    onPress={() => handleAction('unsuspend_user')}
                    disabled={performingAction}
                  >
                    <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                    <Text style={styles.actionButtonText}>{i18n.t('unsuspendUser')}</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[styles.actionButton, styles.reviewButton]}
                  onPress={() => handleAction('mark_reviewed')}
                  disabled={performingAction}
                >
                  <Ionicons name="eye-outline" size={20} color="#fff" />
                  <Text style={styles.actionButtonText}>{i18n.t('markReviewed')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionButton, styles.dismissButton]}
                  onPress={() => handleAction('dismiss')}
                  disabled={performingAction}
                >
                  <Ionicons name="close-circle-outline" size={20} color="#fff" />
                  <Text style={styles.actionButtonText}>{i18n.t('dismiss')}</Text>
                </TouchableOpacity>
              </View>

              {performingAction && (
                <View style={styles.loadingOverlay}>
                  <ActivityIndicator size="large" color="#007AFF" />
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f4f8',
  },
  headerBlock: {
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1e293b',
  },
  pageSubTitle: {
    marginTop: 2,
    fontSize: 13,
    color: '#64748b',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  summaryLabel: {
    fontSize: 11,
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryValue: {
    marginTop: 2,
    fontSize: 18,
    fontWeight: '800',
  },
  filterContainer: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    marginHorizontal: 16,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 10,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 999,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  filterTabActive: {
    backgroundColor: '#111827',
  },
  filterText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '700',
  },
  filterTextActive: {
    color: '#fff',
    fontWeight: '800',
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  reportCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 12,
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  reportHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  reportType: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusopen: {
    backgroundColor: '#fef2f2',
  },
  statusreviewed: {
    backgroundColor: '#fffbeb',
  },
  statusresolved: {
    backgroundColor: '#f0fdf4',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  reportDate: {
    fontSize: 11,
    color: '#94a3b8',
  },
  reportReason: {
    fontSize: 14,
    color: '#334155',
    marginBottom: 8,
  },
  label: {
    fontWeight: '700',
  },
  reportDetails: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 12,
  },
  mediaPreview: {
    marginTop: 8,
    marginBottom: 12,
  },
  mediaThumbnail: {
    width: '100%',
    height: 190,
    borderRadius: 12,
    marginBottom: 8,
  },
  caption: {
    fontSize: 13,
    color: '#64748b',
  },
  reportedUser: {
    fontSize: 13,
    color: '#334155',
    marginBottom: 8,
  },
  reportFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  reporterInfoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  reporterInfo: {
    fontSize: 12,
    color: '#64748b',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#64748b',
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    color: '#94a3b8',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    borderTopWidth: 1,
    borderColor: '#e2e8f0',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1e293b',
  },
  modalContent: {
    padding: 20,
  },
  modalLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
    marginTop: 16,
    marginBottom: 8,
  },
  modalText: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 8,
    lineHeight: 18,
  },
  noteInput: {
    borderWidth: 1,
    borderColor: '#dbe3ee',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    minHeight: 80,
    marginBottom: 16,
    backgroundColor: '#f8fafc',
  },
  actionButtons: {
    gap: 12,
    marginTop: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 12,
    gap: 8,
  },
  removeButton: {
    backgroundColor: '#dc2626',
  },
  suspendButton: {
    backgroundColor: '#d97706',
  },
  unsuspendButton: {
    backgroundColor: '#16a34a',
  },
  reviewButton: {
    backgroundColor: '#2563eb',
  },
  dismissButton: {
    backgroundColor: '#64748b',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

