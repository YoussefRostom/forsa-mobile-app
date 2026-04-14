import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useAuth } from '../context/AuthContext';

export default function Index() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      router.replace('/welcome');
      return;
    }

    switch (String(user.role || '').toLowerCase()) {
      case 'admin':
        router.replace('/(admin)/dashboard');
        break;
      case 'parent':
        router.replace('/parent-feed');
        break;
      case 'agent':
        router.replace('/agent-feed');
        break;
      case 'academy':
        router.replace('/academy-feed');
        break;
      case 'clinic':
        router.replace('/clinic-feed');
        break;
      case 'player':
      case 'user':
      default:
        router.replace('/player-feed');
        break;
    }
  }, [user, isLoading, router]);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color="#0000ff" />
    </View>
  );
}
