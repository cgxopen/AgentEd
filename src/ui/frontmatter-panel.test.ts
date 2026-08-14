import { beforeEach, describe, expect, it } from 'vitest';
import { AppState } from '../app/state';
import { setupFrontmatterPanel } from './frontmatter-panel';

function mountPanel(): {
  details: HTMLDetailsElement;
  textarea: HTMLTextAreaElement;
} {
  document.body.innerHTML = `
    <details id="frontmatter-panel" class="frontmatter-panel hidden">
      <summary>Frontmatter (YAML)</summary>
      <textarea id="frontmatter-input"></textarea>
    </details>
  `;
  return {
    details: document.getElementById('frontmatter-panel') as HTMLDetailsElement,
    textarea: document.getElementById('frontmatter-input') as HTMLTextAreaElement,
  };
}

describe('FrontmatterPanel', () => {
  let state: AppState;
  let details: HTMLDetailsElement;
  let textarea: HTMLTextAreaElement;

  beforeEach(() => {
    ({ details, textarea } = mountPanel());
    state = new AppState();
  });

  it('refresh() writes current state.frontmatter to textarea', () => {
    state.frontmatter = 'name: x\ndescription: y';
    const panel = setupFrontmatterPanel(state);
    panel.refresh();
    expect(textarea.value).toBe('name: x\ndescription: y');
  });

  it('refresh() writes empty string when state.frontmatter is null', () => {
    state.frontmatter = null;
    const panel = setupFrontmatterPanel(state);
    panel.refresh();
    expect(textarea.value).toBe('');
  });

  it('input event updates state.frontmatter and marks modified', () => {
    setupFrontmatterPanel(state);
    let observedModified = false;
    state.onModifiedChange((m) => {
      if (m) observedModified = true;
    });

    textarea.value = 'name: new-value';
    textarea.dispatchEvent(new Event('input'));

    expect(state.frontmatter).toBe('name: new-value');
    expect(observedModified).toBe(true);
  });

  it('input event with empty value sets state.frontmatter to null (not empty string)', () => {
    state.frontmatter = 'name: x';
    setupFrontmatterPanel(state);

    textarea.value = '';
    textarea.dispatchEvent(new Event('input'));

    expect(state.frontmatter).toBeNull();
  });

  it('input event with whitespace-only value sets state.frontmatter to null', () => {
    setupFrontmatterPanel(state);

    textarea.value = '   \n  ';
    textarea.dispatchEvent(new Event('input'));

    expect(state.frontmatter).toBeNull();
  });

  it('setVisible(true) removes the hidden class', () => {
    const panel = setupFrontmatterPanel(state);
    expect(details.classList.contains('hidden')).toBe(true);
    panel.setVisible(true);
    expect(details.classList.contains('hidden')).toBe(false);
  });

  it('setVisible(false) adds the hidden class', () => {
    const panel = setupFrontmatterPanel(state);
    panel.setVisible(true);
    panel.setVisible(false);
    expect(details.classList.contains('hidden')).toBe(true);
  });
});
