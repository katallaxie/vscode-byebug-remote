import { DebugProtocol } from 'vscode-debugprotocol'
import {
  LoggingDebugSession,
  logger,
  Logger,
  DebugSession,
  InitializedEvent,
  TerminatedEvent
} from 'vscode-debugadapter'
import * as util from 'util'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { ErrPortAttributeMissing } from './error'
import { random, log } from './utils'
import { filter, skip, take, tap } from 'rxjs/operators'
import { EventType, createConnection } from './connection'
import { from, Observer, Subscription } from 'rxjs'
import { ByebugConnected } from './events'
import * as net from 'net'
import * as readline from 'readline'

const fsAccess = util.promisify(fs.access)
const fsUnlink = util.promisify(fs.unlink)

export type Trace = 'verbose' | 'log' | 'error'

export interface AttachRequestArguments
  extends DebugProtocol.AttachRequestArguments {
  request: 'attach'
  showLog?: boolean
  logOutput?: boolean
  port?: number
  host?: string
  trace?: Trace
  cwd?: string
}

export class ByebugSession
  extends LoggingDebugSession
  implements Observer<EventType> {
  private logLevel: Logger.LogLevel = Logger.LogLevel.Error
  private byebugSubscription: Subscription | null = null

  public constructor(
    debuggerLinesStartAt1: boolean,
    isServer = false,
    readonly fileSystem = fs
  ) {
    super('', debuggerLinesStartAt1, isServer)
  }

  closed = false

  async next(event: EventType) {
    if (event instanceof ByebugConnected) {
      log('Sending InitializedEvent as byebug is connected')
      this.sendEvent(new InitializedEvent())
    }
  }

  error(err: Error) {
    log('Sending TerminatedEvent as byebug is disconnected')
    this.sendEvent(new TerminatedEvent())
  }

  complete() {
    this.sendEvent(new TerminatedEvent())
  }

  protected initializeRequest(
    response: DebugProtocol.InitializeResponse,
    args: DebugProtocol.InitializeRequestArguments
  ): void {
    log('InitializeRequest')

    response.body!.supportsSetVariable ??= true
    response.body!.supportsRestartRequest ?? true
    response.body!.supportsSetVariable = true

    this.sendResponse(response)
    log('InitializeResponse')
  }

  protected attachRequest(
    response: DebugProtocol.AttachResponse,
    args: AttachRequestArguments
  ): void {
    log('AttachRequest')

    if (!args.port) {
      this.sendErrorResponse(response, 3000, ErrPortAttributeMissing)
    }

    this.initLaunchAttachRequest(response, args)
  }

  private async initLaunchAttachRequest(
    response: DebugProtocol.LaunchResponse,
    args: AttachRequestArguments
  ) {
    this.logLevel =
      args.trace === 'verbose'
        ? Logger.LogLevel.Verbose
        : args.trace === 'log'
        ? Logger.LogLevel.Log
        : Logger.LogLevel.Error

    const logPath =
      this.logLevel !== Logger.LogLevel.Error
        ? path.join(os.tmpdir(), 'vscode-byebug-remote-debug.txt')
        : undefined

    logger.setup(this.logLevel, logPath)

    args.host = args.host || '127.0.0.1'
    args.port = args.port || random(2000, 50000)

    const localPath = args.cwd || '' // should this be the default workfolder?

    // here we need to find a path
    log('creating new byebug')

    const socket = new net.Socket({
      readable: true,
      writable: true
    })

    this.byebugSubscription = createConnection(socket).subscribe(this)
  }

  protected async disconnectRequest(
    response: DebugProtocol.DisconnectResponse,
    args: DebugProtocol.DisconnectArguments
  ): Promise<void> {
    log('DisconnectRequest')

    if (this.byebugSubscription) {
      await Promise.race([
        this.disconnectedRequestHelper(response, args),
        new Promise<void>(resolve =>
          setTimeout(() => {
            log('DisconnectRequestHelper timed out after 5s.')
            resolve()
          }, 5_000)
        )
      ])
    }

    this.shutdownProtocolServer(response, args)
    log('DisconnectResponse')
  }

  private shutdownProtocolServer(
    response: DebugProtocol.DisassembleResponse,
    args: DebugProtocol.DisconnectArguments
  ): void {
    log('DisconnectRequest to parent to shut down protocol server.')

    super.disconnectRequest(response, args)
  }

  protected async disconnectedRequestHelper(
    response: DebugProtocol.DisassembleResponse,
    args: DebugProtocol.DisconnectArguments
  ): Promise<void> {
    // issuing a continue request before disconnect
    // this continue

    log('Closing byebug')
    await this.byebugSubscription?.unsubscribe()
  }

  protected async configurationDoneRequest(
    response: DebugProtocol.ConfigurationDoneResponse,
    args: DebugProtocol.ConfigurationDoneArguments
  ) {
    log('ConfigurationDoneRequest')

    this.sendResponse(response)
    log('ConfigurationDoneResponse', response)
  }

  protected async setBreakPointsRequest(
    response: DebugProtocol.SetBreakpointsResponse,
    args: DebugProtocol.SetBreakpointsArguments
  ) {
    log('SetBreakPointsRequest')
  }
}

DebugSession.run(ByebugSession)
