import { describe, it, expect, vi } from 'vitest';
import { classToTable, parseMigration, parseModel } from './parser';

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

  it('returns null for files without class extending Model', () => {
    const content = `<?php
function helper() { return 'hi'; }`;
    const result = parseModel(content, '/app/helpers.php');
    expect(result).toBeNull();
  });
});
