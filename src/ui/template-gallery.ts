import { BUILT_IN_PROFILES, getProfile } from '../profiles/index';
import type { ProfileId } from '../profiles/types';

/**
 * Display order for the New from Template gallery. Independent of
 * `BUILT_IN_PROFILES` (which is in detection-priority order). Plain
 * comes first as the safe default; ecosystem-specific skills follow.
 */
const GALLERY_ORDER: readonly ProfileId[] = [
  'plain',
  'llms-txt',
  'claude-skill',
  'openclaw-skill',
  'agentskills-v1',
];

if (GALLERY_ORDER.length !== BUILT_IN_PROFILES.length) {
  console.warn(
    `[template-gallery] GALLERY_ORDER (${GALLERY_ORDER.length}) does not ` +
      `match BUILT_IN_PROFILES (${BUILT_IN_PROFILES.length}). ` +
      'Some profiles will not appear in the gallery.',
  );
}

const PROFILE_ICONS: Record<ProfileId, string> = {
  'claude-skill': '\u{1F916}',
  'openclaw-skill': '\u{1F527}',
  'agentskills-v1': '\u{1F4CB}',
  'llms-txt': '\u{1F310}',
  plain: '\u{1F4C4}',
};

const PROFILE_DESCRIPTIONS: Record<ProfileId, string> = {
  'claude-skill':
    'Skill files for Claude (Anthropic skill-creator conventions). Frontmatter with name + description, body with Instructions and Examples.',
  'openclaw-skill':
    'Skills with OpenClaw runtime metadata. Includes version + skillKey for the OpenClaw registry.',
  'agentskills-v1': 'Generic AgentSkills v1 spec — minimal frontmatter, portable across consumers.',
  'llms-txt':
    "Navigation index for LLMs (Jeremy Howard's llms.txt proposal). H1 + summary blockquote + section lists.",
  plain: 'Empty markdown document. No frontmatter, no validation rules. The default.',
};

let activeOverlay: HTMLElement | null = null;

/**
 * Show the Template Gallery dialog. Resolves with the chosen profile
 * id, or `null` if the user dismissed via Escape / outside click /
 * close button. Built-ins are listed in registration order; click on
 * any "Create" button finalizes the choice and closes the dialog.
 */
export async function showTemplateGallery(): Promise<ProfileId | null> {
  if (activeOverlay) {
    console.warn('[template-gallery] already open; rejecting new request');
    return null;
  }

  const previouslyFocused = document.activeElement as HTMLElement | null;

  return new Promise<ProfileId | null>((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Choose a template');

    const dialog = document.createElement('div');
    dialog.className = 'dialog template-gallery';

    const header = document.createElement('div');
    header.className = 'template-gallery-header';

    const title = document.createElement('div');
    title.className = 'dialog-title';
    title.textContent = 'New from Template';
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'template-gallery-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => finish(null));
    header.appendChild(closeBtn);

    dialog.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'template-gallery-grid';

    for (const id of GALLERY_ORDER) {
      const profile = getProfile(id);
      grid.appendChild(buildCard(profile.id, profile.displayName, finish));
    }

    dialog.appendChild(grid);
    overlay.appendChild(dialog);

    function onKeydown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      }
    }

    function onOverlayClick(e: MouseEvent): void {
      if (e.target === overlay) finish(null);
    }

    function finish(value: ProfileId | null): void {
      if (activeOverlay !== overlay) return;
      document.removeEventListener('keydown', onKeydown, true);
      overlay.removeEventListener('click', onOverlayClick);
      overlay.remove();
      activeOverlay = null;
      previouslyFocused?.focus?.();
      resolve(value);
    }

    document.addEventListener('keydown', onKeydown, true);
    overlay.addEventListener('click', onOverlayClick);

    document.body.appendChild(overlay);
    activeOverlay = overlay;

    const firstCreate = grid.querySelector<HTMLButtonElement>('.template-gallery-create');
    firstCreate?.focus();
  });
}

function buildCard(
  id: ProfileId,
  displayName: string,
  onPick: (id: ProfileId) => void,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'template-gallery-card';
  card.setAttribute('data-profile', id);

  const icon = document.createElement('div');
  icon.className = 'template-gallery-icon';
  icon.textContent = PROFILE_ICONS[id];
  card.appendChild(icon);

  const name = document.createElement('div');
  name.className = 'template-gallery-name';
  name.textContent = displayName;
  card.appendChild(name);

  const desc = document.createElement('div');
  desc.className = 'template-gallery-desc';
  desc.textContent = PROFILE_DESCRIPTIONS[id];
  card.appendChild(desc);

  const create = document.createElement('button');
  create.type = 'button';
  create.className = 'template-gallery-create primary';
  create.textContent = 'Create';
  create.addEventListener('click', () => onPick(id));
  card.appendChild(create);

  return card;
}
