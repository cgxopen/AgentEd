# Manual fixtures

Files the owner downloads and opens by hand to check a behaviour the automated tests cannot reach — a Windows build, a real save, real bytes on a real disk.

One rule keeps these honest: **a fixture is measured before it is named.** Whatever a pull request says a file becomes on save is what that file was actually measured to become, at the branch under test, through the same assembly the application uses. A manual step that asks for something the build cannot show is worse than no step at all.

Each fixture belongs to the issue in its name, is referred to by its exact byte count, and stays in the repository afterwards, so that a later reader can see what a fix was checked against.

| File | Issue | Bytes | What an unbroken save does to it |
| --- | --- | --- | --- |
| `104-blockquote.md` | #104 | 445 | nothing — byte-identical |
| `104-list-item.md` | #104 | 405 | drops the two bullets and their indentation, keeping both boxes: 397 bytes |
| `104-mixed.md` | #104 | 749 | drops one bullet and its indentation, keeping every box: 745 bytes |

## Checking a run

`Test-104.ps1` does the comparing, so a manual step is a run with a verdict rather than an eyeball over a text file. It takes two stages, with the editor in between:

```
powershell -ExecutionPolicy Bypass -File Test-104.ps1 -Stage Before
... open each file, change nothing, Ctrl+S, close ...
powershell -ExecutionPolicy Bypass -File Test-104.ps1 -Stage After
```

`Before` checks the downloaded files are the right bytes at all — a saved web page instead of the raw file is the usual mistake, and it is caught by name. `After` compares what the save wrote against what was measured, and classifies a wrong result instead of only reporting one: the bytes the build *before* the fix writes are carried too, so an installer that turns out to be stale says so rather than reading as a broken fix.

Three things it deliberately does: it records each file's write time so that **a save that never happened cannot pass as a file that correctly did not change**; it checks line endings and the final newline on both sides, because those are R-C2 as well; and it says on every run which fixture does *not* distinguish the two builds, because a green line that proves nothing is worse than no line at all.

It reads. The only things it writes are a `.before` copy of each fixture and a small state file, in the same folder.

## What these look like on screen

Measured by the owner on `05d727d`, and written down because a fixture that says only what its bytes do sends the next reader looking for the wrong thing:

- **A fence with a language looks exactly like one without.** Nothing draws a language label — R-C15 commits to one pre-public precisely because the two are indistinguishable on screen today. A manual step that asks for that label is asking for something the build cannot show; it has now been written twice, on #103 and on #104.
- **An empty box in a list item is drawn on the line after the bullet, not beside it**, with the bullet left empty. TipTap's `listItem` schema does not admit a code block as an item's first child, so the block is lifted out of the item on open. It is the same schema fact that takes the bullet off on save, and it is visible before any save happens.

The two files that do not come back byte-identical are not failures of the fix they were written for. They meet a separate TipTap schema limit, recorded in STATUS §4, that takes the bullet off any list item whose whole body is a heading, an ordered list or a fenced block — full or empty alike. The pull request for #104 says so in the same words.
