const plugin = {
  meta: {
    name: 'datadog',
  },
  rules: {
    'no-dev-null': {
      meta: {
        type: 'problem',
        docs: {
          description: "Require 'os.devNull' instead of literal '/dev/null'",
        },
      },
      create(context) {
        return {
          Literal(node) {
            if (node.value === '/dev/null') {
              context.report({
                node,
                message: "Please use `os.devNull` instead of `'/dev/null'`.",
              })
            }
          },
        }
      },
    },
    'no-os-eol': {
      meta: {
        type: 'problem',
        docs: {
          description: "Disallow 'os.EOL'",
        },
      },
      create(context) {
        return {
          MemberExpression(node) {
            if (
              node.object &&
              node.object.type === 'Identifier' &&
              node.object.name === 'os' &&
              node.property &&
              node.property.type === 'Identifier' &&
              node.property.name === 'EOL'
            ) {
              context.report({
                node,
                message: 'Please use `\\n` instead of `os.EOL` when splitting the `stdout`/`stderr` into lines.',
              })
            }
          },
        }
      },
    },
    'no-direct-stream-write': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow direct writing to stdout/stderr in command entrypoints',
        },
      },
      create(context) {
        return {
          MemberExpression(node) {
            if (
              node.object &&
              node.object.type === 'MemberExpression' &&
              node.object.object &&
              node.object.object.type === 'ThisExpression' &&
              node.object.property &&
              node.object.property.name === 'context' &&
              node.property &&
              (node.property.name === 'stdout' || node.property.name === 'stderr')
            ) {
              context.report({
                node,
                message:
                  'Log through `this.logger` instead of writing to `this.context.stdout`/`this.context.stderr` directly.',
              })
            }
            if (
              node.object &&
              node.object.type === 'Identifier' &&
              node.object.name === 'process' &&
              node.property &&
              (node.property.name === 'stdout' || node.property.name === 'stderr')
            ) {
              context.report({
                node,
                message:
                  'Log through `this.logger` instead of writing to `process.stdout`/`process.stderr` directly.',
              })
            }
          },
        }
      },
    },
  },
}

export default plugin
