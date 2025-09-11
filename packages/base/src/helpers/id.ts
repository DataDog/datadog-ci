/* eslint-disable */
// Eslint disabled because we're doing bitwise logic, which isn't allowed by the linter
// From https://github.com/DataDog/dd-trace-js/blob/e4b9a268f0429b6f1e92c384b61a0d104aeb1259/packages/dd-trace/src/id.js
import {randomFillSync} from 'crypto'

const UINT_MAX = 4294967296

const data = new Uint8Array(8 * 8192)

let batch = 0

// Convert a buffer to a numerical string.
const toNumberString = (buffer: number[]) => {
  const radix = 10
  let high = readInt32(buffer, buffer.length - 8)
  let low = readInt32(buffer, buffer.length - 4)
  let str = ''

  while (true) {
    const mod = (high % radix) * UINT_MAX + low

    high = Math.floor(high / radix)
    low = Math.floor(mod / radix)
    str = (mod % radix).toString(radix) + str

    if (!high && !low) {
      break
    }
  }

  return str
}

// Simple pseudo-random 64-bit ID generator.
const pseudoRandom = () => {
  if (batch === 0) {
    randomFillSync(data)
  }

  batch = (batch + 1) % 8192

  const offset = batch * 8

  return [
    data[offset] & 0x7f, // only positive int64,
    data[offset + 1],
    data[offset + 2],
    data[offset + 3],
    data[offset + 4],
    data[offset + 5],
    data[offset + 6],
    data[offset + 7],
  ]
}

// Read a buffer to unsigned integer bytes.
const readInt32 = (buffer: number[], offset: number) => {
  return buffer[offset + 0] * 16777216 + (buffer[offset + 1] << 16) + (buffer[offset + 2] << 8) + buffer[offset + 3]
}

export default () => toNumberString(pseudoRandom())
