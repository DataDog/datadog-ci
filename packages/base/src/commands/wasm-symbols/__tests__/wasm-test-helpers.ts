import {WASM_MAGIC, WASM_VERSION, WasmSectionId} from '../wasm-constants'

export const encodeUnsignedLEB128 = (value: number): Buffer => {
  const bytes: number[] = []
  let remaining = BigInt(value)
  do {
    // eslint-disable-next-line no-bitwise
    let byte = Number(remaining & BigInt(0x7f))
    // eslint-disable-next-line no-bitwise
    remaining >>= BigInt(7)
    if (remaining !== BigInt(0)) {
      // eslint-disable-next-line no-bitwise
      byte |= 0x80
    }
    bytes.push(byte)
  } while (remaining !== BigInt(0))

  return Buffer.from(bytes)
}

export const buildSection = (id: WasmSectionId, payload: Buffer): Buffer => {
  const size = encodeUnsignedLEB128(payload.length)

  return Buffer.concat([Buffer.from([id]), size, payload])
}

export const buildCustomSection = (name: string, payload: Buffer): Buffer => {
  const nameBuffer = Buffer.from(name, 'utf8')
  const nameLength = encodeUnsignedLEB128(nameBuffer.length)
  const content = Buffer.concat([nameLength, nameBuffer, payload])

  return buildSection(WasmSectionId.CUSTOM, content)
}

export const buildWasmModule = (sections: Buffer[]): Buffer => Buffer.concat([WASM_MAGIC, WASM_VERSION, ...sections])
