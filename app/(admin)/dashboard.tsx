import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, TextInput, Modal, FlatList } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Timestamp, collection, doc, getDoc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import { getAdminOverviewMetrics, logAdminAction } from '../../services/AdminOpsService';
import { removePost, suspendUser } from '../../services/ModerationService';
import { updateReportStatus } from '../../services/ReportService';

// ─── Design Tokens ────────────────────────────────────────────────────────────
const C = {
    bg:           '#f0f4f8',
    card:         '#ffffff',
    border:       '#e2e8f0',
    text:         '#1e293b',
    subtext:      '#64748b',
    muted:        '#94a3b8',
    blue:         '#2563eb',
    blueLight:    '#eff6ff',
    green:        '#16a34a',
    greenLight:   '#f0fdf4',
    amber:        '#d97706',
    amberLight:   '#fffbeb',
    red:          '#dc2626',
    redLight:     '#fef2f2',
    purple:       '#7c3aed',
    purpleLight:  '#f5f3ff',
    teal:         '#0d9488',
    tealLight:    '#f0fdfa',
    indigo:       '#4338ca',
    indigoLight:  '#eef2ff',
};

const ACADEMY_AGE_GROUPS = Array.from({ length: 11 }, (_, i) => (7 + i).toString());

const CLINIC_SERVICE_OPTIONS = [
    { key: 'spa', label: 'Spa' },
    { key: 'sauna', label: 'Sauna' },
    { key: 'physio', label: 'Physiotherapy' },
    { key: 'ice_bath', label: 'Ice Bath' },
    { key: 'massage', label: 'Massage' },
    { key: 'full_recovery', label: 'Full Recovery' },
    { key: 'nutrition', label: 'Nutrition' },
    { key: 'rehab', label: 'Rehabilitation' },
    { key: 'stretching', label: 'Stretching' },
    { key: 'other', label: 'Other' },
];

// ─── Small shared components ──────────────────────────────────────────────────
const Divider = () => <View style={{ height: 1, backgroundColor: '#e2e8f0', marginVertical: 12 }} />;

const SectionHeader = ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <View style={{ marginBottom: 14 }}>
        <Text style={{ fontSize: 17, fontWeight: '800', color: C.text, letterSpacing: 0.3 }}>{title}</Text>
        {!!subtitle && <Text style={{ fontSize: 12, color: C.subtext, marginTop: 3, lineHeight: 16 }}>{subtitle}</Text>}
    </View>
);

const Badge = ({ label, color, bg }: { label: string; color: string; bg: string }) => (
    <View style={{ backgroundColor: bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
        <Text style={{ color, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
    </View>
);

const formatRecordDate = (value: any) => {
    if (!value) return '—';
    if (typeof value?.toDate === 'function') {
        return value.toDate().toLocaleString();
    }
    if (value?.seconds) {
        return new Date(value.seconds * 1000).toLocaleString();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
};

type AttentionIssueKey = 'unresolvedReports' | 'suspendedAccounts' | 'incompleteProfiles' | 'missingPricing';

type IssueUser = {
    id: string;
    name: string;
    role: string;
    issueLabel: string;
    issueDetails?: string;
    issueMeta?: string;
    sourceReportId?: string;
    reportTargetType?: 'post' | 'user';
    reportTargetId?: string;
    targetUserId?: string;
};

export default function AdminDashboard() {
    const [stats, setStats] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const { logout } = useAuth();
    const router = useRouter();

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            const overview = await getAdminOverviewMetrics();

            const totalBookingsNum = overview.totalBookings || 0;
            const totalCheckinsNum = overview.totalCheckIns || 0;
            const conversionRate = totalBookingsNum > 0 ? ((totalCheckinsNum / totalBookingsNum) * 100).toFixed(1) : '0';
            const activeProviders = (overview.usersByRole?.academy || 0) + (overview.usersByRole?.clinic || 0);

            setStats({
                ...overview,
                conversionRate,
                activeProviders,
                roles: overview.usersByRole,
            });
        } catch (error: any) {
            const message = String(error?.message || error || '');
            const isPermissionIssue = error?.code === 'permission-denied' || message.includes('Missing or insufficient permissions');

            if (isPermissionIssue) {
                console.warn('Admin stats are temporarily blocked until the latest Firestore rules are published.');
                setStats((prev: any) => prev || {
                    totalUsers: 0,
                    totalBookings: 0,
                    totalCheckIns: 0,
                    roles: { player: 0, academy: 0, clinic: 0, agent: 0, parent: 0 },
                    dataQuality: { incompleteProfiles: 0, missingPricing: 0, missingBranchAddress: 0 },
                    recentAdminActions: [],
                    unresolvedReports: 0,
                    suspendedAccounts: 0,
                    conversionRate: '0',
                    activeProviders: 0,
                    activeToday: 0,
                });
            } else {
                console.error('Error fetching admin stats:', error);
            }
        } finally {
            setLoading(false);
        }
    };

    const [issueModalVisible, setIssueModalVisible] = useState(false);
    const [issueModalTitle, setIssueModalTitle] = useState('Issue details');
    const [issueUsers, setIssueUsers] = useState<IssueUser[]>([]);
    const [issueLoading, setIssueLoading] = useState(false);
    const [issueKey, setIssueKey] = useState<AttentionIssueKey | null>(null);
    const [pendingPricingItem, setPendingPricingItem] = useState<IssueUser | null>(null);
    const [pendingProfileItem, setPendingProfileItem] = useState<IssueUser | null>(null);
    const [pricingModalVisible, setPricingModalVisible] = useState(false);
    const [pricingTarget, setPricingTarget] = useState<{ id: string; name: string; role: string } | null>(null);
    const [pricingLoading, setPricingLoading] = useState(false);
    const [pricingSaving, setPricingSaving] = useState(false);
    const [academyFeesDraft, setAcademyFeesDraft] = useState<Record<string, string>>({});
    const [clinicServicesDraft, setClinicServicesDraft] = useState<Record<string, string>>({});
    const [profileModalVisible, setProfileModalVisible] = useState(false);
    const [profileTarget, setProfileTarget] = useState<{ id: string; name: string; role: string } | null>(null);
    const [profileLoading, setProfileLoading] = useState(false);
    const [profileSaving, setProfileSaving] = useState(false);
    const [profileDraft, setProfileDraft] = useState({
        displayName: '',
        address: '',
        description: '',
        city: '',
    });

    const resolveUserName = (data: any, fallback = 'Unknown user') => (
        data?.name ||
        data?.academyName ||
        data?.clinicName ||
        data?.parentName ||
        data?.playerName ||
        `${data?.firstName || ''} ${data?.lastName || ''}`.trim() ||
        data?.email ||
        fallback
    );

    const formatReportReason = (reason: string) => {
        const normalized = String(reason || 'reported issue').replace(/_/g, ' ').trim();
        return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    };

    const getIncompleteProfileDetails = (user: any) => {
        const missingParts: string[] = [];
        const hasDisplayName = !!(user?.academyName || user?.clinicName || user?.name);
        const hasAddress = !!String(user?.address || '').trim();
        const hasDescription = !!String(user?.description || '').trim();

        if (!hasDisplayName) missingParts.push('display name');
        if (!hasAddress) missingParts.push('address');
        if (!hasDescription) missingParts.push('description');

        return missingParts.length > 0 ? `Missing: ${missingParts.join(', ')}` : 'Profile details are incomplete';
    };

    const getMissingPricingDetails = (user: any) => {
        const role = String(user?.role || '').toLowerCase();
        if (role === 'academy') {
            return 'No academy fees are configured for any age group.';
        }
        if (role === 'clinic') {
            return 'No clinic service fee is enabled with a valid price.';
        }
        return 'Pricing is missing.';
    };

    const sanitizePriceValue = (value: string) => value.replace(/[^0-9.]/g, '');

    useEffect(() => {
        if (issueModalVisible || !pendingPricingItem) return;

        const item = pendingPricingItem;
        setPendingPricingItem(null);
        void launchPricingEditor(item);
    }, [issueModalVisible, pendingPricingItem]);

    useEffect(() => {
        if (issueModalVisible || !pendingProfileItem) return;

        const item = pendingProfileItem;
        setPendingProfileItem(null);
        void launchProfileEditor(item);
    }, [issueModalVisible, pendingProfileItem]);

    const launchPricingEditor = async (item: IssueUser) => {
        setPricingTarget({ id: item.id, name: item.name, role: item.role });
        setPricingModalVisible(true);
        setPricingLoading(true);
        setAcademyFeesDraft({});
        setClinicServicesDraft({});

        try {
            const userSnap = await getDoc(doc(db, 'users', item.id));
            const userData = userSnap.exists() ? userSnap.data() : null;
            const role = String(userData?.role || item.role || '').toLowerCase();

            if (role === 'academy') {
                const fees = userData?.fees && typeof userData.fees === 'object'
                    ? userData.fees
                    : (userData?.prices && typeof userData.prices === 'object' ? userData.prices : {});
                const nextDraft: Record<string, string> = {};
                ACADEMY_AGE_GROUPS.forEach((age) => {
                    const raw = fees?.[age];
                    nextDraft[age] = raw === undefined || raw === null ? '' : String(raw);
                });
                setAcademyFeesDraft(nextDraft);
            }

            if (role === 'clinic') {
                const services = userData?.services && typeof userData.services === 'object' ? userData.services : {};
                const nextDraft: Record<string, string> = {};
                CLINIC_SERVICE_OPTIONS.forEach((service) => {
                    const raw = services?.[service.key]?.fee;
                    nextDraft[service.key] = raw === undefined || raw === null ? '' : String(raw);
                });
                setClinicServicesDraft(nextDraft);
            }
        } catch (error) {
            console.error('Failed to load pricing editor:', error);
            Alert.alert('Error', 'Unable to load pricing details for this user.');
            setPricingModalVisible(false);
            setPricingTarget(null);
        } finally {
            setPricingLoading(false);
        }
    };

    const openPricingEditor = (item: IssueUser) => {
        if (issueModalVisible) {
            setPendingPricingItem(item);
            setIssueModalVisible(false);
            return;
        }

        void launchPricingEditor(item);
    };

    const savePricingFix = async () => {
        if (!pricingTarget) return;

        const role = String(pricingTarget.role || '').toLowerCase();
        setPricingSaving(true);

        try {
            if (role === 'academy') {
                const feesPayload: Record<string, number> = {};
                Object.entries(academyFeesDraft).forEach(([age, value]) => {
                    const numeric = Number(value);
                    if (Number.isFinite(numeric) && numeric > 0) {
                        feesPayload[age] = numeric;
                    }
                });

                if (Object.keys(feesPayload).length === 0) {
                    Alert.alert('Pricing required', 'Add at least one academy fee before saving.');
                    setPricingSaving(false);
                    return;
                }

                const updatePayload = { fees: feesPayload, prices: feesPayload };
                await updateDoc(doc(db, 'users', pricingTarget.id), updatePayload);
                await updateDoc(doc(db, 'academies', pricingTarget.id), updatePayload);
            }

            if (role === 'clinic') {
                const servicesPayload: Record<string, { selected: boolean; fee: string }> = {};
                CLINIC_SERVICE_OPTIONS.forEach((service) => {
                    const value = String(clinicServicesDraft[service.key] || '').trim();
                    servicesPayload[service.key] = {
                        selected: Number(value) > 0,
                        fee: value,
                    };
                });

                const hasAtLeastOne = Object.values(servicesPayload).some((service) => service.selected && Number(service.fee) > 0);
                if (!hasAtLeastOne) {
                    Alert.alert('Pricing required', 'Add at least one clinic service fee before saving.');
                    setPricingSaving(false);
                    return;
                }

                await updateDoc(doc(db, 'users', pricingTarget.id), { services: servicesPayload });
                await updateDoc(doc(db, 'clinics', pricingTarget.id), { services: servicesPayload });
            }

            await logAdminAction({
                actionType: 'pricing_fixed',
                targetCollection: 'users',
                targetId: pricingTarget.id,
                reason: `Pricing fixed from admin dashboard for ${pricingTarget.role}`,
                actorId: auth.currentUser?.uid,
            });

            setIssueUsers((prev) => prev.filter((user) => user.id !== pricingTarget.id));
            setStats((prev: any) => ({
                ...prev,
                dataQuality: {
                    ...(prev?.dataQuality || {}),
                    missingPricing: Math.max((prev?.dataQuality?.missingPricing || 0) - 1, 0),
                },
            }));

            setPricingModalVisible(false);
            setPricingTarget(null);
            Alert.alert('Saved', 'Pricing updated successfully.');
        } catch (error) {
            console.error('Failed to save pricing fix:', error);
            Alert.alert('Error', 'Unable to save pricing right now.');
        } finally {
            setPricingSaving(false);
        }
    };

    const launchProfileEditor = async (item: IssueUser) => {
        setProfileTarget({ id: item.id, name: item.name, role: item.role });
        setProfileModalVisible(true);
        setProfileLoading(true);
        setProfileDraft({ displayName: '', address: '', description: '', city: '' });

        try {
            const userSnap = await getDoc(doc(db, 'users', item.id));
            if (!userSnap.exists()) {
                throw new Error('User not found');
            }

            const data = userSnap.data();
            const role = String(data?.role || item.role || '').toLowerCase();
            const displayName = role === 'academy'
                ? String(data?.academyName || '')
                : role === 'clinic'
                    ? String(data?.clinicName || '')
                    : String(data?.name || '');

            setProfileDraft({
                displayName,
                address: String(data?.address || ''),
                description: String(data?.description || ''),
                city: String(data?.city || ''),
            });
        } catch (error) {
            console.error('Failed to load profile editor:', error);
            Alert.alert('Error', 'Unable to load profile details right now.');
            setProfileModalVisible(false);
            setProfileTarget(null);
        } finally {
            setProfileLoading(false);
        }
    };

    const openProfileEditor = (item: IssueUser) => {
        if (issueModalVisible) {
            setPendingProfileItem(item);
            setIssueModalVisible(false);
            return;
        }

        void launchProfileEditor(item);
    };

    const saveProfileFix = async () => {
        if (!profileTarget) return;

        const role = String(profileTarget.role || '').toLowerCase();
        const trimmedName = profileDraft.displayName.trim();
        const trimmedAddress = profileDraft.address.trim();
        const trimmedDescription = profileDraft.description.trim();
        const trimmedCity = profileDraft.city.trim();

        if (!trimmedName || !trimmedAddress) {
            Alert.alert('Required fields', 'Name and address are required to complete this profile.');
            return;
        }

        setProfileSaving(true);

        try {
            const userUpdate: Record<string, any> = {
                address: trimmedAddress,
                description: trimmedDescription || null,
                city: trimmedCity || null,
            };

            if (role === 'academy') {
                userUpdate.academyName = trimmedName;
            } else if (role === 'clinic') {
                userUpdate.clinicName = trimmedName;
            } else {
                userUpdate.name = trimmedName;
            }

            await updateDoc(doc(db, 'users', profileTarget.id), userUpdate);

            if (role === 'academy') {
                await updateDoc(doc(db, 'academies', profileTarget.id), {
                    academyName: trimmedName,
                    address: trimmedAddress,
                    description: trimmedDescription || null,
                    city: trimmedCity || null,
                });
            }

            if (role === 'clinic') {
                await updateDoc(doc(db, 'clinics', profileTarget.id), {
                    clinicName: trimmedName,
                    address: trimmedAddress,
                    description: trimmedDescription || null,
                    city: trimmedCity || null,
                });
            }

            await logAdminAction({
                actionType: 'profile_fixed',
                targetCollection: 'users',
                targetId: profileTarget.id,
                reason: `Profile fixed from admin dashboard for ${profileTarget.role}`,
                actorId: auth.currentUser?.uid,
            });

            setIssueUsers((prev) => prev.filter((user) => user.id !== profileTarget.id));
            setStats((prev: any) => ({
                ...prev,
                dataQuality: {
                    ...(prev?.dataQuality || {}),
                    incompleteProfiles: Math.max((prev?.dataQuality?.incompleteProfiles || 0) - 1, 0),
                },
            }));

            setProfileModalVisible(false);
            setProfileTarget(null);
            Alert.alert('Saved', 'Profile details updated successfully.');
        } catch (error) {
            console.error('Failed to save profile fix:', error);
            Alert.alert('Error', 'Unable to save profile details right now.');
        } finally {
            setProfileSaving(false);
        }
    };

    const loadIssueUsers = async (key: AttentionIssueKey, title: string) => {
        setIssueKey(key);
        setIssueModalTitle(title);
        setIssueUsers([]);
        setIssueLoading(true);
        setIssueModalVisible(true);

        try {
            if (key === 'unresolvedReports') {
                const reportsSnap = await getDocs(query(collection(db, 'reports'), where('status', '==', 'open')));
                const reportRows = reportsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }));

                const targetRows = reportRows
                    .map((r: any) => {
                        const targetUserId = r?.targetType === 'user' ? r?.targetId : (r?.snapshot?.postOwnerId || null);
                        if (!targetUserId) return null;

                        const detailParts = [
                            r?.details,
                            r?.snapshot?.contentText,
                            r?.targetType === 'user' && r?.snapshot?.reportedUserName
                                ? `Reported user: ${r.snapshot.reportedUserName}`
                                : null,
                        ].filter(Boolean);

                        return {
                            userId: String(targetUserId),
                            issueLabel: formatReportReason(String(r?.reason || 'reported issue')),
                            issueDetails: detailParts.length > 0 ? String(detailParts[0]) : 'Open this report to inspect and moderate the exact problem.',
                            issueMeta: `${r?.targetType === 'post' ? 'Post report' : 'User report'} • ${formatRecordDate(r?.createdAt)}`,
                            sourceReportId: r.id,
                            reportTargetType: r?.targetType === 'user' ? 'user' : 'post',
                            reportTargetId: String(r?.targetId || ''),
                            targetUserId: String(targetUserId),
                        };
                    })
                    .filter(Boolean) as Array<{
                        userId: string;
                        issueLabel: string;
                        issueDetails: string;
                        issueMeta: string;
                        sourceReportId?: string;
                        reportTargetType: 'post' | 'user';
                        reportTargetId: string;
                        targetUserId: string;
                    }>;

                const uniqueIds = [...new Set(targetRows.map((r) => r.userId))];
                const userSnaps = await Promise.all(uniqueIds.map((uid) => getDoc(doc(db, 'users', uid))));

                const userMap = new Map<string, any>();
                userSnaps.forEach((snap, idx) => {
                    const uid = uniqueIds[idx];
                    if (snap.exists()) {
                        userMap.set(uid, { id: snap.id, ...snap.data() });
                    }
                });

                const resolved = targetRows.map((row) => {
                    const user = userMap.get(row.userId);
                    return {
                        id: user?.id || row.userId,
                        name: resolveUserName(user, row.userId.slice(0, 8)),
                        role: String(user?.role || 'user'),
                        issueLabel: row.issueLabel,
                        issueDetails: row.issueDetails,
                        issueMeta: row.issueMeta,
                        sourceReportId: row.sourceReportId,
                        reportTargetType: row.reportTargetType,
                        reportTargetId: row.reportTargetId,
                        targetUserId: row.targetUserId,
                    } as IssueUser;
                });

                setIssueUsers(resolved);
                return;
            }

            const usersSnap = await getDocs(collection(db, 'users'));
            const users = usersSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

            let filtered: IssueUser[] = [];

            if (key === 'suspendedAccounts') {
                filtered = users
                    .filter((u: any) => u?.isSuspended === true || String(u?.status || '').toLowerCase() === 'suspended')
                    .map((u: any) => ({
                        id: u.id,
                        name: resolveUserName(u, u.id.slice(0, 8)),
                        role: String(u.role || 'user'),
                        issueLabel: 'Account is suspended',
                        issueDetails: String(u.suspensionReason || 'This account is currently blocked from using the app.'),
                        issueMeta: `Status: ${String(u.status || 'suspended')}`,
                    }));
            }

            if (key === 'incompleteProfiles') {
                filtered = users
                    .filter((u: any) => {
                        const role = String(u.role || '').toLowerCase();
                        if (role !== 'academy' && role !== 'clinic') return false;
                        const hasName = !!(u.academyName || u.clinicName || u.name);
                        const hasAddress = !!String(u.address || '').trim();
                        return !hasName || !hasAddress;
                    })
                    .map((u: any) => ({
                        id: u.id,
                        name: resolveUserName(u, u.id.slice(0, 8)),
                        role: String(u.role || 'user'),
                        issueLabel: 'Missing required profile details',
                        issueDetails: getIncompleteProfileDetails(u),
                        issueMeta: `Role: ${String(u.role || 'user')}`,
                    }));
            }

            if (key === 'missingPricing') {
                filtered = users
                    .filter((u: any) => {
                        const role = String(u.role || '').toLowerCase();
                        if (role === 'academy') {
                            const feeValues = u.fees && typeof u.fees === 'object' ? Object.values(u.fees) : [];
                            return !feeValues.some((fee) => Number(fee) > 0);
                        }
                        if (role === 'clinic') {
                            const services = u.services && typeof u.services === 'object' ? Object.values(u.services) : [];
                            return !services.some((service: any) => service?.selected && Number(service?.fee) > 0);
                        }
                        return false;
                    })
                    .map((u: any) => ({
                        id: u.id,
                        name: resolveUserName(u, u.id.slice(0, 8)),
                        role: String(u.role || 'user'),
                        issueLabel: 'Pricing is missing',
                        issueDetails: getMissingPricingDetails(u),
                        issueMeta: `Role: ${String(u.role || 'user')}`,
                    }));
            }

            setIssueUsers(filtered);
        } catch (error) {
            console.error('Failed to load issue users:', error);
            Alert.alert('Error', 'Unable to load affected users right now.');
        } finally {
            setIssueLoading(false);
        }
    };

    const quickUnsuspend = async (userId: string) => {
        try {
            await updateDoc(doc(db, 'users', userId), {
                status: 'active',
                isSuspended: false,
            });

            await logAdminAction({
                actionType: 'user_unsuspended',
                targetCollection: 'users',
                targetId: userId,
                reason: 'Quick unsuspend from attention modal',
            });

            setIssueUsers((prev) => prev.filter((u) => u.id !== userId));
            Alert.alert('Done', 'User account unsuspended successfully.');
        } catch (error) {
            console.error('Failed to unsuspend user:', error);
            Alert.alert('Error', 'Unable to unsuspend this account right now.');
        }
    };

    const resolveReportIssue = async (item: IssueUser, action: 'remove_post' | 'suspend_user') => {
        const adminId = auth.currentUser?.uid;
        if (!adminId || !item.sourceReportId) {
            Alert.alert('Error', 'Missing admin or report information.');
            return;
        }

        try {
            if (action === 'remove_post') {
                if (item.reportTargetType !== 'post' || !item.reportTargetId) {
                    Alert.alert('Unavailable', 'This issue is not linked to removable post content.');
                    return;
                }

                await removePost(item.reportTargetId, adminId, `Removed from dashboard attention panel. Reason: ${item.issueLabel}`);
            }

            if (action === 'suspend_user') {
                const targetUserId = item.targetUserId || item.id;
                await suspendUser(targetUserId, adminId, `Suspended from dashboard attention panel. Reason: ${item.issueLabel}`);
            }

            await updateReportStatus(item.sourceReportId, {
                status: 'resolved',
                assignedAdminId: adminId,
                resolution: {
                    action: action === 'remove_post' ? 'post_removed' : 'user_suspended',
                    note: `${action === 'remove_post' ? 'Post removed' : 'User suspended'} from admin dashboard attention panel.`,
                    actedBy: adminId,
                    actedAt: Timestamp.now(),
                },
            });

            setIssueUsers((prev) => prev.filter((row) => row.sourceReportId !== item.sourceReportId));
            setStats((prev: any) => ({
                ...prev,
                unresolvedReports: Math.max((prev?.unresolvedReports || 0) - 1, 0),
                suspendedAccounts: action === 'suspend_user'
                    ? (prev?.suspendedAccounts || 0) + 1
                    : (prev?.suspendedAccounts || 0),
            }));

            Alert.alert('Done', action === 'remove_post' ? 'Reported post removed and report resolved.' : 'Reported user suspended and report resolved.');
        } catch (error) {
            console.error('Failed to resolve report issue:', error);
            Alert.alert('Error', 'Unable to complete that moderation action right now.');
        }
    };

    // ─── Small Card Components ────────────────────────────────────────────────
    const KpiCard = ({ title, description, value, icon, accentColor, bgColor }: any) => (
        <View style={[S.kpiCard, { borderTopColor: accentColor }]}>
            <View style={[S.kpiIcon, { backgroundColor: bgColor }]}>
                <Ionicons name={icon} size={20} color={accentColor} />
            </View>
            <Text style={S.kpiValue}>{value ?? '—'}</Text>
            <Text style={S.kpiTitle}>{title}</Text>
            {!!description && <Text style={S.kpiDesc}>{description}</Text>}
        </View>
    );

    const InfoRow = ({ label, value, valueColor }: any) => (
        <View style={S.infoRow}>
            <Text style={S.infoLabel}>{label}</Text>
            <Text style={[S.infoValue, valueColor ? { color: valueColor } : {}]}>{value ?? '—'}</Text>
        </View>
    );

    const AlertBanner = ({ icon, message, color, bg }: any) => (
        <View style={[S.alertBanner, { backgroundColor: bg, borderLeftColor: color }]}>
            <Ionicons name={icon} size={16} color={color} />
            <Text style={[S.alertText, { color }]}>{message}</Text>
        </View>
    );

    if (loading) {
        return (
            <View style={S.loadingScreen}>
                <ActivityIndicator size="large" color={C.blue} />
                <Text style={S.loadingText}>Loading your dashboard...</Text>
            </View>
        );
    }

    const hasUrgentItems = (stats?.unresolvedReports || 0) > 0 || (stats?.suspendedAccounts || 0) > 0;

    const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    return (
        <ScrollView style={S.container} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>

            {/* ── HEADER ─────────────────────────────────────────────────── */}
            <View style={S.header}>
                <View>
                    <Text style={S.headerTitle}>Admin Dashboard</Text>
                    <Text style={S.headerDate}>{today}</Text>
                </View>
                <TouchableOpacity onPress={logout} style={S.logoutBtn}>
                    <Ionicons name="log-out-outline" size={16} color={C.red} />
                    <Text style={S.logoutText}>Logout</Text>
                </TouchableOpacity>
            </View>

            {/* ── ALERT BANNER (only shown when there are urgent items) ──── */}
            {hasUrgentItems && (
                <View style={S.section}>
                    {(stats?.unresolvedReports || 0) > 0 && (
                        <AlertBanner
                            icon="flag"
                            message={`${stats.unresolvedReports} unresolved report${stats.unresolvedReports > 1 ? 's' : ''} waiting for your review`}
                            color={C.red}
                            bg={C.redLight}
                        />
                    )}
                </View>
            )}

            {/* ── QUICK NAVIGATION ───────────────────────────────────────── */}
            <View style={S.section}>
                <SectionHeader title="Quick Navigation" subtitle="Tap any section to manage it" />
                <View style={S.navGrid}>
                    {[
                        { label: 'Users',         sub: 'View & manage accounts',    icon: 'people',           color: C.blue,   bg: C.blueLight,   route: '/(admin)/users' },
                        { label: 'Bookings',      sub: 'All training sessions',     icon: 'calendar',         color: C.green,  bg: C.greenLight,  route: '/(admin)/bookings' },
                        { label: 'Check-ins',     sub: 'QR scan history',           icon: 'qr-code',          color: C.teal,   bg: C.tealLight,   route: '/(admin)/checkins' },
                        { label: 'Money',         sub: 'Commissions & payouts',     icon: 'wallet',           color: C.amber,  bg: C.amberLight,  route: '/(admin)/money' },
                        { label: 'Reports',       sub: 'Flagged content',           icon: 'flag',             color: C.red,    bg: C.redLight,    route: '/(admin)/reports' },
                        { label: 'Upload Media',  sub: 'Publish new media',         icon: 'cloud-upload',     color: C.indigo, bg: C.indigoLight, route: '/(admin)/upload-media' },
                        { label: 'My Media',      sub: 'Edit your uploads',         icon: 'images',           color: C.blue,   bg: C.blueLight,   route: '/(admin)/my-media' },
                        { label: 'All Media',     sub: 'Review all user media',     icon: 'film',             color: C.amber,  bg: C.amberLight,  route: '/(admin)/see-media' },
                        { label: 'Notifications', sub: 'Send alerts to users',      icon: 'notifications',    color: C.purple, bg: C.purpleLight, route: '/(admin)/notifications' },
                        { label: 'Message User',  sub: 'Chat 1-on-1',               icon: 'chatbubble-ellipses', color: C.indigo, bg: C.indigoLight, onPress: () => router.push('/(admin)/message-user' as any) },
                    ].map((item) => (
                        <TouchableOpacity
                            key={item.label}
                            style={[S.navTile, { borderTopColor: item.color }]}
                            onPress={item.onPress ? item.onPress : () => router.push(item.route as any)}
                            activeOpacity={0.75}
                        >
                            <View style={[S.navTileIcon, { backgroundColor: item.bg }]}>
                                <Ionicons name={item.icon as any} size={22} color={item.color} />
                            </View>
                            <Text style={[S.navTileLabel, { color: item.color }]}>{item.label}</Text>
                            <Text style={S.navTileSub}>{item.sub}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>

            {/* ── AT A GLANCE ────────────────────────────────────────────── */}
            <View style={S.section}>
                <SectionHeader
                    title="Your App at a Glance"
                    subtitle="Key numbers for the current period"
                />
                <View style={S.kpiGrid}>
                    <KpiCard
                        title="Total Users"
                        description="Everyone who signed up"
                        value={stats?.totalUsers ?? 0}
                        icon="people"
                        accentColor={C.blue}
                        bgColor={C.blueLight}
                    />
                    <KpiCard
                        title="Total Bookings"
                        description="Sessions created so far"
                        value={stats?.totalBookings ?? 0}
                        icon="calendar"
                        accentColor={C.green}
                        bgColor={C.greenLight}
                    />
                    <KpiCard
                        title="Total Check-ins"
                        description="QR scans completed"
                        value={stats?.totalCheckIns ?? 0}
                        icon="qr-code"
                        accentColor={C.teal}
                        bgColor={C.tealLight}
                    />
                    <KpiCard
                        title="Attended Bookings"
                        description="Verified attended sessions"
                        value={stats?.totalAttendedBookings ?? 0}
                        icon="checkmark-done"
                        accentColor={C.green}
                        bgColor={C.greenLight}
                    />
                    <KpiCard
                        title="No-shows"
                        description="Bookings where customer did not attend"
                        value={stats?.totalNoShows ?? 0}
                        icon="close-circle"
                        accentColor={C.red}
                        bgColor={C.redLight}
                    />
                </View>
            </View>

            {/* ── THINGS NEEDING ATTENTION ───────────────────────────────── */}
            <View style={S.section}>
                <SectionHeader
                    title="Things Needing Attention"
                    subtitle="Issues in your app that may need your action"
                />
                <View style={S.warnGrid}>
                    {[
                        {
                            key: 'unresolvedReports',
                            label: 'Unresolved Reports',
                            desc: 'Users flagged for bad content',
                            value: stats?.unresolvedReports ?? 0,
                            icon: 'flag',
                            urgent: (stats?.unresolvedReports || 0) > 0,
                        },
                        {
                            key: 'suspendedAccounts',
                            label: 'Suspended Accounts',
                            desc: 'Currently banned users',
                            value: stats?.suspendedAccounts ?? 0,
                            icon: 'ban',
                            urgent: false,
                        },
                        {
                            key: 'incompleteProfiles',
                            label: 'Incomplete Profiles',
                            desc: 'Users missing info',
                            value: stats?.dataQuality?.incompleteProfiles ?? 0,
                            icon: 'person',
                            urgent: false,
                        },
                        {
                            key: 'missingPricing',
                            label: 'Missing Pricing',
                            desc: 'Services with no price set',
                            value: stats?.dataQuality?.missingPricing ?? 0,
                            icon: 'pricetag',
                            urgent: (stats?.dataQuality?.missingPricing || 0) > 0,
                        },
                    ].map((item: any) => (
                        <TouchableOpacity
                            key={item.label}
                            style={[
                                S.warnCard,
                                item.urgent && item.value > 0 && { borderColor: C.red, borderWidth: 1.5 },
                            ]}
                            activeOpacity={0.8}
                            onPress={() => loadIssueUsers(item.key as AttentionIssueKey, item.label)}
                        >
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                <Ionicons
                                    name={item.icon as any}
                                    size={14}
                                    color={item.urgent && item.value > 0 ? C.red : C.subtext}
                                />
                                <Text style={[S.warnLabel, item.urgent && item.value > 0 && { color: C.red }]}>
                                    {item.label}
                                </Text>
                            </View>
                            <Text style={[
                                S.warnValue,
                                item.urgent && item.value > 0 ? { color: C.red } : { color: C.text },
                            ]}>
                                {item.value}
                            </Text>
                            <Text style={S.warnDesc}>{item.desc}</Text>
                            <Text style={S.warnAction}>Tap to open affected users</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>

            {/* ── USERS BY ROLE ──────────────────────────────────────────── */}
            <View style={S.section}>
                <SectionHeader
                    title="Who's Using Your App"
                    subtitle="Breakdown of registered users by their role"
                />
                <View style={S.card}>
                    {[
                        { label: 'Players', key: 'player', icon: 'football', color: C.blue },
                        { label: 'Academies', key: 'academy', icon: 'school', color: C.green },
                        { label: 'Clinics', key: 'clinic', icon: 'medkit', color: C.teal },
                        { label: 'Agents', key: 'agent', icon: 'briefcase', color: C.purple },
                        { label: 'Parents', key: 'parent', icon: 'people', color: C.amber },
                    ].map((item, idx, arr) => {
                        const count = stats?.roles?.[item.key] || 0;
                        const total = stats?.totalUsers || 1;
                        const pct = Math.round((count / total) * 100);
                        return (
                            <View key={item.key}>
                                {idx > 0 && <Divider />}
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                    <View style={[S.roleIcon, { backgroundColor: item.color + '18' }]}>
                                        <Ionicons name={item.icon as any} size={16} color={item.color} />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                                            <Text style={S.roleLabel}>{item.label}</Text>
                                            <Text style={[S.roleCount, { color: item.color }]}>{count}</Text>
                                        </View>
                                        <View style={S.roleBarBg}>
                                            <View style={[S.roleBarFill, { width: `${pct}%`, backgroundColor: item.color }]} />
                                        </View>
                                    </View>
                                    <Text style={S.rolePct}>{pct}%</Text>
                                </View>
                            </View>
                        );
                    })}
                </View>
            </View>

            {/* ── TOP RANKINGS ──────────────────────────────────────────── */}
            <View style={S.section}>
                <SectionHeader
                    title="Top Rankings"
                    subtitle="Dedicated rankings screen with gift and offer tools"
                />
                <View style={S.card}>
                    <Text style={S.rankingsLead}>See complete leaderboards and instantly reward top users with gifts or offers.</Text>
                    <TouchableOpacity
                        style={S.rankingsCta}
                        onPress={() => router.push('/(admin)/top-rankings' as any)}
                    >
                        <Ionicons name="trophy" size={16} color="#fff" />
                        <Text style={S.rankingsCtaText}>Open Top Rankings Screen</Text>
                    </TouchableOpacity>
                </View>
            </View>


            {/* ── AUDIT LOG ──────────────────────────────────────────────── */}
            <View style={S.section}>
                <SectionHeader
                    title="Admin Activity Log"
                    subtitle="A record of all actions taken by admins"
                />
                {(stats?.recentAdminActions || []).length === 0 ? (
                    <View style={[S.card, S.emptyCard]}>
                        <Ionicons name="list-outline" size={32} color={C.muted} />
                        <Text style={S.emptyTitle}>No admin actions yet</Text>
                        <Text style={S.emptyDesc}>When you suspend users, update bookings, or process payouts, they'll appear here.</Text>
                    </View>
                ) : (
                    <View style={S.card}>
                        {(stats.recentAdminActions as any[]).map((item: any, idx: number) => (
                            <View key={item.id}>
                                {idx > 0 && <Divider />}
                                <View style={{ flexDirection: 'row', gap: 10 }}>
                                    <View style={[S.auditDot, { backgroundColor: C.indigoLight }]}>
                                        <Ionicons name="shield-checkmark" size={14} color={C.indigo} />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={S.auditAction}>{(item.actionType || 'admin_action').replace(/_/g, ' ')}</Text>
                                        <Text style={S.auditDetail}>{item.reason || item.targetCollection || 'System action'}</Text>
                                    </View>
                                    {!!item.targetId && (
                                        <Text style={S.auditId} numberOfLines={1}>{item.targetId.slice(-8)}</Text>
                                    )}
                                </View>
                            </View>
                        ))}
                    </View>
                )}
            </View>

            {/* ── ISSUE USERS MODAL ─────────────────────────────────────── */}
            <Modal visible={issueModalVisible} animationType="slide" transparent>
                <View style={S.modalBg}>
                    <View style={S.modalBox}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                            <View>
                                <Text style={S.modalTitle}>{issueModalTitle}</Text>
                                <Text style={S.modalSub}>Access affected users and take action now.</Text>
                            </View>
                            <TouchableOpacity onPress={() => setIssueModalVisible(false)}>
                                <Ionicons name="close" size={22} color={C.subtext} />
                            </TouchableOpacity>
                        </View>

                        {issueLoading ? (
                            <View style={{ paddingVertical: 30, alignItems: 'center' }}>
                                <ActivityIndicator color={C.blue} />
                                <Text style={{ marginTop: 8, color: C.subtext }}>Loading affected users...</Text>
                            </View>
                        ) : issueUsers.length === 0 ? (
                            <View style={{ paddingVertical: 26, alignItems: 'center' }}>
                                <Ionicons name="checkmark-circle-outline" size={30} color={C.green} />
                                <Text style={{ marginTop: 8, fontWeight: '700', color: C.text }}>No affected users right now</Text>
                            </View>
                        ) : (
                            <FlatList
                                data={issueUsers}
                                keyExtractor={(item) => `${item.id}_${item.issueLabel}`}
                                style={{ maxHeight: 420, marginTop: 4 }}
                                ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: C.border }} />}
                                renderItem={({ item }) => (
                                    <View style={S.issueRow}>
                                        <View style={S.issueAvatar}>
                                            <Text style={S.issueAvatarText}>{item.name?.[0]?.toUpperCase() || '?'}</Text>
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={S.issueName}>{item.name}</Text>
                                            <Text style={S.issueRole}>{item.role}</Text>
                                            <Text style={S.issueLabelText}>{item.issueLabel}</Text>
                                            {!!item.issueDetails && (
                                                <Text style={S.issueDetailText} numberOfLines={3}>{item.issueDetails}</Text>
                                            )}
                                            {!!item.issueMeta && (
                                                <Text style={S.issueMetaText}>{item.issueMeta}</Text>
                                            )}
                                        </View>
                                        <View style={S.issueActionsCol}>
                                            <TouchableOpacity
                                                style={S.issueActionBtn}
                                                onPress={() => {
                                                    setIssueModalVisible(false);
                                                    router.push(`/(admin)/user-chat?otherUserId=${item.id}&name=${encodeURIComponent(item.name)}`);
                                                }}
                                            >
                                                <Text style={S.issueActionText}>Chat</Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                style={[S.issueActionBtn, { backgroundColor: C.indigoLight }]}
                                                onPress={() => {
                                                    setIssueModalVisible(false);
                                                    router.push(`/(admin)/users/${item.id}` as any);
                                                }}
                                            >
                                                <Text style={[S.issueActionText, { color: C.indigo }]}>Profile</Text>
                                            </TouchableOpacity>
                                            {issueKey === 'unresolvedReports' && (
                                                <TouchableOpacity
                                                    style={[S.issueActionBtn, { backgroundColor: C.redLight }]}
                                                    onPress={() => {
                                                        setIssueModalVisible(false);
                                                        router.push('/(admin)/reports' as any);
                                                    }}
                                                >
                                                    <Text style={[S.issueActionText, { color: C.red }]}>Review</Text>
                                                </TouchableOpacity>
                                            )}
                                            {issueKey === 'unresolvedReports' && item.reportTargetType === 'post' && (
                                                <TouchableOpacity
                                                    style={[S.issueActionBtn, { backgroundColor: C.amberLight }]}
                                                    onPress={() =>
                                                        Alert.alert(
                                                            'Remove reported post',
                                                            'This will remove the reported post and resolve the report.',
                                                            [
                                                                { text: 'Cancel', style: 'cancel' },
                                                                { text: 'Remove', style: 'destructive', onPress: () => resolveReportIssue(item, 'remove_post') },
                                                            ]
                                                        )
                                                    }
                                                >
                                                    <Text style={[S.issueActionText, { color: C.amber }]}>Remove</Text>
                                                </TouchableOpacity>
                                            )}
                                            {issueKey === 'unresolvedReports' && (
                                                <TouchableOpacity
                                                    style={[S.issueActionBtn, { backgroundColor: C.redLight }]}
                                                    onPress={() =>
                                                        Alert.alert(
                                                            'Suspend reported user',
                                                            'This will suspend the affected account and resolve the report.',
                                                            [
                                                                { text: 'Cancel', style: 'cancel' },
                                                                { text: 'Suspend', style: 'destructive', onPress: () => resolveReportIssue(item, 'suspend_user') },
                                                            ]
                                                        )
                                                    }
                                                >
                                                    <Text style={[S.issueActionText, { color: C.red }]}>Suspend</Text>
                                                </TouchableOpacity>
                                            )}
                                            {issueKey === 'suspendedAccounts' && (
                                                <TouchableOpacity
                                                    style={[S.issueActionBtn, { backgroundColor: C.greenLight }]}
                                                    onPress={() => quickUnsuspend(item.id)}
                                                >
                                                    <Text style={[S.issueActionText, { color: C.green }]}>Unsuspend</Text>
                                                </TouchableOpacity>
                                            )}
                                            {issueKey === 'missingPricing' && (
                                                <TouchableOpacity
                                                    style={[S.issueActionBtn, { backgroundColor: C.greenLight }]}
                                                    onPress={() => openPricingEditor(item)}
                                                >
                                                    <Text style={[S.issueActionText, { color: C.green }]}>Fix Pricing</Text>
                                                </TouchableOpacity>
                                            )}
                                            {issueKey === 'incompleteProfiles' && (
                                                <TouchableOpacity
                                                    style={[S.issueActionBtn, { backgroundColor: C.greenLight }]}
                                                    onPress={() => openProfileEditor(item)}
                                                >
                                                    <Text style={[S.issueActionText, { color: C.green }]}>Fix Profile</Text>
                                                </TouchableOpacity>
                                            )}
                                        </View>
                                    </View>
                                )}
                            />
                        )}
                    </View>
                </View>
            </Modal>

            <Modal visible={pricingModalVisible} animationType="slide" transparent>
                <View style={S.modalBg}>
                    <View style={S.modalBox}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                            <View>
                                <Text style={S.modalTitle}>Fix Missing Pricing</Text>
                                <Text style={S.modalSub}>{pricingTarget ? `${pricingTarget.name} • ${pricingTarget.role}` : 'Update provider pricing'}</Text>
                            </View>
                            <TouchableOpacity
                                onPress={() => {
                                    if (pricingSaving) return;
                                    setPricingModalVisible(false);
                                    setPricingTarget(null);
                                }}
                            >
                                <Ionicons name="close" size={22} color={C.subtext} />
                            </TouchableOpacity>
                        </View>

                        {pricingLoading ? (
                            <View style={{ paddingVertical: 30, alignItems: 'center' }}>
                                <ActivityIndicator color={C.blue} />
                                <Text style={{ marginTop: 8, color: C.subtext }}>Loading pricing editor...</Text>
                            </View>
                        ) : (
                            <>
                                {String(pricingTarget?.role || '').toLowerCase() === 'academy' && (
                                    <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
                                        {ACADEMY_AGE_GROUPS.map((age) => (
                                            <View key={age} style={S.pricingRow}>
                                                <Text style={S.pricingLabel}>U{age} Training</Text>
                                                <View style={S.pricingInputWrap}>
                                                    <TextInput
                                                        style={S.pricingInput}
                                                        value={academyFeesDraft[age] || ''}
                                                        onChangeText={(value) => setAcademyFeesDraft((prev) => ({ ...prev, [age]: sanitizePriceValue(value) }))}
                                                        keyboardType="numeric"
                                                        placeholder="0"
                                                        placeholderTextColor={C.muted}
                                                    />
                                                    <Text style={S.pricingSuffix}>EGP</Text>
                                                </View>
                                            </View>
                                        ))}
                                    </ScrollView>
                                )}

                                {String(pricingTarget?.role || '').toLowerCase() === 'clinic' && (
                                    <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
                                        {CLINIC_SERVICE_OPTIONS.map((service) => (
                                            <View key={service.key} style={S.pricingRow}>
                                                <Text style={S.pricingLabel}>{service.label}</Text>
                                                <View style={S.pricingInputWrap}>
                                                    <TextInput
                                                        style={S.pricingInput}
                                                        value={clinicServicesDraft[service.key] || ''}
                                                        onChangeText={(value) => setClinicServicesDraft((prev) => ({ ...prev, [service.key]: sanitizePriceValue(value) }))}
                                                        keyboardType="numeric"
                                                        placeholder="0"
                                                        placeholderTextColor={C.muted}
                                                    />
                                                    <Text style={S.pricingSuffix}>EGP</Text>
                                                </View>
                                            </View>
                                        ))}
                                    </ScrollView>
                                )}

                                <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                                    <TouchableOpacity
                                        style={[S.issueActionBtn, { flex: 1, backgroundColor: '#e2e8f0', paddingVertical: 12 }]}
                                        onPress={() => {
                                            if (pricingSaving) return;
                                            setPricingModalVisible(false);
                                            setPricingTarget(null);
                                        }}
                                    >
                                        <Text style={[S.issueActionText, { color: C.text }]}>Cancel</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[S.issueActionBtn, { flex: 1, backgroundColor: C.green, paddingVertical: 12 }]}
                                        onPress={savePricingFix}
                                        disabled={pricingSaving}
                                    >
                                        {pricingSaving ? (
                                            <ActivityIndicator color="#fff" />
                                        ) : (
                                            <Text style={[S.issueActionText, { color: '#fff' }]}>Save Pricing</Text>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            </>
                        )}
                    </View>
                </View>
            </Modal>

            <Modal visible={profileModalVisible} animationType="slide" transparent>
                <View style={S.modalBg}>
                    <View style={S.modalBox}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                            <View>
                                <Text style={S.modalTitle}>Fix Incomplete Profile</Text>
                                <Text style={S.modalSub}>{profileTarget ? `${profileTarget.name} • ${profileTarget.role}` : 'Update provider profile'}</Text>
                            </View>
                            <TouchableOpacity
                                onPress={() => {
                                    if (profileSaving) return;
                                    setProfileModalVisible(false);
                                    setProfileTarget(null);
                                }}
                            >
                                <Ionicons name="close" size={22} color={C.subtext} />
                            </TouchableOpacity>
                        </View>

                        {profileLoading ? (
                            <View style={{ paddingVertical: 30, alignItems: 'center' }}>
                                <ActivityIndicator color={C.blue} />
                                <Text style={{ marginTop: 8, color: C.subtext }}>Loading profile editor...</Text>
                            </View>
                        ) : (
                            <>
                                <Text style={S.formLabel}>{String(profileTarget?.role || '').toLowerCase() === 'academy' ? 'Academy name' : 'Clinic name'}</Text>
                                <TextInput
                                    style={S.formInput}
                                    value={profileDraft.displayName}
                                    onChangeText={(value) => setProfileDraft((prev) => ({ ...prev, displayName: value }))}
                                    placeholder="Name"
                                    placeholderTextColor={C.muted}
                                />

                                <Text style={S.formLabel}>Address</Text>
                                <TextInput
                                    style={S.formInput}
                                    value={profileDraft.address}
                                    onChangeText={(value) => setProfileDraft((prev) => ({ ...prev, address: value }))}
                                    placeholder="Address"
                                    placeholderTextColor={C.muted}
                                />

                                <Text style={S.formLabel}>City</Text>
                                <TextInput
                                    style={S.formInput}
                                    value={profileDraft.city}
                                    onChangeText={(value) => setProfileDraft((prev) => ({ ...prev, city: value }))}
                                    placeholder="City"
                                    placeholderTextColor={C.muted}
                                />

                                <Text style={S.formLabel}>Description</Text>
                                <TextInput
                                    style={[S.formInput, S.formInputMultiline]}
                                    value={profileDraft.description}
                                    onChangeText={(value) => setProfileDraft((prev) => ({ ...prev, description: value }))}
                                    placeholder="Description"
                                    placeholderTextColor={C.muted}
                                    multiline
                                    textAlignVertical="top"
                                />

                                <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                                    <TouchableOpacity
                                        style={[S.issueActionBtn, { flex: 1, backgroundColor: '#e2e8f0', paddingVertical: 12 }]}
                                        onPress={() => {
                                            if (profileSaving) return;
                                            setProfileModalVisible(false);
                                            setProfileTarget(null);
                                        }}
                                    >
                                        <Text style={[S.issueActionText, { color: C.text }]}>Cancel</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[S.issueActionBtn, { flex: 1, backgroundColor: C.green, paddingVertical: 12 }]}
                                        onPress={saveProfileFix}
                                        disabled={profileSaving}
                                    >
                                        {profileSaving ? (
                                            <ActivityIndicator color="#fff" />
                                        ) : (
                                            <Text style={[S.issueActionText, { color: '#fff' }]}>Save Profile</Text>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            </>
                        )}
                    </View>
                </View>
            </Modal>
        </ScrollView>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
    container:          { flex: 1, backgroundColor: C.bg },
    loadingScreen:      { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg, gap: 12 },
    loadingText:        { fontSize: 14, color: C.subtext },
    section:            { paddingHorizontal: 16, marginBottom: 24 },

    // Header
    header:             { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 16, paddingTop: 20, marginBottom: 8 },
    headerTitle:        { fontSize: 26, fontWeight: '900', color: C.text, letterSpacing: -0.5 },
    headerDate:         { fontSize: 12, color: C.subtext, marginTop: 2 },
    logoutBtn:          { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: C.redLight },
    logoutText:         { color: C.red, fontWeight: '700', fontSize: 13 },

    // Alert banners
    alertBanner:        { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 10, borderLeftWidth: 4, marginBottom: 8 },
    alertText:          { fontSize: 13, fontWeight: '600', flex: 1 },

    // Navigation tiles
    navGrid:            { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    navTile:            { width: '47%', backgroundColor: C.card, borderRadius: 12, padding: 14, borderTopWidth: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    navTileIcon:        { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
    navTileLabel:       { fontSize: 14, fontWeight: '800', marginBottom: 2 },
    navTileSub:         { fontSize: 11, color: C.subtext },

    // KPI grid
    kpiGrid:            { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 4 },
    kpiCard:            { width: '47%', backgroundColor: C.card, borderRadius: 12, padding: 14, borderTopWidth: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    kpiIcon:            { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
    kpiValue:           { fontSize: 22, fontWeight: '900', color: C.text, marginBottom: 2 },
    kpiTitle:           { fontSize: 12, fontWeight: '700', color: C.subtext, marginBottom: 3 },
    kpiDesc:            { fontSize: 10, color: C.muted, lineHeight: 14 },

    // Generic card
    card:               { backgroundColor: C.card, borderRadius: 14, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 6, elevation: 2 },
    infoRow:            { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
    infoLabel:          { fontSize: 14, color: C.subtext, flex: 1, paddingRight: 8 },
    infoValue:          { fontSize: 15, fontWeight: '700', color: C.text },
    totalRow:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: 2, borderTopColor: C.border },
    totalLabel:         { fontSize: 14, fontWeight: '700', color: C.text },
    totalValue:         { fontSize: 18, fontWeight: '900', color: C.green },

    // Empty state
    emptyCard:          { alignItems: 'center', paddingVertical: 28, gap: 8 },
    emptyTitle:         { fontSize: 15, fontWeight: '700', color: C.text },
    emptyDesc:          { fontSize: 12, color: C.subtext, textAlign: 'center', lineHeight: 16, paddingHorizontal: 16 },

    // Payout queue
    payoutRow:          { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
    payoutAvatar:       { width: 40, height: 40, borderRadius: 20, backgroundColor: C.blueLight, justifyContent: 'center', alignItems: 'center' },
    payoutAvatarText:   { fontSize: 16, fontWeight: '800', color: C.blue },
    payoutName:         { fontSize: 14, fontWeight: '700', color: C.text },
    payoutSub:          { fontSize: 11, color: C.subtext, marginTop: 2 },
    payoutAmount:       { fontSize: 16, fontWeight: '900', color: C.green },
    payNowBtn:          { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.green, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
    payNowText:         { color: '#fff', fontWeight: '700', fontSize: 11 },

    // Warnings grid
    warnGrid:           { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    warnCard:           { width: '47%', backgroundColor: C.card, borderRadius: 12, padding: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    warnLabel:          { fontSize: 11, fontWeight: '700', color: C.subtext, textTransform: 'uppercase', letterSpacing: 0.3 },
    warnValue:          { fontSize: 26, fontWeight: '900', marginBottom: 4 },
    warnDesc:           { fontSize: 11, color: C.muted },
    warnAction:         { marginTop: 8, fontSize: 11, color: C.blue, fontWeight: '700' },

    // Role bars
    roleIcon:           { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
    roleLabel:          { fontSize: 13, fontWeight: '600', color: C.text },
    roleCount:          { fontSize: 13, fontWeight: '800' },
    roleBarBg:          { height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' },
    roleBarFill:        { height: 6, borderRadius: 3 },
    rolePct:            { fontSize: 11, color: C.muted, width: 32, textAlign: 'right' },

    // Top rankings
    rankingsGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    rankingsCard:       { width: '47%', backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12 },
    rankingsHeader:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
    rankingsTitle:      { fontSize: 12, fontWeight: '800', color: C.text },
    rankingsEmpty:      { fontSize: 12, color: C.muted },
    rankingRow:         { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
    rankingIndex:       { width: 22, fontSize: 11, color: C.muted, fontWeight: '700' },
    rankingName:        { flex: 1, fontSize: 12, color: C.text, fontWeight: '600', paddingRight: 6 },
    rankingCount:       { fontSize: 11, color: C.subtext, fontWeight: '700' },
    rankingsLead:       { fontSize: 13, color: C.subtext, lineHeight: 20, marginBottom: 12 },
    rankingsCta:        { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.indigo, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, alignSelf: 'flex-start' },
    rankingsCtaText:    { color: '#fff', fontSize: 13, fontWeight: '800' },

    // Top providers
    rankBadge:          { width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
    rankNum:            { fontSize: 11, fontWeight: '800' },

    // Transactions
    txnIcon:            { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
    txnProvider:        { fontSize: 13, fontWeight: '700', color: C.text },
    txnMeta:            { fontSize: 11, color: C.subtext, marginTop: 2 },
    txnAmount:          { fontSize: 13, fontWeight: '800' },

    // Audit log
    auditDot:           { width: 30, height: 30, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
    auditAction:        { fontSize: 13, fontWeight: '700', color: C.text, textTransform: 'capitalize' },
    auditDetail:        { fontSize: 11, color: C.subtext, marginTop: 2 },
    auditId:            { fontSize: 10, color: C.muted, fontFamily: 'monospace', maxWidth: 60 },

    // Settings (collapsible)
    collapsibleHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
    settingRow:         { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    settingLabel:       { fontSize: 14, fontWeight: '700', color: C.text, marginBottom: 4 },
    settingDesc:        { fontSize: 11, color: C.subtext, lineHeight: 16 },
    settingInput:       { backgroundColor: C.bg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: C.border, fontSize: 18, fontWeight: '700', color: C.text, width: 70, textAlign: 'center' },
    applyBtn:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.blue, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 20 },
    applyBtnText:       { color: '#fff', fontWeight: '700', fontSize: 14 },

    // Filters
    input:              { backgroundColor: C.bg, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.border, fontSize: 14, color: C.text, marginBottom: 4 },
    chipRow:            { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    chip:               { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: C.blueLight },
    chipActive:         { backgroundColor: C.blue },
    chipText:           { color: C.blue, fontSize: 12, fontWeight: '700' },
    chipTextActive:     { color: '#fff' },

    // Modal
    modalBg:            { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    modalBox:           { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '75%' },
    modalTitle:         { fontSize: 18, fontWeight: '800', color: C.text },
    modalSub:           { fontSize: 13, color: C.subtext },
    userRow:            { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
    userRowAvatar:      { width: 40, height: 40, borderRadius: 20, backgroundColor: C.blueLight, justifyContent: 'center', alignItems: 'center' },
    userRowAvatarText:  { fontSize: 16, fontWeight: '800', color: C.blue },
    userRowName:        { fontSize: 14, fontWeight: '700', color: C.text },
    userRowRole:        { fontSize: 11, color: C.subtext, textTransform: 'capitalize', marginTop: 2 },

    // Issue modal rows
    issueRow:           { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 12 },
    issueAvatar:        { width: 36, height: 36, borderRadius: 18, backgroundColor: C.blueLight, justifyContent: 'center', alignItems: 'center' },
    issueAvatarText:    { color: C.blue, fontWeight: '800' },
    issueName:          { fontSize: 13, fontWeight: '800', color: C.text },
    issueRole:          { fontSize: 11, color: C.subtext, textTransform: 'capitalize', marginTop: 1 },
    issueLabelText:     { fontSize: 11, color: C.text, marginTop: 4, fontWeight: '700' },
    issueDetailText:    { fontSize: 11, color: C.subtext, marginTop: 4, lineHeight: 16 },
    issueMetaText:      { fontSize: 10, color: C.muted, marginTop: 5, textTransform: 'capitalize' },
    issueActionsCol:    { gap: 6 },
    issueActionBtn:     { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: C.blueLight, alignItems: 'center' },
    issueActionText:    { color: C.blue, fontWeight: '800', fontSize: 11 },
    pricingRow:         { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    pricingLabel:       { flex: 1, fontSize: 13, color: C.text, fontWeight: '700' },
    pricingInputWrap:   { width: 136, flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10 },
    pricingInput:       { flex: 1, paddingVertical: 10, fontSize: 14, color: C.text, textAlign: 'right' },
    pricingSuffix:      { fontSize: 11, color: C.subtext, fontWeight: '700', marginLeft: 8 },
    formLabel:          { fontSize: 12, color: C.subtext, fontWeight: '700', marginBottom: 6, marginTop: 10 },
    formInput:          { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, color: C.text },
    formInputMultiline: { minHeight: 110 },
});
