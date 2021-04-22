import { Observer } from 'rxjs'
import { LoggingDebugSession } from 'vscode-debugadapter'
import * as stream from 'stream'
import * as readline from 'readline'
import { logger } from 'vscode-debugadapter/lib/logger'
import {
  StoppedEvent,
  BreakpointEvent,
  Breakpoint,
  Source
} from 'vscode-debugadapter'
import * as path from 'path'

export class ByebugHoldInit implements Observer<Buffer> {
  constructor(public session: LoggingDebugSession) {}

  async next(data: Buffer) {
    const bufferStream = new stream.PassThrough()
    bufferStream.end(data)

    const rl = readline.createInterface({ input: bufferStream })

    for await (const line of rl) {
      logger.log(`hre ${line}`)
    }

    this.session.sendEvent(new StoppedEvent('pause'))

    this.session.sendEvent(
      new BreakpointEvent(
        'new',
        new Breakpoint(
          true,
          59,
          63,
          new Source(
            path.basename(
              '/Users/sebastian/src/github/github/app/controllers/dashboard_controller.rb'
            ),
            '/Users/sebastian/src/github/github/app/controllers/dashboard_controller.rb'
          )
        )
      )
    )
  }

  error(err: Error) {
    return
  }

  complete() {
    return
  }
}
