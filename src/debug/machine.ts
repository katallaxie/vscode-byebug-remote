import { assign, Machine } from 'xstate'
import { SourceBreakpoint } from 'vscode'

export interface DebuggerMachineContext {
  breakpoints: SourceBreakpoint[]
  initialized: boolean
}

export type DebuggerMachineEvent =
  | { type: 'INITIALIZE' }
  | { type: 'CONTINUE' }
  | { type: 'STOP_ON_ENTRY' }
  | { type: 'SET_BREAKPOINTS'; breakpoints: SourceBreakpoint[] }

export interface DebuggerMachineSchema {
  states: {
    starting: any
    stopOnEntry: any
  }
}

export const machine = Machine<
  DebuggerMachineContext,
  DebuggerMachineSchema,
  DebuggerMachineEvent
>({
  id: 'byebug',
  initial: 'starting',
  context: {
    breakpoints: [],
    initialized: false
  },
  states: {
    starting: {
      on: {
        STOP_ON_ENTRY: {
          actions: assign(ctx => ({
            ...ctx,
            initialize: true
          })),
          target: 'stopOnEntry'
        }
      }
    },
    stopOnEntry: {
      on: {
        SET_BREAKPOINTS: {
          actions: assign((ctx, event: any) => ({
            ...ctx,
            breakpoints: [...event.breakpoints]
          }))
        }
      }
    }
  }
})

export default machine
