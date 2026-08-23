declare module 'turndown' {
  interface Options {
    headingStyle?: 'setext' | 'atx';
    hr?: string;
    bulletListMarker?: '-' | '+' | '*';
    codeBlockStyle?: 'indented' | 'fenced';
    fence?: '```' | '~~~';
    emDelimiter?: '_' | '*';
    strongDelimiter?: '__' | '**';
    linkStyle?: 'inlined' | 'referenced';
    linkReferenceStyle?: 'full' | 'collapsed' | 'shortcut';
  }

  interface Rule {
    filter: string | string[] | ((node: HTMLElement, options: Options) => boolean);
    replacement: (content: string, node: Node, options: Options) => string;
  }

  class TurndownService {
    constructor(options?: Options);
    turndown(html: string | Node): string;
    /**
     * Escapes markdown syntax in a text node's value. A public method on the
     * service, so it can be narrowed by assignment (#90) without reaching into
     * turndown's internals.
     */
    escape(text: string): string;
    addRule(key: string, rule: Rule): this;
    use(
      plugins: Array<(service: TurndownService) => void> | ((service: TurndownService) => void),
    ): this;
    remove(filter: string | string[] | ((node: HTMLElement, options: Options) => boolean)): this;
  }

  export default TurndownService;
}
