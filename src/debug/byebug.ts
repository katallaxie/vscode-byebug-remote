import { AttachRequestArguments } from './adapter'
import * as net from 'net'
import { normalizePath } from './utils'
import { logger } from 'vscode-debugadapter/lib/logger'
import { DefaultController, Controller } from './controller'
import {
  takeUntil,
  map,
  skipUntil,
  take,
  skipWhile,
  takeWhile
} from 'rxjs/operators'

type LaunchRequestType = 'attach'

export class Byebug {
  public program: string

  public ondata: (data: Buffer) => void = () => null
  public onend: () => void = () => null
  public onready: () => void = () => null
  public onclose: () => void = () => null

  protected controller: Controller

  private request: LaunchRequestType
  private socket: net.Socket | null = null

  constructor(launchArgs: AttachRequestArguments, program: string) {
    this.request = launchArgs.request
    this.program = normalizePath(program)

    this.controller = new DefaultController(launchArgs.host, launchArgs.port)
    this.controller.events.pipe().subscribe(this.handleControllerEvents)
  }

  public handleControllerEvents(event: any) {
    logger.log(JSON.stringify(event))
  }

  public close() {
    if (this.socket !== null) this.socket.destroy()
    this.socket = null
  }

  connect = async (): Promise<boolean> => {
    this.controller.connect()

    return await this.controller.connected
      .pipe(
        skipWhile(connected => !connected),
        take(1)
      )
      .toPromise()
  }

  public handleOnData(data: Buffer): void {
    logger.verbose(data.toString())
  }
}

export default Byebug
