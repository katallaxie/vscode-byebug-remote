import * as net from 'net'

export class ByebugConnection {
  constructor(
    public id: number,
    public socket: net.Socket,
    public opts: net.SocketConnectOpts
  ) {}

  public connect(): net.Socket {
    return this.socket.connect(this.opts)
  }

  public destroy(): void {
    return this.socket.destroy()
  }
}

export class ByebugCreated extends ByebugConnection {}
export class ByebugConnected extends ByebugConnection {}
export class ByebugDisconnected extends ByebugConnection {}
export class ByebugSend extends ByebugConnection {}

export class ByebugReceived extends ByebugConnection {
  constructor(
    public id: number,
    public socket: net.Socket,
    public opts: net.SocketConnectOpts,
    public buffer: Buffer,
    public initial: boolean
  ) {
    super(id, socket, opts)
  }
}

export type ByebugConnectionEvent =
  | ByebugCreated
  | ByebugConnected
  | ByebugDisconnected
  | ByebugSend
