# Laravel ERD

A VS Code extension that generates interactive Entity Relationship Diagrams from your Laravel project's migrations and models.

## Features

- **Auto-parses** Laravel migrations (`database/migrations/*.php`) and Eloquent models (`app/Models/*.php`)
- **Interactive canvas** with pan, zoom, and draggable entity cards
- **Two relationship views** — foreign key constraints (solid blue) and Eloquent relationships (dashed teal), with a toggle to show FK, Eloquent, or both
- **Crow's foot notation** for cardinality (one / many)
- **Hover tooltips** on relationship lines showing type and involved entities
- **Inline editing** — add columns, toggle fillable/guarded, edit column properties
- **Save back** — writes changes to your model files and generates alter migrations for new columns
- **Export SVG** — snapshot the diagram as a standalone SVG file
- **Light & dark theme** — follows your VS Code theme automatically
- **Live reload** — watches migration and model files for changes

## Getting Started

1. Open a Laravel project in VS Code (must contain an `artisan` file at the root)
2. Click the **Laravel ERD** icon in the activity bar, or run `Laravel ERD: Open ERD` from the command palette
3. The diagram renders automatically from your migrations and models

## Development

```bash
npm install
npm run compile   # or: npm run watch
```

Press `F5` in VS Code to launch the Extension Development Host.

## Requirements

- VS Code 1.80+
- A Laravel project with `database/migrations/` and `app/Models/`
