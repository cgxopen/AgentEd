# A list item whose whole body is a block

This file is a manual fixture for issue #110. Open it in AgentEd, change nothing, and save it. Every bullet below must still be there afterwards, and every block must be drawn *inside* its item rather than on the line after it.

- ## A heading as the whole body

That list has one item, and the item holds nothing but a heading.

- 1. An ordered list as the whole body

That one holds nothing but an ordered list.

- ```
  a fence with content
  ```

That one holds nothing but a fenced block.

- ```
  ```

And that one holds nothing but an empty fenced block.

Before this fix each of those four lost its bullet on save, and the block was written at the margin with the item gone from the file.
