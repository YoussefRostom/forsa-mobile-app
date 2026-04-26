import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import FootballLoader from '../../components/FootballLoader';
import { db } from '../../lib/firebase';
import { resolveUserDisplayName } from '../../lib/userDisplayName';

export default function SharedProfileRedirectScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  useEffect(() => {
    let active = true;

    const openProfile = async () => {
      const userId = String(id || '');
      if (!userId) {
        router.replace('/splash');
        return;
      }

      try {
        const userSnap = await getDoc(doc(db, 'users', userId));
        const userData = userSnap.exists() ? userSnap.data() : {};
        const role = String(userData?.role || 'player').toLowerCase();
        const userName = resolveUserDisplayName(userData, userId);

        if (!active) return;

        if (role === 'academy') {
          router.replace({
            pathname: '/academy-details',
            params: { academy: JSON.stringify({ id: userId, name: userName }) },
          });
          return;
        }

        if (role === 'clinic') {
          router.replace({
            pathname: '/clinic-details',
            params: { id: userId },
          });
          return;
        }

        if (role === 'agent') {
          router.replace({
            pathname: '/agent-details',
            params: { id: userId },
          });
          return;
        }

        router.replace({
          pathname: '/agent-user-posts',
          params: {
            ownerId: userId,
            ownerRole: role || 'player',
            userName,
          },
        });
      } catch {
        if (active) {
          router.replace('/splash');
        }
      }
    };

    void openProfile();

    return () => {
      active = false;
    };
  }, [id, router]);

  return (
    <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
      <FootballLoader size="large" color="#fff" />
    </View>
  );
}
