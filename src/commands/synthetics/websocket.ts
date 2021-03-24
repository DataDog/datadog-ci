import {EventEmitter, once} from 'events'
import type {Agent} from 'http'
import {Writable} from 'stream'

import ProxyAgent from 'proxy-agent'
import WebSocket, {createWebSocketStream} from 'ws'

import {ProxyConfiguration} from '../../helpers/utils'

/**
 * TODO: test websocket class:
 *  - connect
 *  - close
 *  - duplex
 *  - keepAlive
 *  - on/once message
 */
export class WebSocketWithReconnect extends EventEmitter {
  private firstMessage?: Promise<WebSocket.Data>
  private keepAliveWebsocket?: Promise<void> // Artificial promise that resolves when closing and will reject in case of error
  private reconnectRetries = 0
  private websocket?: WebSocket

  constructor(
    private url: string,
    private log: Writable['write'],
    private proxyOpts: ProxyConfiguration,
    private reconnectMaxRetries = 3,
    private reconnectInterval = 3000 // In ms
  ) {
    super()
  }

  /**
   * close will terminate the WebSocket connection
   */
  public async close(gracefullyClose = true) {
    if (this.websocket) {
      this.websocket.removeAllListeners()
      if (this.websocket.readyState === WebSocket.OPEN) {
        if (gracefullyClose) {
          // Gracefully close the tunnel
          this.websocket.close()
          await once(this.websocket, 'close')
        }
        // Clean up the underlying socket
        this.websocket.terminate()
      }
      this.websocket = undefined
    }
  }

  /**
   * connect will start a WebSocket connection
   */
  public async connect() {
    // Open the connection or throw
    await new Promise((resolve, reject) => this.establishWebsocketConnection(resolve, reject))
  }

  /**
   * duplex will create a duplex stream for the WS connection
   */
  public duplex() {
    if (!this.websocket) {
      throw new Error('You must start the WebSocket connection before calling duplex')
    }

    return createWebSocketStream(this.websocket)
  }

  /**
   * keepAlive will return a promise to keep track of the tunnel connection
   */
  public keepAlive() {
    if (!this.keepAliveWebsocket) {
      // Use an artificial promise to keep track of the connection state and reconnect if necessary
      this.keepAliveWebsocket = new Promise((resolve, reject) => this.establishWebsocketConnection(resolve, reject))
    }

    return this.keepAliveWebsocket
  }

  /**
   * on allows to listen for WebSocket messages
   */
  public on(event: 'message', listener: (data: WebSocket.Data) => void) {
    if (!this.websocket) {
      throw new Error('You must start the WebSocket connection before listening to messages')
    }

    this.websocket.on(event, listener)

    return this
  }

  /**
   * once allows to listen for a WebSocket message
   */
  public once(event: 'message', listener: (data: WebSocket.Data) => void) {
    if (!this.websocket) {
      throw new Error('You must start the WebSocket connection before listening to messages')
    }

    this.websocket.once(event, listener)

    return this
  }

  public waitForFirstMessage() {
    if (!this.firstMessage) {
      throw new Error('Websocket connection was not established before reading first message')
    }

    return this.firstMessage
  }

  private establishWebsocketConnection(resolve: (value: void) => void, reject: (error: Error) => void) {
    if (!this.websocket) {
      this.reconnectRetries++
      const options: WebSocket.ClientOptions = {}
      if (this.proxyOpts.host && this.proxyOpts.port) {
        options.agent = (new ProxyAgent(this.proxyOpts) as unknown) as Agent // Proxy-agent typings are incomplete
      }
      this.websocket = new WebSocket(this.url, options)
    }

    this.firstMessage = new Promise((firstMessageResolve, firstMessageReject) => {
      if (!this.websocket) {
        firstMessageReject(Error('Unable to start websocket connection'))
      } else {
        this.websocket.once('message', firstMessageResolve)
      }
    })

    this.websocket.on('unexpected-response', (req, res) => {
      let body = ''
      res.on('readable', () => {
        body += res.read()
      })
      res.on('end', () => {
        reject(Error(`Got unexpected response in WebSocket connection (code: ${res.statusCode}): ${body}`))
      })
      req.end()
      res.destroy()
    })

    this.websocket.on('open', () => {
      resolve()
    })

    this.websocket.on('close', (code, reason) => {
      this.onCloseWithReconnect(code, reason, resolve, reject)
    })

    this.websocket.on('error', (error) => {
      this.onErrorWithReconnect(error, reject)
    })
  }

  private onCloseWithReconnect(code: number, reason: string, resolve: () => void, reject: (error: Error) => void) {
    switch (code) {
      case 1000: // CLOSE_NORMAL
        resolve()

        return
      default:
        // Abnormal closure, try to reconnect
        this.close(false) // Clean up before reconnecting

        if (this.reconnectRetries >= this.reconnectMaxRetries) {
          reject(Error('Cannot connect to WebSocket - too many retries'))

          return
        }

        this.log(`Lost WebSocket connection (code ${code}, reason: "${reason}"), reconnecting…`)
        this.reconnect(this.reconnectInterval, resolve, reject)
    }
  }

  private onErrorWithReconnect(err: Error, reject: (error: Error) => void) {
    const retryableErrors = ['ECONNREFUSED']
    if (
      retryableErrors.some((retryableError) => err.message.includes(retryableError)) &&
      this.reconnectRetries < this.reconnectMaxRetries
    ) {
      // We can try to reconnect so not sending back the error
      return
    }

    reject(err)
  }

  private reconnect(delay: number, resolve: () => void, reject: (error: Error) => void) {
    const reconnectTimeout = setTimeout(() => {
      clearTimeout(reconnectTimeout)
      this.establishWebsocketConnection(resolve, reject)
    }, delay)
  }
}
