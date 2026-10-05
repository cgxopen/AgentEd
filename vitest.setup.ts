// Polyfills for happy-dom
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as Crypto;
}

// Web storage for the test environment (#482). From Node 26, Node defines
// global `localStorage` and `sessionStorage` of its own, and its
// `localStorage` is `undefined` unless the process is started with
// `--localstorage-file`; because the property already exists, happy-dom does
// not install its storage over it, and every test that touches it met
// `undefined`, 201 of them on 26.10.0. Node's `sessionStorage` works, kept in
// memory. Where a storage is missing, the one happy-dom provides is put in
// its place; on Node 20 to 24, and for `sessionStorage` on 26, nothing is
// missing and this does nothing.
for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (typeof globalThis[name] === 'undefined') {
    Object.defineProperty(globalThis, name, {
      value: new Storage(),
      configurable: true,
      writable: true,
    });
  }
}

// `Node.prototype.nodeName` answers as a browser does (#482). happy-dom
// defines `nodeName` on each node class and leaves the getter on
// `Node.prototype` answering an empty string for an element, so code that
// reads the name through that getter, as DOMPurify 3.4.8 and later do to
// resist DOM clobbering, sees every element as nameless; 878 tests went red
// on DOMPurify 3.4.16. A browser answers the real name through the same
// getter. This one calls the getter the class of the node defines, walking
// up to `Node.prototype`, at most 16 steps; failing that it keeps happy-dom's
// own answer.
//
// Remove it when happy-dom answers the right name itself: reported as
// happy-dom #2182 (github.com/capricorn86/happy-dom/issues/2182).
{
  const MAX_PROTOTYPE_STEPS = 16;
  const base = Object.getOwnPropertyDescriptor(Node.prototype, 'nodeName');
  Object.defineProperty(Node.prototype, 'nodeName', {
    configurable: true,
    enumerable: base?.enumerable ?? true,
    get(this: Node): string {
      let proto: object | null = Object.getPrototypeOf(this);
      for (
        let step = 0;
        proto && proto !== Node.prototype && step < MAX_PROTOTYPE_STEPS;
        step += 1
      ) {
        const own = Object.getOwnPropertyDescriptor(proto, 'nodeName');
        if (own?.get) return own.get.call(this);
        proto = Object.getPrototypeOf(proto);
      }
      return base?.get?.call(this) ?? '';
    },
  });
}
