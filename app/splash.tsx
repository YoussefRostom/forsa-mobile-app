import React, { useEffect } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

const SplashScreen = () => {
  const router = useRouter();

  useEffect(() => {
    let isMounted = true;
    let welcomeTimer: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!isMounted) return;

      if (welcomeTimer) {
        clearTimeout(welcomeTimer);
        welcomeTimer = null;
      }

      if (user) {
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          const userData = userDoc.exists() ? userDoc.data() : {};
          const role = String(userData?.role || '').toLowerCase();
          const isSuspended = userData?.isSuspended === true || String(userData?.status || '').toLowerCase() === 'suspended';

          if (isSuspended) {
            router.replace('/account-suspended');
            return;
          }

          switch (role) {
            case 'admin':
              router.replace('/(admin)/dashboard');
              return;
            case 'player':
              router.replace('/player-feed');
              return;
            case 'agent':
              router.replace('/agent-feed');
              return;
            case 'academy':
              router.replace('/academy-feed');
              return;
            case 'parent':
              router.replace('/parent-feed');
              return;
            case 'clinic':
              router.replace('/clinic-feed');
              return;
            default:
              router.replace('/player-feed');
              return;
          }
        } catch (error) {
          console.error('Error fetching user role:', error);
          router.replace('/welcome');
          return;
        }
      }

      welcomeTimer = setTimeout(() => {
        if (isMounted) {
          router.replace('/welcome');
        }
      }, 2500);
    });

    return () => {
      isMounted = false;
      if (welcomeTimer) clearTimeout(welcomeTimer);
      unsubscribe();
    };
  }, [router]);

  return (
    <View style={styles.container}>
      <Image
        source={require('../assets/splash.jpg')}
        style={styles.fullImage}
        resizeMode="cover"
      />
      {/* Optionally, overlay text here if you want the text to be selectable or accessible */}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff'
  },
  fullImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
});

export default SplashScreen;
