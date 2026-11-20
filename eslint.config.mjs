// ESLint only lints YAML files. TypeScript is linted by Oxlint (`.oxlintrc.json`).
import {defineConfig, globalIgnores} from 'eslint/config'
import yml from 'eslint-plugin-yml'

export default defineConfig(
  globalIgnores([
    'packages/*/dist',
    '.github/dependabot.yml',
    'packages/base/src/commands/flutter-symbols/__tests__/fixtures/pubspecs/invalidPubspec.yaml',
    'packages/base/src/helpers/__tests__/tags-fixtures/invalid/not-a-json.yaml',
  ]),
  ...yml.configs['flat/standard'],
  {
    rules: {
      'yml/plain-scalar': 'off',
      'yml/quotes': 'off',
      'yml/no-empty-mapping-value': 'off',
    },
  }
)
