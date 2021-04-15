// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { config } from 'node:process'
import * as vscode from 'vscode'
import { ByebugAdapterDescriptorFactory } from './debugFactory'
import { ByebugConfigurationProvider } from './debugConfiguration'
import { outputChannel } from './status'
import { WelcomePanel } from './welcome'

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(ctx: vscode.ExtensionContext) {
  outputChannel.appendLine('starting')

  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(
    'Congratulations, your extension "vscode-byebug-remote" is now active!'
  )

  if (vscode.window.registerWebviewPanelSerializer) {
    // Make sure we register a serializer in activation event
    vscode.window.registerWebviewPanelSerializer(WelcomePanel.viewType, {
      async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel) {
        WelcomePanel.revive(webviewPanel, ctx.extensionUri)
      }
    })
  }

  ctx.subscriptions.push(
    vscode.debug.onDidReceiveDebugSessionCustomEvent(e => {
      outputChannel.appendLine(e.body)
    })
  )

  // debug
  ctx.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(
      'ruby-byebug',
      new ByebugConfigurationProvider('ruby')
    )
  )

  ctx.subscriptions.push(
    vscode.commands.registerCommand('ruby-byebug.welcome', () => {
      WelcomePanel.createOrShow(ctx.extensionUri)
    })
  )

  const factory = new ByebugAdapterDescriptorFactory()
  ctx.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory('ruby-byebug', factory)
  )

  ctx.subscriptions.push(
    vscode.commands.registerCommand('ruby-byebug.debug.cursor', args => {
      if (vscode.debug.activeDebugSession) {
        vscode.window.showErrorMessage('Debug session has already been started')
        return
      }
    })
  )

  ctx.subscriptions.push(
    vscode.commands.registerCommand(
      'ruby-byebug.debug.startSession',
      config => {
        console.log('test')
      }
    )
  )

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  const disposable = vscode.commands.registerCommand(
    'ruby-byebug.helloWorld',
    () => {
      // The code you place here will be executed every time your command is executed

      // Display a message box to the user
      vscode.window.showInformationMessage(
        'Hello World from vscode-byebug-remote!'
      )
    }
  )

  ctx.subscriptions.push(disposable)
}

// this method is called when your extension is deactivated
export function deactivate() {
  // should cleanup
  return Promise.all([])
}
