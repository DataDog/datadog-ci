import * as _m0 from 'protobufjs/minimal'

import {DeepPartial, Exact} from './sbom_intake'

export interface CustomMessage<T> {
  encode(message: T): _m0.Writer
  // eslint-disable-next-line @typescript-eslint/unified-signatures
  encode(message: T, writer: _m0.Writer): _m0.Writer
  decode(input: _m0.Reader | Uint8Array, length?: number): T
  fromJSON(object: any): T
  toJSON(message: T): unknown
  create<I extends Exact<DeepPartial<T>, I>>(base?: I): T
  fromPartial<I extends Exact<DeepPartial<T>, I>>(object: I): T
}
