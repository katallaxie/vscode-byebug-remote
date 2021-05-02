import { ByebugConnected } from './events'

export type Command = 'help' | 'step' | 'restart' | 'next' | 'continue'
export type EventType = ByebugConnected

// export class Connection extends Client {}
