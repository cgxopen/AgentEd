/**
 * Paste route instrumentation — **diagnostic build only, never merged.**
 *
 * Four paste routes on Windows produced four different results (#32/#35), and
 * three competing explanations each predicted a different subset of them. This
 * records what actually arrives — keydown, beforeinput, paste, and the state
 * the handler decided from — so one run of the four routes replaces the
 * guessing with a fact.
 *
 * Everything stays in memory: nothing is written to disk (R-C3) and nothing is
 * sent anywhere (Q3, Q5). The buffer is bounded — a paste-heavy session must
 * not grow it without limit.
 */

const MAX_ENTRIES = 300;

const entries: string[] = [];
let firstAt = 0;

/** Fields of an event, rendered as `key=value` in the order given. */
export type DiagnosticFields = Record<string, string | number | boolean>;

function stamp(now: number): string {
  if (firstAt === 0) firstAt = now;
  const seconds = (now - firstAt) / 1000;
  return `+${seconds.toFixed(3)}s`;
}

function renderValue(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'string') return value === '' ? '""' : value;
  return String(value);
}

/** Append one line. Oldest lines fall off the front once the cap is reached. */
export function recordDiagnostic(kind: string, fields: DiagnosticFields, now = Date.now()): void {
  const rendered = Object.entries(fields)
    .map(([key, value]) => `${key}=${renderValue(value)}`)
    .join(' ');
  entries.push(`${stamp(now)} ${kind.padEnd(12)} ${rendered}`);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

/** Marker the tester can drop between routes to keep the log readable. */
export function markDiagnosticRoute(label: string): void {
  recordDiagnostic('---route---', { label });
}

export function diagnosticLines(): readonly string[] {
  return entries;
}

export function formatDiagnostics(): string {
  if (entries.length === 0) return 'No paste activity recorded yet.';
  return entries.join('\n');
}

export function clearDiagnostics(): void {
  entries.length = 0;
  firstAt = 0;
}
