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
import { ErrPortAttributeMissing, ErrLaunchRequestNotSupported } from './error'
import { random, log } from './utils'
import { filter, skip, take, tap } from 'rxjs/operators'
import { EventType } from './connection'
import { from, Observable, of, Observer, Subscription, Subject } from 'rxjs'
import { ByebugConnected, ByebugReceived } from './events'
import * as net from 'net'
import { fromPrompt } from './prompt'
import { ByebugHoldInit } from './holdInit'
import { ByebugObservable } from './client'

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
  private connected = new Subject()
  private waitForInitPacket = new Subject()

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

      this.connected.complete()
    }

    if (event instanceof Buffer) {
      logger.log(event.toString())
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

    response.body = {
      supportsConfigurationDoneRequest: true,
      supportsEvaluateForHovers: false,
      supportsConditionalBreakpoints: true,
      supportsFunctionBreakpoints: true,
      supportTerminateDebuggee: true
    }

    this.sendResponse(response)
    log('InitializeResponse')
  }

  protected launchRequest(
    response: DebugProtocol.LaunchResponse,
    args: DebugProtocol.LaunchRequestArguments
  ): void {
    this.sendErrorResponse(response, 3000, ErrLaunchRequestNotSupported)
    this.shutdown()
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

    const c = ByebugObservable.create({
      host: 'localhost',
      port: 12345,
      family: 6
    })

    c.subscribe(this)

    try {
      await this.connected.toPromise()
    } catch (error) {
      this.sendErrorResponse(response, error)

      return
    }

    this.sendResponse(response)
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
    super.configurationDoneRequest(response, args)

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

  protected nextRequest(response: DebugProtocol.NextResponse): void {
    log('NextRequest')

    log('NextResponse')
  }

  protected stepInRequest(response: DebugProtocol.StepInResponse): void {
    log('StepInRequest')

    log('StepInResponse')
  }

  protected stepOutRequest(response: DebugProtocol.StepOutResponse): void {
    log('StepOutRequest')

    log('StepOutResponse')
  }
}

DebugSession.run(ByebugSession)
