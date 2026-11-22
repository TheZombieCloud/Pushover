const DAYS: Record<string, string> = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
  Sun: 'Sunday',
};

export const dayName = (short: string): string => DAYS[short] ?? short;

export const scoreLine = (score: number, foes: number): string =>
  score === foes ? `All ${foes} pushed off` : `${score} of ${foes} pushed off`;
