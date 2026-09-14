import { MENU_ACCORDION_CLASS } from './menu';
import { showToast } from './toast';

/**
 * TEMPORARY, #294 comparison head, and not a merge candidate. It lets the owner
 * compare the two shapes of the hamburger menu in one running build: an
 * Alt+click on the menu toggle flips between the drill-down and the accordion,
 * and a toast names the one now active. The build starts on the drill-down.
 *
 * Whichever shape is chosen, this module, its call in `main.ts`, the class it
 * sets and the losing variant come out in the following head.
 *
 * It listens in the capture phase on the toggle itself, so the flip happens
 * before `setupMenu` opens the menu, and the menu opens at its root in the
 * variant just chosen. The entries and their bindings are not touched.
 */
export function setupMenuVariantSwitch(): void {
  const toggle = document.getElementById('menu-toggle');
  const dropdown = document.getElementById('menu-dropdown');
  if (!toggle || !dropdown)
    throw new Error('the menu markup has no #menu-toggle or #menu-dropdown');
  toggle.addEventListener(
    'click',
    (e) => {
      if (!e.altKey) return;
      const accordion = dropdown.classList.toggle(MENU_ACCORDION_CLASS);
      showToast(
        `Menu shape: ${accordion ? 'accordion' : 'drill-down'} (Alt+click the menu button to switch)`,
      );
    },
    true,
  );
}
