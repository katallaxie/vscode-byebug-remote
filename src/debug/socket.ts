import { AnonymousSubject } from 'rxjs/internal/Subject'
import {
  Observable,
  Observer,
  Operator,
  ReplaySubject,
  Subject,
  Subscriber,
  Subscription
} from 'rxjs'
import * as net from 'net'

export interface ByebugSubjectConfig<T> {
  host: string
  port: number
}

const DEFAULT_BYEBUG_CONFIG: ByebugSubjectConfig<any> = {
  host: '127.0.0.1',
  port: 12345
}

export class ByebugSubject<T> extends AnonymousSubject<T> {
  _config: ByebugSubjectConfig<T>
  _output: Subject<T>

  private _socket: net.Socket | null

  constructor(
    configOrSource: ByebugSubjectConfig<T> | Observable<T>,
    destination?: Observer<T>
  ) {
    super()

    if (configOrSource instanceof Observable) {
      this.destination = destination
      this.source = configOrSource as Observable<T>
    } else {
      const config = (this._config = { ...DEFAULT_BYEBUG_CONFIG })
      this._output = new Subject<T>()
    }

    this.destination = new ReplaySubject()
  }

  lift<R>(operator: Operator<T, R>): ByebugSubject<R> {
    const byebug = new ByebugSubject<R>(this._output)
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
      socket = new net.Socket({ writable: true, readable: true })
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

    this._socket.addListener('ready', () => {})
    this._socket.addListener('close', () => {})
  }

  protected _subscribe(subscriber: Subscriber<T>): Subscription {
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

  unsubscribe() {
    const { _socket } = this
    if (_socket) {
      _socket.destroy()
    }
    this._resetState()
    super.unsubscribe()
  }
}
