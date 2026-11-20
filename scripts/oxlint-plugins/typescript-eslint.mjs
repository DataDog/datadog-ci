// typescript-eslint, with `naming-convention` adapted to run under Oxlint.
import tseslint from '@typescript-eslint/eslint-plugin'

// Oxlint does not provide typescript-eslint parser services. `naming-convention` only uses them for the `types` option
// and the compiler target, which do not affect the `variable` selector this config uses, so it runs with empty services.
const withoutParserServices = (rule) => {
  const parserServices = {esTreeNodeToTSNodeMap: new WeakMap(), tsNodeToESTreeNodeMap: new WeakMap(), program: null}

  return {
    ...rule,
    create: (context) =>
      rule.create(
        Object.create(context, {
          sourceCode: {value: Object.create(context.sourceCode, {parserServices: {value: parserServices}})},
        })
      ),
  }
}

export default {
  ...tseslint,
  rules: {...tseslint.rules, 'naming-convention': withoutParserServices(tseslint.rules['naming-convention'])},
}
