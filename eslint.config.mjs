import eslint from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import {defineConfig, globalIgnores} from 'eslint/config'
import importPlugin from 'eslint-plugin-import'
import jest from 'eslint-plugin-jest'
import noNull from 'eslint-plugin-no-null'
import preferArrow from 'eslint-plugin-prefer-arrow'
import prettierRecommended from 'eslint-plugin-prettier/recommended'
import tseslint from 'typescript-eslint'

const restrictedImports = [
  {
    // forbid using named imports for chalk
    // since we can't restrict to only using default imports, this is a list of all chalk members
    name: 'chalk',
    importNames: [
      'Instance',
      'level',
      'hex',
      'keyword',
      'rgb',
      'hsl',
      'hsv',
      'hwb',
      'ansi',
      'ansi256',
      'bgHex',
      'bgKeyword',
      'bgRgb',
      'bgHsl',
      'bgHsv',
      'bgHwb',
      'bgAnsi',
      'bgAnsi256',
      'reset',
      'bold',
      'dim',
      'italic',
      'underline',
      'inverse',
      'hidden',
      'strikethrough',
      'visible',
      'black',
      'red',
      'green',
      'yellow',
      'blue',
      'magenta',
      'cyan',
      'white',
      'gray',
      'grey',
      'blackBright',
      'redBright',
      'greenBright',
      'yellowBright',
      'blueBright',
      'magentaBright',
      'cyanBright',
      'whiteBright',
      'bgBlack',
      'bgRed',
      'bgGreen',
      'bgYellow',
      'bgBlue',
      'bgMagenta',
      'bgCyan',
      'bgWhite',
      'bgGray',
      'bgGrey',
      'bgBlackBright',
      'bgRedBright',
      'bgGreenBright',
      'bgYellowBright',
      'bgBlueBright',
      'bgMagentaBright',
      'bgCyanBright',
      'bgWhiteBright',
    ],
    message: "Please use a default import instead, e.g. `import chalk from 'chalk'`",
  },
  {
    name: 'path',
    message: 'Please use `upath` instead of `path` to support Windows. This is a drop-in replacement.',
  },
  {
    name: 'glob',
    message:
      'Please use our glob helpers (`globSync` or `globAsync`) which support Windows out-of-the-box instead of using the `glob` package directly.',
  },
  {
    // imported as `import { EOL } from 'os'`
    name: 'os',
    importNames: ['EOL'],
    message: 'Please use `\\n` instead of `os.EOL` when splitting the `stdout`/`stderr` into lines.',
  },
]

export default defineConfig(
  globalIgnores(['eslint.config.mjs', 'jest.config.js', 'packages/*/dist']),
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  importPlugin.flatConfigs.recommended,
  prettierRecommended,
  jest.configs['flat/recommended'],
  {
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: ['./tsconfig.json'],
        },
      },
    },
    plugins: {
      '@stylistic': stylistic,
      'no-null': noNull,
      'prefer-arrow': preferArrow,
    },
    rules: {
      '@typescript-eslint/adjacent-overload-signatures': 'error',
      '@typescript-eslint/array-type': [
        'error',
        {
          default: 'array',
        },
      ],
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-restricted-types': [
        'error',
        {
          types: {
            Object: {
              message: 'Avoid using the `Object` type. Did you mean `object`?',
            },
            Function: {
              message: 'Avoid using the `Function` type. Prefer a specific function type, like `() => void`.',
            },
            Boolean: {
              message: 'Avoid using the `Boolean` type. Did you mean `boolean`?',
            },
            Number: {
              message: 'Avoid using the `Number` type. Did you mean `number`?',
            },
            String: {
              message: 'Avoid using the `String` type. Did you mean `string`?',
            },
            Symbol: {
              message: 'Avoid using the `Symbol` type. Did you mean `symbol`?',
            },
          },
        },
      ],
      '@typescript-eslint/consistent-type-assertions': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        {
          accessibility: 'explicit',
          overrides: {
            constructors: 'no-public',
          },
        },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/indent': 'off', // enforced by prettier
      '@typescript-eslint/member-delimiter-style': [
        'off',
        {
          multiline: {
            delimiter: 'none',
            requireLast: true,
          },
          singleline: {
            delimiter: 'semi',
            requireLast: false,
          },
        },
      ],
      '@typescript-eslint/member-ordering': 'error',
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'variable',
          format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
          leadingUnderscore: 'allow',
          trailingUnderscore: 'forbid',
        },
      ],
      '@typescript-eslint/no-empty-function': 'off', // allows empty functions, e.g. () => {}
      '@typescript-eslint/no-empty-object-type': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-inferrable-types': 'error',
      '@typescript-eslint/no-misused-new': 'error',
      '@typescript-eslint/no-namespace': 'error',
      '@typescript-eslint/no-parameter-properties': 'off',
      '@typescript-eslint/no-extra-semi': 'off', // enforced by prettier
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      '@typescript-eslint/prefer-regexp-exec': 'off',
      '@typescript-eslint/unbound-method': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/restrict-template-expressions': 'warn',
      '@typescript-eslint/no-shadow': [
        'error',
        {
          hoist: 'all',
        },
      ],
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'error',
      '@typescript-eslint/no-unnecessary-qualifier': 'error',
      '@typescript-eslint/no-unused-expressions': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'none', // allows unused variables in function arguments
          ignoreRestSiblings: true, // allows unused variables in object destructuring
          varsIgnorePattern: '_', // allows unused _ variables (for array destructuring)
          caughtErrors: 'none', // allow unused catch clause variables
        },
      ],
      '@typescript-eslint/no-use-before-define': 'off',
      '@typescript-eslint/no-var-requires': 'warn',
      '@typescript-eslint/prefer-for-of': 'error',
      '@typescript-eslint/prefer-function-type': 'error',
      '@typescript-eslint/prefer-namespace-keyword': 'error',
      '@stylistic/quotes': [
        'error',
        'single',
        {
          avoidEscape: true,
          allowTemplateLiterals: 'always',
        },
      ],
      '@typescript-eslint/semi': ['off', null],
      '@typescript-eslint/triple-slash-reference': [
        'error',
        {
          path: 'always',
          types: 'prefer-import',
          lib: 'always',
        },
      ],
      '@typescript-eslint/type-annotation-spacing': 'off',
      '@typescript-eslint/typedef': 'off',
      '@typescript-eslint/unified-signatures': 'error',
      'arrow-parens': ['off', 'always'],
      'brace-style': ['error', '1tbs'],
      'comma-dangle': [
        'error',
        {
          arrays: 'always-multiline',
          functions: 'never',
          imports: 'always-multiline',
          objects: 'always-multiline',
        },
      ],
      complexity: 'off',
      'constructor-super': 'error',
      curly: 'error',
      'dot-notation': 'off',
      'eol-last': 'error',
      eqeqeq: ['error', 'smart'],
      'guard-for-in': 'error',
      'id-denylist': 'error',
      'id-match': 'error',
      'import/no-extraneous-dependencies': 'error',
      'import/order': [
        'error',
        {
          alphabetize: {order: 'asc', caseInsensitive: true},
          'newlines-between': 'always',
          groups: [['builtin', 'object'], 'type', 'external', 'internal', 'parent', ['sibling', 'index']],
          // set different groups for 5 different import levels ('../../../../**', '../../../**', ...)
          pathGroups: [
            ...Array.from({length: 5}).map((_, index) => ({
              pattern: `${'../'.repeat(5 + 1 - index)}**`,
              group: 'parent',
              position: 'before',
            })),
          ],
        },
      ],
      indent: 'off', // enforced by prettier
      'linebreak-style': ['error', 'unix'],
      'max-classes-per-file': ['error', 3],
      'max-len': 'off',
      'new-parens': 'off',
      'newline-per-chained-call': 'off',
      'no-bitwise': 'error',
      'no-caller': 'error',
      'no-cond-assign': 'error',
      'no-console': 'off',
      'no-control-regex': 'off',
      'no-debugger': 'error',
      'no-empty': 'error',
      'no-empty-function': 'off',
      'no-eval': 'error',
      'no-extra-boolean-cast': 'off',
      'no-extra-semi': 'off',
      'no-fallthrough': 'off',
      'no-invalid-this': 'off',
      'no-irregular-whitespace': 'error',
      'no-multiple-empty-lines': 'error',
      'no-new-wrappers': 'error',
      'no-return-await': 'error',
      'no-shadow': 'off',
      'no-throw-literal': 'error',
      'no-trailing-spaces': 'error',
      'no-undef-init': 'error',
      'no-underscore-dangle': 'off',
      'no-unsafe-finally': 'error',
      'no-unsafe-member-access': 'off',
      'no-unused-expressions': 'off',
      'no-unused-labels': 'error',
      'no-unused-vars': 'off',
      'no-use-before-define': 'off',
      'no-var': 'error',
      'no-null/no-null': 'error',
      'object-shorthand': 'error',
      'one-var': ['error', 'never'],
      'padded-blocks': [
        'off',
        {
          blocks: 'never',
        },
        {
          allowSingleLineBlocks: true,
        },
      ],
      'padding-line-between-statements': [
        'error',
        {
          blankLine: 'always',
          prev: '*',
          next: 'return',
        },
      ],
      'prefer-arrow/prefer-arrow-functions': 'error',
      'prefer-const': 'error',
      'prefer-object-spread': 'error',
      'quote-props': ['error', 'as-needed'],
      quotes: 'off',
      radix: 'error',
      semi: 'off',
      'space-before-function-paren': 'off',
      'space-in-parens': ['off', 'never'],
      'spaced-comment': [
        'error',
        'always',
        {
          markers: ['/'],
        },
      ],
      'use-isnan': 'error',
      'valid-typeof': 'off',
      'jest/no-interpolation-in-snapshots': 'off', // allow showing from which variable comes a specific value in inline snapshots
      'jest/padding-around-test-blocks': 'error',
      'no-prototype-builtins': 'off',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...restrictedImports,
            // We only allow this in unit tests to mock `axios.create()`.
            {
              name: 'axios',
              importNames: ['default'],
              message: 'Please only import what you need from axios, e.g. `import {isAxiosError} from "axios"`',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value='/dev/null']",
          message: "Please use `os.devNull` instead of `'/dev/null'`.",
        },
        {
          // imported as `import os from 'os'`
          selector: "MemberExpression[object.name='os'][property.name='EOL']",
          message: 'Please use `\\n` instead of `os.EOL` when splitting the `stdout`/`stderr` into lines.',
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', {paths: restrictedImports}],
    },
  }
)
