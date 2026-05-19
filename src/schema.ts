export interface ForeignKey {
  table: string;
  column: string;
}

export interface Column {
  name: string;
  type: string;
  nullable: boolean;
  default?: string;
  primaryKey: boolean;
  unique: boolean;
  autoIncrement: boolean;
  unsigned: boolean;
  foreignKey?: ForeignKey;
}

export type RelationshipType =
  | 'belongsTo'
  | 'hasMany'
  | 'hasOne'
  | 'belongsToMany'
  | 'morphMany'
  | 'morphTo'
  | 'hasOneThrough'
  | 'hasManyThrough';

export interface Relationship {
  name: string;
  type: RelationshipType;
  relatedModel: string;
  foreignKey?: string;
}

export interface Entity {
  name: string;
  tableName: string;
  columns: Column[];
  fillable: string[];
  guarded: string[];
  relationships: Relationship[];
  migrationFile?: string;
  modelFile?: string;
  /**
   * Foreign keys declared via `$table->foreign(...)->references(...)->on(...)`
   * for which the column was not present in the same migration file.
   * `parseProject` applies these to existing columns after all migrations
   * have been parsed.
   */
  pendingForeignKeys?: PendingForeignKey[];
}

export interface PendingForeignKey {
  column: string;
  references: ForeignKey;
}

export interface Schema {
  entities: Entity[];
}
