/** "hoje" / "ontem" / "há N dias" para a lista de condições recentes. */
const DAY_MS = 24 * 60 * 60 * 1000;

export function relativeDayLabel(iso: string, now: Date = new Date()): string {
  const diff = now.getTime() - new Date(iso).getTime();
  const days = Math.floor(diff / DAY_MS);
  if (!Number.isFinite(days) || days < 1) return "hoje";
  if (days === 1) return "ontem";
  return `há ${days} dias`;
}
