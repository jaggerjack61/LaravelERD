import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveWorkspaceRoot } from './workspaceRoot';

type WorkspaceFolderLike = { uri: { fsPath: string } };

function makeWorkspaceFolder(fsPath: string): WorkspaceFolderLike {
  return { uri: { fsPath } };
}

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function touch(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '', 'utf8');
}

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('resolveWorkspaceRoot', () => {
  it('prefers the active Laravel workspace folder over the first workspace folder', () => {
    const extensionRepo = makeTempDir('laravel-erd-ext-');
    const laravelProject = makeTempDir('laravel-erd-app-');
    tempDirs.push(extensionRepo, laravelProject);

    touch(path.join(laravelProject, 'artisan'));

    const workspaceFolders = [
      makeWorkspaceFolder(extensionRepo),
      makeWorkspaceFolder(laravelProject),
    ];

    const resolved = resolveWorkspaceRoot(
      workspaceFolders,
      path.join(laravelProject, 'app', 'Models', 'User.php')
    );

    expect(resolved).toBe(laravelProject);
  });

  it('test_resolveWorkspaceRoot_nestedLaravelFolders_prefersDeepestActiveFolder', () => {
    const parentProject = makeTempDir('laravel-erd-parent-');
    const nestedProject = path.join(parentProject, 'packages', 'billing');
    tempDirs.push(parentProject);

    touch(path.join(parentProject, 'artisan'));
    touch(path.join(nestedProject, 'artisan'));

    const workspaceFolders = [
      makeWorkspaceFolder(parentProject),
      makeWorkspaceFolder(nestedProject),
    ];

    const resolved = resolveWorkspaceRoot(
      workspaceFolders,
      path.join(nestedProject, 'app', 'Models', 'Invoice.php')
    );

    expect(resolved).toBe(nestedProject);
  });

  it('falls back to the first Laravel workspace folder when there is no active file', () => {
    const nonLaravelProject = makeTempDir('laravel-erd-other-');
    const laravelProject = makeTempDir('laravel-erd-app-');
    tempDirs.push(nonLaravelProject, laravelProject);

    touch(path.join(laravelProject, 'database', 'migrations', '2024_01_01_000000_create_users_table.php'));

    const workspaceFolders = [
      makeWorkspaceFolder(nonLaravelProject),
      makeWorkspaceFolder(laravelProject),
    ];

    const resolved = resolveWorkspaceRoot(workspaceFolders);

    expect(resolved).toBe(laravelProject);
  });

  it('falls back to the first workspace folder when no Laravel folder exists', () => {
    const firstFolder = makeTempDir('laravel-erd-first-');
    const secondFolder = makeTempDir('laravel-erd-second-');
    tempDirs.push(firstFolder, secondFolder);

    const workspaceFolders = [
      makeWorkspaceFolder(firstFolder),
      makeWorkspaceFolder(secondFolder),
    ];

    const resolved = resolveWorkspaceRoot(workspaceFolders);

    expect(resolved).toBe(firstFolder);
  });
});