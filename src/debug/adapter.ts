import { DebugProtocol } from 'vscode-debugprotocol'
import {
  LoggingDebugSession,
  logger,
  Logger,
  DebugSession
} from 'vscode-debugadapter'
import * as util from 'util'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { ErrPortAttributeMissing } from './error'
import Byebug from './byebug'
import { random } from './utils'

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

  protected attachRequest(
    response: DebugProtocol.AttachResponse,
    args: AttachRequestArguments
  ): void {
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
    logger.verbose('creating new byebug')
    this.byebug = new Byebug(args, localPath)

    try {
      await this.byebug.connect(args.port, args.host)
    } catch (e) {
      logger.error(e)
    }

    this.byebug.ondata = (data: Buffer) => {
      logger.verbose(data.toString())
    }

    this.byebug.onclose = () => {
      logger.verbose('fully-closed')
      console.log('fully closed')
    }
  }
}

DebugSession.run(ByebugSession)
