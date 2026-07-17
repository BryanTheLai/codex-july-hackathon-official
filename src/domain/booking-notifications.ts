import { trimOrEmpty } from "./shared";
import type {
  Booking,
  BookingNotificationEvent,
  BookingNotificationPreview,
  BookingNotificationPreviewResult,
  Conversation,
  CreateBookingInput,
  UpdateBookingInput,
} from "./types";

function bookingSlot(slotIso: string, language: string): string {
  const locale = language.toLowerCase().includes("mandarin")
    ? "zh-CN"
    : language.toLowerCase().includes("malay")
      ? "ms-MY"
      : "en-MY";
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Kuala_Lumpur",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(slotIso));
}

function englishBookingMessage(event: BookingNotificationEvent, booking: Booking): string {
  const slot = bookingSlot(booking.slotIso, "English");
  if (event === "confirmed") {
    return `Your appointment is confirmed for ${slot} with ${booking.provider}. Reply here if anything is incorrect.`;
  }
  if (event === "request_updated") {
    return `Your appointment request was updated to ${slot} with ${booking.provider}. Reply here if anything is incorrect.`;
  }
  if (event === "request_rejected") {
    return `We could not confirm your requested appointment for ${slot} with ${booking.provider}. Reply here and we will help find another slot.`;
  }
  if (event === "rescheduled") {
    return `Your appointment has been rescheduled to ${slot} with ${booking.provider}. Reply here if this does not work for you.`;
  }
  if (event === "details_updated") {
    return `Your appointment details were updated. You are now booked with ${booking.provider} on ${slot}. Reply here if anything is incorrect.`;
  }
  return `Your appointment on ${slot} with ${booking.provider} has been cancelled. Reply here if you need help booking another time.`;
}

function malayBookingMessage(event: BookingNotificationEvent, booking: Booking): string {
  const slot = bookingSlot(booking.slotIso, "Malay");
  if (event === "confirmed") {
    return `Temu janji anda disahkan pada ${slot} bersama ${booking.provider}. Balas di sini jika ada maklumat yang tidak betul.`;
  }
  if (event === "request_updated") {
    return `Permintaan temu janji anda telah dikemas kini kepada ${slot} bersama ${booking.provider}. Balas di sini jika ada maklumat yang tidak betul.`;
  }
  if (event === "request_rejected") {
    return `Kami tidak dapat mengesahkan temu janji yang diminta pada ${slot} bersama ${booking.provider}. Balas di sini dan kami akan membantu mencari waktu lain.`;
  }
  if (event === "rescheduled") {
    return `Temu janji anda telah dijadualkan semula pada ${slot} bersama ${booking.provider}. Balas di sini jika waktu ini tidak sesuai untuk anda.`;
  }
  if (event === "details_updated") {
    return `Butiran temu janji anda telah dikemas kini. Anda kini dijadualkan bersama ${booking.provider} pada ${slot}. Balas di sini jika ada maklumat yang tidak betul.`;
  }
  return `Temu janji anda pada ${slot} bersama ${booking.provider} telah dibatalkan. Balas di sini jika anda memerlukan bantuan untuk menempah waktu lain.`;
}

function mandarinBookingMessage(event: BookingNotificationEvent, booking: Booking): string {
  const slot = bookingSlot(booking.slotIso, "Mandarin");
  if (event === "confirmed") {
    return `您的预约已确认：${slot}，医生为${booking.provider}。如有任何信息不正确，请在此回复。`;
  }
  if (event === "request_updated") {
    return `您的预约申请已更新为：${slot}，医生为${booking.provider}。如有任何信息不正确，请在此回复。`;
  }
  if (event === "request_rejected") {
    return `我们无法确认您申请的预约：${slot}，医生为${booking.provider}。请在此回复，我们会协助您寻找其他时间。`;
  }
  if (event === "rescheduled") {
    return `您的预约已改期至：${slot}，医生为${booking.provider}。如果该时间不方便，请在此回复。`;
  }
  if (event === "details_updated") {
    return `您的预约信息已更新。您现在预约的是${booking.provider}，时间为${slot}。如有任何信息不正确，请在此回复。`;
  }
  return `您在${slot}与${booking.provider}的预约已取消。如需重新预约，请在此回复。`;
}

export function createBookingNotification(
  conversation: Conversation,
  booking: Booking,
  event: BookingNotificationEvent,
): BookingNotificationPreview {
  const language = conversation.patient.preferredLanguage;
  const english = englishBookingMessage(event, booking);
  if (language.toLowerCase().includes("malay")) {
    return {
      event,
      text: malayBookingMessage(event, booking),
      gloss: english,
      language,
    };
  }
  if (language.toLowerCase().includes("mandarin")) {
    return {
      event,
      text: mandarinBookingMessage(event, booking),
      gloss: english,
      language,
    };
  }
  return { event, text: english, language: "English" };
}

function bookingUpdateEvent(
  booking: Booking,
  next: Pick<Booking, "provider" | "slotIso" | "reason">,
): BookingNotificationEvent | null {
  const slotChanged = booking.slotIso !== next.slotIso;
  const detailsChanged = booking.provider !== next.provider || booking.reason !== next.reason;
  if (!slotChanged && !detailsChanged) {
    return null;
  }
  if (booking.status === "pending") {
    return "request_updated";
  }
  if (slotChanged) {
    return "rescheduled";
  }
  return "details_updated";
}

export function previewBookingNotification(
  conversation: Conversation,
  input: UpdateBookingInput,
): BookingNotificationPreviewResult {
  const booking = conversation.booking;
  if (!booking) {
    return { ok: false, error: "No booking to edit" };
  }
  if (booking.status === "rejected" || booking.status === "cancelled") {
    return { ok: false, error: "Closed booking cannot be edited" };
  }
  if (booking.revision !== input.expectedRevision) {
    return { ok: false, error: "Booking changed before this edit was saved" };
  }

  const provider = trimOrEmpty(input.provider);
  const reason = trimOrEmpty(input.reason);
  const slotIso = trimOrEmpty(input.slotIso);
  if (!provider) {
    return { ok: false, error: "Booking provider cannot be empty" };
  }
  if (!reason) {
    return { ok: false, error: "Booking reason cannot be empty" };
  }
  if (!slotIso || Number.isNaN(Date.parse(slotIso))) {
    return { ok: false, error: "Booking date and time is invalid" };
  }

  const nextBooking = { ...booking, provider, reason, slotIso };
  const event = bookingUpdateEvent(booking, nextBooking);
  if (!event) {
    return { ok: false, error: "Booking details did not change" };
  }
  return {
    ok: true,
    preview: createBookingNotification(conversation, nextBooking, event),
  };
}

export function previewNewBookingNotification(
  conversation: Conversation,
  input: CreateBookingInput,
): BookingNotificationPreviewResult {
  if (
    conversation.booking &&
    conversation.booking.status !== "rejected" &&
    conversation.booking.status !== "cancelled"
  ) {
    return { ok: false, error: "This conversation already has an active booking" };
  }

  const provider = trimOrEmpty(input.provider);
  const reason = trimOrEmpty(input.reason);
  const slotIso = trimOrEmpty(input.slotIso);
  if (!provider) {
    return { ok: false, error: "Booking provider cannot be empty" };
  }
  if (!reason) {
    return { ok: false, error: "Booking reason cannot be empty" };
  }
  if (!slotIso || Number.isNaN(Date.parse(slotIso))) {
    return { ok: false, error: "Booking date and time is invalid" };
  }

  const booking: Booking = {
    provider,
    reason,
    slotIso,
    status: "approved",
    revision: (conversation.booking?.revision ?? 0) + 1,
  };
  return {
    ok: true,
    preview: createBookingNotification(conversation, booking, "confirmed"),
  };
}

export function previewBookingCancellation(
  conversation: Conversation,
): BookingNotificationPreviewResult {
  if (!conversation.booking) {
    return { ok: false, error: "No booking to cancel" };
  }
  if (conversation.booking.status !== "approved") {
    return { ok: false, error: "Only an approved appointment can be cancelled" };
  }
  return {
    ok: true,
    preview: createBookingNotification(conversation, conversation.booking, "cancelled"),
  };
}

export function previewBookingDecision(
  conversation: Conversation,
  decision: "approve" | "reject",
): BookingNotificationPreviewResult {
  if (!conversation.booking) {
    return { ok: false, error: `No booking to ${decision}` };
  }
  if (conversation.booking.status !== "pending") {
    return { ok: false, error: "Booking is not pending" };
  }
  return {
    ok: true,
    preview: createBookingNotification(
      conversation,
      conversation.booking,
      decision === "approve" ? "confirmed" : "request_rejected",
    ),
  };
}
