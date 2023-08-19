import {EventEmitter, once} from 'events'

import type {ProxyAgent} from 'proxy-agent'
import type ws from 'ws'

// https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/readyState
const WEBSOCKET_OPEN = 1

export class WebSocket extends EventEmitter {
  private firstMessage?: Promise<ws.Data>
  private keepAliveWebsocket?: Promise<void> // Artificial promise that resolves when closing and will reject in case of error
  private websocket?: ws

  constructor(private url: string, private proxyAgent: ProxyAgent | undefined) {
    super()
  }

  /**
   * close will terminate the WebSocket connection
   */
  public async close(gracefullyClose = true) {
    if (this.websocket) {
      this.websocket.removeAllListeners()
      if (this.websocket.readyState === WEBSOCKET_OPEN) {
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
    await this.establishWebsocketConnection()
  }

  /**
   * duplex will create a duplex stream for the WS connection
   */
  public async duplex() {
    if (!this.websocket) {
      throw new Error('You must start the WebSocket connection before calling duplex')
    }

    const {createWebSocketStream} = await import('ws')

    return createWebSocketStream(this.websocket, {
      // Increase websocket buffer sizes from 16kb to 64kb.
      readableHighWaterMark: 64 * 1024,
      writableHighWaterMark: 64 * 1024,
    })
  }

  /**
   * keepAlive will return a promise to keep track of the tunnel connection
   */
  public keepAlive() {
    if (!this.keepAliveWebsocket) {
      // Use an artificial promise to keep track of the connection state and reconnect if necessary
      this.keepAliveWebsocket = this.establishWebsocketConnection()
    }

    return this.keepAliveWebsocket
  }

  /**
   * on allows to listen for WebSocket messages
   */
  public on(event: 'message', listener: (data: ws.Data) => void) {
    if (!this.websocket) {
      throw new Error('You must start the WebSocket connection before listening to messages')
    }

    this.websocket.on(event, listener)

    return this
  }

  /**
   * once allows to listen for a WebSocket message
   */
  public once(event: 'message', listener: (data: ws.Data) => void) {
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

  private async establishWebsocketConnection() {
    if (!this.websocket) {
      const {default: WS} = await import('ws')

      const options: ws.ClientOptions = {
        agent: this.proxyAgent,
      }

      this.websocket = new WS(this.url, options)
    }

    this.firstMessage = new Promise((firstMessageResolve, firstMessageReject) => {
      if (!this.websocket) {
        firstMessageReject(Error('Unable to start websocket connection'))
      } else {
        this.websocket.once('message', firstMessageResolve)
      }
    })

    return new Promise<void>((resolve, reject) => {
      if (!this.websocket) {
        // Should not happen since we already checked this above,
        // but TypeScript doesn't understand that.
        return
      }

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
    })
  }
}
