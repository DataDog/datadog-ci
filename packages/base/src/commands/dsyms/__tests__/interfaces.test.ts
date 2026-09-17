import type {Dsym} from '../interfaces'

import {CompressedDsym} from '../interfaces'
import {AppleSymbolPlatform} from '../macho'

const dsym: Dsym = {
  bundle: '/tmp/example.dSYM',
  dwarf: [
    {
      arch: 'arm64',
      object: '/tmp/example.dSYM/Contents/Resources/DWARF/example',
      uuid: '00000000-1111-2222-3333-444444444444',
    },
  ],
}

const metadataFor = (compressedDsym: CompressedDsym) => {
  const event = compressedDsym.asMultipartPayload().content.get('event')
  if (event?.type !== 'string') {
    throw new Error('Expected event metadata')
  }

  return JSON.parse(event.value)
}

describe('CompressedDsym', () => {
  test('includes the detected macOS platform in upload metadata', () => {
    const compressedDsym = new CompressedDsym('/tmp/example.zip', dsym, AppleSymbolPlatform.MACOS)

    expect(metadataFor(compressedDsym)).toEqual({
      platform: 'macos',
      type: 'ios_symbols',
      uuids: '00000000-1111-2222-3333-444444444444',
    })
  })

  test('keeps upload metadata unchanged when the platform is not macOS', () => {
    const compressedDsym = new CompressedDsym('/tmp/example.zip', dsym)

    expect(metadataFor(compressedDsym)).toEqual({
      type: 'ios_symbols',
      uuids: '00000000-1111-2222-3333-444444444444',
    })
  })
})
