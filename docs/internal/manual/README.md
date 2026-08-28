# Manual fixtures

Files the owner downloads and opens by hand to check a behaviour the automated tests cannot reach — a Windows build, a real save, real bytes on a real disk.

One rule keeps these honest: **a fixture is measured before it is named.** Whatever a pull request says a file becomes on save is what that file was actually measured to become, at the branch under test, through the same assembly the application uses. A manual step that asks for something the build cannot show is worse than no step at all.

Each fixture belongs to the issue in its name, is referred to by its exact byte count, and stays in the repository afterwards, so that a later reader can see what a fix was checked against.

| File | Issue | Bytes | What an unbroken save does to it |
| --- | --- | --- | --- |
| `104-blockquote.md` | #104 | 445 | nothing — byte-identical |
| `104-list-item.md` | #104 | 405 | nothing — byte-identical **since #110** |
| `104-mixed.md` | #104 | 749 | nothing — byte-identical **since #110** |
| `110-list-item.md` | #110 | 740 | nothing — byte-identical |
| `110-family.md` | #110 | 650 | nothing — byte-identical |
| `110-regression.md` | #110 | 524 | nothing — byte-identical, on **both** builds |

**Two of the #104 rows changed, and #104 did not move.** Both were measured to lose their bullets, and that was the #110 defect showing through fixtures written for a different issue — the same schema fact, met by a file that was not looking for it. #110 removed it, so both now come back unchanged and their old measurements are carried in the script as the stale build. It is worth keeping in view that a fixture can fail for a reason that has nothing to do with the issue it was written for; here it took a second issue to explain the number.

**`110-regression.md` writes the same bytes on both builds, deliberately.** It is the half that catches a fix that went too far, and on its own it proves nothing about whether the fix landed. The script says so on every run.

## Checking the build before checking anything else

`Test-BuildIdentity.ps1` answers the question every manual pass depends on and none of the byte checks can see: **is this the build the pull request names?** It takes the seven characters as a parameter, so it does not go stale between commits.

```
powershell -ExecutionPolicy Bypass -File Test-BuildIdentity.ps1 -Commit 0000000
```

It checks the two artifact zips are here under the names the run gave them, and then reads the commit **out of the web bundle** rather than off the file name — `vite.config.ts` bakes it in as `__BUILD_COMMIT__` and About reads it from there, so a zip renamed by hand fails even though its name looked right. The Windows installer cannot be checked this way: its commit is only readable from the running application, which is what About is for.

No network, and the only thing it writes is a temporary folder it removes again.

## Checking a run

`Test-104.ps1` does the comparing — it covers #104 and #110, and keeps its name because that is what the owner has a shortcut to, so a manual step is a run with a verdict rather than an eyeball over a text file. It takes two stages, with the editor in between:

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
- **An empty box in a list item used to be drawn on the line after the bullet, not beside it**, with the bullet left empty — because TipTap's `listItem` schema did not admit a block as an item's first child, so the block was lifted out of the item on open. That is the observation this file recorded on `05d727d`, it is what made the cost visible before any save, and it is what got the behaviour filed as #110. **It is fixed**: `listItem` takes `block+`, and the box is now drawn inside the item with the bullet beside it. The sentence is kept rather than deleted, because it is the before-state the owner is checking against.

Every file here now comes back byte-identical. The two that did not — `104-list-item.md` and `104-mixed.md` — were meeting a separate TipTap schema limit that took the bullet off any list item whose whole body was a heading, an ordered list or a fenced block, full or empty alike. That limit was #110 and it is gone; the paragraph that used to stand here, saying those two were not failures of the fix they were written for, has no subject any more.

What is **not** gone, and is worth knowing before a fixture is written against it: a **task item** carries the same restriction, and it is not repaired by the same change — widening it loses content rather than keeping it. That is #157, and no fixture here exercises it yet.
