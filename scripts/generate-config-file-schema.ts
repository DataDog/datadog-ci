import {writeFileSync} from 'fs'
import {cli} from '../src/cli'
import {createGenerator} from 'ts-json-schema-generator'

const commands = Array.from(cli['registrations'].values())
const commandsWithOptions = commands.filter((c) => c.builder.options.length > 0)
const optionsPerScope = commandsWithOptions.reduce(
  (acc, c) => {
    const scope = c.builder.paths[0][0]
    if (!acc[scope]) {
      acc[scope] = []
    }
    acc[scope].push(c.builder.options)
    return acc
  },
  {} as Record<string, unknown[]>
)

const generator = createGenerator({
  path: 'src/schema.ts',
  type: 'DatadogCiConfig',
  topRef: false,
  skipTypeCheck: true,
})

const schema = generator.createSchema()

writeFileSync('datadog-ci.schema.json', JSON.stringify(schema, null, 2))
