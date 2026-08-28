# The one file here that a correct save does change

This file is a manual fixture for issue #157, and it is the only one in this folder whose bytes are expected to move. A list whose items are not all task items cannot be held as one list — a task list takes task items and nothing else — so it is split into a run of each, which is what #156 decided, and a split list is written with a blank line between the two halves.

The list below is written tight, the way a file that has never been saved by AgentEd would have it:

- [ ] a task item
- a plain bullet after it

A correct save writes one blank line between those two lines and changes nothing else. It does the same on the build before this fix and on the build after it, which is the point: this file is here so that a change to how a task item is written cannot quietly reach the ordinary lists in everybody's documents without saying so.

Because a correct save changes this file, download it again before repeating the check rather than saving the already-saved copy.
