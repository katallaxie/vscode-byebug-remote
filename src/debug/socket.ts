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
import * as net from 'net'
import { random, log } from './utils'

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
  private _initial = true

  constructor(
    configOrSource: ByebugSubjectConfig<T> | Observable<T>,
    destination?: Observer<T>
  ) {
    super()

    if (configOrSource instanceof Observable) {
      this.destination = destination
      this.source = configOrSource as Observable<T>
    } else {
      this._config = { ...this._config, ...configOrSource }
      this._output = new Subject<T>()
    }

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

  private _resetState() {
    this._socket = null

    if (!this.source) {
      this.destination = new ReplaySubject()
    }

    this._output = new Subject<T>()
  }

  multiplex(cmd: () => any): Observable<T> {
    return new Observable((observer: Observer<T>) => {
      try {
        this.next(cmd())
      } catch (err) {
        observer.error(err)
      }

      const subscription = this.subscribe(
        x => {
          try {
          } catch (err) {
            observer.error(err)
          }
        },
        err => observer.error(err),
        () => observer.complete()
      )

      return () => {
        subscription.unsubscribe()
      }
    })
  }

  private _connectSocket() {
    const observer = this._output

    let socket: net.Socket | null

    try {
      socket = new net.Socket({
        writable: true,
        readable: true
      })
      this._socket = socket
    } catch (e) {
      observer.error(e)
      return
    }

    const subscription = new Subscription(() => {
      this._socket = null
      if (socket) {
        socket.destroy()
      }
    })

    this._socket.addListener('ready', () => {
      const queue = this.destination

      if (queue && queue instanceof ReplaySubject) {
        subscription.add(
          (queue as ReplaySubject<T>).subscribe(this.destination)
        )
      }
    })

    this._socket.addListener('error', (e: Error) => {
      log(e)
      this._resetState()
      observer.error(e)
    })

    this._socket.addListener('close', (hasError: boolean) => {
      log('close')
      this._resetState()

      if (hasError) {
        return observer.error(new Error('transmission error'))
      }

      observer.complete()
    })

    const dataSubscription = fromEvent<Buffer>(this._socket, 'data').subscribe(
      data => {
        this._chunks.push(data)

        if (data.indexOf('PROMPT') === 0) {
          this.next(Buffer.from(Buffer.concat(this._chunks)))

          this.initial = false
          this.chunks = [] // reset buffer
        }
      }
    )

    this._socket.addListener('data', (data: Buffer) => {
      this._chunks.push(data)

      if (data.indexOf('PROMPT') === 0) {
        observer.next(Buffer.from(Buffer.concat(this.chunks)))

        this._initial = false
        this._chunks = [] // reset buffer
      }
    })

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
}
