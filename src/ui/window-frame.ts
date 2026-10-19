/**
 * The window frame AgentEd draws itself, where the build has no native title
 * bar to draw it (#366): Windows, where `tauri.windows.conf.json` turns the
 * system bar off so the header and the title bar become one bar.
 *
 * **It draws only what it is handed controls for.** `ownWindowFrame()` in
 * `src/platform` answers `null` on the web and on a window the system decorates,
 * and then this is never called, so the web build and the Linux lane keep the
 * header they have: no brand, no caption buttons.
 *
 * Three things, all added to the shipped header rather than written into
 * `index.html`, so the markup every target shares stays as it is:
 *
 * - **the brand** at the left: the AgentEd mark at 24 px and the name at 15 px
 *   (candidate B of #363). The mark is drawn transparent inside, its `.md_` in
 *   the text colour of the palette (V2, owner decision on #366), so it reads
 *   on the dark palettes where the PNG icon nearly disappeared;
 * - **the caption buttons** at the right, minimize, maximize and close, 46 px
 *   wide like the system ones. **Out of the Tab order**, as the system ones
 *   are (owner decision): Alt+Space, Alt+F4 and Win+Up or Win+Down reach
 *   every one of them from the keyboard, measured on #365;
 * - **the drag region** on the bar and on every passive part of it. Tauri
 *   reads the attribute on the element under the pointer only, not on its
 *   ancestors, so each passive part carries it. No control ever does: a press
 *   on a control is the control's, and a drag region there would move the
 *   window instead.
 *
 * **On macOS the system draws the buttons over the header** (#615): the title
 * bar is set to the overlay style in `tauri.macos.conf.json`, and
 * `drawOverlayFrame` below leaves room for the buttons at the left, closes it
 * in full screen where they leave, marks the same passive parts, and draws the
 * brand at the right end of the bar, after the last control (owner decision
 * of 2026-10-19 on #615). No caption buttons: the system keeps its own.
 */
import markSvg from '../assets/agented-mark.svg?raw';
import type { TitleBarOverlay, WindowControls } from '../platform';

/** The attribute Tauri starts a window drag from, and a double click maximizes from. */
export const DRAG_REGION = 'data-tauri-drag-region';

/**
 * The passive parts of the header, by id: the readouts and the document name.
 * Each is text that takes no press; a drag from any of them moves the window.
 */
const PASSIVE_IDS = [
  'filename',
  'modified-indicator',
  'header-indicators',
  'count-readout',
  'token-number',
  'token-unit',
  'word-count',
  'char-count',
  'badge-metadata',
] as const;

const CAPTION = [
  {
    label: 'Minimize',
    run: (c: WindowControls) => c.minimize(),
    glyph: '<path d="M1 5.5h8" />',
  },
  {
    label: 'Maximize',
    run: (c: WindowControls) => c.toggleMaximize(),
    glyph: '<rect x="1" y="1" width="8" height="8" />',
  },
  {
    label: 'Close',
    run: (c: WindowControls) => c.close(),
    glyph: '<path d="M1 1l8 8M9 1l-8 8" />',
  },
] as const;

function required(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`the header has no ${selector} to draw the window frame into`);
  return found;
}

function drawBrand(): HTMLElement {
  const brand = document.createElement('span');
  brand.className = 'window-brand';
  const mark = document.createElement('span');
  mark.className = 'window-brand-mark';
  mark.innerHTML = markSvg;
  const name = document.createElement('span');
  name.className = 'window-brand-name';
  name.textContent = 'AgentEd';
  brand.append(mark, name);
  return brand;
}

function drawCaption(controls: WindowControls): HTMLElement {
  const caption = document.createElement('div');
  caption.className = 'window-caption';
  for (const { label, run, glyph } of CAPTION) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `window-caption-button window-caption-${label.toLowerCase()}`;
    button.tabIndex = -1;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = `<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true">${glyph}</svg>`;
    button.addEventListener('click', () => {
      run(controls).catch((e: unknown) => console.error(`[window-frame] ${label} failed:`, e));
    });
    caption.appendChild(button);
  }
  return caption;
}

/** Draw the frame into the shipped header, with the controls the platform handed over. */
export function drawWindowFrame(controls: WindowControls): void {
  const bar = required('#menubar');
  const left = required('#menubar .header-left');
  const right = required('#menubar .header-right');

  const brand = drawBrand();
  left.prepend(brand);
  bar.insertBefore(drawCaption(controls), document.getElementById('menu-dropdown'));
  bar.classList.add('window-frame-own');

  markPassive([bar, left, right, brand, ...brand.children]);
}

/** The drag region on the bar, its groups, the brand and every passive part by id. */
function markPassive(parts: Element[]): void {
  const passive: Array<Element | null> = [
    ...parts,
    ...PASSIVE_IDS.map((id) => document.getElementById(id)),
  ];
  for (const element of passive) element?.setAttribute(DRAG_REGION, '');
}

/**
 * The header under the system buttons of macOS (#615), with the window the
 * platform handed over. The room for the buttons is the stylesheet's, on the
 * class this sets; full screen is read on every resize, since the buttons
 * leave with it and the room closes with them.
 */
export function drawOverlayFrame(overlay: TitleBarOverlay): void {
  const bar = required('#menubar');
  const left = required('#menubar .header-left');
  const right = required('#menubar .header-right');

  const brand = drawBrand();
  right.append(brand);
  bar.classList.add('window-frame-overlay');
  markPassive([bar, left, right, brand, ...brand.children]);

  const follow = (): void => {
    overlay
      .fullscreen()
      .then((fullscreen) => bar.classList.toggle('window-frame-fullscreen', fullscreen))
      .catch((e: unknown) => console.error('[window-frame] full screen was not read:', e));
  };
  follow();
  overlay.onResize(follow);
}
