import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { auth } from '../../../lib/firebase';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { Ionicons } from '@expo/vector-icons';

export default function BookingDetails() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const [booking, setBooking] = useState<any | null>(null);
    const [loading, setLoading] = useState(true);
    const [showPicker, setShowPicker] = useState(false);
    const [proposedDate, setProposedDate] = useState<Date | null>(null);
    // Replaced API fetch logic with direct Firestore update

    useEffect(() => {
        const fetchBooking = async () => {
            try {
                const docSnap = await getDoc(doc(db, 'bookings', id as string));
                if (docSnap.exists()) {
                    setBooking({ id: docSnap.id, ...docSnap.data() });
                }
            } catch (error) {
                console.error("Error fetching booking:", error);
                Alert.alert("Error", "Failed to load booking details");
            } finally {
                setLoading(false);
            }
        };
        fetchBooking();
    }, [id]);

    const updateStatus = (status: string) => {
        Alert.alert("Update Status", `Change booking status to ${status.toUpperCase()}?`, [
            { text: "Cancel", style: "cancel" },
            {
                text: "Confirm",
                onPress: async () => {
                    try {
                        await updateDoc(doc(db, 'bookings', id as string), { status });
                        setBooking((prev: any) => ({ ...prev, status }));
                        Alert.alert("Success", `Booking ${status} successfully`);
                    } catch (error) {
                        console.error("Error updating status:", error);
                        Alert.alert("Error", "Failed to update status");
                    }
                }
            }
        ]);
    };

    const openProposePicker = () => {
        setShowPicker(true);
    };

    const handleConfirm = async (date: Date) => {
        setShowPicker(false);
        setProposedDate(date);

        const datePart = date.toISOString().split('T')[0];
        const timePart = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const isoTime = date.toISOString();

        try {
            await updateDoc(doc(db, 'bookings', id as string), {
                date: datePart,
                time: timePart,
                preferredTime: isoTime,
                proposedByAdmin: true,
                status: 'timing_proposed'
            });
            
            setBooking((prev: any) => ({
                ...prev,
                date: datePart,
                time: timePart,
                preferredTime: isoTime,
                proposedByAdmin: true,
                status: 'timing_proposed'
            }));

            Alert.alert('Success', 'New timing proposed and updated successfully');
        } catch (err: any) {
            console.error('Error proposing booking change', err);
            Alert.alert('Error', 'Failed to update booking proposal');
        }
    };

    const handleCancelPicker = () => setShowPicker(false);

    if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#4e73df" /></View>;
    if (!booking) return <View style={styles.center}><Text>Booking not found</Text></View>;

    const getStatusColor = () => {
        switch (booking.status) {
            case 'confirmed': return '#1cc88a';
            case 'player_accepted': return '#36b9cc';
            case 'cancelled': return '#e74a3b';
            case 'player_rejected': return '#e74a3b';
            case 'timing_proposed': return '#f6c23e';
            default: return '#f6c23e';
        }
    };

    return (
        <ScrollView style={styles.container}>
            <View style={styles.header}>
                <Ionicons
                    name={booking.type === 'clinic' ? 'medical' : 'school'}
                    size={48}
                    color="#4e73df"
                />
                <Text style={styles.title}>Booking Details</Text>
                <View style={[styles.badge, { backgroundColor: getStatusColor() }]}>
                    <Text style={styles.badgeText}>{(booking.status || 'pending').toUpperCase()}</Text>
                </View>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Information</Text>
                <DetailRow label="Player" value={booking.customerName || booking.playerName || 'Unknown Player'} />
                <DetailRow label="Provider" value={booking.providerName || booking.name || 'Unknown Provider'} />
                <DetailRow label="Type" value={(booking.type || 'generic').toUpperCase()} />
                <DetailRow
                    label={booking.type === 'clinic' ? "Service" : "Program"}
                    value={booking.service || booking.program || 'N/A'}
                />
                <DetailRow label="Date" value={booking.date} />
                {booking.time && <DetailRow label="Time" value={booking.time} />}
                {booking.shift && <DetailRow label="Shift" value={booking.shift} />}
                <DetailRow label="Price" value={`${booking.price || 0} EGP`} />
                {booking.doctor && <DetailRow label="Doctor" value={booking.doctor} />}
                {booking.ageGroup && <DetailRow label="Age Group" value={booking.ageGroup} />}
            </View>

            <View style={styles.actionSection}>
                {(booking.playerId || booking.parentId || booking.academyId) && (
                    <TouchableOpacity 
                        style={[styles.actionBtn, { backgroundColor: '#36b9cc' }]} 
                        onPress={() => {
                            const chatUserId = booking.playerId || booking.parentId || booking.academyId;
                            const chatUserName = booking.customerName || booking.playerName || booking.parentName || booking.academyName || 'User';
                            router.push(`/(admin)/user-chat?otherUserId=${chatUserId}&name=${encodeURIComponent(chatUserName)}`);
                        }}
                    >
                        <Text style={styles.actionBtnText}>Chat with User</Text>
                    </TouchableOpacity>
                )}
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#4e73df' }]} onPress={openProposePicker}>
                    <Text style={styles.actionBtnText}>Propose New Time</Text>
                </TouchableOpacity>
                <DateTimePickerModal
                    isVisible={showPicker}
                    mode="datetime"
                    onConfirm={handleConfirm}
                    onCancel={handleCancelPicker}
                />
                {booking.status !== 'confirmed' && (
                    <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#1cc88a' }]} onPress={() => updateStatus('confirmed')}>
                        <Text style={styles.actionBtnText}>Confirm Booking</Text>
                    </TouchableOpacity>
                )}
                {booking.status !== 'cancelled' && (
                    <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#e74a3b' }]} onPress={() => updateStatus('cancelled')}>
                        <Text style={styles.actionBtnText}>Cancel Booking</Text>
                    </TouchableOpacity>
                )}
            </View>
        </ScrollView>
    );
}

const DetailRow = ({ label, value }: any) => (
    <View style={styles.detailRow}>
        <Text style={styles.label}>{label}:</Text>
        <Text style={styles.value}>{value}</Text>
    </View>
);

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f4f6f9' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header: { alignItems: 'center', backgroundColor: '#fff', padding: 32, marginBottom: 16 },
    title: { fontSize: 24, fontWeight: 'bold', marginVertical: 8 },
    badge: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20 },
    badgeText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
    section: { backgroundColor: '#fff', padding: 16, marginBottom: 16 },
    sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 16, borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 8 },
    detailRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
    label: { fontSize: 16, color: '#666' },
    value: { fontSize: 16, fontWeight: '600', color: '#333' },
    actionSection: { padding: 16 },
    actionBtn: { padding: 16, borderRadius: 12, alignItems: 'center', marginBottom: 12 },
    actionBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' }
});
