import * as fsp from 'fs/promises';
import * as path from 'path';
import { Schema, Entity, Column, Relationship, RelationshipType, PendingForeignKey } from './schema';

const IRREGULAR_PLURALS: Record<string, string> = {
  person: 'people',
  child: 'children',
  goose: 'geese',
  mouse: 'mice',
  man: 'men',
  woman: 'women',
  tooth: 'teeth',
  foot: 'feet',
  ox: 'oxen',
  cactus: 'cacti',
  focus: 'foci',
  analysis: 'analyses',
  criterion: 'criteria',
};

const UNCOUNTABLE_TABLE_NAMES = new Set(['sheep', 'fish', 'deer', 'species', 'series']);
const F_TO_VES_TABLE_NAMES = new Set(['knife', 'wolf', 'leaf', 'life', 'wife', 'half']);
const ELOQUENT_BASE_CLASS_NAMES = new Set(['Model', 'Authenticatable', 'Pivot', 'MorphPivot']);
const ELOQUENT_BASE_CLASS_PATHS = new Set([
  'Illuminate\\Database\\Eloquent\\Model',
  'Illuminate\\Database\\Eloquent\\Relations\\Pivot',
  'Illuminate\\Database\\Eloquent\\Relations\\MorphPivot',
  'Illuminate\\Foundation\\Auth\\User',
]);

function pluralizeSnakeSegment(segment: string): string {
  if (UNCOUNTABLE_TABLE_NAMES.has(segment)) {
    return segment;
  }

  const irregular = IRREGULAR_PLURALS[segment];
  if (irregular) {
    return irregular;
  }

  if (/[^aeiou]y$/.test(segment)) {
    return segment.slice(0, -1) + 'ies';
  }

  if (F_TO_VES_TABLE_NAMES.has(segment)) {
    return segment.replace(/(?:fe|f)$/, 'ves');
  }

  if (/[^z]z$/.test(segment)) {
    return segment + 'zes';
  }

  if (/(?:s|sh|ch|x|z)$/.test(segment)) {
    return segment + 'es';
  }

  return segment + 's';
}

// Convert Laravel class name to table name (convention)
export function classToTable(name: string): string {
  const snake = name
    .replace(/([A-Z])/g, (m, p, offset) => (offset > 0 ? '_' : '') + p.toLowerCase())
    .replace(/^_/, '');
  const parts = snake.split('_');
  const lastPart = parts.pop();
  if (!lastPart) {
    return snake;
  }
  return [...parts, pluralizeSnakeSegment(lastPart)].join('_');
}

// Extract string from quoted PHP - handles single and double quotes
function unquote(s: string): string {
  return s.replace(/^['"]|['"]$/g, '').trim();
}

function normalizePhpClassName(className: string): string {
  return className.replace(/^\\+/, '').trim();
}

function getPhpClassBaseName(className: string): string {
  const normalized = normalizePhpClassName(className);
  return normalized.split('\\').pop() ?? normalized;
}

function relationshipModelName(className: string): string {
  return getPhpClassBaseName(className);
}

function parsePhpUseAliases(content: string): Map<string, string> {
  const aliases = new Map<string, string>();
  const useRegex = /^\s*use\s+([^;]+);/gm;
  let useMatch: RegExpExecArray | null;

  while ((useMatch = useRegex.exec(content)) !== null) {
    const imported = useMatch[1].trim();
    if (imported.includes('{') || imported.includes(',')) {
      continue;
    }

    const aliasMatch = imported.match(/\s+as\s+(\w+)$/i);
    const classPath = normalizePhpClassName(imported.replace(/\s+as\s+\w+$/i, ''));
    const alias = aliasMatch ? aliasMatch[1] : getPhpClassBaseName(classPath);
    aliases.set(alias, classPath);
  }

  return aliases;
}

function extendsEloquentModel(content: string, extendedClass: string): boolean {
  const normalized = normalizePhpClassName(extendedClass);
  if (ELOQUENT_BASE_CLASS_PATHS.has(normalized)) {
    return true;
  }

  const baseName = getPhpClassBaseName(normalized);
  if (ELOQUENT_BASE_CLASS_NAMES.has(baseName)) {
    return true;
  }

  const importedClass = parsePhpUseAliases(content).get(baseName);
  return importedClass ? ELOQUENT_BASE_CLASS_PATHS.has(importedClass) : false;
}

// Parse column modifiers from a chain like ->nullable()->default('x')->unique()
function parseModifiers(chain: string): { nullable: boolean; unique: boolean; default?: string; unsigned: boolean } {
  return {
    nullable: /->nullable\(\)/.test(chain),
    unique: /->unique\(\)/.test(chain),
    unsigned: /->unsigned\(\)/.test(chain),
    default: (() => {
      const m = chain.match(/->default\((['"]?)(.+?)\1\)/);
      return m ? m[2] : undefined;
    })(),
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

// Recursively collect all .php files from a directory. Uses the Dirent
// metadata returned by `withFileTypes: true` to avoid an extra stat per
// entry, and recurses into subdirectories in parallel.
async function collectPhpFiles(dir: string): Promise<string[]> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const directFiles: string[] = [];
  const subdirPromises: Promise<string[]>[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      subdirPromises.push(collectPhpFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.php')) {
      directFiles.push(fullPath);
    }
  }

  const nested = await Promise.all(subdirPromises);
  for (const list of nested) {
    directFiles.push(...list);
  }
  return directFiles;
}

function joinMultilineChains(content: string): string[] {
  const statements: string[] = [];
  let currentStatement = '';

  for (const rawLine of content.split('\n')) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine) {
      continue;
    }

    if (trimmedLine.startsWith('$table->')) {
      currentStatement = trimmedLine;
    } else if (currentStatement && trimmedLine.startsWith('->')) {
      currentStatement += trimmedLine;
    } else {
      continue;
    }

    if (currentStatement.endsWith(';')) {
      statements.push(currentStatement);
      currentStatement = '';
    }
  }

  if (currentStatement) {
    statements.push(currentStatement);
  }

  return statements;
}

function parseMigrationBlock(content: string, filePath: string): Entity | null {
  // Find Schema::create / Schema::table
  const tableMatch = content.match(/Schema::(?:create|table)\s*\(\s*['"]([^'"]+)['"]/);
  if (!tableMatch) return null;

  const tableName = tableMatch[1];

  // Derive a display name from table name
  const nameParts = tableName.split('_');
  const name = nameParts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');

  const columns: Column[] = [];
  const pendingForeignKeys: PendingForeignKey[] = [];

  // Match each $table->... statement, including multiline modifier chains.
  for (const line of joinMultilineChains(content)) {

    // id() shorthand
    if (/\$table->id\(\)/.test(line)) {
      columns.push({ name: 'id', type: 'bigint', nullable: false, primaryKey: true, unique: true, autoIncrement: true, unsigned: true });
      continue;
    }

    // timestamps()
    if (/\$table->timestamps\(\)/.test(line)) {
      columns.push({ name: 'created_at', type: 'timestamp', nullable: true, primaryKey: false, unique: false, autoIncrement: false, unsigned: false });
      columns.push({ name: 'updated_at', type: 'timestamp', nullable: true, primaryKey: false, unique: false, autoIncrement: false, unsigned: false });
      continue;
    }

    // softDeletes()
    if (/\$table->softDeletes\(\)/.test(line)) {
      columns.push({ name: 'deleted_at', type: 'timestamp', nullable: true, primaryKey: false, unique: false, autoIncrement: false, unsigned: false });
      continue;
    }

    // rememberToken()
    if (/\$table->rememberToken\(\)/.test(line)) {
      columns.push({ name: 'remember_token', type: 'string(100)', nullable: true, primaryKey: false, unique: false, autoIncrement: false, unsigned: false });
      continue;
    }

    // foreignId('col_name')->constrained('table') or ->constrained()
    const foreignIdMatch = line.match(/\$table->foreignId\s*\(\s*['"]([^'"]+)['"]\s*\)(.*)/);
    if (foreignIdMatch) {
      const colName = foreignIdMatch[1];
      const rest = foreignIdMatch[2];
      const mods = parseModifiers(rest);

      let fkTable: string | undefined;
      let fkCol = 'id';

      const constrainedMatch = rest.match(/->constrained\s*\(\s*(?:['"]([^'"]+)['"])?\s*\)/);
      if (constrainedMatch) {
        if (constrainedMatch[1]) {
          fkTable = constrainedMatch[1];
        } else {
          // Infer: role_id → roles
          const base = colName.replace(/_id$/, '');
          fkTable = classToTable(base.charAt(0).toUpperCase() + base.slice(1));
        }
      }

      columns.push({
        name: colName,
        type: 'bigint unsigned',
        nullable: mods.nullable,
        primaryKey: false,
        unique: mods.unique,
        autoIncrement: false,
        unsigned: true,
        foreignKey: fkTable ? { table: fkTable, column: fkCol } : undefined,
      });
      continue;
    }

    // $table->foreign('col')->references('col')->on('table')
    const foreignMatch = line.match(/\$table->foreign\s*\(\s*['"]([^'"]+)['"]\s*\).*->references\s*\(\s*['"]([^'"]+)['"]\s*\).*->on\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (foreignMatch) {
      const colName = foreignMatch[1];
      const refCol = foreignMatch[2];
      const refTable = foreignMatch[3];
      // Update existing column if it exists
      const existingCol = columns.find(c => c.name === colName);
      if (existingCol) {
        existingCol.foreignKey = { table: refTable, column: refCol };
      } else {
        // The column was declared in an earlier migration; remember the FK so
        // parseProject can apply it after merging all migrations.
        pendingForeignKeys.push({ column: colName, references: { table: refTable, column: refCol } });
      }
      continue;
    }

    // Generic typed columns: $table->TYPE('name', ...) chains
    const typedMatch = line.match(/\$table->(\w+)\s*\(\s*['"]([^'"]+)['"](,\s*[^)]+)?\)(.*)/);
    if (!typedMatch) continue;

    const phpType = typedMatch[1];
    const colName = typedMatch[2];
    const rest = typedMatch[4];
    const mods = parseModifiers(rest);

    // Skip non-column methods
    const skipMethods = ['index', 'unique', 'primary', 'dropColumn', 'dropForeign', 'foreign', 'engine', 'charset', 'collation'];
    if (skipMethods.includes(phpType)) continue;

    const typeMap: Record<string, string> = {
      string: 'varchar',
      text: 'text',
      longText: 'longtext',
      mediumText: 'mediumtext',
      integer: 'int',
      bigInteger: 'bigint',
      smallInteger: 'smallint',
      tinyInteger: 'tinyint',
      unsignedInteger: 'int unsigned',
      unsignedBigInteger: 'bigint unsigned',
      boolean: 'boolean',
      float: 'float',
      double: 'double',
      decimal: 'decimal',
      date: 'date',
      dateTime: 'datetime',
      timestamp: 'timestamp',
      time: 'time',
      year: 'year',
      json: 'json',
      jsonb: 'jsonb',
      uuid: 'uuid',
      ulid: 'ulid',
      enum: 'enum',
      char: 'char',
      binary: 'binary',
      ipAddress: 'varchar(45)',
      macAddress: 'varchar(17)',
      morphs: 'morphs',
    };

    const mappedType = typeMap[phpType] ?? phpType;
    const isPK = phpType === 'increments' || phpType === 'bigIncrements';

    columns.push({
      name: colName,
      type: mappedType,
      nullable: mods.nullable,
      default: mods.default,
      primaryKey: isPK,
      unique: mods.unique || isPK,
      autoIncrement: isPK,
      unsigned: mods.unsigned || phpType.startsWith('unsigned'),
    });
  }

  return {
    name,
    tableName,
    columns,
    fillable: [],
    guarded: [],
    relationships: [],
    migrationFile: filePath,
    pendingForeignKeys: pendingForeignKeys.length > 0 ? pendingForeignKeys : undefined,
  };
}

export function parseMigrations(content: string, filePath: string): Entity[] {
  const schemaBlockRegex = /Schema::(?:create|table)\s*\(\s*['"][^'"]+['"][\s\S]*?\}\s*\)\s*;/g;
  const blocks = Array.from(content.matchAll(schemaBlockRegex), match => match[0]);
  const candidates = blocks.length > 0 ? blocks : [content];
  const entities: Entity[] = [];

  for (const candidate of candidates) {
    const parsed = parseMigrationBlock(candidate, filePath);
    if (parsed) {
      entities.push(parsed);
    }
  }

  return entities;
}

export function parseMigration(content: string, filePath: string): Entity | null {
  return parseMigrations(content, filePath)[0] ?? null;
}

export function parseModel(content: string, filePath: string): Partial<Entity> | null {
  const classMatch = content.match(/class\s+(\w+)\s+extends\s+(\\?[\w\\]+)/);
  if (!classMatch) return null;

  // Skip migrations themselves
  if (/extends\s+Migration/.test(content)) return null;

  const extendedClass = classMatch[2];
  if (!extendsEloquentModel(content, extendedClass)) return null;

  const name = classMatch[1];

  // Custom table
  let tableName: string | undefined;
  const tableMatch = content.match(/protected\s+\$table\s*=\s*['"]([^'"]+)['"]/);
  if (tableMatch) {
    tableName = tableMatch[1];
  } else {
    tableName = classToTable(name);
  }

  // $fillable
  const fillable: string[] = [];
  const fillableMatch = content.match(/protected\s+\$fillable\s*=\s*\[([^\]]*)\]/s);
  if (fillableMatch) {
    const inner = fillableMatch[1];
    const items = inner.match(/['"]([^'"]+)['"]/g) ?? [];
    fillable.push(...items.map(unquote));
  }

  // $guarded
  const guarded: string[] = [];
  const guardedMatch = content.match(/protected\s+\$guarded\s*=\s*\[([^\]]*)\]/s);
  if (guardedMatch) {
    const inner = guardedMatch[1];
    const items = inner.match(/['"]([^'"]+)['"]/g) ?? [];
    guarded.push(...items.map(unquote));
  }

  // Relationships
  const relationships: Relationship[] = [];
  const relTypes: RelationshipType[] = [
    'belongsTo', 'hasMany', 'hasOne', 'belongsToMany',
    'morphMany', 'morphTo', 'hasOneThrough', 'hasManyThrough',
  ];

  const methodRegex = /public\s+function\s+(\w+)\s*\([^)]*\)[^{]*\{[^}]*return\s+\$this->(\w+)\s*\(\s*(\\?[\w\\]+)::class/g;
  let m: RegExpExecArray | null;
  while ((m = methodRegex.exec(content)) !== null) {
    const methodName = m[1];
    const relType = m[2] as RelationshipType;
    const relatedModel = relationshipModelName(m[3]);
    if (relTypes.includes(relType)) {
      relationships.push({ name: methodName, type: relType, relatedModel });
    }
  }

  const morphToRegex = /public\s+function\s+(\w+)\s*\([^)]*\)[^{]*\{[^}]*return\s+\$this->morphTo\s*\(/g;
  while ((m = morphToRegex.exec(content)) !== null) {
    relationships.push({ name: m[1], type: 'morphTo', relatedModel: m[1] });
  }

  return { name, tableName, fillable, guarded, relationships, modelFile: filePath };
}

export async function parseProject(workspacePath: string): Promise<Schema> {
  const entities: Entity[] = [];

  // Parse migrations
  const migrationsDir = path.join(workspacePath, 'database', 'migrations');
  if (await pathExists(migrationsDir)) {
    const files = (await fsp.readdir(migrationsDir))
      .filter(fileName => fileName.endsWith('.php'))
      .sort(); // chronological order

    // Read files in parallel, but preserve chronological merge order below.
    const fileContents = await Promise.all(
      files.map(async file => {
        const fullPath = path.join(migrationsDir, file);
        try {
          return { fullPath, content: await fsp.readFile(fullPath, 'utf8') };
        } catch {
          return { fullPath, content: null as string | null };
        }
      })
    );

    for (const { fullPath, content } of fileContents) {
      if (content === null) continue;
      let parsedEntities: Entity[];
      try {
        parsedEntities = parseMigrations(content, fullPath);
      } catch {
        continue;
      }
      for (const parsed of parsedEntities) {
        // Merge with existing entity (Schema::table alters)
        const existing = entities.find(e => e.tableName === parsed.tableName);
        if (existing) {
          for (const col of parsed.columns) {
            if (!existing.columns.find(c => c.name === col.name)) {
              existing.columns.push(col);
            }
          }
          if (parsed.pendingForeignKeys) {
            existing.pendingForeignKeys = [
              ...(existing.pendingForeignKeys ?? []),
              ...parsed.pendingForeignKeys,
            ];
          }
        } else {
          entities.push(parsed);
        }
      }
    }

    // Apply any pending FK declarations (from alter migrations whose column
    // was defined in another file) to their referenced columns.
    for (const entity of entities) {
      if (!entity.pendingForeignKeys) continue;
      for (const pending of entity.pendingForeignKeys) {
        const target = entity.columns.find(c => c.name === pending.column);
        if (target && !target.foreignKey) {
          target.foreignKey = { ...pending.references };
        }
      }
      delete entity.pendingForeignKeys;
    }
  }

  // Parse models (app/Models first, fallback to app/)
  const modelDirs = [
    path.join(workspacePath, 'app', 'Models'),
    path.join(workspacePath, 'app'),
  ];

  const seenFiles = new Set<string>();
  const modelFiles: string[] = [];

  for (const modelDir of modelDirs) {
    if (!await pathExists(modelDir)) continue;
    const files = await collectPhpFiles(modelDir);
    for (const filePath of files) {
      const resolvedFilePath = path.resolve(filePath);
      if (seenFiles.has(resolvedFilePath)) continue;
      seenFiles.add(resolvedFilePath);
      modelFiles.push(filePath);
    }
  }

  const modelFileContents = await Promise.all(
    modelFiles.map(async filePath => {
      try {
        return { filePath, content: await fsp.readFile(filePath, 'utf8') };
      } catch {
        return { filePath, content: null as string | null };
      }
    })
  );

  const entityByName = new Map<string, Entity>();
  const entityByTableName = new Map<string, Entity>();
  const rememberEntity = (entity: Entity): void => {
    entityByName.set(entity.name, entity);
    entityByTableName.set(entity.tableName, entity);
  };

  for (const entity of entities) {
    rememberEntity(entity);
  }

  for (const { filePath, content } of modelFileContents) {
    if (content === null) continue;
      try {
        const modelData = parseModel(content, filePath);
        if (!modelData || !modelData.name) continue;

        const existing = entityByName.get(modelData.name) ?? (
          modelData.tableName ? entityByTableName.get(modelData.tableName) : undefined
        );
        if (existing) {
          existing.fillable = modelData.fillable ?? [];
          existing.guarded = modelData.guarded ?? [];
          existing.relationships = modelData.relationships ?? [];
          existing.modelFile = modelData.modelFile;
        } else {
          const entity = {
            name: modelData.name,
            tableName: modelData.tableName ?? classToTable(modelData.name),
            columns: [],
            fillable: modelData.fillable ?? [],
            guarded: modelData.guarded ?? [],
            relationships: modelData.relationships ?? [],
            modelFile: modelData.modelFile,
          };
          entities.push(entity);
          rememberEntity(entity);
        }
      } catch {
        // Skip
      }
  }

  return { entities };
}
