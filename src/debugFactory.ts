import * as vscode from 'vscode'

export class ByebugAdapterDescriptorFactory
  implements vscode.DebugAdapterDescriptorFactory {
  public createDebugAdapterDescriptor(
    session: vscode.DebugSession,
    executable: vscode.DebugAdapterExecutable | undefined
  ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    if (session.configuration.debugAdapter === 'ruby-byebug') {
      return this.createDebugAdapterDescriptorByebugDap(session.configuration)
    }
    return executable
  }

  public async dispose() {
    console.log('ByebugAdapterDescriptorFactory.dispose')
  }

  private createDebugAdapterDescriptorByebugDap(
    configuration: vscode.DebugConfiguration
  ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    if (configuration.port) {
      return new vscode.DebugAdapterServer(
        configuration.port,
        configuration.host ?? '127.0.0.1'
      )
    }
    const d = new BybebugDAPOutputAdapter(configuration)
    return new vscode.DebugAdapterInlineImplementation(d)
  }
}

export class ProxyDebugAdapter implements vscode.DebugAdapter {
  private messageEmitter = new vscode.EventEmitter<vscode.DebugProtocolMessage>()

  constructor() {
    this.onDidSendMessage = this.messageEmitter.event
  }

  onDidSendMessage: vscode.Event<vscode.DebugProtocolMessage>

  handleMessage(message: vscode.DebugProtocolMessage): void {
    throw new Error('Method not implemented.')
  }

  dispose() {
    throw new Error('Method not implemented.')
  }
}

export class BybebugDAPOutputAdapter extends ProxyDebugAdapter {
  constructor(
    private config: vscode.DebugConfiguration,
    private outputToConsole?: boolean
  ) {
    super()
  }
}
