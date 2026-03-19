import * as fs from 'fs';
import * as path from 'path';
import { Schema, Entity, Column, Relationship, RelationshipType } from './schema';

// Convert Laravel class name to table name (convention)
export function classToTable(name: string): string {
  const snake = name
    .replace(/([A-Z])/g, (m, p, offset) => (offset > 0 ? '_' : '') + p.toLowerCase())
    .replace(/^_/, '');
  if (snake.endsWith('y') && !/[aeiou]y$/.test(snake)) {
    return snake.slice(0, -1) + 'ies';
  }
  if (/(?:s|sh|ch|x|z)$/.test(snake)) {
    return snake + 'es';
  }
  return snake + 's';
}

// Extract string from quoted PHP - handles single and double quotes
function unquote(s: string): string {
  return s.replace(/^['"]|['"]$/g, '').trim();
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

// Recursively collect all .php files from a directory
function collectPhpFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectPhpFiles(fullPath));
    } else if (entry.name.endsWith('.php')) {
      results.push(fullPath);
    }
  }
  return results;
}

export function parseMigration(content: string, filePath: string): Entity | null {
  // Find Schema::create / Schema::table
  const createMatch = content.match(/Schema::create\s*\(\s*['"]([^'"]+)['"]/);
  if (!createMatch) return null;

  const tableName = createMatch[1];

  // Derive a display name from table name
  const nameParts = tableName.split('_');
  const name = nameParts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');

  const columns: Column[] = [];

  // Match each $table->... line (greedy to end of statement)
  const lines = content.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('$table->')) continue;

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
      } else {
        // Just foreignId without constrained - still infer FK target
        const base = colName.replace(/_id$/, '');
        fkTable = classToTable(base.charAt(0).toUpperCase() + base.slice(1));
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
  };
}

export function parseModel(content: string, filePath: string): Partial<Entity> | null {
  // Must extend Model / Authenticatable / etc.
  const classMatch = content.match(/class\s+(\w+)\s+extends\s+\w+/);
  if (!classMatch) return null;

  // Skip migrations themselves
  if (/extends\s+Migration/.test(content)) return null;

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

  // Match public functions returning relationships
  const methodRegex = /public\s+function\s+(\w+)\s*\([^)]*\)[^{]*\{[^}]*return\s+\$this->(\w+)\s*\(\s*(\w+)::class/g;
  let m: RegExpExecArray | null;
  while ((m = methodRegex.exec(content)) !== null) {
    const methodName = m[1];
    const relType = m[2] as RelationshipType;
    const relatedModel = m[3];
    if (relTypes.includes(relType)) {
      relationships.push({ name: methodName, type: relType, relatedModel });
    }
  }

  return { name, tableName, fillable, guarded, relationships, modelFile: filePath };
}

export async function parseProject(workspacePath: string): Promise<Schema> {
  const entities: Entity[] = [];

  // Parse migrations
  const migrationsDir = path.join(workspacePath, 'database', 'migrations');
  if (fs.existsSync(migrationsDir)) {
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.php'))
      .sort(); // chronological order
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        const parsed = parseMigration(content, path.join(migrationsDir, file));
        if (parsed) {
          // Merge with existing entity (Schema::table alters)
          const existing = entities.find(e => e.tableName === parsed.tableName);
          if (existing) {
            // Add new columns from alter migrations
            for (const col of parsed.columns) {
              if (!existing.columns.find(c => c.name === col.name)) {
                existing.columns.push(col);
              }
            }
          } else {
            entities.push(parsed);
          }
        }
      } catch {
        // Skip unparseable files
      }
    }
  }

  // Parse models (app/Models first, fallback to app/)
  const modelDirs = [
    path.join(workspacePath, 'app', 'Models'),
    path.join(workspacePath, 'app'),
  ];

  for (const modelDir of modelDirs) {
    if (!fs.existsSync(modelDir)) continue;
    const files = collectPhpFiles(modelDir);
    for (const filePath of files) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const modelData = parseModel(content, filePath);
        if (!modelData || !modelData.name) continue;

        const existing = entities.find(e => e.name === modelData.name || e.tableName === modelData.tableName);
        if (existing) {
          existing.fillable = modelData.fillable ?? [];
          existing.guarded = modelData.guarded ?? [];
          existing.relationships = modelData.relationships ?? [];
          existing.modelFile = modelData.modelFile;
        } else {
          entities.push({
            name: modelData.name,
            tableName: modelData.tableName ?? classToTable(modelData.name),
            columns: [],
            fillable: modelData.fillable ?? [],
            guarded: modelData.guarded ?? [],
            relationships: modelData.relationships ?? [],
            modelFile: modelData.modelFile,
          });
        }
      } catch {
        // Skip
      }
    }
    break; // Use first found models dir
  }

  return { entities };
}
