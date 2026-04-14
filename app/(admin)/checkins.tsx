import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { subscribeAdminCheckIns, CheckIn, CheckInFilters } from '../../services/CheckInService';
import { isAdmin } from '../../services/ModerationService';
import { formatTimestamp } from '../../lib/dateUtils';

const C = {
  bg: '#f0f4f8', card: '#ffffff', border: '#e2e8f0',
  text: '#1e293b', subtext: '#64748b', muted: '#94a3b8',
  blue: '#2563eb', blueLight: '#eff6ff',
  green: '#16a34a', greenLight: '#f0fdf4',
  amber: '#d97706', amberLight: '#fffbeb',
};

const FilterChip = ({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) => (
  <TouchableOpacity style={[S.filterChip, active && S.filterChipActive]} onPress={onPress} activeOpacity={0.8}>
    <Text style={[S.filterChipText, active && S.filterChipTextActive]}>{label}</Text>
  </TouchableOpacity>
);

export default function AdminCheckInsScreen() {
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [loading, setLoading] = useState(true);
  const [todayOnly, setTodayOnly] = useState(false);
  const [locationFilter, setLocationFilter] = useState<'academy' | 'clinic' | null>(null);
  const [isUserAdmin, setIsUserAdmin] = useState(false);
  const router = useRouter();

  useEffect(() => {
    checkAdminAccess();
  }, []);

  useEffect(() => {
    if (!isUserAdmin) return;

    setLoading(true);
    const filters: CheckInFilters = {
      todayOnly: todayOnly || undefined,
      locationRole: locationFilter || undefined,
    };

    const unsubscribe = subscribeAdminCheckIns(filters, (checkInsData) => {
      setCheckIns(checkInsData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [todayOnly, locationFilter, isUserAdmin]);

  const checkAdminAccess = async () => {
    try {
      const admin = await isAdmin();
      setIsUserAdmin(admin);
      if (!admin) {
        Alert.alert('Access Denied', 'You must be an admin to access this screen.');
        router.back();
      }
    } catch (error) {
      console.error('Error checking admin status:', error);
      Alert.alert('Error', 'Failed to verify permissions');
      router.back();
    }
  };

  const formatDate = (timestamp: unknown) =>
    formatTimestamp(timestamp, { withTime: true, fallback: 'Unknown' });

  const counts = useMemo(() => {
    const academy = checkIns.filter((x) => x.locationRole === 'academy').length;
    const clinic = checkIns.filter((x) => x.locationRole === 'clinic').length;
    return { total: checkIns.length, academy, clinic };
  }, [checkIns]);

  const renderItem = ({ item }: { item: CheckIn }) => {
    const isAcademy = item.locationRole === 'academy';
    const accent = isAcademy ? C.blue : C.green;

    return (
      <View style={S.card}>
        <View style={[S.cardAccent, { backgroundColor: accent }]} />
        <View style={S.cardHeader}>
          <View style={S.personBlock}>
            <View style={[S.iconCircle, { backgroundColor: (isAcademy ? C.blueLight : C.greenLight) }]}>
              <Ionicons
                name={isAcademy ? 'school' : 'medkit'}
                size={18}
                color={accent}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={S.userName} numberOfLines={1}>
                {item.userName || `User ${item.userId.substring(0, 8)}`}
              </Text>
              <Text style={S.userRole}>{item.userRole === 'player' ? 'Player' : 'Parent'}</Text>
            </View>
          </View>
          <View style={[S.badge, { backgroundColor: isAcademy ? C.blueLight : C.greenLight }]}>
            <Text style={[S.badgeText, { color: accent }]}>{isAcademy ? 'Academy' : 'Clinic'}</Text>
          </View>
        </View>

        <View style={S.details}>
          <View style={S.detailRow}>
            <Ionicons name="location-outline" size={15} color={C.subtext} />
            <Text style={S.detailText}>{item.locationName || `Location ${item.locationId.substring(0, 8)}`}</Text>
          </View>
          <View style={S.detailRow}>
            <Ionicons name="time-outline" size={15} color={C.subtext} />
            <Text style={S.detailText}>{formatDate(item.createdAt)}</Text>
          </View>
          <View style={S.detailRow}>
            <Ionicons name="qr-code-outline" size={15} color={C.subtext} />
            <Text style={S.codeText}>{item.userCheckInCode}</Text>
          </View>
        </View>
      </View>
    );
  };

  if (!isUserAdmin) {
    return (
      <View style={S.container}>
        <View style={S.center}>
          <ActivityIndicator size="large" color={C.blue} />
          <Text style={S.loadingText}>Checking permissions...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={S.container}>
      <View style={S.header}>
        <Text style={S.headerTitle}>Check-ins</Text>
        <Text style={S.headerSub}>Track all check-ins across academies and clinics</Text>
      </View>

      <View style={S.summaryRow}>
        <View style={S.summaryCard}>
          <Text style={S.summaryLabel}>Total</Text>
          <Text style={S.summaryValue}>{counts.total}</Text>
        </View>
        <View style={S.summaryCard}>
          <Text style={S.summaryLabel}>Academy</Text>
          <Text style={[S.summaryValue, { color: C.blue }]}>{counts.academy}</Text>
        </View>
        <View style={S.summaryCard}>
          <Text style={S.summaryLabel}>Clinic</Text>
          <Text style={[S.summaryValue, { color: C.green }]}>{counts.clinic}</Text>
        </View>
      </View>

      <View style={S.filters}>
        <FilterChip label="Today Only" active={todayOnly} onPress={() => setTodayOnly(!todayOnly)} />
        <FilterChip label="Academy" active={locationFilter === 'academy'} onPress={() => setLocationFilter(locationFilter === 'academy' ? null : 'academy')} />
        <FilterChip label="Clinic" active={locationFilter === 'clinic'} onPress={() => setLocationFilter(locationFilter === 'clinic' ? null : 'clinic')} />
      </View>

      {loading ? (
        <View style={S.center}>
          <ActivityIndicator size="large" color={C.blue} />
          <Text style={S.loadingText}>Loading check-ins...</Text>
        </View>
      ) : checkIns.length === 0 ? (
        <View style={S.center}>
          <View style={S.emptyIcon}>
            <Ionicons name="qr-code-outline" size={32} color={C.muted} />
          </View>
          <Text style={S.emptyTitle}>No check-ins found</Text>
          <Text style={S.emptySub}>Try turning off filters to view more records.</Text>
        </View>
      ) : (
        <FlatList
          data={checkIns}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={S.list}
        />
      )}
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 16, paddingTop: 56, paddingBottom: 10 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: C.text },
  headerSub: { fontSize: 13, color: C.subtext, marginTop: 2 },

  summaryRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 10 },
  summaryCard: {
    flex: 1,
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  summaryLabel: { fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryValue: { fontSize: 18, fontWeight: '800', color: C.text, marginTop: 2 },

  filters: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 6 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  filterChipActive: {
    backgroundColor: C.text,
    borderColor: C.text,
  },
  filterChipText: { fontSize: 12, color: C.subtext, fontWeight: '700' },
  filterChipTextActive: { color: '#fff' },

  list: { padding: 16, paddingBottom: 30 },
  card: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 10,
    overflow: 'hidden',
  },
  cardAccent: { height: 3, width: '100%' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, paddingBottom: 10 },
  personBlock: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  iconCircle: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  userName: { fontSize: 15, fontWeight: '800', color: C.text },
  userRole: { fontSize: 12, color: C.subtext, marginTop: 1 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },

  details: { borderTopWidth: 1, borderTopColor: C.border, padding: 14, gap: 8 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailText: { fontSize: 13, color: C.subtext, flex: 1 },
  codeText: { fontSize: 13, color: C.blue, fontWeight: '700' },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  loadingText: { marginTop: 10, color: C.subtext, fontSize: 14 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.border, justifyContent: 'center', alignItems: 'center' },
  emptyTitle: { marginTop: 12, fontSize: 16, fontWeight: '700', color: C.text },
  emptySub: { marginTop: 4, color: C.subtext, textAlign: 'center' },
});
