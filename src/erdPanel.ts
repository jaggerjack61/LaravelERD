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
  private readonly layoutStore: vscode.Memento | undefined;
  private disposables: vscode.Disposable[] = [];
  private schema: Schema = { entities: [] };

  public static createOrShow(extensionUri: vscode.Uri, workspacePath: string, layoutStore?: vscode.Memento): void {
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
    ErdPanel.currentPanel = new ErdPanel(panel, extensionUri, workspacePath, layoutStore);
  }

  public static refresh(): void {
    ErdPanel.currentPanel?.doRefresh();
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    workspacePath: string,
    layoutStore: vscode.Memento | undefined
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.workspacePath = workspacePath;
    this.layoutStore = layoutStore;

    this.panel.webview.html = this.getHtml(this.panel.webview);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'ready':
            this.panel.webview.postMessage({ type: 'layout', data: this.layoutStore?.get(this.layoutKey()) ?? null });
            await this.doRefresh();
            break;
          case 'layout':
            await this.layoutStore?.update(this.layoutKey(), message.data);
            break;
          case 'refresh':
            await this.doRefresh();
            break;
          case 'save': {
            let ok = false;
            try {
              ok = await this.saveSchema(message.schema as Schema);
            } catch (err) {
              vscode.window.showErrorMessage(`Laravel ERD save error: ${String(err)}`);
            }
            this.panel.webview.postMessage({ type: 'saved', ok });
            break;
          }
          case 'export':
            await this.exportSvg(message.content as string);
            break;
          case 'openFile':
            if (typeof message.path === 'string' && isPathInsideWorkspace(message.path, this.workspacePath)) {
              const resolvedPath = path.isAbsolute(message.path)
                ? path.resolve(message.path)
                : path.resolve(this.workspacePath, message.path);
              if (fs.existsSync(resolvedPath)) {
                // Open beside the diagram so it stays visible.
                vscode.window.showTextDocument(vscode.Uri.file(resolvedPath), {
                  viewColumn: vscode.ViewColumn.Beside,
                  preview: true,
                });
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
          this.panel.webview.postMessage({ type: 'error', message: String(err) });
        }
      }
    );
  }

  private layoutKey(): string {
    return `laravelErd.layout:${path.resolve(this.workspacePath)}`;
  }

  private async saveSchema(newSchema: Schema): Promise<boolean> {
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
        return errors.length === 0;
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
    return errors.length === 0;
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
    const mediaUri = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'webview', file));
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    const bodyClass = isDarkTheme() ? '' : 'light';

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Laravel ERD</title>
  <link rel="stylesheet" href="${mediaUri('erd.css')}">
</head>
<body class="${bodyClass}">

<header class="toolbar">
  <div class="brand">
    <div class="brand-mark" data-icon="logo" data-icon-size="16"></div>
    <div class="brand-text">
      <span class="brand-title">Laravel ERD</span>
      <span class="brand-meta"><span id="status-tables">0 tables</span> · <span id="status-rels">0 relationships</span></span>
    </div>
  </div>

  <div class="search">
    <label class="search-field" data-icon="search">
      <input id="search" type="text" placeholder="Find a table or column…" autocomplete="off" spellcheck="false" aria-label="Find a table or column">
      <kbd>/</kbd>
    </label>
    <div class="search-results" id="search-results" role="listbox"></div>
  </div>

  <div class="spacer"></div>

  <div class="segmented" id="rel-toggle" role="group" aria-label="Relationships to show">
    <button class="seg-btn active" data-filter="both" title="Show all relationships">All</button>
    <button class="seg-btn" data-filter="fk" title="Foreign key constraints from migrations"><span class="swatch fk"></span><span class="label">Foreign keys</span></button>
    <button class="seg-btn" data-filter="eloquent" title="Eloquent relationships from models"><span class="swatch eloquent"></span><span class="label">Eloquent</span></button>
  </div>
  <div class="sep"></div>
  <button class="btn" id="btn-arrange" data-icon="arrange" title="Auto-arrange tables"><span class="label">Arrange</span></button>
  <button class="btn" id="btn-export" data-icon="export" title="Export as SVG"><span class="label">Export</span></button>
  <button class="btn" id="btn-refresh" data-icon="refresh" title="Re-read migrations and models"><span class="label">Refresh</span></button>
  <button class="btn primary is-clean" id="btn-save" data-icon="save"><span class="label">Save</span><span class="count-badge" id="dirty-count">0</span></button>
</header>

<main class="canvas-wrap" id="canvas-wrap">
  <div class="canvas" id="canvas">
    <svg class="rel-svg" id="rel-svg" xmlns="http://www.w3.org/2000/svg"></svg>
  </div>
</main>

<div class="float minimap" id="minimap"><canvas id="minimap-canvas" width="200" height="128" aria-label="Minimap"></canvas></div>

<div class="float zoom-controls" role="group" aria-label="Zoom">
  <button class="icon-btn" id="btn-minimap" data-icon="map" title="Toggle minimap"></button>
  <div class="sep"></div>
  <button class="icon-btn" id="btn-zoom-out" data-icon="minus" title="Zoom out (−)"></button>
  <button class="zoom-label" id="status-zoom" title="Reset to 100% (0)">100%</button>
  <button class="icon-btn" id="btn-zoom-in" data-icon="plus" title="Zoom in (+)"></button>
  <button class="icon-btn" id="btn-fit" data-icon="fit" title="Fit to screen (F)"></button>
  <div class="sep"></div>
  <button class="icon-btn" id="btn-help" data-icon="help" title="Keyboard shortcuts (?)"></button>
</div>

<div class="float help-panel" id="help-panel">
  <h3>Shortcuts</h3>
  <div class="help-row">Find a table <span class="keys"><kbd>/</kbd></span></div>
  <div class="help-row">Save changes <span class="keys"><kbd>⌘</kbd><kbd>S</kbd></span></div>
  <div class="help-row">Fit to screen <span class="keys"><kbd>F</kbd></span></div>
  <div class="help-row">Zoom in / out / 100% <span class="keys"><kbd>+</kbd><kbd>−</kbd><kbd>0</kbd></span></div>
  <div class="help-row">Pan <span class="keys"><kbd>Space</kbd> + drag</span></div>
  <div class="help-row">Move selected table <span class="keys"><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd></span></div>
  <div class="help-row">Collapse selected table <span class="keys"><kbd>C</kbd></span></div>
  <div class="help-row">Clear selection / cancel <span class="keys"><kbd>Esc</kbd></span></div>
</div>

<div class="hint-bar" id="hint-bar">
  <span>Drag tables to move</span>
  <span>Drag <b style="color:var(--eloquent)">●</b> to another table to relate</span>
  <span>Scroll to zoom</span>
  <span><kbd>?</kbd> shortcuts</span>
</div>

<div class="state visible" id="state-loading">
  <div class="spinner"></div>
  <p>Reading migrations and models…</p>
</div>
<div class="state" id="state-empty">
  <div class="state-icon" data-icon="table" data-icon-size="24"></div>
  <h2>No tables yet</h2>
  <p>No migrations were found in <code>database/migrations</code>. Create one and the diagram updates automatically.</p>
  <button class="btn" id="btn-empty-refresh" data-icon="refresh"><span class="label">Refresh</span></button>
</div>
<div class="state" id="state-error">
  <div class="state-icon" data-icon="alert" data-icon-size="24"></div>
  <h2>Couldn’t read this project</h2>
  <p id="state-error-msg"></p>
</div>

<div class="popover" id="rel-popover" role="dialog" aria-label="New relationship"></div>
<div class="rel-tooltip" id="rel-tooltip"></div>
<div class="toasts" id="toasts"></div>

<script nonce="${nonce}" src="${mediaUri('erd.js')}"></script>
</body>
</html>`;
  }
}
