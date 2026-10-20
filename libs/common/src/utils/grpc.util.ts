export const toEpoch = (date: Date): { epochMillis: number } => ({
  epochMillis: date.getTime(),
});
