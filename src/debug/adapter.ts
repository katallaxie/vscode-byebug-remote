import { DebugProtocol } from 'vscode-debugprotocol'
import {
  LoggingDebugSession,
  logger,
  Logger,
  DebugSession,
  InitializedEvent,
  StoppedEvent,
  Source,
  Thread,
  Handles,
  StackFrame,
  Variable,
  Scope
} from 'vscode-debugadapter'
import { Connection } from './connection'
import * as util from 'util'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { ErrPortAttributeMissing, ErrLaunchRequestNotSupported } from './error'
import { random, log } from './utils'
import { take } from 'rxjs/operators'
import { Subject, BehaviorSubject } from 'rxjs'
import { interpret, Interpreter } from 'xstate'
import machine, {
  DebuggerMachineContext,
  DebuggerMachineEvent,
  DebuggerMachineSchema
} from './machine'

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

  private connection: Connection | null = null
  private waitingForConnect = new BehaviorSubject(false)
  private machine: Interpreter<
    DebuggerMachineContext,
    DebuggerMachineSchema,
    DebuggerMachineEvent
  >
  private waitForConfigurationDone = new Subject()
  private variableHandles = new Handles<string>()

  public constructor() {
    super()

    this.setDebuggerColumnsStartAt1(true)
    this.setDebuggerLinesStartAt1(true)
    this.setDebuggerPathFormat('path')
    this.machine = interpret(machine).start()
  }

  /**
   * Initialize the debugger
   *
   * @param response
   * @param args
   */
  protected initializeRequest(
    response: DebugProtocol.InitializeResponse
  ): void {
    log('InitializeRequest')

    response.body = {
      supportsStepBack: false,
      supportsRestartRequest: true
    }

    // We send the InitializedEvent later to request the breakpoints
    log('InitializeResponse')
    this.sendResponse(response)
  }

  /**
   * Request to launch a new debuggee is not supported.
   * It is assumed that byebug is run in with a server for remote debugging.
   *
   * @param response
   */
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

    this.connection = new Connection(args.host, args.port)
    this.connection.connected$.subscribe(this.waitingForConnect)

    try {
      await this.connection.connect().toPromise()
      log('Connected')
    } catch (error) {
      this.sendErrorResponse(response, error)
      return
    }

    // Set the state to hold on entry here
    this.machine.send('STOP_ON_ENTRY')

    // Sending this event will trigger a fetch of all breakpoints to be set
    this.sendEvent(new InitializedEvent())

    // Sending a an event that we have stopped in the virtual thread 1
    this.sendEvent(new StoppedEvent('entry', 1))

    // request other breakpoints from vs code
    log('AttachedResponse')
    this.sendResponse(response)
  }

  /**
   * Disconnect debugee
   *
   * @param response
   * @param args
   */
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
    log('Closing connection')
    this.connection?.disconnect()
  }

  protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
    // runtime supports no threads so just return a default thread.
    response.body = {
      threads: [new Thread(ByebugSession.threadID, 'thread 1')]
    }
    this.sendResponse(response)
  }

  /**
   * Configuration done
   *
   * @param response
   * @param args
   */
  protected async configurationDoneRequest(
    response: DebugProtocol.ConfigurationDoneResponse,
    args: DebugProtocol.ConfigurationDoneArguments
  ): Promise<void> {
    log('ConfigurationDoneRequest')

    super.configurationDoneRequest(response, args)

    // notify the attach request that the configuration has finished
    this.waitForConfigurationDone.complete()
  }

  /**
   * Setting breakpoints
   *
   * Because byebug has already been started, we can only set breakpoints
   * after any `byebug` statement.
   *
   * @param response
   * @param args
   */
  protected async setBreakPointsRequest(
    response: DebugProtocol.SetBreakpointsResponse,
    args: DebugProtocol.SetBreakpointsArguments
  ): Promise<void> {
    log('SetBreakPointsRequest')

    response.body = { breakpoints: [] }

    let vscodeBreakpoints
    if (args.breakpoints) {
      vscodeBreakpoints = await Promise.all(
        args.breakpoints?.map(async breakpoint => {
          try {
            const result = await this.connection
              ?.setBreakpoint(
                args.source.path || '',
                breakpoint.line.toString()
              )
              .pipe(take(1))
              .toPromise()
            log(result?.toString())

            return { verified: true, line: breakpoint.line }
          } catch (error) {
            this.sendErrorResponse(response, error)
          }

          return { verified: false, line: breakpoint.line }
        })
      )
    }

    response.body.breakpoints = vscodeBreakpoints || []

    this.machine.send('SET_BREAKPOINTS', {
      breakpoints: response.body.breakpoints
    })

    log('SetBreakPointsResponse')
    this.sendResponse(response)
  }

  /**
   * Restarting the debuggee
   *
   * @param response
   * @param args
   */
  protected async restartRequest(
    response: DebugProtocol.RestartResponse,
    args: DebugProtocol.RestartArguments
  ): Promise<void> {
    try {
      await this.connection?.restart().toPromise()
    } catch (error) {
      this.sendErrorResponse(response, error)
    }

    this.sendResponse(response)
  }

  /**
   * Get the backtrace to the current breakpoint ot stop on entry to
   * the request.
   *
   * @param response
   * @param args
   */
  protected async stackTraceRequest(
    response: DebugProtocol.StackTraceResponse,
    args: DebugProtocol.StackTraceArguments
  ): Promise<void> {
    log('StackTraceRequest')

    // artici
    const threadId = args.threadId
    const stackFrames: StackFrame[] = []

    try {
      const backtrace = await this.connection
        ?.backtrace()
        .pipe(take(1))
        .toPromise()

      backtrace?.values.forEach(trace => {
        stackFrames.push(
          new StackFrame(
            Number(trace.pos),
            trace.call,
            new Source(trace.file),
            Number(trace.line)
          )
        )
      })
    } catch (error) {
      if (error instanceof SyntaxError) {
        log('syntax', error.message, error.name)
      }
      this.sendErrorResponse(response, error)
    }

    response.body = { stackFrames, totalFrames: stackFrames.length }

    log('StackTraceResponse')
    this.sendResponse(response)
  }

  protected async scopesRequest(
    response: DebugProtocol.ScopesResponse,
    args: DebugProtocol.ScopesArguments
  ): Promise<void> {
    log('ScopesRequest')

    response.body = {
      scopes: [
        new Scope('Local', this.variableHandles.create('local'), false),
        new Scope('Global', this.variableHandles.create('global'), true)
      ]
    }

    log('ScopesResponse')
    this.sendResponse(response)
  }

  protected async variablesRequest(
    response: DebugProtocol.VariablesResponse,
    args: DebugProtocol.VariablesArguments
  ): Promise<void> {
    log('VariablesRequest')

    const id = this.variableHandles.get(args.variablesReference)
    const variables: DebugProtocol.Variable[] = []
    try {
      const vars = (await this.connection
        ?.vars()
        .pipe(take(1))
        .toPromise()) as any
      const vv = vars['values'] as any[]

      vv.forEach(v => {
        variables.push({
          name: `${id}_${v['key']}`,
          value: v['value'],
          variablesReference: 0
        })
      })
    } catch (e) {
      log(e)
      this.sendErrorResponse(response, e)
    }

    response.body = {
      variables: variables
    }

    log('VariablesResponse')
    this.sendResponse(response)
  }

  protected nextRequest(response: DebugProtocol.NextResponse): void {
    log('NextRequest')

    log('NextResponse')
  }

  /**
   * Step in to the currently stopped execution.
   *
   * @param response
   */
  protected async stepInRequest(
    response: DebugProtocol.StepInResponse
  ): Promise<void> {
    log('StepInRequest')

    try {
      await this.connection?.stepIn().pipe(take(1)).toPromise()
      this.sendEvent(new StoppedEvent('step', 1))
    } catch (error) {
      this.sendErrorResponse(response, error)
    }

    log('StepInResponse')
  }

  /**
   * Continue the execution to the next breakpoint or
   * the end of the request.
   *
   * @param response
   */
  protected async continueRequest(
    response: DebugProtocol.ContinueResponse
  ): Promise<void> {
    log('ContinueRequest')

    const { state } = this.machine
    const hasBreakpoints = state.context.breakpoints.length > 0

    try {
      await this.connection?.continue().pipe(take(1)).toPromise()
      this.sendEvent(new StoppedEvent('breakpoint', 1))
    } catch (error) {
      this.sendErrorResponse(response, error)
    }

    log('ContinueResponse')

    this.sendResponse(response)
  }

  // private async variables() {
  //   return await this.connection?.vars().pipe(take(1)).toPromise()
  // }
}

DebugSession.run(ByebugSession)
