import {EventEmitter, once} from 'events'

import type {ProxyAgent} from 'proxy-agent'

import {createWebSocketStream, default as WebSocketModule} from 'ws'

export class WebSocket extends EventEmitter {
  private firstMessage?: Promise<WebSocketModule.Data>
  private keepAliveWebsocket?: Promise<void> // Artificial promise that resolves when closing and will reject in case of error
  private websocket?: WebSocketModule

  constructor(private url: string, private proxyAgent: ProxyAgent | undefined) {
    super()
  }

  /**
   * close will terminate the WebSocket connection
   */
  public async close(gracefullyClose = true) {
    if (this.websocket) {
      this.websocket.removeAllListeners()
      if (this.websocket.readyState === WebSocketModule.OPEN) {
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
      this.keepAliveWebsocket = new Promise((resolve, reject) => this.establishWebsocketConnection(resolve, reject))
    }

    return this.keepAliveWebsocket
  }

  /**
   * on allows to listen for WebSocket messages
   */
  public on(event: 'message', listener: (data: WebSocketModule.Data) => void) {
    if (!this.websocket) {
      throw new Error('You must start the WebSocket connection before listening to messages')
    }

    this.websocket.on(event, listener)

    return this
  }

  /**
   * once allows to listen for a WebSocket message
   */
  public once(event: 'message', listener: (data: WebSocketModule.Data) => void) {
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
      const options: WebSocketModule.ClientOptions = {
        agent: this.proxyAgent,
      }

      this.websocket = new WebSocketModule(this.url, options)
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
  }
}
