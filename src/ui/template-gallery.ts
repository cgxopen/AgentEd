import { TEMPLATES, type Template, type TemplateId } from '../templates/index';

let activeOverlay: HTMLElement | null = null;

/**
 * Show the Template Gallery dialog. Resolves with the chosen template
 * id, or `null` if the user dismissed via Escape / outside click /
 * close button. Cards are rendered in `TEMPLATES` order; a click on any
 * "Create" button finalizes the choice and closes the dialog.
 */
export async function showTemplateGallery(): Promise<TemplateId | null> {
  if (activeOverlay) {
    console.warn('[template-gallery] already open; rejecting new request');
    return null;
  }

  const previouslyFocused = document.activeElement as HTMLElement | null;

  return new Promise<TemplateId | null>((resolve) => {
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

    for (const template of TEMPLATES) {
      grid.appendChild(buildCard(template, finish));
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

    function finish(value: TemplateId | null): void {
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

function buildCard(template: Template, onPick: (id: TemplateId) => void): HTMLElement {
  const card = document.createElement('div');
  card.className = 'template-gallery-card';
  card.setAttribute('data-template', template.id);

  const icon = document.createElement('div');
  icon.className = 'template-gallery-icon';
  icon.textContent = template.icon;
  card.appendChild(icon);

  const name = document.createElement('div');
  name.className = 'template-gallery-name';
  name.textContent = template.displayName;
  card.appendChild(name);

  const desc = document.createElement('div');
  desc.className = 'template-gallery-desc';
  desc.textContent = template.description;
  card.appendChild(desc);

  const create = document.createElement('button');
  create.type = 'button';
  create.className = 'template-gallery-create primary';
  create.textContent = 'Create';
  create.addEventListener('click', () => onPick(template.id));
  card.appendChild(create);

  return card;
}
