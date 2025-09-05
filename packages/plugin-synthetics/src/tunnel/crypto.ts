import {generateKeyPairSync} from 'crypto'

import {ParsedKey, utils} from 'ssh2'
import {parseKey, parsePrivateKey} from 'sshpk'

// Generate public/private key in OpenSSH format (used for encryption in tunnel over SSH)
export const generateOpenSSHKeys = () => {
  const format = 'pem'
  const {publicKey, privateKey} = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    privateKeyEncoding: {
      format,
      type: 'pkcs8',
    },
    publicKeyEncoding: {
      format,
      type: 'spki',
    },
  })
  const openSSHPublicKey = parseKey(publicKey, format).toBuffer('ssh', {}).toString('utf-8')
  const openSSHPrivateKey = parsePrivateKey(privateKey, format).toBuffer('ssh', {}).toString('utf-8')

  return {
    privateKey: openSSHPrivateKey,
    publicKey: openSSHPublicKey,
  }
}

// Parse SSH key for ssh2 module
export const parseSSHKey = (key: string): ParsedKey => {
  const parsedKey = utils.parseKey(key)

  if (!parsedKey) {
    throw new Error(`Invalid key ${key}`)
  }

  if (parsedKey instanceof Error) {
    throw parsedKey
  }

  if (parsedKey instanceof Array) {
    // Multiple keys could be concatenated - in our use cases, a single key is expected
    if (parsedKey.length === 0) {
      throw new Error(`Invalid key ${key}`)
    }

    return parsedKey[0]
  }

  return parsedKey
}
