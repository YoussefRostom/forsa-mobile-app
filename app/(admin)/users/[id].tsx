import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, TextInput } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../../lib/firebase';
import { addAdminNote, subscribeAdminNotes } from '../../../services/AdminOpsService';
import FootballLoader from '../../../components/FootballLoader';
import { suspendUser, unsuspendUser } from '../../../services/ModerationService';

const resolveDisplayName = (user: any) => {
    const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();

    return (
        user?.username ||
        user?.displayName ||
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

export default function UserDetails() {
    const { id } = useLocalSearchParams();
    const [user, setUser] = useState<any | null>(null);
    const [loading, setLoading] = useState(true);
    const [adminNotes, setAdminNotes] = useState<any[]>([]);
    const [newNote, setNewNote] = useState('');
    const [savingNote, setSavingNote] = useState(false);
    useEffect(() => {
        const fetchUser = async () => {
            if (!id) return;
            try {
                const docRef = doc(db, 'users', id as string);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    setUser({ id: docSnap.id, ...docSnap.data() });
                } else {
                    Alert.alert('Error', 'User not found');
                }
            } catch (error) {
                console.error('Error fetching user details:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchUser();
    }, [id]);

    useEffect(() => {
        if (!id) return;
        const unsubscribe = subscribeAdminNotes(id as string, setAdminNotes);
        return unsubscribe;
    }, [id]);

    const handleStatusChange = (newStatus: string) => {
        Alert.alert("Update Status", `Change user status to ${newStatus}?`, [
            { text: "Cancel", style: "cancel" },
            {
                text: "Update", onPress: async () => {
                    try {
                        const adminId = auth.currentUser?.uid || '';

                        if (newStatus === 'suspended') {
                            await suspendUser(id as string, adminId, 'Your account has been suspended. Please contact the admin.');
                        } else {
                            await unsuspendUser(id as string, adminId, 'Your account has been reactivated. You can use the app again.');
                        }

                        setUser((prev: any) => prev ? { ...prev, status: newStatus, isSuspended: newStatus === 'suspended' } : null);
                    } catch (error) {
                        console.error("Error updating status:", error);
                        Alert.alert("Error", "Failed to update status");
                    }
                }
            }
        ]);
    };

    const handleAddNote = async () => {
        if (!newNote.trim()) {
            Alert.alert('Note required', 'Please write a note first.');
            return;
        }
        setSavingNote(true);
        try {
            await addAdminNote({
                targetUserId: id as string,
                note: newNote,
                actorId: auth.currentUser?.uid,
                category: 'support',
            });
            setNewNote('');
        } catch (error) {
            console.error('Error adding admin note:', error);
            Alert.alert('Error', 'Failed to save note');
        } finally {
            setSavingNote(false);
        }
    };

    if (loading) return <View style={styles.center}><FootballLoader size="large" color="#000" /></View>;
    if (!user) return <View style={styles.center}><Text>User not found</Text></View>;

    const displayName = resolveDisplayName(user);
    const role = user.role || 'No Role';
    const status = user.status || 'active';

    return (
        <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
            <View style={styles.profileHeader}>
                <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{displayName[0] ? displayName[0].toUpperCase() : '?'}</Text>
                </View>
                <Text style={styles.name}>{displayName}</Text>
                <Text style={styles.role}>{role.toUpperCase()}</Text>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Contact Information</Text>
                <View style={styles.infoRow}>
                    <Ionicons name="mail-outline" size={20} color="#666" />
                    <Text style={styles.infoText}>{user.email || 'No Email'}</Text>
                </View>
                <View style={styles.infoRow}>
                    <Ionicons name="call-outline" size={20} color="#666" />
                    <Text style={styles.infoText}>{user.phone || user.phoneNumber || 'No Phone'}</Text>
                </View>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Account Status</Text>
                <View style={styles.statusContainer}>
                    <View style={[styles.statusBadge, { backgroundColor: status === 'active' ? '#1cc88a' : status === 'suspended' ? '#e74a3b' : '#f6c23e' }]}>
                        <Text style={styles.statusText}>{status.toUpperCase()}</Text>
                    </View>
                </View>
                <Text style={styles.instr}>Update Account Status:</Text>
                <View style={styles.buttonRow}>
                    <TouchableOpacity style={[styles.btn, styles.approveBtn]} onPress={() => handleStatusChange('active')}>
                        <Text style={styles.btnText}>Activate</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.btn, styles.suspendBtn]} onPress={() => handleStatusChange('suspended')}>
                        <Text style={styles.btnText}>Suspend</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Internal Admin Notes</Text>
                <TextInput
                    style={styles.noteInput}
                    multiline
                    placeholder="Add a private note for support, moderation, or payout follow-up"
                    placeholderTextColor="#94a3b8"
                    value={newNote}
                    onChangeText={setNewNote}
                />
                <TouchableOpacity style={[styles.btn, styles.approveBtn, { marginHorizontal: 0, marginTop: 10 }]} onPress={handleAddNote}>
                    {savingNote ? <FootballLoader color="#fff" /> : <Text style={styles.btnText}>Save Note</Text>}
                </TouchableOpacity>

                <View style={{ marginTop: 16 }}>
                    {adminNotes.map((note) => (
                        <View key={note.id} style={styles.noteCard}>
                            <Text style={styles.noteText}>{note.note}</Text>
                            <Text style={styles.noteMeta}>{note.category || 'general'}</Text>
                        </View>
                    ))}
                    {!adminNotes.length && <Text style={styles.instr}>No internal notes yet.</Text>}
                </View>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f4f6f9' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    profileHeader: { alignItems: 'center', backgroundColor: '#fff', padding: 30, marginBottom: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
    avatar: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#4e73df', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
    avatarText: { color: '#fff', fontSize: 36, fontWeight: 'bold' },
    name: { fontSize: 22, fontWeight: 'bold', color: '#333', marginBottom: 4 },
    role: { fontSize: 13, color: '#4e73df', fontWeight: 'bold', letterSpacing: 1 },
    section: { backgroundColor: '#fff', padding: 20, marginBottom: 16 },
    sectionTitle: { fontSize: 15, fontWeight: 'bold', color: '#555', marginBottom: 15, textTransform: 'uppercase' },
    infoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    infoText: { marginLeft: 15, fontSize: 16, color: '#444' },
    statusContainer: { marginBottom: 15 },
    statusBadge: { paddingHorizontal: 15, paddingVertical: 6, borderRadius: 20, alignSelf: 'flex-start' },
    statusText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
    instr: { fontSize: 13, color: '#888', marginBottom: 12 },
    buttonRow: { flexDirection: 'row', justifyContent: 'space-between' },
    btn: { flex: 1, padding: 12, borderRadius: 8, alignItems: 'center', marginHorizontal: 4 },
    approveBtn: { backgroundColor: '#1cc88a' },
    suspendBtn: { backgroundColor: '#e74a3b' },
    rejectBtn: { backgroundColor: '#f6c23e' },
    btnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
    noteInput: {
        minHeight: 90,
        borderWidth: 1,
        borderColor: '#dbe2ea',
        borderRadius: 10,
        padding: 12,
        textAlignVertical: 'top',
        color: '#334155',
        backgroundColor: '#f8fafc',
    },
    noteCard: {
        backgroundColor: '#f8fafc',
        borderRadius: 10,
        padding: 12,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#e2e8f0',
    },
    noteText: {
        color: '#334155',
        fontSize: 14,
        marginBottom: 4,
    },
    noteMeta: {
        color: '#64748b',
        fontSize: 12,
        textTransform: 'uppercase',
        fontWeight: '700',
    }
});
