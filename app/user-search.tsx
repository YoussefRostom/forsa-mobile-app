import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { collection, getDocs, onSnapshot } from 'firebase/firestore';
import React from 'react';
import { Alert, FlatList, Image, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import FootballLoader from '../components/FootballLoader';
import SuspendedBadge from '../components/SuspendedBadge';
import { auth, db } from '../lib/firebase';
import { resolveUserDisplayName } from '../lib/userDisplayName';
import i18n from '../locales/i18n';
import { toggleFollow } from '../services/FollowService';

type UserSearchResult = {
  id: string;
  name: string;
  role: string;
  city: string;
  photo: string | null;
  searchable: string;
  isSuspended?: boolean;
  status?: string;
};

function getUserPhoto(data: Record<string, any>): string | null {
  const photo = data.profilePhoto || data.profilePic || data.photo || data.avatarUrl;
  return typeof photo === 'string' && photo.length > 0 ? photo : null;
}

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'U';
}

function roleLabel(role: string): string {
  const normalizedRole = String(role || '').toLowerCase();
  if (normalizedRole === 'parent') return i18n.t('parentRoleLabel') || 'Parent';
  if (normalizedRole === 'agent') return i18n.t('agentRoleLabel') || 'Agent';
  return i18n.t('playerRoleLabel') || 'Player';
}

export default function UserSearchScreen() {
  const router = useRouter();
  const { openMenu } = useHamburgerMenu();
  const [queryText, setQueryText] = React.useState('');
  const [users, setUsers] = React.useState<UserSearchResult[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [followStates, setFollowStates] = React.useState<Record<string, boolean>>({});
  const currentUid = auth.currentUser?.uid || '';

  React.useEffect(() => {
    let mounted = true;
    const loadUsers = async () => {
      try {
        const snap = await getDocs(collection(db, 'users'));
        if (!mounted) return;
        const list = snap.docs
          .map((docSnap) => {
            const data = docSnap.data();
            const name = resolveUserDisplayName(data, data.email || docSnap.id);
            const role = String(data.role || 'player').toLowerCase();
            const city = String(data.city || data.district || '');
            const searchable = [
              name,
              data.username,
              data.email,
              data.phone,
              role,
              city,
            ].filter(Boolean).join(' ').toLowerCase();

            return {
              id: docSnap.id,
              name,
              role,
              city,
              photo: getUserPhoto(data),
              searchable,
              isSuspended: data.isSuspended === true || String(data.status || '').toLowerCase() === 'suspended',
              status: data.status || '',
            };
          })
          .filter((entry) => entry.id !== currentUid && ['player', 'user', 'parent'].includes(entry.role))
          .sort((a, b) => a.name.localeCompare(b.name));

        setUsers(list);
      } catch (error) {
        console.warn('[UserSearch] Failed to load users:', error);
        setUsers([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadUsers();
    return () => {
      mounted = false;
    };
  }, [currentUid]);

  React.useEffect(() => {
    if (!currentUid) {
      setFollowStates({});
      return;
    }

    return onSnapshot(
      collection(db, `users/${currentUid}/following`),
      (snap) => {
        const next: Record<string, boolean> = {};
        snap.docs.forEach((docSnap) => {
          next[docSnap.id] = true;
        });
        setFollowStates(next);
      },
      () => setFollowStates({})
    );
  }, [currentUid]);

  const filteredUsers = React.useMemo(() => {
    const needle = queryText.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) => user.searchable.includes(needle));
  }, [queryText, users]);

  const handleToggleFollow = async (user: UserSearchResult) => {
    setFollowStates((prev) => ({ ...prev, [user.id]: !prev[user.id] }));
    try {
      await toggleFollow(user.id, user.role, user.name, user.photo || '');
    } catch (error) {
      setFollowStates((prev) => ({ ...prev, [user.id]: !prev[user.id] }));
      console.error('[UserSearch] Follow toggle failed:', error);
    }
  };

  const handleUserPress = (user: UserSearchResult) => {
    if (user.isSuspended) {
      Alert.alert(
        i18n.t('suspendedBadge') || 'Suspended',
        i18n.t('suspendedUserUnavailable') || 'This profile is suspended and unavailable right now.'
      );
      return;
    }

    router.push({ pathname: '/agent-user-posts', params: { ownerId: user.id, ownerRole: user.role, userName: user.name } });
  };

  const renderUser = ({ item }: { item: UserSearchResult }) => {
    const isFollowing = !!followStates[item.id];

    return (
      <TouchableOpacity
        style={[styles.userRow, item.isSuspended && styles.userRowSuspended]}
        activeOpacity={0.85}
        onPress={() => handleUserPress(item)}
      >
        {item.photo ? (
          <Image source={{ uri: item.photo }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarInitials}>{getInitials(item.name)}</Text>
          </View>
        )}
        <View style={styles.userTextWrap}>
          <Text style={styles.userName} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.userMeta} numberOfLines={1}>
            {roleLabel(item.role)}
            {item.city ? ` - ${item.city}` : ''}
          </Text>
          {item.isSuspended ? (
            <View style={styles.userBadgeWrap}>
              <SuspendedBadge tone="light" />
            </View>
          ) : null}
        </View>
        <TouchableOpacity
          style={[styles.followButton, isFollowing && styles.followButtonActive]}
          onPress={() => !item.isSuspended && handleToggleFollow(item)}
          activeOpacity={0.85}
          disabled={item.isSuspended}
        >
          <Text style={[styles.followButtonText, isFollowing && styles.followButtonTextActive]}>
            {isFollowing ? (i18n.t('following') || 'Following') : (i18n.t('follow') || 'Follow')}
          </Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#000', '#121212', '#1f2937']} style={styles.gradient}>
        <HamburgerMenu />
        <View style={styles.header}>
          <TouchableOpacity style={styles.menuButton} onPress={openMenu}>
            <Ionicons name="menu" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>{i18n.t('search') || 'Search'}</Text>
          <Text style={styles.subtitle}>{i18n.t('searchPlayersHint') || 'Find players to follow.'}</Text>
          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={18} color="#6b7280" />
            <TextInput
              value={queryText}
              onChangeText={setQueryText}
              placeholder={i18n.t('searchPlayersByName') || 'Search players by name or city'}
              placeholderTextColor="#9ca3af"
              style={styles.searchInput}
              autoCapitalize="none"
              returnKeyType="search"
            />
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <FootballLoader size="large" color="#fff" />
          </View>
        ) : (
          <FlatList
            data={filteredUsers}
            renderItem={renderUser}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="people-outline" size={48} color="#6b7280" />
                <Text style={styles.emptyText}>{i18n.t('noPlayersFound') || 'No players found.'}</Text>
              </View>
            }
          />
        )}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  gradient: { flex: 1 },
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : 34,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: { color: '#fff', fontSize: 28, fontWeight: '900' },
  subtitle: { color: 'rgba(255,255,255,0.58)', fontSize: 12, marginTop: 5, lineHeight: 17, fontWeight: '600' },
  searchBox: {
    height: 52,
    borderRadius: 18,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 15,
    marginTop: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 5,
  },
  searchInput: { flex: 1, color: '#111827', fontSize: 15, fontWeight: '600' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 36 },
  userRow: {
    minHeight: 66,
    borderRadius: 14,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    paddingVertical: 9,
    marginBottom: 8,
  },
  userRowSuspended: {
    opacity: 0.86,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#e5e7eb' },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: { color: '#fff', fontSize: 14, fontWeight: '900' },
  userTextWrap: { flex: 1, minWidth: 0, marginHorizontal: 10 },
  userName: { color: '#111827', fontSize: 15, fontWeight: '900' },
  userMeta: { color: '#6b7280', fontSize: 12, fontWeight: '600', marginTop: 3 },
  userBadgeWrap: { marginTop: 8 },
  followButton: {
    minWidth: 78,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  followButtonActive: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#10b981',
  },
  followButtonText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  followButtonTextActive: { color: '#065f46' },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 70 },
  emptyText: { color: '#d1d5db', fontSize: 16, fontWeight: '700', marginTop: 12 },
});
