/**
 * #786 - the width of the files panel, dragged at its edge, held between the
 * least and the most of the window, remembered, given way to a small window.
 * happy-dom does no layout, so the module keeps the width it applied rather
 * than measuring it, and the window is stood in for; what is drawn on screen
 * (the rows, the toolbar over the selection, the panel to the pixel) is
 * measured in Chromium on the pull request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { createEditor } from '../editor/setup';
import { loadSidebarWidth, SIDEBAR_WIDTH_KEY, saveSidebarWidth } from '../preferences';
import stylesheet from '../styles.css?raw';
import { shippedElement } from '../test-support/shipped-markup';
import { stylesheetRules } from '../test-support/stylesheet-rules';
import {
  BESIDE_THE_TEXT,
  KEY_STEP,
  KEY_STEP_WITH_SHIFT,
  maxSidebarWidth,
  SIDEBAR_EDGE_LABEL,
  SIDEBAR_MIN_WIDTH,
  type SidebarWidth,
  setupSidebarWidth,
  TEXT_MIN_WIDTH,
} from './sidebar-width';
import moduleSource from './sidebar-width.ts?raw';

let windowWidth: number;
let saved: number[];
let current: SidebarWidth | null;

const panel = () => document.getElementById('sidebar') as HTMLElement;
const edge = () => panel().querySelector('.sidebar-resize') as HTMLElement;

function setup(load: () => number | null = () => null, onApplied?: () => void): SidebarWidth {
  current = setupSidebarWidth(panel(), {
    load,
    save: (w) => saved.push(w),
    windowWidth: () => windowWidth,
    onApplied,
  });
  return current;
}

function pointer(type: string, clientX: number): void {
  edge().dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX }),
  );
}

/** A drag of the edge from `from` to `to`, in clientX, released there. */
function dragEdge(from: number, to: number): void {
  pointer('pointerdown', from);
  pointer('pointermove', (from + to) / 2);
  pointer('pointermove', to);
  pointer('pointerup', to);
}

function key(k: string, shiftKey = false): void {
  edge().dispatchEvent(
    new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }),
  );
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = shippedElement(shippedPage, '<aside id="sidebar"');
  windowWidth = 1440;
  saved = [];
  current = null;
});

afterEach(() => {
  current?.dispose();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('the figures, each a named constant (owner decision of 2026-11-24)', () => {
  it('220 least, 480 of text, half the window, steps of 16 and 64', () => {
    expect([SIDEBAR_MIN_WIDTH, TEXT_MIN_WIDTH, KEY_STEP, KEY_STEP_WITH_SHIFT]).toEqual([
      220, 480, 16, 64,
    ]);
  });

  it('the 88 px beside the text are the margin of the panel and the two sides of the editor, as the stylesheet draws them', () => {
    const rules = stylesheetRules(stylesheet).filter((r) => r.conditions.length === 0);
    const px = (v: string) => v.split(/\s+/).map((x) => Number.parseFloat(x));
    const margin = px(
      rules.find((r) => r.selector === '#sidebar')?.declarations.get('margin') ?? '',
    );
    const padding = px(
      rules.find((r) => r.selector === '#editor')?.declarations.get('padding') ?? '',
    );
    // margin: top right bottom left; padding: top, left and right, bottom.
    const panelSides = margin[1] + margin[3];
    const editorSides = padding[1] * 2;
    expect(panelSides + editorSides).toBe(BESIDE_THE_TEXT);
    expect(BESIDE_THE_TEXT).toBe(88);
  });
});

describe('the drag (#786)', () => {
  it('row 1: a drag of the edge widens the panel, and the width holds at release', () => {
    setup();
    dragEdge(1000, 800);
    expect(panel().style.width).toBe('420px');
    expect(saved).toEqual([420]);
    expect(edge().classList.contains('dragging')).toBe(false);
  });

  it('row 2: the width never goes under 220, whatever the drag', () => {
    setup(() => 400);
    dragEdge(800, 1400);
    expect(panel().style.width).toBe('220px');
    expect(saved).toEqual([220]);
  });

  it('row 3: the most at 600, 1024, 1440 and 1920 is 220, 456, 720 and 960, and a drag past it stops there', () => {
    expect([600, 1024, 1440, 1920].map(maxSidebarWidth)).toEqual([220, 456, 720, 960]);
    windowWidth = 1024;
    setup();
    dragEdge(900, 0);
    expect(panel().style.width).toBe('456px');
    expect(saved).toEqual([456]);
  });

  it('row 13: a drag ended by the capture lost or by the window losing focus leaves no drag in progress', () => {
    setup();
    pointer('pointerdown', 1000);
    pointer('pointermove', 900);
    edge().dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1 }));
    expect(edge().classList.contains('dragging')).toBe(false);
    expect(saved).toEqual([320]);
    pointer('pointermove', 700);
    expect(panel().style.width).toBe('320px');
    pointer('pointerdown', 1000);
    pointer('pointermove', 950);
    window.dispatchEvent(new Event('blur'));
    expect(edge().classList.contains('dragging')).toBe(false);
    expect(saved).toEqual([320, 370]);
    pointer('pointermove', 600);
    expect(panel().style.width).toBe('370px');
  });

  it('row 8: a double click on the edge returns to 220 and writes it', () => {
    setup(() => 500);
    edge().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(panel().style.width).toBe('220px');
    expect(saved).toEqual([220]);
  });
});

describe('the keys (#786)', () => {
  it('row 9: Left and Right by 16, with Shift by 64, Home to 220, End to the most, within bounds, each written', () => {
    setup(() => 300);
    key('ArrowLeft');
    key('ArrowLeft', true);
    key('ArrowRight');
    key('ArrowRight', true);
    key('End');
    key('ArrowLeft');
    key('Home');
    key('ArrowRight');
    expect(saved).toEqual([316, 380, 364, 300, 720, 720, 220, 220]);
  });

  it('row 10: the edge is a separator with its label, its orientation and its three values, which follow the width and the window', () => {
    setup(() => 400);
    const e = edge();
    expect(e.getAttribute('role')).toBe('separator');
    expect(e.getAttribute('aria-orientation')).toBe('vertical');
    expect(e.getAttribute('aria-label')).toBe(SIDEBAR_EDGE_LABEL);
    expect(e.tabIndex).toBe(0);
    expect([
      e.getAttribute('aria-valuemin'),
      e.getAttribute('aria-valuemax'),
      e.getAttribute('aria-valuenow'),
    ]).toEqual(['220', '720', '400']);
    key('ArrowLeft');
    expect(e.getAttribute('aria-valuenow')).toBe('416');
    windowWidth = 900;
    window.dispatchEvent(new Event('resize'));
    expect([e.getAttribute('aria-valuemax'), e.getAttribute('aria-valuenow')]).toEqual([
      '332',
      '332',
    ]);
  });
});

describe('what is remembered, and the window (#786)', () => {
  it('row 4: the chosen width is written at release under its key, and a new start reads it', () => {
    current = setupSidebarWidth(panel(), {
      load: loadSidebarWidth,
      save: saveSidebarWidth,
      windowWidth: () => windowWidth,
    });
    dragEdge(1000, 800);
    expect(localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe('420');
    expect(SIDEBAR_WIDTH_KEY).toBe('agented:sidebar-width');
    current.dispose();
    current = setupSidebarWidth(panel(), {
      load: loadSidebarWidth,
      save: saveSidebarWidth,
      windowWidth: () => windowWidth,
    });
    expect(panel().style.width).toBe('420px');
  });

  it('row 5: nothing stored, not a number, under 220: 220; above the most: shown at the most, the stored value kept', () => {
    for (const stored of [null, 'wide', '12px', '120']) {
      if (stored === null) localStorage.removeItem(SIDEBAR_WIDTH_KEY);
      else localStorage.setItem(SIDEBAR_WIDTH_KEY, stored);
      const w = setupSidebarWidth(panel(), {
        load: loadSidebarWidth,
        save: saveSidebarWidth,
        windowWidth: () => windowWidth,
      });
      expect(panel().style.width, String(stored)).toBe('220px');
      w.dispose();
    }
    localStorage.setItem(SIDEBAR_WIDTH_KEY, '5000');
    current = setupSidebarWidth(panel(), {
      load: loadSidebarWidth,
      save: saveSidebarWidth,
      windowWidth: () => windowWidth,
    });
    expect(panel().style.width).toBe('720px');
    expect(localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe('5000');
  });

  it('row 6: a storage that cannot be read gives 220 and a warning; one that cannot be written leaves the width and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadSidebarWidth()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    current = setupSidebarWidth(panel(), {
      load: loadSidebarWidth,
      save: saveSidebarWidth,
      windowWidth: () => windowWidth,
    });
    expect(panel().style.width).toBe('220px');
    expect(() => dragEdge(1000, 900)).not.toThrow();
    expect(panel().style.width).toBe('320px');
    expect(warn).toHaveBeenCalledTimes(3);
    expect(document.querySelector('.dialog-overlay, #toast-container .toast')).toBeNull();
  });

  it('row 7: the window narrowed gives way as measured, and writes nothing; widened again, the chosen width is back', () => {
    setup(() => 412);
    const shown: number[] = [];
    for (const w of [1440, 1100, 900, 700, 600, 900, 1440]) {
      windowWidth = w;
      window.dispatchEvent(new Event('resize'));
      shown.push(Number.parseInt(panel().style.width, 10));
    }
    expect(shown).toEqual([412, 412, 332, 220, 220, 332, 412]);
    expect(saved).toEqual([]);
  });

  it('one listener of the window, removed with nothing left behind', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const w = setup();
    expect(add.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(1);
    w.dispose();
    current = null;
    expect(remove.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(1);
    expect(panel().querySelector('.sidebar-resize')).toBeNull();
  });

  it('the panel hidden is drawn at the remembered width from its first frame, with no frame at 220', () => {
    panel().classList.add('hidden');
    setup(() => 500);
    expect(panel().style.width).toBe('500px');
    panel().classList.remove('hidden');
    expect(panel().style.width).toBe('500px');
  });
});

describe('what it does not touch (#786)', () => {
  it('row 11: the width is the panel alone: no row of the tree or of the report takes a rule that depends on it', () => {
    setup();
    const tree = document.getElementById('sidebar-tree') as HTMLElement;
    tree.innerHTML =
      '<div class="sidebar-root">x</div><ul class="sidebar-tree-children"><li><div class="sidebar-file-entry">a.md</div></li></ul>';
    const before = tree.outerHTML;
    dragEdge(1000, 700);
    expect(tree.outerHTML).toBe(before);
    expect(stylesheet).not.toMatch(/@container/);
  });

  it('row 12: the floating toolbar is asked to place itself again after the width is applied, once a frame', () => {
    vi.useFakeTimers();
    const reposition = vi.fn();
    setup(() => null, reposition);
    vi.advanceTimersToNextFrame();
    reposition.mockClear();
    pointer('pointerdown', 1000);
    pointer('pointermove', 990);
    pointer('pointermove', 980);
    pointer('pointermove', 970);
    vi.advanceTimersToNextFrame();
    expect(reposition).toHaveBeenCalledTimes(1);
    pointer('pointerup', 970);
    vi.useRealTimers();
  });

  it('a drag does not change the document: no transaction, the selection and the markdown as they were', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const instance = createEditor(host);
    instance.setMarkdown('# Notes\n\nOne line to keep.\n');
    instance.editor.commands.setTextSelection({ from: 3, to: 6 });
    const markdown = instance.getMarkdown();
    const selection = instance.editor.state.selection;
    let transactions = 0;
    instance.editor.on('transaction', () => {
      transactions += 1;
    });
    setup();
    dragEdge(1000, 600);
    key('ArrowLeft');
    expect(transactions).toBe(0);
    expect(instance.editor.state.selection.eq(selection)).toBe(true);
    expect(instance.getMarkdown()).toBe(markdown);
    instance.destroy();
  });

  it('row 14, the web build: the module knows no platform, so rows 1, 4 and 5 hold there as they do here', () => {
    expect(moduleSource).not.toMatch(/from '\.\.\/platform/);
    expect(moduleSource).not.toMatch(/isTauri/);
  });
});
