# What a task item holds after its paragraph

This file is a manual fixture for issue #157, and it is the half that lost text rather than a marker. Each item below has a paragraph and then something else under it. Open it, change nothing, save it: nothing here may move.

A bullet list under a task item, with a second item after it:

- [ ] a task item with a list under it
  - the nested bullet
- [x] a second item, ticked

An ordered list under one:

- [ ] an item with an ordered list under it
  1. the nested number

A task list under one:

- [ ] an item with a task list under it
  - [x] the nested box

A heading under one:

- [ ] an item with a heading under it
  ## the heading

A quote under one:

- [ ] an item with a quote under it
  > the quote

And a fenced block under one:

- [ ] an item with a fence under it
  ```
  the code
  ```

Before this fix every one of those second blocks was dropped: each item came back as its first line alone, and the nested list, the heading, the quote and the fence were gone from the file.
