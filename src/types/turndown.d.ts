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

  /**
   * Turndown's own rule table, resolved onto the service's options. Declared
   * so a replacement rule can delegate to the built-in it shadows (#97)
   * instead of restating it — the same move `escape` makes for the escape
   * table. Only the rule that is actually delegated to is named.
   */
  interface BuiltinRules {
    readonly heading: Rule;
  }

  class TurndownService {
    constructor(options?: Options);
    /** The service's resolved options, including turndown's own rules. */
    readonly options: Options & { readonly rules: BuiltinRules };
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
