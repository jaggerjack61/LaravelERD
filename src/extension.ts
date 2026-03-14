import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ErdPanel } from './erdPanel';

let watcher: vscode.FileSystemWatcher | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const workspaceRoot = workspaceFolders?.[0]?.uri.fsPath;

  // Register welcome tree view
  const treeProvider = new LaravelErdTreeProvider(workspaceRoot);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('laravelErd.welcome', treeProvider)
  );

  // Command: Open ERD
  context.subscriptions.push(
    vscode.commands.registerCommand('laravelErd.openErd', () => {
      if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }
      if (!isLaravelProject(workspaceRoot)) {
        vscode.window.showWarningMessage(
          'Laravel ERD: No artisan file detected. Make sure this is a Laravel project.'
        );
      }
      ErdPanel.createOrShow(context.extensionUri, workspaceRoot);
    })
  );

  // Command: Refresh
  context.subscriptions.push(
    vscode.commands.registerCommand('laravelErd.refresh', () => {
      ErdPanel.refresh();
    })
  );

  // FileSystemWatcher for migrations and models
  if (workspaceRoot) {
    watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceRoot, '{database/migrations/*.php,app/Models/*.php,app/*.php}')
    );
    const onChanged = () => ErdPanel.refresh();
    watcher.onDidChange(onChanged);
    watcher.onDidCreate(onChanged);
    watcher.onDidDelete(onChanged);
    context.subscriptions.push(watcher);
  }

  // Auto-open if Laravel project detected on startup
  if (workspaceRoot && isLaravelProject(workspaceRoot)) {
    // Don't auto-open panel but show notification
    treeProvider.setHasLaravel(true);
  }
}

export function deactivate(): void {
  watcher?.dispose();
}

function isLaravelProject(workspaceRoot: string): boolean {
  return (
    fs.existsSync(path.join(workspaceRoot, 'artisan')) ||
    fs.existsSync(path.join(workspaceRoot, 'database', 'migrations'))
  );
}

class LaravelErdTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private hasLaravel = false;
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private workspaceRoot: string | undefined) {}

  setHasLaravel(value: boolean): void {
    this.hasLaravel = value;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const openItem = new vscode.TreeItem('Open ERD Workspace');
    openItem.command = { command: 'laravelErd.openErd', title: 'Open ERD' };
    openItem.iconPath = new vscode.ThemeIcon('database');
    openItem.description = this.hasLaravel ? 'Laravel project detected' : 'Click to open';
    openItem.tooltip = 'Open the full-screen ERD editor';
    return [openItem];
  }
}
