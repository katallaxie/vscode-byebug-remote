import vscode = require('vscode')
import { extensionId } from './const'

export class WelcomePanel {
  public static currentPanel: WelcomePanel | undefined

  public static readonly viewType = 'welcomeRubyByebug'

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined

    if (WelcomePanel.currentPanel) {
      WelcomePanel.currentPanel.panel.reveal(column)
      return
    }

    const panel = vscode.window.createWebviewPanel(
      WelcomePanel.viewType,
      'Ruby Remote Debug',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri)]
      }
    )

    WelcomePanel.currentPanel = new WelcomePanel(panel, extensionUri)
  }

  public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    WelcomePanel.currentPanel = new WelcomePanel(panel, extensionUri)
  }

  private readonly panel: vscode.WebviewPanel
  private readonly extensionUri: vscode.Uri
  private readonly dataroot: vscode.Uri
  private disposables: vscode.Disposable[] = []

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel
    this.extensionUri = extensionUri
    this.dataroot = vscode.Uri.joinPath(this.extensionUri, 'media')

    this.update()

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables)

    this.panel.webview.onDidReceiveMessage(
      message => {
        console.log(message)
        switch (message.command) {
          case 'alert':
            vscode.window.showErrorMessage(message.text)
            return
          case 'openDocument':
            const uri = vscode.Uri.joinPath(this.extensionUri, message.document)
            vscode.commands.executeCommand('markdown.showPreviewToSide', uri)
            return
          case 'openSetting':
            vscode.commands.executeCommand(
              'workbench.action.openSettings',
              message.setting
            )
            return
        }
      },
      null,
      this.disposables
    )
  }

  public dispose() {
    WelcomePanel.currentPanel = undefined

    // Clean up our resources
    this.panel.dispose()

    while (this.disposables.length) {
      const x = this.disposables.pop()
      if (x) {
        x.dispose()
      }
    }
  }

  private update() {
    const webview = this.panel.webview
    this.panel.webview.html = this.getHtmlForWebview(webview)
  }

  private getHtmlForWebview(webview: vscode.Webview) {
    const extension = vscode.extensions.getExtension(extensionId)!
    const version = extension.packageJSON.version

    // Use a nonce to only allow specific scripts to be run
    const nonce = getNonce()

    return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<!--
					Use a content security policy to only allow loading images from https or from our extension directory,
					and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Ruby Remote Debug</title>
			</head>
			<body>
			<main class="Content">
			<div class="Header">
        Whoop! Whoop!
			</div>

			</body>
			</html>`
  }
}

function getNonce() {
  let text = ''
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  return text
}
