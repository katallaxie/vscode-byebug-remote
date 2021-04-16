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
  tap,
  skipWhile,
  takeWhile
} from 'rxjs/operators'
import { async, BehaviorSubject } from 'rxjs'

type LaunchRequestType = 'attach'

export class Byebug {
  public program: string

  private connectionSubject = new BehaviorSubject<boolean>(false)
  get connected(): BehaviorSubject<boolean> {
    return this.connectionSubject
  }

  private dataSubject = new BehaviorSubject<Buffer | null>(null)
  get data(): BehaviorSubject<Buffer | null> {
    return this.dataSubject
  }

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
    this.controller.connected.subscribe(this.connectionSubject)
    this.controller.data.subscribe(this.dataSubject)
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

  disconnect = async (): Promise<void> => {
    return Promise.resolve(this.controller.disconnect())
  }
}

export default Byebug
