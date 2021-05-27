import {
  Observable,
  Observer,
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
export type ByebugCommandVariables = { type: 'var'; args: ['all'] }

export type ByebugCommand =
  | ByebugCommandBacktrace
  | ByebugCommandContinue
  | ByebugCommandRestart
  | ByebugCommandStep
  | ByebugCommandBreakpoint
  | ByebugCommandVariables

export interface ByebugResponseBacktrace {
  mark: string
  pos: string
  call: string
  file: string
  line: number
  full_path: string
}

export interface ByebugResponseSetBreakpoint {
  line: string
}

export type ByebugResponseContinue = void
export type ByebugResponsePath = 'frame.line' | 'variable.variable'

export interface ByebugResponse<T> {
  path: ByebugResponsePath
  values: T
}

export class Connection {
  private _socket: net.Socket
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
  send<T>(cmd: ByebugCommand): Observable<T> {
    return new Observable((observer: Observer<T>) => {
      const subscription = fromEvent<Buffer>(this._socket, 'data').subscribe(
        async data => {
          log(data.toString())

          const s = new stream.PassThrough()
          s.end(data.toString('utf-8').trim())

          const l = rl.createInterface({ input: s })

          try {
            for await (const line of l) {
              if (line.indexOf('PROMPT') !== 0) {
                observer.next(JSON.parse(line))
                observer.complete()
                break
              }
            }
          } catch (error) {
            observer.error(error)
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
  continue(): Observable<void> {
    return this.send({ type: 'continue', args: [] })
  }

  /**
   * Get backtrace
   *
   * @returns
   */
  backtrace(): Observable<ByebugResponse<ByebugResponseBacktrace[]>> {
    return this.send({ type: 'backtrace', args: [] })
  }

  /**
   * Step into breakpoint or hold
   *
   * @returns
   */
  stepIn(): Observable<ByebugResponse<ByebugResponseBacktrace>> {
    return this.send({ type: 'step', args: [] })
  }

  /**
   * Restart the server
   *
   * @returns
   */
  restart(): Observable<void> {
    return this.send({ type: 'restart', args: [] })
  }

  /**
   *
   * @returns
   */
  vars(): Observable<Buffer> {
    return this.send({ type: 'var', args: ['all'] })
  }

  /**
   * Set a breakpoint
   *
   * @param file
   * @param line
   * @returns
   */
  setBreakpoint(
    file: string,
    line: string
  ): Observable<ByebugResponseSetBreakpoint> {
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
