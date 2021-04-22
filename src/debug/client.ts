import { fromEvent, Observable, TeardownLogic, Subscriber } from 'rxjs'
import {
  ByebugConnected,
  ByebugConnection,
  ByebugCreated,
  ByebugConnectionEvent,
  ByebugReceived
} from './events'
import * as net from 'net'
import { logger } from 'vscode-debugadapter/lib/logger'

export interface ByebugCreationMethod {
  (opts: net.SocketConnectOpts): Observable<ByebugConnectionEvent>
}

export class ByebugObservable extends Observable<ByebugConnectionEvent> {
  private socket: net.Socket = new net.Socket({
    writable: true,
    readable: true
  })
  private static _connectionCounter = 1

  public connection: ByebugConnection

  static create: ByebugCreationMethod = (() => {
    const create: any = (opts: net.SocketConnectOpts) => {
      return new ByebugObservable(opts)
    }

    return <ByebugCreationMethod>create
  })()

  constructor(public opts: net.SocketConnectOpts) {
    super()

    const socket = new net.Socket({ writable: true, readable: true })
    const id = ByebugObservable._connectionCounter++

    this.connection = new ByebugConnection(id, socket, opts)
  }

  _subscribe(subscriber: Subscriber<ByebugConnectionEvent>): TeardownLogic {
    return new ByebugSubscriber(subscriber, this.connection)
  }
}

export class ByebugSubscriber extends Subscriber<ByebugConnectionEvent> {
  private chunks: Buffer[] = []
  private initial = true

  constructor(
    destinaion: Subscriber<ByebugConnectionEvent>,
    public connection: ByebugConnection
  ) {
    super(destinaion)

    this.connect()
  }

  private connect(): void {
    try {
      this.setupEvents()

      const event = new ByebugCreated(
        this.connection.id,
        this.connection.socket,
        this.connection.opts
      )
      this.next(event)

      this.connection.connect()
    } catch (err) {
      this.error(err)
    }
  }

  private setupEvents() {
    const readySubscrption = fromEvent<Error>(
      this.connection.socket,
      'ready'
    ).subscribe(() => {
      this.next(
        new ByebugConnected(
          this.connection.id,
          this.connection.socket,
          this.connection.opts
        )
      )
    })

    const errorSubscription = fromEvent<Error>(
      this.connection.socket,
      'error'
    ).subscribe(e => {
      this.error(e)
    })

    const closeSubscription = fromEvent<boolean>(
      this.connection.socket,
      'close'
    ).subscribe(() => {
      const event = new ByebugConnected(
        this.connection.id,
        this.connection.socket,
        this.connection.opts
      )
      this.next(event)
      this.complete()
    })

    const dataSubscription = fromEvent<Buffer>(
      this.connection.socket,
      'data'
    ).subscribe(data => {
      this.chunks.push(data)

      if (data.indexOf('PROMPT') === 0) {
        logger.log('got prompt')
        // we ended at the prompt, sending the chunks
        const event = new ByebugReceived(
          this.connection.id,
          this.connection.socket,
          this.connection.opts,
          Buffer.from(Buffer.concat(this.chunks)),
          this.initial
        )
        this.next(event)

        this.initial = false
        this.chunks = [] // reset buffer
      }
    })

    this.add(closeSubscription.unsubscribe)
    this.add(errorSubscription.unsubscribe)
    this.add(readySubscrption.unsubscribe)
    this.add(dataSubscription.unsubscribe)
  }

  public unsubscribe(): void {
    this.connection.destroy()
    super.unsubscribe()
  }
}
