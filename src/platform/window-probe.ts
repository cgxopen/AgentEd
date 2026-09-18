/**
 * PROBE for #363 only - never merged. A window with no native title bar, so
 * the owner can measure on Windows what that costs. Everything is added at
 * run time on the desktop only, so the shipped markup and its tests stay as
 * they are: the brand at candidate B (24 px icon, 15 px name), three caption
 * buttons 46 px wide, and the drag region on the bar and its passive parts.
 * Close goes through `close()`, which raises the close request the
 * unsaved-changes gate listens to (R-C3).
 */
import { getCurrentWindow } from '@tauri-apps/api/window';

const DRAG = 'data-tauri-drag-region';

export function wireProbeCaption(): void {
  const win = getCurrentWindow();
  const bar = document.getElementById('menubar');
  const left = bar?.querySelector('.header-left');
  const right = bar?.querySelector('.header-right');
  if (!bar || !left || !right) throw new Error('probe: no header to fuse');

  const brand = document.createElement('span');
  brand.id = 'probe-brand';
  brand.innerHTML = '<img src="/favicon-96x96.png" alt=""><span>AgentEd</span>';
  left.prepend(brand);

  const caption = document.createElement('div');
  caption.id = 'probe-caption';
  for (const [id, glyph, label] of [
    ['probe-min', '—', 'Minimize'],
    ['probe-max', '□', 'Maximize'],
    ['probe-close', '✕', 'Close'],
  ]) {
    const button = document.createElement('button');
    button.id = id;
    button.type = 'button';
    button.textContent = glyph;
    button.setAttribute('aria-label', label);
    caption.appendChild(button);
  }
  bar.insertBefore(caption, document.getElementById('menu-dropdown'));

  // Tauri starts a drag only when the element under the pointer carries the
  // attribute itself, so every passive part of the bar gets it.
  for (const el of [
    bar,
    left,
    right,
    brand,
    ...brand.children,
    document.getElementById('filename'),
    document.getElementById('header-indicators'),
  ]) {
    el?.setAttribute(DRAG, '');
  }

  document.getElementById('probe-min')?.addEventListener('click', () => void win.minimize());
  document.getElementById('probe-max')?.addEventListener('click', () => void win.toggleMaximize());
  document.getElementById('probe-close')?.addEventListener('click', () => void win.close());
}
