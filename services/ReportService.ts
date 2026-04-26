import { auth, db } from '../lib/firebase';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  updateDoc, 
  doc, 
  getDocs,
  serverTimestamp,
  Timestamp,
  getDoc
} from 'firebase/firestore';
import { getCurrentUserRole } from './UserRoleService';
import { resolveUserDisplayName } from '../lib/userDisplayName';

export type ReportTargetType = 'post' | 'user' | 'academy' | 'clinic';
export type ReportReason = 'spam' | 'harassment' | 'nudity' | 'violence' | 'fake' | 'other';
export type ReportStatus = 'open' | 'reviewed' | 'resolved';

export interface ReportResolution {
  action: 'none' | 'post_removed' | 'user_suspended' | 'user_unsuspended' | 'dismissed';
  note: string | null;
  actedBy: string | null;
  actedAt: Timestamp | null;
}

export interface ReportSnapshot {
  postOwnerId?: string;
  postOwnerRole?: string;
  mediaUrl?: string;
  mediaType?: string;
  contentText?: string;
  postTimestamp?: Timestamp | any;
  reportedUserName?: string;
  reportedTargetName?: string;
  reportedTargetRole?: string;
  reporterName?: string;
}

export interface Report {
  id: string;
  reporterId: string;
  reporterRole?: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details?: string;
  createdAt: Timestamp | any;
  status: ReportStatus;
  assignedAdminId?: string | null;
  resolution?: ReportResolution;
  snapshot?: ReportSnapshot;
}

export interface CreateReportParams {
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details?: string;
  snapshot?: ReportSnapshot;
}

/**
 * Helper function to remove undefined values from an object (Firestore doesn't allow undefined)
 */
function removeUndefinedFields(obj: any): any {
  if (obj === null || obj === undefined) {
    return null;
  }
  if (Array.isArray(obj)) {
    return obj.map(removeUndefinedFields);
  }
  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key) && obj[key] !== undefined) {
        cleaned[key] = removeUndefinedFields(obj[key]);
      }
    }
    return cleaned;
  }
  return obj;
}

function getReportReasonLabel(reason: ReportReason): string {
  const labels: Record<ReportReason, string> = {
    spam: 'spam',
    harassment: 'harassment',
    nudity: 'nudity or sexual content',
    violence: 'violence or threats',
    fake: 'fake or misleading',
    other: 'other',
  };

  return labels[reason] || reason;
}

function getReportTargetLabel(targetType: ReportTargetType): string {
  switch (targetType) {
    case 'post':
      return 'post';
    case 'user':
      return 'user';
    case 'academy':
      return 'academy';
    case 'clinic':
      return 'clinic';
    default:
      return 'item';
  }
}

/**
 * Check if user has already reported the same target within the last 10 minutes
 * Simplified query to avoid index requirement - we'll filter by time in memory
 */
async function checkDuplicateReport(
  targetType: ReportTargetType,
  targetId: string
): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) {
    return false;
  }

  try {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const reportsRef = collection(db, 'reports');
    // Simplified query without createdAt filter to avoid index requirement
    // We'll filter by time in memory instead
    const q = query(
      reportsRef,
      where('reporterId', '==', user.uid),
      where('targetType', '==', targetType),
      where('targetId', '==', targetId)
    );

    const snapshot = await getDocs(q);
    
    // Filter by time in memory
    const recentReports = snapshot.docs.filter(doc => {
      const data = doc.data();
      const createdAt = data.createdAt;
      if (!createdAt) return false;
      
      // Handle different timestamp formats
      let reportDate: Date;
      if (createdAt.toDate && typeof createdAt.toDate === 'function') {
        // Firestore Timestamp
        reportDate = createdAt.toDate();
      } else if (createdAt.seconds) {
        // Firestore Timestamp with seconds property
        reportDate = new Date(createdAt.seconds * 1000);
      } else if (createdAt instanceof Date) {
        reportDate = createdAt;
      } else {
        // Try to parse as date string or number
        reportDate = new Date(createdAt);
      }
      
      // Check if date is valid and within the 10-minute window
      if (isNaN(reportDate.getTime())) return false;
      return reportDate >= tenMinutesAgo;
    });
    
    return recentReports.length > 0;
  } catch (error: any) {
    console.error('Error checking duplicate report:', error);
    // On error, allow the report (fail open to avoid blocking legitimate reports)
    return false;
  }
}

/**
 * Create a new report
 */
export async function createReport(params: CreateReportParams): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User must be authenticated to create a report');
  }

  try {
    // Check for duplicate reports within 10 minutes
    const isDuplicate = await checkDuplicateReport(params.targetType, params.targetId);
    if (isDuplicate) {
      throw new Error('You have already reported this item recently. Please wait before reporting again.');
    }

    // Get reporter role
    const reporterRole = await getCurrentUserRole();
    const reporterDoc = await getDoc(doc(db, 'users', user.uid));
    const reporterName = reporterDoc.exists()
      ? resolveUserDisplayName(reporterDoc.data(), user.displayName || 'Unknown user')
      : (user.displayName || 'Unknown user');

    // Clean snapshot to remove undefined values (Firestore doesn't allow undefined)
    const cleanedSnapshot = removeUndefinedFields({
      ...(params.snapshot || {}),
      reporterName,
    });

    // Create report document - ensure no undefined values
    const reportData = {
      reporterId: user.uid,
      reporterRole: reporterRole,
      targetType: params.targetType,
      targetId: params.targetId,
      reason: params.reason,
      details: params.details || null,
      createdAt: serverTimestamp(),
      status: 'open' as ReportStatus,
      assignedAdminId: null,
      resolution: null,
      snapshot: cleanedSnapshot,
    };

    // Final cleanup to ensure no undefined values anywhere
    const cleanedReportData = removeUndefinedFields(reportData);

    const reportRef = await addDoc(collection(db, 'reports'), cleanedReportData);
    try {
      const { notifyAdmins } = await import('./NotificationService');
      const targetLabel = getReportTargetLabel(params.targetType);
      const targetName =
        cleanedSnapshot?.reportedTargetName ||
        cleanedSnapshot?.reportedUserName ||
        `${targetLabel} ${params.targetId}`;
      const reasonLabel = getReportReasonLabel(params.reason);
      const detailNote = params.details?.trim();

      await notifyAdmins(
        `New ${targetLabel} report`,
        `${reporterName} reported ${targetLabel} ${targetName} for ${reasonLabel}${detailNote ? `: ${detailNote}` : ''}`,
        'report',
        {
          reportId: reportRef.id,
          targetType: params.targetType,
          targetId: params.targetId,
          reporterName,
          targetName,
          reason: reasonLabel,
        }
      );
    } catch (e) {
      console.warn('Report notification failed:', e);
    }
    return reportRef.id;
  } catch (error: any) {
    console.error('Error creating report:', error);
    throw new Error(`Failed to create report: ${error.message}`);
  }
}

/**
 * Helper function to safely get date from Firestore timestamp
 */
function getDateFromTimestamp(timestamp: any): Date {
  if (!timestamp) return new Date(0);
  if (timestamp.toDate && typeof timestamp.toDate === 'function') {
    return timestamp.toDate();
  }
  if (timestamp.seconds) {
    return new Date(timestamp.seconds * 1000);
  }
  if (timestamp instanceof Date) {
    return timestamp;
  }
  return new Date(timestamp);
}

/**
 * Subscribe to reports for admin (realtime listener)
 * @param statusFilter - Filter by status ('open', 'reviewed', 'resolved', or null for all)
 * @param callback - Callback function that receives reports array
 * @returns Unsubscribe function
 */
export function subscribeReportsForAdmin(
  statusFilter: ReportStatus | null,
  callback: (reports: Report[]) => void
): () => void {
  const reportsRef = collection(db, 'reports');
  
  // Query without orderBy to avoid index requirement, we'll sort in memory
  let q;
  if (statusFilter) {
    // Only filter by status (no orderBy to avoid index requirement)
    q = query(
      reportsRef,
      where('status', '==', statusFilter)
    );
  } else {
    // Query all reports (no filter, no orderBy to avoid index requirement)
    q = query(reportsRef);
  }

  const unsubscribe = onSnapshot(
    q,
    (querySnapshot) => {
      const reports: Report[] = querySnapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data(),
        })) as Report[];
      
      // Filter by status if needed (in case query didn't filter)
      let filteredReports = reports;
      if (statusFilter) {
        filteredReports = reports.filter(r => r.status === statusFilter);
      }
      
      // Sort by createdAt in memory (newest first)
      filteredReports.sort((a, b) => {
        const dateA = getDateFromTimestamp(a.createdAt);
        const dateB = getDateFromTimestamp(b.createdAt);
        return dateB.getTime() - dateA.getTime(); // Descending order
      });
      
      callback(filteredReports);
    },
    (error) => {
      console.error('Error subscribing to reports:', error);
      callback([]);
    }
  );

  return unsubscribe;
}

/**
 * Update report status and resolution
 */
export async function updateReportStatus(
  reportId: string,
  updates: {
    status?: ReportStatus;
    resolution?: ReportResolution;
    assignedAdminId?: string | null;
  }
): Promise<void> {
  try {
    const reportRef = doc(db, 'reports', reportId);
    const reportSnap = await getDoc(reportRef);

    if (!reportSnap.exists()) {
      throw new Error('Report not found');
    }

    const updateData: any = {};
    if (updates.status !== undefined) {
      updateData.status = updates.status;
    }
    if (updates.resolution !== undefined) {
      updateData.resolution = updates.resolution;
    }
    if (updates.assignedAdminId !== undefined) {
      updateData.assignedAdminId = updates.assignedAdminId;
    }

    await updateDoc(reportRef, updateData);
  } catch (error: any) {
    console.error('Error updating report status:', error);
    throw new Error(`Failed to update report: ${error.message}`);
  }
}
