import * as fs from 'fs';
import * as path from 'path';

export type WorkspaceFolderLike = { uri: { fsPath: string } };

function isPathInside(childPath: string, parentPath: string): boolean {
  const childResolved = path.resolve(childPath);
  const parentResolved = path.resolve(parentPath);

  return childResolved === parentResolved || childResolved.startsWith(parentResolved + path.sep);
}

export function isLaravelProjectPath(workspaceRoot: string): boolean {
  return (
    fs.existsSync(path.join(workspaceRoot, 'artisan')) ||
    fs.existsSync(path.join(workspaceRoot, 'database', 'migrations'))
  );
}

export function getLaravelWorkspaceRoots(
  workspaceFolders: readonly WorkspaceFolderLike[] | undefined
): string[] {
  return (workspaceFolders ?? [])
    .map(folder => folder.uri.fsPath)
    .filter(isLaravelProjectPath);
}

export function resolveWorkspaceRoot(
  workspaceFolders: readonly WorkspaceFolderLike[] | undefined,
  activeFilePath?: string
): string | undefined {
  const folderPaths = (workspaceFolders ?? []).map(folder => folder.uri.fsPath);
  if (folderPaths.length === 0) {
    return undefined;
  }

  if (activeFilePath) {
    const activeFolder = folderPaths.find(folderPath => isPathInside(activeFilePath, folderPath));
    if (activeFolder && isLaravelProjectPath(activeFolder)) {
      return activeFolder;
    }
  }

  const firstLaravelFolder = folderPaths.find(isLaravelProjectPath);
  if (firstLaravelFolder) {
    return firstLaravelFolder;
  }

  return folderPaths[0];
}