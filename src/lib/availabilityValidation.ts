export type Slot = { time: string; available: boolean };

export const isValidTime = (time: string): boolean => {
  if (!/^\d{2}:\d{2}$/.test(time)) return false;
  const [h, m] = time.split(':').map(Number);
  return h >= 0 && h <= 23 && (m === 0 || m === 30);
};

export const isFutureOrToday = (date: string): boolean => {
  const today = new Date().toISOString().substring(0, 10);
  return date >= today;
};

export const findBookedSlotConflict = (
  incomingSlots: Slot[],
  existingSlots: Slot[],
): string | null => {
  const bookedTimes = new Set(existingSlots.filter((s) => !s.available).map((s) => s.time));
  for (const slot of incomingSlots) {
    if (bookedTimes.has(slot.time)) return slot.time;
  }
  return null;
};
