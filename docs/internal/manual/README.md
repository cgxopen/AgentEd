# Manual fixtures

Files the owner downloads and opens by hand to check a behaviour the automated tests cannot reach — a Windows build, a real save, real bytes on a real disk.

One rule keeps these honest: **a fixture is measured before it is named.** Whatever a pull request says a file becomes on save is what that file was actually measured to become, at the branch under test, through the same assembly the application uses. A manual step that asks for something the build cannot show is worse than no step at all.

Each fixture belongs to the issue in its name, is referred to by its exact byte count, and stays in the repository afterwards, so that a later reader can see what a fix was checked against.

| File | Issue | Bytes | What an unbroken save does to it |
| --- | --- | --- | --- |
| `104-blockquote.md` | #104 | 445 | nothing — byte-identical |
| `104-list-item.md` | #104 | 405 | drops the two bullets and their indentation, keeping both boxes: 397 bytes |
| `104-mixed.md` | #104 | 749 | drops one bullet and its indentation, keeping every box: 745 bytes |

The two files that do not come back byte-identical are not failures of the fix they were written for. They meet a separate TipTap schema limit, recorded in STATUS §4, that takes the bullet off any list item whose whole body is a heading, an ordered list or a fenced block — full or empty alike. The pull request for #104 says so in the same words.
