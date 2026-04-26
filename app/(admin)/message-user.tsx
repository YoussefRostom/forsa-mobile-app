import React, { useEffect, useMemo, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    TextInput,
    FlatList,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { collection, getDocs } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import { subscribeToConversations, Conversation } from '../../services/MessagingService';
import FootballLoader from '../../components/FootballLoader';

const C = {
    bg: '#f0f4f8',
    card: '#ffffff',
    border: '#e2e8f0',
    text: '#1e293b',
    subtext: '#64748b',
    muted: '#94a3b8',
    blue: '#2563eb',
    blueLight: '#eff6ff',
    green: '#16a34a',
    greenLight: '#f0fdf4',
    amber: '#d97706',
    amberLight: '#fffbeb',
    purple: '#7c3aed',
    purpleLight: '#f5f3ff',
    teal: '#0d9488',
    tealLight: '#f0fdfa',
    indigo: '#4338ca',
    indigoLight: '#eef2ff',
    red: '#dc2626',
    redLight: '#fef2f2',
};

const ROLE_META: Record<string, { label: string; color: string; bg: string; icon: string }> = {
    player: { label: 'Players', color: C.blue, bg: C.blueLight, icon: 'football' },
    parent: { label: 'Parents', color: C.amber, bg: C.amberLight, icon: 'people' },
    academy: { label: 'Academies', color: C.green, bg: C.greenLight, icon: 'school' },
    clinic: { label: 'Clinics', color: C.teal, bg: C.tealLight, icon: 'medkit' },
    agent: { label: 'Agents', color: C.purple, bg: C.purpleLight, icon: 'briefcase' },
    admin: { label: 'Admins', color: C.indigo, bg: C.indigoLight, icon: 'shield' },
};

type UserItem = {
    id: string;
    role?: string;
    email?: string;
    phone?: string;
    username?: string;
    displayName?: string;
    name?: string;
    academyName?: string;
    clinicName?: string;
    parentName?: string;
    playerName?: string;
    agentName?: string;
    firstName?: string;
    lastName?: string;
};

const resolveDisplayName = (user: UserItem) => {
    const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();

    return (
        user.username ||
        user.displayName ||
        user.name ||
        user.academyName ||
        user.clinicName ||
        user.parentName ||
        user.playerName ||
        user.agentName ||
        fullName ||
        user.email ||
        user.phone ||
        'Unknown User'
    );
};

const safeRole = (value: string | undefined) => String(value || '').toLowerCase();

export default function AdminMessageUserScreen() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [roleFilter, setRoleFilter] = useState<'all' | 'player' | 'parent' | 'academy' | 'clinic' | 'agent' | 'admin'>('all');
    const [users, setUsers] = useState<UserItem[]>([]);
    const [recentChats, setRecentChats] = useState<Conversation[]>([]);

    const toMillis = (value: any) => {
        if (!value) return 0;
        if (typeof value?.toMillis === 'function') return value.toMillis();
        if (typeof value?.toDate === 'function') return value.toDate().getTime();
        if (typeof value?.seconds === 'number') return value.seconds * 1000;
        const parsed = new Date(value).getTime();
        return Number.isFinite(parsed) ? parsed : 0;
    };

    const formatRecentTime = (ms: number) => {
        if (!ms) return '';
        const date = new Date(ms);
        const now = new Date();
        const sameDay = date.toDateString() === now.toDateString();
        return sameDay
            ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };

    useEffect(() => {
        const loadUsers = async () => {
            setLoading(true);
            try {
                const snap = await getDocs(collection(db, 'users'));
                const currentUid = auth.currentUser?.uid;
                const next = snap.docs
                    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) } as UserItem))
                    .filter((item) => item.id !== currentUid);

                next.sort((a, b) => {
                    const roleA = safeRole(a.role);
                    const roleB = safeRole(b.role);
                    if (roleA !== roleB) return roleA.localeCompare(roleB);
                    return resolveDisplayName(a).localeCompare(resolveDisplayName(b));
                });

                setUsers(next);
            } catch (error) {
                console.error('Error fetching users for messaging:', error);
                setUsers([]);
            } finally {
                setLoading(false);
            }
        };

        void loadUsers();
    }, []);

    useEffect(() => {
        const unsubscribe = subscribeToConversations((conversations) => {
            setRecentChats(conversations.slice(0, 8));
        });

        return () => {
            unsubscribe();
        };
    }, []);

    const roleCounts = useMemo(() => {
        const counts: Record<string, number> = { all: users.length };
        users.forEach((item) => {
            const key = safeRole(item.role) || 'unknown';
            counts[key] = (counts[key] || 0) + 1;
        });
        return counts;
    }, [users]);

    const filteredUsers = useMemo(() => {
        const q = search.trim().toLowerCase();

        return users.filter((item) => {
            const role = safeRole(item.role);
            const name = resolveDisplayName(item).toLowerCase();
            const email = String(item.email || '').toLowerCase();
            const phone = String(item.phone || '').toLowerCase();
            const matchesRole = roleFilter === 'all' || role === roleFilter;
            const matchesSearch =
                !q ||
                name.includes(q) ||
                email.includes(q) ||
                phone.includes(q) ||
                item.id.toLowerCase().includes(q);

            return matchesRole && matchesSearch;
        });
    }, [users, search, roleFilter]);

    const openChat = (item: UserItem) => {
        const name = resolveDisplayName(item);
        router.push(`/(admin)/user-chat?otherUserId=${item.id}&name=${encodeURIComponent(name)}` as any);
    };

    const recentUsers = useMemo(() => {
        const usersById = new Map(users.map((item) => [item.id, item] as const));
        return recentChats
            .map((chat) => {
                const otherUserId = chat.otherParticipantId;
                const user = otherUserId ? usersById.get(otherUserId) : null;
                if (!user) return null;
                return { user, chat };
            })
            .filter(Boolean) as { user: UserItem; chat: Conversation }[];
    }, [users, recentChats]);

    const renderUserRow = ({ item }: { item: UserItem }) => {
        const role = safeRole(item.role);
        const roleMeta = ROLE_META[role] || { label: 'Users', color: C.subtext, bg: '#f8fafc', icon: 'person' };
        const displayName = resolveDisplayName(item);
        const initials = displayName
            .split(' ')
            .filter(Boolean)
            .slice(0, 2)
            .map((word) => word[0])
            .join('')
            .toUpperCase() || '?';

        return (
            <TouchableOpacity style={S.userRow} activeOpacity={0.82} onPress={() => openChat(item)}>
                <View style={[S.avatar, { backgroundColor: roleMeta.bg }]}>
                    <Text style={[S.avatarText, { color: roleMeta.color }]}>{initials}</Text>
                </View>

                <View style={S.userInfo}>
                    <Text style={S.userName} numberOfLines={1}>{displayName}</Text>
                    <Text style={S.userSub} numberOfLines={1}>{item.email || item.phone || item.id}</Text>
                    <View style={[S.roleBadge, { backgroundColor: roleMeta.bg }]}>
                        <Ionicons name={roleMeta.icon as any} size={11} color={roleMeta.color} />
                        <Text style={[S.roleText, { color: roleMeta.color }]}>{roleMeta.label}</Text>
                    </View>
                </View>

                <View style={S.chatHint}>
                    <Ionicons name="chatbubble-ellipses" size={16} color={C.indigo} />
                    <Text style={S.chatHintText}>Chat</Text>
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <View style={S.container}>
            <View style={S.headerCard}>
                <View style={S.headerTop}>
                    <TouchableOpacity style={S.backButton} onPress={() => router.back()}>
                        <Ionicons name="arrow-back" size={20} color={C.text} />
                    </TouchableOpacity>
                    <View style={{ flex: 1 }}>
                        <Text style={S.title}>Message User</Text>
                        <Text style={S.subtitle}>Pick anyone quickly with filters and search</Text>
                    </View>
                </View>

                <View style={S.searchRow}>
                    <Ionicons name="search" size={16} color={C.muted} />
                    <TextInput
                        style={S.searchInput}
                        value={search}
                        onChangeText={setSearch}
                        placeholder="Search name, email, phone, or ID"
                        placeholderTextColor={C.muted}
                    />
                    {!!search && (
                        <TouchableOpacity onPress={() => setSearch('')}>
                            <Ionicons name="close-circle" size={18} color={C.muted} />
                        </TouchableOpacity>
                    )}
                </View>

                <FlatList
                    horizontal
                    data={[
                        { key: 'all', label: 'All' },
                        { key: 'player', label: 'Players' },
                        { key: 'parent', label: 'Parents' },
                        { key: 'academy', label: 'Academies' },
                        { key: 'clinic', label: 'Clinics' },
                        { key: 'agent', label: 'Agents' },
                        { key: 'admin', label: 'Admins' },
                    ]}
                    keyExtractor={(item) => item.key}
                    contentContainerStyle={S.filterRow}
                    showsHorizontalScrollIndicator={false}
                    renderItem={({ item }) => {
                        const selected = roleFilter === (item.key as any);
                        const count = roleCounts[item.key] || 0;
                        return (
                            <TouchableOpacity
                                style={[S.filterChip, selected && S.filterChipActive]}
                                onPress={() => setRoleFilter(item.key as any)}
                            >
                                <Text style={[S.filterChipText, selected && S.filterChipTextActive]}>{item.label}</Text>
                                <View style={[S.filterCount, selected && S.filterCountActive]}>
                                    <Text style={[S.filterCountText, selected && S.filterCountTextActive]}>{count}</Text>
                                </View>
                            </TouchableOpacity>
                        );
                    }}
                />
            </View>

            {loading ? (
                <View style={S.centerState}>
                    <FootballLoader size="large" color={C.blue} />
                    <Text style={S.stateText}>Loading users...</Text>
                </View>
            ) : (
                <>
                    {recentUsers.length > 0 && (
                        <View style={S.recentSection}>
                            <View style={S.recentHeaderRow}>
                                <Text style={S.recentTitle}>Recent Chats</Text>
                                <Text style={S.recentSubtitle}>Tap to continue a conversation</Text>
                            </View>
                            <FlatList
                                horizontal
                                data={recentUsers}
                                keyExtractor={(item) => item.user.id}
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={S.recentListContent}
                                ItemSeparatorComponent={() => <View style={{ width: 10 }} />}
                                renderItem={({ item }) => {
                                    const displayName = resolveDisplayName(item.user);
                                    const initials = displayName
                                        .split(' ')
                                        .filter(Boolean)
                                        .slice(0, 2)
                                        .map((word) => word[0])
                                        .join('')
                                        .toUpperCase() || '?';

                                    return (
                                        <TouchableOpacity style={S.recentCard} onPress={() => openChat(item.user)} activeOpacity={0.82}>
                                            <View style={S.recentAvatar}>
                                                <Text style={S.recentAvatarText}>{initials}</Text>
                                            </View>
                                            <Text style={S.recentName} numberOfLines={1}>{displayName}</Text>
                                            <Text style={S.recentMessage} numberOfLines={1}>
                                                {item.chat.lastMessage || 'Open chat'}
                                            </Text>
                                            <Text style={S.recentTime}>{formatRecentTime(toMillis(item.chat.lastMessageAt || item.chat.createdAt))}</Text>
                                        </TouchableOpacity>
                                    );
                                }}
                            />
                        </View>
                    )}

                    <Text style={S.resultsText}>Showing {filteredUsers.length} user{filteredUsers.length === 1 ? '' : 's'}</Text>
                    <FlatList
                        data={filteredUsers}
                        keyExtractor={(item) => item.id}
                        renderItem={renderUserRow}
                        contentContainerStyle={S.listContent}
                        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                        ListEmptyComponent={
                            <View style={S.centerState}>
                                <Ionicons name="search-outline" size={30} color={C.muted} />
                                <Text style={S.stateTitle}>No users found</Text>
                                <Text style={S.stateText}>Try a different role or search term.</Text>
                            </View>
                        }
                    />
                </>
            )}
        </View>
    );
}

const S = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: C.bg,
        padding: 14,
    },
    headerCard: {
        backgroundColor: C.card,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: C.border,
        padding: 14,
        marginBottom: 10,
    },
    headerTop: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
        gap: 8,
    },
    backButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: C.border,
    },
    title: {
        fontSize: 20,
        fontWeight: '900',
        color: C.text,
    },
    subtitle: {
        marginTop: 2,
        fontSize: 12,
        color: C.subtext,
    },
    searchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: C.border,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 9,
    },
    searchInput: {
        flex: 1,
        fontSize: 14,
        color: C.text,
        paddingVertical: 0,
    },
    filterRow: {
        gap: 8,
        paddingTop: 11,
        paddingBottom: 2,
    },
    filterChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: C.border,
        backgroundColor: '#fff',
        paddingHorizontal: 11,
        paddingVertical: 7,
    },
    filterChipActive: {
        backgroundColor: C.indigoLight,
        borderColor: '#c7d2fe',
    },
    filterChipText: {
        fontSize: 12,
        fontWeight: '700',
        color: C.subtext,
    },
    filterChipTextActive: {
        color: C.indigo,
    },
    filterCount: {
        minWidth: 20,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 10,
        backgroundColor: '#f1f5f9',
        paddingHorizontal: 6,
        paddingVertical: 1,
    },
    filterCountActive: {
        backgroundColor: '#e0e7ff',
    },
    filterCountText: {
        fontSize: 10,
        fontWeight: '800',
        color: C.subtext,
    },
    filterCountTextActive: {
        color: C.indigo,
    },
    resultsText: {
        color: C.subtext,
        fontSize: 12,
        marginBottom: 8,
        marginLeft: 2,
    },
    recentSection: {
        marginBottom: 10,
    },
    recentHeaderRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginBottom: 8,
        paddingHorizontal: 2,
    },
    recentTitle: {
        fontSize: 14,
        fontWeight: '900',
        color: C.text,
    },
    recentSubtitle: {
        fontSize: 11,
        color: C.subtext,
    },
    recentListContent: {
        paddingBottom: 2,
    },
    recentCard: {
        width: 176,
        backgroundColor: C.card,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: C.border,
        padding: 10,
    },
    recentAvatar: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: C.indigoLight,
        marginBottom: 8,
    },
    recentAvatarText: {
        fontWeight: '900',
        color: C.indigo,
    },
    recentName: {
        fontSize: 13,
        fontWeight: '800',
        color: C.text,
    },
    recentMessage: {
        marginTop: 3,
        fontSize: 12,
        color: C.subtext,
    },
    recentTime: {
        marginTop: 7,
        fontSize: 11,
        color: C.muted,
        fontWeight: '700',
    },
    listContent: {
        paddingBottom: 20,
    },
    userRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: C.card,
        borderWidth: 1,
        borderColor: C.border,
        borderRadius: 14,
        padding: 11,
    },
    avatar: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarText: {
        fontSize: 15,
        fontWeight: '900',
    },
    userInfo: {
        flex: 1,
    },
    userName: {
        fontSize: 15,
        fontWeight: '800',
        color: C.text,
    },
    userSub: {
        marginTop: 2,
        fontSize: 12,
        color: C.subtext,
    },
    roleBadge: {
        alignSelf: 'flex-start',
        marginTop: 6,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    roleText: {
        fontSize: 11,
        fontWeight: '700',
    },
    chatHint: {
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#c7d2fe',
        backgroundColor: C.indigoLight,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 8,
        minWidth: 54,
    },
    chatHintText: {
        marginTop: 2,
        fontSize: 11,
        fontWeight: '800',
        color: C.indigo,
    },
    centerState: {
        paddingTop: 56,
        alignItems: 'center',
        justifyContent: 'center',
    },
    stateTitle: {
        marginTop: 8,
        fontSize: 16,
        fontWeight: '800',
        color: C.text,
    },
    stateText: {
        marginTop: 6,
        color: C.subtext,
        fontSize: 13,
        textAlign: 'center',
    },
});
