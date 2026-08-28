# An ordinary list still behaves

This file is a manual fixture for issue #110, and it is the half that catches a fix that went too far. Nothing in it is unusual. Open it, change nothing, save it: it must come back byte for byte.

- one
- two
- three

A nested list:

- one
  - nested
    - deeper
- two

An ordered list:

1. one
2. two
3. three

A task list:

- [ ] not done
- [x] done

An item holding two paragraphs:

1. one

   continued

2. two

An item with a fence after its text:

- some text

  ```
  a fence
  ```
