import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createUniqueMigrationPath, insertBeforeFinalClassBrace } from './erdPanelHelpers';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

describe('insertBeforeFinalClassBrace', () => {
  it('test_insertBeforeFinalClassBrace_oneLineClass_insertsMemberBeforeClosingBrace', () => {
    const content = `<?php
class User extends Model {}`;

    const result = insertBeforeFinalClassBrace(content, `    protected $fillable = ['name'];`);

    expect(result).toBe(`<?php
class User extends Model {
    protected $fillable = ['name'];
}`);
  });
});

describe('createUniqueMigrationPath', () => {
  it('test_createUniqueMigrationPath_existingTimestampFile_returnsSuffixedPath', async () => {
    const migrationsDir = makeTempDir('laravel-erd-migrations-');
    tempDirs.push(migrationsDir);
    const timestamp = '20260519120000';
    const existingPath = path.join(migrationsDir, `${timestamp}_alter_tables_add_columns.php`);
    fs.writeFileSync(existingPath, '<?php', 'utf8');

    const result = await createUniqueMigrationPath(migrationsDir, timestamp);

    expect(result).toBe(path.join(migrationsDir, `${timestamp}_alter_tables_add_columns_1.php`));
  });
});