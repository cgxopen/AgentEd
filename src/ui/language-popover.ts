import { LANGUAGE_PATTERN } from '../editor/code-block-input-rules';
import { POPOVER_MARGIN, POPOVER_OFFSET, popoverPlacement } from './popover-placement';

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
    // `hidden` rather than a class, so an empty line takes no space while there
    // is nothing to say. The popover does grow when a refusal appears, by
    // 39.6 px measured, and `position` places it for that taller state (#272).
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
 * Where the popover goes against its label, as CSS offsets (#272).
 *
 * `tallHeight` is the popover with a refusal showing, which is taller than the
 * popover as it opens. **The side is chosen for that height, not for the one on
 * screen at open**, because a refusal appears after placement: measured in
 * Chromium at 600x400, a popover placed for its closed 45 px ran past the
 * window edge in 26.5 per cent of label positions once a refusal grew it to
 * 84.6, against 14.6 per cent before.
 *
 * Below, it is placed by its `top`, exactly where it opened before #272, and a
 * refusal grows it downward into room that was reserved for it. Above, it is
 * held by its `bottom`, just over the label, so a refusal grows it upward, away
 * from the label and inside the window. That costs something, stated rather
 * than hidden: measured over the same positions, it opens above where the
 * closed popover would have fitted below in 6.9 per cent of positions at
 * 1024x768 and 14.5 at 600x400, and there the field rises by one line when a
 * refusal appears.
 *
 * The capped branches of `popoverPlacement` are not reached at this height,
 * measured, so its `maxHeight` is not applied: the popover is never taller
 * than the room it is given.
 */
export type LanguagePopoverOffset =
  | { readonly edge: 'top'; readonly px: number }
  | { readonly edge: 'bottom'; readonly px: number };

export function languagePopoverOffset(
  anchorTop: number,
  anchorBottom: number,
  tallHeight: number,
  headerBottom: number,
  viewportHeight: number,
): LanguagePopoverOffset {
  const placement = popoverPlacement(
    anchorTop,
    anchorBottom,
    tallHeight,
    headerBottom,
    viewportHeight,
  );
  if (!placement.above) return { edge: 'top', px: placement.top };
  return { edge: 'bottom', px: viewportHeight - (anchorTop - POPOVER_OFFSET) };
}

/**
 * The height of the popover with the tallest refusal it can show.
 *
 * Measured on an invisible copy rather than on the popover, because the
 * refusal line is `role="alert"`: writing a message into the real one, even for
 * the length of a measurement, is a message a screen reader may announce for a
 * value nobody typed. The copy has no role and is hidden from assistive
 * technology, and it is removed before this returns.
 *
 * Both messages are tried rather than one assumed longer, because how many
 * lines each wraps to depends on the font, and the font on Windows is not the
 * one this was measured with.
 */
function tallestHeight(element: HTMLElement): number {
  const probe = element.cloneNode(true) as HTMLElement;
  probe.removeAttribute('role');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.visibility = 'hidden';
  probe.style.left = '0px';
  probe.style.top = '0px';
  const line = probe.querySelector<HTMLElement>(`.${LANGUAGE_ERROR_CLASS}`);
  line?.removeAttribute('role');
  document.body.appendChild(probe);

  let tallest = element.getBoundingClientRect().height;
  for (const message of [LANGUAGE_HAS_BACKTICK, LANGUAGE_HAS_SPACE]) {
    if (line === null) break;
    line.textContent = message;
    line.hidden = false;
    tallest = Math.max(tallest, probe.getBoundingClientRect().height);
  }
  probe.remove();
  return tallest;
}

/**
 * Put it against the label, and keep it on screen whether or not a refusal is
 * showing.
 *
 * `position: fixed` in the stylesheet, so these are viewport coordinates. The
 * horizontal clamp is against the viewport rather than against the editor,
 * because the popover is a child of the body. The ceiling is the header, read
 * rather than written down, for the reason `popoverPlacement` gives.
 *
 * **None of the result is observable in the test harness**, which reports
 * every rectangle as zero. `language-popover.test.ts` drives this function
 * through rectangles it supplies, so the wiring is asserted; where it lands on
 * a real screen is verified in the manual pass.
 */
function position(element: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const header = document.getElementById('menubar');
  // `#menubar` is written in `index.html`. If it is ever absent the window top
  // is the ceiling, as it is for the heading list.
  const headerBottom = header === null ? 0 : header.getBoundingClientRect().bottom;
  const offset = languagePopoverOffset(
    rect.top,
    rect.bottom,
    tallestHeight(element),
    headerBottom,
    window.innerHeight,
  );

  const width = element.offsetWidth;
  const left = Math.max(
    POPOVER_MARGIN,
    Math.min(rect.left, window.innerWidth - width - POPOVER_MARGIN),
  );
  element.style.left = `${Math.round(left)}px`;
  element.style[offset.edge] = `${Math.round(offset.px)}px`;
}
