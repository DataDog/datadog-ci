import fs from 'fs'
import {StringDecoder} from 'string_decoder'

import type {DebugIdExtractionResult} from './debugId'

import {isValidDebugId} from './debugId'

export const SOURCEMAP_DEBUG_ID_SEARCH_CHUNK_BYTES = 64 * 1024

type Container = '{' | '['
type StringRole = 'debug-id' | 'key' | 'other'
type TopLevelState = 'comma-or-end' | 'key-or-end' | 'value' | 'value-separator'

const matchingContainer = (container: Container): string => (container === '{' ? '}' : ']')
const isWhitespace = (character: string): boolean => /\s/u.test(character)

class TopLevelDebugIdParser {
  private containers: Container[] = []
  private currentKey?: string
  private debugId?: string
  private escaped = false
  private inString = false
  private primitive = ''
  private rootEnded = false
  private stringContent = ''
  private stringRole: StringRole = 'other'
  private topLevelState: TopLevelState = 'key-or-end'

  public finish(): DebugIdExtractionResult {
    if (this.inString || this.primitive || !this.rootEnded || this.containers.length !== 0) {
      throw new Error('sourcemap contains malformed JSON')
    }

    if (this.debugId === undefined) {
      return {}
    }

    return isValidDebugId(this.debugId) ? {debugId: this.debugId} : {error: 'sourcemap contains an invalid debug_id'}
  }

  public write(content: string): void {
    for (let index = 0; index < content.length; index++) {
      const character = content[index]

      if (this.inString) {
        this.consumeStringCharacter(character)

        continue
      }
      if (this.rootEnded) {
        if (!isWhitespace(character)) {
          throw new Error('sourcemap contains trailing content')
        }

        continue
      }
      if (this.containers.length === 0) {
        if (isWhitespace(character)) {
          continue
        }
        if (character !== '{') {
          throw new Error('sourcemap must be a JSON object')
        }
        this.containers.push('{')

        continue
      }
      if (this.containers.length > 1) {
        this.consumeNestedCharacter(character)

        continue
      }

      index = this.consumeTopLevelCharacter(content, index)
    }
  }

  private completeString(): void {
    if (this.stringRole === 'key') {
      this.currentKey = JSON.parse(`"${this.stringContent}"`) as string
      this.topLevelState = 'value-separator'
    } else if (this.stringRole === 'debug-id') {
      this.debugId = JSON.parse(`"${this.stringContent}"`) as string
      this.topLevelState = 'comma-or-end'
    } else if (this.containers.length === 1 && this.topLevelState === 'value') {
      this.topLevelState = 'comma-or-end'
    }

    this.stringContent = ''
    this.stringRole = 'other'
  }

  private consumeNestedCharacter(character: string): void {
    if (character === '"') {
      this.startString('other')
    } else if (character === '{' || character === '[') {
      this.containers.push(character)
    } else if (character === '}' || character === ']') {
      const container = this.containers.at(-1)!
      if (character !== matchingContainer(container)) {
        throw new Error('sourcemap contains malformed JSON')
      }
      this.containers.pop()
      if (this.containers.length === 1) {
        this.topLevelState = 'comma-or-end'
      }
    }
  }

  private consumePrimitiveCharacter(content: string, index: number): number {
    const character = content[index]
    if (character !== ',' && character !== '}') {
      if (!isWhitespace(character) || this.primitive.length > 0) {
        this.primitive += character
        if (this.primitive.length > 128) {
          throw new Error('sourcemap contains malformed JSON')
        }
      }

      return index
    }

    try {
      const parsed = JSON.parse(this.primitive) as unknown
      if (typeof parsed === 'object' && Boolean(parsed)) {
        throw new Error('invalid primitive')
      }
    } catch {
      throw new Error('sourcemap contains malformed JSON')
    }
    this.primitive = ''
    this.topLevelState = 'comma-or-end'

    return this.consumeTopLevelCharacter(content, index)
  }

  private consumeStringCharacter(character: string): void {
    if (character === '\n' || character === '\r') {
      throw new Error('sourcemap contains malformed JSON')
    }
    if (this.escaped) {
      this.escaped = false
      if (this.stringRole !== 'other') {
        this.stringContent += character
      }

      return
    }
    if (character === '\\') {
      this.escaped = true
      if (this.stringRole !== 'other') {
        this.stringContent += character
      }

      return
    }
    if (character === '"') {
      this.inString = false
      this.completeString()

      return
    }
    if (this.stringRole !== 'other') {
      this.stringContent += character
      if (this.stringContent.length > 128) {
        throw new Error('sourcemap contains malformed JSON')
      }
    }
  }

  private consumeTopLevelCharacter(content: string, index: number): number {
    const character = content[index]
    if (this.primitive) {
      return this.consumePrimitiveCharacter(content, index)
    }
    if (isWhitespace(character)) {
      return index
    }

    switch (this.topLevelState) {
      case 'key-or-end':
        if (character === '}') {
          this.containers.pop()
          this.rootEnded = true
        } else if (character === '"') {
          this.startString('key')
        } else {
          throw new Error('sourcemap contains malformed JSON')
        }
        break
      case 'value-separator':
        if (character !== ':') {
          throw new Error('sourcemap contains malformed JSON')
        }
        this.topLevelState = 'value'
        break
      case 'value':
        if (character === '"') {
          this.startString(this.currentKey === 'debug_id' ? 'debug-id' : 'other')
        } else if (character === '{' || character === '[') {
          if (this.currentKey === 'debug_id') {
            this.debugId = ''
          }
          this.containers.push(character)
        } else {
          if (this.currentKey === 'debug_id') {
            this.debugId = ''
          }
          this.primitive = character
        }
        break
      case 'comma-or-end':
        if (character === ',') {
          this.currentKey = undefined
          this.topLevelState = 'key-or-end'
        } else if (character === '}') {
          this.containers.pop()
          this.rootEnded = true
        } else {
          throw new Error('sourcemap contains malformed JSON')
        }
        break
    }

    return index
  }

  private startString(role: StringRole): void {
    this.escaped = false
    this.inString = true
    this.stringContent = ''
    this.stringRole = role
  }
}

export const extractSourcemapDebugId = async (sourcemapPath: string): Promise<DebugIdExtractionResult> => {
  try {
    const fileHandle = await fs.promises.open(sourcemapPath, 'r')
    try {
      const buffer = Buffer.alloc(SOURCEMAP_DEBUG_ID_SEARCH_CHUNK_BYTES)
      const decoder = new StringDecoder('utf8')
      const parser = new TopLevelDebugIdParser()
      let position = 0

      while (true) {
        const {bytesRead} = await fileHandle.read(buffer, 0, buffer.length, position)
        if (bytesRead === 0) {
          parser.write(decoder.end())

          return parser.finish()
        }
        parser.write(decoder.write(buffer.subarray(0, bytesRead)))
        position += bytesRead
      }
    } finally {
      await fileHandle.close()
    }
  } catch (error) {
    return {error: error instanceof Error ? error.message : String(error)}
  }
}
