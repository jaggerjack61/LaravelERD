import * as vscode from 'vscode';
import { ErdPanel } from './erdPanel';
import { getLaravelWorkspaceRoots, isLaravelProjectPath, resolveWorkspaceRoot } from './workspaceRoot';

let watchers: vscode.FileSystemWatcher[] = [];
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const getWorkspaceRoot = (): string | undefined => resolveWorkspaceRoot(
    vscode.workspace.workspaceFolders,
    vscode.window.activeTextEditor?.document.uri.fsPath
  );
  const laravelWorkspaceRoots = getLaravelWorkspaceRoots(workspaceFolders);

  // Register welcome tree view
  const treeProvider = new LaravelErdTreeProvider(getWorkspaceRoot());
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('laravelErd.welcome', treeProvider)
  );

  // Command: Open ERD
  context.subscriptions.push(
    vscode.commands.registerCommand('laravelErd.openErd', () => {
      const workspaceRoot = getWorkspaceRoot();
      if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }
      if (!isLaravelProjectPath(workspaceRoot)) {
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
  const onChanged = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      ErdPanel.refresh();
    }, 250);
  };

  for (const workspaceRoot of laravelWorkspaceRoots) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceRoot, '{database/migrations/*.php,app/**/*.php}')
    );
    watcher.onDidChange(onChanged);
    watcher.onDidCreate(onChanged);
    watcher.onDidDelete(onChanged);
    watchers.push(watcher);
    context.subscriptions.push(watcher);
  }

  // Auto-open if Laravel project detected on startup
  if (laravelWorkspaceRoots.length > 0) {
    // Don't auto-open panel but show notification
    treeProvider.setHasLaravel(true);
  }
}

export function deactivate(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  watchers.forEach(watcher => watcher.dispose());
  watchers = [];
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
