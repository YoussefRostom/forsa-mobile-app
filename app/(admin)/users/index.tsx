import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { collection, getDocs, query, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../../../lib/firebase';

const C = {
    bg: '#f0f4f8', card: '#ffffff', border: '#e2e8f0',
    text: '#1e293b', subtext: '#64748b', muted: '#94a3b8',
    blue: '#2563eb', blueLight: '#eff6ff',
    green: '#16a34a', greenLight: '#f0fdf4',
    amber: '#d97706', amberLight: '#fffbeb',
    red: '#dc2626', redLight: '#fef2f2',
    purple: '#7c3aed', purpleLight: '#f5f3ff',
    teal: '#0d9488', tealLight: '#f0fdfa',
    indigo: '#4338ca', indigoLight: '#eef2ff',
};

const ROLE_META: Record<string, { color: string; bg: string; icon: string }> = {
    player:  { color: C.blue,   bg: C.blueLight,   icon: 'football' },
    academy: { color: C.green,  bg: C.greenLight,  icon: 'school' },
    clinic:  { color: C.teal,   bg: C.tealLight,   icon: 'medkit' },
    agent:   { color: C.purple, bg: C.purpleLight,  icon: 'briefcase' },
    parent:  { color: C.amber,  bg: C.amberLight,  icon: 'people' },
    admin:   { color: C.indigo, bg: C.indigoLight, icon: 'shield' },
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
    active:    { label: 'Active',    color: C.green, bg: C.greenLight },
    pending:   { label: 'Pending',   color: C.amber, bg: C.amberLight },
    suspended: { label: 'Suspended', color: C.red,   bg: C.redLight },
};

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

export default function UsersList() {
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [roleFilter, setRoleFilter] = useState<'all' | 'player' | 'parent' | 'academy' | 'clinic' | 'agent'>('all');
    const router = useRouter();

    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const querySnapshot = await getDocs(collection(db, 'users'));
                const usersList = querySnapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                setUsers(usersList);
            } catch (error) {
                console.error("Error fetching users:", error);
                Alert.alert("Error", "Failed to fetch users");
            } finally {
                setLoading(false);
            }
        };

        fetchUsers();
    }, []);

    const handleDelete = (id: string, name: string) => {
        Alert.alert(
            "Delete User",
            `Are you sure you want to permanently delete "${name}"? This cannot be undone.`,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Delete", style: "destructive", onPress: async () => {
                        try {
                            await deleteDoc(doc(db, 'users', id));
                            setUsers(users.filter(u => u.id !== id));
                        } catch (error) {
                            console.error("Error deleting user:", error);
                            Alert.alert("Error", "Failed to delete user");
                        }
                    }
                }
            ]
        );
    };

    const filteredUsers = useMemo(() => {
        const q = search.trim().toLowerCase();
        return users.filter((item) => {
            const displayName = String(resolveDisplayName(item)).toLowerCase();
            const email = String(item.email || '').toLowerCase();
            const role = String(item.role || '').toLowerCase();
            const matchesQuery = !q || displayName.includes(q) || email.includes(q) || item.id.toLowerCase().includes(q);
            const matchesRole = roleFilter === 'all' || role === roleFilter;
            return matchesQuery && matchesRole;
        });
    }, [users, search, roleFilter]);

    const renderItem = ({ item }: { item: any }) => {
        const displayName = resolveDisplayName(item);
        const role = String(item.role || '').toLowerCase();
        const status = String(item.status || 'active').toLowerCase();
        const roleMeta = ROLE_META[role] || { color: C.muted, bg: '#f1f5f9', icon: 'person' };
        const statusMeta = STATUS_META[status] || STATUS_META['active'];
        const initials = displayName.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase() || '?';

        return (
            <TouchableOpacity
                style={S.userCard}
                onPress={() => router.push(`/(admin)/users/${item.id}`)}
                activeOpacity={0.75}
            >
                {/* Avatar */}
                <View style={[S.avatar, { backgroundColor: roleMeta.bg }]}>
                    <Text style={[S.avatarText, { color: roleMeta.color }]}>{initials}</Text>
                </View>

                {/* Info */}
                <View style={S.userInfo}>
                    <View style={S.nameRow}>
                        <Text style={S.userName} numberOfLines={1}>{displayName}</Text>
                        <View style={[S.statusBadge, { backgroundColor: statusMeta.bg }]}>
                            <Text style={[S.statusText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
                        </View>
                    </View>
                    <Text style={S.userEmail} numberOfLines={1}>{item.email || 'No email'}</Text>
                    <View style={S.roleRow}>
                        <View style={[S.roleIcon, { backgroundColor: roleMeta.bg }]}>
                            <Ionicons name={roleMeta.icon as any} size={11} color={roleMeta.color} />
                        </View>
                        <Text style={[S.roleText, { color: roleMeta.color }]}>
                            {role ? role.charAt(0).toUpperCase() + role.slice(1) : 'No role'}
                        </Text>
                    </View>
                </View>

                {/* Actions */}
                <View style={S.actions}>
                    <TouchableOpacity
                        style={[S.actionBtn, { backgroundColor: C.blueLight }]}
                        onPress={() => router.push(`/(admin)/users/${item.id}`)}
                    >
                        <Ionicons name="eye" size={16} color={C.blue} />
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[S.actionBtn, { backgroundColor: C.redLight }]}
                        onPress={() => handleDelete(item.id, displayName)}
                    >
                        <Ionicons name="trash" size={16} color={C.red} />
                    </TouchableOpacity>
                </View>
            </TouchableOpacity>
        );
    };

    if (loading) {
        return (
            <View style={S.center}>
                <ActivityIndicator size="large" color={C.blue} />
                <Text style={S.loadingText}>Loading users...</Text>
            </View>
        );
    }

    return (
        <View style={S.container}>
            {/* Search & Filter */}
            <View style={S.filterBox}>
                <View style={S.searchRow}>
                    <Ionicons name="search" size={16} color={C.muted} style={S.searchIcon} />
                    <TextInput
                        style={S.searchInput}
                        value={search}
                        onChangeText={setSearch}
                        placeholder="Search by name, email, or ID"
                        placeholderTextColor={C.muted}
                    />
                    {!!search && (
                        <TouchableOpacity onPress={() => setSearch('')}>
                            <Ionicons name="close-circle" size={18} color={C.muted} />
                        </TouchableOpacity>
                    )}
                </View>
                <View style={S.chipRow}>
                    {[
                        { label: 'All', value: 'all' },
                        { label: 'Players', value: 'player' },
                        { label: 'Parents', value: 'parent' },
                        { label: 'Academies', value: 'academy' },
                        { label: 'Clinics', value: 'clinic' },
                        { label: 'Agents', value: 'agent' },
                    ].map((r) => (
                        <TouchableOpacity
                            key={r.value}
                            style={[S.chip, roleFilter === r.value && S.chipActive]}
                            onPress={() => setRoleFilter(r.value as any)}
                        >
                            <Text style={[S.chipText, roleFilter === r.value && S.chipTextActive]}>{r.label}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
                <Text style={S.resultCount}>
                    Showing {filteredUsers.length} of {users.length} users
                </Text>
            </View>

            <FlatList
                data={filteredUsers}
                keyExtractor={item => item.id}
                renderItem={renderItem}
                contentContainerStyle={S.list}
                ListEmptyComponent={
                    <View style={S.emptyState}>
                        <Ionicons name="people-outline" size={40} color={C.muted} />
                        <Text style={S.emptyTitle}>No users found</Text>
                        <Text style={S.emptyDesc}>Try adjusting your search or filter.</Text>
                    </View>
                }
            />
        </View>
    );
}

const S = StyleSheet.create({
    container:    { flex: 1, backgroundColor: C.bg },
    center:       { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 },
    loadingText:  { color: C.subtext, fontSize: 14 },

    // Filter box
    filterBox:    { backgroundColor: C.card, margin: 12, borderRadius: 14, padding: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 4, elevation: 2 },
    searchRow:    { flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg, borderRadius: 10, paddingHorizontal: 10, borderWidth: 1, borderColor: C.border, marginBottom: 12 },
    searchIcon:   { marginRight: 6 },
    searchInput:  { flex: 1, paddingVertical: 10, fontSize: 14, color: C.text },
    chipRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 10 },
    chip:         { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border },
    chipActive:   { backgroundColor: C.blue, borderColor: C.blue },
    chipText:     { color: C.subtext, fontSize: 12, fontWeight: '600' },
    chipTextActive: { color: '#fff' },
    resultCount:  { fontSize: 12, color: C.muted, fontWeight: '600' },

    // List
    list:         { paddingHorizontal: 12, paddingBottom: 24 },

    // User card
    userCard:     { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 14, padding: 14, marginBottom: 10, gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    avatar:       { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
    avatarText:   { fontSize: 16, fontWeight: '900' },
    userInfo:     { flex: 1, minWidth: 0 },
    nameRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
    userName:     { fontSize: 15, fontWeight: '700', color: C.text, flex: 1 },
    statusBadge:  { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
    statusText:   { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.3 },
    userEmail:    { fontSize: 12, color: C.subtext, marginBottom: 5 },
    roleRow:      { flexDirection: 'row', alignItems: 'center', gap: 5 },
    roleIcon:     { width: 18, height: 18, borderRadius: 5, justifyContent: 'center', alignItems: 'center' },
    roleText:     { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
    actions:      { flexDirection: 'column', gap: 6 },
    actionBtn:    { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },

    // Empty state
    emptyState:   { alignItems: 'center', paddingVertical: 48, gap: 8 },
    emptyTitle:   { fontSize: 16, fontWeight: '700', color: C.text },
    emptyDesc:    { fontSize: 13, color: C.subtext },
});

