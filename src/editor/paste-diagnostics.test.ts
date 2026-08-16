import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearDiagnostics,
  diagnosticLines,
  formatDiagnostics,
  markDiagnosticRoute,
  recordDiagnostic,
} from './paste-diagnostics';

beforeEach(() => {
  clearDiagnostics();
});

describe('paste diagnostics buffer', () => {
  it('renders a line per event, timed from the first one', () => {
    recordDiagnostic('keydown', { code: 'KeyV', ctrl: true, shift: false }, 1000);
    recordDiagnostic('paste', { flag: 'none', text: 8 }, 1250);

    const [first, second] = diagnosticLines();
    expect(first).toContain('+0.000s');
    expect(first).toContain('code=KeyV ctrl=1 shift=0');
    expect(second).toContain('+0.250s');
    expect(second).toContain('flag=none text=8');
  });

  it('stays bounded on a paste-heavy session', () => {
    for (let i = 0; i < 500; i++) recordDiagnostic('paste', { i }, 1000 + i);
    expect(diagnosticLines().length).toBe(300);
    // The newest survive, the oldest fall off the front.
    expect(diagnosticLines().at(-1)).toContain('i=499');
    expect(formatDiagnostics()).not.toContain('i=0 ');
  });

  it('marks a route separator the tester can see', () => {
    markDiagnosticRoute('route 1');
    expect(formatDiagnostics()).toContain('---route---');
    expect(formatDiagnostics()).toContain('label=route 1');
  });

  it('says so plainly when nothing has been recorded', () => {
    expect(formatDiagnostics()).toBe('No paste activity recorded yet.');
  });

  it('restarts the clock after a clear', () => {
    recordDiagnostic('paste', {}, 5000);
    clearDiagnostics();
    recordDiagnostic('paste', {}, 9000);
    expect(diagnosticLines()[0]).toContain('+0.000s');
  });
});
