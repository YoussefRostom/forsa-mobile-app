import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface BookingCountdownProps {
  date?: string;
  time?: string;
}

function parseBookingDateTime(date?: string, time?: string): Date | null {
  if (!date) return null;

  // date is expected as YYYY-MM-DD or DD/MM/YYYY
  let dateStr = date;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
    const [d, m, y] = date.split('/');
    dateStr = `${y}-${m}-${d}`;
  }

  let timeStr = '00:00';
  if (time) {
    // Handle "10:00 AM", "2:30 PM", "14:30", "09:00"
    const ampm = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(time);
    if (ampm) {
      let hours = parseInt(ampm[1], 10);
      const minutes = ampm[2];
      const period = ampm[3].toUpperCase();
      if (period === 'PM' && hours !== 12) hours += 12;
      if (period === 'AM' && hours === 12) hours = 0;
      timeStr = `${String(hours).padStart(2, '0')}:${minutes}`;
    } else if (/^\d{1,2}:\d{2}$/.test(time.trim())) {
      timeStr = time.trim();
    }
  }

  const dt = new Date(`${dateStr}T${timeStr}:00`);
  return isNaN(dt.getTime()) ? null : dt;
}

function formatCountdown(target: Date): string | null {
  const now = Date.now();
  const diff = target.getTime() - now;

  if (diff <= 0) return null;

  const totalMinutes = Math.floor(diff / 60000);
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);

  if (days >= 7) return null; // too far, no countdown needed
  if (days >= 2) return `in ${days} days`;
  if (days === 1) return 'tomorrow';
  if (totalHours >= 1) {
    const remainingMinutes = totalMinutes % 60;
    return remainingMinutes > 0
      ? `in ${totalHours}h ${remainingMinutes}m`
      : `in ${totalHours}h`;
  }
  if (totalMinutes >= 1) return `in ${totalMinutes}m`;
  return 'starting now';
}

export default function BookingCountdown({ date, time }: BookingCountdownProps) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const target = parseBookingDateTime(date, time);
    if (!target) return;

    const update = () => setLabel(formatCountdown(target));
    update();

    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [date, time]);

  if (!label) return null;

  return (
    <View style={styles.container}>
      <Ionicons name="time-outline" size={13} color="#34d399" />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
    marginBottom: 2,
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
    color: '#34d399',
    letterSpacing: 0.2,
  },
});
