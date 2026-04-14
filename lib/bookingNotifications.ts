import { createNotification, notifyProviderAndAdmins } from '../services/NotificationService';

const getBookingLabel = (booking: any) => {
  return (
    booking?.service ||
    booking?.program ||
    booking?.providerName ||
    booking?.name ||
    'your booking'
  );
};

const getCustomerUserId = (booking: any) => {
  return booking?.parentId || booking?.playerId || booking?.academyId || booking?.userId || null;
};

export async function notifyBookingStatusChange(params: {
  booking: any;
  nextStatus: string;
  actorId?: string;
  actorLabel?: string;
  proposedDate?: string | null;
  proposedTime?: string | null;
}) {
  const { booking, nextStatus, actorId, actorLabel = 'A user', proposedDate, proposedTime } = params;
  if (!booking?.id) return;

  const bookingLabel = getBookingLabel(booking);
  const providerId = booking?.providerId;
  const customerUserId = getCustomerUserId(booking);

  let title = 'Booking update';
  let providerBody = `${actorLabel} updated the booking for ${bookingLabel}.`;
  let customerBody = `Your booking for ${bookingLabel} was updated.`;

  switch (nextStatus) {
    case 'cancelled':
      title = 'Booking cancelled';
      providerBody = `${actorLabel} cancelled the booking for ${bookingLabel}.`;
      customerBody = `Your booking for ${bookingLabel} has been cancelled.`;
      break;
    case 'new_time_proposed':
      title = 'New time proposed';
      providerBody = `A new time was proposed for ${bookingLabel}${proposedDate ? ` on ${proposedDate}` : ''}${proposedTime ? ` at ${proposedTime}` : ''}.`;
      customerBody = `A new time was proposed for ${bookingLabel}${proposedDate ? ` on ${proposedDate}` : ''}${proposedTime ? ` at ${proposedTime}` : ''}.`;
      break;
    case 'confirmed':
      title = 'Booking confirmed';
      providerBody = `${bookingLabel} is now confirmed.`;
      customerBody = `Your booking for ${bookingLabel} is confirmed.`;
      break;
  }

  try {
    if (providerId) {
      await notifyProviderAndAdmins(
        providerId,
        title,
        providerBody,
        'booking',
        { bookingId: booking.id, status: nextStatus },
        actorId
      );
    }
  } catch (error) {
    console.warn('Provider/admin booking notification failed:', error);
  }

  try {
    if (customerUserId && customerUserId !== actorId) {
      await createNotification({
        userId: customerUserId,
        title,
        body: customerBody,
        type: 'booking',
        data: { bookingId: booking.id, status: nextStatus },
      });
    }
  } catch (error) {
    console.warn('Customer booking notification failed:', error);
  }
}
