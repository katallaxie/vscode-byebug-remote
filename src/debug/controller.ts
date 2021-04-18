import * as net from 'net'
import { BehaviorSubject, from, fromEvent } from 'rxjs'
import { map } from 'rxjs/operators'
import { fromSocket } from './connection'

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

  constructor(host = '127.0.0.1', port = 12345) {
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
    fromSocket(this.socket).subscribe()
  }

  public send(line: string): void {
    this.socket.write(`${line}\n`)
  }

  public disconnect(): void {
    this.socket.destroy()
  }
}

export class DefaultController extends Controller {}
