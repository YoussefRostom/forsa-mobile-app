type I18nLike = {
  t?: (key: string) => string;
};

const translate = (i18n: I18nLike | undefined, key: string, fallback: string) => {
  try {
    const value = i18n?.t?.(key);
    return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
  } catch {
    return fallback;
  }
};

export function getBookingStatusMeta(status: string | undefined, i18n?: I18nLike) {
  const normalized = String(status || 'pending').toLowerCase();

  switch (normalized) {
    case 'confirmed':
      return {
        label: translate(i18n, 'confirmed', 'Confirmed'),
        color: '#10b981',
        note: 'Your booking is confirmed.',
      };
    case 'player_accepted':
      return {
        label: translate(i18n, 'confirmed', 'Confirmed'),
        color: '#10b981',
        note: 'Your booking is confirmed.',
      };
    case 'player_rejected':
      return {
        label: translate(i18n, 'cancelled', 'Cancelled'),
        color: '#ef4444',
        note: 'This booking has been cancelled.',
      };
    case 'pending':
      return {
        label: translate(i18n, 'pending', 'Pending'),
        color: '#f59e0b',
        note: 'Waiting for confirmation.',
      };
    case 'new_time_proposed':
    case 'timing_proposed':
      return {
        label: translate(i18n, 'newTimeProposed', 'New Time Proposed'),
        color: '#f59e0b',
        note: 'Please accept or reject the new time.',
      };
    case 'cancelled':
      return {
        label: translate(i18n, 'cancelled', 'Cancelled'),
        color: '#ef4444',
        note: 'This booking has been cancelled.',
      };
    case 'completed':
      return {
        label: translate(i18n, 'completed', 'Completed'),
        color: '#0f766e',
        note: 'Service was delivered and check-in was completed.',
      };
    case 'no_show':
      return {
        label: translate(i18n, 'noShow', 'No-show'),
        color: '#9a3412',
        note: 'The customer did not arrive for the booking.',
      };
    case 'refunded':
      return {
        label: translate(i18n, 'refunded', 'Refunded'),
        color: '#7c3aed',
        note: 'This booking was refunded and excluded from payout.',
      };
    case 'failed_payment':
    case 'failed':
      return {
        label: translate(i18n, 'paymentFailed', 'Payment Failed'),
        color: '#6b7280',
        note: 'Payment did not complete successfully.',
      };
    default:
      return {
        label: normalized.replace(/_/g, ' '),
        color: '#666',
        note: '',
      };
  }
}

export function matchesBookingStatusFilter(
  status: string | undefined,
  filter: 'all' | 'confirmed' | 'pending' | 'new_time_proposed' | 'cancelled'
) {
  if (filter === 'all') return true;

  const normalized = String(status || 'pending').toLowerCase();

  // backwards compat: old timing_proposed maps to new_time_proposed tab
  if (filter === 'new_time_proposed') {
    return normalized === 'new_time_proposed' || normalized === 'timing_proposed';
  }

  // backwards compat: old player_accepted (accepted timing) maps to confirmed tab
  if (filter === 'confirmed') {
    return normalized === 'confirmed' || normalized === 'player_accepted';
  }

  // backwards compat: old player_rejected maps to cancelled tab
  if (filter === 'cancelled') {
    return normalized === 'cancelled' || normalized === 'player_rejected';
  }

  return normalized === filter;
}
