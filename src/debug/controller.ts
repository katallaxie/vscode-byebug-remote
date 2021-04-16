import * as net from 'net'
import { BehaviorSubject, fromEvent } from 'rxjs'
import { map, tap } from 'rxjs/operators'
import { logger } from 'vscode-debugadapter/lib/logger'

export class ByebugEvent {}
export class ByebugEventConnected extends ByebugEvent {}
export class ByebugEventDisconnected extends ByebugEvent {}
export class ByebugEventReceived extends ByebugEvent {}
export class ByebugEventError extends ByebugEvent {}
export class ByebugEventClose extends ByebugEvent {}

export type ControllerActor = any
export type ControllerActors = Map<string, any> // this for now

export class Controller {
  protected host: string
  protected port: number

  private socket: net.Socket
  private eventSubject = new BehaviorSubject<ByebugEvent | null>(null)
  get events(): BehaviorSubject<ByebugEvent | null> {
    return this.eventSubject
  }

  private connectionSubject = new BehaviorSubject<boolean>(false)
  get connected(): BehaviorSubject<boolean> {
    return this.connectionSubject
  }

  private dataSubject = new BehaviorSubject<Buffer | null>(null)
  get data(): BehaviorSubject<Buffer | null> {
    return this.dataSubject
  }

  constructor(host = '127.0.0.1', port = 12346) {
    this.host = host
    this.port = port

    this.socket = new net.Socket({
      readable: true,
      writable: true
    })

    // fromEvent(this.socket, 'error')
    //   .pipe(
    //     map(this.handleError),
    //     switchMap(() => this.eventSubject)
    //   )
    //   .subscribe()

    fromEvent<boolean>(this.socket, 'close')
      .pipe(map(() => false))
      .subscribe(this.connectionSubject)

    fromEvent<void>(this.socket, 'ready')
      .pipe(map(() => true))
      .subscribe(this.connectionSubject)

    fromEvent<Buffer>(this.socket, 'data').subscribe(this.dataSubject)
  }

  public connect(): void {
    this.socket.connect({
      family: 6,
      host: this.host,
      port: this.port
    })
  }

  public disconnect(): void {
    this.socket.destroy()
  }
}

export class DefaultController extends Controller {}
