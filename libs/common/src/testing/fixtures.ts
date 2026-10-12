export const FIXED_DATE = new Date('2026-09-19T08:00:00.000Z');
export const LATER_DATE = new Date(FIXED_DATE.getTime() + 24 * 60 * 60_000);

export const testUuid = (n: number) =>
  `0199eb37-0000-7000-8000-${String(n).padStart(12, '0')}`;
