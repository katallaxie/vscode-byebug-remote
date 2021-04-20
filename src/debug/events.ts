export class ByebugConnected {}
export class ByebugDisconnected {}
export class ByebugEnterPrompt {}
export class ByebugExitPrompt {}
export class ByebugSent {}
export class ByebugReceived extends Buffer {}
export type ByebugEvent = ByebugConnected | ByebugDisconnected
