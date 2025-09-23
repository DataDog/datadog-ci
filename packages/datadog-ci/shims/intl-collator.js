// This file's syntax will look broken and your IDE will complain about it, but it's expected.
// See: https://esbuild.github.io/api/#inject

// To replace `var { compare: localeCompare } = new Intl.Collator();` in `node_modules/packageurl-js/src/strings.js`

const IntlCollator = function () {
  return {
    // See https://nodejs.org/api/intl.html
    compare: (a, b) => String(a).localeCompare(b),
  }
}

export {IntlCollator as 'Intl.Collator'}
