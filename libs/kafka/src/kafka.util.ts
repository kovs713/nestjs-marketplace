export const parseBrokers = (raw: string): string[] =>
  raw
    .split(',')
    .map((broker) => broker.trim())
    .filter(Boolean);
