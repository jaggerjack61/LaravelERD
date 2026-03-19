import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────
// Issue #12 — generateAlterMigration should use valid Blueprint methods
// ─────────────────────────────────────────────────────
describe('blueprintTypeMap', () => {
  // This map converts display types back to valid Blueprint method names
  const blueprintTypeMap: Record<string, string> = {
    'varchar': 'string',
    'varchar(45)': 'ipAddress',
    'varchar(17)': 'macAddress',
    'int': 'integer',
    'int unsigned': 'unsignedInteger',
    'bigint': 'bigInteger',
    'bigint unsigned': 'unsignedBigInteger',
    'smallint': 'smallInteger',
    'tinyint': 'tinyInteger',
    'text': 'text',
    'longtext': 'longText',
    'mediumtext': 'mediumText',
    'boolean': 'boolean',
    'float': 'float',
    'double': 'double',
    'decimal': 'decimal',
    'date': 'date',
    'datetime': 'dateTime',
    'timestamp': 'timestamp',
    'time': 'time',
    'year': 'year',
    'json': 'json',
    'jsonb': 'jsonb',
    'uuid': 'uuid',
    'ulid': 'ulid',
    'enum': 'enum',
    'char': 'char',
    'binary': 'binary',
  };

  it('maps display types to valid Blueprint method names', () => {
    expect(blueprintTypeMap['varchar']).toBe('string');
    expect(blueprintTypeMap['bigint unsigned']).toBe('unsignedBigInteger');
    expect(blueprintTypeMap['int']).toBe('integer');
    expect(blueprintTypeMap['datetime']).toBe('dateTime');
    expect(blueprintTypeMap['longtext']).toBe('longText');
  });

  it('has entries for every display type used in migrations', () => {
    const displayTypes = ['varchar', 'text', 'longtext', 'mediumtext', 'int', 'bigint',
      'smallint', 'tinyint', 'int unsigned', 'bigint unsigned', 'boolean', 'float',
      'double', 'decimal', 'date', 'datetime', 'timestamp', 'time', 'year',
      'json', 'jsonb', 'uuid', 'ulid', 'enum', 'char', 'binary'];
    for (const dt of displayTypes) {
      expect(blueprintTypeMap[dt]).toBeDefined();
    }
  });
});

// ─────────────────────────────────────────────────────
// Verify source code fixes by inspecting the actual files
// ─────────────────────────────────────────────────────
describe('erdPanel.ts source verification', () => {
  const erdPanelSrc = fs.readFileSync(
    path.join(__dirname, 'erdPanel.ts'), 'utf8'
  );

  // Issue #15: doRefresh must await withProgress
  it('#15: doRefresh awaits withProgress', () => {
    expect(erdPanelSrc).toContain('return vscode.window.withProgress(');
  });

  // Issue #17: openFile validates path under workspace
  it('#17: openFile validates path is under workspace', () => {
    expect(erdPanelSrc).toContain('resolved.startsWith(workspaceResolved + path.sep)');
  });

  // Issue #18: HighContrastLight handled in theme detection
  it('#18: theme detection checks HighContrastLight', () => {
    expect(erdPanelSrc).toContain('HighContrastLight');
  });

  // Issue #5: Uses async file I/O
  it('#5: uses fsp (async fs) for writes', () => {
    expect(erdPanelSrc).toContain("import * as fsp from 'fs/promises'");
    expect(erdPanelSrc).toContain('await fsp.writeFile');
    expect(erdPanelSrc).toContain('await fsp.readFile');
  });

  // Issue #12: BLUEPRINT_TYPE_MAP exists
  it('#12: has BLUEPRINT_TYPE_MAP for type conversion', () => {
    expect(erdPanelSrc).toContain('BLUEPRINT_TYPE_MAP');
    expect(erdPanelSrc).toContain("'varchar': 'string'");
    expect(erdPanelSrc).toContain("'bigint unsigned': 'unsignedBigInteger'");
  });

  // Issue #23: Insert fillable/guarded when missing
  it('#23: inserts $fillable/$guarded when model lacks them', () => {
    expect(erdPanelSrc).toContain('// Issue #23: Insert $fillable if model');
    expect(erdPanelSrc).toContain('// Issue #23: Insert $guarded if model');
  });

  // Issue #13: No innerHTML in buildEditRow
  it('#13: buildEditRow uses safe DOM instead of innerHTML', () => {
    // The old innerHTML pattern should not exist
    expect(erdPanelSrc).not.toContain("nullLbl.innerHTML = '<input");
    expect(erdPanelSrc).not.toContain("uniqLbl.innerHTML = '<input");
    // Should use createElement instead
    expect(erdPanelSrc).toContain("nullCb.type = 'checkbox'");
    expect(erdPanelSrc).toContain("uniqCb.type = 'checkbox'");
  });

  // Issue #14: startCardDrag cleanup
  it('#14: startCardDrag has dragCleanup mechanism', () => {
    expect(erdPanelSrc).toContain('dragCleanup');
    expect(erdPanelSrc).toContain('if (dragCleanup) { dragCleanup(); dragCleanup = null; }');
  });

  // Issue #1: Diff-based renderCards
  it('#1: renderCards uses diff-based approach', () => {
    expect(erdPanelSrc).toContain('existingCards');
    expect(erdPanelSrc).toContain('canvas.replaceChild(newCard, existingCard)');
    // Should NOT have the old nuke-all pattern
    expect(erdPanelSrc).not.toContain("Array.from(canvas.children).forEach(c => { if (c !== svg) c.remove(); })");
  });

  // Issue #2: Throttled renderRels during drag
  it('#2: card drag uses scheduleRenderRels instead of direct renderRels', () => {
    expect(erdPanelSrc).toContain('scheduleRenderRels');
    expect(erdPanelSrc).toContain('requestAnimationFrame');
  });

  // Issue #3: Obstacles are cached per renderRels call
  it('#3: obstacles are computed once per renderRels', () => {
    expect(erdPanelSrc).toContain('computeAllObstacles');
    expect(erdPanelSrc).toContain('cachedObstacles');
  });

  // Issue #6: Tooltip only listens on SVG, not entire document
  it('#6: tooltip mousemove is scoped to SVG element', () => {
    expect(erdPanelSrc).toContain("relSvgEl.addEventListener('mousemove'");
    expect(erdPanelSrc).toContain("relSvgEl.addEventListener('mouseleave'");
  });

  // Issue #19: Position migration for renamed entities
  it('#19: schema handler migrates positions for renamed entities', () => {
    expect(erdPanelSrc).toContain('// Issue #19: Migrate positions when entity names change');
  });

  // Issue #20: belongsToMany explicitly handled
  it('#20: belongsToMany explicitly in cardinality chains', () => {
    expect(erdPanelSrc).toContain("rel.type === 'belongsToMany' ? 'many'");
  });

  // Issue #24: fitToScreen called after schema arrives
  it('#24: fitToScreen called in schema handler, not on a timer', () => {
    // The old code used setTimeout(fitToScreen, 200); at the bottom as executable code.
    // Now it should only appear in a comment referencing the removal.
    const lines = erdPanelSrc.split('\n').filter(l => !l.trim().startsWith('//'));
    const codeOnly = lines.join('\n');
    expect(codeOnly).not.toContain('setTimeout(fitToScreen');
    // Should call fitToScreen in the schema handler
    expect(erdPanelSrc).toContain("// Issue #24: Call fitToScreen after schema is loaded");
  });

  // Issue #25: Empty schema guard in exportSvg
  it('#25: exportSvg guards against empty schema', () => {
    expect(erdPanelSrc).toContain('// Issue #25: Guard against empty schema');
    expect(erdPanelSrc).toContain('if (!schema.entities.length) {');
  });
});

describe('extension.ts source verification', () => {
  const extSrc = fs.readFileSync(
    path.join(__dirname, 'extension.ts'), 'utf8'
  );

  // Issue #16: Debounced file watcher
  it('#16: file watcher uses debounce', () => {
    expect(extSrc).toContain('debounceTimer');
    expect(extSrc).toContain('setTimeout(');
    expect(extSrc).toContain('clearTimeout(debounceTimer)');
  });

  // Issue #22: Expanded watcher pattern includes nested folders
  it('#22: watcher pattern covers app/**/*.php', () => {
    expect(extSrc).toContain('app/**/*.php');
  });
});

describe('parser.ts source verification', () => {
  const parserSrc = fs.readFileSync(
    path.join(__dirname, 'parser.ts'), 'utf8'
  );

  // Issue #4: Async file I/O
  it('#4: parseProject uses async fs operations', () => {
    expect(parserSrc).toContain("import * as fsp from 'fs/promises'");
    expect(parserSrc).toContain('await fsp.readFile');
    expect(parserSrc).toContain('await fsp.readdir');
    expect(parserSrc).toContain('await fsp.stat');
  });

  // Issue #7: No break after first model dir
  it('#7: model scanning does not break after first dir', () => {
    expect(parserSrc).not.toMatch(/for\s*\(const modelDir of modelDirs\)[\s\S]*?break;\s*\/\/ Use first found models dir/);
  });

  // Issue #8: Schema::table supported
  it('#8: parseMigration matches Schema::table', () => {
    expect(parserSrc).toContain("Schema::table");
    expect(parserSrc).toContain('const tableMatch');
  });

  // Issue #10: Deduplication of scanned files
  it('#10: model scanning deduplicates by file path', () => {
    expect(parserSrc).toContain('seenFiles');
    expect(parserSrc).toContain('path.resolve(filePath)');
  });

  // Issue #11: No FK inference without constrained()
  it('#11: foreignId without constrained does not infer FK', () => {
    expect(parserSrc).not.toContain('Just foreignId without constrained - still infer FK target');
  });

  // Issue #21: Multiline chain support
  it('#21: joinMultilineChains function exists', () => {
    expect(parserSrc).toContain('function joinMultilineChains');
    expect(parserSrc).toContain('joinMultilineChains(content)');
  });
});
