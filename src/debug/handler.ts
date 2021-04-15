import { EventEmitter } from 'events'

export type ByebugEvent = string

export default class BybugEvents extends EventEmitter {
  private _enabled = true
  get enabled(): boolean {
    return this._enabled
  }

  set enabled(enabled: boolean) {
    this._enabled = enabled
  }

  constructor() {
    super()
  }

  public emit(event: ByebugEvent, ...args: any[]): boolean {
    return this.enabled ? super.emit(event, ...args) : this.enabled
  }
}
