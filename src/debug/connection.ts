import * as net from 'net'
import { fromEvent, Observable } from 'rxjs'
import { ByebugConnected } from './events'
// import { Client } from './client'

export type Command = 'help' | 'step' | 'restart' | 'next' | 'continue'
export type EventType = ByebugConnected

// export class Connection extends Client {}
