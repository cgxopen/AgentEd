/**
 * #784 - the words of the application the User Guide names are the words of
 * the application. The guide is prose the owner approves, so it is not built
 * from these constants; this row says when one of them changes and the guide
 * was not brought with it.
 */
import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES } from '../app/folder-link-check';
import {
  FOLDER_CHECK_AGAIN,
  FOLDER_CHECK_CLEAR,
  FOLDER_CHECK_DOOR,
  FOLDER_CHECK_STOP,
} from '../ui/links-folder-report';
import { LINKS_NOT_CHECKED_HEADING } from '../ui/links-popover';
import { LINKED_FROM_HEADING, LINKS_TO_HEADING, SHOW_LINKS } from '../ui/links-section';
import { NO_RELATED_ITEMS } from '../ui/sidebar';
import guide from './guide.md?raw';

describe('the words the User Guide names (#784)', () => {
  it('names the controls and headings of the files panel and of the check as the application draws them', () => {
    for (const words of [
      FOLDER_CHECK_DOOR,
      FOLDER_CHECK_STOP,
      FOLDER_CHECK_AGAIN,
      FOLDER_CHECK_CLEAR,
      LINKS_NOT_CHECKED_HEADING,
      NO_RELATED_ITEMS,
      SHOW_LINKS,
      LINKS_TO_HEADING,
      LINKED_FROM_HEADING,
    ]) {
      expect(guide, words).toContain(`**${words}**`);
    }
  });

  it('gives the bound of a file the check reads, as the line of the report gives it', () => {
    expect(guide).toContain(`larger than ${MAX_FILE_BYTES / 1000} KB is not checked`);
  });

  it('says No links to check, the start of the first line of a report with nothing to check', () => {
    expect(guide).toContain('**No links to check**');
  });
});
