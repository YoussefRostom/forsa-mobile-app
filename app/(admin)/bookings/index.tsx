import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    View,
    Text,
    FlatList,
    StyleSheet,
    TouchableOpacity,
    ActivityIndicator,
    TextInput,
    ScrollView,
    RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { getBookingStatusMeta } from '../../../lib/bookingStatus';

type TypeFilter = 'all' | 'academy' | 'clinic' | 'private';
type BookerFilter = 'all' | 'parent' | 'player' | 'academy' | 'unknown';
type AttendanceFilter = 'all' | 'checked_in' | 'not_checked_in';
type SortFilter = 'newest' | 'oldest' | 'upcoming';
type QualityFilter = 'all' | 'missing_parent' | 'with_comments';

const normalizeName = (value: any) => {
    const text = String(value || '').trim();
    if (!text) return '';
    const lower = text.toLowerCase();
    const invalid = ['parent', 'player', 'user', 'customer', 'academy', 'clinic', 'unknown', '-', 'n/a', 'na', 'none'];
    if (invalid.includes(lower)) return '';
    return text;
};

const pickName = (...values: any[]) => {
    for (const value of values) {
        const valid = normalizeName(value);
        if (valid) return valid;
    }
    return '-';
};

const inferBookerKey = (booking: any): BookerFilter => {
    const explicit = String(booking?.customerType || '').toLowerCase();
    if (explicit === 'parent' || explicit === 'player') return explicit;
    if (booking?.academyId) return 'academy';
    if (booking?.playerId) return 'player';
    if (booking?.parentId || normalizeName(booking?.parentName)) return 'parent';
    return 'unknown';
};

const getBookedByLabel = (booking: any) => {
    const key = inferBookerKey(booking);
    if (key === 'parent') return 'Parent';
    if (key === 'player') return 'Player';
    if (key === 'academy') return 'Academy';
    return 'Unknown';
};

const getBookingTypeLabel = (booking: any) => {
    if (String(booking?.sessionType || '').toLowerCase() === 'private') return 'Private';
    const normalized = String(booking?.type || '').toLowerCase();
    if (normalized === 'academy') return 'Academy';
    if (normalized === 'clinic') return 'Clinic';
    return 'Other';
};

const getBookingTypeKey = (booking: any): TypeFilter => {
    if (String(booking?.sessionType || '').toLowerCase() === 'private') return 'private';
    const normalized = String(booking?.type || '').toLowerCase();
    if (normalized === 'academy') return 'academy';
    if (normalized === 'clinic') return 'clinic';
    return 'all';
};

const getAttendance = (booking: any) => {
    const checkedIn = Boolean(
        booking?.checkedInAt ||
        booking?.lastCheckInId ||
        String(booking?.attendanceStatus || '').toLowerCase() === 'checked_in'
    );

    return {
        key: checkedIn ? 'checked_in' : 'not_checked_in',
        label: checkedIn ? 'Checked in' : 'Not checked in',
    };
};

const toDateValue = (value: any) => {
    if (!value) return null;
    if (typeof value?.toDate === 'function') return value.toDate();
    if (value?.seconds) return new Date(value.seconds * 1000);
    if (typeof value === 'string') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
};

const toTimestamp = (booking: any) => {
    const normalized = toDateValue(booking?.updatedAt) || toDateValue(booking?.createdAt);
    if (normalized) return normalized.getTime();
    if (typeof booking?.date === 'string' && booking.date.trim()) {
        const parsed = new Date(booking.time ? `${booking.date} ${booking.time}` : booking.date);
        if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
    }
    return 0;
};

const toScheduledTimestamp = (booking: any) => {
    const preferredTime = toDateValue(booking?.preferredTime);
    if (preferredTime) return preferredTime.getTime();

    if (typeof booking?.date === 'string' && booking.date.trim()) {
        const parsed = new Date(booking.time ? `${booking.date} ${booking.time}` : booking.date);
        if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
    }

    return toTimestamp(booking);
};

const toDayKey = (booking: any) => {
    if (typeof booking?.date === 'string' && booking.date.trim()) return booking.date;
    const preferredTime = toDateValue(booking?.preferredTime);
    if (preferredTime) return preferredTime.toISOString().split('T')[0];
    return null;
};

const fmtDate = (value: any) => {
    if (!value) return '-';
    if (typeof value === 'string') return value;
    if (typeof value?.toDate === 'function') return value.toDate().toLocaleDateString();
    if (value?.seconds) return new Date(value.seconds * 1000).toLocaleDateString();
    return '-';
};

const fmtBookingDate = (booking: any) => {
    if (booking?.date) return fmtDate(booking.date);
    const createdAt = toDateValue(booking?.createdAt);
    return createdAt ? createdAt.toLocaleDateString() : '-';
};

const shortId = (id: string) => String(id || '').slice(-6).toUpperCase();

const FilterChip = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => (
    <TouchableOpacity style={[S.chip, active && S.chipActive]} onPress={onPress}>
        <Text style={[S.chipText, active && S.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
);

const MetricCard = ({ label, value, accent }: { label: string; value: string; accent: string }) => (
    <View style={S.metricCard}>
        <View style={[S.metricAccent, { backgroundColor: accent }]} />
        <Text style={S.metricValue}>{value}</Text>
        <Text style={S.metricLabel}>{label}</Text>
    </View>
);

const InfoLine = ({ label, value }: { label: string; value: string }) => (
    <View style={S.infoLine}>
        <Text style={S.infoLabel}>{label}</Text>
        <Text style={S.infoValue} numberOfLines={1}>{value}</Text>
    </View>
);

export default function AdminBookingsListScreen() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [bookings, setBookings] = useState<any[]>([]);
    const [users, setUsers] = useState<Record<string, string>>({});
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
    const [bookerFilter, setBookerFilter] = useState<BookerFilter>('all');
    const [attendanceFilter, setAttendanceFilter] = useState<AttendanceFilter>('all');
    const [qualityFilter, setQualityFilter] = useState<QualityFilter>('all');
    const [sortFilter, setSortFilter] = useState<SortFilter>('newest');

    const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
        if (mode === 'refresh') {
            setRefreshing(true);
        } else {
            setLoading(true);
        }

        try {
            const [bookingsSnap, usersSnap] = await Promise.all([
                getDocs(query(collection(db, 'bookings'), orderBy('createdAt', 'desc'))),
                getDocs(collection(db, 'users')),
            ]);

            const nextBookings = bookingsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
            const nextUsers: Record<string, string> = {};

            usersSnap.forEach((docSnap) => {
                const data: any = docSnap.data();
                const name = pickName(
                    data.academyName,
                    data.clinicName,
                    data.parentName,
                    data.playerName,
                    data.agentName,
                    data.name,
                    `${data.firstName || ''} ${data.lastName || ''}`.trim(),
                    data.displayName,
                    data.fullName,
                    data.phone,
                    data.email
                );
                if (name !== '-') nextUsers[docSnap.id] = name;
            });

            setBookings(nextBookings);
            setUsers(nextUsers);
        } catch (error) {
            console.error('Failed to load bookings list:', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const derivedBookings = useMemo(() => {
        return bookings.map((booking) => {
            const statusMeta = getBookingStatusMeta(booking.status);
            const player = pickName(
                booking.playerName,
                booking.player?.name,
                booking.playerId ? users[booking.playerId] : '',
                inferBookerKey(booking) === 'player' ? booking.customerName : ''
            );
            const parent = pickName(
                booking.parentName,
                booking.parent?.name,
                booking.parent?.parentName,
                booking.parentId ? users[booking.parentId] : '',
                booking.userId ? users[booking.userId] : '',
                booking.bookedByName,
                inferBookerKey(booking) === 'parent' ? booking.customerName : '',
                booking.customerName
            );
            const provider = pickName(
                booking.providerName,
                booking.name,
                booking.provider?.name,
                booking.providerId ? users[booking.providerId] : ''
            );
            const service = String(booking.service || booking.program || booking.doctor || '-');
            const bookedByKey = inferBookerKey(booking);
            const bookedBy = getBookedByLabel(booking);
            const attendance = getAttendance(booking);
            const bookingTypeKey = getBookingTypeKey(booking);
            const bookingType = getBookingTypeLabel(booking);
            const customer = pickName(booking.customerName, player, parent);
            const commentText = String(booking.comments || booking.comment || '').trim();
            const statusKey = String(booking.status || 'pending').toLowerCase();
            const shouldHaveParent = bookedByKey === 'parent' || (Boolean(booking.parentId) && String(booking.parentId) !== String(booking.playerId || '')) || Boolean(normalizeName(booking.parentName));

            return {
                id: booking.id,
                raw: booking,
                statusMeta,
                player,
                parent,
                provider,
                service,
                bookedBy,
                bookedByKey,
                attendanceLabel: attendance.label,
                attendanceKey: attendance.key as AttendanceFilter,
                bookingType,
                bookingTypeKey,
                customer,
                commentText,
                missingParent: shouldHaveParent && parent === '-',
                dateLabel: fmtBookingDate(booking),
                timeLabel: String(booking.time || '-'),
                sortTime: toTimestamp(booking),
                scheduledTime: toScheduledTimestamp(booking),
                statusKey,
                dayKey: toDayKey(booking),
                searchBlob: [
                    booking.id,
                    customer,
                    player,
                    parent,
                    provider,
                    service,
                    booking.doctor,
                    booking.comments,
                    booking.city,
                    booking.status,
                    bookedBy,
                    bookingType,
                ].join(' ').toLowerCase(),
            };
        });
    }, [bookings, users]);

    const summary = useMemo(() => {
        const today = new Date().toISOString().split('T')[0];
        return {
            total: derivedBookings.length,
            pending: derivedBookings.filter((item) => ['pending', 'new_time_proposed'].includes(item.statusKey)).length,
            today: derivedBookings.filter((item) => item.dayKey === today).length,
            missingParent: derivedBookings.filter((item) => item.missingParent).length,
        };
    }, [derivedBookings]);

    const availableStatuses = useMemo(() => {
        const preferred = ['pending', 'confirmed', 'new_time_proposed', 'completed', 'cancelled', 'no_show', 'refunded', 'failed_payment', 'failed'];
        const present = Array.from(new Set(derivedBookings.map((item) => item.statusKey)));
        return present.sort((left, right) => {
            const leftIndex = preferred.indexOf(left);
            const rightIndex = preferred.indexOf(right);
            if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right);
            if (leftIndex === -1) return 1;
            if (rightIndex === -1) return -1;
            return leftIndex - rightIndex;
        });
    }, [derivedBookings]);

    const filtered = useMemo(() => {
        const searchText = search.trim().toLowerCase();

        const next = derivedBookings.filter((item) => {
            if (searchText && !item.searchBlob.includes(searchText)) return false;
            if (statusFilter !== 'all' && item.statusKey !== statusFilter) return false;
            if (typeFilter !== 'all' && item.bookingTypeKey !== typeFilter) return false;
            if (bookerFilter !== 'all' && item.bookedByKey !== bookerFilter) return false;
            if (attendanceFilter !== 'all' && item.attendanceKey !== attendanceFilter) return false;
            if (qualityFilter === 'missing_parent' && !item.missingParent) return false;
            if (qualityFilter === 'with_comments' && !item.commentText) return false;
            return true;
        });

        next.sort((left, right) => {
            if (sortFilter === 'oldest') return left.sortTime - right.sortTime;
            if (sortFilter === 'upcoming') {
                const now = Date.now();
                const leftFuture = left.scheduledTime >= now;
                const rightFuture = right.scheduledTime >= now;
                if (leftFuture !== rightFuture) return leftFuture ? -1 : 1;
                return left.scheduledTime - right.scheduledTime;
            }
            return right.sortTime - left.sortTime;
        });

        return next;
    }, [attendanceFilter, bookerFilter, derivedBookings, qualityFilter, search, sortFilter, statusFilter, typeFilter]);

    const activeFilterCount = [
        statusFilter !== 'all',
        typeFilter !== 'all',
        bookerFilter !== 'all',
        attendanceFilter !== 'all',
        qualityFilter !== 'all',
        sortFilter !== 'newest',
        search.trim().length > 0,
    ].filter(Boolean).length;

    if (loading) {
        return (
            <View style={S.center}>
                <ActivityIndicator size="large" color="#0f172a" />
                <Text style={S.loadingText}>Loading bookings...</Text>
            </View>
        );
    }

    return (
        <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={S.listContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor="#0f172a" />}
            ListHeaderComponent={
                <View style={S.headerWrap}>
                    <View style={S.heroCard}>
                        <Text style={S.heroEyebrow}>Admin Bookings</Text>
                        <Text style={S.heroTitle}>Find any reservation fast</Text>
                        <Text style={S.heroSubtitle}>
                            Search by customer, parent, provider, service, booking id, or comments. Filter by status, type, booker, attendance, and missing parent data.
                        </Text>
                    </View>

                    <View style={S.metricsRow}>
                        <MetricCard label="Total" value={String(summary.total)} accent="#0f172a" />
                        <MetricCard label="Pending" value={String(summary.pending)} accent="#f59e0b" />
                        <MetricCard label="Today" value={String(summary.today)} accent="#2563eb" />
                        <MetricCard label="No Parent" value={String(summary.missingParent)} accent="#dc2626" />
                    </View>

                    <View style={S.panel}>
                        <Text style={S.panelTitle}>Search</Text>
                        <TextInput
                            style={S.search}
                            value={search}
                            onChangeText={setSearch}
                            placeholder="Search customer, parent, provider, service, id"
                            placeholderTextColor="#94a3b8"
                        />
                        <View style={S.resultRow}>
                            <Text style={S.resultText}>{filtered.length} results</Text>
                            {activeFilterCount > 0 ? (
                                <TouchableOpacity
                                    style={S.clearButton}
                                    onPress={() => {
                                        setSearch('');
                                        setStatusFilter('all');
                                        setTypeFilter('all');
                                        setBookerFilter('all');
                                        setAttendanceFilter('all');
                                        setQualityFilter('all');
                                        setSortFilter('newest');
                                    }}
                                >
                                    <Text style={S.clearButtonText}>Clear filters</Text>
                                </TouchableOpacity>
                            ) : null}
                        </View>
                    </View>

                    <View style={S.panel}>
                        <Text style={S.panelTitle}>Status</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.chipsRow}>
                            <FilterChip label="All" active={statusFilter === 'all'} onPress={() => setStatusFilter('all')} />
                            {availableStatuses.map((status) => (
                                <FilterChip
                                    key={status}
                                    label={getBookingStatusMeta(status).label}
                                    active={statusFilter === status}
                                    onPress={() => setStatusFilter(status)}
                                />
                            ))}
                        </ScrollView>

                        <Text style={S.panelTitle}>Type</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.chipsRow}>
                            <FilterChip label="All" active={typeFilter === 'all'} onPress={() => setTypeFilter('all')} />
                            <FilterChip label="Academy" active={typeFilter === 'academy'} onPress={() => setTypeFilter('academy')} />
                            <FilterChip label="Clinic" active={typeFilter === 'clinic'} onPress={() => setTypeFilter('clinic')} />
                            <FilterChip label="Private" active={typeFilter === 'private'} onPress={() => setTypeFilter('private')} />
                        </ScrollView>

                        <Text style={S.panelTitle}>Booked By</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.chipsRow}>
                            <FilterChip label="All" active={bookerFilter === 'all'} onPress={() => setBookerFilter('all')} />
                            <FilterChip label="Parent" active={bookerFilter === 'parent'} onPress={() => setBookerFilter('parent')} />
                            <FilterChip label="Player" active={bookerFilter === 'player'} onPress={() => setBookerFilter('player')} />
                            <FilterChip label="Academy" active={bookerFilter === 'academy'} onPress={() => setBookerFilter('academy')} />
                            <FilterChip label="Unknown" active={bookerFilter === 'unknown'} onPress={() => setBookerFilter('unknown')} />
                        </ScrollView>

                        <Text style={S.panelTitle}>Attendance</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.chipsRow}>
                            <FilterChip label="All" active={attendanceFilter === 'all'} onPress={() => setAttendanceFilter('all')} />
                            <FilterChip label="Checked In" active={attendanceFilter === 'checked_in'} onPress={() => setAttendanceFilter('checked_in')} />
                            <FilterChip label="Not Checked In" active={attendanceFilter === 'not_checked_in'} onPress={() => setAttendanceFilter('not_checked_in')} />
                        </ScrollView>

                        <Text style={S.panelTitle}>Quality</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.chipsRow}>
                            <FilterChip label="All" active={qualityFilter === 'all'} onPress={() => setQualityFilter('all')} />
                            <FilterChip label="Missing Parent" active={qualityFilter === 'missing_parent'} onPress={() => setQualityFilter('missing_parent')} />
                            <FilterChip label="With Comments" active={qualityFilter === 'with_comments'} onPress={() => setQualityFilter('with_comments')} />
                        </ScrollView>

                        <Text style={S.panelTitle}>Sort</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.chipsRow}>
                            <FilterChip label="Newest" active={sortFilter === 'newest'} onPress={() => setSortFilter('newest')} />
                            <FilterChip label="Oldest" active={sortFilter === 'oldest'} onPress={() => setSortFilter('oldest')} />
                            <FilterChip label="Upcoming" active={sortFilter === 'upcoming'} onPress={() => setSortFilter('upcoming')} />
                        </ScrollView>
                    </View>
                </View>
            }
            renderItem={({ item }) => (
                <TouchableOpacity style={S.card} onPress={() => router.push(`/(admin)/bookings/${item.id}` as any)}>
                    <View style={S.cardTop}>
                        <View style={S.cardTopText}>
                            <Text style={S.cardTitle} numberOfLines={1}>{item.customer}</Text>
                            <Text style={S.cardSubTitle} numberOfLines={1}>{item.provider !== '-' ? item.provider : item.bookingType}</Text>
                        </View>
                        <View style={[S.statusBadge, { backgroundColor: item.statusMeta.color }]}>
                            <Text style={S.statusBadgeText}>{item.statusMeta.label}</Text>
                        </View>
                    </View>

                    <View style={S.badgesRow}>
                        <View style={S.softBadge}><Text style={S.softBadgeText}>{item.bookingType}</Text></View>
                        <View style={S.softBadge}><Text style={S.softBadgeText}>{item.bookedBy}</Text></View>
                        <View style={S.softBadge}><Text style={S.softBadgeText}>{item.attendanceLabel}</Text></View>
                        <View style={S.softBadge}><Text style={S.softBadgeText}>#{shortId(item.id)}</Text></View>
                    </View>

                    <View style={S.infoGrid}>
                        <InfoLine label="Provider" value={item.provider} />
                        <InfoLine label="Service" value={item.service} />
                        <InfoLine label="Date" value={item.dateLabel} />
                        <InfoLine label="Time" value={item.timeLabel} />
                        <InfoLine label="City" value={String(item.raw.city || '-')} />
                    </View>

                    {item.commentText ? (
                        <View style={S.noteBox}>
                            <Text style={S.noteLabel}>Comments</Text>
                            <Text style={S.noteText} numberOfLines={2}>{item.commentText}</Text>
                        </View>
                    ) : null}
                </TouchableOpacity>
            )}
            ListEmptyComponent={
                <View style={S.emptyState}>
                    <Text style={S.emptyTitle}>No bookings match these filters</Text>
                    <Text style={S.emptyText}>Try clearing filters or searching with fewer terms.</Text>
                </View>
            }
        />
    );
}

const S = StyleSheet.create({
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#e2e8f0',
    },
    loadingText: {
        fontSize: 14,
        color: '#334155',
        fontWeight: '600',
    },
    listContent: {
        backgroundColor: '#e2e8f0',
        padding: 14,
        paddingBottom: 28,
    },
    headerWrap: {
        gap: 14,
        marginBottom: 14,
    },
    heroCard: {
        backgroundColor: '#0f172a',
        borderRadius: 22,
        padding: 18,
        shadowColor: '#0f172a',
        shadowOpacity: 0.18,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 5 },
        elevation: 4,
    },
    heroEyebrow: {
        color: '#93c5fd',
        fontSize: 12,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.8,
    },
    heroTitle: {
        color: '#f8fafc',
        fontSize: 24,
        fontWeight: '800',
        marginTop: 6,
    },
    heroSubtitle: {
        color: '#cbd5e1',
        fontSize: 14,
        lineHeight: 20,
        marginTop: 8,
    },
    metricsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    metricCard: {
        flexGrow: 1,
        minWidth: '47%',
        backgroundColor: '#f8fafc',
        borderRadius: 18,
        padding: 14,
        borderWidth: 1,
        borderColor: '#cbd5e1',
    },
    metricAccent: {
        width: 36,
        height: 4,
        borderRadius: 999,
        marginBottom: 12,
    },
    metricValue: {
        fontSize: 24,
        fontWeight: '800',
        color: '#0f172a',
    },
    metricLabel: {
        marginTop: 4,
        fontSize: 12,
        color: '#475569',
        fontWeight: '700',
        textTransform: 'uppercase',
    },
    panel: {
        backgroundColor: '#f8fafc',
        borderRadius: 18,
        padding: 14,
        borderWidth: 1,
        borderColor: '#cbd5e1',
        gap: 10,
    },
    panelTitle: {
        fontSize: 13,
        color: '#334155',
        fontWeight: '800',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    search: {
        backgroundColor: '#fff',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#cbd5e1',
        paddingHorizontal: 14,
        paddingVertical: 13,
        color: '#0f172a',
        fontSize: 15,
        fontWeight: '600',
    },
    resultRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
    },
    resultText: {
        fontSize: 13,
        fontWeight: '700',
        color: '#334155',
    },
    clearButton: {
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 999,
        backgroundColor: '#dbeafe',
    },
    clearButtonText: {
        color: '#1d4ed8',
        fontSize: 12,
        fontWeight: '800',
    },
    chipsRow: {
        paddingRight: 6,
        gap: 8,
    },
    chip: {
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 999,
        backgroundColor: '#e2e8f0',
        borderWidth: 1,
        borderColor: '#cbd5e1',
    },
    chipActive: {
        backgroundColor: '#0f172a',
        borderColor: '#0f172a',
    },
    chipText: {
        color: '#334155',
        fontSize: 13,
        fontWeight: '700',
    },
    chipTextActive: {
        color: '#f8fafc',
    },
    card: {
        backgroundColor: '#f8fafc',
        borderRadius: 20,
        padding: 16,
        borderWidth: 1,
        borderColor: '#cbd5e1',
        marginBottom: 12,
        gap: 12,
        shadowColor: '#0f172a',
        shadowOpacity: 0.08,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 2,
    },
    cardTop: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
    },
    cardTopText: {
        flex: 1,
        gap: 6,
    },
    cardTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#0f172a',
    },
    cardSubTitle: {
        fontSize: 13,
        color: '#475569',
        fontWeight: '600',
    },
    statusBadge: {
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 999,
    },
    statusBadgeText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '800',
        textTransform: 'uppercase',
    },
    badgesRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    softBadge: {
        backgroundColor: '#e2e8f0',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    softBadgeText: {
        color: '#334155',
        fontSize: 12,
        fontWeight: '700',
    },
    infoGrid: {
        gap: 8,
    },
    infoLine: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#e2e8f0',
    },
    infoLabel: {
        flex: 1,
        fontSize: 13,
        color: '#64748b',
        fontWeight: '700',
    },
    infoValue: {
        flex: 1.35,
        fontSize: 13,
        color: '#0f172a',
        textAlign: 'right',
        fontWeight: '700',
    },
    noteBox: {
        backgroundColor: '#eff6ff',
        borderRadius: 14,
        padding: 12,
        borderWidth: 1,
        borderColor: '#bfdbfe',
    },
    noteLabel: {
        fontSize: 12,
        fontWeight: '800',
        color: '#1d4ed8',
        textTransform: 'uppercase',
        marginBottom: 6,
    },
    noteText: {
        fontSize: 13,
        color: '#1e3a8a',
        lineHeight: 18,
        fontWeight: '600',
    },
    emptyState: {
        backgroundColor: '#f8fafc',
        borderRadius: 18,
        padding: 24,
        borderWidth: 1,
        borderColor: '#cbd5e1',
        alignItems: 'center',
        marginTop: 8,
    },
    emptyTitle: {
        fontSize: 18,
        color: '#0f172a',
        fontWeight: '800',
        textAlign: 'center',
    },
    emptyText: {
        marginTop: 8,
        fontSize: 14,
        color: '#475569',
        textAlign: 'center',
        lineHeight: 20,
    },
});
