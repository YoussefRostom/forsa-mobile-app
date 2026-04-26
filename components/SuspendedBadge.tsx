import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import i18n from '../locales/i18n';

type SuspendedBadgeProps = {
  tone?: 'dark' | 'light';
};

export default function SuspendedBadge({ tone = 'dark' }: SuspendedBadgeProps) {
  const isLight = tone === 'light';

  return (
    <View style={[styles.badge, isLight ? styles.badgeLight : styles.badgeDark]}>
      <Text style={[styles.text, isLight ? styles.textLight : styles.textDark]}>
        {i18n.t('suspendedBadge') || 'Suspended'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
  },
  badgeDark: {
    backgroundColor: 'rgba(239, 68, 68, 0.16)',
    borderColor: 'rgba(252, 165, 165, 0.35)',
  },
  badgeLight: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  text: {
    fontSize: 12,
    fontWeight: '800',
  },
  textDark: {
    color: '#fecaca',
  },
  textLight: {
    color: '#b91c1c',
  },
});
