export interface MenuCallbacks {
  onNew: () => void;
  onNewFromTemplate: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onClose: () => void;
  onFind: () => void;
  onReplace: () => void;
  onFindNext: () => void;
  onFindPrevious: () => void;
  onInsertTable: () => void;
  onInsertMedia: () => void;
  onToggleSidebar: () => void;
}

export function setupMenu(callbacks: MenuCallbacks): void {
  const toggle = document.getElementById('menu-toggle')!;
  const dropdown = document.getElementById('menu-dropdown')!;

  function syncExpanded(): void {
    toggle.setAttribute('aria-expanded', dropdown.classList.contains('hidden') ? 'false' : 'true');
  }

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('hidden');
    syncExpanded();
  });

  document.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    syncExpanded();
  });
  dropdown.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  function bind(id: string, cb: () => void) {
    document.getElementById(id)!.addEventListener('click', () => {
      dropdown.classList.add('hidden');
      syncExpanded();
      cb();
    });
  }

  bind('menu-new', callbacks.onNew);
  bind('menu-new-from-template', callbacks.onNewFromTemplate);
  bind('menu-open', callbacks.onOpen);
  bind('menu-save', callbacks.onSave);
  bind('menu-save-as', callbacks.onSaveAs);
  bind('menu-close', callbacks.onClose);
  bind('menu-find', callbacks.onFind);
  bind('menu-replace', callbacks.onReplace);
  bind('menu-find-next', callbacks.onFindNext);
  bind('menu-find-prev', callbacks.onFindPrevious);
  bind('menu-insert-table', callbacks.onInsertTable);
  bind('menu-insert-media', callbacks.onInsertMedia);
  bind('menu-toggle-sidebar', callbacks.onToggleSidebar);
}

export function setCloseEnabled(enabled: boolean): void {
  const btn = document.getElementById('menu-close') as HTMLButtonElement;
  if (!btn) return;
  btn.disabled = !enabled;
  btn.title = enabled ? 'Close current document' : 'No document to close';
}

export function setInsertMediaEnabled(enabled: boolean): void {
  const btn = document.getElementById('menu-insert-media') as HTMLButtonElement;
  if (!btn) return;
  btn.disabled = !enabled;
  btn.title = enabled
    ? 'Insert an image from disk'
    : 'Image paste is not supported for this profile';
}
