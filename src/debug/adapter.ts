import { DebugProtocol } from 'vscode-debugprotocol'
import {
  LoggingDebugSession,
  logger,
  Logger,
  DebugSession,
  InitializedEvent,
  TerminatedEvent,
  OutputEvent
} from 'vscode-debugadapter'
import * as util from 'util'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { ErrPortAttributeMissing } from './error'
import Byebug from './byebug'
import { random, log } from './utils'
import { filter, skip, take, tap } from 'rxjs/operators'

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

export class ByebugSession extends LoggingDebugSession {
  private logLevel: Logger.LogLevel = Logger.LogLevel.Error
  private byebug: Byebug | null = null

  public constructor(
    debuggerLinesStartAt1: boolean,
    isServer = false,
    readonly fileSystem = fs
  ) {
    super('', debuggerLinesStartAt1, isServer)
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
    this.byebug = new Byebug(args, localPath)

    this.byebug.connected.pipe(skip(1)).subscribe(connected => {
      if (!connected) {
        // could be done in the stream
        log('Sending TerminatedEvent as byebug is disconnected')
        this.sendEvent(new TerminatedEvent())
      }
    })

    this.byebug.data.pipe(tap(val => logger.log(`${val}`))).subscribe(data => {
      log('Send an OutputEvent')
      this.sendEvent(new OutputEvent(data?.toString() || ''))
    })

    try {
      await this.byebug.connect()
    } catch (e) {
      logger.error(e)
    }

    this.sendEvent(new InitializedEvent())
    log('Sending InitializedEvent as byebug is connected')
  }

  protected async disconnectRequest(
    response: DebugProtocol.DisconnectResponse,
    args: DebugProtocol.DisconnectArguments
  ): Promise<void> {
    log('DisconnectRequest')

    if (this.byebug) {
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
    await this.byebug?.disconnect()
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
