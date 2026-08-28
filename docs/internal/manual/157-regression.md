# The task lists that must not move

This file is a manual fixture for issue #157, and it checks the opposite thing to the other two: the fix reaches every task item in every document, so an ordinary one must be written exactly as it was before.

An ordinary task list:

- [ ] an ordinary unticked item
- [x] an ordinary ticked item
- [ ] a third, to make it a list rather than a pair

A task list nested under a plain bullet, which is where the two list rules meet:

- a plain bullet
  - [ ] a task item under it

Two shapes #110 fixed, which share a serializer with this issue:

- ## a heading as a bullet item's whole body
- - [ ] a task list as a bullet item's whole body

This file writes the same bytes on the build before the fix and on the build after it. On its own it proves nothing about whether the fix landed; it is the half that catches a fix that went too far.
