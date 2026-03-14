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
}

export interface Schema {
  entities: Entity[];
}
