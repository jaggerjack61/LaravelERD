import { afterEach, describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { classToTable, parseMigration, parseModel, parseProject } from './parser';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ─────────────────────────────────────────────────────
// Issue #9 — classToTable should handle irregular plurals
// ─────────────────────────────────────────────────────
describe('classToTable', () => {
  it('handles basic CamelCase to snake_plural', () => {
    expect(classToTable('User')).toBe('users');
    expect(classToTable('BlogPost')).toBe('blog_posts');
  });

  it('handles -y → -ies', () => {
    expect(classToTable('Category')).toBe('categories');
    expect(classToTable('Company')).toBe('companies');
  });

  it('handles -s/-sh/-ch/-x/-z → -es', () => {
    expect(classToTable('Bus')).toBe('buses');
    expect(classToTable('Bush')).toBe('bushes');
    expect(classToTable('Church')).toBe('churches');
    expect(classToTable('Box')).toBe('boxes');
    expect(classToTable('Quiz')).toBe('quizzes');
  });

  // Issue #9: irregular plurals
  it('handles irregular plurals', () => {
    expect(classToTable('Person')).toBe('people');
    expect(classToTable('Child')).toBe('children');
    expect(classToTable('Goose')).toBe('geese');
    expect(classToTable('Mouse')).toBe('mice');
    expect(classToTable('Man')).toBe('men');
    expect(classToTable('Woman')).toBe('women');
    expect(classToTable('Tooth')).toBe('teeth');
    expect(classToTable('Foot')).toBe('feet');
    expect(classToTable('Ox')).toBe('oxen');
    expect(classToTable('Cactus')).toBe('cacti');
    expect(classToTable('Focus')).toBe('foci');
    expect(classToTable('Analysis')).toBe('analyses');
    expect(classToTable('Criterion')).toBe('criteria');
  });

  it('handles -f/-fe → -ves', () => {
    expect(classToTable('Knife')).toBe('knives');
    expect(classToTable('Wolf')).toBe('wolves');
    expect(classToTable('Leaf')).toBe('leaves');
    expect(classToTable('Life')).toBe('lives');
    expect(classToTable('Wife')).toBe('wives');
    expect(classToTable('Half')).toBe('halves');
  });

  it('handles words ending in vowel+y (just add s)', () => {
    expect(classToTable('Day')).toBe('days');
    expect(classToTable('Key')).toBe('keys');
    expect(classToTable('Boy')).toBe('boys');
  });

  it('handles uncountable words', () => {
    expect(classToTable('Sheep')).toBe('sheep');
    expect(classToTable('Fish')).toBe('fish');
    expect(classToTable('Deer')).toBe('deer');
    expect(classToTable('Species')).toBe('species');
    expect(classToTable('Series')).toBe('series');
  });
});

// ─────────────────────────────────────────────────────
// Issue #8 — parseMigration should handle Schema::table
// ─────────────────────────────────────────────────────
describe('parseMigration', () => {
  it('parses Schema::create migrations', () => {
    const content = `<?php
Schema::create('posts', function (Blueprint $table) {
    $table->id();
    $table->string('title');
    $table->timestamps();
});`;
    const result = parseMigration(content, '/migrations/create_posts.php');
    expect(result).not.toBeNull();
    expect(result!.tableName).toBe('posts');
    expect(result!.columns).toHaveLength(4); // id, title, created_at, updated_at
  });

  // Issue #8: Schema::table should be parsed
  it('parses Schema::table (alter) migrations', () => {
    const content = `<?php
Schema::table('posts', function (Blueprint $table) {
    $table->string('subtitle')->nullable();
    $table->foreignId('author_id')->constrained('users');
});`;
    const result = parseMigration(content, '/migrations/alter_posts.php');
    expect(result).not.toBeNull();
    expect(result!.tableName).toBe('posts');
    expect(result!.columns.some(c => c.name === 'subtitle')).toBe(true);
    expect(result!.columns.some(c => c.name === 'author_id')).toBe(true);
  });

  // Issue #11: foreignId without constrained() should NOT infer FK
  it('does not infer FK for foreignId without constrained()', () => {
    const content = `<?php
Schema::create('orders', function (Blueprint $table) {
    $table->id();
    $table->foreignId('custom_ref');
});`;
    const result = parseMigration(content, '/migrations/create_orders.php');
    expect(result).not.toBeNull();
    const col = result!.columns.find(c => c.name === 'custom_ref');
    expect(col).toBeDefined();
    expect(col!.foreignKey).toBeUndefined();
  });

  it('infers FK for foreignId with constrained()', () => {
    const content = `<?php
Schema::create('orders', function (Blueprint $table) {
    $table->id();
    $table->foreignId('user_id')->constrained();
});`;
    const result = parseMigration(content, '/migrations/create_orders.php');
    const col = result!.columns.find(c => c.name === 'user_id');
    expect(col).toBeDefined();
    expect(col!.foreignKey).toBeDefined();
    expect(col!.foreignKey!.table).toBe('users');
  });

  it('uses explicit table in constrained()', () => {
    const content = `<?php
Schema::create('orders', function (Blueprint $table) {
    $table->id();
    $table->foreignId('user_id')->constrained('members');
});`;
    const result = parseMigration(content, '/migrations/create_orders.php');
    const col = result!.columns.find(c => c.name === 'user_id');
    expect(col!.foreignKey!.table).toBe('members');
  });

  // Issue #21: multiline modifier chains
  it('handles multiline modifier chains', () => {
    const content = `<?php
Schema::create('posts', function (Blueprint $table) {
    $table->id();
    $table->string('title')
        ->nullable()
        ->unique();
    $table->timestamps();
});`;
    const result = parseMigration(content, '/migrations/create_posts.php');
    expect(result).not.toBeNull();
    const col = result!.columns.find(c => c.name === 'title');
    expect(col).toBeDefined();
    expect(col!.nullable).toBe(true);
    expect(col!.unique).toBe(true);
  });

  it('handles multiline foreignId with constrained on next line', () => {
    const content = `<?php
Schema::create('posts', function (Blueprint $table) {
    $table->id();
    $table->foreignId('user_id')
        ->constrained()
        ->onDelete('cascade');
});`;
    const result = parseMigration(content, '/migrations/create_posts.php');
    const col = result!.columns.find(c => c.name === 'user_id');
    expect(col).toBeDefined();
    expect(col!.foreignKey).toBeDefined();
    expect(col!.foreignKey!.table).toBe('users');
  });

  it('parses softDeletes()', () => {
    const content = `<?php
Schema::create('posts', function (Blueprint $table) {
    $table->id();
    $table->softDeletes();
});`;
    const result = parseMigration(content, '/migrations/create_posts.php');
    const col = result!.columns.find(c => c.name === 'deleted_at');
    expect(col).toBeDefined();
    expect(col!.nullable).toBe(true);
  });

  it('parses rememberToken()', () => {
    const content = `<?php
Schema::create('users', function (Blueprint $table) {
    $table->id();
    $table->rememberToken();
});`;
    const result = parseMigration(content, '/migrations/create_users.php');
    const col = result!.columns.find(c => c.name === 'remember_token');
    expect(col).toBeDefined();
  });

  it('parses $table->foreign() explicit FK declaration', () => {
    const content = `<?php
Schema::create('orders', function (Blueprint $table) {
    $table->id();
    $table->unsignedBigInteger('user_id');
    $table->foreign('user_id')->references('id')->on('users');
});`;
    const result = parseMigration(content, '/migrations/create_orders.php');
    const col = result!.columns.find(c => c.name === 'user_id');
    expect(col).toBeDefined();
    expect(col!.foreignKey).toBeDefined();
    expect(col!.foreignKey!.table).toBe('users');
    expect(col!.foreignKey!.column).toBe('id');
  });

  it('returns null for content without Schema calls', () => {
    const content = `<?php
class SomeHelper {
    public function doStuff() {}
}`;
    const result = parseMigration(content, '/migrations/helper.php');
    expect(result).toBeNull();
  });

  it('records pending foreign keys when the column is not declared in the same file', () => {
    const content = `<?php
Schema::table('orders', function (Blueprint $table) {
    $table->foreign('user_id')->references('id')->on('users');
});`;
    const result = parseMigration(content, '/migrations/alter_orders.php');
    expect(result).not.toBeNull();
    expect(result!.columns.find(c => c.name === 'user_id')).toBeUndefined();
    expect(result!.pendingForeignKeys).toEqual([
      { column: 'user_id', references: { table: 'users', column: 'id' } },
    ]);
  });

  it('handles multiline nullable() on generic column', () => {
    const content = `<?php
Schema::create('posts', function (Blueprint $table) {
    $table->id();
    $table->text('body')
        ->nullable();
});`;
    const result = parseMigration(content, '/migrations/create_posts.php');
    const col = result!.columns.find(c => c.name === 'body');
    expect(col).toBeDefined();
    expect(col!.nullable).toBe(true);
    expect(col!.type).toBe('text');
  });
});

// ─────────────────────────────────────────────────────
// parseModel
// ─────────────────────────────────────────────────────
describe('parseModel', () => {
  it('extracts name, table, fillable, guarded, relationships', () => {
    const content = `<?php
class User extends Model {
    protected $fillable = ['name', 'email'];
    protected $guarded = ['id'];

    public function posts()
    {
        return $this->hasMany(Post::class);
    }
}`;
    const result = parseModel(content, '/app/Models/User.php');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('User');
    expect(result!.fillable).toEqual(['name', 'email']);
    expect(result!.guarded).toEqual(['id']);
    expect(result!.relationships).toHaveLength(1);
    expect(result!.relationships![0].type).toBe('hasMany');
    expect(result!.relationships![0].relatedModel).toBe('Post');
  });

  it('skips Migration classes', () => {
    const content = `<?php
class CreatePostsTable extends Migration {
    public function up() {}
}`;
    const result = parseModel(content, '/migrations/m.php');
    expect(result).toBeNull();
  });

  it('extracts custom table name', () => {
    const content = `<?php
class User extends Model {
    protected $table = 'my_users';
}`;
    const result = parseModel(content, '/app/Models/User.php');
    expect(result!.tableName).toBe('my_users');
  });

  it('extracts multiple relationship types', () => {
    const content = `<?php
class User extends Model {
    public function posts()
    {
        return $this->hasMany(Post::class);
    }

    public function profile()
    {
        return $this->hasOne(Profile::class);
    }

    public function roles()
    {
        return $this->belongsToMany(Role::class);
    }
}`;
    const result = parseModel(content, '/app/Models/User.php');
    expect(result!.relationships).toHaveLength(3);
    expect(result!.relationships!.map(r => r.type)).toEqual(['hasMany', 'hasOne', 'belongsToMany']);
  });

  it('test_parseModel_fullyQualifiedRelationshipClass_extractsBaseModelName', () => {
    const content = `<?php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Post extends Model {
    public function author()
    {
        return $this->belongsTo(\\App\\Models\\User::class);
    }
}`;
    const result = parseModel(content, '/app/Models/Post.php');
    expect(result).not.toBeNull();
    expect(result!.relationships).toEqual([
      { name: 'author', type: 'belongsTo', relatedModel: 'User' },
    ]);
  });

  it('test_parseModel_morphToWithoutClass_recordsPolymorphicRelationship', () => {
    const content = `<?php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Comment extends Model {
    public function commentable()
    {
        return $this->morphTo();
    }
}`;
    const result = parseModel(content, '/app/Models/Comment.php');
    expect(result).not.toBeNull();
    expect(result!.relationships).toEqual([
      { name: 'commentable', type: 'morphTo', relatedModel: 'commentable' },
    ]);
  });

  it('returns null for files without class extending Model', () => {
    const content = `<?php
function helper() { return 'hi'; }`;
    const result = parseModel(content, '/app/helpers.php');
    expect(result).toBeNull();
  });

  it('skips controller classes', () => {
    const content = `<?php
namespace App\Http\Controllers;

class UserController extends Controller {
    public function index() {}
}`;
    const result = parseModel(content, '/app/Http/Controllers/UserController.php');
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────
// parseProject
// ─────────────────────────────────────────────────────
describe('parseProject', () => {
  it('test_parseProject_mergesAlterMigrations_addsColumnsToExistingEntity', async () => {
    const workspace = makeTempDir('laravel-erd-parser-');
    tempDirs.push(workspace);

    writeFile(path.join(workspace, 'database', 'migrations', '2024_01_01_000000_create_posts.php'), `<?php
Schema::create('posts', function (Blueprint $table) {
    $table->id();
    $table->string('title');
});`);
    writeFile(path.join(workspace, 'database', 'migrations', '2024_01_02_000000_add_excerpt_to_posts.php'), `<?php
Schema::table('posts', function (Blueprint $table) {
    $table->text('excerpt')->nullable();
});`);

    const schema = await parseProject(workspace);

    const post = schema.entities.find(entity => entity.tableName === 'posts');
    expect(post).toBeDefined();
    expect(post!.columns.map(column => column.name)).toEqual(['id', 'title', 'excerpt']);
    expect(post!.columns.find(column => column.name === 'excerpt')!.nullable).toBe(true);
  });

  it('test_parseProject_scansModelDirectories_deduplicatesNestedModels', async () => {
    const workspace = makeTempDir('laravel-erd-parser-');
    tempDirs.push(workspace);

    writeFile(path.join(workspace, 'app', 'Models', 'User.php'), `<?php
class User extends Model {
    protected $fillable = ['name'];
}`);
    writeFile(path.join(workspace, 'app', 'Admin', 'Invoice.php'), `<?php
class Invoice extends Model {
    protected $fillable = ['total'];
}`);

    const schema = await parseProject(workspace);

    expect(schema.entities.filter(entity => entity.name === 'User')).toHaveLength(1);
    expect(schema.entities.map(entity => entity.name).sort()).toEqual(['Invoice', 'User']);
  });

  // Bug fix: standalone `$table->foreign(...)` in an alter migration whose
  // column was defined in another migration must still produce a FK.
  it('merges foreign() declarations from later alter migrations onto existing columns', async () => {
    const workspace = makeTempDir('laravel-erd-parser-');
    tempDirs.push(workspace);

    writeFile(path.join(workspace, 'database', 'migrations', '2024_01_01_000000_create_users.php'), `<?php
Schema::create('users', function (Blueprint $table) {
    $table->id();
});`);
    writeFile(path.join(workspace, 'database', 'migrations', '2024_01_02_000000_create_orders.php'), `<?php
Schema::create('orders', function (Blueprint $table) {
    $table->id();
    $table->unsignedBigInteger('user_id');
});`);
    writeFile(path.join(workspace, 'database', 'migrations', '2024_01_03_000000_add_fk_to_orders.php'), `<?php
Schema::table('orders', function (Blueprint $table) {
    $table->foreign('user_id')->references('id')->on('users');
});`);

    const schema = await parseProject(workspace);
    const orders = schema.entities.find(e => e.tableName === 'orders')!;
    const userIdCol = orders.columns.find(c => c.name === 'user_id')!;
    expect(userIdCol.foreignKey).toEqual({ table: 'users', column: 'id' });
    // Pending list should be drained after merging.
    expect(orders.pendingForeignKeys).toBeUndefined();
  });

  // Perf fix: collectPhpFiles must still pick up deeply nested model files
  // after switching from per-entry fs.stat to Dirent-based recursion.
  it('discovers models in deeply nested model directories', async () => {
    const workspace = makeTempDir('laravel-erd-parser-');
    tempDirs.push(workspace);

    writeFile(path.join(workspace, 'app', 'Models', 'Billing', 'Subscription', 'Plan.php'), `<?php
class Plan extends Model {
    protected $fillable = ['name'];
}`);

    const schema = await parseProject(workspace);
    expect(schema.entities.find(e => e.name === 'Plan')).toBeDefined();
  });

  it('does not include controllers from app fallback scanning', async () => {
    const workspace = makeTempDir('laravel-erd-parser-');
    tempDirs.push(workspace);

    writeFile(path.join(workspace, 'app', 'Models', 'User.php'), `<?php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class User extends Model {
    protected $fillable = ['name'];
}`);
    writeFile(path.join(workspace, 'app', 'Http', 'Controllers', 'UserController.php'), `<?php
namespace App\Http\Controllers;

class UserController extends Controller {
    public function index() {}
}`);

    const schema = await parseProject(workspace);

    expect(schema.entities.map(entity => entity.name)).toEqual(['User']);
  });

  it('test_parseProject_singleMigrationWithMultipleSchemaBlocks_createsSeparateEntities', async () => {
    const workspace = makeTempDir('laravel-erd-parser-');
    tempDirs.push(workspace);

    writeFile(path.join(workspace, 'database', 'migrations', '2024_01_01_000000_create_users_and_posts.php'), `<?php
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

Schema::create('users', function (Blueprint $table) {
    $table->id();
    $table->string('name');
});

Schema::create('posts', function (Blueprint $table) {
    $table->id();
    $table->string('title');
});`);

    const schema = await parseProject(workspace);
    const users = schema.entities.find(entity => entity.tableName === 'users');
    const posts = schema.entities.find(entity => entity.tableName === 'posts');

    expect(users).toBeDefined();
    expect(posts).toBeDefined();
    expect(users!.columns.map(column => column.name)).toEqual(['id', 'name']);
    expect(posts!.columns.map(column => column.name)).toEqual(['id', 'title']);
  });
});
