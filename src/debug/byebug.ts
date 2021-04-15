import { AttachRequestArguments } from './adapter'
import * as net from 'net'
import { normalizePath } from './utils'

type LaunchRequestType = 'attach'

export class Byebug {
  public program: string
  public ondata: (data: Buffer) => void = () => null
  public onend: () => void = () => null
  public onready: () => void = () => null
  public onclose: () => void = () => null

  private request: LaunchRequestType
  private socket: net.Socket | null = null

  constructor(launchArgs: AttachRequestArguments, program: string) {
    this.request = launchArgs.request
    this.program = normalizePath(program)
  }

  public close() {
    if (this.socket !== null) this.socket.destroy()
    this.socket = null
  }

  public connect(port: number, host: string): Promise<void> {
    return new Promise(async (resolve, reject) => {
      this.socket = net.connect(
        {
          family: 6,
          host,
          port,
          readable: true,
          writable: true
        },
        () => resolve()
      )

      this.socket.on('data', this.handleOnData)
      this.socket.on('error', reject)
    })
  }

  public handleOnData(data: Buffer): void {
    console.log(data)
  }
}

export default Byebug
