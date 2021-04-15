import { AttachRequestArguments } from './adapter'
import * as net from 'net'
import { normalizePath } from './utils'
import { logger } from 'vscode-debugadapter/lib/logger'

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
        () => {
          this.socket?.emit('CONNECTED')
          resolve()
        }
      )
      this.socket.on('data', this.handleOnData)
      this.socket.on('ready', () => {
        logger.verbose('connection is ready')
      })
      this.socket.on('error', error => {
        logger.verbose(error.message)
      })
    })
  }

  public handleOnData(data: Buffer): void {
    logger.verbose(data.toString())
  }
}

export default Byebug
