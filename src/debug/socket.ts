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
export interface CommandArguments {
  completed?: Observer<true>
}

export class ByebugSubject<T> extends AnonymousSubject<T> {
  _config: ByebugSubjectConfig<T> = DEFAULT_BYEBUG_CONFIG
  _output: Subject<T> = new Subject<T>()
  _sendComplete: Subject<true> = new Subject<true>()

  private _socket: net.Socket | null = null
  private _chunks: Buffer[] = []
  private _dataSubscription: Subscription | null = null
  private _closeSubscription: Subscription | null = null
  private _errorSubscription: Subscription | null = null
  private _readySubscription: Subscription | null = null

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

  multiplex(cmd: () => any, args: CommandArguments): Observable<T> {
    return new Observable((observer: Observer<T>) => {
      try {
        this.next(cmd())
      } catch (e) {
        observer.error(e)
      }

      const subscription = this.subscribe(
        x => {
          try {
            observer.next(x)
          } catch (err) {
            observer.error(err)
          }
        },
        err => () => {
          observer.error(err)
        },
        () => {
          observer.complete()
        }
      )

      return () => {
        subscription.unsubscribe()
      }
    })
  }

  continue(): Observable<T> {
    return this.multiplex(() => 'continue', {})
  }

  backtrace(): Observable<T> {
    return this.multiplex(() => 'backtrace', {})
  }

  stepIn(): Observable<T> {
    return this.multiplex(() => 'step', {})
  }

  setBreakpoint(file: string, line: number): Observable<T> {
    log(`break ${file}:${line}`)
    return this.multiplex(() => `break ${file}:${line}`, {})
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
          try {
            this._socket?.write(`${x}\n` as any)
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
        s.end(data.toString())

        const l = rl.createInterface({ input: s })

        for await (const line of l) {
          if (line.indexOf('PROMPT') === 0) {
            observer.next(Buffer.from(Buffer.concat(this._chunks)) as any)

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

      // if (this._output.observers.length === 0) {
      //   if (_socket) {
      //     _socket.destroy()
      //   }

      //   this._resetState()
      // }

      // if (this._dataSubscription) {
      //   log('unsubscribe')
      //   this._dataSubscription.unsubscribe()
      // }

      // if (this._errorSubscription) {
      //   this._errorSubscription.unsubscribe()
      // }

      // if (this._closeSubscription) {
      //   this._closeSubscription.unsubscribe()
      // }

      // if (this._readySubscription) {
      //   this._readySubscription.unsubscribe()
      // }
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
