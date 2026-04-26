import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

type Props = {
  uri?: string | null;
  name?: string | null;
  size?: number;
};

const getInitials = (name?: string | null) =>
  String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || '?';

export default function FeedAuthorAvatar({ uri, name, size = 42 }: Props) {
  const initials = getInitials(name);
  const dimensionStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
  } as const;

  if (uri) {
    return <Image source={{ uri }} style={[styles.image, dimensionStyle]} />;
  }

  return (
    <View style={[styles.fallback, dimensionStyle]}>
      <Text style={[styles.initials, { fontSize: Math.max(12, size * 0.33) }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: '#e5e7eb',
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f2937',
  },
  initials: {
    color: '#fff',
    fontWeight: '800',
  },
});
