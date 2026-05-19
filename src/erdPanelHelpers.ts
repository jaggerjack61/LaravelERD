import * as fsp from 'fs/promises';
import * as path from 'path';

const ALTER_COLUMNS_MIGRATION_NAME = 'alter_tables_add_columns';

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export function insertBeforeFinalClassBrace(content: string, insertion: string): string | null {
  const closingBraceMatch = content.match(/}\s*$/);
  if (!closingBraceMatch || closingBraceMatch.index === undefined) {
    return null;
  }

  const beforeBrace = content.slice(0, closingBraceMatch.index).replace(/\s*$/, '');
  const afterBrace = content.slice(closingBraceMatch.index + 1);
  const separator = beforeBrace.endsWith('{') ? '\n' : '\n\n';

  return `${beforeBrace}${separator}${insertion}\n}${afterBrace}`;
}

export async function createUniqueMigrationPath(
  migrationsDir: string,
  timestamp: string,
  baseName = ALTER_COLUMNS_MIGRATION_NAME
): Promise<string> {
  let index = 0;

  while (true) {
    const suffix = index === 0 ? '' : `_${index}`;
    const filePath = path.join(migrationsDir, `${timestamp}_${baseName}${suffix}.php`);
    if (!await pathExists(filePath)) {
      return filePath;
    }
    index += 1;
  }
}