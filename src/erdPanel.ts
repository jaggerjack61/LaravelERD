import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { parseProject } from './parser';
import { Schema, Entity, Column } from './schema';
import { createUniqueMigrationPath, insertBeforeFinalClassBrace } from './erdPanelHelpers';

const BLUEPRINT_TYPE_MAP: Record<string, string> = {
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

function isDarkTheme(): boolean {
  const kind = vscode.window.activeColorTheme.kind;
  return kind !== vscode.ColorThemeKind.Light && kind !== vscode.ColorThemeKind.HighContrastLight;
}

function isPathInsideWorkspace(candidatePath: string, workspacePath: string): boolean {
  const workspaceResolved = path.resolve(workspacePath);
  // Issue: relative candidate paths were resolved against process.cwd(); resolve against workspace instead.
  const resolved = path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(workspaceResolved, candidatePath);
  return resolved === workspaceResolved || resolved.startsWith(workspaceResolved + path.sep);
}

function toBlueprintMethod(type: string): string {
  return BLUEPRINT_TYPE_MAP[type] ?? type;
}

function escapePhpString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function getNonce(): string {
  // Use a CSPRNG so the CSP nonce can't be predicted from earlier values.
  return crypto.randomBytes(24).toString('base64').replace(/[+/=]/g, '');
}

export class ErdPanel {
  public static currentPanel: ErdPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly workspacePath: string;
  private disposables: vscode.Disposable[] = [];
  private schema: Schema = { entities: [] };

  public static createOrShow(extensionUri: vscode.Uri, workspacePath: string): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (ErdPanel.currentPanel) {
      if (path.resolve(ErdPanel.currentPanel.workspacePath) === path.resolve(workspacePath)) {
        ErdPanel.currentPanel.panel.reveal(column);
        return;
      }
      ErdPanel.currentPanel.panel.dispose();
    }
    const panel = vscode.window.createWebviewPanel(
      'laravelErd',
      'Laravel ERD',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );
    ErdPanel.currentPanel = new ErdPanel(panel, extensionUri, workspacePath);
  }

  public static refresh(): void {
    ErdPanel.currentPanel?.doRefresh();
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, workspacePath: string) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.workspacePath = workspacePath;

    this.panel.webview.html = this.getHtml(this.panel.webview);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'ready':
            await this.doRefresh();
            break;
          case 'refresh':
            await this.doRefresh();
            break;
          case 'save':
            await this.saveSchema(message.schema as Schema);
            break;
          case 'export':
            await this.exportSvg(message.content as string);
            break;
          case 'openFile':
            if (typeof message.path === 'string' && isPathInsideWorkspace(message.path, this.workspacePath)) {
              const resolvedPath = path.isAbsolute(message.path)
                ? path.resolve(message.path)
                : path.resolve(this.workspacePath, message.path);
              if (fs.existsSync(resolvedPath)) {
                vscode.window.showTextDocument(vscode.Uri.file(resolvedPath));
              }
            }
            break;
        }
      },
      null,
      this.disposables
    );

    // Theme change listener
    vscode.window.onDidChangeActiveColorTheme(() => {
      this.panel.webview.postMessage({ type: 'theme', isDark: isDarkTheme() });
    }, null, this.disposables);
  }

  private async doRefresh(): Promise<void> {
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'Laravel ERD: Parsing project…' },
      async () => {
        try {
          this.schema = await parseProject(this.workspacePath);
          this.panel.webview.postMessage({ type: 'schema', data: this.schema, isDark: isDarkTheme() });
        } catch (err) {
          vscode.window.showErrorMessage(`Laravel ERD parse error: ${String(err)}`);
        }
      }
    );
  }

  private async saveSchema(newSchema: Schema): Promise<void> {
    let savedFiles = 0;
    const errors: string[] = [];

    for (const newEntity of newSchema.entities) {
      try {
        if (newEntity.modelFile && fs.existsSync(newEntity.modelFile)) {
          const updated = await this.updateModelFile(newEntity.modelFile, newEntity);
          if (updated) savedFiles++;
        }
      } catch (err) {
        errors.push(`${newEntity.name}: ${String(err)}`);
      }
    }

    // Check for new columns vs original schema and suggest migration
    const newColumns = this.collectNewColumns(newSchema);
    if (newColumns.length > 0) {
      const migPath = await this.generateAlterMigration(newColumns);
      if (migPath) {
        savedFiles++;
        vscode.window.showInformationMessage(
          `Laravel ERD: Created alter migration and updated ${savedFiles} model file(s).`,
          'Open Migration'
        ).then(choice => {
          if (choice === 'Open Migration') {
            vscode.window.showTextDocument(vscode.Uri.file(migPath));
          }
        });
        this.schema = newSchema;
        return;
      }
    }

    if (errors.length > 0) {
      vscode.window.showErrorMessage(`Laravel ERD save errors:\n${errors.join('\n')}`);
    } else if (savedFiles > 0) {
      vscode.window.showInformationMessage(`Laravel ERD: Saved changes to ${savedFiles} file(s).`);
    } else {
      const hasModelFiles = newSchema.entities.some(e => e.modelFile);
      if (!hasModelFiles) {
        vscode.window.showWarningMessage(
          'Laravel ERD: No model files found. Save updates $fillable/$guarded in app/Models/*.php files. ' +
          'Make sure your Laravel project has Eloquent model files.'
        );
      } else {
        vscode.window.showInformationMessage('Laravel ERD: No changes detected.');
      }
    }

    this.schema = newSchema;
  }

  private async updateModelFile(filePath: string, entity: Entity): Promise<boolean> {
    let content = await fsp.readFile(filePath, 'utf8');
    let changed = false;

    // Update $fillable (even if now empty)
    {
      const fillableStr = entity.fillable.map(field => `'${escapePhpString(field)}'`).join(', ');
      const newFillable = `protected $fillable = [${fillableStr}]`;
      const fillableRegex = /protected\s+\$fillable\s*=\s*\[[^\]]*\]/s;
      if (fillableRegex.test(content)) {
        const replaced = content.replace(fillableRegex, newFillable);
        if (replaced !== content) {
          content = replaced;
          changed = true;
        }
      } else if (entity.fillable.length > 0) {
        // Issue #23: Insert $fillable if model lacks the property.
        const inserted = this.insertModelProperty(content, newFillable);
        if (inserted !== content) {
          content = inserted;
          changed = true;
        }
      }
    }

    // Update $guarded (even if now empty)
    {
      const guardedStr = entity.guarded.map(field => `'${escapePhpString(field)}'`).join(', ');
      const newGuarded = `protected $guarded = [${guardedStr}]`;
      const guardedRegex = /protected\s+\$guarded\s*=\s*\[[^\]]*\]/s;
      if (guardedRegex.test(content)) {
        const replaced = content.replace(guardedRegex, newGuarded);
        if (replaced !== content) {
          content = replaced;
          changed = true;
        }
      } else if (entity.guarded.length > 0) {
        // Issue #23: Insert $guarded if model lacks the property.
        const inserted = this.insertModelProperty(content, newGuarded);
        if (inserted !== content) {
          content = inserted;
          changed = true;
        }
      }
    }

    // Add new relationships that don't exist yet
    const originalEntity = this.schema.entities.find(e => e.name === entity.name);
    const existingRelNames = new Set(originalEntity?.relationships.map(r => r.name) ?? []);

    const newRels = entity.relationships.filter(r => !existingRelNames.has(r.name));
    if (newRels.length > 0) {
      const methods = newRels.map(rel => {
        return [
          `    public function ${rel.name}()`,
          `    {`,
          `        return $this->${rel.type}(${rel.relatedModel}::class);`,
          `    }`,
        ].join('\n');
      }).join('\n\n');

      // Insert before the closing brace of the class
      const inserted = insertBeforeFinalClassBrace(content, methods);
      if (inserted && inserted !== content) {
        content = inserted;
        changed = true;
      }
    }

    if (changed) {
      await fsp.writeFile(filePath, content, 'utf8');
    }
    return changed;
  }

  private insertModelProperty(content: string, property: string): string {
    return insertBeforeFinalClassBrace(content, `    ${property};`) ?? content;
  }

  private collectNewColumns(newSchema: Schema): Array<{ entity: Entity; columns: Column[] }> {
    const result: Array<{ entity: Entity; columns: Column[] }> = [];
    for (const newEntity of newSchema.entities) {
      const original = this.schema.entities.find(e => e.name === newEntity.name);
      if (!original) continue;
      const existingNames = new Set(original.columns.map(c => c.name));
      const newCols = newEntity.columns.filter(c => !existingNames.has(c.name));
      if (newCols.length > 0) {
        result.push({ entity: newEntity, columns: newCols });
      }
    }
    return result;
  }

  private async generateAlterMigration(changes: Array<{ entity: Entity; columns: Column[] }>): Promise<string | null> {
    const migrationsDir = path.join(this.workspacePath, 'database', 'migrations');
    if (!fs.existsSync(migrationsDir)) return null;

    const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const filePath = await createUniqueMigrationPath(migrationsDir, ts);

    const upBlocks = changes.map(({ entity, columns }) => {
      const colLines = columns.map(col => {
        let line = `            $table->${toBlueprintMethod(col.type)}('${escapePhpString(col.name)}')`;
        if (col.nullable) line += `->nullable()`;
        if (col.default !== undefined) line += `->default('${escapePhpString(col.default)}')`;
        if (col.unique) line += `->unique()`;
        return line + ';';
      }).join('\n');
      return [
        `        Schema::table('${escapePhpString(entity.tableName)}', function (\\Illuminate\\Database\\Schema\\Blueprint $table) {`,
        colLines,
        `        });`,
      ].join('\n');
    }).join('\n\n');

    const downBlocks = changes.map(({ entity, columns }) => {
      const drops = columns.map(col => `            $table->dropColumn('${escapePhpString(col.name)}');`).join('\n');
      return [
        `        Schema::table('${escapePhpString(entity.tableName)}', function (\\Illuminate\\Database\\Schema\\Blueprint $table) {`,
        drops,
        `        });`,
      ].join('\n');
    }).join('\n\n');

    const content = `<?php

use Illuminate\\Database\\Migrations\\Migration;
use Illuminate\\Database\\Schema\\Blueprint;
use Illuminate\\Support\\Facades\\Schema;

return new class extends Migration
{
    public function up(): void
    {
${upBlocks}
    }

    public function down(): void
    {
${downBlocks}
    }
};
`;
    await fsp.writeFile(filePath, content, 'utf8');
    return filePath;
  }

  private async exportSvg(content: string): Promise<void> {
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(this.workspacePath, 'erd.svg')),
      filters: { 'SVG Image': ['svg'] },
    });
    if (uri) {
      await fsp.writeFile(uri.fsPath, content, 'utf8');
      vscode.window.showInformationMessage(`ERD exported to ${uri.fsPath}`);
    }
  }

  private dispose(): void {
    ErdPanel.currentPanel = undefined;
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const csp = `default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com; font-src https://fonts.gstatic.com; script-src 'nonce-${nonce}';`;

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Laravel ERD</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #1e1e1e;
      --surface: #252526;
      --surface-2: #2d2d2d;
      --surface-3: #3c3c3c;
      --border: #3c3c3c;
      --border-2: #555555;
      --accent: #007acc;
      --accent-glow: rgba(0,122,204,0.25);
      --accent-dim: rgba(0,122,204,0.12);
      --emerald: #4ec9b0;
      --amber: #dcdcaa;
      --cyan: #4fc1ff;
      --rose: #f44747;
      --violet: #c586c0;
      --text: #cccccc;
      --text-2: #858585;
      --text-3: #4a4a4a;
      --mono: 'JetBrains Mono', 'Courier New', monospace;
      --sans: 'Bricolage Grotesque', system-ui, sans-serif;
      --card-w: 320px;
      --r: 8px;
      --toolbar-h: 52px;
      --status-h: 26px;
    }

    html, body { width: 100%; height: 100%; overflow: hidden; font-family: var(--sans); background: var(--bg); color: var(--text); font-size: 14px; }

    /* ───── TOOLBAR ───── */
    .toolbar {
      position: fixed; top: 0; left: 0; right: 0; height: var(--toolbar-h);
      background: var(--surface); border-bottom: 1px solid var(--border);
      display: flex; align-items: center; padding: 0 16px; gap: 6px; z-index: 1000;
    }
    .logo {
      display: flex; align-items: center; gap: 8px; margin-right: 12px;
      font-weight: 700; font-size: 13px; letter-spacing: 0.5px; color: var(--accent);
      user-select: none;
    }
    .logo-icon {
      width: 26px; height: 26px; background: var(--accent-dim); border: 1px solid var(--accent);
      border-radius: 6px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .logo-icon svg { width: 14px; height: 14px; }
    .sep { width: 1px; height: 24px; background: var(--border); margin: 0 4px; }
    .btn {
      height: 30px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--border);
      background: transparent; color: var(--text-2); cursor: pointer; font-family: var(--sans);
      font-size: 12px; font-weight: 500; display: inline-flex; align-items: center; gap: 5px;
      transition: all 0.12s; white-space: nowrap;
    }
    .btn:hover { background: var(--surface-2); border-color: var(--accent); color: var(--accent); }
    .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .btn.primary:hover { opacity: 0.88; color: #fff; }
    .spacer { flex: 1; }
    .entity-count { font-size: 11px; color: var(--text-3); font-family: var(--mono); margin-right: 8px; }

    /* ───── CANVAS ───── */
    .canvas-wrap {
      position: fixed; top: var(--toolbar-h); left: 0; right: 0; bottom: var(--status-h);
      overflow: hidden; cursor: default; background: var(--bg);
      background-image: radial-gradient(var(--border) 1px, transparent 1px);
      background-size: 28px 28px;
    }
    .canvas { position: absolute; width: 0; height: 0; transform-origin: 0 0; }
    .rel-svg {
      position: absolute; top: 0; left: 0; width: 0; height: 0;
      pointer-events: none; overflow: visible; z-index: 0;
    }
    .rel-group { pointer-events: auto; cursor: default; }
    .rel-group:hover path:not([stroke="transparent"]) { stroke-width: 2.5; }
    .rel-group:hover line { stroke-width: 2.5; }

    /* ───── ENTITY CARD ───── */
    .entity-card {
      position: absolute; width: var(--card-w);
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--r);
      box-shadow: 0 4px 24px rgba(0,0,0,0.4); z-index: 10;
      transition: box-shadow 0.2s, border-color 0.2s;
    }
    .entity-card:hover { border-color: var(--border-2); box-shadow: 0 8px 40px rgba(0,0,0,0.5), 0 0 0 1px var(--accent-dim); }
    .entity-card.dragging { opacity: 0.9; box-shadow: 0 16px 60px rgba(0,0,0,0.6), 0 0 0 2px var(--accent); z-index: 20; }

    .card-header {
      padding: 11px 12px; border-bottom: 1px solid var(--border);
      display: flex; align-items: center; gap: 8px;
      cursor: grab; border-radius: var(--r) var(--r) 0 0;
      background: linear-gradient(135deg, var(--surface-2) 0%, var(--surface) 100%);
      border-left: 3px solid var(--accent);
    }
    .card-header:active { cursor: grabbing; }
    .card-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }
    .card-name {
      font-family: var(--sans); font-size: 12px; font-weight: 700;
      color: var(--text); flex: 1; letter-spacing: 0.4px; text-transform: uppercase; user-select: none;
    }
    .card-btns { display: flex; gap: 3px; opacity: 0; transition: opacity 0.12s; }
    .entity-card:hover .card-btns { opacity: 1; }
    .icon-btn {
      width: 20px; height: 20px; border-radius: 4px; border: none; background: transparent;
      color: var(--text-3); cursor: pointer; display: flex; align-items: center; justify-content: center;
      font-size: 10px; transition: all 0.1s;
    }
    .icon-btn:hover { background: var(--border); color: var(--text); }

    /* ───── TABS ───── */
    .card-tabs { display: flex; border-bottom: 1px solid var(--border); }
    .tab {
      flex: 1; padding: 7px 0; font-size: 10px; font-weight: 600; letter-spacing: 0.8px;
      text-transform: uppercase; text-align: center; cursor: pointer; color: var(--text-3);
      border-bottom: 2px solid transparent; transition: all 0.12s; font-family: var(--mono);
      user-select: none;
    }
    .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
    .tab:not(.active):hover { color: var(--text-2); }

    /* ───── COLUMN LIST ───── */
    .col-list { padding: 4px 0; max-height: 280px; overflow-y: auto; }
    .col-list::-webkit-scrollbar { width: 3px; }
    .col-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

    .col-row {
      display: flex; align-items: center; padding: 5px 12px; gap: 5px;
      font-family: var(--mono); font-size: 11px; transition: background 0.08s; cursor: default;
    }
    .col-row:hover { background: var(--surface-2); }
    .col-row.editing { background: var(--accent-dim); }

    .badge {
      width: 24px; height: 15px; border-radius: 3px; font-size: 8px; font-weight: 700;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0; letter-spacing: 0.3px;
    }
    .badge-pk { background: rgba(220,220,170,0.1); color: var(--amber); border: 1px solid rgba(220,220,170,0.25); }
    .badge-fk { background: rgba(79,193,255,0.1); color: var(--cyan); border: 1px solid rgba(79,193,255,0.2); }
    .badge-none { width: 24px; }

    .col-name { flex: 1; color: var(--text); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .col-type { color: var(--text-2); font-size: 10px; flex-shrink: 0; }
    .fk-ref { font-size: 9px; color: var(--cyan); flex-shrink: 0; white-space: nowrap; }

    .col-indicators { display: flex; gap: 3px; flex-shrink: 0; }
    .dot { width: 5px; height: 5px; border-radius: 50%; }
    .dot-uniq { background: var(--cyan); }
    .dot-null { background: var(--text-3); }

    .add-col-btn {
      width: 100%; padding: 7px 12px; background: transparent;
      border: none; border-top: 1px dashed var(--border);
      color: var(--text-3); cursor: pointer; font-family: var(--mono); font-size: 10px;
      text-align: left; transition: all 0.12s; display: flex; align-items: center; gap: 6px;
    }
    .add-col-btn:hover { color: var(--accent); background: var(--accent-dim); }

    /* ───── EDIT ROW ───── */
    .edit-row {
      padding: 8px 12px; background: var(--accent-dim); border-top: 1px solid var(--accent);
      display: flex; flex-direction: column; gap: 6px;
    }
    .edit-row input, .edit-row select {
      background: var(--surface-3); border: 1px solid var(--border-2); color: var(--text);
      font-family: var(--mono); font-size: 11px; border-radius: 4px; padding: 4px 8px;
      outline: none; width: 100%;
    }
    .edit-row input:focus, .edit-row select:focus { border-color: var(--accent); }
    .edit-row-row { display: flex; gap: 6px; align-items: center; font-family: var(--mono); font-size: 10px; color: var(--text-2); }
    .edit-row-row label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
    .edit-btns { display: flex; gap: 6px; }
    .edit-btn {
      flex: 1; padding: 4px 0; border-radius: 4px; border: none; font-family: var(--mono);
      font-size: 10px; font-weight: 600; cursor: pointer; transition: opacity 0.1s;
    }
    .edit-btn-save { background: var(--accent); color: #fff; }
    .edit-btn-save:hover { opacity: 0.85; }
    .edit-btn-del { background: rgba(248,113,113,0.15); color: var(--rose); border: 1px solid rgba(248,113,113,0.25); }
    .edit-btn-del:hover { background: rgba(248,113,113,0.25); }
    .edit-btn-cancel { background: var(--surface-3); color: var(--text-2); border: 1px solid var(--border); }

    /* ───── MODEL TAB ───── */
    .model-body { padding: 6px 0; max-height: 280px; overflow-y: auto; }
    .model-body::-webkit-scrollbar { width: 3px; }
    .model-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
    .section-title {
      font-size: 9px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;
      color: var(--text-3); font-family: var(--mono); padding: 6px 12px 4px;
    }
    .field-row {
      display: flex; align-items: center; padding: 4px 12px; gap: 8px;
      font-family: var(--mono); font-size: 11px;
    }
    .field-name { flex: 1; color: var(--text); }
    .pill {
      font-size: 9px; font-weight: 600; padding: 2px 8px; border-radius: 10px; cursor: pointer;
      transition: all 0.12s;
    }
    .pill-fill { background: rgba(52,211,153,0.12); color: var(--emerald); border: 1px solid rgba(52,211,153,0.25); }
    .pill-guard { background: rgba(248,113,113,0.1); color: var(--rose); border: 1px solid rgba(248,113,113,0.2); }
    .rel-row { display: flex; align-items: center; padding: 4px 12px; gap: 7px; font-family: var(--mono); font-size: 11px; }
    .rel-badge {
      font-size: 8px; color: var(--violet); background: rgba(197,134,192,0.1);
      border: 1px solid rgba(197,134,192,0.2); padding: 2px 6px; border-radius: 3px;
      font-weight: 700; white-space: nowrap;
    }
    .rel-name { color: var(--text); font-weight: 500; }
    .rel-target { color: var(--text-2); font-size: 10px; flex: 1; text-align: right; }
    .empty-model { padding: 16px 12px; color: var(--text-3); font-family: var(--mono); font-size: 10px; }

    /* ───── STATUS BAR ───── */
    .statusbar {
      position: fixed; bottom: 0; left: 0; right: 0; height: var(--status-h);
      background: var(--accent); display: flex; align-items: center;
      padding: 0 14px; gap: 14px; z-index: 1000; font-size: 11px;
      font-family: var(--mono); color: rgba(255,255,255,0.9);
    }
    .s-sep { width: 1px; height: 12px; background: rgba(255,255,255,0.25); }

    /* ───── EMPTY STATE ───── */
    .empty { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); text-align: center; pointer-events: none; }
    .empty h2 { font-size: 22px; color: var(--text-2); margin-bottom: 10px; font-weight: 600; }
    .empty p { font-size: 12px; color: var(--text-3); font-family: var(--mono); }

    /* ───── RELATIONSHIP TOGGLE ───── */
    .rel-toggle {
      display: flex; gap: 2px; background: var(--surface-2); border-radius: 6px; padding: 2px;
      border: 1px solid var(--border);
    }
    .toggle-btn {
      height: 24px; padding: 0 10px; border-radius: 4px; border: none;
      background: transparent; color: var(--text-2); cursor: pointer; font-family: var(--sans);
      font-size: 11px; font-weight: 500; transition: all 0.12s; white-space: nowrap;
    }
    .toggle-btn:hover { color: var(--text); background: var(--surface-3); }
    .toggle-btn.active { background: var(--accent); color: #fff; }

    /* ───── RELATIONSHIP TOOLTIP ───── */
    .rel-tooltip {
      position: fixed; pointer-events: none; z-index: 9999;
      background: var(--surface); border: 1px solid var(--border-2); border-radius: 6px;
      padding: 8px 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      font-family: var(--mono); font-size: 11px; line-height: 1.5;
      color: var(--text); display: none; max-width: 320px;
    }
    .rel-tooltip .tt-type { color: var(--violet); font-weight: 600; }
    .rel-tooltip .tt-src { color: #4a9edd; }
    .rel-tooltip .tt-tgt { color: #4ec9b0; }
    .rel-tooltip .tt-label { color: var(--text-2); }

    /* ───── LIGHT THEME ───── */
    body.light {
      --bg: #f3f3f3;
      --surface: #ffffff;
      --surface-2: #f5f5f5;
      --surface-3: #e8e8e8;
      --border: #e0e0e0;
      --border-2: #c8c8c8;
      --accent: #007acc;
      --accent-glow: rgba(0,122,204,0.2);
      --accent-dim: rgba(0,122,204,0.08);
      --text: #333333;
      --text-2: #717171;
      --text-3: #a0a0a0;
    }
    body.light .canvas-wrap {
      background-image: radial-gradient(var(--border) 1px, transparent 1px);
      background-color: var(--bg);
    }
  </style>
</head>
<body>

<div class="toolbar">
  <div class="logo">
    <div class="logo-icon">
      <svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="1" y="1" width="5" height="4" rx="1" stroke="currentColor" stroke-width="1.2"/>
        <rect x="8" y="1" width="5" height="4" rx="1" stroke="currentColor" stroke-width="1.2"/>
        <rect x="4.5" y="9" width="5" height="4" rx="1" stroke="currentColor" stroke-width="1.2"/>
        <path d="M3.5 5v2.5H7M10.5 5v2.5H7M7 7.5V9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      </svg>
    </div>
    Laravel ERD
  </div>
  <div class="sep"></div>
  <button class="btn primary" id="btn-save">
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 2h6.5L10 3.5V10a.5.5 0 01-.5.5h-7A.5.5 0 012 10V2z" stroke="currentColor" stroke-width="1.2"/><rect x="4" y="6.5" width="4" height="3.5" rx=".5" stroke="currentColor" stroke-width="1.2"/><rect x="3.5" y="2" width="5" height="2.5" rx=".5" stroke="currentColor" stroke-width="1.2"/></svg>
    Save
  </button>
  <button class="btn" id="btn-export">
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1v7M3.5 5.5L6 8l2.5-2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 9.5h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
    Export SVG
  </button>
  <button class="btn" id="btn-refresh">
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M10.5 6a4.5 4.5 0 11-.9-2.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M10.5 1.5v3h-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
    Refresh
  </button>
  <div class="sep"></div>
  <button class="btn" id="btn-fit">Fit</button>
  <div class="sep"></div>
  <div class="rel-toggle" id="rel-toggle">
    <button class="toggle-btn active" data-filter="both">Both</button>
    <button class="toggle-btn" data-filter="fk">FK</button>
    <button class="toggle-btn" data-filter="eloquent">Eloquent</button>
  </div>
  <div class="spacer"></div>
  <span class="entity-count" id="entity-count">0 tables</span>
</div>

<div class="canvas-wrap" id="canvas-wrap">
  <div class="canvas" id="canvas">
    <svg class="rel-svg" id="rel-svg" xmlns="http://www.w3.org/2000/svg"></svg>
  </div>
</div>

<div class="statusbar">
  <span>Laravel ERD</span>
  <span class="s-sep"></span>
  <span id="status-zoom">100%</span>
  <span class="s-sep"></span>
  <span id="status-tables">0 tables</span>
  <span class="s-sep"></span>
  <span id="status-rels">0 relationships</span>
</div>

<div class="empty" id="empty-state">
  <h2>No schema found</h2>
  <p>Open a Laravel project with migrations to get started.</p>
</div>

<div class="rel-tooltip" id="rel-tooltip"></div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

// ─────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────
let schema = { entities: [] };
let positions = {};          // { name: { x, y } }
let activeTabs = {};         // { name: 'migration' | 'model' }
let editingCol = null;       // { entityName, colIndex } | null
let zoom = 1;
let panX = 0, panY = 0;
let drag = null;             // { type:'card'|'pan', entityName?, startX, startY, origX, origY, origPanX, origPanY }
let relFilter = 'both';      // 'both' | 'fk' | 'eloquent'
let renderRelsFrame = null;
let dragCleanup = null;
let didAutoFit = false;

// ─────────────────────────────────────────────────
// MESSAGE HANDLING
// ─────────────────────────────────────────────────
window.addEventListener('message', ev => {
  const msg = ev.data;
  if (msg.type === 'schema') {
    const nextSchema = msg.data;
    migratePositionsForSchema(nextSchema);
    schema = nextSchema;
    if (msg.isDark === false) document.body.classList.add('light');
    else document.body.classList.remove('light');
    autoLayout();
    render();
    // Issue #24: Call fitToScreen after schema is loaded.
    if (!didAutoFit && schema.entities.length) {
      fitToScreen();
      didAutoFit = true;
    }
  } else if (msg.type === 'theme') {
    if (msg.isDark === false) document.body.classList.add('light');
    else document.body.classList.remove('light');
  }
});

function migratePositionsForSchema(nextSchema) {
  // Issue #19: Migrate positions when entity names change.
  const currentByTable = new Map(schema.entities.map(entity => [entity.tableName, entity.name]));
  const nextPositions = {};

  nextSchema.entities.forEach(entity => {
    if (positions[entity.name]) {
      nextPositions[entity.name] = positions[entity.name];
      return;
    }

    const previousName = currentByTable.get(entity.tableName);
    if (previousName && positions[previousName]) {
      nextPositions[entity.name] = positions[previousName];
    }
  });

  positions = nextPositions;
}

window.addEventListener('load', () => vscode.postMessage({ type: 'ready' }));

// ─────────────────────────────────────────────────
// AUTO LAYOUT (grid)
// ─────────────────────────────────────────────────
function autoLayout() {
  const CARD_W = 340, CARD_H = 430, GAP_X = 60, GAP_Y = 60;
  const cols = Math.max(1, Math.ceil(Math.sqrt(schema.entities.length)));
  schema.entities.forEach((e, i) => {
    if (!positions[e.name]) {
      const col = i % cols, row = Math.floor(i / cols);
      positions[e.name] = { x: GAP_X + col * (CARD_W + GAP_X), y: GAP_Y + row * (CARD_H + GAP_Y) };
    }
  });
}

function syncCanvasBounds() {
  const canvas = document.getElementById('canvas');
  const svg = document.getElementById('rel-svg');

  if (!schema.entities.length) {
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    svg.style.width = '100%';
    svg.style.height = '100%';
    return;
  }

  const PAD = 160;
  let maxX = 0;
  let maxY = 0;

  schema.entities.forEach(entity => {
    const pos = positions[entity.name] || { x: 0, y: 0 };
    maxX = Math.max(maxX, pos.x + CARD_W_R);
    maxY = Math.max(maxY, pos.y + estimateCardHeight(entity.name));
  });

  const width = Math.max(wrap.clientWidth, maxX + PAD);
  const height = Math.max(wrap.clientHeight, maxY + PAD);

  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  svg.style.width = width + 'px';
  svg.style.height = height + 'px';
}

// ─────────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────────
function render() {
  syncCanvasBounds();
  renderCards();
  renderRels();
  updateStatus();
  document.getElementById('empty-state').style.display = schema.entities.length === 0 ? 'block' : 'none';
}

function renderCards() {
  const canvas = document.getElementById('canvas');
  const svg = document.getElementById('rel-svg');
  const existingCards = new Map(
    Array.from(canvas.querySelectorAll('.entity-card')).map(card => [card.dataset.entity, card])
  );
  const activeEntityNames = new Set(schema.entities.map(entity => entity.name));

  existingCards.forEach((card, entityName) => {
    if (!activeEntityNames.has(entityName)) {
      card.remove();
    }
  });

  schema.entities.forEach(entity => {
    const pos = positions[entity.name] || { x: 0, y: 0 };
    const signature = cardSignature(entity);
    const existingCard = existingCards.get(entity.name);

    if (existingCard && existingCard.dataset.signature === signature) {
      existingCard.style.left = pos.x + 'px';
      existingCard.style.top = pos.y + 'px';
      return;
    }

    const newCard = buildCard(entity, pos);
    newCard.dataset.signature = signature;
    if (existingCard) {
      canvas.replaceChild(newCard, existingCard);
    } else {
      canvas.insertBefore(newCard, svg);
    }
  });
}

function cardSignature(entity) {
  return JSON.stringify({
    entity,
    tab: activeTabs[entity.name] || 'migration',
    editing: editingCol && editingCol.entityName === entity.name ? editingCol : null,
  });
}

function buildCard(entity, pos) {
  const tab = activeTabs[entity.name] || 'migration';
  const card = el('div', 'entity-card');
  card.dataset.entity = entity.name;
  card.style.left = pos.x + 'px';
  card.style.top  = pos.y + 'px';

  // ── HEADER ──
  const hdr = el('div', 'card-header');
  const dot = el('div', 'card-dot'); hdr.appendChild(dot);
  const nm  = el('div', 'card-name'); nm.textContent = entity.name; hdr.appendChild(nm);
  const btns = el('div', 'card-btns');
  let openBtn = null;
  if (entity.modelFile || entity.migrationFile) {
    openBtn = iconBtn('↗', () => vscode.postMessage({ type: 'openFile', path: entity.modelFile || entity.migrationFile }));
    btns.appendChild(openBtn);
  }
  hdr.appendChild(btns);
  hdr.addEventListener('mousedown', e => { if (openBtn && e.target === openBtn) return; startCardDrag(e, entity.name, pos); });
  card.appendChild(hdr);

  // ── TABS ──
  const tabs = el('div', 'card-tabs');
  ['migration','model'].forEach(t => {
    const tabEl = el('div', 'tab' + (t === tab ? ' active' : ''));
    tabEl.textContent = t === 'migration' ? 'Migration' : 'Model';
    tabEl.addEventListener('click', () => { activeTabs[entity.name] = t; render(); });
    tabs.appendChild(tabEl);
  });
  card.appendChild(tabs);

  // ── CONTENT ──
  const content = el('div', 'card-content');
  if (tab === 'migration') buildMigrationTab(content, entity);
  else buildModelTab(content, entity);
  card.appendChild(content);

  card.addEventListener('mousedown', e => { if (!e.target.closest('.card-header')) e.stopPropagation(); });
  return card;
}

function buildMigrationTab(container, entity) {
  const list = el('div', 'col-list');

  entity.columns.forEach((col, idx) => {
    if (editingCol && editingCol.entityName === entity.name && editingCol.colIndex === idx) {
      list.appendChild(buildEditRow(entity, col, idx));
      return;
    }

    const row = el('div', 'col-row');

    // Badge
    let badge;
    if (col.primaryKey) {
      badge = el('div', 'badge badge-pk'); badge.textContent = 'PK';
    } else if (col.foreignKey) {
      badge = el('div', 'badge badge-fk'); badge.textContent = 'FK';
    } else {
      badge = el('div', 'badge-none');
    }
    row.appendChild(badge);

    const name = el('div', 'col-name'); name.textContent = col.name; row.appendChild(name);
    const type = el('div', 'col-type'); type.textContent = col.type; row.appendChild(type);

    if (col.foreignKey) {
      const ref = el('span', 'fk-ref'); ref.textContent = '→ ' + col.foreignKey.table; row.appendChild(ref);
    }

    const inds = el('div', 'col-indicators');
    if (col.unique && !col.primaryKey) { const d = el('div', 'dot dot-uniq'); d.title = 'Unique'; inds.appendChild(d); }
    if (col.nullable)                  { const d = el('div', 'dot dot-null'); d.title = 'Nullable'; inds.appendChild(d); }
    row.appendChild(inds);

    row.addEventListener('dblclick', () => { editingCol = { entityName: entity.name, colIndex: idx }; render(); });
    list.appendChild(row);
  });

  const addBtn = el('button', 'add-col-btn');
  addBtn.textContent = '+ Add column';
  addBtn.addEventListener('click', () => {
    const e = schema.entities.find(x => x.name === entity.name);
    if (e) {
      e.columns.push({ name: 'new_column', type: 'varchar', nullable: true, primaryKey: false, unique: false, autoIncrement: false, unsigned: false });
      editingCol = { entityName: entity.name, colIndex: e.columns.length - 1 };
      render();
    }
  });

  container.appendChild(list);
  container.appendChild(addBtn);
}

function buildEditRow(entity, col, idx) {
  const wrap = el('div', 'edit-row');

  const nameIn = el('input');
  nameIn.type = 'text'; nameIn.value = col.name; nameIn.placeholder = 'Column name';
  wrap.appendChild(nameIn);

  const typeSelect = el('select');
  const types = ['varchar','text','longtext','int','bigint','tinyint','boolean','float','decimal','date','datetime','timestamp','json','uuid','enum','char','binary'];
  types.forEach(t => {
    const o = document.createElement('option');
    o.value = t; o.textContent = t;
    if (t === col.type || col.type.startsWith(t)) o.selected = true;
    typeSelect.appendChild(o);
  });
  wrap.appendChild(typeSelect);

  const optRow = el('div', 'edit-row-row');
  const nullLbl = el('label');
  const nullCb = document.createElement('input');
  nullCb.type = 'checkbox';
  nullCb.checked = col.nullable;
  nullLbl.appendChild(nullCb);
  nullLbl.appendChild(document.createTextNode(' nullable'));
  const uniqLbl = el('label');
  const uniqCb = document.createElement('input');
  uniqCb.type = 'checkbox';
  uniqCb.checked = col.unique;
  uniqLbl.appendChild(uniqCb);
  uniqLbl.appendChild(document.createTextNode(' unique'));
  optRow.appendChild(nullLbl); optRow.appendChild(uniqLbl);
  wrap.appendChild(optRow);

  const btnRow = el('div', 'edit-btns');
  const saveBtn = el('button', 'edit-btn edit-btn-save'); saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => {
    const e = schema.entities.find(x => x.name === entity.name);
    if (e && e.columns[idx]) {
      e.columns[idx].name = nameIn.value.trim() || col.name;
      e.columns[idx].type = typeSelect.value;
      e.columns[idx].nullable = nullCb.checked;
      e.columns[idx].unique = uniqCb.checked;
    }
    editingCol = null; render();
  });

  const delBtn = el('button', 'edit-btn edit-btn-del'); delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', () => {
    const e = schema.entities.find(x => x.name === entity.name);
    if (e) e.columns.splice(idx, 1);
    editingCol = null; render();
  });

  const cancelBtn = el('button', 'edit-btn edit-btn-cancel'); cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => { editingCol = null; render(); });

  btnRow.appendChild(saveBtn); btnRow.appendChild(delBtn); btnRow.appendChild(cancelBtn);
  wrap.appendChild(btnRow);
  return wrap;
}

function buildModelTab(container, entity) {
  const body = el('div', 'model-body');
  let hasContent = false;

  // Fields section
  const allFields = [...new Set([...entity.fillable, ...entity.guarded, ...entity.columns.map(c => c.name)])];
  const modelFields = allFields.filter(f => !['id','created_at','updated_at','deleted_at'].includes(f));

  if (modelFields.length > 0) {
    const t = el('div', 'section-title'); t.textContent = 'Fields'; body.appendChild(t);
    modelFields.forEach(field => {
      const isFill = entity.fillable.includes(field);
      const row = el('div', 'field-row');
      const fn = el('span', 'field-name'); fn.textContent = field; row.appendChild(fn);
      const pill = el('span', 'pill ' + (isFill ? 'pill-fill' : 'pill-guard'));
      pill.textContent = isFill ? 'fillable' : 'guarded';
      pill.title = 'Click to toggle';
      pill.addEventListener('click', () => {
        const e = schema.entities.find(x => x.name === entity.name);
        if (!e) return;
        if (isFill) {
          e.fillable = e.fillable.filter(f => f !== field);
          if (!e.guarded.includes(field)) e.guarded.push(field);
        } else {
          e.guarded = e.guarded.filter(f => f !== field);
          if (!e.fillable.includes(field)) e.fillable.push(field);
        }
        render();
      });
      row.appendChild(pill);
      body.appendChild(row);
    });
    hasContent = true;
  }

  // Relationships section
  if (entity.relationships.length > 0) {
    const t = el('div', 'section-title'); t.textContent = 'Relationships'; body.appendChild(t);
    entity.relationships.forEach(rel => {
      const row = el('div', 'rel-row');
      const badge = el('span', 'rel-badge'); badge.textContent = rel.type; row.appendChild(badge);
      const nm = el('span', 'rel-name'); nm.textContent = rel.name; row.appendChild(nm);
      const tgt = el('span', 'rel-target'); tgt.textContent = rel.relatedModel; row.appendChild(tgt);
      body.appendChild(row);
    });
    hasContent = true;
  }

  if (!hasContent) {
    const empty = el('div', 'empty-model'); empty.textContent = 'No model data found.'; body.appendChild(empty);
  }

  container.appendChild(body);
}

// ─────────────────────────────────────────────────
// RELATIONSHIP LINES — orthogonal routing + crow's feet
// ─────────────────────────────────────────────────

const CARD_W_R = 320;
const HDR_H_R  = 44;   // header height px
const TABS_H_R = 30;   // tabs row px
const COL_H_R  = 22;   // per-column row px
const COL_PAD_R = 9;   // col-list top padding

function estimateCardHeight(entityName) {
  const e = schema.entities.find(x => x.name === entityName);
  if (!e) return 220;
  const maxCols = Math.min(e.columns.length, 12);
  return HDR_H_R + TABS_H_R + COL_PAD_R + maxCols * COL_H_R + 32;
}

function computeAllObstacles() {
  const P = 18;
  return schema.entities
    .map(e => {
      const p = positions[e.name];
      if (!p) return null;
      const h = estimateCardHeight(e.name);
      return { name: e.name, x: p.x - P, y: p.y - P, r: p.x + CARD_W_R + P, b: p.y + h + P };
    })
    .filter(Boolean);
}

// Obstacle rectangles for all entities except the two being connected
function getObstacles(excludeA, excludeB, cachedObstacles) {
  return cachedObstacles.filter(obstacle => obstacle.name !== excludeA && obstacle.name !== excludeB);
}

function vertHitsObs(x, y1, y2, obs) {
  const mn = Math.min(y1, y2), mx = Math.max(y1, y2);
  return obs.some(o => x > o.x && x < o.r && mx > o.y && mn < o.b);
}
function horizHitsObs(y, x1, x2, obs) {
  const mn = Math.min(x1, x2), mx = Math.max(x1, x2);
  return obs.some(o => y > o.y && y < o.b && mx > o.x && mn < o.r);
}

// 3-segment orthogonal router: horiz stub → vert → horiz stub
// Returns array of {x,y} waypoints
function routeOrtho(sx, sy, ex, ey, obs) {
  let midX = (sx + ex) / 2;

  function clear(mx) {
    return !horizHitsObs(sy, sx, mx, obs)
        && !vertHitsObs(mx, sy, ey, obs)
        && !horizHitsObs(ey, mx, ex, obs);
  }

  if (clear(midX)) {
    return [{x:sx,y:sy},{x:midX,y:sy},{x:midX,y:ey},{x:ex,y:ey}];
  }

  for (const delta of [80,-80,160,-160,240,-240,320,-320,400,-400]) {
    const m = midX + delta;
    if (clear(m)) {
      return [{x:sx,y:sy},{x:m,y:sy},{x:m,y:ey},{x:ex,y:ey}];
    }
  }

  // Fallback: route above all blocking entities
  const mnX = Math.min(sx, ex), mxX = Math.max(sx, ex);
  const blocking = obs.filter(o => o.r > mnX && o.x < mxX);
  const topY = blocking.length
    ? Math.min(...blocking.map(o => o.y)) - 45
    : Math.min(sy, ey) - 70;

  return [
    {x:sx, y:sy},
    {x:sx, y:topY},
    {x:ex, y:topY},
    {x:ex, y:ey},
  ];
}

// Build SVG path string with rounded corners (radius r) for an orthogonal polyline
function orthoPathD(pts, r) {
  if (pts.length < 2) return '';
  if (pts.length === 2) return \`M\${pts[0].x} \${pts[0].y} L\${pts[1].x} \${pts[1].y}\`;
  let d = \`M\${pts[0].x} \${pts[0].y}\`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i-1], c = pts[i], n = pts[i+1];
    const d1x = c.x-p.x, d1y = c.y-p.y;
    const d2x = n.x-c.x, d2y = n.y-c.y;
    const l1 = Math.sqrt(d1x*d1x+d1y*d1y)||1;
    const l2 = Math.sqrt(d2x*d2x+d2y*d2y)||1;
    const t1 = Math.min(r, l1/2), t2 = Math.min(r, l2/2);
    const px = c.x-(d1x/l1)*t1, py = c.y-(d1y/l1)*t1;
    const qx = c.x+(d2x/l2)*t2, qy = c.y+(d2y/l2)*t2;
    d += \` L\${px} \${py} Q\${c.x} \${c.y} \${qx} \${qy}\`;
  }
  d += \` L\${pts[pts.length-1].x} \${pts[pts.length-1].y}\`;
  return d;
}

function svgLineEl(parent, x1, y1, x2, y2, color, w) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  el.setAttribute('x1', x1); el.setAttribute('y1', y1);
  el.setAttribute('x2', x2); el.setAttribute('y2', y2);
  el.setAttribute('stroke', color);
  el.setAttribute('stroke-width', String(w || 1.5));
  el.setAttribute('stroke-linecap', 'round');
  parent.appendChild(el);
}

// Draw cardinality marker at connection point (x, y).
// signDir: +1 = marker body extends rightward, -1 = leftward
// type: 'one' | 'many'
function drawCardinality(parent, x, y, signDir, type, color) {
  const L = 14, S = 7;
  const nx = x + signDir * L; // x of neck (tick position)
  // Vertical tick at neck
  svgLineEl(parent, nx, y - S, nx, y + S, color, 1.5);
  if (type === 'many') {
    // Crow's feet: two fork lines from neck corners converging to connection point
    svgLineEl(parent, nx, y - S, x, y, color, 1.5);
    svgLineEl(parent, nx, y + S, x, y, color, 1.5);
  } else {
    // Single tick ("one"): second parallel tick further out
    svgLineEl(parent, nx + signDir * 7, y - S, nx + signDir * 7, y + S, color, 1.5);
  }
}

function drawRelEdge(svg, srcName, tgtName, srcCard, tgtCard, color, dashed, relType, relKind, cachedObstacles) {
  const fp = positions[srcName], tp = positions[tgtName];
  if (!fp || !tp) return;

  const fcx = fp.x + CARD_W_R / 2;
  const tcx = tp.x + CARD_W_R / 2;
  const portY = HDR_H_R / 2 + 4; // connect at mid-header

  let sx, sy, ex, ey, srcDir, tgtDir;
  if (tcx >= fcx) {
    sx = fp.x + CARD_W_R; sy = fp.y + portY;
    ex = tp.x;             ey = tp.y + portY;
    srcDir = 1; tgtDir = -1;
  } else {
    sx = fp.x;             sy = fp.y + portY;
    ex = tp.x + CARD_W_R;  ey = tp.y + portY;
    srcDir = -1; tgtDir = 1;
  }

  const obs = getObstacles(srcName, tgtName, cachedObstacles);
  const pts = routeOrtho(sx, sy, ex, ey, obs);
  const d = orthoPathD(pts, 8);

  // Wrap in a group for hover interaction
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.classList.add('rel-group');
  g.dataset.src = srcName;
  g.dataset.tgt = tgtName;
  g.dataset.relType = relType;
  g.dataset.relKind = relKind;
  g.style.pointerEvents = 'auto';

  // Invisible wider hit-area for easier hovering
  const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  hitPath.setAttribute('d', d);
  hitPath.setAttribute('fill', 'none');
  hitPath.setAttribute('stroke', 'transparent');
  hitPath.setAttribute('stroke-width', '12');
  g.appendChild(hitPath);

  // Visible line
  const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  pathEl.setAttribute('d', d);
  pathEl.setAttribute('fill', 'none');
  pathEl.setAttribute('stroke', color);
  pathEl.setAttribute('stroke-width', '1.5');
  pathEl.setAttribute('stroke-linecap', 'round');
  pathEl.setAttribute('stroke-linejoin', 'round');
  if (dashed) pathEl.setAttribute('stroke-dasharray', '5 3');
  g.appendChild(pathEl);

  // Draw cardinality markers
  drawCardinality(g, sx, sy, srcDir, srcCard, color);
  drawCardinality(g, ex, ey, tgtDir, tgtCard, color);

  svg.appendChild(g);
}

function renderRels() {
  const svg = document.getElementById('rel-svg');
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const drawn = new Set();
  let relCount = 0;

  const FK_COLOR  = '#4a9edd'; // VS Code blue — FK constraints
  const REL_COLOR = '#4ec9b0'; // VS Code teal — Eloquent relationships
  const cachedObstacles = computeAllObstacles();

  // Perf: build lookup maps once per render so target resolution for FKs and
  // Eloquent relationships is O(1) instead of O(N) per edge.
  const entityByTableName = new Map();
  const entityByName = new Map();
  const entityByLowerName = new Map();
  schema.entities.forEach(entity => {
    entityByTableName.set(entity.tableName, entity);
    entityByName.set(entity.name, entity);
    entityByLowerName.set(entity.name.toLowerCase(), entity);
  });

  schema.entities.forEach(entity => {
    const fp = positions[entity.name];
    if (!fp) return;

    // ── FK column relationships (entity = many, referenced = one) ──
    if (relFilter === 'both' || relFilter === 'fk') {
      entity.columns.forEach(col => {
        if (!col.foreignKey) return;
        const tgt = entityByTableName.get(col.foreignKey.table)
          || entityByLowerName.get(col.foreignKey.table);
        if (!tgt || tgt.name === entity.name) return;

        const key = \`fk:\${entity.name}:\${col.name}\`;
        if (drawn.has(key)) return;
        drawn.add(key);

        const label = col.name + ' → ' + col.foreignKey.table + '.' + col.foreignKey.column;
        drawRelEdge(svg, entity.name, tgt.name, 'many', 'one', FK_COLOR, false, label, 'fk', cachedObstacles);
        relCount++;
      });
    }

    // ── Eloquent model relationships ──
    if (relFilter === 'both' || relFilter === 'eloquent') {
      entity.relationships.forEach(rel => {
        const tgt = entityByName.get(rel.relatedModel)
          || entityByTableName.get(rel.relatedModel.toLowerCase() + 's');
        if (!tgt || tgt.name === entity.name) return;

        const key = \`rel:\${entity.name}:\${rel.name}\`;
        if (drawn.has(key)) return;
        drawn.add(key);

        // Source card = entity, determine cardinality from relationship type
        const srcCard =
          rel.type === 'belongsToMany' ? 'many' :
          ['hasMany','morphMany','hasManyThrough','hasOne','hasOneThrough'].includes(rel.type) ? 'one' :
          ['belongsTo','morphTo'].includes(rel.type) ? 'many' : 'many';
        const tgtCard =
          rel.type === 'belongsToMany' ? 'many' :
          ['hasMany','morphMany','hasManyThrough'].includes(rel.type) ? 'many' :
          ['hasOne','hasOneThrough'].includes(rel.type) ? 'one' :
          ['belongsTo','morphTo'].includes(rel.type) ? 'one' : 'many';

        drawRelEdge(svg, entity.name, tgt.name, srcCard, tgtCard, REL_COLOR, true, rel.type, 'eloquent', cachedObstacles);
        relCount++;
      });
    }
  });

  document.getElementById('status-rels').textContent = relCount + ' relationships';
}

function scheduleRenderRels() {
  if (renderRelsFrame !== null) return;
  renderRelsFrame = requestAnimationFrame(() => {
    renderRelsFrame = null;
    renderRels();
  });
}

// ─────────────────────────────────────────────────
// PAN & ZOOM
// ─────────────────────────────────────────────────
const wrap = document.getElementById('canvas-wrap');

wrap.addEventListener('mousedown', e => {
  if (e.target === wrap || e.target.id === 'canvas' || e.target.id === 'rel-svg' || e.target.tagName === 'svg') {
    drag = { type: 'pan', startX: e.clientX, startY: e.clientY, origPanX: panX, origPanY: panY };
    wrap.style.cursor = 'grabbing';
  }
});

document.addEventListener('mousemove', e => {
  if (!drag) return;
  if (drag.type === 'pan') {
    panX = drag.origPanX + (e.clientX - drag.startX);
    panY = drag.origPanY + (e.clientY - drag.startY);
    applyTransform();
  } else if (drag.type === 'card') {
    const nx = Math.max(0, drag.origX + (e.clientX - drag.startX) / zoom);
    const ny = Math.max(0, drag.origY + (e.clientY - drag.startY) / zoom);
    positions[drag.entityName] = { x: nx, y: ny };
    const card = document.querySelector(\`[data-entity="\${drag.entityName}"]\`);
    if (card) { card.style.left = nx + 'px'; card.style.top = ny + 'px'; }
    syncCanvasBounds();
    scheduleRenderRels();
  }
});

document.addEventListener('mouseup', () => {
  if (drag) { drag = null; wrap.style.cursor = 'default'; }
});

wrap.addEventListener('wheel', e => {
  e.preventDefault();
  const delta  = e.deltaY > 0 ? -0.08 : 0.08;
  const newZ   = Math.max(0.15, Math.min(2.5, zoom + delta));
  const rect   = wrap.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const sc = newZ / zoom;
  panX = mx - sc * (mx - panX);
  panY = my - sc * (my - panY);
  zoom = newZ;
  applyTransform();
  updateStatus();
}, { passive: false });

function applyTransform() {
  document.getElementById('canvas').style.transform = \`translate(\${panX}px,\${panY}px) scale(\${zoom})\`;
}

function startCardDrag(e, entityName, pos) {
  e.preventDefault();
  if (dragCleanup) { dragCleanup(); dragCleanup = null; }
  drag = { type: 'card', entityName, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
  const card = document.querySelector(\`[data-entity="\${entityName}"]\`);
  if (card) card.classList.add('dragging');
  const onUp = () => {
    if (card) card.classList.remove('dragging');
    document.removeEventListener('mouseup', onUp);
    dragCleanup = null;
  };
  dragCleanup = onUp;
  document.addEventListener('mouseup', onUp, { once: true });
}

// ─────────────────────────────────────────────────
// FIT TO SCREEN
// ─────────────────────────────────────────────────
function fitToScreen() {
  if (!schema.entities.length) return;
  const CARD_W = 320, CARD_H = 420;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  schema.entities.forEach(e => {
    const p = positions[e.name] || { x: 0, y: 0 };
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + CARD_W); maxY = Math.max(maxY, p.y + CARD_H);
  });
  const pad = 60;
  const ww = wrap.clientWidth, wh = wrap.clientHeight;
  const cw = maxX - minX + pad * 2, ch = maxY - minY + pad * 2;
  zoom = Math.min(1.0, Math.min(ww / cw, wh / ch));
  panX = (ww - (maxX - minX) * zoom) / 2 - minX * zoom + pad * zoom;
  panY = (wh - (maxY - minY) * zoom) / 2 - minY * zoom + pad * zoom;
  applyTransform(); updateStatus();
}

// ─────────────────────────────────────────────────
// STATUS / TOOLBAR ACTIONS
// ─────────────────────────────────────────────────
function updateStatus() {
  const n = schema.entities.length;
  document.getElementById('status-tables').textContent = n + ' table' + (n !== 1 ? 's' : '');
  document.getElementById('entity-count').textContent  = n + ' table' + (n !== 1 ? 's' : '');
  document.getElementById('status-zoom').textContent   = Math.round(zoom * 100) + '%';
}

document.getElementById('btn-save').addEventListener('click', () => vscode.postMessage({ type: 'save', schema }));
document.getElementById('btn-refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
document.getElementById('btn-fit').addEventListener('click', fitToScreen);
document.getElementById('btn-export').addEventListener('click', exportSvg);

// ── Relationship filter toggle ──
document.getElementById('rel-toggle').addEventListener('click', e => {
  const btn = e.target.closest('.toggle-btn');
  if (!btn) return;
  const filter = btn.dataset.filter;
  if (filter === relFilter) return;
  relFilter = filter;
  document.querySelectorAll('#rel-toggle .toggle-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderRels();
});

// ── Relationship line hover tooltip ──
const tooltip = document.getElementById('rel-tooltip');
const relSvgEl = document.getElementById('rel-svg');
relSvgEl.addEventListener('mousemove', e => {
  const g = e.target.closest && e.target.closest('.rel-group');
  if (!g) { tooltip.style.display = 'none'; return; }
  const src = g.dataset.src;
  const tgt = g.dataset.tgt;
  const relType = g.dataset.relType;
  const relKind = g.dataset.relKind;
  tooltip.innerHTML =
    '<span class="tt-label">' + (relKind === 'fk' ? 'Foreign Key' : 'Eloquent') + '</span><br>' +
    '<span class="tt-src">' + esc(src) + '</span>' +
    ' <span class="tt-type">' + esc(relType) + '</span> ' +
    '<span class="tt-tgt">' + esc(tgt) + '</span>';
  tooltip.style.display = 'block';
  tooltip.style.left = (e.clientX + 12) + 'px';
  tooltip.style.top  = (e.clientY + 12) + 'px';
});
relSvgEl.addEventListener('mouseleave', () => {
  tooltip.style.display = 'none';
});

function exportSvg() {
  // Issue #25: Guard against empty schema.
  if (!schema.entities.length) {
    return;
  }

  // Collect relationship paths + generate a full SVG snapshot
  const relSvg = document.getElementById('rel-svg');
  const paths = Array.from(relSvg.children).map(c => c.outerHTML).join('\\n  ');

  let entityRects = '';
  schema.entities.forEach(e => {
    const p = positions[e.name] || { x: 0, y: 0 };
    const cols = e.columns.map((c, i) =>
      \`  <text x="\${p.x + 12}" y="\${p.y + 76 + i * 22}" font-family="monospace" font-size="11" fill="#dde0f0">
    <tspan fill="#7878a0">[\${c.primaryKey ? 'PK' : c.foreignKey ? 'FK' : '  '}]</tspan>  \${esc(c.name)}  <tspan fill="#7878a0">\${esc(c.type)}</tspan>
  </text>\`
    ).join('\\n');

    entityRects += \`
<rect x="\${p.x}" y="\${p.y}" width="320" height="\${56 + e.columns.length * 22 + 12}" rx="8" fill="#0f0f1e" stroke="#2e2e50" stroke-width="1"/>
<rect x="\${p.x}" y="\${p.y}" width="4" height="\${56 + e.columns.length * 22 + 12}" rx="2" fill="#7c6af7"/>
<text x="\${p.x + 18}" y="\${p.y + 30}" font-family="sans-serif" font-size="12" font-weight="bold" fill="#dde0f0" text-transform="uppercase">\${esc(e.name)}</text>
<line x1="\${p.x}" y1="\${p.y + 44}" x2="\${p.x + 320}" y2="\${p.y + 44}" stroke="#1e1e35"/>
\${cols}
\`;
  });

  let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
  schema.entities.forEach(e => {
    const p = positions[e.name] || { x: 0, y: 0 };
    minX = Math.min(minX, p.x - 30); minY = Math.min(minY, p.y - 30);
    maxX = Math.max(maxX, p.x + 360); maxY = Math.max(maxY, p.y + 56 + e.columns.length * 22 + 50);
  });

  const svgContent = \`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="\${maxX - minX}" height="\${maxY - minY}" viewBox="\${minX} \${minY} \${maxX - minX} \${maxY - minY}">
  <rect x="\${minX}" y="\${minY}" width="\${maxX - minX}" height="\${maxY - minY}" fill="#090912"/>
  \${paths}
\${entityRects}
</svg>\`;

  vscode.postMessage({ type: 'export', content: svgContent });
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────
function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
function iconBtn(text, onClick) {
  const b = el('button', 'icon-btn');
  b.textContent = text;
  b.addEventListener('click', e => { e.stopPropagation(); onClick(e); });
  return b;
}

</script>
</body>
</html>`;
  }
}
