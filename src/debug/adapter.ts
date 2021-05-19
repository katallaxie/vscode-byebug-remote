import { DebugProtocol } from 'vscode-debugprotocol'
import {
  LoggingDebugSession,
  logger,
  Logger,
  DebugSession,
  InitializedEvent,
  TerminatedEvent,
  OutputEvent,
  StoppedEvent,
  BreakpointEvent,
  Breakpoint,
  Source,
  Thread
} from 'vscode-debugadapter'
import * as util from 'util'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { ByebugSubject } from './socket'
import {
  ErrPortAttributeMissing,
  ErrLaunchRequestNotSupported,
  ErrNoSocketAvailable
} from './error'
import { random, log } from './utils'
import { filter, skip, take, tap } from 'rxjs/operators'
import { EventType } from './connection'
import { from, Observable, of, Observer, Subscription, Subject } from 'rxjs'
import { ByebugConnected, ByebugReceived } from './events'
import * as net from 'net'
import { fromPrompt } from './prompt'
import { ByebugHoldInit } from './holdInit'
import { ByebugClient } from './client'
import {
  ByebugConnectionEvent,
  ByebugCreated,
  ByebugConnection
} from './events'
import { Location, SourceBreakpoint, Uri } from 'vscode'

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

  // we don't support multiple threads, so we can use a hardcoded ID for the default thread
  private static threadID = 1

  private waitingConnections = new Set<ByebugConnection>()
  private waitingForInit = new Subject()
  private waitingForConnect = new Subject()
  private socket: ByebugSubject<Buffer> | null = null
  private byebugSubscription: Subscription | null = null
  private waitForConfigurationDone = new Subject()

  public constructor() {
    super()

    this.setDebuggerColumnsStartAt1(true)
    this.setDebuggerLinesStartAt1(true)
    this.setDebuggerPathFormat('path')
  }

  /**
   *
   * @param response
   * @param args
   */
  protected initializeRequest(
    response: DebugProtocol.InitializeResponse
  ): void {
    log('InitializeRequest')

    response.body = {
      supportsConfigurationDoneRequest: true,
      supportsEvaluateForHovers: false,
      supportsConditionalBreakpoints: false,
      supportsFunctionBreakpoints: true,
      supportsRestartRequest: true
    }

    this.sendResponse(response)

    log('InitializeResponse')

    this.sendEvent(new InitializedEvent())
  }

  protected launchRequest(response: DebugProtocol.LaunchResponse): void {
    this.sendErrorResponse(response, 3000, ErrLaunchRequestNotSupported)
    this.shutdown()
  }

  /**
   * Request to attach to the debugger
   *
   * @param response
   * @param args
   */
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

  /**
   * Initialize the attach request
   *
   * @param response
   * @param args
   * @returns
   */
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

    // await this.waitForConfigurationDone.toPromise()

    // here we need to find a path
    log('creating new byebug')

    this.socket = new ByebugSubject<Buffer>({
      host: args.host,
      port: args.port
    })

    // socket.subscribe(() => this.waitingForConnect.complete())
    this.socket.pipe(take(1)).subscribe(this.waitingForConnect)

    try {
      const result = await this.waitingForConnect.toPromise()
    } catch (error) {
      this.sendErrorResponse(response, error)
      return
    }

    this.sendEvent(new StoppedEvent('breakpoint', 1))

    log('AttachedResponse')

    // request other breakpoints from vs code
    this.sendResponse(response)
  }

  protected async disconnectRequest(
    response: DebugProtocol.DisconnectResponse,
    args: DebugProtocol.DisconnectArguments
  ): Promise<void> {
    log('DisconnectRequest')

    await Promise.race([
      this.disconnectedRequestHelper(response, args),
      new Promise<void>(resolve =>
        setTimeout(() => {
          log('DisconnectRequestHelper timed out after 5s.')
          resolve()
        }, 5_000)
      )
    ])

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

  protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
    // runtime supports no threads so just return a default thread.
    response.body = {
      threads: [new Thread(ByebugSession.threadID, 'thread 1')]
    }
    this.sendResponse(response)
  }

  protected async configurationDoneRequest(
    response: DebugProtocol.ConfigurationDoneResponse,
    args: DebugProtocol.ConfigurationDoneArguments
  ): Promise<void> {
    super.configurationDoneRequest(response, args)

    // notify the attach request that the configuration has finished
    this.waitForConfigurationDone.complete()
  }

  protected async setBreakPointsRequest(
    response: DebugProtocol.SetBreakpointsResponse,
    args: DebugProtocol.SetBreakpointsArguments
  ): Promise<void> {
    log('SetBreakPointsRequest')

    try {
      response.body = { breakpoints: [] }

      // let vscodeBreakpoints: DebugProtocol.Breakpoint[]
      // if there are no connections yet, we cannot verify any breakpoint
      const vscodeBreakpoints = args.breakpoints?.map(breakpoint => ({
        verified: true,
        line: breakpoint.line
      }))

      response.body = { breakpoints: vscodeBreakpoints || [] }

      // // for all connections ...
      // await Promise.all(
      //   connections.map(async (connection, connectionIndex) => {
      //     const promise = async () => {
      //       // should clear all breakpoints
      //     }
      //   })
      // )
      response.body = { breakpoints: vscodeBreakpoints || [] }
    } catch (error) {
      this.sendErrorResponse(response, error)
      return
    }

    this.sendResponse(response)
  }

  protected async restartRequest(
    response: DebugProtocol.RestartResponse,
    args: DebugProtocol.RestartArguments
  ): Promise<void> {
    if (this.socket === null) {
      this.sendErrorResponse(response, 3000, ErrNoSocketAvailable)
    }

    try {
      const result = await this.socket?.multiplex(() => 'restart').toPromise()
    } catch (error) {
      this.sendErrorResponse(response, error)
    }

    this.sendResponse(response)
  }

  protected async stackTraceRequest(
    response: DebugProtocol.StackTraceResponse,
    args: DebugProtocol.StackTraceArguments
  ) {
    log('StackTraceRequest')

    this.sendResponse(response)
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

  protected async continueRequest(
    response: DebugProtocol.ContinueResponse
  ): Promise<void> {
    log('ContinueRequest')

    try {
      await this.socket?.continue().toPromise()
    } catch (error) {
      this.sendErrorResponse(response, error)
    }

    log('ContinueResponse')

    this.sendResponse(response)
  }
}

DebugSession.run(ByebugSession)
