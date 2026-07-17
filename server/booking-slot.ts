export function bookingSlotTimestamp(slotIso: string): number {
  return new Date(slotIso).valueOf();
}
