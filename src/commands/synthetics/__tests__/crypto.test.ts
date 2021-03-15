import {generateOpenSSHKeys, parseSSHKey} from '../crypto'

describe('crypto', () => {
  test('should generate Ed25519 public/private keys with OpenSSH format', () => {
    const {privateKey, publicKey} = generateOpenSSHKeys()

    const expectedPrivateKeyFormat = /-----BEGIN OPENSSH PRIVATE KEY-----(.|\n)*-----END OPENSSH PRIVATE KEY-----/
    expect(privateKey).toEqual(expect.stringMatching(expectedPrivateKeyFormat))

    const expectedPublicKeyFormat = /ssh-ed25519 .*/
    expect(publicKey).toEqual(expect.stringMatching(expectedPublicKeyFormat))
  })

  test('should parse SSH keys', () => {
    const {publicKey, privateKey} = generateOpenSSHKeys()
    const parsedPublicKey = parseSSHKey(publicKey)
    const parsedPrivateKey = parseSSHKey(privateKey)

    expect(parsedPublicKey.type).toBe('ssh-ed25519')
    expect(parsedPrivateKey.type).toBe('ssh-ed25519')

    expect(() => parseSSHKey('not a valid key')).toThrow('Unsupported key format')
  })
})
