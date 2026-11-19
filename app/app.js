import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000; // R4

const board = document.querySelector('[data-testid="board"]');
const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const status = document.querySelector('[data-testid="status"]');
const newBar = document.querySelector('[data-testid="new-bar"]');

/** Rows on screen, keyed by incident id. Rows are kept, not re-created, so a click lands on the row it was aimed at. */
const rows = new Map();
/** Acks we sent, keyed by incident id: survives every refresh. */
const acked = new Map();

// R5: the viewer's own locale and zone. EU locales (en-GB, de-DE, fr-FR, …) put the day before the month.
const timeFmt = new Intl.DateTimeFormat(undefined, {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function localTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : timeFmt.format(d);
}

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text; // text only: incident fields never become markup
  return node;
}

function markAcked(row, reply) {
  row.classList.add('is-acked');
  const slot = row.querySelector('.act');
  slot.replaceChildren(
    el('span', { 'data-testid': 'acked', class: 'acked', title: `acked ${reply.ackedAt}` }, 'Acked'),
  );
}

async function onAck(id, row, button) {
  button.disabled = true;
  button.textContent = 'Acking…';
  try {
    const reply = await ack(id); // R2
    acked.set(id, reply);
    markAcked(row, reply);
  } catch (err) {
    console.error(err);
    button.disabled = false;
    button.textContent = 'Ack';
    row.classList.add('ack-failed');
    button.title = String(err.message || err);
  }
}

function buildRow(i) {
  const row = el('li', { 'data-testid': 'incident-row', 'data-id': i.id, 'data-opened-at': i.openedAt, class: `row ${i.severity}` });
  row.append(
    el('span', { class: 'id' }, i.id),
    el('span', { class: 'sev' }, i.severity),
    el('span', { class: 'what' }, `${i.service} · ${i.region} · ${i.summary}`),
    el('time', { datetime: i.openedAt, title: `${i.openedAt} (UTC) · shown in ${zone}` }, localTime(i.openedAt)),
  );
  const act = el('span', { class: 'act' });
  const button = el('button', { type: 'button', 'data-testid': 'ack', class: 'ack' }, 'Ack');
  button.addEventListener('click', () => onAck(i.id, row, button));
  act.append(button);
  row.append(act);
  if (acked.has(i.id)) markAcked(row, acked.get(i.id));
  return row;
}

/** Incidents that arrived after the list was drawn, held off-screen until on-call asks for them (product, SCHED-4515). */
const held = new Map();

function showNewBar() {
  const n = held.size;
  newBar.textContent = n === 1 ? '1 new incident: show' : `${n} new incidents: show`;
  // The bar's slot is always reserved, so showing it never moves a row.
  newBar.classList.toggle('is-shown', n > 0);
  newBar.disabled = n === 0;
}

/** Puts incidents into the list at their place by time, newest first (R1). Rows already on screen never move or disappear. */
function insert(incidents) {
  const sorted = [...incidents].sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
  for (const i of sorted) {
    if (rows.has(i.id)) continue;
    const row = buildRow(i);
    if (loaded) row.classList.add('is-new');
    const t = Date.parse(i.openedAt);
    const before = [...list.children].find((r) => Date.parse(r.dataset.openedAt) < t) ?? null;
    list.insertBefore(row, before);
    rows.set(i.id, row);
  }
}

function render(incidents) {
  if (!loaded || rows.size === 0) {
    insert(incidents); // nothing on screen yet, so nothing can move under the pointer
  } else {
    // R1 as product decided: the list holds still while it is on screen; new incidents wait behind the bar.
    for (const i of incidents) if (!rows.has(i.id) && !held.has(i.id)) held.set(i.id, i);
    showNewBar();
  }
  empty.hidden = rows.size > 0;
  list.hidden = rows.size === 0;
}

function showHeld() {
  if (!held.size) return;
  const incoming = [...held.values()];
  held.clear();
  insert(incoming);
  showNewBar();
  empty.hidden = rows.size > 0;
  list.hidden = rows.size === 0;
}
newBar.addEventListener('click', showHeld);

let loaded = false;
async function refresh() {
  try {
    const page = await fetchIncidents();
    render(page.incidents);
    if (!loaded) {
      loaded = true;
      loader.remove(); // R3: gone once incidents load
      board.setAttribute('aria-busy', 'false');
    }
    status.textContent = `updated ${localTime(page.updatedAt)} · times in ${zone}`;
    status.classList.remove('stale');
  } catch (err) {
    console.error(err);
    status.textContent = `could not refresh: ${err.message || err}`;
    status.classList.add('stale');
  } finally {
    setTimeout(refresh, REFRESH_MS); // R4: one request at a time, every 2 s
  }
}

refresh();
