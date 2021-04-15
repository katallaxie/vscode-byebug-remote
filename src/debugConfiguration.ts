import { config } from 'node:process'
import * as vscode from 'vscode'
import * as path from 'path'

export class ByebugConfigurationProvider
  implements vscode.DebugConfigurationProvider {
  constructor(private defaultDebugAdapterType: string = 'ruby-byebug') {}

  public async provideDebugConfigurations(
    folder: vscode.WorkspaceFolder | undefined,
    token?: vscode.CancellationToken
  ): Promise<vscode.DebugConfiguration[] | undefined> {
    return await this.pickConfiguration()
  }

  public async pickConfiguration(): Promise<vscode.DebugConfiguration[]> {
    const debugConfigurations = [
      {
        label: 'Byebug: Connect to server',
        description: 'Connect to a remote byebug instance',
        config: {
          name: 'Connect to server',
          type: 'ruby-byebug',
          request: 'attach',
          port: 12345,
          host: '127.0.0.1'
        },
        fill: async (config: vscode.DebugConfiguration) => {
          const host = await vscode.window.showInputBox({
            prompt: 'Enter hostname',
            value: '127.0.0.1'
          })
          if (host) {
            config.host = host
          }
          const port = Number(
            await vscode.window.showInputBox({
              prompt: 'Enter port',
              value: '12345',
              validateInput: (value: string) => {
                if (isNaN(Number(value))) {
                  return 'Please enter a number.'
                }
                return ''
              }
            })
          )
          if (port) {
            config.port = port
          }
        }
      }
    ]

    const choice = await vscode.window.showQuickPick(debugConfigurations, {
      placeHolder: 'Choose debug configuration'
    })

    if (!choice) {
      return []
    }

    if (choice.fill) {
      await choice.fill(choice.config)
    }
    return [choice.config]
  }

  public async resolveDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    debugConfiguration: vscode.DebugConfiguration,
    token?: vscode.CancellationToken
  ): Promise<vscode.DebugConfiguration> {
    const activeEditor = vscode.window.activeTextEditor

    if (!debugConfiguration || !debugConfiguration.request) {
      // if 'request' is missing interpret this as a missing launch.json
      if (!activeEditor || activeEditor.document.languageId !== 'ruby') {
        await vscode.window.showInformationMessage(
          'Select a ruby file to debug'
        )

        return debugConfiguration
      }

      debugConfiguration = Object.assign(debugConfiguration || {}, {
        name: 'Launch',
        type: this.defaultDebugAdapterType,
        request: 'launch',
        mode: 'auto',
        program: path.dirname(activeEditor.document.fileName) // matches ${fileDirname}
      })
    }

    return debugConfiguration
  }
}
