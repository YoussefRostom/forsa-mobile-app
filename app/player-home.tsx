import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useRef } from 'react';
import { Animated, Easing, I18nManager, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import i18n from '../locales/i18n';

export default function PlayerHomeScreen() {
  const { openMenu } = useHamburgerMenu();
  const router = useRouter();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [user, setUser] = React.useState<{
    firstName: string;
    lastName: string;
    dob?: string;
    username?: string;
    profilePicture?: string;
    position?: string;
    alternatePositions?: string[];
    city?: string;
    age?: string | number;
    email?: string;
  } | null>(null);

  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  React.useEffect(() => {
    const fetchUser = async () => {
      try {
        const userData = await AsyncStorage.getItem('playerUser');
        if (userData) {
          setUser(JSON.parse(userData));
        }
      } catch {
        setUser(null);
      }
    };
    fetchUser();
  }, []);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient
        colors={['#000000', '#1a1a1a', '#2d2d2d']}
        style={styles.gradient}
      >
      <HamburgerMenu />
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.menuButton} onPress={openMenu}>
              <Ionicons name="menu" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.headerContent}>
              <Text style={styles.headerTitle}>{i18n.t('playerHome') || 'Player Home'}</Text>
              <Text style={styles.headerSubtitle}>{i18n.t('welcomeBack') || 'Welcome back!'}</Text>
            </View>
        </View>

          <ScrollView 
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Welcome Card */}
            <View style={styles.formCard}>
              <View style={styles.welcomeSection}>
                <Ionicons name="person-circle" size={64} color="#000" />
                <Text style={styles.welcomeText}>
                  {user && user.firstName 
                    ? i18n.t('welcomePlayer', { name: user.firstName + (user.lastName ? ' ' + user.lastName : '') }) 
                    : i18n.t('welcomePlayer', { name: 'Player' })}
        </Text>
              </View>

              {/* Action Buttons */}
              <TouchableOpacity 
                style={styles.actionButton} 
                onPress={() => router.push('/player-profile')}
                activeOpacity={0.8}
              >
                <Ionicons name="create-outline" size={20} color="#fff" style={styles.buttonIcon} />
                <Text style={styles.actionButtonText}>{i18n.t('myProfile') || 'My Profile'}</Text>
        </TouchableOpacity>

              <TouchableOpacity 
                style={styles.actionButton} 
                onPress={() => router.push('/player-upload-media')}
                activeOpacity={0.8}
              >
                <Ionicons name="cloud-upload-outline" size={20} color="#fff" style={styles.buttonIcon} />
                <Text style={styles.actionButtonText}>{i18n.t('openUpload') || 'Upload Media'}</Text>
        </TouchableOpacity>

              {/* Language Switcher */}
              <View style={styles.langSection}>
                <Text style={styles.langLabel}>{i18n.t('selectLanguage') || 'Select Language'}</Text>
        <View style={styles.langSwitchRow}>
                  <TouchableOpacity 
                    onPress={async () => { 
            i18n.locale = 'en';
            await AsyncStorage.setItem('appLang', 'en');
            I18nManager.forceRTL(false);
            I18nManager.swapLeftAndRightInRTL(false);
            setTimeout(() => {
              router.replace('/player-home');
            }, 100);
                    }} 
                    style={[styles.langButton, i18n.locale === 'en' && styles.langButtonActive]}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.langButtonText, i18n.locale === 'en' && styles.langButtonTextActive]}>English</Text>
          </TouchableOpacity>
                  <TouchableOpacity 
                    onPress={async () => { 
            i18n.locale = 'ar';
            await AsyncStorage.setItem('appLang', 'ar');
            I18nManager.forceRTL(true);
            I18nManager.swapLeftAndRightInRTL(true);
            setTimeout(() => {
              router.replace('/player-home');
            }, 100);
                    }} 
                    style={[styles.langButton, i18n.locale === 'ar' && styles.langButtonActive]}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.langButtonText, i18n.locale === 'ar' && styles.langButtonTextActive]}>العربية</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
          </ScrollView>
        </Animated.View>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerContent: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  formCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  welcomeSection: {
    alignItems: 'center',
    marginBottom: 32,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  welcomeText: {
    fontSize: 20,
    color: '#000',
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 16,
  },
  actionButton: {
    backgroundColor: '#000',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonIcon: {
    marginRight: 8,
  },
  actionButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 18,
    letterSpacing: 0.5,
  },
  langSection: {
    marginTop: 24,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  langLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 16,
    textAlign: 'center',
  },
  langSwitchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  langButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: '#f5f5f5',
    borderWidth: 2,
    borderColor: '#e0e0e0',
    minWidth: 100,
    alignItems: 'center',
  },
  langButtonActive: {
    backgroundColor: '#000',
    borderColor: '#000',
  },
  langButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '600',
  },
  langButtonTextActive: {
    color: '#fff',
  },
});
