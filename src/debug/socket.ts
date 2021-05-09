import { AnonymousSubject } from 'rxjs/internal/Subject'
import {
  Observable,
  Observer,
  Operator,
  ReplaySubject,
  Subject,
  Subscriber,
  Subscription,
  fromEvent
} from 'rxjs'
import * as rl from 'readline'
import * as stream from 'stream'
import * as net from 'net'
import { log } from './utils'

export interface ByebugSubjectConfig<T> {
  host: string
  port: number
}

const DEFAULT_BYEBUG_CONFIG: ByebugSubjectConfig<any> = {
  host: '127.0.0.1',
  port: 12345
}

export type ByebugMessage = string | Buffer

export class ByebugSubject<T> extends AnonymousSubject<T> {
  _config: ByebugSubjectConfig<T> = DEFAULT_BYEBUG_CONFIG
  _output: Subject<T> = new Subject<T>()

  private _socket: net.Socket | null = null
  private _chunks: Buffer[] = []
  private _dataSubscription: Subscription | null = null
  private _closeSubscription: Subscription | null = null
  private _errorSubscription: Subscription | null = null
  private _readySubscription: Subscription | null = null
  private _initial = false

  constructor(
    configOrSource: ByebugSubjectConfig<T> | Observable<T>,
    destination?: Observer<T>
  ) {
    super()

    if (configOrSource instanceof Observable) {
      this.destination = destination
      this.source = configOrSource as Observable<T>
      return
    }

    this._config = { ...this._config, ...configOrSource }
    this._output = new Subject<T>()

    this.destination = new ReplaySubject()
  }

  lift<R>(operator: Operator<T, R>): ByebugSubject<R> {
    const byebug = new ByebugSubject<R>(
      this._config as ByebugSubjectConfig<any>,
      this.destination as any
    )
    byebug.operator = operator
    byebug.source = this

    return byebug
  }

  multiplex(cmd: () => any): Observable<T> {
    return new Observable((observer: Observer<T>) => {
      try {
        this.next(cmd())
      } catch (e) {
        observer.error(e)
      }

      const subscription = this.subscribe(
        x => {
          log('incming')
          log((<any>x).toString())
          try {
          } catch (err) {
            log(err)
            observer.error(err)
          }
        },
        err => () => {
          log(err)
          observer.error(err)
        },
        () => observer.complete()
      )

      return () => {
        subscription.unsubscribe()
      }
    })
  }

  private _connectSocket() {
    const observer = this._output

    this._socket = new net.Socket({
      writable: true,
      readable: true
    })

    // Subscription to govern replay subject
    const subscription = new Subscription(() => {
      if (!this._socket?.destroyed) {
        this._socket?.destroy
      }
      this._socket = null
    })

    this._readySubscription = fromEvent(this._socket, 'ready').subscribe(() => {
      const queue = this.destination // replay subject

      this.destination = Subscriber.create<T>(
        x => {
          log(x)
          try {
            this._socket?.write(`${x} breakpoints\n` as any)
          } catch (e) {
            this.destination?.error(e)
          }
        },
        err => {
          observer.error(err)
        },
        () => {
          this._socket?.destroy()
        }
      ) as Subscriber<any>

      if (queue && queue instanceof ReplaySubject) {
        subscription.add(
          (queue as ReplaySubject<T>).subscribe(this.destination)
        )
      }
    })

    this._errorSubscription = fromEvent<Error>(this._socket, 'error').subscribe(
      e => {
        this._resetState()
        observer.error(e)
      }
    )

    this._closeSubscription = fromEvent<boolean>(
      this._socket,
      'close'
    ).subscribe(hasError => {
      this._resetState()

      if (hasError) {
        return observer.error(new Error('transmission error'))
      }

      observer.complete()
    })

    this._dataSubscription = fromEvent<Buffer>(this._socket, 'data').subscribe(
      async data => {
        this._chunks.push(data)

        const s = new stream.PassThrough()
        s.end(data)

        const l = rl.createInterface({ input: s })

        for await (const line of l) {
          if (line.indexOf('PROMPT') === 0) {
            observer.next(
              Buffer.from(Buffer.concat(this._chunks)).toString() as any
            )

            this._initial = false
            this._chunks = [] // reset buffer

            break
          }
        }
      }
    )

    try {
      this._socket.connect({
        host: this._config.host,
        port: this._config.port
      })
    } catch (e) {
      observer.error(e)
    }
  }

  _subscribe(subscriber: Subscriber<T>): Subscription {
    const { source } = this
    if (source) {
      return source.subscribe(subscriber)
    }

    if (!this._socket) {
      this._connectSocket()
    }

    this._output.subscribe(subscriber)

    subscriber.add(() => {
      const { _socket } = this

      if (this._output.observers.length === 0) {
        if (_socket) {
          _socket.destroy()
        }

        this._resetState()
      }

      if (this._dataSubscription) {
        this._dataSubscription.unsubscribe()
      }

      if (this._errorSubscription) {
        this._errorSubscription.unsubscribe()
      }

      if (this._closeSubscription) {
        this._closeSubscription.unsubscribe()
      }

      if (this._readySubscription) {
        this._readySubscription.unsubscribe()
      }
    })

    return subscriber
  }

  unsubscribe(): void {
    const { _socket } = this
    if (_socket) {
      _socket.destroy()
    }
    this._resetState()
    super.unsubscribe()
  }

  private _resetState() {
    this._socket = null

    if (!this.source) {
      this.destination = new ReplaySubject()
    }

    this._output = new Subject<T>()
  }
}
