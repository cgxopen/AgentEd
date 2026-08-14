import type { AppState } from '../app/state';
import { BUILT_IN_PROFILES, getProfile } from '../profiles/index';
import type { ProfileId } from '../profiles/types';

export interface ProfileIndicatorCallbacks {
  /**
   * Fired when the user picks an entry from the dropdown.
   *  - `profileId === null`: user picked "Auto-detect" (clear override)
   *  - otherwise: user pinned a specific profile (set override)
   */
  onProfileChange: (profileId: ProfileId | null) => void;
}

export interface ProfileIndicator {
  /** Re-read state.profile and update the visible label. */
  refresh: () => void;
}

const AUTO_LABEL = 'Auto-detect';

/**
 * Statusbar indicator showing the active profile, with a dropdown that
 * lets power users pin a different profile for the current document
 * session. Pinning is ephemeral — closed/new/open clear the override.
 */
export function setupProfileIndicator(
  state: AppState,
  callbacks: ProfileIndicatorCallbacks,
): ProfileIndicator {
  const button = document.getElementById('profile-indicator') as HTMLButtonElement | null;
  const menu = document.getElementById('profile-override-menu') as HTMLDivElement | null;
  if (!button || !menu) {
    // Defensive: no DOM target → return a no-op indicator. Lets unit
    // tests instantiate the module without mounting full markup.
    return { refresh: () => {} };
  }

  buildMenu(menu, (choice) => {
    menu.classList.add('hidden');
    callbacks.onProfileChange(choice);
  });

  button.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('hidden');
  });

  document.addEventListener('click', () => {
    menu.classList.add('hidden');
  });
  menu.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  function refresh(): void {
    const profile = getProfile(state.profile);
    const suffix = state.profileOverridden ? ' (pinned)' : '';
    button!.textContent = profile.displayName + suffix;
    button!.title = state.profileOverridden
      ? `${profile.displayName} — pinned for this document. Click to change.`
      : `Auto-detected as ${profile.displayName}. Click to override.`;
  }

  refresh();
  return { refresh };
}

function buildMenu(menu: HTMLDivElement, onChoice: (choice: ProfileId | null) => void): void {
  menu.replaceChildren();

  const auto = document.createElement('button');
  auto.type = 'button';
  auto.className = 'profile-option';
  auto.dataset.profile = 'auto';
  auto.textContent = AUTO_LABEL;
  auto.addEventListener('click', () => onChoice(null));
  menu.appendChild(auto);

  for (const profile of BUILT_IN_PROFILES) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'profile-option';
    item.dataset.profile = profile.id;
    item.textContent = profile.displayName;
    item.addEventListener('click', () => onChoice(profile.id));
    menu.appendChild(item);
  }
}
