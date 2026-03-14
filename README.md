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
- Lets you edit column metadata inline in the Migration tab
- Lets you toggle fields between `$fillable` and `$guarded` in the Model tab
- Saves model-side changes back to PHP files
- Generates a new alter migration when you add new columns in the ERD
- Exports the current diagram as SVG
- Refreshes automatically when watched migration or model files change

## Current Save Behavior

The Save action is intentionally narrow. It currently does the following:

- Updates existing `$fillable` arrays in model files
- Updates existing `$guarded` arrays in model files
- Appends newly added relationship methods to model files
- Creates a new migration in `database/migrations/` for columns that were added in the ERD

It does not currently rewrite existing migration files or fully synchronize every editable schema detail back to Laravel source. For example, editing a column's type, nullable flag, uniqueness, or deleting a column only affects the in-memory diagram until broader save support is implemented.

## UI Overview

Each entity is rendered as a card with two tabs:

- Migration: columns, PK/FK badges, type labels, and inline column editing
- Model: fields derived from model metadata plus parsed Eloquent relationships

The toolbar includes:

- Save
- Export SVG
- Refresh
- Fit
- Relationship filter: Both, FK, or Eloquent

Relationship lines use solid blue for foreign keys and dashed teal for Eloquent relationships, with hover tooltips and crow's foot markers.

## Supported Parsing Scope

The parser currently recognizes a practical subset of Laravel conventions, including:

- `Schema::create(...)`
- Common column definitions such as `string`, `text`, `integer`, `bigInteger`, `boolean`, `timestamp`, `json`, `uuid`, and similar blueprint calls
- `id()`
- `timestamps()`
- `softDeletes()`
- `rememberToken()`
- `foreignId(...)->constrained()`
- `foreign(...)->references(...)->on(...)`
- `$fillable`
- `$guarded`
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
- A Laravel workspace with an `artisan` file so the extension can activate
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

## Limitations

- Activation currently depends on detecting `artisan` in the workspace.
- Export is SVG only.
- Auto-layout uses a simple grid, not a graph layout engine.
- Save support is partial and currently strongest for model metadata plus newly added columns.
- Relationship detection depends on recognizable Laravel method patterns and naming conventions.
