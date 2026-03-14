Objective

Create a VSCode extension that parses Laravel migrations and Eloquent models and generates an interactive Entity Relationship Diagram (ERD).

The ERD must:

Be modern and minimalistic

Automatically adapt to VSCode light/dark themes

Allow direct editing of entities inside the diagram

Synchronize changes back to Laravel migrations and models

Open in a full-screen ERD workspace

Provide export and save functionality

The goal is to create something comparable to a visual database designer, but specifically optimized for Laravel development workflows.

1. Extension Activation

The extension activates when a workspace contains a Laravel project.

Detect:

artisan
composer.json
database/migrations/
app/Models/ OR app/

Once detected, the extension scans:

database/migrations/*.php
app/Models/*.php

and builds an internal schema model.

2. VSCode Integration
Activity Bar Icon

Add a Laravel ERD icon in the VSCode Activity Bar.

Clicking the icon should open a full-screen ERD workspace view.

ERD Workspace View

The ERD should open as a full screen Webview panel, not a small tab.

Layout:

┌──────────────────────────────────────────┐
│ Save | Export | Refresh                  │
├──────────────────────────────────────────┤
│                                          │
│                                          │
│           ERD GRAPH AREA                 │
│                                          │
│                                          │
└──────────────────────────────────────────┘

Top left buttons:

Save → writes changes to migrations/models

Export → export ERD as PNG/SVG/PDF

Refresh → reparse project schema

3. Technology Stack
Extension Backend

TypeScript

VSCode Extension API

Laravel migration/model parser

ERD UI

Inside a Webview:

React + TypeScript

Graph layout engine (ELK.js preferred)

Rendering: SVG

Recommended architecture:

VSCode Extension
        │
        │ message bridge
        ▼
Webview React App
        │
        ▼
Graph Layout Engine (ELK.js)
        │
        ▼
SVG Renderer
4. ERD Design Requirements

The ERD must be:

Minimalistic

Simple

Clean

Professional

Highly readable

Design inspiration:

Linear

modern database tools

Notion style cards

5. Theme Awareness

The diagram must automatically adapt to the active VSCode theme.

Detect theme via:

vscode.window.activeColorTheme

Behavior:

Light Mode

white entity cards

subtle borders

dark text

Dark Mode

dark entity cards

light text

slightly glowing relationship lines

All colors should derive from VSCode theme tokens.

6. Entity Cards

Each table/model is represented by an Entity Card.

Structure:

┌─────────────────────────────┐
│ Users                       │
│-----------------------------│
│ [ Migration ] [ Model ]     │
│                             │
│ tab content                 │
│                             │
└─────────────────────────────┘

Each card contains two tabs:

Migration

Model

7. Migration Tab (Schema View)

The migration tab displays database structure.

Fields must include:

column name

datatype

nullable

default value

primary key

foreign key

constraints

Example:

id          bigint      PK
name        string
email       string      unique
role_id     foreignId → roles.id
created_at  timestamp
8. Model Tab

The model tab displays Laravel model configuration.

Show:

Fillable fields
protected $fillable = [
    name,
    email
]
Guarded fields
protected $guarded = [...]
Relationships

Parse methods returning:

belongsTo
hasMany
hasOne
belongsToMany
morphMany
morphTo

Display example:

role        belongsTo(Role)
posts       hasMany(Post)
9. Direct Editing on Entity Cards

Users must be able to edit fields directly on the card UI without opening a separate editor.

Editable actions inside the Migration tab:

Rename field

Change datatype

Toggle nullable

Set default

Set primary key

Add foreign key

Remove foreign key

Add column

Delete column

Example interaction:

Click field → becomes editable inline.

email [string] → editable dropdown

Datatype selector should include:

string
text
integer
bigInteger
boolean
timestamp
date
foreignId
uuid
json
decimal
10. Editing Fillable / Guarded Fields

Inside the Model tab, users must be able to toggle fields between:

fillable
guarded

Example UI:

name       ✓ fillable
email      ✓ fillable
password   guarded

Changing these updates the model file.

11. Creating Relationships

Relationships can be created in three ways:

1. Migration Level

Add a foreign key column.

Example:

role_id → roles.id

Updates migration file.

2. Model Level

Add Eloquent relationships:

belongsTo
hasMany
hasOne
belongsToMany

Updates model file.

3. Both

Create a relationship that updates:

migration

model

Example:

users.role_id → roles.id

Also generates:

public function role()
{
    return $this->belongsTo(Role::class);
}
12. Relationship Lines

Lines between entities represent:

foreign keys

model relationships

Rules:

Lines must never pass under entity cards

Lines must route around cards

Use orthogonal routing

Example:

users ──────┐
             ├── roles
posts ──────┘

Use ELK.js orthogonal edge routing.

13. Automatic Graph Layout

The ERD must automatically organize itself.

Layout goals:

minimize crossing edges

keep related tables close

maximize readability

Use:

ELK.js layered layout

Settings:

orthogonal edges
node spacing
hierarchical layout
14. Internal Schema Representation

Create a schema model:

Entity
  name
  columns[]
  relationships[]

Column
  name
  type
  nullable
  default
  primaryKey
  foreignKey

Relationship
  type
  source
  target
15. Parsing Laravel Files
Migrations

Parse:

Schema::create
Schema::table

Extract:

$table->string()
$table->integer()
$table->boolean()
$table->foreignId()
$table->timestamps()
Models

Parse:

fillable
guarded
casts
relationships

Use AST parsing instead of regex.

Recommended:

php-parser
16. Saving Changes Back to Code

When user clicks Save:

Compute diff between ERD schema and project files.

Update migrations and models accordingly.

Use AST transformation.

Preserve Laravel formatting.

Examples of generated updates:

Add column:

$table->string('phone');

Add relationship:

public function role()
{
    return $this->belongsTo(Role::class);
}
17. File Safety

Before writing changes:

Backup original files

Apply AST modifications

Format output

Save

18. Real-time Sync

Watch project files.

If migrations or models change:

reparse → update ERD

Use:

VSCode FileSystemWatcher
19. Performance Requirements

Must support:

100+ tables

smooth zooming

smooth panning

Strategies:

graph virtualization

incremental parsing

lazy rendering

20. Navigation Features

The ERD should support:

Zoom
Pan
Search entities
Center graph
Highlight relationships

Controls:

Mouse wheel → zoom
Drag → pan
Click node → focus
21. Export Options

Export ERD as:

PNG
SVG
PDF

Export must preserve layout.

Expected Result

A VSCode extension that allows developers to:

Visualize Laravel schema as an ERD

Edit database structure directly on diagram cards

Manage fillable/guarded fields

Create model or migration relationships

Automatically update Laravel code

Work in a modern, theme-aware full-screen ERD editor