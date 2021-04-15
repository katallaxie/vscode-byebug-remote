import * as net from 'net'
import { BehaviorSubject, fromEvent } from 'rxjs'
import { map, switchMap } from 'rxjs/operators'
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

  constructor(host = '127.0.0.1', port = 12346) {
    this.host = host
    this.port = port

    this.socket = new net.Socket({
      readable: true,
      writable: true
    })

    fromEvent(this.socket, 'connect')
      .pipe(
        map(this.handleConnect),
        switchMap(() => this.eventSubject)
      )
      .subscribe()

    fromEvent(this.socket, 'error')
      .pipe(
        map(this.handleError),
        switchMap(() => this.eventSubject)
      )
      .subscribe()

    fromEvent<void>(this.socket, 'close').subscribe(this.handleClose)
    fromEvent<void>(this.socket, 'ready').subscribe(this.handleReady)
    fromEvent<Buffer>(this.socket, 'data').subscribe(this.handleData)
  }

  private handleError(): ByebugEventError {
    return new ByebugEventConnected()
  }

  private handleConnect(): ByebugEventConnected {
    return new ByebugEventConnected()
  }

  handleData = (data: Buffer): void => {
    logger.log(data.toString())
  }

  handleClose = (): void => {
    logger.log('closing conenction')
    this.connectionSubject.next(false)
    this.socket.destroy()
  }

  handleReady = (): void => {
    this.connectionSubject.next(true)
  }

  public connect(): void {
    this.socket.connect({
      family: 6,
      host: this.host,
      port: this.port
    })
  }
}

export class DefaultController extends Controller {}
