import * as net from 'net'
import { BehaviorSubject } from 'rxjs'

export class SocketState {}

export class IO {
  private socket: net.Socket

  private _socketState = new BehaviorSubject<SocketState>()
}
