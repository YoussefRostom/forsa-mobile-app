import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { auth } from '../lib/firebase';
import i18n from '../locales/i18n';
import { markOnboardingComplete } from '../services/OnboardingService';

const { width } = Dimensions.get('window');

interface Slide {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconBg: string;
  iconColor: string;
  titleKey: string;
  subtitleKey: string;
}

const ROLE_FEEDS: Record<string, string> = {
  player: '/player-feed',
  parent: '/parent-feed',
  academy: '/academy-feed',
  clinic: '/clinic-feed',
  agent: '/agent-feed',
};

const SLIDES: Record<string, Slide[]> = {
  player: [
    {
      icon: 'trophy-outline',
      iconBg: 'rgba(255,255,255,0.12)',
      iconColor: '#fff',
      titleKey: 'ob_welcome_title',
      subtitleKey: 'ob_player_welcome_sub',
    },
    {
      icon: 'search-outline',
      iconBg: 'rgba(96,165,250,0.18)',
      iconColor: '#93c5fd',
      titleKey: 'ob_player_search_title',
      subtitleKey: 'ob_player_search_sub',
    },
    {
      icon: 'calendar-outline',
      iconBg: 'rgba(52,211,153,0.18)',
      iconColor: '#6ee7b7',
      titleKey: 'ob_player_bookings_title',
      subtitleKey: 'ob_player_bookings_sub',
    },
    {
      icon: 'people-outline',
      iconBg: 'rgba(167,139,250,0.18)',
      iconColor: '#c4b5fd',
      titleKey: 'ob_player_follow_title',
      subtitleKey: 'ob_player_follow_sub',
    },
    {
      icon: 'chatbubbles-outline',
      iconBg: 'rgba(251,191,36,0.18)',
      iconColor: '#fcd34d',
      titleKey: 'ob_messages_title',
      subtitleKey: 'ob_player_messages_sub',
    },
    {
      icon: 'headset-outline',
      iconBg: 'rgba(251,113,133,0.18)',
      iconColor: '#fda4af',
      titleKey: 'ob_contact_title',
      subtitleKey: 'ob_contact_sub',
    },
  ],
  parent: [
    {
      icon: 'trophy-outline',
      iconBg: 'rgba(255,255,255,0.12)',
      iconColor: '#fff',
      titleKey: 'ob_welcome_title',
      subtitleKey: 'ob_parent_welcome_sub',
    },
    {
      icon: 'search-outline',
      iconBg: 'rgba(96,165,250,0.18)',
      iconColor: '#93c5fd',
      titleKey: 'ob_parent_search_title',
      subtitleKey: 'ob_parent_search_sub',
    },
    {
      icon: 'calendar-outline',
      iconBg: 'rgba(52,211,153,0.18)',
      iconColor: '#6ee7b7',
      titleKey: 'ob_parent_bookings_title',
      subtitleKey: 'ob_parent_bookings_sub',
    },
    {
      icon: 'chatbubbles-outline',
      iconBg: 'rgba(251,191,36,0.18)',
      iconColor: '#fcd34d',
      titleKey: 'ob_messages_title',
      subtitleKey: 'ob_parent_messages_sub',
    },
    {
      icon: 'headset-outline',
      iconBg: 'rgba(251,113,133,0.18)',
      iconColor: '#fda4af',
      titleKey: 'ob_contact_title',
      subtitleKey: 'ob_contact_sub',
    },
  ],
  academy: [
    {
      icon: 'trophy-outline',
      iconBg: 'rgba(255,255,255,0.12)',
      iconColor: '#fff',
      titleKey: 'ob_welcome_title',
      subtitleKey: 'ob_academy_welcome_sub',
    },
    {
      icon: 'eye-outline',
      iconBg: 'rgba(96,165,250,0.18)',
      iconColor: '#93c5fd',
      titleKey: 'ob_academy_discover_title',
      subtitleKey: 'ob_academy_discover_sub',
    },
    {
      icon: 'calendar-outline',
      iconBg: 'rgba(52,211,153,0.18)',
      iconColor: '#6ee7b7',
      titleKey: 'ob_academy_bookings_title',
      subtitleKey: 'ob_academy_bookings_sub',
    },
    {
      icon: 'chatbubbles-outline',
      iconBg: 'rgba(251,191,36,0.18)',
      iconColor: '#fcd34d',
      titleKey: 'ob_messages_title',
      subtitleKey: 'ob_academy_messages_sub',
    },
    {
      icon: 'headset-outline',
      iconBg: 'rgba(251,113,133,0.18)',
      iconColor: '#fda4af',
      titleKey: 'ob_contact_title',
      subtitleKey: 'ob_contact_sub',
    },
  ],
  clinic: [
    {
      icon: 'trophy-outline',
      iconBg: 'rgba(255,255,255,0.12)',
      iconColor: '#fff',
      titleKey: 'ob_welcome_title',
      subtitleKey: 'ob_clinic_welcome_sub',
    },
    {
      icon: 'eye-outline',
      iconBg: 'rgba(96,165,250,0.18)',
      iconColor: '#93c5fd',
      titleKey: 'ob_clinic_discover_title',
      subtitleKey: 'ob_clinic_discover_sub',
    },
    {
      icon: 'calendar-outline',
      iconBg: 'rgba(52,211,153,0.18)',
      iconColor: '#6ee7b7',
      titleKey: 'ob_clinic_bookings_title',
      subtitleKey: 'ob_clinic_bookings_sub',
    },
    {
      icon: 'chatbubbles-outline',
      iconBg: 'rgba(251,191,36,0.18)',
      iconColor: '#fcd34d',
      titleKey: 'ob_messages_title',
      subtitleKey: 'ob_clinic_messages_sub',
    },
    {
      icon: 'headset-outline',
      iconBg: 'rgba(251,113,133,0.18)',
      iconColor: '#fda4af',
      titleKey: 'ob_contact_title',
      subtitleKey: 'ob_contact_sub',
    },
  ],
  agent: [
    {
      icon: 'trophy-outline',
      iconBg: 'rgba(255,255,255,0.12)',
      iconColor: '#fff',
      titleKey: 'ob_welcome_title',
      subtitleKey: 'ob_agent_welcome_sub',
    },
    {
      icon: 'people-circle-outline',
      iconBg: 'rgba(96,165,250,0.18)',
      iconColor: '#93c5fd',
      titleKey: 'ob_agent_search_title',
      subtitleKey: 'ob_agent_search_sub',
    },
    {
      icon: 'person-add-outline',
      iconBg: 'rgba(167,139,250,0.18)',
      iconColor: '#c4b5fd',
      titleKey: 'ob_agent_follow_title',
      subtitleKey: 'ob_agent_follow_sub',
    },
    {
      icon: 'chatbubbles-outline',
      iconBg: 'rgba(251,191,36,0.18)',
      iconColor: '#fcd34d',
      titleKey: 'ob_messages_title',
      subtitleKey: 'ob_agent_messages_sub',
    },
    {
      icon: 'headset-outline',
      iconBg: 'rgba(251,113,133,0.18)',
      iconColor: '#fda4af',
      titleKey: 'ob_contact_title',
      subtitleKey: 'ob_contact_sub',
    },
  ],
};

export default function OnboardingScreen() {
  const { role } = useLocalSearchParams<{ role: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const slides = SLIDES[role] ?? SLIDES.player;
  const [currentIndex, setCurrentIndex] = useState(0);
  const slideX = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(1)).current;

  const goTo = (index: number) => {
    Animated.parallel([
      Animated.timing(contentOpacity, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setCurrentIndex(index);
      Animated.parallel([
        Animated.spring(slideX, {
          toValue: -index * width,
          useNativeDriver: true,
          tension: 85,
          friction: 14,
        }),
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    });
  };

  const finish = async () => {
    const uid = auth.currentUser?.uid;
    if (uid) await markOnboardingComplete(uid);
    router.replace((ROLE_FEEDS[role] ?? '/') as any);
  };

  const handleNext = () => {
    if (currentIndex < slides.length - 1) {
      goTo(currentIndex + 1);
    } else {
      finish();
    }
  };

  const isLast = currentIndex === slides.length - 1;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* Skip button */}
      {!isLast && (
        <TouchableOpacity
          style={[styles.skipButton, { top: insets.top + (Platform.OS === 'android' ? 12 : 16) }]}
          onPress={finish}
          activeOpacity={0.7}
        >
          <Text style={styles.skipText}>{i18n.t('ob_skip') || 'Skip'}</Text>
        </TouchableOpacity>
      )}

      {/* Slides strip (clipped) */}
      <View style={styles.slidesWrapper}>
        <Animated.View
          style={[
            styles.strip,
            { width: width * slides.length, transform: [{ translateX: slideX }] },
          ]}
        >
          {slides.map((slide, i) => (
            <Animated.View
              key={i}
              style={[
                styles.slide,
                i === currentIndex ? { opacity: contentOpacity } : { opacity: 1 },
              ]}
            >
              {/* Outer glow ring */}
              <View style={[styles.iconGlow, { backgroundColor: slide.iconBg }]}>
                <View style={[styles.iconInner, { backgroundColor: slide.iconBg }]}>
                  <Ionicons name={slide.icon} size={68} color={slide.iconColor} />
                </View>
              </View>

              <Text style={styles.slideTitle}>{i18n.t(slide.titleKey) || slide.titleKey}</Text>
              <Text style={styles.slideSubtitle}>{i18n.t(slide.subtitleKey) || slide.subtitleKey}</Text>
            </Animated.View>
          ))}
        </Animated.View>
      </View>

      {/* Bottom: dots + button */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 28 }]}>
        <View style={styles.dots}>
          {slides.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === currentIndex ? styles.dotActive : styles.dotInactive,
              ]}
            />
          ))}
        </View>

        <TouchableOpacity
          style={[styles.nextButton, isLast && styles.nextButtonLast]}
          onPress={handleNext}
          activeOpacity={0.85}
        >
          <Text style={styles.nextText}>
            {isLast
              ? i18n.t('ob_getStarted') || 'Get Started'
              : i18n.t('ob_next') || 'Next'}
          </Text>
          {!isLast && (
            <Ionicons name="arrow-forward" size={18} color="#000" style={{ marginLeft: 8 }} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  skipButton: {
    position: 'absolute',
    right: 24,
    zIndex: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  skipText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontWeight: '600',
  },
  slidesWrapper: {
    flex: 1,
    overflow: 'hidden',
  },
  strip: {
    flexDirection: 'row',
    height: '100%',
  },
  slide: {
    width,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
  iconGlow: {
    width: 160,
    height: 160,
    borderRadius: 80,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 48,
  },
  iconInner: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slideTitle: {
    fontSize: 30,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 16,
    letterSpacing: -0.5,
  },
  slideSubtitle: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.65)',
    textAlign: 'center',
    lineHeight: 26,
  },
  bottom: {
    paddingHorizontal: 28,
    paddingTop: 12,
    alignItems: 'center',
    gap: 20,
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    width: 28,
    backgroundColor: '#fff',
  },
  dotInactive: {
    width: 8,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderRadius: 30,
    height: 56,
    width: '100%',
  },
  nextButtonLast: {
    backgroundColor: '#fff',
  },
  nextText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },
});
