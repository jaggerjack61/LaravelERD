// Laravel ERD webview. Loaded by ErdPanel.getHtml() with a CSP nonce.
(function () {
'use strict';

const vscode = acquireVsCodeApi();

// ─────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────
const CARD_W = 320;
const SVG_NS = 'http://www.w3.org/2000/svg';
const DRAG_THRESHOLD = 4;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2.5;
const HUES = [214, 258, 328, 6, 26, 44, 148, 170, 192, 234, 288, 96];
const COLUMN_TYPES = [
  'varchar', 'char', 'text', 'mediumtext', 'longtext',
  'int', 'bigint', 'smallint', 'tinyint', 'int unsigned', 'bigint unsigned',
  'boolean', 'float', 'double', 'decimal',
  'date', 'datetime', 'timestamp', 'time', 'year',
  'json', 'jsonb', 'uuid', 'ulid', 'enum', 'binary',
];
const NEW_REL_TYPES = ['hasMany', 'hasOne', 'belongsTo', 'belongsToMany'];
const HIDDEN_MODEL_FIELDS = ['id', 'created_at', 'updated_at', 'deleted_at'];
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const ICONS = {
  key: '<circle cx="5.5" cy="10.5" r="3"/><path d="M7.7 8.3L13 3M11 5l1.6 1.6M12.4 3.6l1.3 1.3"/>',
  link: '<path d="M6.5 9.5l3-3"/><path d="M7.2 4.6l1-1a2.8 2.8 0 014 4l-1 1"/><path d="M8.8 11.4l-1 1a2.8 2.8 0 01-4-4l1-1"/>',
  pencil: '<path d="M10.8 2.7l2.5 2.5L6 12.5l-3.2.7.7-3.2z"/>',
  model: '<path d="M4 1.8h5l3 3v9.4H4z"/><path d="M9 1.8v3h3M6 8.5h4M6 11h4"/>',
  migration: '<ellipse cx="8" cy="3.8" rx="5" ry="2"/><path d="M3 3.8v8.4c0 1.1 2.2 2 5 2s5-.9 5-2V3.8"/><path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2"/>',
  chevron: '<path d="M4 6l4 4 4-4"/>',
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  minus: '<path d="M3.5 8h9"/>',
  x: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>',
  search: '<circle cx="7" cy="7" r="4.3"/><path d="M10.3 10.3L13.5 13.5"/>',
  save: '<path d="M3 2.5h7.5L13 5v8.5H3z"/><path d="M5.5 2.5v3h4v-3M5.5 13.5V9.5h5v4"/>',
  refresh: '<path d="M13 8a5 5 0 11-1.5-3.6"/><path d="M13 2.5v3h-3"/>',
  export: '<path d="M8 2v8M5 7l3 3 3-3"/><path d="M3 11.5V13.5h10v-2"/>',
  arrange: '<rect x="2" y="2" width="5" height="4" rx="1"/><rect x="9" y="2" width="5" height="4" rx="1"/><rect x="9" y="10" width="5" height="4" rx="1"/><path d="M4.5 6v6H9M11.5 6v4"/>',
  fit: '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>',
  help: '<circle cx="8" cy="8" r="6"/><path d="M6.3 6.2a1.8 1.8 0 113 1.4c-.7.5-1.3.9-1.3 1.7"/><path d="M8 11.5v.1"/>',
  map: '<path d="M2 4l4-1.5 4 1.5 4-1.5v9.5L10 13.5 6 12 2 13.5z"/><path d="M6 2.5V12M10 4v9.5"/>',
  table: '<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M2 6.5h12M6 6.5v7"/>',
  alert: '<path d="M8 2l6.5 11.5h-13z"/><path d="M8 6.5v3M8 11.5v.1"/>',
  arrow: '<path d="M3 8h10M9.5 4.5L13 8l-3.5 3.5"/>',
  logo: '<rect x="1.5" y="2" width="5.5" height="4.5" rx="1.2"/><rect x="9" y="2" width="5.5" height="4.5" rx="1.2"/><rect x="5.25" y="10" width="5.5" height="4.5" rx="1.2"/><path d="M4.25 6.5V8.3H8M11.75 6.5V8.3H8M8 8.3V10"/>',
};

// ─────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────
let schema = { entities: [] };
let baseline = new Map();    // entityName -> { columns:Set, fillable:Set, relationships:Set }
let positions = {};          // { name: { x, y } }
let activeTabs = {};         // { name: 'migration' | 'model' }
let collapsed = {};          // { name: true }
let editingCol = null;       // { entityName, colIndex, isNew } | null
let selected = null;         // selected entity name
let hovered = null;          // hovered entity name
let hoveredEdge = null;      // { src, tgt } | null
let hotColumn = null;        // { entityName, colName } — FK row under the cursor
let zoom = 1;
let panX = 0, panY = 0;
let drag = null;             // { type:'pending'|'card'|'pan'|'link'|'minimap', ... }
let relFilter = 'both';      // 'both' | 'fk' | 'eloquent'
let renderRelsFrame = null;
let minimapFrame = null;
let dragCleanup = null;
let didAutoFit = false;
let hasLoaded = false;
let refreshRequested = false;
let savedLayout = null;
let layoutSaveTimer = null;
let cameraAnim = null;
let spaceDown = false;
let zTop = 20;
let zOrder = {};
let geom = {};               // measured card geometry, see measureCard()
let lastEdges = [];
let searchResults = [];
let searchIndex = 0;
let popoverState = null;

const wrap = document.getElementById('canvas-wrap');
const canvasEl = document.getElementById('canvas');
const relSvgEl = document.getElementById('rel-svg');
const tooltip = document.getElementById('rel-tooltip');

hydrateIcons(document);

// ─────────────────────────────────────────────────
// MESSAGE HANDLING
// ─────────────────────────────────────────────────
window.addEventListener('message', ev => {
  const msg = ev.data;
  switch (msg.type) {
    case 'layout':
      savedLayout = msg.data || null;
      break;
    case 'schema':
      setTheme(msg.isDark);
      if (hasLoaded && !refreshRequested && countChanges() > 0) {
        // Files changed on disk while the user has unsaved edits: don't clobber them silently.
        const incoming = msg.data;
        showToast('Project files changed on disk.', {
          id: 'external-change',
          sticky: true,
          actions: [
            { label: 'Keep my edits' },
            { label: 'Reload', primary: true, onClick: () => applySchema(incoming) },
          ],
        });
        return;
      }
      applySchema(msg.data);
      break;
    case 'theme':
      setTheme(msg.isDark);
      renderRels();
      scheduleMinimap();
      break;
    case 'saved':
      setSaving(false);
      if (msg.ok) {
        snapshotBaseline();
        render();
      }
      break;
    case 'error':
      setRefreshing(false);
      if (hasLoaded) {
        showToast(msg.message || 'Could not parse the project.', { kind: 'error' });
      } else {
        showState('error', msg.message);
      }
      break;
  }
});

window.addEventListener('load', () => vscode.postMessage({ type: 'ready' }));

function setTheme(isDark) {
  document.body.classList.toggle('light', isDark === false);
}

function applySchema(nextSchema) {
  dismissToast('external-change');
  setRefreshing(false);
  const firstLoad = !hasLoaded;
  if (firstLoad && savedLayout) {
    positions = Object.assign({}, savedLayout.positions || {});
    collapsed = Object.assign({}, savedLayout.collapsed || {});
    activeTabs = Object.assign({}, savedLayout.activeTabs || {});
  }
  migratePositionsForSchema(nextSchema);
  schema = nextSchema;
  hasLoaded = true;
  refreshRequested = false;
  editingCol = null;
  if (selected && !findEntity(selected)) selected = null;
  snapshotBaseline();
  autoLayout();
  render();
  showState(schema.entities.length ? null : 'empty');

  // Issue #24: Call fitToScreen after schema is loaded.
  if (!didAutoFit && schema.entities.length) {
    const vp = firstLoad && savedLayout && savedLayout.viewport;
    if (vp && isFinite(vp.zoom) && isFinite(vp.panX) && isFinite(vp.panY)) {
      zoom = clamp(vp.zoom, MIN_ZOOM, MAX_ZOOM); panX = vp.panX; panY = vp.panY;
      applyTransform();
    } else {
      fitToScreen(false);
    }
    didAutoFit = true;
  }
}

function migratePositionsForSchema(nextSchema) {
  // Issue #19: Migrate positions when entity names change.
  const currentByTable = new Map(schema.entities.map(entity => [entity.tableName, entity.name]));
  const nextPositions = {};

  nextSchema.entities.forEach(entity => {
    if (positions[entity.name]) {
      nextPositions[entity.name] = positions[entity.name];
      return;
    }

    const previousName = currentByTable.get(entity.tableName);
    if (previousName && positions[previousName]) {
      nextPositions[entity.name] = positions[previousName];
    }
  });

  positions = nextPositions;
}

// ─────────────────────────────────────────────────
// CHANGE TRACKING
// ─────────────────────────────────────────────────
function snapshotBaseline() {
  baseline = new Map(schema.entities.map(e => [e.name, {
    columns: new Set(e.columns.map(c => c.name)),
    fillable: new Set(e.fillable),
    relationships: new Set(e.relationships.map(r => r.name)),
  }]));
  updateDirtyUi();
}

function isNewColumn(entity, col) {
  const base = baseline.get(entity.name);
  return !base || !base.columns.has(col.name);
}
function isNewRelationship(entity, rel) {
  const base = baseline.get(entity.name);
  return !base || !base.relationships.has(rel.name);
}
function isFillableChanged(entity, field) {
  const base = baseline.get(entity.name);
  return !!base && base.fillable.has(field) !== entity.fillable.includes(field);
}

function entityChanges(entity) {
  let n = 0;
  entity.columns.forEach(c => { if (isNewColumn(entity, c)) n++; });
  entity.relationships.forEach(r => { if (isNewRelationship(entity, r)) n++; });
  const fields = new Set([...entity.fillable, ...(baseline.get(entity.name) || { fillable: [] }).fillable]);
  fields.forEach(f => { if (isFillableChanged(entity, f)) n++; });
  return n;
}

function countChanges() {
  return schema.entities.reduce((sum, e) => sum + entityChanges(e), 0);
}

function updateDirtyUi() {
  const n = countChanges();
  const btn = document.getElementById('btn-save');
  btn.classList.toggle('is-clean', n === 0);
  document.getElementById('dirty-count').textContent = String(n);
  btn.title = n === 0 ? 'Save (no unsaved changes)  ⌘S' : n + ' unsaved change' + (n === 1 ? '' : 's') + '  ⌘S';
}

// ─────────────────────────────────────────────────
// AUTO LAYOUT — layered by foreign keys
// ─────────────────────────────────────────────────
function autoLayout() {
  const missing = schema.entities.filter(e => !positions[e.name]);
  if (!missing.length) return;

  if (missing.length === schema.entities.length) {
    Object.assign(positions, computeLayout());
    return;
  }

  // Place newly discovered tables in a column to the right of the existing diagram.
  let maxR = 0, minY = Infinity;
  schema.entities.forEach(e => {
    const p = positions[e.name];
    if (p) { maxR = Math.max(maxR, p.x + CARD_W); minY = Math.min(minY, p.y); }
  });
  let y = isFinite(minY) ? minY : 60;
  missing.forEach(e => {
    positions[e.name] = { x: maxR + 120, y };
    y += cardHeight(e.name) + 48;
  });
}

function computeLayout() {
  const GAP_X = 120, GAP_Y = 48, ORIGIN = 60;
  const ents = schema.entities;
  const byTable = new Map(ents.map(e => [e.tableName, e.name]));
  const parents = new Map(ents.map(e => [e.name, new Set()]));
  const degree = new Map(ents.map(e => [e.name, 0]));

  ents.forEach(e => e.columns.forEach(c => {
    if (!c.foreignKey) return;
    const target = byTable.get(c.foreignKey.table);
    if (!target || target === e.name) return;
    parents.get(e.name).add(target);
    degree.set(e.name, degree.get(e.name) + 1);
    degree.set(target, degree.get(target) + 1);
  }));
  const byName = new Map(ents.map(e => [e.name, e]));
  ents.forEach(e => e.relationships.forEach(r => {
    if (byName.has(r.relatedModel) && r.relatedModel !== e.name) {
      degree.set(e.name, degree.get(e.name) + 1);
      degree.set(r.relatedModel, degree.get(r.relatedModel) + 1);
    }
  }));

  // Longest-path layering: referenced tables sit left of the tables that reference them.
  const level = new Map(ents.map(e => [e.name, 0]));
  for (let pass = 0; pass < ents.length; pass++) {
    let changed = false;
    ents.forEach(e => parents.get(e.name).forEach(p => {
      const next = Math.min(level.get(p) + 1, ents.length);
      if (next > level.get(e.name)) { level.set(e.name, next); changed = true; }
    }));
    if (!changed) break;
  }

  const connected = ents.filter(e => degree.get(e.name) > 0);
  const isolated = ents.filter(e => degree.get(e.name) === 0);
  const layers = [];
  connected.forEach(e => {
    const l = level.get(e.name);
    (layers[l] = layers[l] || []).push(e.name);
  });

  const totalArea = ents.reduce((s, e) => s + (CARD_W + GAP_X) * (cardHeight(e.name) + GAP_Y), 0);
  const aspect = Math.max(0.5, (wrap.clientHeight || 800) / (wrap.clientWidth || 1200));
  const maxColH = Math.max(900, Math.sqrt(totalArea * aspect) * 1.1);

  const result = {};
  const order = new Map();
  let x = ORIGIN;
  layers.filter(Boolean).forEach(layer => {
    // Barycenter ordering keeps children near their parents and reduces crossings.
    layer.sort((a, b) => bary(a) - bary(b) || degree.get(b) - degree.get(a) || a.localeCompare(b));
    let y = ORIGIN, colUsed = false;
    layer.forEach(name => {
      const h = cardHeight(name);
      if (colUsed && y + h > ORIGIN + maxColH) { x += CARD_W + GAP_X; y = ORIGIN; }
      result[name] = { x, y };
      order.set(name, y);
      y += h + GAP_Y;
      colUsed = true;
    });
    x += CARD_W + GAP_X;
  });

  function bary(name) {
    const ps = Array.from(parents.get(name)).filter(p => order.has(p));
    if (!ps.length) return Number.MAX_SAFE_INTEGER / 2;
    return ps.reduce((s, p) => s + order.get(p), 0) / ps.length;
  }

  if (isolated.length) {
    // Unconnected tables go into a tidy grid to the right.
    isolated.sort((a, b) => a.name.localeCompare(b.name));
    const cols = Math.max(1, Math.round(Math.sqrt(isolated.length / Math.max(aspect, 0.5))));
    const startX = connected.length ? x + 40 : ORIGIN;
    const colY = new Array(cols).fill(ORIGIN);
    isolated.forEach((e, i) => {
      const c = i % cols;
      result[e.name] = { x: startX + c * (CARD_W + 60), y: colY[c] };
      colY[c] += cardHeight(e.name) + GAP_Y;
    });
  }
  return result;
}

function arrange() {
  if (!schema.entities.length) return;
  const target = computeLayout();
  const from = {};
  schema.entities.forEach(e => { from[e.name] = positions[e.name] || target[e.name]; });
  const start = performance.now();
  const DURATION = 420;
  function step(now) {
    const t = Math.min(1, (now - start) / DURATION);
    const k = easeOutCubic(t);
    schema.entities.forEach(e => {
      const a = from[e.name], b = target[e.name];
      positions[e.name] = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      placeCard(e.name);
    });
    renderRels();
    if (t < 1) requestAnimationFrame(step);
    else {
      syncCanvasBounds();
      fitToScreen(true);
      saveLayoutSoon();
    }
  }
  requestAnimationFrame(step);
}

function syncCanvasBounds() {
  if (!schema.entities.length) {
    canvasEl.style.width = '100%';
    canvasEl.style.height = '100%';
    relSvgEl.style.width = '100%';
    relSvgEl.style.height = '100%';
    return;
  }

  const PAD = 160;
  let maxX = 0;
  let maxY = 0;

  schema.entities.forEach(entity => {
    const pos = positions[entity.name] || { x: 0, y: 0 };
    maxX = Math.max(maxX, pos.x + CARD_W);
    maxY = Math.max(maxY, pos.y + cardHeight(entity.name));
  });

  const width = maxX + PAD;
  const height = maxY + PAD;

  canvasEl.style.width = width + 'px';
  canvasEl.style.height = height + 'px';
  relSvgEl.style.width = width + 'px';
  relSvgEl.style.height = height + 'px';
}

// ─────────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────────
function render() {
  renderCards();
  syncCanvasBounds();
  renderRels();
  updateStatus();
  updateDirtyUi();
  scheduleMinimap();
}

function renderCards() {
  const existingCards = new Map(
    Array.from(canvasEl.querySelectorAll('.entity-card')).map(card => [card.dataset.entity, card])
  );
  const activeEntityNames = new Set(schema.entities.map(entity => entity.name));

  existingCards.forEach((card, entityName) => {
    if (!activeEntityNames.has(entityName)) {
      card.remove();
      delete geom[entityName];
    }
  });

  let focusTarget = null;
  schema.entities.forEach(entity => {
    const pos = positions[entity.name] || { x: 0, y: 0 };
    const signature = cardSignature(entity);
    const existingCard = existingCards.get(entity.name);

    if (existingCard && existingCard.dataset.signature === signature) {
      existingCard.style.left = pos.x + 'px';
      existingCard.style.top = pos.y + 'px';
      return;
    }

    const newCard = buildCard(entity, pos);
    newCard.dataset.signature = signature;
    if (existingCard) {
      const scroller = existingCard.querySelector('.col-list, .model-body');
      const scrollTop = scroller ? scroller.scrollTop : 0;
      canvasEl.replaceChild(newCard, existingCard);
      const nextScroller = newCard.querySelector('.col-list, .model-body');
      if (nextScroller) nextScroller.scrollTop = scrollTop;
    } else {
      canvasEl.insertBefore(newCard, relSvgEl);
    }
    measureCard(entity.name, newCard);
    if (editingCol && editingCol.entityName === entity.name) focusTarget = newCard;
  });

  if (focusTarget) {
    const input = focusTarget.querySelector('.edit-row input[type="text"]');
    const row = focusTarget.querySelector('.edit-row');
    if (row) row.scrollIntoView({ block: 'nearest' });
    if (input) { input.focus(); input.select(); }
  }
  applyHighlight();
}

function cardSignature(entity) {
  return JSON.stringify({
    entity,
    tab: activeTabs[entity.name] || 'migration',
    collapsed: !!collapsed[entity.name],
    editing: editingCol && editingCol.entityName === entity.name ? editingCol : null,
    changes: entityChanges(entity),
  });
}

function placeCard(name) {
  const card = cardEl(name);
  const p = positions[name];
  if (card && p) { card.style.left = p.x + 'px'; card.style.top = p.y + 'px'; }
}

function buildCard(entity, pos) {
  const tab = activeTabs[entity.name] || 'migration';
  const isCollapsed = !!collapsed[entity.name];
  const card = el('div', 'entity-card' + (isCollapsed ? ' collapsed' : ''));
  card.dataset.entity = entity.name;
  card.style.left = pos.x + 'px';
  card.style.top  = pos.y + 'px';
  card.style.setProperty('--hue', String(hueFor(entity.name)));
  if (zOrder[entity.name]) card.style.zIndex = String(zOrder[entity.name]);

  // ── HEADER ──
  const hdr = el('div', 'card-header');
  const ic = el('div', 'entity-icon'); ic.textContent = initials(entity.name); hdr.appendChild(ic);

  const title = el('div', 'card-title');
  const nm = el('div', 'card-name');
  const nmText = el('span'); nmText.textContent = entity.name; nm.appendChild(nmText);
  if (entityChanges(entity) > 0) {
    const dot = el('span', 'unsaved-dot'); dot.title = 'Unsaved changes'; nm.appendChild(dot);
  }
  title.appendChild(nm);
  const tbl = el('div', 'card-table');
  tbl.textContent = entity.tableName + (isCollapsed ? ' · ' + entity.columns.length + ' columns' : '');
  title.appendChild(tbl);
  hdr.appendChild(title);

  const btns = el('div', 'card-actions');
  if (entity.modelFile) {
    btns.appendChild(iconBtn('model', 'Open model file', () => vscode.postMessage({ type: 'openFile', path: entity.modelFile })));
  }
  if (entity.migrationFile) {
    btns.appendChild(iconBtn('migration', 'Open migration', () => vscode.postMessage({ type: 'openFile', path: entity.migrationFile })));
  }
  const colBtn = iconBtn('chevron', isCollapsed ? 'Expand' : 'Collapse', () => toggleCollapsed(entity.name));
  colBtn.classList.add('collapse-btn');
  btns.appendChild(colBtn);
  hdr.appendChild(btns);
  hdr.addEventListener('dblclick', e => {
    if (e.target.closest('button')) return;
    toggleCollapsed(entity.name);
  });
  card.appendChild(hdr);

  // ── CONNECTORS (drag to create a relationship) ──
  ['left', 'right'].forEach(side => {
    const c = el('div', 'connector ' + side);
    c.title = 'Drag to another table to add a relationship';
    c.addEventListener('mousedown', e => startLinkDrag(e, entity.name, side));
    card.appendChild(c);
  });

  if (!isCollapsed) {
    // ── TABS ──
    const tabs = el('div', 'card-tabs');
    [['migration', 'Columns', entity.columns.length], ['model', 'Model', entity.relationships.length]].forEach(([t, label, count]) => {
      const tabEl = el('button', 'tab' + (t === tab ? ' active' : ''));
      tabEl.appendChild(document.createTextNode(label));
      const cnt = el('span', 'tab-count'); cnt.textContent = String(count); tabEl.appendChild(cnt);
      if (t === 'model') tabEl.title = 'Mass assignment & relationships';
      tabEl.addEventListener('click', () => {
        if ((activeTabs[entity.name] || 'migration') === t) return;
        activeTabs[entity.name] = t;
        if (editingCol && editingCol.entityName === entity.name) cancelEdit(false);
        render();
        saveLayoutSoon();
      });
      tabs.appendChild(tabEl);
    });
    card.appendChild(tabs);

    // ── CONTENT ──
    const content = el('div', 'card-content');
    if (tab === 'migration') buildMigrationTab(content, entity);
    else buildModelTab(content, entity);
    card.appendChild(content);
  }

  card.addEventListener('mousedown', e => onCardMouseDown(e, entity.name));
  card.addEventListener('mouseenter', () => { hovered = entity.name; applyHighlight(); });
  card.addEventListener('mouseleave', () => { if (hovered === entity.name) { hovered = null; applyHighlight(); } });
  return card;
}

function buildMigrationTab(container, entity) {
  const list = el('div', 'col-list');

  entity.columns.forEach((col, idx) => {
    if (editingCol && editingCol.entityName === entity.name && editingCol.colIndex === idx) {
      list.appendChild(buildEditRow(entity, col, idx));
      return;
    }

    const isNew = isNewColumn(entity, col);
    const row = el('div', 'col-row' + (col.primaryKey ? ' is-pk' : '') + (isNew ? ' is-new' : ''));
    row.dataset.col = col.name;

    const key = el('span', 'col-key' + (col.primaryKey ? ' pk' : col.foreignKey ? ' fk' : ''));
    if (col.primaryKey) { key.appendChild(icon('key', 13)); key.title = 'Primary key'; }
    else if (col.foreignKey) { key.appendChild(icon('link', 13)); key.title = 'Foreign key'; }
    row.appendChild(key);

    const name = el('span', 'col-name'); name.textContent = col.name; row.appendChild(name);

    if (col.foreignKey) {
      const target = findEntityByTable(col.foreignKey.table);
      const chip = el(target ? 'button' : 'span', 'fk-chip');
      chip.textContent = '→ ' + col.foreignKey.table;
      chip.title = 'References ' + col.foreignKey.table + '.' + col.foreignKey.column + (target ? ' — click to jump' : '');
      if (target) chip.addEventListener('click', () => focusEntity(target.name, { select: true }));
      row.appendChild(chip);
      row.addEventListener('mouseenter', () => { hotColumn = { entityName: entity.name, colName: col.name, target: target && target.name }; applyHighlight(); });
      row.addEventListener('mouseleave', () => { hotColumn = null; applyHighlight(); });
    }

    row.appendChild(el('span', 'col-fill'));

    if (col.unique && !col.primaryKey) {
      const u = el('span', 'col-flag'); u.textContent = 'UQ'; u.title = 'Unique'; row.appendChild(u);
    }

    const type = el('span', 'col-type');
    type.textContent = col.type;
    if (col.nullable) {
      const q = el('span', 'nullable'); q.textContent = '?'; type.appendChild(q);
      type.title = col.type + ', nullable';
    }
    row.appendChild(type);

    if (isNew) {
      const edit = rowAction('pencil', 'Edit column', () => startEdit(entity.name, idx, false));
      row.appendChild(edit);
      row.addEventListener('dblclick', () => startEdit(entity.name, idx, false));
    } else if (entity.migrationFile) {
      row.appendChild(rowAction('migration', 'Existing column — open migration to change it', () =>
        vscode.postMessage({ type: 'openFile', path: entity.migrationFile })));
    }
    list.appendChild(row);
  });

  list.addEventListener('scroll', () => { measureCard(entity.name); scheduleRenderRels(); }, { passive: true });
  container.appendChild(list);

  if (!(editingCol && editingCol.entityName === entity.name)) {
    const addBtn = el('button', 'add-btn');
    addBtn.appendChild(icon('plus', 13));
    addBtn.appendChild(document.createTextNode('Add column'));
    addBtn.addEventListener('click', () => addColumn(entity.name));
    container.appendChild(addBtn);
  }
}

function addColumn(entityName) {
  if (editingCol) cancelEdit(false);
  const e = findEntity(entityName);
  if (!e) return;
  let name = 'new_column', i = 2;
  while (e.columns.some(c => c.name === name)) name = 'new_column_' + i++;
  e.columns.push({ name, type: 'varchar', nullable: true, primaryKey: false, unique: false, autoIncrement: false, unsigned: false });
  activeTabs[entityName] = 'migration';
  collapsed[entityName] = false;
  editingCol = { entityName, colIndex: e.columns.length - 1, isNew: true };
  render();
}

function startEdit(entityName, colIndex, isNew) {
  if (editingCol) cancelEdit(false);
  editingCol = { entityName, colIndex, isNew };
  render();
}

function cancelEdit(rerender) {
  if (!editingCol) return;
  if (editingCol.isNew) {
    // Abandoning a freshly added column removes it again.
    const e = findEntity(editingCol.entityName);
    if (e) e.columns.splice(editingCol.colIndex, 1);
  }
  editingCol = null;
  if (rerender !== false) render();
}

function buildEditRow(entity, col, idx) {
  const form = el('form', 'edit-row');
  form.setAttribute('novalidate', '');

  const grid = el('div', 'edit-grid');
  const nameIn = el('input');
  nameIn.type = 'text'; nameIn.value = col.name; nameIn.placeholder = 'column_name';
  nameIn.spellcheck = false; nameIn.setAttribute('aria-label', 'Column name');
  grid.appendChild(nameIn);

  const typeSelect = el('select');
  typeSelect.setAttribute('aria-label', 'Column type');
  const types = COLUMN_TYPES.includes(col.type) ? COLUMN_TYPES : [col.type].concat(COLUMN_TYPES);
  types.forEach(t => {
    const o = document.createElement('option');
    o.value = t; o.textContent = t;
    if (t === col.type) o.selected = true;
    typeSelect.appendChild(o);
  });
  grid.appendChild(typeSelect);
  form.appendChild(grid);

  const err = el('div', 'field-error'); err.style.display = 'none';
  form.appendChild(err);

  const optRow = el('div', 'edit-toggles');
  const nullLbl = el('label', 'check');
  const nullCb = document.createElement('input');
  nullCb.type = 'checkbox';
  nullCb.checked = col.nullable;
  nullLbl.appendChild(nullCb);
  nullLbl.appendChild(document.createTextNode('Nullable'));
  const uniqLbl = el('label', 'check');
  const uniqCb = document.createElement('input');
  uniqCb.type = 'checkbox';
  uniqCb.checked = col.unique;
  uniqLbl.appendChild(uniqCb);
  uniqLbl.appendChild(document.createTextNode('Unique'));
  optRow.appendChild(nullLbl); optRow.appendChild(uniqLbl);
  form.appendChild(optRow);

  const btnRow = el('div', 'edit-actions');
  const delBtn = el('button', 'mini-btn danger');
  delBtn.type = 'button';
  delBtn.appendChild(icon('trash', 13));
  delBtn.appendChild(document.createTextNode('Remove'));
  delBtn.addEventListener('click', () => {
    const e = findEntity(entity.name);
    if (e) e.columns.splice(idx, 1);
    editingCol = null; render();
  });
  btnRow.appendChild(delBtn);
  btnRow.appendChild(el('span', 'spacer'));

  const cancelBtn = el('button', 'mini-btn'); cancelBtn.type = 'button'; cancelBtn.textContent = 'Cancel';
  cancelBtn.title = 'Esc';
  cancelBtn.addEventListener('click', () => cancelEdit());
  btnRow.appendChild(cancelBtn);

  const saveBtn = el('button', 'mini-btn primary'); saveBtn.type = 'submit';
  saveBtn.appendChild(document.createTextNode('Done'));
  const k = el('kbd'); k.textContent = '↵'; saveBtn.appendChild(k);
  btnRow.appendChild(saveBtn);
  form.appendChild(btnRow);

  function validate() {
    const v = nameIn.value.trim();
    let msg = '';
    if (!v) msg = 'Column name is required.';
    else if (!IDENT_RE.test(v)) msg = 'Use letters, numbers and underscores only.';
    else if (entity.columns.some((c, i) => i !== idx && c.name === v)) msg = 'A column named "' + v + '" already exists.';
    nameIn.classList.toggle('invalid', !!msg);
    err.textContent = msg; err.style.display = msg ? 'block' : 'none';
    return !msg;
  }
  nameIn.addEventListener('input', () => { if (nameIn.classList.contains('invalid')) validate(); });

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!validate()) { nameIn.focus(); return; }
    const target = findEntity(entity.name);
    if (target && target.columns[idx]) {
      target.columns[idx].name = nameIn.value.trim();
      target.columns[idx].type = typeSelect.value;
      target.columns[idx].nullable = nullCb.checked;
      target.columns[idx].unique = uniqCb.checked;
    }
    editingCol = null; render();
  });
  form.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); }
  });
  return form;
}

function buildModelTab(container, entity) {
  const body = el('div', 'model-body');
  let hasContent = false;

  // Fields section
  const allFields = [...new Set([...entity.fillable, ...entity.guarded, ...entity.columns.map(c => c.name)])];
  const modelFields = allFields.filter(f => !HIDDEN_MODEL_FIELDS.includes(f));

  if (modelFields.length > 0) {
    body.appendChild(sectionTitle('Mass assignment', 'click to toggle'));
    modelFields.forEach(field => {
      const isFill = entity.fillable.includes(field);
      const row = el('div', 'field-row' + (isFillableChanged(entity, field) ? ' is-changed' : ''));
      const fn = el('span', 'field-name'); fn.textContent = field; row.appendChild(fn);
      const pill = el('button', 'pill ' + (isFill ? 'pill-fill' : 'pill-guard'));
      pill.textContent = isFill ? 'fillable' : 'guarded';
      pill.title = isFill ? 'Mark as guarded' : 'Mark as fillable';
      pill.addEventListener('click', () => {
        const e = findEntity(entity.name);
        if (!e) return;
        if (isFill) {
          e.fillable = e.fillable.filter(f => f !== field);
          if (!e.guarded.includes(field)) e.guarded.push(field);
        } else {
          e.guarded = e.guarded.filter(f => f !== field);
          if (!e.fillable.includes(field)) e.fillable.push(field);
        }
        render();
      });
      row.appendChild(pill);
      body.appendChild(row);
    });
    hasContent = true;
  }

  // Relationships section
  if (entity.relationships.length > 0) {
    body.appendChild(sectionTitle('Relationships'));
    entity.relationships.forEach(rel => {
      const isNew = isNewRelationship(entity, rel);
      const row = el('div', 'rel-row' + (isNew ? ' is-new' : ''));
      const badge = el('span', 'rel-badge'); badge.textContent = rel.type; row.appendChild(badge);
      const nm = el('span', 'rel-name'); nm.textContent = rel.name + '()'; row.appendChild(nm);
      const target = findEntity(rel.relatedModel);
      const tgt = el(target ? 'button' : 'span', 'rel-target');
      tgt.textContent = rel.relatedModel;
      if (target) {
        tgt.title = 'Jump to ' + rel.relatedModel;
        tgt.addEventListener('click', () => focusEntity(target.name, { select: true }));
      }
      row.appendChild(tgt);
      if (isNew) {
        row.appendChild(rowAction('x', 'Remove (not saved yet)', () => {
          const e = findEntity(entity.name);
          if (e) e.relationships = e.relationships.filter(r => r !== rel);
          render();
        }, true));
      }
      body.appendChild(row);
    });
    hasContent = true;
  }

  if (!hasContent) {
    const empty = el('div', 'empty-model'); empty.textContent = 'No model data found.'; body.appendChild(empty);
  }

  body.addEventListener('scroll', () => { measureCard(entity.name); scheduleRenderRels(); }, { passive: true });
  container.appendChild(body);

  if (entity.modelFile && schema.entities.length > 1) {
    const addBtn = el('button', 'add-btn');
    addBtn.appendChild(icon('plus', 13));
    addBtn.appendChild(document.createTextNode('Add relationship'));
    addBtn.addEventListener('click', ev => {
      const r = addBtn.getBoundingClientRect();
      openRelPopover(entity.name, null, r.left, r.bottom + 6);
      ev.stopPropagation();
    });
    container.appendChild(addBtn);
  }
}

function sectionTitle(text, hint) {
  const t = el('div', 'section-title');
  const s = el('span'); s.textContent = text; t.appendChild(s);
  if (hint) { const h = el('span', 'hint'); h.textContent = hint; t.appendChild(h); }
  return t;
}

function toggleCollapsed(name) {
  collapsed[name] = !collapsed[name];
  if (collapsed[name] && editingCol && editingCol.entityName === name) cancelEdit(false);
  render();
  saveLayoutSoon();
}

// ─────────────────────────────────────────────────
// CARD GEOMETRY — measured from the DOM so lines attach to real rows
// ─────────────────────────────────────────────────
function measureCard(name, card) {
  card = card || cardEl(name);
  if (!card) return;
  const header = card.querySelector('.card-header');
  const headerY = header ? header.offsetTop + header.offsetHeight / 2 : 26;
  const rows = {};
  let clipTop = 0, clipBottom = 0;
  const list = card.querySelector('.col-list');
  if (list) {
    clipTop = list.offsetTop;
    clipBottom = list.offsetTop + list.clientHeight;
    list.querySelectorAll('.col-row[data-col]').forEach(row => {
      rows[row.dataset.col] = list.offsetTop + row.offsetTop - list.scrollTop + row.offsetHeight / 2;
    });
  }
  geom[name] = { h: card.offsetHeight, headerY, rows, clipTop, clipBottom };
}

function estimateCardHeight(entityName) {
  const e = findEntity(entityName);
  if (!e) return 220;
  if (collapsed[entityName]) return 56;
  return 96 + Math.min(e.columns.length, 12) * 28 + 44;
}

function cardHeight(name) {
  const g = geom[name];
  return g && g.h ? g.h : estimateCardHeight(name);
}

// Y offset (relative to the card) where a line for `colName` should attach.
function portY(name, colName) {
  const g = geom[name];
  if (!g) return 26;
  if (colName && g.rows[colName] !== undefined) {
    return clamp(g.rows[colName], g.clipTop + 8, g.clipBottom - 8);
  }
  return g.headerY;
}

// ─────────────────────────────────────────────────
// RELATIONSHIP LINES — orthogonal routing + crow's feet
// ─────────────────────────────────────────────────
function computeAllObstacles(heightOf) {
  const P = 18;
  return schema.entities
    .map(e => {
      const p = positions[e.name];
      if (!p) return null;
      const h = heightOf(e.name);
      return {
        name: e.name,
        x: p.x - P, y: p.y - P, r: p.x + CARD_W + P, b: p.y + h + P,
        raw: { x: p.x, y: p.y, r: p.x + CARD_W, b: p.y + h },
      };
    })
    .filter(Boolean);
}

// Obstacle rectangles: padded for unrelated cards, exact for the two being connected
// (so a line may leave its own card's edge but never cut through it).
function getObstacles(excludeA, excludeB, cachedObstacles) {
  return cachedObstacles.map(obstacle =>
    obstacle.name === excludeA || obstacle.name === excludeB ? Object.assign({ name: obstacle.name }, obstacle.raw) : obstacle
  );
}

function vertHitsObs(x, y1, y2, obs) {
  const mn = Math.min(y1, y2), mx = Math.max(y1, y2);
  return obs.some(o => x > o.x && x < o.r && mx > o.y && mn < o.b);
}
function horizHitsObs(y, x1, x2, obs) {
  const mn = Math.min(x1, x2), mx = Math.max(x1, x2);
  return obs.some(o => y > o.y && y < o.b && mx > o.x && mn < o.r);
}

// 3-segment orthogonal router: horiz stub → vert → horiz stub.
// `candidates` are the x positions to try for the vertical segment, in order of preference.
function routeOrtho(sx, sy, ex, ey, obs, candidates) {
  function clear(mx) {
    return !horizHitsObs(sy, sx, mx, obs)
        && !vertHitsObs(mx, sy, ey, obs)
        && !horizHitsObs(ey, mx, ex, obs);
  }

  for (const m of candidates) {
    if (clear(m)) {
      return [{x:sx,y:sy},{x:m,y:sy},{x:m,y:ey},{x:ex,y:ey}];
    }
  }

  // Fallback: route above all blocking entities
  const mnX = Math.min(sx, ex), mxX = Math.max(sx, ex);
  const blocking = obs.filter(o => o.r > mnX && o.x < mxX);
  const topY = blocking.length
    ? Math.min(...blocking.map(o => o.y)) - 45
    : Math.min(sy, ey) - 70;
  const sOut = candidates.length ? candidates[0] : sx;

  return [
    {x:sx, y:sy},
    {x:sOut, y:sy},
    {x:sOut, y:topY},
    {x:ex + (ex >= sOut ? -28 : 28), y:topY},
    {x:ex + (ex >= sOut ? -28 : 28), y:ey},
    {x:ex, y:ey},
  ];
}

// Build SVG path string with rounded corners (radius r) for an orthogonal polyline
function orthoPathD(pts, r) {
  if (pts.length < 2) return '';
  if (pts.length === 2) return 'M' + pts[0].x + ' ' + pts[0].y + ' L' + pts[1].x + ' ' + pts[1].y;
  let d = 'M' + pts[0].x + ' ' + pts[0].y;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i-1], c = pts[i], n = pts[i+1];
    const d1x = c.x-p.x, d1y = c.y-p.y;
    const d2x = n.x-c.x, d2y = n.y-c.y;
    const l1 = Math.sqrt(d1x*d1x+d1y*d1y)||1;
    const l2 = Math.sqrt(d2x*d2x+d2y*d2y)||1;
    const t1 = Math.min(r, l1/2), t2 = Math.min(r, l2/2);
    const px = c.x-(d1x/l1)*t1, py = c.y-(d1y/l1)*t1;
    const qx = c.x+(d2x/l2)*t2, qy = c.y+(d2y/l2)*t2;
    d += ' L' + px + ' ' + py + ' Q' + c.x + ' ' + c.y + ' ' + qx + ' ' + qy;
  }
  d += ' L' + pts[pts.length-1].x + ' ' + pts[pts.length-1].y;
  return d;
}

// Collect every edge allowed by the current filter.
function collectEdges() {
  const edges = [];
  const drawn = new Set();

  // Perf: build lookup maps once per render so target resolution for FKs and
  // Eloquent relationships is O(1) instead of O(N) per edge.
  const entityByTableName = new Map();
  const entityByName = new Map();
  const entityByLowerName = new Map();
  schema.entities.forEach(entity => {
    entityByTableName.set(entity.tableName, entity);
    entityByName.set(entity.name, entity);
    entityByLowerName.set(entity.name.toLowerCase(), entity);
  });

  schema.entities.forEach(entity => {
    if (!positions[entity.name]) return;

    // ── FK column relationships (entity = many, referenced = one) ──
    if (relFilter === 'both' || relFilter === 'fk') {
      entity.columns.forEach(col => {
        if (!col.foreignKey) return;
        const tgt = entityByTableName.get(col.foreignKey.table)
          || entityByLowerName.get(col.foreignKey.table);
        if (!tgt) return;

        const key = 'fk:' + entity.name + ':' + col.name;
        if (drawn.has(key)) return;
        drawn.add(key);

        edges.push({
          kind: 'fk', src: entity.name, tgt: tgt.name,
          srcCol: col.name, tgtCol: col.foreignKey.column,
          srcCard: 'many', tgtCard: col.nullable ? 'zero-one' : 'one',
          label: entity.tableName + '.' + col.name + ' → ' + col.foreignKey.table + '.' + col.foreignKey.column,
          relType: col.nullable ? 'nullable foreign key' : 'foreign key',
        });
      });
    }

    // ── Eloquent model relationships ──
    if (relFilter === 'both' || relFilter === 'eloquent') {
      entity.relationships.forEach(rel => {
        const tgt = entityByName.get(rel.relatedModel)
          || entityByTableName.get(rel.relatedModel.toLowerCase() + 's');
        if (!tgt) return;

        const key = 'rel:' + entity.name + ':' + rel.name;
        if (drawn.has(key)) return;
        drawn.add(key);

        // Source card = entity, determine cardinality from relationship type
        const srcCard =
          rel.type === 'belongsToMany' ? 'many' :
          ['hasMany','morphMany','hasManyThrough','hasOne','hasOneThrough'].includes(rel.type) ? 'one' :
          ['belongsTo','morphTo'].includes(rel.type) ? 'many' : 'many';
        const tgtCard =
          rel.type === 'belongsToMany' ? 'many' :
          ['hasMany','morphMany','hasManyThrough'].includes(rel.type) ? 'many' :
          ['hasOne','hasOneThrough'].includes(rel.type) ? 'one' :
          ['belongsTo','morphTo'].includes(rel.type) ? 'one' : 'many';

        edges.push({
          kind: 'eloquent', src: entity.name, tgt: tgt.name,
          srcCol: null, tgtCol: null, srcCard, tgtCard,
          label: entity.name + '::' + rel.name + '()', relType: rel.type,
        });
      });
    }
  });
  return edges;
}

// Turn edges into drawable shapes. `geo` supplies card geometry (live DOM or export layout).
function layoutEdges(edges, geo) {
  const cachedObstacles = computeAllObstacles(geo.height);
  return edges.map(edge => {
    const fp = positions[edge.src], tp = positions[edge.tgt];
    if (!fp || !tp) return null;
    const sy = fp.y + geo.port(edge.src, edge.srcCol);
    const ey = tp.y + geo.port(edge.tgt, edge.tgtCol);

    let sx, ex, srcDir, tgtDir, pts;
    if (edge.src === edge.tgt) {
      // Self-reference: loop out of the right edge and back in.
      sx = ex = fp.x + CARD_W; srcDir = tgtDir = 1;
      const loopX = sx + 34;
      const yb = Math.abs(ey - sy) < 16 ? ey + 16 : ey;
      pts = [{x:sx,y:sy},{x:loopX,y:sy},{x:loopX,y:yb},{x:ex,y:yb}];
      return finishShape(edge, pts, sx, sy, ex, yb, srcDir, tgtDir);
    }

    const obs = getObstacles(edge.src, edge.tgt, cachedObstacles);
    const GAP = 56;
    const aR = fp.x + CARD_W, bR = tp.x + CARD_W;
    let candidates;
    if (tp.x >= aR + GAP) {
      sx = aR; ex = tp.x; srcDir = 1; tgtDir = -1;
      candidates = spread((sx + ex) / 2, sx + 28, ex - 28);
    } else if (fp.x >= bR + GAP) {
      sx = fp.x; ex = bR; srcDir = -1; tgtDir = 1;
      candidates = spread((sx + ex) / 2, ex + 28, sx - 28);
    } else {
      // Cards overlap horizontally: connect on their right edges and loop around.
      sx = aR; ex = bR; srcDir = tgtDir = 1;
      const base = Math.max(sx, ex) + 36;
      candidates = [base, base + 40, base + 80, base + 140, base + 220];
    }
    pts = routeOrtho(sx, sy, ex, ey, obs, candidates);
    return finishShape(edge, pts, sx, sy, ex, ey, srcDir, tgtDir);
  }).filter(Boolean);
}

function spread(mid, lo, hi) {
  const out = [mid];
  [40, 80, 120, 160, 240, 320, 400].forEach(d => { out.push(mid + d, mid - d); });
  return out.filter(x => x >= Math.min(lo, hi) && x <= Math.max(lo, hi));
}

function finishShape(edge, pts, sx, sy, ex, ey, srcDir, tgtDir) {
  return { edge, d: orthoPathD(pts, 10), sx, sy, ex, ey, srcDir, tgtDir };
}

function svgEl(tag, attrs, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.keys(attrs).forEach(k => node.setAttribute(k, String(attrs[k])));
  if (parent) parent.appendChild(node);
  return node;
}

// Draw a cardinality marker at connection point (x, y).
// dir: +1 = marker extends rightward (away from a right card edge), -1 = leftward.
function drawCardinality(parent, x, y, dir, type, color, bg) {
  const S = 6;
  const line = (x1, y1, x2, y2) => svgEl('line', { x1, y1, x2, y2, stroke: color, 'stroke-width': 1.6, 'stroke-linecap': 'round' }, parent);
  if (type === 'many') {
    // Crow's foot fanning into the card, plus a bar.
    const nx = x + dir * 12;
    line(nx, y, x, y - S);
    line(nx, y, x, y + S);
    line(nx, y, x, y);
    line(nx + dir * 4, y - S, nx + dir * 4, y + S);
  } else if (type === 'zero-one') {
    line(x + dir * 7, y - S, x + dir * 7, y + S);
    svgEl('circle', { cx: x + dir * 16, cy: y, r: 3.6, fill: bg, stroke: color, 'stroke-width': 1.6 }, parent);
  } else {
    line(x + dir * 7, y - S, x + dir * 7, y + S);
    line(x + dir * 12, y - S, x + dir * 12, y + S);
  }
}

function drawShape(svg, shape, colors) {
  const edge = shape.edge;
  const color = edge.kind === 'fk' ? colors.fk : colors.eloquent;
  const g = svgEl('g', { class: 'rel-group' }, svg);
  g.dataset.src = edge.src;
  g.dataset.tgt = edge.tgt;
  g.dataset.relType = edge.relType;
  g.dataset.relKind = edge.kind;
  g.dataset.label = edge.label;

  // Invisible wider hit-area for easier hovering
  svgEl('path', { d: shape.d, fill: 'none', stroke: 'transparent', 'stroke-width': 14 }, g);
  svgEl('path', { class: 'rel-glow', d: shape.d, fill: 'none', stroke: color, 'stroke-width': 7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
  const line = svgEl('path', {
    class: 'rel-line', d: shape.d, fill: 'none', stroke: color, 'stroke-width': 1.6,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }, g);
  if (edge.kind === 'eloquent') line.setAttribute('stroke-dasharray', '6 4');

  drawCardinality(g, shape.sx, shape.sy, shape.srcDir, edge.srcCard, color, colors.bg);
  drawCardinality(g, shape.ex, shape.ey, shape.tgtDir, edge.tgtCard, color, colors.bg);
  return g;
}

function themeColors() {
  const cs = getComputedStyle(document.body);
  return {
    fk: cs.getPropertyValue('--fk').trim() || '#6b9bff',
    eloquent: cs.getPropertyValue('--eloquent').trim() || '#2fd3b8',
    bg: cs.getPropertyValue('--bg').trim() || '#0f1115',
  };
}

const liveGeometry = { height: cardHeight, port: portY };

function renderRels() {
  const svg = relSvgEl;
  const preview = svg.querySelector('.link-preview');
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  lastEdges = collectEdges();
  const colors = themeColors();
  layoutEdges(lastEdges, liveGeometry).forEach(shape => drawShape(svg, shape, colors));
  if (preview) svg.appendChild(preview);

  const n = lastEdges.length;
  document.getElementById('status-rels').textContent = n + ' relationship' + (n === 1 ? '' : 's');
  applyHighlight();
  scheduleMinimap();
}

function scheduleRenderRels() {
  if (renderRelsFrame !== null) return;
  renderRelsFrame = requestAnimationFrame(() => {
    renderRelsFrame = null;
    renderRels();
  });
}

// ─────────────────────────────────────────────────
// HIGHLIGHTING — selection, hover, search
// ─────────────────────────────────────────────────
function applyHighlight() {
  const focus = selected || hovered;
  const touches = (g, n) => !!n && (g.dataset.src === n || g.dataset.tgt === n);
  const neighbours = new Set();
  if (focus) {
    lastEdges.forEach(e => {
      if (e.src === focus) neighbours.add(e.tgt);
      if (e.tgt === focus) neighbours.add(e.src);
    });
  }
  const query = currentQuery();
  const matches = query ? new Set(searchResults.map(r => r.entity.name)) : null;

  canvasEl.querySelectorAll('.entity-card').forEach(card => {
    const name = card.dataset.entity;
    const linked = (hoveredEdge && (hoveredEdge.src === name || hoveredEdge.tgt === name))
      || (hotColumn && hotColumn.target === name);
    card.classList.toggle('is-selected', selected === name);
    card.classList.toggle('is-related', !!focus && neighbours.has(name));
    card.classList.toggle('is-linked', !!linked && selected !== name);
    const dimBySelection = !!selected && selected !== name && !neighbours.has(name);
    const dimBySearch = !!matches && !matches.has(name);
    card.classList.toggle('is-dimmed', dimBySelection || dimBySearch);
  });

  canvasEl.querySelectorAll('.col-row.is-hot').forEach(r => r.classList.remove('is-hot'));

  const groups = Array.from(relSvgEl.querySelectorAll('.rel-group'));
  const active = [];
  groups.forEach(g => {
    const isHotCol = hotColumn && g.dataset.relKind === 'fk' && g.dataset.src === hotColumn.entityName
      && g.dataset.label.indexOf('.' + hotColumn.colName + ' →') !== -1;
    const isHoverEdge = hoveredEdge && hoveredEdge.node === g;
    const on = isHoverEdge || isHotCol || touches(g, selected) || touches(g, hovered);
    g.classList.toggle('is-active', !!on);
    g.classList.toggle('is-dimmed', !on && (!!selected || (!!matches && !(matches.has(g.dataset.src) && matches.has(g.dataset.tgt)))));
    if (on) active.push(g);
  });
  // Draw highlighted edges on top of the others.
  active.forEach(g => relSvgEl.appendChild(g));
  const preview = relSvgEl.querySelector('.link-preview');
  if (preview) relSvgEl.appendChild(preview);
}

function select(name) {
  if (selected === name) return;
  selected = name;
  if (name) bringToFront(name);
  applyHighlight();
  scheduleMinimap();
}

function bringToFront(name) {
  zOrder[name] = ++zTop;
  const card = cardEl(name);
  if (card) card.style.zIndex = String(zOrder[name]);
}

// ─────────────────────────────────────────────────
// POINTER INTERACTION — pan, drag, link
// ─────────────────────────────────────────────────
function isInteractive(target) {
  return !!target.closest('input, select, textarea, button, label, form, .connector, .fk-chip');
}

function onCardMouseDown(e, entityName) {
  if (e.button === 1 || (e.button === 0 && spaceDown)) return; // let the canvas pan
  e.stopPropagation();
  if (e.button !== 0 || isInteractive(e.target)) return;
  hideTooltip();
  closeSearch();
  drag = { type: 'pending', entityName, startX: e.clientX, startY: e.clientY };
}

wrap.addEventListener('mousedown', e => {
  if (e.button === 1 || (e.button === 0 && (spaceDown || !e.target.closest('.entity-card, .rel-group')))) {
    e.preventDefault();
    stopCameraAnim();
    drag = { type: 'pan', startX: e.clientX, startY: e.clientY, origPanX: panX, origPanY: panY, moved: false };
    wrap.classList.add('panning');
  }
});

wrap.addEventListener('dblclick', e => {
  if (e.target.closest('.entity-card, .rel-group')) return;
  // Double-click empty canvas zooms in around the cursor.
  const r = wrap.getBoundingClientRect();
  zoomAt(e.clientX - r.left, e.clientY - r.top, Math.min(MAX_ZOOM, zoom * 1.6), true);
});

document.addEventListener('mousemove', e => {
  if (!drag) return;
  if (drag.type === 'pending') {
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return;
    const p = positions[drag.entityName] || { x: 0, y: 0 };
    const startX = drag.startX, startY = drag.startY;
    startCardDrag(e, drag.entityName, p);
    drag.startX = startX; drag.startY = startY;
  }
  if (drag.type === 'pan') {
    panX = drag.origPanX + (e.clientX - drag.startX);
    panY = drag.origPanY + (e.clientY - drag.startY);
    if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 2) drag.moved = true;
    applyTransform();
  } else if (drag.type === 'card') {
    const nx = Math.max(0, drag.origX + (e.clientX - drag.startX) / zoom);
    const ny = Math.max(0, drag.origY + (e.clientY - drag.startY) / zoom);
    positions[drag.entityName] = { x: nx, y: ny };
    placeCard(drag.entityName);
    syncCanvasBounds();
    scheduleRenderRels();
  } else if (drag.type === 'link') {
    updateLinkPreview(e);
  } else if (drag.type === 'minimap') {
    minimapNavigate(e);
  }
});

document.addEventListener('mouseup', e => {
  if (!drag) return;
  const d = drag;
  drag = null;
  wrap.classList.remove('panning');
  if (d.type === 'pending') {
    select(d.entityName);
  } else if (d.type === 'pan' && !d.moved && e.target.closest && !e.target.closest('.entity-card')) {
    select(null);
  } else if (d.type === 'card') {
    syncCanvasBounds();
    saveLayoutSoon();
  } else if (d.type === 'link') {
    finishLinkDrag(e, d);
  } else if (d.type === 'pan') {
    saveLayoutSoon();
  }
});

wrap.addEventListener('wheel', e => {
  // Let scrollable card sections scroll normally unless the user is pinch/ctrl-zooming.
  const scroller = e.target.closest && e.target.closest('.col-list, .model-body');
  if (scroller && !e.ctrlKey && !e.metaKey && scroller.scrollHeight > scroller.clientHeight) return;
  e.preventDefault();
  stopCameraAnim();
  const rect = wrap.getBoundingClientRect();
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  const factor = Math.exp(-clamp(dy, -60, 60) * (e.ctrlKey ? 0.012 : 0.0025));
  zoomAt(e.clientX - rect.left, e.clientY - rect.top, zoom * factor, false);
}, { passive: false });

function zoomAt(mx, my, newZoom, animate) {
  newZoom = clamp(newZoom, MIN_ZOOM, MAX_ZOOM);
  const sc = newZoom / zoom;
  const nx = mx - sc * (mx - panX);
  const ny = my - sc * (my - panY);
  if (animate) animateCamera(newZoom, nx, ny);
  else { zoom = newZoom; panX = nx; panY = ny; applyTransform(); }
}

function zoomBy(factor) {
  zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, zoom * factor, true);
}

function applyTransform() {
  canvasEl.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
  wrap.style.backgroundSize = (24 * zoom) + 'px ' + (24 * zoom) + 'px';
  wrap.style.backgroundPosition = panX + 'px ' + panY + 'px';
  updateStatus();
  scheduleMinimap();
  saveLayoutSoon();
}

function startCardDrag(e, entityName, pos) {
  e.preventDefault();
  if (dragCleanup) { dragCleanup(); dragCleanup = null; }
  drag = { type: 'card', entityName, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
  bringToFront(entityName);
  if (selected && selected !== entityName) select(entityName);
  const card = cardEl(entityName);
  if (card) card.classList.add('dragging');
  hideHintSoon();
  const onUp = () => {
    if (card) card.classList.remove('dragging');
    document.removeEventListener('mouseup', onUp);
    dragCleanup = null;
  };
  dragCleanup = onUp;
  document.addEventListener('mouseup', onUp, { once: true });
}

// ── Camera animation ──
function animateCamera(tz, tx, ty, duration) {
  stopCameraAnim();
  const fz = zoom, fx = panX, fy = panY;
  const start = performance.now();
  const D = duration || 320;
  function step(now) {
    const t = Math.min(1, (now - start) / D);
    const k = easeOutCubic(t);
    zoom = fz + (tz - fz) * k;
    panX = fx + (tx - fx) * k;
    panY = fy + (ty - fy) * k;
    applyTransform();
    cameraAnim = t < 1 ? requestAnimationFrame(step) : null;
  }
  cameraAnim = requestAnimationFrame(step);
}
function stopCameraAnim() {
  if (cameraAnim) { cancelAnimationFrame(cameraAnim); cameraAnim = null; }
}

function focusEntity(name, opts) {
  const p = positions[name];
  if (!p) return;
  const z = clamp(Math.max(zoom, 0.85), MIN_ZOOM, 1.1);
  const h = Math.min(cardHeight(name), (wrap.clientHeight - 80) / z);
  const tx = wrap.clientWidth / 2 - (p.x + CARD_W / 2) * z;
  const ty = wrap.clientHeight / 2 - (p.y + h / 2) * z;
  animateCamera(z, tx, ty, 420);
  if (opts && opts.select) select(name);
  const card = cardEl(name);
  if (card) {
    card.classList.remove('flash');
    void card.offsetWidth;
    card.classList.add('flash');
  }
}

// ─────────────────────────────────────────────────
// FIT TO SCREEN
// ─────────────────────────────────────────────────
function fitToScreen(animate) {
  if (!schema.entities.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  schema.entities.forEach(e => {
    const p = positions[e.name] || { x: 0, y: 0 };
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + CARD_W); maxY = Math.max(maxY, p.y + cardHeight(e.name));
  });
  const pad = 48;
  const ww = wrap.clientWidth, wh = wrap.clientHeight;
  const z = clamp(Math.min((ww - pad * 2) / (maxX - minX), (wh - pad * 2) / (maxY - minY)), MIN_ZOOM, 1);
  const tx = (ww - (maxX - minX) * z) / 2 - minX * z;
  const ty = (wh - (maxY - minY) * z) / 2 - minY * z;
  if (animate) animateCamera(z, tx, ty);
  else { zoom = z; panX = tx; panY = ty; applyTransform(); }
}

// ─────────────────────────────────────────────────
// RELATIONSHIP CREATION — drag from a connector to another card
// ─────────────────────────────────────────────────
function startLinkDrag(e, entityName, side) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const src = findEntity(entityName);
  if (!src || !src.modelFile) {
    showToast(entityName + ' has no model file, so relationships can’t be added to it.', { kind: 'error' });
    return;
  }
  hideTooltip();
  drag = { type: 'link', src: entityName, side, target: null };
  wrap.classList.add('linking');
  const preview = svgEl('path', { class: 'link-preview', fill: 'none', stroke: themeColors().eloquent, 'stroke-width': 2, 'stroke-dasharray': '6 4' }, relSvgEl);
  drag.preview = preview;
  updateLinkPreview(e);
}

function updateLinkPreview(e) {
  const p = positions[drag.src];
  const sx = drag.side === 'right' ? p.x + CARD_W : p.x;
  const sy = p.y + portY(drag.src, null);
  const pt = clientToCanvas(e.clientX, e.clientY);
  const c = Math.max(40, Math.abs(pt.x - sx) / 2);
  const dir = drag.side === 'right' ? 1 : -1;
  drag.preview.setAttribute('d', 'M' + sx + ' ' + sy + ' C' + (sx + dir * c) + ' ' + sy + ' ' + (pt.x - dir * c * 0.3) + ' ' + pt.y + ' ' + pt.x + ' ' + pt.y);

  const under = document.elementFromPoint(e.clientX, e.clientY);
  const card = under && under.closest && under.closest('.entity-card');
  const target = card && card.dataset.entity !== drag.src ? card.dataset.entity : null;
  if (target !== drag.target) {
    canvasEl.querySelectorAll('.is-link-target').forEach(n => n.classList.remove('is-link-target'));
    if (target) cardEl(target).classList.add('is-link-target');
    drag.target = target;
  }
}

function finishLinkDrag(e, d) {
  wrap.classList.remove('linking');
  if (d.preview) d.preview.remove();
  canvasEl.querySelectorAll('.is-link-target').forEach(n => n.classList.remove('is-link-target'));
  if (d.target) openRelPopover(d.src, d.target, e.clientX + 12, e.clientY + 12);
}

function openRelPopover(srcName, tgtName, x, y) {
  const src = findEntity(srcName);
  if (!src) return;
  const pop = document.getElementById('rel-popover');
  while (pop.firstChild) pop.removeChild(pop.firstChild);

  const others = schema.entities.filter(e => e.name !== srcName).sort((a, b) => a.name.localeCompare(b.name));
  const state = { src: srcName, tgt: tgtName || (others[0] && others[0].name), type: null, nameEdited: false };
  state.type = suggestRelType(srcName, state.tgt);
  popoverState = state;

  const h = el('h3');
  h.appendChild(document.createTextNode('New relationship'));
  const close = iconBtn('x', 'Close', () => closeRelPopover());
  h.appendChild(close);
  pop.appendChild(h);

  const ents = el('div', 'pop-entities');
  ents.appendChild(entityChip(srcName));
  const arrow = el('span', 'arrow'); arrow.appendChild(icon('arrow', 14)); ents.appendChild(arrow);
  let targetSelect = null;
  if (tgtName) {
    ents.appendChild(entityChip(tgtName));
  } else {
    targetSelect = el('select');
    targetSelect.setAttribute('aria-label', 'Related model');
    others.forEach(o => {
      const opt = document.createElement('option'); opt.value = o.name; opt.textContent = o.name;
      targetSelect.appendChild(opt);
    });
    targetSelect.value = state.tgt;
    targetSelect.style.flex = '1';
    ents.appendChild(targetSelect);
  }
  pop.appendChild(ents);

  const typeLbl = el('span', 'pop-label'); typeLbl.textContent = 'Type'; pop.appendChild(typeLbl);
  const seg = el('div', 'segmented');
  NEW_REL_TYPES.forEach(t => {
    const b = el('button', 'seg-btn'); b.type = 'button'; b.textContent = t; b.dataset.type = t;
    b.addEventListener('click', () => { state.type = t; sync(); });
    seg.appendChild(b);
  });
  pop.appendChild(seg);

  const nameLbl = el('label', 'pop-label'); nameLbl.textContent = 'Method name'; pop.appendChild(nameLbl);
  const nameIn = el('input'); nameIn.type = 'text'; nameIn.spellcheck = false;
  pop.appendChild(nameIn);
  const err = el('div', 'field-error'); err.style.display = 'none'; err.style.marginTop = '6px';
  pop.appendChild(err);

  const preview = el('div', 'code-preview');
  pop.appendChild(preview);

  const actions = el('div', 'pop-actions');
  const cancel = el('button', 'mini-btn'); cancel.type = 'button'; cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => closeRelPopover());
  const add = el('button', 'mini-btn primary'); add.type = 'button';
  add.appendChild(document.createTextNode('Add relationship'));
  const k = el('kbd'); k.textContent = '↵'; add.appendChild(k);
  add.addEventListener('click', submit);
  actions.appendChild(cancel); actions.appendChild(add);
  pop.appendChild(actions);

  nameIn.addEventListener('input', () => { state.nameEdited = true; sync(); });
  if (targetSelect) targetSelect.addEventListener('change', () => {
    state.tgt = targetSelect.value;
    if (!state.nameEdited) state.type = suggestRelType(srcName, state.tgt);
    sync();
  });
  pop.onkeydown = ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeRelPopover(); }
    else if (ev.key === 'Enter' && ev.target.tagName !== 'BUTTON') { ev.preventDefault(); submit(); }
  };

  function validate() {
    const v = nameIn.value.trim();
    let msg = '';
    if (!v) msg = 'Method name is required.';
    else if (!IDENT_RE.test(v)) msg = 'Not a valid PHP method name.';
    else if (src.relationships.some(r => r.name === v)) msg = src.name + ' already has a ' + v + '() method.';
    return msg;
  }

  function sync() {
    seg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.type === state.type));
    if (!state.nameEdited) nameIn.value = suggestMethodName(state.type, state.tgt);
    const name = nameIn.value.trim() || 'method';
    while (preview.firstChild) preview.removeChild(preview.firstChild);
    appendCode(preview, [
      ['kw', 'public function '], ['fn', name], ['', '()\n{\n    '], ['kw', 'return '],
      ['', '$this->'], ['fn', state.type], ['', '(' + state.tgt + '::class);\n}'],
    ]);
    const msg = state.nameEdited ? validate() : '';
    nameIn.classList.toggle('invalid', !!msg);
    err.textContent = msg; err.style.display = msg ? 'block' : 'none';
  }

  function submit() {
    const msg = validate();
    if (msg) {
      nameIn.classList.add('invalid'); err.textContent = msg; err.style.display = 'block'; nameIn.focus();
      return;
    }
    const tgtEntity = findEntity(state.tgt);
    if (!tgtEntity) return;
    src.relationships.push({ name: nameIn.value.trim(), type: state.type, relatedModel: tgtEntity.name });
    activeTabs[src.name] = 'model';
    collapsed[src.name] = false;
    closeRelPopover();
    if (relFilter === 'fk') setRelFilter('both');
    render();
    select(src.name);
    showToast('Added ' + src.name + '::' + nameIn.value.trim() + '() — save to write it to the model.');
  }

  sync();
  pop.classList.add('open');
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = clamp(x, 8, window.innerWidth - pw - 8) + 'px';
  pop.style.top = clamp(y, 8, window.innerHeight - ph - 8) + 'px';
  nameIn.focus();
  nameIn.select();
}

function closeRelPopover() {
  popoverState = null;
  document.getElementById('rel-popover').classList.remove('open');
}

function suggestRelType(srcName, tgtName) {
  const s = findEntity(srcName), t = findEntity(tgtName);
  if (!s || !t) return 'hasMany';
  if (s.columns.some(c => c.foreignKey && c.foreignKey.table === t.tableName)) return 'belongsTo';
  if (t.columns.some(c => c.foreignKey && c.foreignKey.table === s.tableName)) return 'hasMany';
  return 'hasMany';
}

function suggestMethodName(type, target) {
  const base = lcfirst(target || '');
  return type === 'hasMany' || type === 'belongsToMany' ? pluralize(base) : base;
}

function entityChip(name) {
  const chip = el('span', 'entity-chip');
  chip.style.setProperty('--hue', String(hueFor(name)));
  const dot = el('span', 'dot');
  dot.textContent = initials(name);
  dot.style.background = 'hsl(' + hueFor(name) + ' var(--entity-s) var(--entity-l) / 0.18)';
  dot.style.color = 'hsl(' + hueFor(name) + ' var(--entity-s) var(--entity-l))';
  chip.appendChild(dot);
  chip.appendChild(document.createTextNode(name));
  return chip;
}

function appendCode(parent, parts) {
  parts.forEach(([cls, text]) => {
    const s = el('span', cls || null);
    s.textContent = text;
    parent.appendChild(s);
  });
}

// ─────────────────────────────────────────────────
// SEARCH
// ─────────────────────────────────────────────────
const searchInput = document.getElementById('search');
const searchBox = document.getElementById('search-results');

function currentQuery() { return searchInput.value.trim().toLowerCase(); }

function runSearch() {
  const q = currentQuery();
  searchResults = [];
  if (q) {
    schema.entities.forEach(entity => {
      const n = entity.name.toLowerCase(), t = entity.tableName.toLowerCase();
      let score = -1, via = null;
      if (n === q || t === q) score = 0;
      else if (n.startsWith(q) || t.startsWith(q)) score = 1;
      else if (n.includes(q) || t.includes(q)) score = 2;
      else {
        const col = entity.columns.find(c => c.name.toLowerCase().includes(q));
        if (col) { score = 3; via = col.name; }
      }
      if (score >= 0) searchResults.push({ entity, score, via });
    });
    searchResults.sort((a, b) => a.score - b.score || a.entity.name.localeCompare(b.entity.name));
  }
  searchIndex = 0;
  renderSearchResults();
  applyHighlight();
}

function renderSearchResults() {
  const q = currentQuery();
  while (searchBox.firstChild) searchBox.removeChild(searchBox.firstChild);
  if (!q || document.activeElement !== searchInput) { searchBox.classList.remove('open'); return; }
  if (!searchResults.length) {
    const empty = el('div', 'search-empty'); empty.textContent = 'No tables or columns match “' + searchInput.value.trim() + '”';
    searchBox.appendChild(empty);
  }
  searchResults.slice(0, 8).forEach((r, i) => {
    const item = el('div', 'search-item' + (i === searchIndex ? ' active' : ''));
    item.appendChild(entityChipDot(r.entity.name));
    const text = el('div', 'si-text');
    const nm = el('div', 'si-name'); highlightInto(nm, r.entity.name, q); text.appendChild(nm);
    const meta = el('div', 'si-meta');
    if (r.via) { meta.appendChild(document.createTextNode('column ')); highlightInto(meta, r.via, q); }
    else highlightInto(meta, r.entity.tableName + ' · ' + r.entity.columns.length + ' columns', q);
    text.appendChild(meta);
    item.appendChild(text);
    item.addEventListener('mouseenter', () => { searchIndex = i; markActiveResult(); });
    item.addEventListener('mousedown', e => { e.preventDefault(); chooseResult(i); });
    searchBox.appendChild(item);
  });
  searchBox.classList.add('open');
}

function markActiveResult() {
  Array.from(searchBox.querySelectorAll('.search-item')).forEach((n, i) => n.classList.toggle('active', i === searchIndex));
}

function chooseResult(i) {
  const r = searchResults[i];
  if (!r) return;
  searchInput.value = '';
  runSearch();
  searchInput.blur();
  closeSearch();
  if (collapsed[r.entity.name] && r.via) { collapsed[r.entity.name] = false; render(); }
  focusEntity(r.entity.name, { select: true });
  if (r.via) {
    activeTabs[r.entity.name] = 'migration';
    render();
    const row = cardEl(r.entity.name) && cardEl(r.entity.name).querySelector('.col-row[data-col="' + cssEscape(r.via) + '"]');
    if (row) { row.scrollIntoView({ block: 'nearest' }); row.classList.add('is-hot'); setTimeout(() => row.classList.remove('is-hot'), 1400); }
  }
}

function closeSearch() { searchBox.classList.remove('open'); }

function entityChipDot(name) {
  const dot = el('span', 'entity-icon');
  dot.style.setProperty('--entity', 'hsl(' + hueFor(name) + ' var(--entity-s) var(--entity-l))');
  dot.style.setProperty('--entity-soft', 'hsl(' + hueFor(name) + ' var(--entity-s) var(--entity-l) / 0.14)');
  dot.style.width = '26px'; dot.style.height = '26px'; dot.style.fontSize = '11px';
  dot.textContent = initials(name);
  return dot;
}

function highlightInto(parent, text, q) {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0 || !q) { parent.appendChild(document.createTextNode(text)); return; }
  parent.appendChild(document.createTextNode(text.slice(0, i)));
  const m = el('mark'); m.textContent = text.slice(i, i + q.length); parent.appendChild(m);
  parent.appendChild(document.createTextNode(text.slice(i + q.length)));
}

searchInput.addEventListener('input', runSearch);
searchInput.addEventListener('focus', renderSearchResults);
searchInput.addEventListener('blur', () => setTimeout(closeSearch, 100));
searchInput.addEventListener('keydown', e => {
  const n = Math.min(searchResults.length, 8);
  if (e.key === 'ArrowDown') { e.preventDefault(); if (n) { searchIndex = (searchIndex + 1) % n; markActiveResult(); } }
  else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) { searchIndex = (searchIndex - 1 + n) % n; markActiveResult(); } }
  else if (e.key === 'Enter') { e.preventDefault(); chooseResult(searchIndex); }
  else if (e.key === 'Escape') { e.preventDefault(); searchInput.value = ''; runSearch(); searchInput.blur(); }
});

// ─────────────────────────────────────────────────
// MINIMAP
// ─────────────────────────────────────────────────
const minimap = document.getElementById('minimap');
const minimapCanvas = document.getElementById('minimap-canvas');
let minimapView = null;

function scheduleMinimap() {
  if (minimapFrame !== null) return;
  minimapFrame = requestAnimationFrame(() => { minimapFrame = null; drawMinimap(); });
}

function drawMinimap() {
  if (minimap.classList.contains('hidden') || !schema.entities.length) {
    minimap.style.display = schema.entities.length ? '' : 'none';
    return;
  }
  minimap.style.display = '';
  const W = 200, H = 128, dpr = window.devicePixelRatio || 1;
  if (minimapCanvas.width !== W * dpr) { minimapCanvas.width = W * dpr; minimapCanvas.height = H * dpr; }
  const ctx = minimapCanvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const view = {
    x: -panX / zoom, y: -panY / zoom,
    w: wrap.clientWidth / zoom, h: wrap.clientHeight / zoom,
  };
  let minX = view.x, minY = view.y, maxX = view.x + view.w, maxY = view.y + view.h;
  schema.entities.forEach(e => {
    const p = positions[e.name]; if (!p) return;
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + CARD_W); maxY = Math.max(maxY, p.y + cardHeight(e.name));
  });
  const pad = 8;
  const s = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxY - minY));
  const ox = pad + ((W - pad * 2) - (maxX - minX) * s) / 2 - minX * s;
  const oy = pad + ((H - pad * 2) - (maxY - minY) * s) / 2 - minY * s;
  minimapView = { s, ox, oy };

  const light = document.body.classList.contains('light');
  schema.entities.forEach(e => {
    const p = positions[e.name]; if (!p) return;
    const hue = hueFor(e.name);
    const isSel = selected === e.name;
    ctx.fillStyle = 'hsla(' + hue + ',' + (light ? '60%,50%,' : '70%,64%,') + (isSel ? 0.95 : 0.55) + ')';
    roundRect(ctx, ox + p.x * s, oy + p.y * s, Math.max(2, CARD_W * s), Math.max(2, cardHeight(e.name) * s), 1.5);
    ctx.fill();
  });

  const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#6b9bff';
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.fillStyle = light ? 'rgba(47,107,240,0.06)' : 'rgba(107,155,255,0.08)';
  roundRect(ctx, ox + view.x * s, oy + view.y * s, view.w * s, view.h * s, 3);
  ctx.fill();
  ctx.stroke();
}

function minimapNavigate(e) {
  if (!minimapView) return;
  const r = minimapCanvas.getBoundingClientRect();
  const wx = (e.clientX - r.left - minimapView.ox) / minimapView.s;
  const wy = (e.clientY - r.top - minimapView.oy) / minimapView.s;
  panX = wrap.clientWidth / 2 - wx * zoom;
  panY = wrap.clientHeight / 2 - wy * zoom;
  applyTransform();
}

minimapCanvas.addEventListener('mousedown', e => {
  e.preventDefault();
  stopCameraAnim();
  drag = { type: 'minimap' };
  minimapNavigate(e);
});

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ─────────────────────────────────────────────────
// STATUS / TOOLBAR ACTIONS
// ─────────────────────────────────────────────────
function updateStatus() {
  const n = schema.entities.length;
  document.getElementById('status-tables').textContent = n + ' table' + (n !== 1 ? 's' : '');
  document.getElementById('status-zoom').textContent = Math.round(zoom * 100) + '%';
}

function setRelFilter(filter) {
  relFilter = filter;
  document.querySelectorAll('#rel-toggle .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
}

function save() {
  if (editingCol) {
    const form = cardEl(editingCol.entityName) && cardEl(editingCol.entityName).querySelector('.edit-row');
    if (form) form.requestSubmit();
    if (editingCol) return; // validation failed — keep the user in the form
  }
  setSaving(true);
  vscode.postMessage({ type: 'save', schema });
}

function refresh() {
  const n = countChanges();
  if (n > 0) {
    showToast('Refreshing will discard ' + n + ' unsaved change' + (n === 1 ? '' : 's') + '.', {
      id: 'confirm-refresh',
      actions: [{ label: 'Cancel' }, { label: 'Discard & refresh', primary: true, onClick: doRefresh }],
    });
    return;
  }
  doRefresh();
}

function doRefresh() {
  refreshRequested = true;
  setRefreshing(true);
  vscode.postMessage({ type: 'refresh' });
}

function setRefreshing(on) {
  document.getElementById('btn-refresh').classList.toggle('spinning', on);
}
function setSaving(on) {
  const b = document.getElementById('btn-save');
  b.disabled = on;
  b.style.opacity = on ? '0.7' : '';
}

document.getElementById('btn-save').addEventListener('click', save);
document.getElementById('btn-refresh').addEventListener('click', refresh);
document.getElementById('btn-empty-refresh').addEventListener('click', doRefresh);
document.getElementById('btn-fit').addEventListener('click', () => fitToScreen(true));
document.getElementById('btn-arrange').addEventListener('click', arrange);
document.getElementById('btn-export').addEventListener('click', exportSvg);
document.getElementById('btn-zoom-in').addEventListener('click', () => zoomBy(1.25));
document.getElementById('btn-zoom-out').addEventListener('click', () => zoomBy(0.8));
document.getElementById('status-zoom').addEventListener('click', () => zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, 1, true));
document.getElementById('btn-minimap').addEventListener('click', () => {
  minimap.classList.toggle('hidden');
  drawMinimap();
});
document.getElementById('btn-help').addEventListener('click', e => { e.stopPropagation(); toggleHelp(); });

function toggleHelp(force) {
  const panel = document.getElementById('help-panel');
  panel.classList.toggle('open', force === undefined ? !panel.classList.contains('open') : force);
}
document.addEventListener('mousedown', e => {
  if (!e.target.closest('#help-panel, #btn-help')) toggleHelp(false);
  if (popoverState && !e.target.closest('.popover')) closeRelPopover();
}, true);

// ── Relationship filter toggle ──
document.getElementById('rel-toggle').addEventListener('click', e => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  const filter = btn.dataset.filter;
  if (filter === relFilter) return;
  setRelFilter(filter);
  renderRels();
});

// ── Relationship line hover tooltip ──
relSvgEl.addEventListener('mousemove', e => {
  if (drag) return;
  const g = e.target.closest && e.target.closest('.rel-group');
  if (!g) { hideTooltip(); return; }
  if (!hoveredEdge || hoveredEdge.node !== g) {
    hoveredEdge = { node: g, src: g.dataset.src, tgt: g.dataset.tgt };
    applyHighlight();
    fillTooltip(g);
  }
  tooltip.style.display = 'block';
  const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
  tooltip.style.left = Math.min(e.clientX + 14, window.innerWidth - tw - 8) + 'px';
  tooltip.style.top  = Math.min(e.clientY + 14, window.innerHeight - th - 8) + 'px';
});
relSvgEl.addEventListener('mouseleave', () => {
  hideTooltip();
});
relSvgEl.addEventListener('click', e => {
  const g = e.target.closest && e.target.closest('.rel-group');
  if (!g) return;
  // Clicking a line jumps to whichever end is further from the viewport centre.
  const center = clientToCanvas(wrap.getBoundingClientRect().left + wrap.clientWidth / 2, wrap.getBoundingClientRect().top + wrap.clientHeight / 2);
  const dist = n => { const p = positions[n]; return p ? Math.hypot(p.x + CARD_W / 2 - center.x, p.y - center.y) : 0; };
  focusEntity(dist(g.dataset.src) > dist(g.dataset.tgt) ? g.dataset.src : g.dataset.tgt, { select: true });
});

function fillTooltip(g) {
  while (tooltip.firstChild) tooltip.removeChild(tooltip.firstChild);
  const kind = el('div', 'tt-kind');
  const sw = el('span', 'swatch ' + (g.dataset.relKind === 'fk' ? 'fk' : 'eloquent'));
  kind.appendChild(sw);
  kind.appendChild(document.createTextNode(g.dataset.relKind === 'fk' ? 'Foreign key' : 'Eloquent'));
  tooltip.appendChild(kind);
  const main = el('div', 'tt-main');
  if (g.dataset.relKind === 'fk') {
    main.textContent = g.dataset.label;
  } else {
    appendCode(main, [['', g.dataset.label + ' '], ['tt-type', g.dataset.relType], ['tt-dim', ' → '], ['', g.dataset.tgt]]);
  }
  tooltip.appendChild(main);
  const hint = el('div', 'tt-dim'); hint.style.fontSize = '11px'; hint.style.marginTop = '3px';
  hint.textContent = 'Click to jump';
  tooltip.appendChild(hint);
}

function hideTooltip() {
  tooltip.style.display = 'none';
  if (hoveredEdge) { hoveredEdge = null; applyHighlight(); }
}

// ─────────────────────────────────────────────────
// KEYBOARD
// ─────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey;
  const typing = e.target.closest && e.target.closest('input, select, textarea');

  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
  if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); searchInput.focus(); searchInput.select(); return; }
  if (typing) return;

  if (e.key === ' ' && !spaceDown) { spaceDown = true; wrap.classList.add('space-pan'); e.preventDefault(); return; }
  if (e.key === '/') { e.preventDefault(); searchInput.focus(); return; }
  if (e.key === 'Escape') {
    if (popoverState) closeRelPopover();
    else if (editingCol) cancelEdit();
    else if (document.getElementById('help-panel').classList.contains('open')) toggleHelp(false);
    else select(null);
    return;
  }
  if (mod) return;
  switch (e.key) {
    case 'f': case 'F': fitToScreen(true); break;
    case '+': case '=': zoomBy(1.25); break;
    case '-': case '_': zoomBy(0.8); break;
    case '0': zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, 1, true); break;
    case '?': toggleHelp(); break;
    case 'Enter':
      if (selected) focusEntity(selected);
      break;
    case 'c': case 'C':
      if (selected) toggleCollapsed(selected);
      break;
    case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': {
      if (!selected || !positions[selected]) return;
      e.preventDefault();
      const step = e.shiftKey ? 40 : 8;
      const p = positions[selected];
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      positions[selected] = { x: Math.max(0, p.x + dx), y: Math.max(0, p.y + dy) };
      placeCard(selected);
      syncCanvasBounds();
      scheduleRenderRels();
      saveLayoutSoon();
      break;
    }
  }
});
document.addEventListener('keyup', e => {
  if (e.key === ' ') { spaceDown = false; wrap.classList.remove('space-pan'); }
});
window.addEventListener('blur', () => { spaceDown = false; wrap.classList.remove('space-pan'); });
window.addEventListener('resize', () => { scheduleMinimap(); });

// ─────────────────────────────────────────────────
// LAYOUT PERSISTENCE
// ─────────────────────────────────────────────────
function saveLayoutSoon() {
  if (!hasLoaded) return;
  clearTimeout(layoutSaveTimer);
  layoutSaveTimer = setTimeout(() => {
    vscode.postMessage({
      type: 'layout',
      data: { positions, collapsed, activeTabs, viewport: { zoom, panX, panY } },
    });
  }, 500);
}

// ─────────────────────────────────────────────────
// STATES, TOASTS & HINTS
// ─────────────────────────────────────────────────
function showState(kind, message) {
  ['state-loading', 'state-empty', 'state-error'].forEach(id => document.getElementById(id).classList.remove('visible'));
  if (kind) document.getElementById('state-' + kind).classList.add('visible');
  if (kind === 'error' && message) document.getElementById('state-error-msg').textContent = message;
  document.getElementById('hint-bar').classList.toggle('hidden', !!kind || hintDismissed);
}

let hintDismissed = false;
let hintTimer = null;
function hideHintSoon() {
  if (hintDismissed) return;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    hintDismissed = true;
    document.getElementById('hint-bar').classList.add('hidden');
  }, 1500);
}

function showToast(message, opts) {
  opts = opts || {};
  const host = document.getElementById('toasts');
  if (opts.id) dismissToast(opts.id);
  const t = el('div', 'toast' + (opts.kind === 'error' ? ' error' : ''));
  if (opts.id) t.dataset.id = opts.id;
  const m = el('span'); m.textContent = message; t.appendChild(m);
  const remove = () => {
    if (!t.isConnected) return;
    t.classList.add('leaving');
    setTimeout(() => t.remove(), 160);
  };
  if (opts.actions && opts.actions.length) {
    const acts = el('div', 'toast-actions');
    opts.actions.forEach(a => {
      const b = el('button', 'mini-btn' + (a.primary ? ' primary' : ''));
      b.textContent = a.label;
      b.addEventListener('click', () => { remove(); if (a.onClick) a.onClick(); });
      acts.appendChild(b);
    });
    t.appendChild(acts);
  }
  host.appendChild(t);
  if (!opts.sticky) setTimeout(remove, opts.actions ? 8000 : 3200);
}

function dismissToast(id) {
  document.querySelectorAll('.toast[data-id="' + id + '"]').forEach(n => n.remove());
}

// ─────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────
function exportSvg() {
  // Issue #25: Guard against empty schema.
  if (!schema.entities.length) {
    return;
  }

  // Export always shows every column, so lay lines out against that full geometry.
  const HDR = 52, ROW = 24, TOP = 60;
  const exportGeometry = {
    height: name => { const e = findEntity(name); return TOP + (e ? e.columns.length : 0) * ROW + 10; },
    port: (name, colName) => {
      const e = findEntity(name);
      const i = e && colName ? e.columns.findIndex(c => c.name === colName) : -1;
      return i >= 0 ? TOP + i * ROW + ROW / 2 : HDR / 2;
    },
  };

  const cs = getComputedStyle(document.body);
  const v = n => cs.getPropertyValue(n).trim();
  const colors = themeColors();
  const tmp = document.createElementNS(SVG_NS, 'svg');
  layoutEdges(collectEdges(), exportGeometry).forEach(shape => drawShape(tmp, shape, colors));
  tmp.querySelectorAll('.rel-glow').forEach(n => n.remove());
  const paths = Array.from(tmp.children).map(c => c.outerHTML).join('\n  ');

  let entityRects = '';
  schema.entities.forEach((e, idx) => {
    const p = positions[e.name] || { x: 0, y: 0 };
    const h = exportGeometry.height(e.name);
    const hue = hueFor(e.name);
    const entityColor = 'hsl(' + hue + ',' + v('--entity-s') + ',' + v('--entity-l') + ')';
    const cols = e.columns.map((c, i) => {
      const y = p.y + TOP + i * ROW + ROW / 2 + 4;
      const keyColor = c.primaryKey ? v('--pk') : v('--fk');
      const key = c.primaryKey ? 'PK' : c.foreignKey ? 'FK' : '';
      return '  <text x="' + (p.x + 14) + '" y="' + y + '" font-family="ui-monospace, Menlo, monospace" font-size="9" font-weight="700" fill="' + keyColor + '">' + key + '</text>\n' +
        '  <text x="' + (p.x + 36) + '" y="' + y + '" font-family="ui-monospace, Menlo, monospace" font-size="11.5" fill="' + v('--text') + '">' + esc(c.name) + '</text>\n' +
        '  <text x="' + (p.x + CARD_W - 14) + '" y="' + y + '" text-anchor="end" font-family="ui-monospace, Menlo, monospace" font-size="10.5" fill="' + v('--text-3') + '">' + esc(c.type) + (c.nullable ? '?' : '') + '</text>';
    }).join('\n');

    const card = 'x="' + p.x + '" y="' + p.y + '" width="' + CARD_W + '" height="' + h + '" rx="12"';
    entityRects += '\n<g>\n' +
      '<clipPath id="card-' + idx + '"><rect ' + card + '/></clipPath>\n' +
      '<rect ' + card + ' fill="' + v('--surface') + '" stroke="' + v('--border-2') + '" stroke-width="1"/>\n' +
      '<rect x="' + p.x + '" y="' + p.y + '" width="' + CARD_W + '" height="3" fill="' + entityColor + '" clip-path="url(#card-' + idx + ')"/>\n' +
      '<text x="' + (p.x + 14) + '" y="' + (p.y + 26) + '" font-family="system-ui, -apple-system, sans-serif" font-size="13.5" font-weight="650" fill="' + v('--text') + '">' + esc(e.name) + '</text>\n' +
      '<text x="' + (p.x + 14) + '" y="' + (p.y + 42) + '" font-family="ui-monospace, Menlo, monospace" font-size="11" fill="' + v('--text-3') + '">' + esc(e.tableName) + '</text>\n' +
      '<line x1="' + p.x + '" y1="' + (p.y + HDR) + '" x2="' + (p.x + CARD_W) + '" y2="' + (p.y + HDR) + '" stroke="' + v('--border') + '"/>\n' +
      cols + '\n</g>';
  });

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  schema.entities.forEach(e => {
    const p = positions[e.name] || { x: 0, y: 0 };
    minX = Math.min(minX, p.x - 60); minY = Math.min(minY, p.y - 60);
    maxX = Math.max(maxX, p.x + CARD_W + 80); maxY = Math.max(maxY, p.y + exportGeometry.height(e.name) + 60);
  });

  const svgContent = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + (maxX - minX) + '" height="' + (maxY - minY) + '" viewBox="' + minX + ' ' + minY + ' ' + (maxX - minX) + ' ' + (maxY - minY) + '">\n' +
    '  <rect x="' + minX + '" y="' + minY + '" width="' + (maxX - minX) + '" height="' + (maxY - minY) + '" fill="' + v('--bg') + '"/>\n' +
    '  ' + paths + '\n' +
    entityRects + '\n</svg>';

  vscode.postMessage({ type: 'export', content: svgContent });
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────
function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
function icon(name, size) {
  const s = size || 14;
  const span = el('span', 'i');
  // ICONS are static strings defined above; no user data reaches innerHTML.
  span.innerHTML = '<svg width="' + s + '" height="' + s + '" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  return span;
}
function hydrateIcons(root) {
  root.querySelectorAll('[data-icon]').forEach(n => n.insertBefore(icon(n.dataset.icon, Number(n.dataset.iconSize) || 15), n.firstChild));
}
function iconBtn(name, title, onClick) {
  const b = el('button', 'icon-btn');
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.appendChild(icon(name, 14));
  b.addEventListener('click', e => { e.stopPropagation(); onClick(e); });
  return b;
}
function rowAction(name, title, onClick, alwaysVisible) {
  const b = el('button', 'row-action' + (alwaysVisible ? ' static' : ''));
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.appendChild(icon(name, 13));
  b.addEventListener('click', e => { e.stopPropagation(); onClick(e); });
  return b;
}
function cardEl(name) {
  return canvasEl.querySelector('.entity-card[data-entity="' + cssEscape(name) + '"]');
}
function findEntity(name) {
  return schema.entities.find(x => x.name === name);
}
function findEntityByTable(table) {
  return schema.entities.find(x => x.tableName === table) || schema.entities.find(x => x.name.toLowerCase() === table);
}
function clientToCanvas(cx, cy) {
  const r = wrap.getBoundingClientRect();
  return { x: (cx - r.left - panX) / zoom, y: (cy - r.top - panY) / zoom };
}
function hueFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}
function initials(name) {
  const caps = name.match(/[A-Z]/g);
  if (caps && caps.length >= 2) return caps[0] + caps[1];
  return name.slice(0, 2).replace(/^./, c => c.toUpperCase());
}
function lcfirst(s) { return s.charAt(0).toLowerCase() + s.slice(1); }
function pluralize(w) {
  if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/i.test(w)) return w + 'es';
  return w + 's';
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function cssEscape(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'); }

})();
