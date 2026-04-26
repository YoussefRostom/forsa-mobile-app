import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Animated, Platform, StyleSheet, TouchableOpacity } from 'react-native';

interface Props {
  onPress: () => void;
  translateY: Animated.Value;
}

export default function FloatingHamburgerButton({ onPress, translateY }: Props) {
  return (
    <Animated.View style={[styles.container, { transform: [{ translateY }] }]} pointerEvents="box-none">
      <TouchableOpacity style={styles.button} onPress={onPress} activeOpacity={0.85}>
        <Ionicons name="menu" size={24} color="#fff" />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 54 : 34,
    left: 16,
    zIndex: 999,
  },
  button: {
    width: 44,
    height: 44,
    backgroundColor: '#111',
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
  },
});
