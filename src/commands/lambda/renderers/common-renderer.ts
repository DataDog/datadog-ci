import {bold, cyan, green, red, yellow} from 'chalk'

export const dryRunTag = bold(cyan('[Dry Run]'))
export const errorTag = bold(red('[Error]'))
export const warningTag = bold(yellow('[Warning]'))

export const warningExclamationSignTag = bold(yellow('[!]'))
export const successCheckmarkTag = bold(green('✔'))
export const failCrossTag = bold(red('✖'))
