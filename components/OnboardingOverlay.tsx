import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import i18n from '../locales/i18n';
import { useOnboarding } from '../context/OnboardingContext';

export default function OnboardingOverlay() {
  const { isActive, currentStep, steps, nextStep, skipOnboarding } = useOnboarding();
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(300)).current;
  const wasActive = useRef(false);

  useEffect(() => {
    if (isActive && !wasActive.current) {
      wasActive.current = true;
      slideAnim.setValue(300);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 70,
        friction: 12,
      }).start();
    } else if (!isActive && wasActive.current) {
      wasActive.current = false;
      Animated.timing(slideAnim, {
        toValue: 300,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;
    Animated.sequence([
      Animated.timing(slideAnim, { toValue: 20, duration: 100, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }),
    ]).start();
  }, [currentStep]);

  if (!isActive || steps.length === 0) return null;

  const step = steps[currentStep];
  if (!step) return null;

  const isLast = currentStep === steps.length - 1;
  const title = i18n.t(step.titleKey) || step.titleKey;
  const desc = i18n.t(step.descKey) || step.descKey;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View
        style={[styles.container, { transform: [{ translateY: slideAnim }] }]}
        pointerEvents="auto"
      >
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.98)']}
          style={styles.gradient}
          pointerEvents="none"
        />
        <View style={[styles.card, { paddingBottom: insets.bottom + (Platform.OS === 'android' ? 16 : 8) }]}>
          {/* Top row: step counter + skip */}
          <View style={styles.topRow}>
            <View style={styles.stepPill}>
              <Text style={styles.stepText}>{currentStep + 1} / {steps.length}</Text>
            </View>
            {!isLast && (
              <TouchableOpacity onPress={skipOnboarding} style={styles.skipBtn} activeOpacity={0.7}>
                <Text style={styles.skipText}>{i18n.t('ob_skip') || 'Skip'}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Title */}
          <Text style={styles.title}>{title}</Text>

          {/* Description */}
          <Text style={styles.desc}>{desc}</Text>

          {/* Bottom row: dots + button */}
          <View style={styles.bottomRow}>
            <View style={styles.dots}>
              {steps.map((_, i) => (
                <View key={i} style={[styles.dot, i === currentStep ? styles.dotActive : styles.dotInactive]} />
              ))}
            </View>
            <TouchableOpacity
              style={[styles.nextBtn, isLast && styles.nextBtnLast]}
              onPress={nextStep}
              activeOpacity={0.85}
            >
              <Text style={styles.nextText}>
                {isLast ? (i18n.t('ob_getStarted') || 'Get Started') : (i18n.t('ob_next') || 'Next')}
              </Text>
              {!isLast && <Ionicons name="arrow-forward" size={16} color="#000" style={{ marginLeft: 6 }} />}
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  gradient: {
    height: 56,
  },
  card: {
    backgroundColor: '#0a0a0a',
    paddingHorizontal: 22,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  stepPill: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
  },
  stepText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '600',
  },
  skipBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  skipText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    fontWeight: '600',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 10,
    letterSpacing: -0.3,
  },
  desc: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 23,
    marginBottom: 20,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  dot: {
    height: 7,
    borderRadius: 4,
  },
  dotActive: {
    width: 22,
    backgroundColor: '#fff',
  },
  dotInactive: {
    width: 7,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 24,
  },
  nextBtnLast: {
    paddingHorizontal: 28,
  },
  nextText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '700',
  },
});
