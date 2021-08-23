import {timingSafeEqual} from 'crypto'
import {Socket} from 'net'
import {Duplex, pipeline} from 'stream'

import chalk from 'chalk'
import {
  AuthContext,
  Connection as SSHConnection,
  Server as SSHServer,
  ServerChannel as SSHServerChannel,
  ServerConfig,
} from 'ssh2'
import {ParsedKey} from 'ssh2-streams'
import {Config as MultiplexerConfig, Server as Multiplexer} from 'yamux-js'
// tslint:disable-next-line:no-var-requires - SW-1310
const {KexInit} = require('ssh2/lib/protocol/kex')
// tslint:disable-next-line:no-var-requires - SW-1310
const SSH_CONSTANTS = require('ssh2/lib/protocol/constants')

import {ProxyConfiguration} from '../../helpers/utils'

import {generateOpenSSHKeys, parseSSHKey} from './crypto'
import {MainReporter} from './interfaces'
import {WebSocket} from './websocket'

export interface TunnelInfo {
  host: string
  id: string
  privateKey: string
}

export class Tunnel {
  private connected = false
  private forwardedSockets: Set<Socket> = new Set()
  private FORWARDING_TIMEOUT = 30000 as const
  private log: (message: string) => void
  private logError: (message: string) => void
  private logWarning: (message: string) => void
  private multiplexer?: Multiplexer
  private privateKey: string
  private publicKey: ParsedKey
  private sshConfig: ServerConfig
  private ws: WebSocket

  constructor(private url: string, private testIDs: string[], proxy: ProxyConfiguration, reporter: MainReporter) {
    this.log = (message: string) => reporter.log(`[${chalk.bold.blue('Tunnel')}] ${message}\n`)
    this.logError = (message: string) => reporter.error(`[${chalk.bold.red('Tunnel')}] ${message}\n`)
    this.logWarning = (message: string) => reporter.log(`[${chalk.bold.yellow('Tunnel')}] ${message}\n`)

    // Setup SSH
    const {privateKey: hostPrivateKey} = generateOpenSSHKeys()
    const parsedHostPrivateKey = parseSSHKey(hostPrivateKey)

    const {publicKey, privateKey} = generateOpenSSHKeys()
    this.publicKey = parseSSHKey(publicKey)
    this.privateKey = privateKey

    this.sshConfig = {
      algorithms: {
        serverHostKey: [parsedHostPrivateKey.type],
      },
      // Greatly increase highWaterMark (32kb -> 255kb) to avoid hanging with large requests
      highWaterMark: 255 * 1024,
      hostKeys: [hostPrivateKey],
    }

    this.ws = new WebSocket(this.url, proxy)
  }

  /**
   * keepAlive will return a promise that tracks the state of the tunnel (and reject in case of error)
   */
  public async keepAlive() {
    if (!this.ws || !this.ws.keepAlive()) {
      throw new Error('No WebSocket connection')
    }

    return this.ws.keepAlive()
  }

  /**
   * start the tunnel:
   *   - get the pre-signed URL to connect to the tunnel service
   *   - Set up SSH
   *   - establish a WebSocket connection to the tunnel service
   */
  public async start() {
    this.log(`Opening tunnel for ${chalk.bold.dim(...this.testIDs)}…`)

    this.log('Generating encryption key, setting up SSH and opening WebSocket connection…')
    try {
      // Establish a WebSocket connection to the tunnel service
      await this.ws.connect()
      // @todo: in case of reconnect, add tunnel ID to WebSocket URL to re-use the same tunnel (in the tunnel service)

      const connectionInfo = await this.forwardWebSocketToSSH()

      return connectionInfo
    } catch (err) {
      this.logError('Tunnel setup failed, cleaning up and exiting…')
      await this.stop() // Clean up
      throw err
    }
  }

  /**
   * stop the tunnel
   */
  public async stop() {
    this.log('Shutting down tunnel…')

    this.forwardedSockets.forEach((socket) => {
      if (!!socket) {
        socket.destroy()
      }
    })

    if (this.multiplexer) {
      this.multiplexer.close()
    }

    await this.ws.close()
  }

  // Authenticate SSH with key authentication - username should be the test ID
  private authenticateSSHConnection(ctx: AuthContext) {
    const allowedUsers = this.testIDs.map((testId) => Buffer.from(testId))
    // Ensure username is allowed
    const user = Buffer.from(ctx.username)
    if (!allowedUsers.some((allowedUser) => user.length === allowedUser.length && timingSafeEqual(user, allowedUser))) {
      return ctx.reject()
    }

    // Only allow key authentication
    if (ctx.method !== 'publickey') {
      return ctx.reject()
    }

    const allowedPubSSHKey = Buffer.from(this.publicKey.getPublicSSH())
    if (
      ctx.key.algo !== this.publicKey.type ||
      ctx.key.data.length !== allowedPubSSHKey.length ||
      !timingSafeEqual(ctx.key.data, allowedPubSSHKey) ||
      (ctx.signature && this.publicKey.verify(ctx.blob, ctx.signature) !== true)
    ) {
      // Invalid key authentication
      return ctx.reject()
    }

    // A connection without a signature is only to check for public key validity
    if (!ctx.signature) {
      return ctx.accept()
    }

    // Username is allowed and key authentication was successful
    if (!this.connected) {
      // Limit to one log per tunnel
      this.connected = true
      this.log('Successfully connected')
    }
    ctx.accept()
  }

  private forwardProxiedPacketsFromSSH(client: SSHConnection) {
    client
      .on('session', (accept) => {
        accept().on('close', () => {
          client.end()
        })
      })
      .on('tcpip', (accept, reject, {destIP, destPort}) => {
        // Forward packets
        // See https://github.com/mscdex/ssh2/issues/479#issuecomment-250416559
        let src: SSHServerChannel
        const dest = new Socket()

        dest.setTimeout(this.FORWARDING_TIMEOUT)
        this.forwardedSockets.add(dest)

        dest.on('timeout', () => {
          this.logWarning(`Connection timeout (${destIP})`)
          if (src) {
            src.destroy()
          } else {
            reject()
          }
          this.forwardedSockets.delete(dest)
          dest.end()
          dest.destroy()
        })

        dest.on('connect', () => {
          src = accept()
          if (!src) {
            return dest.end()
          }

          pipeline([dest, src], () => this.forwardedSockets.delete(dest))
          pipeline([src, dest], () => this.forwardedSockets.delete(dest))

          src.on('close', () => {
            dest.end()
            dest.destroy()
          })
        })
        dest.on('error', (error: NodeJS.ErrnoException) => {
          if (src) {
            this.logWarning(`Error on opened connection (${destIP}): ${error.code}`)
            src.close()
          } else {
            if ('code' in error && error.code === 'ENOTFOUND') {
              this.logWarning(`Unable to resolve host (${destIP})`)
              // SW-1340: Reject on DNS errors kill requests on the same SSH connection.
              accept().destroy()
            } else {
              this.logWarning(`Connection error (${destIP}): ${error.code}`)
              reject()
            }

            this.forwardedSockets.delete(dest)
            dest.end()
            dest.destroy()
          }
        })
        dest.on('close', () => {
          if (src) {
            src.close()
          } else {
            reject()
          }
          this.forwardedSockets.delete(dest)
        })
        dest.connect(destPort, destIP)
      })
      .on('request', (accept, reject, name, info) => {
        if (accept) {
          accept()
        }
      })
  }

  private async forwardWebSocketToSSH(): Promise<TunnelInfo> {
    const connectionInfo = await this.getConnectionInfo()
    this.log(`Websocket connection to tunnel ${connectionInfo.id} opened, proxy is ready!`)

    // Stop any existing multiplexing
    if (this.multiplexer) {
      this.multiplexer.close()
    }

    // Set up multiplexing
    const multiplexerConfig: MultiplexerConfig = {
      // Increase maximum backlog size to more easily handle
      // running multiple large browser tests in parallel.
      acceptBacklog: 2048,
      enableKeepAlive: false,
    }
    this.multiplexer = new Multiplexer((stream) => {
      stream.on('error', (error) => {
        this.logError(`Error in multiplexing: ${error}`)
      })

      this.processSSHStream(stream)
    }, multiplexerConfig)

    // Pipe WebSocket to multiplexing
    const duplex = this.ws.duplex()
    this.multiplexer.on('error', (error) => this.logError(`Multiplexer error: ${error.message}`))
    duplex.on('error', (error) => this.logError(`Websocket error: ${error.message}`))

    pipeline([duplex, this.multiplexer], (err) => {
      if (err) {
        this.logWarning(`Error on duplex connection close: ${err}`)
      }
    })
    pipeline([this.multiplexer, duplex], (err) => {
      if (err) {
        this.logWarning(`Error on Multiplexer connection close: ${err}`)
      }
    })

    return connectionInfo
  }

  private async getConnectionInfo() {
    const rawConnectionInfo = await this.ws.waitForFirstMessage()

    try {
      const connectionInfo: TunnelInfo = {
        privateKey: this.privateKey,
        ...JSON.parse(rawConnectionInfo.toString()),
      }

      return connectionInfo
    } catch {
      throw new Error(`Unexpected response from tunnel service: ${rawConnectionInfo.toString()}\n`)
    }
  }

  private async processSSHStream(stream: Duplex) {
    // Process SSH stream - see https://github.com/mscdex/ssh2/blob/v0.8.x/lib/server.js#L24
    const serverConfig = {
      ...this.sshConfig,
      keepaliveInterval: 0,
    }
    SSHServer.KEEPALIVE_CLIENT_INTERVAL = 0
    const server = new SSHServer(serverConfig, () => {
      // 'connection' event listener is required otherwise connection wont proceed.
    })
    const {ident} = this.sshConfig
    const hostKeys = {'ecdsa-sha2-nistp256': parseSSHKey(this.sshConfig.hostKeys[0] as string)}

    const encryptionConfig = {
      cipher: SSH_CONSTANTS.DEFAULT_CIPHER,
      compress: SSH_CONSTANTS.DEFAULT_COMPRESSION,
      lang: [],
      mac: SSH_CONSTANTS.DEFAULT_MAC,
    }
    const algorithms = {
      cs: encryptionConfig,
      kex: SSH_CONSTANTS.DEFAULT_KEX,
      sc: encryptionConfig,
      serverHostKey: ['ecdsa-sha2-nistp256'],
    }

    const offer = new KexInit(algorithms)
    const clientConfig = {
      ...this.sshConfig,
      keepaliveInterval: 0,
    }

    // SW-1310: Typing does not include IncomingClient
    const client: SSHConnection = new (SSHServer as any).IncomingClient(
      stream,
      hostKeys,
      ident,
      offer,
      undefined,
      server,
      clientConfig
    )

    client
      .on('authentication', (ctx) => this.authenticateSSHConnection(ctx))
      .on('ready', () => this.forwardProxiedPacketsFromSSH(client))
      .on('close', () => {
        server.close()
      })
      .on('error', (err) => {
        this.logError(`SSH error in proxy: ${err.message}`)
      })
  }
}
