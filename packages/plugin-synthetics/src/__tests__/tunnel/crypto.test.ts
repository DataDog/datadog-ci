import {generateOpenSSHKeys, parseSSHKey} from '../../tunnel/crypto'

describe('crypto', () => {
  test('should generate ECDSA public/private keys with OpenSSH format', () => {
    const {privateKey, publicKey} = generateOpenSSHKeys()

    const expectedPrivateKeyFormat = /-----BEGIN OPENSSH PRIVATE KEY-----(.|\n)*-----END OPENSSH PRIVATE KEY-----/
    expect(privateKey).toMatch(expectedPrivateKeyFormat)

    const expectedPublicKeyFormat = /ecdsa-sha2-nistp256 .*/
    expect(publicKey).toMatch(expectedPublicKeyFormat)
  })

  test('should parse SSH keys', () => {
    const {publicKey, privateKey} = generateOpenSSHKeys()
    const parsedPublicKey = parseSSHKey(publicKey)
    const parsedPrivateKey = parseSSHKey(privateKey)

    expect(parsedPublicKey.type).toBe('ecdsa-sha2-nistp256')
    expect(parsedPrivateKey.type).toBe('ecdsa-sha2-nistp256')

    expect(() => parseSSHKey('not a valid key')).toThrow('Unsupported key format')
  })
})
