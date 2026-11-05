/** The two help documents of the Help menu (#701). */
export type HelpId = 'shortcuts' | 'guide';

/** The help a word names, or `null`: the answer of the process, a query. */
export function helpIdFrom(word: string | null | undefined): HelpId | null {
  return word === 'shortcuts' || word === 'guide' ? word : null;
}
