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
import { ErrPortAttributeMissing, ErrLaunchRequestNotSupported } from './error'
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

export class ByebugSession
  extends LoggingDebugSession
  implements Observer<ByebugConnectionEvent> {
  private logLevel: Logger.LogLevel = Logger.LogLevel.Error

  // we don't support multiple threads, so we can use a hardcoded ID for the default thread
  private static threadID = 1

  private waitingConnections = new Set<ByebugConnection>()
  private waitingForInit = new Subject()
  private waitingForConnect = new Subject<ByebugConnection>()
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

  async next(event: ByebugConnectionEvent) {
    if (event instanceof ByebugCreated) {
      log('Sending OutputEvent as byebug is created')

      this.sendEvent(new OutputEvent(`new connection`))
    }

    if (event instanceof ByebugConnected) {
      this.waitingForConnect.next(event)
      this.waitingForConnect.complete()
    }

    if (event instanceof ByebugReceived) {
      this.sendEvent(new OutputEvent(event.buffer.toString()))

      if (event.initial) {
        log('Sending Initial Prompt')

        this.waitingForInit.next(event)
        this.waitingForInit.complete()

        // this.sendEvent(new StoppedEvent('entry'))

        return
      }
    }
  }

  error(err: Error) {
    log(`Sending TerminatedEvent as byebug is disconnected ${err}`)
    this.sendEvent(new TerminatedEvent())
  }

  complete() {
    this.sendEvent(new TerminatedEvent())
  }

  protected launchRequest(response: DebugProtocol.LaunchResponse): void {
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

    await this.waitForConfigurationDone.toPromise()

    // here we need to find a path
    log('creating new byebug')

    const socket = new ByebugSubject<Buffer>({
      host: args.host,
      port: args.port
    })

    socket.subscribe(() => this.waitingForConnect.complete())

    try {
      await this.waitingForConnect.toPromise()
      const result = await socket
        .multiplex(() => 'info breakpoints')
        .toPromise()
      log(result)
    } catch (error) {
      this.sendErrorResponse(response, error)

      return
    }

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

  // protected restartRequest(
  //   response: DebugProtocol.RestartResponse,
  //   args: DebugProtocol.RestartArguments
  // ) {}

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
}

DebugSession.run(ByebugSession)
