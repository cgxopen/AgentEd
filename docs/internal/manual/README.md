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
| `157-task-item.md` | #157 | 886 | nothing — byte-identical |
| `157-nested.md` | #157 | 1039 | nothing — byte-identical |
| `157-regression.md` | #157 | 876 | nothing — byte-identical, on **both** builds |
| `157-mixed.md` | #157 | 1034 | **adds one blank line** — 1035 bytes out, on **both** builds |

**Two of the #104 rows changed, and #104 did not move.** Both were measured to lose their bullets, and that was the #110 defect showing through fixtures written for a different issue — the same schema fact, met by a file that was not looking for it. #110 removed it, so both now come back unchanged and their old measurements are carried in the script as the stale build. It is worth keeping in view that a fixture can fail for a reason that has nothing to do with the issue it was written for; here it took a second issue to explain the number.

**`110-regression.md` and `157-regression.md` write the same bytes on both builds, deliberately.** They are the half that catches a fix that went too far, and on their own they prove nothing about whether the fix landed. The script says so on every run. `157-regression.md` earns its place because #157 rewrites how **every** task item in **every** document is written, so an ordinary task list is exactly where a fix that reached slightly too wide would show.

**`157-mixed.md` is the one file here a correct save changes, and that is what it is for.** A list whose items are not all task items cannot be held as one list, so it is split into a run of each and written with a blank line between them — #156's decision, unchanged by #157. It writes the same 1035 bytes on both builds. Because a correct save changes it, a repeat run needs a fresh download rather than the saved copy; the `Before` stage says so by failing on the bytes.

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

**A task item used to carry the same restriction, and it was not repaired by the same change.** Widening it while the serializer still wrote one line per item lost content rather than keeping it, so #157 fixed the serializer first and widened the node last. Four fixtures exercise it now, and the two halves are worth telling apart before a result is read:

- `157-task-item.md` and `157-nested.md` are the **fix**. On the build before #157 the first comes back 890 bytes with every box emptied and its block written at the margin, and the second comes back **917 bytes — 122 bytes of the owner's text simply gone**, which is the stronger half: a nested list, a heading, a quote and a fence dropped out of the file rather than merely displaced.
- `157-regression.md` and `157-mixed.md` are the **guard**, and neither of them can tell the two builds apart. That is deliberate: read them only as *nothing else moved*.

On screen, the #157 defect looks like the #110 one and is visible before any save: an empty checkbox with its heading, quote or fence drawn on the line below it, outside the item. What the byte checks cannot see at all is whether the checkbox still **ticks** when it is clicked in an item that begins with a heading rather than with text — worth a click on each of the five items in `157-task-item.md`.
