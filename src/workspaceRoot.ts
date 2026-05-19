import * as fs from 'fs';
import * as path from 'path';

export type WorkspaceFolderLike = { uri: { fsPath: string } };

function isPathInside(childPath: string, parentPath: string): boolean {
  const childResolved = normalizePathForComparison(childPath);
  const parentResolved = normalizePathForComparison(parentPath);

  return childResolved === parentResolved || childResolved.startsWith(parentResolved + path.sep);
}

function normalizePathForComparison(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
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
    const activeLaravelFolders = folderPaths
      .filter(folderPath => isPathInside(activeFilePath, folderPath))
      .filter(isLaravelProjectPath)
      .sort((left, right) => path.resolve(right).length - path.resolve(left).length);

    if (activeLaravelFolders.length > 0) {
      return activeLaravelFolders[0];
    }
  }

  const firstLaravelFolder = folderPaths.find(isLaravelProjectPath);
  if (firstLaravelFolder) {
    return firstLaravelFolder;
  }

  return folderPaths[0];
}