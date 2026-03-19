# Code Issues — Performance & Inconsistent Behaviour

## Performance Issues

### 1. Full DOM re-render on every interaction (erdPanel.ts, webview JS)
`render()` destroys and rebuilds every entity card DOM node on each call — including mouse-drag
updates, tab switches, column edits, and field toggles. `renderCards()` removes all children and
reconstructs them from scratch. This causes layout thrashing, loses scroll positions inside
`.col-list`, and scales poorly with many entities.

**Where:** `renderCards()` — `Array.from(canvas.children).forEach(c => { if (c !== svg) c.remove(); });`

### 2. Relationship SVG rebuilt on every card drag frame (erdPanel.ts, webview JS)
During card drag (`mousemove` handler), `renderRels()` is called on every pixel of movement. Each
call clears and re-creates the entire SVG content, runs collision detection against all entities,
and routes every edge — O(E × N) per frame. No throttle or `requestAnimationFrame` gating.

**Where:** `mousemove` handler → `syncCanvasBounds(); renderRels();`

### 3. O(N²) obstacle collision in orthogonal router (erdPanel.ts, webview JS)
`routeOrtho` calls `getObstacles()` to build a fresh array of all entity rectangles for every
single relationship edge. Then for each edge, up to 11 candidate midpoints are tested via
`vertHitsObs` / `horizHitsObs` (linear scan of all obstacles). Total work per render is
O(R × N × tries) where R = relationships, N = entities.

**Where:** `getObstacles()`, `routeOrtho()`, `renderRels()`

### 4. Synchronous file I/O on the extension host thread (parser.ts)
`parseProject()` is declared `async` but all I/O is synchronous (`fs.readdirSync`,
`fs.readFileSync`, `fs.existsSync`). This blocks the VS Code extension host while scanning
potentially hundreds of migration/model files in large Laravel projects. `collectPhpFiles`
recurses the entire `app/` tree synchronously.

**Where:** `parseProject()`, `collectPhpFiles()`, `parseMigration()`, `parseModel()`

### 5. Synchronous file writes during save (erdPanel.ts)
`saveSchema()` and `updateModelFile()` use synchronous `fs.readFileSync` / `fs.writeFileSync`
on the extension host. Writing multiple model files and a migration sequentially on the main
thread blocks the UI.

**Where:** `updateModelFile()`, `generateAlterMigration()`

### 6. Global `document.addEventListener('mousemove')` runs tooltip logic unconditionally (erdPanel.ts, webview JS)
A second `mousemove` listener (for the relationship tooltip) runs on every mouse movement across
the entire document, calling `e.target.closest('.rel-group')` each time — even when the mouse is
nowhere near an SVG line.

**Where:** The second `document.addEventListener('mousemove', ...)` block near the tooltip code

---

## Inconsistent Behaviour

### 7. Model directory scan `break` skips `app/` fallback (parser.ts, line ~241)
The model-scanning loop iterates `[app/Models, app/]` but unconditionally `break`s after the
first directory that exists. If `app/Models/` exists but only some models live in `app/` (common
in older Laravel projects), those models are silently missed.

**Where:** `for (const modelDir of modelDirs) { ... break; }`

### 8. `parseMigration` ignores `Schema::table` (alter) migrations (parser.ts)
The function only matches `Schema::create(...)`. Migrations that use `Schema::table(...)` to add
columns, foreign keys, or indexes — extremely common in real projects — are completely ignored.
The merge logic in `parseProject` is therefore dead code.

**Where:** `const createMatch = content.match(/Schema::create\s*\(\s*['"]([^'"]+)['"]/);`

### 9. `classToTable` pluralisation is naive (parser.ts)
Only handles `-y→-ies` and `-s/-sh/-ch/-x/-z→-es`. Irregular English plurals (`Person→people`,
`Child→children`, `Goose→geese`, etc.) and words ending in `-f/-fe` are pluralised incorrectly.
Laravel uses an inflector with a large exception table; this implementation will produce wrong
table names for any model relying on irregular plurals.

**Where:** `classToTable()`

### 10. Duplicate model scanning for nested `app/Models` (parser.ts)
`collectPhpFiles(app/Models)` is included when scanning `app/` because `app/` is a parent
directory. If the `break` on #7 were removed, models inside `app/Models/` would be parsed twice,
potentially creating duplicate entities or overwriting data.

**Where:** `modelDirs` array and `collectPhpFiles`

### 11. `foreignId` without `constrained()` always infers an FK target (parser.ts)
When a migration has `$table->foreignId('custom_ref')` with no `->constrained()`, the parser
still fabricates a foreign key target by pluralising the column-name stem. This can draw
incorrect relationship lines for columns that aren't actual foreign keys.

**Where:** `foreignId` matching block — `else` branch after `constrainedMatch`

### 12. Generated migration uses raw `col.type` which may be a display type (erdPanel.ts)
`generateAlterMigration` emits `$table->{col.type}('{col.name}')`, but `col.type` contains
mapped display strings like `varchar`, `bigint unsigned`, `varchar(45)`. These are not valid
Blueprint method names. The migration will throw a runtime error when `php artisan migrate` is
run.

**Where:** `generateAlterMigration()` — `$table->${col.type}('${col.name}')`

### 13. XSS-adjacent risk in `buildEditRow` `innerHTML` usage (erdPanel.ts, webview JS)
`buildEditRow` sets `nullLbl.innerHTML = '<input type="checkbox"> nullable'`. While currently
using static strings, this pattern is easy to accidentally extend with user-supplied data. Other
DOM construction in the codebase uses safe `textContent` / `createElement` — inconsistent with
this shortcut.

**Where:** `buildEditRow()` — `nullLbl.innerHTML`, `uniqLbl.innerHTML`

### 14. Card drag `mouseup` listener leaks when panel is re-rendered mid-drag (erdPanel.ts, webview JS)
`startCardDrag` adds a one-shot `mouseup` listener to `document`. If `render()` fires while a
card is being dragged (e.g. from the file-watcher refresh), the old card DOM node is destroyed
but the listener remains referencing a stale element, and the `.dragging` class is never removed
from the new card.

**Where:** `startCardDrag()` — `document.addEventListener('mouseup', function onUp() { ... })`

### 15. `doRefresh` does not `await` `withProgress` (erdPanel.ts)
`doRefresh()` calls `vscode.window.withProgress(...)` but does not `await` or `return` the
promise. The caller's `await this.doRefresh()` resolves immediately, before parsing completes.
This can cause race conditions when `doRefresh` is triggered rapidly (e.g. multiple file-watcher
events).

**Where:** `private async doRefresh()` — missing `return` / `await` on `withProgress`

### 16. File-watcher fires refresh with no debounce (extension.ts)
`onDidChange`, `onDidCreate`, `onDidDelete` all call `ErdPanel.refresh()` immediately. Saving
multiple migration files in quick succession (or running `artisan make:migration`) triggers
multiple concurrent parse+render cycles with no debouncing.

**Where:** `watcher.onDidChange(onChanged)` etc.

### 17. `openFile` handler trusts message path without validation (erdPanel.ts)
The `openFile` message handler opens any path sent from the webview as long as `fs.existsSync`
returns true. A compromised or manipulated webview could open arbitrary files outside the
workspace. Should validate the path is under `workspacePath`.

**Where:** `case 'openFile':` in `onDidReceiveMessage`

### 18. Theme detection treats `HighContrast` as dark (erdPanel.ts)
`ColorThemeKind.HighContrast` and `HighContrastLight` are both != `Light`, so high-contrast
light themes are treated as dark. Should check for `HighContrastLight` separately (VS Code
1.74+).

**Where:** `const isDark = vscode.window.activeColorTheme.kind !== vscode.ColorThemeKind.Light;`

### 19. `positions` state is lost when schema entity names change (erdPanel.ts, webview JS)
Entity positions are keyed by `entity.name` (the PascalCase class name derived from the table).
If a migration is renamed or a model class is renamed, the old position key becomes orphaned
and the entity gets a fresh grid position, causing the layout to jump unexpectedly.

**Where:** `positions` object usage throughout the webview JS

### 20. `belongsToMany` cardinality is rendered as many-to-many but defaults to `many → many` unconditionally (erdPanel.ts, webview JS)
The cardinality logic in `renderRels` falls through to the catch-all `'many'` for both `srcCard`
and `tgtCard` for `belongsToMany`. While technically correct for the final result, the
intermediate ternary chain is hard to follow and `belongsToMany` is not explicitly listed,
making it easy to break when adding new relationship types.

**Where:** `srcCard` / `tgtCard` ternary chains in `renderRels()`

### 21. Line-by-line migration parsing drops multiline modifier chains (parser.ts)
`parseMigration()` only inspects one trimmed line at a time and ignores continuation lines that
start with `->...`. Real Laravel migrations often format chains across lines, such as
`$table->string('name')` followed by `->nullable()` or `->unique()` on the next line. In those
cases the extension records the column but silently loses the modifiers or FK constraint.

**Where:** `for (const rawLine of lines)` loop in `parseMigration()`

### 22. Auto-refresh watcher misses nested models outside `app/Models/**` (extension.ts)
The parser falls back to scanning the entire `app/` tree, but the watcher only subscribes to
`app/*.php` and `app/Models/**/*.php`. Models stored in nested folders like `app/Admin/User.php`
or `app/Domain/Billing/Invoice.php` will be picked up on a manual refresh but won't trigger an
automatic refresh when edited.

**Where:** `createFileSystemWatcher(new RelativePattern(... '{database/migrations/*.php,app/Models/**/*.php,app/*.php}'))`

### 23. Fillable/guarded edits can be lost when the model file lacks those properties (erdPanel.ts)
The UI lets users toggle fields between `$fillable` and `$guarded`, but `updateModelFile()` only
replaces properties that already exist. If a model has neither property defined, Save reports
`No changes detected` and the in-memory edits are discarded on the next refresh.

**Where:** regex replacements for `protected $fillable` and `protected $guarded` in `updateModelFile()`

### 24. Initial fit-to-screen depends on parse timing (erdPanel.ts, webview JS)
The webview schedules `setTimeout(fitToScreen, 200)` once at script startup, but `render()` never
calls `fitToScreen()` after schema data arrives. On slower projects, parsing finishes after that
200 ms window, so the initial view is not fitted or centered. On faster projects it may appear to
work, making the behaviour machine-dependent.

**Where:** trailing `setTimeout(fitToScreen, 200);` and the `schema` message handler

### 25. Exporting with an empty schema produces invalid SVG bounds (erdPanel.ts, webview JS)
`exportSvg()` computes `minX`, `minY`, `maxX`, and `maxY` by iterating entities, but it does not
guard against the empty state. If the user exports before any schema is loaded, the generated SVG
uses `Infinity` / `-Infinity` dimensions and the export is invalid.

**Where:** `exportSvg()` bounding-box calculation after `schema.entities.forEach(...)`
