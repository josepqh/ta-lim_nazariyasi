// Mirrors api/_grading.js: the five-point scale and what each grade is called.
export const PASS_PERCENT = 55;
const LABELS: Record<number, string> = { 5: 'a’lo', 4: 'yaxshi', 3: 'qoniqarli', 2: 'qoniqarsiz' };

// "5 (a’lo) — 92%", or null when there is no grade yet.
export function formatGrade(grade: number | null | undefined, percent: number | null | undefined): string | null {
  if (!grade || percent === null || percent === undefined) return null;
  return `${grade} (${LABELS[grade] ?? ''}) — ${percent}%`;
}

export const WAITING_LABELS: Record<string, string> = { task: 'amaliy topshiriq', refl: 'refleksiya' };
