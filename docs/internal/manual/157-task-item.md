# A task item whose whole body is a block

This file is a manual fixture for issue #157. Every item below holds one block and nothing else — no paragraph in front of it. Open it, change nothing, save it: nothing here may move, and every checkbox must be drawn beside its block rather than on a line of its own.

A heading:

- [ ] ## a heading as the whole body

An ordered list, whose marker used to be the thing that went:

- [ ] 1. an ordered list as the whole body

A blockquote, in an item that is ticked:

- [x] > a blockquote as the whole body

A fenced block with something in it:

- [ ] ```
  a fenced block as the whole body
  ```

And an empty fence, which is the shape that used to leave the file entirely:

- [ ] ```
  ```

Before this fix the checkbox came back empty and the block was written on the line after it, at the margin — out of the item and out of the list.
