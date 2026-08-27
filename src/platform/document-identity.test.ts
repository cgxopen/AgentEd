/**
 * Issue #149 — the module boundary itself, and the one property it
 * exists for.
 *
 * The rules moved here behave exactly as they did inside `WebIO`, and
 * that is pinned by every test that was already there: `read-identity`
 * (#127), `open-identity` and `open-picked-file` (#141), `save-destination`
 * (#144) and `companion-writes` (#148) all drive the real `WebIO` and all
 * passed untouched through this move. Nothing here repeats them.
 *
 * What is new is the boundary, and it is worth its own file because it
 * is the reason the move was done at all. Four defects — #126, #127,
 * #141, #144 — lived at a **producer**: a function that took a handle
 * from a picker and answered a path without declaring what it had
 * taken. None lived in the rules. So the acceptance criterion is not
 * tidiness, it is that a *third* producer cannot repeat them:
 *
 * - the registration is private to this module;
 * - `take` is the only thing that writes it;
 * - `pathWithinGrant` — the question a producer has to ask — is a module
 *   function, so it is not reachable from anywhere else at runtime;
 * - and a path obtained without `take` is answered for by nobody, so
 *   skipping the step is not silently correct.
 *
 * The last one is the point. It is not that a bypass throws; it is that
 * a bypass produces exactly the state #141 and #144 were, and there is
 * now no way to reach it by accident because the only exported route to
 * a path also registers.
 */
import { describe, expect, it } from 'vitest';
import * as identityModule from './document-identity';
import { DocumentIdentity, type GrantedHandles } from './document-identity';

function fileHandle(name: string): FileSystemFileHandle {
  return { kind: 'file', name } as unknown as FileSystemFileHandle;
}

/**
 * A granted folder that can name the files it holds, the way
 * `FileSystemDirectoryHandle.resolve` does.
 */
function grantHolding(...held: FileSystemFileHandle[]): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name: 'project',
    resolve: async (descendant: FileSystemHandle) =>
      held.includes(descendant as FileSystemFileHandle) ? [descendant.name] : null,
  } as unknown as FileSystemDirectoryHandle;
}

function handles(
  dirHandle: FileSystemDirectoryHandle | null,
  fileHandle: FileSystemFileHandle | null = null,
): GrantedHandles {
  return { dirHandle, fileHandle };
}

describe('#149 — the entry point cannot be gone around', () => {
  it('the module exports the identity and nothing else', () => {
    // Types vanish at runtime, so this is the whole exported surface.
    // A rule leaking out of here is a rule a producer can call without
    // registering what it took.
    expect(Object.keys(identityModule)).toEqual(['DocumentIdentity']);
  });

  it('and the identity carries exactly three operations', () => {
    const surface = Object.getOwnPropertyNames(DocumentIdentity.prototype).sort();

    expect(surface).toEqual(['constructor', 'grantedFor', 'heldFor', 'take']);
  });

  it('`pathWithinGrant` is not among them, at runtime and not only to the compiler', () => {
    // It is a module function rather than a private method on purpose.
    // TypeScript's `private` is erased, so a method would still sit on
    // the prototype and a producer could reach it — ask the grant where
    // a handle is, take the answer, and never register the handle. That
    // is #141 and #144 written again.
    const surface = Object.getOwnPropertyNames(DocumentIdentity.prototype);

    expect(surface).not.toContain('pathWithinGrant');
    expect(identityModule).not.toHaveProperty('pathWithinGrant');
  });

  it('a handle nobody took is answered for by nobody', () => {
    // The demonstration. A producer that skipped `take` and returned
    // `handle.name` on its own would hand out a path the identity does
    // not answer for — so every later lookup falls through to the
    // granted folder, which is precisely the defect. There is no
    // accidental route to it, because the only way to obtain a path is
    // the call that also registers.
    const identity = new DocumentIdentity();
    const outside = fileHandle('report.md');

    expect(identity.heldFor(outside.name)).toBeNull();
  });

  it('and after `take` it is, under exactly the path `take` answered', () => {
    const identity = new DocumentIdentity();
    const outside = fileHandle('report.md');

    // A grant that does not hold this file: `resolve` says `null`, so
    // the name is all there is and the handle is registered under it.
    return identity.take(outside, handles(grantHolding())).then((path) => {
      expect(path).toBe('report.md');
      expect(identity.heldFor(path)).toBe(outside);
    });
  });
});

describe('#149 — one registry, asked by both sides, and never a fallback', () => {
  it('`heldFor` answers the same for a read and for a write', () => {
    // #141 named the hazard of a read registry and a write registry
    // becoming one object by accident; #147 answered it by making this a
    // claim about identity rather than a fallback for a failed lookup.
    // One question, one answer, whoever is asking — what differs is only
    // what each side falls through to, and that composition stays in
    // `WebIO`.
    const identity = new DocumentIdentity();
    const outside = fileHandle('report.md');

    return identity.take(outside, handles(grantHolding())).then(() => {
      expect(identity.heldFor('report.md')).toBe(outside);
      expect(identity.heldFor('report.md')).toBe(outside);
    });
  });

  it('and it is not consulted because something else failed', () => {
    // It matches the whole path this module itself answered, and nothing
    // else — never a basename, never a path AgentEd did not hand out
    // (#127).
    const identity = new DocumentIdentity();
    const outside = fileHandle('report.md');

    return identity.take(outside, handles(grantHolding())).then(() => {
      expect(identity.heldFor('doc/report.md')).toBeNull();
      expect(identity.heldFor('other.md')).toBeNull();
    });
  });
});

describe('#149 — the rules answer as they did inside WebIO', () => {
  it('a file the grant can name is not registered, and carries its parent', async () => {
    const identity = new DocumentIdentity();
    const inside = fileHandle('report.md');
    const grant = {
      kind: 'directory',
      name: 'project',
      resolve: async () => ['doc', 'report.md'],
    } as unknown as FileSystemDirectoryHandle;

    const path = await identity.take(inside, handles(grant));

    expect(path).toBe('doc/report.md');
    // Nothing is registered: the ordinary lookup gets this right, and
    // the path carries the parent everything built with `dirname` needs.
    expect(identity.heldFor(path)).toBeNull();
  });

  it('take both sets and clears, so a second document re-anchors', async () => {
    // The property #142 established and #147 kept by construction: a
    // Save As never leaves a stale registration to shadow the
    // destination it just picked.
    const identity = new DocumentIdentity();
    const outside = fileHandle('report.md');
    const inside = fileHandle('report.md');

    await identity.take(outside, handles(grantHolding()));
    expect(identity.heldFor('report.md')).toBe(outside);

    await identity.take(inside, handles(grantHolding(inside)));
    expect(identity.heldFor('report.md')).toBeNull();
  });

  it('the single granted file is reachable by its own name, and no other', () => {
    // #127's rule, unchanged: both conditions load-bearing.
    const identity = new DocumentIdentity();
    const only = fileHandle('notes.md');

    expect(identity.grantedFor('notes.md', handles(null, only))).toBe(only);
    expect(identity.grantedFor('AGENTS.md', handles(null, only))).toBeNull();
    expect(identity.grantedFor('notes/notes.md', handles(null, only))).toBeNull();
    // A granted folder is the authority on what is inside it; nothing
    // falls back past one.
    expect(identity.grantedFor('notes.md', handles(grantHolding(), only))).toBeNull();
  });

  it('a grant that cannot answer is the same as no grant, for all three reasons', async () => {
    const identity = new DocumentIdentity();
    const handle = fileHandle('report.md');

    // No `resolve` at all — a browser that never shipped it.
    const noResolve = { kind: 'directory', name: 'p' } as unknown as FileSystemDirectoryHandle;
    await expect(identity.take(handle, handles(noResolve))).resolves.toBe('report.md');

    // `resolve` that rejects — a grant that has lapsed.
    const throwing = {
      kind: 'directory',
      name: 'p',
      resolve: async () => {
        throw new DOMException('stub: gone', 'NotAllowedError');
      },
    } as unknown as FileSystemDirectoryHandle;
    await expect(identity.take(handle, handles(throwing))).resolves.toBe('report.md');

    // `resolve` that answers `null` — the file is not a descendant.
    await expect(identity.take(handle, handles(grantHolding()))).resolves.toBe('report.md');
  });
});
