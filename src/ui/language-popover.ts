import { LANGUAGE_PATTERN } from '../editor/code-block-input-rules';

/**
 * The control that sets the language of one fenced block (R-C15, #238).
 *
 * One field, because a language is one decision — the same shape as the link
 * dialog of #25 and for the same reason: a control with two inputs is a form.
 * Enter sets, Escape cancels and changes nothing, an empty field clears the
 * language and leaves a plain text box.
 *
 * ── Why a refusal here is R-C2 business rather than tidiness ──
 *
 * Measured on `80cbfe5`, by writing the attribute and then saving and
 * reopening: a language holding a **backtick** writes a fence that does not
 * come back — the file reopens with that block read as a paragraph, so the
 * block leaves the document. A language holding a **space** is truncated to
 * its first word by the serializer, so the rest of what the user typed is
 * gone with nothing said. Neither is a shape this control may write, so both
 * are refused in the field, as they are typed, before Enter.
 *
 * The set is not restated here: `LANGUAGE_PATTERN` is built from the same
 * string as the #237 input rules, so the typed route and this one admit the
 * same languages by construction rather than by two authors agreeing.
 *
 * ── What it is, and what it is not ──
 *
 * A plain element positioned against the label, appended to `document.body`
 * and removed on close, so nothing of it survives a cancel. It is chrome: it
 * never touches the document model, and the write it asks for is made by the
 * caller.
 *
 * **It is a pointer affordance, and that is a recorded limit rather than an
 * oversight.** It is opened from the label, the label is `tabindex` -1 like
 * the Copy icon of #236, and the `pre` carries no `tabindex` and no
 * `contenteditable` of its own — the editable element is the `.tiptap` root
 * above it — so nothing inside the block is reachable by Tab and no
 * `:focus-within` rule on the `pre` can match. Once the popover *is* open its
 * own field holds focus and Enter and Escape both work, so the gesture
 * finishes at the keyboard even though it cannot start there. A route that
 * starts at the keyboard would be a menu entry rather than a second widget,
 * and it is not built here.
 */

/** The class the stylesheet positions the popover with. */
export const LANGUAGE_POPOVER_CLASS = 'language-popover';

/** The field inside it. */
export const LANGUAGE_FIELD_CLASS = 'language-popover-field';

/** The line that says why a value was refused. */
export const LANGUAGE_ERROR_CLASS = 'language-popover-error';

/** Why a language was refused. One line each, no syntax lecture (#13). */
export const LANGUAGE_HAS_BACKTICK =
  'A language cannot contain a backtick. Remove it, or press Escape to cancel.';
export const LANGUAGE_HAS_SPACE =
  'A language is one word. Remove the space, or press Escape to cancel.';

/**
 * Why this value cannot be written, or `null` where it can.
 *
 * An empty field is not a refusal: it is how a block is cleared back to a
 * plain text box, which R-C15 asks for. Surrounding whitespace is trimmed
 * rather than refused, because the input rule stops at the first space too —
 * what is refused is whitespace the user put *inside* the word.
 */
export function refusalFor(raw: string): string | null {
  const value = raw.trim();
  if (value === '') return null;
  if (LANGUAGE_PATTERN.test(value)) return null;
  return value.includes('`') ? LANGUAGE_HAS_BACKTICK : LANGUAGE_HAS_SPACE;
}

/** What a committed field means: a language, or `null` for a plain box. */
export function languageFrom(raw: string): string | null {
  const value = raw.trim();
  return value === '' ? null : value;
}

export interface LanguagePopoverOptions {
  /** The label the popover is positioned against. */
  readonly anchor: HTMLElement;
  /** What the block carries now; the empty string for a plain box. */
  readonly initial: string;
  /** Enter with an acceptable value. `null` clears the language. */
  readonly onCommit: (language: string | null) => void;
  /** Escape, or a click outside. The block is left exactly as it was. */
  readonly onCancel: () => void;
}

export interface LanguagePopover {
  readonly element: HTMLElement;
  readonly field: HTMLInputElement;
  readonly close: () => void;
}

/**
 * The one popover on screen, so a second click cannot leave the first behind.
 * Module state rather than a parameter: there is one pointer and one document.
 */
let open: LanguagePopover | null = null;

/** Whatever is open now, or `null`. Read by the tests and by the caller. */
export function openLanguagePopover(options: LanguagePopoverOptions): LanguagePopover {
  closeLanguagePopover();

  const element = document.createElement('div');
  element.className = LANGUAGE_POPOVER_CLASS;
  // Chrome, and outside the editable tree: it is appended to the body rather
  // than to the block, so no caret can enter it and no serializer can see it.
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-label', 'Set the language of this block');

  const field = document.createElement('input');
  field.type = 'text';
  field.className = LANGUAGE_FIELD_CLASS;
  field.value = options.initial;
  field.setAttribute('aria-label', 'Language');
  field.setAttribute('spellcheck', 'false');
  field.setAttribute('autocomplete', 'off');
  field.placeholder = 'Text';

  const error = document.createElement('p');
  error.className = LANGUAGE_ERROR_CLASS;
  error.setAttribute('role', 'alert');

  element.append(field, error);
  document.body.appendChild(element);

  function showRefusal(message: string | null): void {
    error.textContent = message ?? '';
    // `hidden` rather than a class, so an empty line takes no space and the
    // popover does not change height as the user types.
    error.hidden = message === null;
  }

  showRefusal(null);

  function finish(): void {
    element.remove();
    document.removeEventListener('mousedown', onOutside, true);
    if (open?.element === element) open = null;
  }

  function cancel(): void {
    finish();
    options.onCancel();
  }

  function commit(): void {
    const refusal = refusalFor(field.value);
    if (refusal !== null) {
      // Nothing is written and the popover stays put, so a typo is one
      // keystroke from being fixed rather than from being retyped (#25).
      showRefusal(refusal);
      field.select();
      return;
    }
    const language = languageFrom(field.value);
    finish();
    options.onCommit(language);
  }

  function onOutside(event: MouseEvent): void {
    if (event.target instanceof Node && element.contains(event.target)) return;
    cancel();
  }

  // Typing is an attempt at a correction, so the complaint about the old value
  // is answered by the new one rather than outliving it.
  field.addEventListener('input', () => showRefusal(refusalFor(field.value)));

  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  });

  // Captured, so a click anywhere else closes it before that click does
  // anything else — including a click on another block's label.
  document.addEventListener('mousedown', onOutside, true);

  position(element, options.anchor);
  field.focus();
  field.select();

  open = { element, field, close: cancel };
  return open;
}

/** Close whatever is open, as a cancel. Safe to call when nothing is. */
export function closeLanguagePopover(): void {
  open?.close();
}

/** The popover on screen, or `null`. */
export function activeLanguagePopover(): LanguagePopover | null {
  return open;
}

/**
 * Put it under the label, and keep it on screen.
 *
 * `position: fixed` in the stylesheet, so these are viewport coordinates and
 * the popover does not scroll away from a label that is itself scrolling
 * inside the block. The clamp is against the viewport rather than against the
 * editor, because the popover is a child of the body.
 *
 * **None of this is observable in the test harness**, which reports every
 * rectangle as zero, so it is verified in the manual pass and by the numbers
 * measured in Chromium on the branch rather than by an assertion here.
 */
function position(element: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const width = element.offsetWidth;
  const margin = 8;
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(rect.bottom + 4)}px`;
}
