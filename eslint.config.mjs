import yml from 'eslint-plugin-yml'
import {defineConfig, globalIgnores} from 'eslint/config'

const yamlFiles = ['**/*.yml', '**/*.yaml']

export default defineConfig(
  globalIgnores([
    '.github/dependabot.yml',
    'packages/base/src/commands/flutter-symbols/__tests__/fixtures/pubspecs/invalidPubspec.yaml',
    'packages/base/src/helpers/__tests__/tags-fixtures/invalid/not-a-json.yaml',
  ]),
  ...yml.configs['flat/standard'],
  {
    files: yamlFiles,
    rules: {
      'yml/plain-scalar': 'off',
      'yml/quotes': 'off',
      'yml/no-empty-mapping-value': 'off',
    },
  },
)
