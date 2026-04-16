import terminalLink from 'terminal-link'

declare const terminalLinkBrand: unique symbol

// Use a branded type to force TS to show the URL in the type tooltip.
type TerminalLink<URL extends string> = (strings: TemplateStringsArray) => URL & {[terminalLinkBrand]: true}

export const makeTerminalLink = <URL extends string>(url: URL) => {
  return ((strings: TemplateStringsArray) => terminalLink(strings[0], url)) as TerminalLink<URL>
}
