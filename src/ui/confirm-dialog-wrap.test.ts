/**
 * #741: a long word in a dialog message, a filename or a path with no space,
 * comma or hyphen, wraps inside the dialog instead of running out of it.
 *
 * Whether it wraps is layout, which happy-dom does not perform: every
 * rectangle it reports is zero. So these rows assert the two halves that are
 * observable and join them: the rule is read out of the shipped stylesheet,
 * and its selector is run against the message element the real
 * `showConfirmDialog` rendered. Either half alone asserts nothing. What the
 * rule does on screen was measured in Chromium on the step zero of #741, and
 * is verified on the owner pass on Windows.
 */
import { afterEach, describe, expect, it } from 'vitest';
import stylesCss from '../styles.css?raw';
import { stylesheetRules, valuesReaching } from '../test-support/stylesheet-rules';
import { showConfirmDialog } from './confirm-dialog';

const shippedRules = stylesheetRules(stylesCss);

/**
 * A filename of 80 characters with no break opportunity, the length the owner
 * measured, in wide letters: in Chromium it runs to 633 px in a 600 px window
 * without the rule, where a name of narrow letters of the same length fits.
 */
const LONG_NAME =
  'WorkshopMemoWebMeetingMinutesMarketingWorkgroupMondayWednesdayMorningMemoWWWM.md';

/** Raise a dialog whose message holds the long name; return its message element. */
function renderedMessage(): { message: HTMLElement; dismiss: () => void } {
  void showConfirmDialog({
    title: 'File changed on disk',
    message: `${LONG_NAME} has changed on disk since it was opened here.\n\nSecond paragraph.`,
    actions: [{ label: 'OK', value: 'ok', variant: 'primary' }],
  });
  const message = document.querySelector<HTMLElement>('.dialog-overlay .dialog-message');
  if (!message) throw new Error('showConfirmDialog rendered no .dialog-message');
  return {
    message,
    dismiss: () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
  };
}

let dismiss: () => void = () => {};

afterEach(() => {
  dismiss();
  document.body.innerHTML = '';
});

describe('the message of a dialog', () => {
  it('lets a long unbroken word break, so it wraps inside the dialog', () => {
    const rendered = renderedMessage();
    dismiss = rendered.dismiss;
    expect(rendered.message.textContent).toContain(LONG_NAME);
    expect(valuesReaching(shippedRules, rendered.message, 'overflow-wrap')).toEqual(['anywhere']);
  });

  it('keeps the line breaks the message already has', () => {
    const rendered = renderedMessage();
    dismiss = rendered.dismiss;
    expect(valuesReaching(shippedRules, rendered.message, 'white-space')).toEqual(['pre-wrap']);
  });
});
