import {spawn} from 'child_process'
import {Command} from 'clipanion'
import tracer from 'dd-trace'

import {getCIMetadata} from '../../helpers/ci'
import {CI_PIPELINE_URL, CI_PROVIDER_NAME, GIT_BRANCH, GIT_SHA, PARENT_SPAN_ID, TRACE_ID} from '../../helpers/tags'

export class TraceInstructionCommand extends Command {
  public static usage = Command.Usage({
    description: 'Trace your CI commands.',
    details: `
            This command will allow you to wrap any instruction and create a span associated to it.
        `,
    examples: [['Trace your test command', 'datadog-ci trace command yarn test']],
  })
  private instruction: string[] = []

  public async execute() {
    if (!this.instruction.length) {
      throw new Error('No instruction to trace')
    }
    tracer.init()

    const ciMetadata = getCIMetadata()
    let parentSpan

    if (ciMetadata?.trace) {
      const {
        trace: {parentSpanId, traceId},
      } = ciMetadata
      parentSpan =
        tracer.extract('text_map', {
          [PARENT_SPAN_ID]: parentSpanId,
          [TRACE_ID]: traceId,
        }) || undefined
    }

    const instruction = this.instruction.join(' ')

    tracer.trace(
      instruction,
      {childOf: parentSpan},
      (span) =>
        new Promise<number>((resolve) => {
          const [command, ...rest] = this.instruction

          const commandToTrace = spawn(command, rest)
          process.stdin.pipe(commandToTrace.stdin)

          commandToTrace.stdout.pipe(this.context.stdout)
          commandToTrace.stderr.pipe(this.context.stderr)

          commandToTrace.on('exit', (exitCode: number) => {
            span?.addTags({
              error: exitCode === 0 ? 0 : 1,
              exit_code: exitCode,
              instruction,
            })
            if (ciMetadata) {
              const {
                ci: {
                  pipeline: {url: pipelineUrl},
                  provider: {name: providerName},
                },
                git: {branch, commitSha},
              } = ciMetadata
              span?.addTags({
                [CI_PIPELINE_URL]: pipelineUrl,
                [CI_PROVIDER_NAME]: providerName,
                [GIT_BRANCH]: branch,
                [GIT_SHA]: commitSha,
              })
            }

            resolve(exitCode)
          })
        })
    )
  }
}
TraceInstructionCommand.addPath('trace', 'command')
TraceInstructionCommand.addOption('instruction', Command.Proxy())
