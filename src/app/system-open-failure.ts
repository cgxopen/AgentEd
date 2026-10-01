import { showToast } from '../ui/toast';

/**
 * What a person sees when opening something with the system fails (#448).
 *
 * Both routes that hand something to the operating system end here: a
 * Ctrl+click on a link (`link-open.ts`) and a click on a file in the files
 * panel (`sidebar-click.ts`). Until #448 each caught the rejection and wrote
 * it to the console only, which a release build does not show, so a click
 * that opened nothing also said nothing. The reason is still logged for a
 * build that has a console; the person is told in a toast, the one the files
 * panel already used for the success, with `error` as its kind.
 *
 * The toast is 320 px wide and does not break a word, so a long name or
 * address is shortened here rather than overflowing it.
 */
export function reportSystemOpenFailure(what: string, error: unknown): void {
  console.error('[agented] opening with the system failed:', what, error);
  showToast(`Could not open ${shortened(what)}.`, 'error');
}

/** Characters of a name or an address shown before it is cut. */
const SHOWN_LENGTH = 48;

function shortened(what: string): string {
  return what.length <= SHOWN_LENGTH ? what : `${what.slice(0, SHOWN_LENGTH - 1)}…`;
}
