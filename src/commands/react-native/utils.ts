import events from 'events'
import fs from 'fs'
import readline from 'readline'

export const importEnvironmentFromFile = async (filePath: string) => {
  try {
    const lineReader = readline.createInterface({
      input: fs.createReadStream(filePath),
    })

    lineReader.on('line', (line) => {
      const parsedLine = parseLineFromPropertiesFile(line)
      if (parsedLine) {
        process.env[parsedLine.key] = parsedLine.value
      }
    })

    await events.once(lineReader, 'close')
  } catch (error) {
    throw new Error(`Issue reading env from ${filePath}: ${error}`)
  }
}

const parseLineFromPropertiesFile = (line: string): {key: string; value: string} | undefined => {
  const lineWithoutSpace = line.replace(/\s/g, '')
  if (lineWithoutSpace.length === 0) {
    return undefined
  }
  if (lineWithoutSpace[0] === '#') {
    return undefined
  }

  const [key, value] = lineWithoutSpace.split('=')
  if (value.length === 0) {
    return undefined
  }

  return {key, value}
}
