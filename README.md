# Laravel ERD

Laravel ERD is a VS Code extension that reads your Laravel migrations and Eloquent models, then renders them as an interactive ER diagram inside a webview panel.

It is aimed at day-to-day schema inspection with lightweight editing support, not full round-trip database design.

## What It Does

- Parses Laravel migrations from `database/migrations/*.php`
- Parses Eloquent models from `app/Models/**/*.php` and falls back to `app/**/*.php`
- Builds entity cards for tables and models in a dedicated ERD panel
- Draws two relationship layers:
  - Foreign key relationships from migrations
  - Eloquent relationships from model methods
- Supports panning, zooming, fit-to-screen, and dragging cards
- Automatically fits the diagram to the screen on first load
- Remembers card positions across refreshes and survives entity renames
- Lets you edit column metadata inline in the Migration tab
- Lets you toggle fields between `$fillable` and `$guarded` in the Model tab
- Saves model-side changes back to PHP files
- Generates a new alter migration when you add new columns in the ERD
- Exports the current diagram as SVG
- Refreshes automatically when watched migration or model files change
- Opens migration/model source files directly from card headers (↗ button)
- Supports multi-root workspaces with multiple Laravel projects
- Adapts to VS Code's light and dark themes automatically

## Current Save Behavior

The Save action is intentionally narrow. It currently does the following:

- Updates existing `$fillable` arrays in model files, or inserts the property if the model lacks it
- Updates existing `$guarded` arrays in model files, or inserts the property if the model lacks it
- Appends newly added relationship methods to model files
- Creates a new migration in `database/migrations/` for columns that were added in the ERD

It does not currently rewrite existing migration files or fully synchronize every editable schema detail back to Laravel source. For example, editing a column's type, nullable flag, uniqueness, or deleting a column only affects the in-memory diagram until broader save support is implemented.

## UI Overview

Each entity is rendered as a card with two tabs:

- **Migration**: columns, PK/FK badges, type labels, and inline column editing
- **Model**: fields derived from model metadata plus parsed Eloquent relationships

The toolbar includes:

- **Save** — persists model changes and generates alter migrations for new columns
- **Export SVG** — saves a static SVG snapshot of the diagram
- **Refresh** — re-parses migrations and models from disk
- **Fit** — resets zoom and pan to show all cards
- **Relationship filter** — toggle between Both, FK only, or Eloquent only
- **↗ button** on each card header — opens the migration or model source file

The status bar (bottom) displays the current zoom level, table count, and relationship count.

Relationship lines use solid blue for foreign keys and dashed teal for Eloquent relationships, with hover tooltips and crow's foot markers.

## Supported Parsing Scope

The parser currently recognizes a practical subset of Laravel conventions, including:

- `Schema::create(...)` and `Schema::table(...)`
- Common column definitions such as `string`, `text`, `integer`, `bigInteger`, `boolean`, `timestamp`, `json`, `uuid`, and similar blueprint calls
- Multiline modifier chains (`->nullable()->unique()` split across lines)
- `id()`
- `timestamps()`
- `softDeletes()`
- `rememberToken()`
- `foreignId(...)->constrained()` (with or without explicit table)
- `foreign(...)->references(...)->on(...)` — including when the column is defined in a different migration file
- `$fillable` and `$guarded`
- Relationship methods returning:
  - `belongsTo`
  - `hasMany`
  - `hasOne`
  - `belongsToMany`
  - `morphMany`
  - `morphTo`
  - `hasOneThrough`
  - `hasManyThrough`

Parsing is regex-based, so heavily dynamic Laravel code or unconventional formatting may not be detected perfectly.

## Requirements

- VS Code 1.80+
- A Laravel workspace with an `artisan` file (or `database/migrations/` directory) so the extension can activate
- Migration files in `database/migrations/`
- Model files in `app/Models/` or `app/`

## Getting Started

1. Open a Laravel project in VS Code.
2. Open the Laravel ERD view from the activity bar, or run `Laravel ERD: Open ERD` from the command palette.
3. Wait for the project to be parsed.
4. Use the toolbar to inspect, filter, refresh, save, or export the diagram.

## Commands

- `Laravel ERD: Open ERD`
- `Laravel ERD: Refresh`

## Development

```bash
npm install
npm run compile
```

Use `npm run watch` during development, then press `F5` in VS Code to launch the Extension Development Host.

**Convenience script:** On Windows, run `.\start.ps1` to open a dedicated terminal that runs `npm install` and `npm run watch` automatically, then press `F5` in VS Code.

**Marketplace icon:** Run `npm run prepare:store-icon` to resize `media/store_icon.png` to `media/store_icon_128.png`.

## Limitations

- Activation currently depends on detecting `artisan` or `database/migrations/` in the workspace.
- Export is SVG only.
- Auto-layout uses a simple grid, not a graph layout engine.
- Save support is partial and currently strongest for model metadata plus newly added columns.
- Relationship detection depends on recognizable Laravel method patterns and naming conventions.
