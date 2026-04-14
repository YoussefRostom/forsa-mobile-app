import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { auth, db } from '../../../lib/firebase';
import { getBookingStatusMeta } from '../../../lib/bookingStatus';
import { notifyBookingStatusChange } from '../../../lib/bookingNotifications';
import { upsertBookingTransaction } from '../../../services/MonetizationService';
import { logAdminAction } from '../../../services/AdminOpsService';

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

const fmt = (value: any) => {
    if (!value) return '-';
    if (typeof value?.toDate === 'function') return value.toDate().toLocaleString();
    if (value?.seconds) return new Date(value.seconds * 1000).toLocaleString();
    if (typeof value === 'string') return value;
    return '-';
};

const bookedByLabel = (value: any) => {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'parent') return 'Parent';
    if (normalized === 'player') return 'Player';
    return 'Unknown';
};

const inferBookerKey = (booking: any) => {
    const explicit = String(booking?.customerType || '').toLowerCase();
    if (explicit === 'parent' || explicit === 'player') return explicit;
    if (booking?.academyId) return 'academy';
    if (booking?.playerId) return 'player';
    if (booking?.parentId || normalizeName(booking?.parentName)) return 'parent';
    return 'unknown';
};

const resolveChatUserId = (booking: any) => {
    const bookerKey = inferBookerKey(booking);
    if (bookerKey === 'parent') return booking.parentId || booking.userId || booking.playerId || booking.academyId || null;
    if (bookerKey === 'player') return booking.playerId || booking.userId || booking.parentId || booking.academyId || null;
    if (bookerKey === 'academy') return booking.academyId || booking.userId || null;
    return booking.playerId || booking.parentId || booking.userId || booking.academyId || null;
};

const resolveChatLabel = (booking: any) => {
    const bookerKey = inferBookerKey(booking);
    if (bookerKey === 'parent') return 'Chat parent';
    if (bookerKey === 'player') return 'Chat player';
    if (bookerKey === 'academy') return 'Chat academy';
    return 'Chat customer';
};

const KV = ({ label, value }: { label: string; value: string }) => (
    <View style={S.row}>
        <Text style={S.label}>{label}</Text>
        <Text style={S.value} numberOfLines={1}>{value}</Text>
    </View>
);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <View style={S.section}>
        <Text style={S.sectionTitle}>{title}</Text>
        {children}
    </View>
);

export default function AdminBookingDetailsScreen() {
    const { id } = useLocalSearchParams();
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [booking, setBooking] = useState<any | null>(null);
    const [resolvedNames, setResolvedNames] = useState<{ parent: string; player: string; provider: string }>({
        parent: '-',
        player: '-',
        provider: '-',
    });
    const [showPicker, setShowPicker] = useState(false);

    useEffect(() => {
        const load = async () => {
            try {
                const snap = await getDoc(doc(db, 'bookings', String(id)));
                if (snap.exists()) {
                    const bookingData: any = { id: snap.id, ...snap.data() };
                    setBooking(bookingData);

                    const candidateIds = Array.from(new Set([
                        bookingData.parentId,
                        bookingData.playerId,
                        bookingData.userId,
                        bookingData.providerId,
                    ].filter(Boolean).map((v) => String(v))));

                    const namesById: Record<string, string> = {};
                    await Promise.all(candidateIds.map(async (uid) => {
                        try {
                            const userSnap = await getDoc(doc(db, 'users', uid));
                            if (!userSnap.exists()) return;
                            const data: any = userSnap.data();
                            const resolved = pickName(
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
                            if (resolved !== '-') namesById[uid] = resolved;
                        } catch {}
                    }));

                    setResolvedNames({
                        parent: pickName(
                            bookingData.parentName,
                            bookingData.parent?.name,
                            bookingData.parent?.parentName,
                            bookingData.parentId ? namesById[String(bookingData.parentId)] : '',
                            bookingData.userId ? namesById[String(bookingData.userId)] : '',
                            bookingData.customerName,
                        ),
                        player: pickName(
                            bookingData.playerName,
                            bookingData.player?.name,
                            bookingData.playerId ? namesById[String(bookingData.playerId)] : '',
                            bookingData.customerType === 'player' ? bookingData.customerName : '',
                        ),
                        provider: pickName(
                            bookingData.providerName,
                            bookingData.name,
                            bookingData.providerId ? namesById[String(bookingData.providerId)] : '',
                        ),
                    });
                } else {
                    setBooking(null);
                }
            } catch (error) {
                console.error('Failed to load booking:', error);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [id]);

    const updateStatus = async (status: string) => {
        if (!booking) return;
        try {
            await updateDoc(doc(db, 'bookings', String(id)), { status, updatedAt: serverTimestamp() });
            const updated = { ...booking, status };
            setBooking(updated);

            try { await upsertBookingTransaction(String(id), updated, auth.currentUser?.uid, `Admin changed status to ${status}`); } catch {}
            try {
                await logAdminAction({
                    actionType: 'booking_status_changed',
                    targetCollection: 'bookings',
                    targetId: String(id),
                    reason: `Status set to ${status}`,
                    actorId: auth.currentUser?.uid,
                    metadata: { nextStatus: status },
                });
            } catch {}
            try {
                await notifyBookingStatusChange({
                    booking: updated,
                    nextStatus: status,
                    actorId: auth.currentUser?.uid,
                    actorLabel: 'Admin',
                });
            } catch {}
        } catch (error) {
            Alert.alert('Error', 'Failed to update status');
        }
    };

    const proposeTime = async (date: Date) => {
        if (!booking) return;
        setShowPicker(false);

        const datePart = date.toISOString().split('T')[0];
        const timePart = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const iso = date.toISOString();

        try {
            await updateDoc(doc(db, 'bookings', String(id)), {
                date: datePart,
                time: timePart,
                preferredTime: iso,
                proposedByAdmin: true,
                status: 'new_time_proposed',
                updatedAt: serverTimestamp(),
            });

            const updated = { ...booking, date: datePart, time: timePart, preferredTime: iso, proposedByAdmin: true, status: 'new_time_proposed' };
            setBooking(updated);

            try { await upsertBookingTransaction(String(id), updated, auth.currentUser?.uid, 'Admin proposed new time'); } catch {}
            try {
                await notifyBookingStatusChange({
                    booking: updated,
                    nextStatus: 'new_time_proposed',
                    actorId: auth.currentUser?.uid,
                    actorLabel: 'Admin',
                    proposedDate: datePart,
                    proposedTime: timePart,
                });
            } catch {}
        } catch {
            Alert.alert('Error', 'Failed to propose time');
        }
    };

    if (loading) {
        return (
            <View style={S.center}>
                <ActivityIndicator size="large" />
                <Text>Loading...</Text>
            </View>
        );
    }

    if (!booking) {
        return (
            <View style={S.center}>
                <Text>Booking not found</Text>
            </View>
        );
    }

    const statusMeta = getBookingStatusMeta(booking.status);
    const customer = pickName(booking.customerName, booking.playerName, booking.parentName, booking.userName);
    const player = pickName(
        booking.playerName,
        booking.player?.name,
        booking.customerType === 'player' ? booking.customerName : '',
        resolvedNames.player,
    );
    const parent = pickName(
        booking.parentName,
        booking.parent?.name,
        booking.parent?.parentName,
        booking.customerType === 'parent' ? booking.customerName : '',
        booking.userName,
        booking.customerName,
        resolvedNames.parent,
    );
    const provider = pickName(booking.providerName, booking.name, resolvedNames.provider);
    const attendance = booking.checkedInAt || booking.lastCheckInId || String(booking.attendanceStatus || '').toLowerCase() === 'checked_in' ? 'Checked in' : 'Not checked in';
    const inferredBooker = inferBookerKey(booking);
    const chatUserId = resolveChatUserId(booking);
    const service = String(booking.service || booking.program || booking.doctor || '-');
    const bookingType = String(booking.sessionType || booking.type || 'booking').replace(/_/g, ' ');
    const bookedBy = inferredBooker === 'academy' ? 'Academy' : bookedByLabel(booking.customerType);
    const amount = `${Number(booking.price || booking.fee || booking.amount || 0)} EGP`;
    const bookingCode = String(booking.id || '').slice(-6).toUpperCase();
    const chatActionLabel = resolveChatLabel(booking);
    const chatDisplayName = inferredBooker === 'parent' ? (parent === '-' ? customer : parent) : inferredBooker === 'player' ? player : customer;

    return (
        <ScrollView style={S.container} contentContainerStyle={S.content}>
            <View style={S.hero}>
                <View style={S.heroTop}>
                    <Text style={S.heroEyebrow}>Booking #{bookingCode || '------'}</Text>
                    <View style={[S.statusBadge, { backgroundColor: statusMeta.color }]}>
                        <Text style={S.statusBadgeText}>{statusMeta.label}</Text>
                    </View>
                </View>
                <Text style={S.title}>{customer === '-' ? 'Unnamed booking' : customer}</Text>
                <Text style={S.subtitle}>Parent: {parent === '-' ? 'Unknown parent' : parent}</Text>
                <View style={S.heroChips}>
                    <View style={S.heroChip}><Text style={S.heroChipText}>{bookedBy}</Text></View>
                    <View style={S.heroChip}><Text style={S.heroChipText}>{bookingType}</Text></View>
                    <View style={S.heroChip}><Text style={S.heroChipText}>{attendance}</Text></View>
                </View>
            </View>

            <Section title="People">
                <KV label="Player" value={player} />
                <KV label="Parent" value={parent === '-' ? 'Unknown parent' : parent} />
                <KV label="Provider" value={provider} />
                <KV label="Booked By" value={bookedBy} />
            </Section>

            <Section title="Reservation">
                <KV label="Service" value={service} />
                <KV label="Date" value={fmt(booking.date)} />
                <KV label="Time" value={String(booking.time || '-')} />
                <KV label="Attendance" value={attendance} />
                <KV label="Amount" value={amount} />
            </Section>

            <Section title="Timeline">
                <KV label="Created" value={fmt(booking.createdAt)} />
                <KV label="Updated" value={fmt(booking.updatedAt)} />
                <KV label="Preferred Time" value={fmt(booking.preferredTime)} />
            </Section>

            {String(booking.comments || booking.comment || '').trim() ? (
                <Section title="Comments">
                    <Text style={S.commentText}>{String(booking.comments || booking.comment || '').trim()}</Text>
                </Section>
            ) : null}

            <Section title="Actions">
                {!!chatUserId && (
                    <TouchableOpacity style={S.button} onPress={() => router.push(`/(admin)/user-chat?otherUserId=${chatUserId}&name=${encodeURIComponent(chatDisplayName)}`)}>
                        <Text style={S.buttonText}>{chatActionLabel}</Text>
                    </TouchableOpacity>
                )}

                <TouchableOpacity style={S.button} onPress={() => updateStatus('confirmed')}>
                    <Text style={S.buttonText}>Mark Confirmed</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[S.button, S.secondaryButton]} onPress={() => setShowPicker(true)}>
                    <Text style={S.buttonText}>Propose New Time</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[S.button, S.dangerButton]} onPress={() => updateStatus('cancelled')}>
                    <Text style={S.buttonText}>Mark Cancelled</Text>
                </TouchableOpacity>
            </Section>

            <DateTimePickerModal isVisible={showPicker} mode="datetime" onConfirm={proposeTime} onCancel={() => setShowPicker(false)} />
        </ScrollView>
    );
}

const S = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#e2e8f0' },
    content: { padding: 14, paddingBottom: 28, gap: 12 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8, backgroundColor: '#e2e8f0' },
    hero: {
        backgroundColor: '#0f172a',
        borderRadius: 22,
        padding: 18,
        gap: 10,
    },
    heroTop: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    heroEyebrow: {
        color: '#93c5fd',
        fontSize: 12,
        fontWeight: '800',
        textTransform: 'uppercase',
        letterSpacing: 0.8,
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
    title: { fontSize: 24, fontWeight: '800', color: '#f8fafc' },
    subtitle: { fontSize: 14, color: '#cbd5e1', fontWeight: '600' },
    heroChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    heroChip: {
        backgroundColor: 'rgba(148, 163, 184, 0.18)',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    heroChipText: { color: '#e2e8f0', fontSize: 12, fontWeight: '700' },
    section: {
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: '#cbd5e1',
        borderRadius: 18,
        padding: 14,
        gap: 10,
    },
    sectionTitle: {
        fontSize: 13,
        color: '#334155',
        fontWeight: '800',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 8,
        paddingVertical: 7,
        borderBottomWidth: 1,
        borderBottomColor: '#e2e8f0',
    },
    label: { flex: 1, fontSize: 13, color: '#64748b', fontWeight: '700' },
    value: { flex: 1.2, fontSize: 13, color: '#0f172a', textAlign: 'right', fontWeight: '700' },
    commentText: {
        fontSize: 14,
        lineHeight: 20,
        color: '#1e293b',
        fontWeight: '600',
    },
    button: {
        backgroundColor: '#1d4ed8',
        borderRadius: 14,
        paddingVertical: 14,
        paddingHorizontal: 14,
        alignItems: 'center',
        marginBottom: 8,
    },
    secondaryButton: { backgroundColor: '#0f766e' },
    dangerButton: { backgroundColor: '#b91c1c' },
    buttonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
