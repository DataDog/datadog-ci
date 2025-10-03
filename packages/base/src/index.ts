import {BaseContext, Command} from 'clipanion'

export type CommandContext = BaseContext

/**
 * This command should be extended by **every** command in the monorepo.
 */
export abstract class BaseCommand extends Command<CommandContext> {}
