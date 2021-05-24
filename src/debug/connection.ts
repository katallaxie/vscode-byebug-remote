import {
  Observable,
  Observer,
  ReplaySubject,
  Subject,
  Subscription,
  fromEvent,
  BehaviorSubject
} from 'rxjs'
import * as net from 'net'
import * as stream from 'stream'
import * as rl from 'readline'
import { log } from './utils'

export type ByebugCommandBacktrace = { type: 'backtrace'; args: string[] }
export type ByebugCommandContinue = { type: 'continue'; args: string[] }
export type ByebugCommandRestart = { type: 'restart'; args: string[] }
export type ByebugCommandStep = { type: 'step'; args: string[] }
export type ByebugCommandBreakpoint = { type: 'break'; args: string[] }

export type ByebugCommand =
  | ByebugCommandBacktrace
  | ByebugCommandContinue
  | ByebugCommandRestart
  | ByebugCommandStep
  | ByebugCommandBreakpoint

// export class Connection extends Client {}
export class Connection {
  private _output: Subject<Buffer> = new Subject<Buffer>()
  private _socket: net.Socket
  private _chunks: Buffer[] = []
  private _destination = new ReplaySubject<ByebugCommand>()
  private _config = { host: '127.0.0.0', port: 123456 }
  private _connected$ = new BehaviorSubject<boolean>(false)

  private _dataSubscription: Subscription | null = null
  private _closeSubscription: Subscription | null = null
  private _errorSubscription: Subscription | null = null
  private _readySubscription: Subscription | null = null

  constructor(host = '127.0.0.0', port = 123456) {
    this._socket = new net.Socket({
      writable: true,
      readable: true
    })
    this._config = { host, port }
  }

  /**
   * Is connection connected
   */
  get connected$(): BehaviorSubject<boolean> {
    return this._connected$
  }

  /**
   * Send commands
   *
   * @param cmd
   * @returns
   */
  send(cmd: ByebugCommand): Observable<Buffer> {
    return new Observable((observer: Observer<Buffer>) => {
      const chunks: Buffer[] = []

      const subscription = fromEvent<Buffer>(this._socket, 'data').subscribe(
        async data => {
          chunks.push(data)

          const s = new stream.PassThrough()
          s.end(data.toString())

          const l = rl.createInterface({ input: s })

          for await (const line of l) {
            if (line.indexOf('PROMPT') === 0) {
              observer.next(Buffer.from(Buffer.concat(chunks)))
              observer.complete()
              break
            }
          }
        }
      )

      try {
        this._socket?.write(`${[cmd.type, ...cmd.args].join(' ')}\n`)
      } catch (e) {
        observer.error(e)
      }

      return () => {
        subscription.unsubscribe()
      }
    })
  }

  /**
   * Continue execution
   *
   * @returns
   */
  continue(): Observable<Buffer> {
    return this.send({ type: 'continue', args: [] })
  }

  /**
   * Get backtrace
   *
   * @returns
   */
  backtrace(): Observable<Buffer> {
    return this.send({ type: 'backtrace', args: [] })
  }

  /**
   * Step into breakpoint or hold
   *
   * @returns
   */
  stepIn(): Observable<Buffer> {
    return this.send({ type: 'step', args: [] })
  }

  /**
   * Restart the server
   *
   * @returns
   */
  restart(): Observable<Buffer> {
    return this.send({ type: 'restart', args: [] })
  }

  /**
   * Set a breakpoint
   *
   * @param file
   * @param line
   * @returns
   */
  setBreakpoint(file: string, line: string): Observable<Buffer> {
    return this.send({ type: 'break', args: [[file, ':', line].join('')] })
  }

  /**
   *
   */
  connect(): Observable<Buffer> {
    return new Observable((observer: Observer<Buffer>) => {
      this._closeSubscription = fromEvent<boolean>(
        this._socket,
        'close'
      ).subscribe(hasError => {
        if (hasError) {
          return this.connected$.error(new Error('transmission error'))
        }

        this.connected$.next(false)
      })

      const chunks: Buffer[] = []
      const subscription = fromEvent<Buffer>(this._socket, 'data').subscribe(
        async data => {
          chunks.push(data)

          const s = new stream.PassThrough()
          s.end(data.toString())

          const l = rl.createInterface({ input: s })

          for await (const line of l) {
            if (line.indexOf('PROMPT') === 0) {
              log('have seen prompt')
              observer.complete()

              break
            }
          }
        }
      )

      this._errorSubscription = fromEvent<Error>(
        this._socket,
        'error'
      ).subscribe(e => {
        this.connected$.error(e)
      })

      try {
        this._socket.connect({
          host: this._config.host,
          port: this._config.port
        })
      } catch (e) {
        observer.error(e)
      }

      return () => {
        subscription.unsubscribe()
      }
    })
  }

  /**
   * Disconnect
   *
   */
  disconnect(): void {
    if (!this._socket?.destroyed) {
      // don't do anything for now
    }
  }
}
