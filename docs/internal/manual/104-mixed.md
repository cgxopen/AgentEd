# Empty boxes beside a full one

This file is a manual fixture for issue #104. It holds an empty plain text box inside a container, an empty one on its own, and an ordinary fenced block with code in it, so that a fix reaching further than it should shows up here.

An empty box alone in a quote:

> ```
> ```

An empty box alone in a list item:

- ```
  ```

An empty box on its own, which has survived the save since #103:

```
```

An ordinary fenced block, which must not move a byte:

```ts
const answer = 42;
console.log(answer);
```

A quote that holds text as well as a box:

> Some words.
> 
> ```
> ```

A list that holds text as well as a box:

- Some words.

  ```
  ```

And a closing paragraph, so the end of the file is ordinary text.
