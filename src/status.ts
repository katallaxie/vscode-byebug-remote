import * as vscode from 'vscode'

export const outputChannel = vscode.window.createOutputChannel('Byebug')

export const diagnosticsStatusBarItem = vscode.window.createStatusBarItem(
  vscode.StatusBarAlignment.Left
)
