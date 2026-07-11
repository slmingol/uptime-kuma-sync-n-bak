#!/usr/bin/env node

/**
 * Uptime Kuma Sync Daemon
 * Runs sync on a configurable interval and serves a status UI.
 *
 * Environment variables:
 *   SYNC_SOURCE      Source instance name (default: primary)
 *   SYNC_TARGET      Target instance name (default: secondary)
 *   SYNC_INTERVAL    Interval in seconds (default: 3600)
 *   SYNC_MODE        shallow|deep (default: shallow)
 *   DAEMON_PORT      HTTP port for UI (default: 8089)
 *   CONFIG_FILE      Path to config (default: ./uptime-kuma-config.json)
 *   HISTORY_FILE     Path to history file (default: .uptime-kuma-sync-history.json)
 *   MAX_HISTORY      Max history entries to keep (default: 100)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const UptimeKumaSync = require('./uptime-kuma-sync');

const SOURCE       = process.env.SYNC_SOURCE   || 'primary';
const TARGET       = process.env.SYNC_TARGET   || 'secondary';
const INTERVAL_S   = parseInt(process.env.SYNC_INTERVAL || '3600', 10);
const SYNC_MODE    = process.env.SYNC_MODE     || 'shallow';
const PORT         = parseInt(process.env.DAEMON_PORT   || '8089', 10);
const CONFIG_FILE  = process.env.CONFIG_FILE   || './uptime-kuma-config.json';
const HISTORY_FILE = process.env.HISTORY_FILE  || '.uptime-kuma-sync-history.json';
const MAX_HISTORY  = parseInt(process.env.MAX_HISTORY   || '100', 10);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let nextSyncAt = null;
let syncTimer = null;
let running = false;
let syncSeq = 0;

function loadHistory() {
  if (fs.existsSync(HISTORY_FILE)) {
    try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch (_) {}
  }
  return [];
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(-MAX_HISTORY), null, 2));
}

// ---------------------------------------------------------------------------
// Sync runner
// ---------------------------------------------------------------------------

function loadSyncConfig() {
  const fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const source = fileConfig.instances[SOURCE];
  const target = fileConfig.instances[TARGET];
  if (!source) throw new Error(`Instance "${SOURCE}" not found in config`);
  if (!target) throw new Error(`Instance "${TARGET}" not found in config`);
  return {
    sourceUrl: source.url, sourceUsername: source.username, sourcePassword: source.password,
    sourceName: SOURCE,
    targetUrl: target.url, targetUsername: target.username, targetPassword: target.password,
    targetName: TARGET,
    backupDir: fileConfig.backup?.directory || './uptime-kuma-backups',
    syncMode: SYNC_MODE,
    excludedFields: fileConfig.sync?.excludedFields || undefined
  };
}

async function runSync(trigger = 'scheduled') {
  if (running) {
    console.log(`[daemon] Sync already in progress — skipping ${trigger} trigger`);
    return null;
  }

  running = true;
  const seq = ++syncSeq;
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  console.log(`[daemon] Starting sync #${seq} (${trigger}) — ${SOURCE} → ${TARGET}`);

  const entry = { seq, trigger, source: SOURCE, target: TARGET, mode: SYNC_MODE, startedAt };
  const history = loadHistory();

  try {
    const config = loadSyncConfig();
    const syncer = new UptimeKumaSync(config);
    const result = await syncer.sync();

    const durationMs = Date.now() - startMs;
    Object.assign(entry, {
      status: 'success',
      completedAt: new Date().toISOString(),
      durationMs,
      ...result
    });
    console.log(`[daemon] Sync #${seq} complete in ${(durationMs / 1000).toFixed(1)}s — created:${result.created} updated:${result.updated} skipped:${result.skipped}`);
  } catch (err) {
    const durationMs = Date.now() - startMs;
    Object.assign(entry, {
      status: 'error',
      completedAt: new Date().toISOString(),
      durationMs,
      error: err.message
    });
    console.error(`[daemon] Sync #${seq} failed: ${err.message}`);
  } finally {
    running = false;
  }

  history.push(entry);
  saveHistory(history);
  return entry;
}

function scheduleNext() {
  if (syncTimer) clearTimeout(syncTimer);
  nextSyncAt = new Date(Date.now() + INTERVAL_S * 1000);
  syncTimer = setTimeout(async () => {
    await runSync('scheduled');
    scheduleNext();
  }, INTERVAL_S * 1000);
  console.log(`[daemon] Next sync at ${nextSyncAt.toISOString()} (in ${INTERVAL_S}s)`);
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function htmlResponse(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

const UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Uptime Kuma Sync Daemon</title>
<style>
  :root{--bg:#0e1117;--card:#161b22;--border:#30363d;--text:#c9d1d9;--muted:#8b949e;--green:#3fb950;--red:#f85149;--yellow:#d29922;--blue:#58a6ff;--purple:#bc8cff;}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;padding:24px}
  h1{font-size:20px;font-weight:600;color:#e6edf3;margin-bottom:4px}
  .subtitle{color:var(--muted);margin-bottom:24px;font-size:13px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:16px}
  .card-label{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
  .card-value{font-size:24px;font-weight:700;color:#e6edf3}
  .card-value.green{color:var(--green)}
  .card-value.red{color:var(--red)}
  .card-value.yellow{color:var(--yellow)}
  .card-value.blue{color:var(--blue)}
  .card-sub{font-size:11px;color:var(--muted);margin-top:4px}
  .btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:6px;border:none;cursor:pointer;font-size:13px;font-weight:500;transition:opacity .15s}
  .btn-primary{background:var(--blue);color:#0d1117}
  .btn-primary:hover{opacity:.85}
  .btn-primary:disabled{opacity:.4;cursor:not-allowed}
  .actions{margin-bottom:24px;display:flex;gap:8px;align-items:center}
  .status-dot{width:8px;height:8px;border-radius:50%;display:inline-block}
  .dot-green{background:var(--green);box-shadow:0 0 6px var(--green)}
  .dot-red{background:var(--red)}
  .dot-yellow{background:var(--yellow);animation:pulse 1s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  .running-label{font-size:12px;color:var(--yellow);margin-left:4px}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);border-bottom:1px solid var(--border)}
  td{padding:10px 12px;border-bottom:1px solid var(--border);font-size:13px;vertical-align:top}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:rgba(255,255,255,.02)}
  .badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
  .badge-success{background:rgba(63,185,80,.15);color:var(--green)}
  .badge-error{background:rgba(248,81,73,.15);color:var(--red)}
  .badge-running{background:rgba(210,153,34,.15);color:var(--yellow)}
  .num{font-variant-numeric:tabular-nums}
  .muted{color:var(--muted)}
  .error-msg{color:var(--red);font-size:12px;margin-top:4px;max-width:320px;word-break:break-word}
  .section-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
  .section-title{font-size:14px;font-weight:600;color:#e6edf3}
  .refresh-note{font-size:11px;color:var(--muted)}
  #countdown{color:var(--blue)}
</style>
</head>
<body>
<h1>Uptime Kuma Sync Daemon</h1>
<p class="subtitle" id="subtitle">Loading...</p>

<div class="grid" id="stats-grid">
  <div class="card"><div class="card-label">Status</div><div class="card-value" id="stat-status">—</div><div class="card-sub" id="stat-running"></div></div>
  <div class="card"><div class="card-label">Next Sync</div><div class="card-value blue" id="stat-next">—</div><div class="card-sub" id="stat-next-abs"></div></div>
  <div class="card"><div class="card-label">Last Result</div><div class="card-value" id="stat-result">—</div><div class="card-sub" id="stat-counts"></div></div>
  <div class="card"><div class="card-label">Total Syncs</div><div class="card-value" id="stat-total">—</div><div class="card-sub" id="stat-errors"></div></div>
</div>

<div class="actions">
  <button class="btn btn-primary" id="btn-sync" onclick="triggerSync()">▶ Sync Now</button>
  <span id="sync-msg" class="muted" style="font-size:12px"></span>
</div>

<div class="card">
  <div class="section-header">
    <span class="section-title">Sync History</span>
    <span class="refresh-note">auto-refreshes every 15s</span>
  </div>
  <table>
    <thead><tr>
      <th>#</th><th>Started</th><th>Duration</th><th>Trigger</th>
      <th>Created</th><th>Updated</th><th>Skipped</th><th>Status Pages</th><th>Status</th>
    </tr></thead>
    <tbody id="history-body"><tr><td colspan="9" class="muted">Loading...</td></tr></tbody>
  </table>
</div>

<script>
let nextSyncTs = null;
let countdownTimer = null;

function fmt(iso){
  if(!iso) return '—';
  const d=new Date(iso);
  return d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
function dur(ms){
  if(ms==null) return '—';
  if(ms<1000) return ms+'ms';
  return (ms/1000).toFixed(1)+'s';
}
function countdown(ts){
  if(!ts) return '—';
  const diff=Math.max(0,Math.round((new Date(ts)-Date.now())/1000));
  const m=Math.floor(diff/60), s=diff%60;
  return m>0 ? m+'m '+String(s).padStart(2,'0')+'s' : s+'s';
}

function startCountdown(){
  if(countdownTimer) clearInterval(countdownTimer);
  countdownTimer=setInterval(()=>{
    const el=document.getElementById('stat-next');
    if(el && nextSyncTs) el.textContent=countdown(nextSyncTs);
  },1000);
}

async function load(){
  try{
    const [status, history] = await Promise.all([
      fetch('/api/status').then(r=>r.json()),
      fetch('/api/history').then(r=>r.json())
    ]);

    document.getElementById('subtitle').textContent=
      status.source+' → '+status.target+' every '+status.intervalMin+'m  •  mode: '+status.mode;

    // Status card
    const statEl=document.getElementById('stat-status');
    const runEl=document.getElementById('stat-running');
    if(status.running){
      statEl.textContent='Running'; statEl.className='card-value yellow';
      runEl.innerHTML='<span class="status-dot dot-yellow"></span> sync in progress';
    } else {
      statEl.textContent='Idle'; statEl.className='card-value green';
      runEl.textContent='';
    }

    // Next sync
    nextSyncTs=status.nextSyncAt;
    document.getElementById('stat-next').textContent=countdown(nextSyncTs);
    document.getElementById('stat-next-abs').textContent=fmt(nextSyncTs);

    // Last result
    const last=history[history.length-1];
    const resEl=document.getElementById('stat-result');
    const cntEl=document.getElementById('stat-counts');
    if(last){
      if(last.status==='success'){
        resEl.textContent='Success'; resEl.className='card-value green';
        cntEl.textContent='+'+last.created+' created  •  '+last.updated+' updated  •  '+last.skipped+' skipped';
      } else if(last.status==='error'){
        resEl.textContent='Error'; resEl.className='card-value red';
        cntEl.textContent=last.error||'unknown error';
      } else {
        resEl.textContent='—'; resEl.className='card-value';
        cntEl.textContent='';
      }
    } else {
      resEl.textContent='None yet'; resEl.className='card-value muted';
      cntEl.textContent='';
    }

    // Total / errors
    const errors=history.filter(h=>h.status==='error').length;
    document.getElementById('stat-total').textContent=history.length;
    document.getElementById('stat-errors').textContent=errors>0 ? errors+' error'+(errors>1?'s':'') : 'No errors';

    // History table
    const tbody=document.getElementById('history-body');
    if(!history.length){
      tbody.innerHTML='<tr><td colspan="9" class="muted">No syncs yet</td></tr>';
    } else {
      tbody.innerHTML=[...history].reverse().map(h=>{
        const sp=h.statusPages||{};
        const spStr=(sp.created||0)+'c / '+(sp.updated||0)+'u'+(sp.failed?' / '+sp.failed+'f':'');
        const badge=h.status==='success'?'badge-success':h.status==='error'?'badge-error':'badge-running';
        return '<tr>'+
          '<td class="num muted">'+h.seq+'</td>'+
          '<td class="num">'+fmt(h.startedAt)+'</td>'+
          '<td class="num">'+dur(h.durationMs)+'</td>'+
          '<td>'+h.trigger+'</td>'+
          '<td class="num">'+(h.created!=null?'+'+h.created:'—')+'</td>'+
          '<td class="num">'+(h.updated!=null?h.updated:'—')+'</td>'+
          '<td class="num">'+(h.skipped!=null?h.skipped:'—')+'</td>'+
          '<td class="num">'+spStr+'</td>'+
          '<td><span class="badge '+badge+'">'+(h.status||'—')+'</span>'+
            (h.error?'<div class="error-msg">'+h.error+'</div>':'')+'</td>'+
        '</tr>';
      }).join('');
    }

    document.getElementById('btn-sync').disabled=status.running;
  } catch(e){ console.error('Load error',e); }
}

async function triggerSync(){
  const btn=document.getElementById('btn-sync');
  const msg=document.getElementById('sync-msg');
  btn.disabled=true;
  msg.textContent='Triggering sync...';
  try{
    const r=await fetch('/api/sync',{method:'POST'});
    const d=await r.json();
    if(d.ok){ msg.textContent='Sync started'; } else { msg.textContent=d.error||'Failed'; }
  } catch(e){ msg.textContent='Request failed'; }
  setTimeout(()=>{ msg.textContent=''; load(); },2000);
}

load();
startCountdown();
setInterval(load, 15000);
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/') {
    return htmlResponse(res, UI_HTML);
  }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    return jsonResponse(res, {
      source: SOURCE,
      target: TARGET,
      mode: SYNC_MODE,
      intervalS: INTERVAL_S,
      intervalMin: Math.round(INTERVAL_S / 60),
      running,
      nextSyncAt: nextSyncAt?.toISOString() || null
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/history') {
    return jsonResponse(res, loadHistory());
  }

  if (req.method === 'POST' && url.pathname === '/api/sync') {
    if (running) {
      return jsonResponse(res, { ok: false, error: 'Sync already in progress' }, 409);
    }
    // Fire and don't await — let it run in background
    runSync('manual').catch(err => console.error('[daemon] Manual sync error:', err));
    return jsonResponse(res, { ok: true });
  }

  res.writeHead(404);
  res.end('Not found');
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

server.listen(PORT, () => {
  console.log(`[daemon] Uptime Kuma Sync Daemon started`);
  console.log(`[daemon] Source: ${SOURCE}  Target: ${TARGET}  Mode: ${SYNC_MODE}`);
  console.log(`[daemon] Interval: ${INTERVAL_S}s  UI: http://localhost:${PORT}`);
});

// Run once immediately on start, then schedule
runSync('startup').then(() => scheduleNext()).catch(err => {
  console.error('[daemon] Startup sync failed:', err.message);
  scheduleNext();
});
