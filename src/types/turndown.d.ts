declare module 'turndown' {
  /**
   * What turndown writes for a node whose text content is entirely
   * whitespace. Documented in turndown's README, unlike `options.rules`
   * below, and reached through the constructor because the service resolves
   * it into its rule table once, at construction (#94).
   */
  export type BlankReplacement = (content: string, node: Node, options: Options) => string;

  export interface Options {
    headingStyle?: 'setext' | 'atx';
    hr?: string;
    bulletListMarker?: '-' | '+' | '*';
    codeBlockStyle?: 'indented' | 'fenced';
    fence?: '```' | '~~~';
    emDelimiter?: '_' | '*';
    strongDelimiter?: '__' | '**';
    linkStyle?: 'inlined' | 'referenced';
    linkReferenceStyle?: 'full' | 'collapsed' | 'shortcut';
    blankReplacement?: BlankReplacement;
    /**
     * Whether a `code` element is read as preformatted in the white-space
     * pass, so its text is written as it is held (#603). Present in turndown
     * 7.2.4, false by default, and named in neither of its README tables.
     */
    preformattedCode?: boolean;
  }

  export interface Rule {
    filter: string | string[] | ((node: HTMLElement, options: Options) => boolean);
    replacement: (content: string, node: Node, options: Options) => string;
  }

  /**
   * Turndown's own rule table, resolved onto the service's options. Declared
   * so a replacement rule can delegate to the built-in it shadows (#97)
   * instead of restating it — close to the move `escape` makes for the escape
   * table, but not identical: turndown documents overriding
   * `TurndownService.prototype.escape`, while `options.rules` appears in
   * neither of its README's option tables. Only the rule actually delegated
   * to is named, and it is declared **optional** on purpose: this file is our
   * claim about a package that ships no types, so the caller is made to check
   * rather than trust it.
   */
  export interface BuiltinRules {
    readonly heading?: Rule;
    readonly blockquote?: Rule;
    readonly list?: Rule;
    readonly horizontalRule?: Rule;
    readonly lineBreak?: Rule;
  }

  export class TurndownService {
    constructor(options?: Options);
    /**
     * The service's resolved options, including turndown's own rules and the
     * defaults it filled in — which is where `blankReplacement` is read from
     * when it is delegated to rather than restated (#94).
     */
    readonly options: Options & { readonly rules: BuiltinRules };
    turndown(html: string | Node): string;
    /**
     * Escapes markdown syntax in a text node's value. A public method on the
     * service, so it can be narrowed by assignment (#90) without reaching into
     * turndown's internals.
     */
    escape(text: string): string;
    /**
     * The table turndown looks a rule up in, one node at a time. Neither
     * documented nor typed upstream, like `options.rules`; declared so the
     * lookup can be wrapped (#568), and optional so the caller checks it.
     */
    readonly rules?: { forNode?: (node: Node) => Rule };
    addRule(key: string, rule: Rule): this;
    use(
      plugins: Array<(service: TurndownService) => void> | ((service: TurndownService) => void),
    ): this;
    remove(filter: string | string[] | ((node: HTMLElement, options: Options) => boolean)): this;
  }

  export default TurndownService;
}
