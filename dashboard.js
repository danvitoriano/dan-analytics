import http from 'http';
import { URL } from 'url';

const PORT = process.env.PORT || 3333;
const BASE_URL = 'https://graph.facebook.com/v25.0';

const CONFIG = {
  token: process.env.ACCESS_TOKEN || '',
  userId: '17841400529260114',
};

async function apiFetch(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set('access_token', CONFIG.token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  const data = await res.json();
  if (data.error) throw new Error(`${data.error.code}: ${data.error.message}`);
  return data;
}

async function getAccount() {
  return apiFetch(`/${CONFIG.userId}`, {
    fields: 'username,followers_count,follows_count,media_count,biography,profile_picture_url',
  });
}

function chunkRange(since, until, chunkDays = 30) {
  const chunks = [];
  let s = since;
  while (s < until) {
    const e = Math.min(s + chunkDays * 86400, until);
    chunks.push([s, e]);
    s = e;
  }
  return chunks;
}

async function getInsights(since, until) {
  const chunks = chunkRange(since, until);
  const result = {};

  // follower_count só suporta os últimos 30 dias — buscamos separado
  const last30Since = Math.floor((Date.now() - 30 * 86400000) / 1000);
  const last30Until = Math.floor(Date.now() / 1000);

  for (const [s, u] of chunks) {
    const calls = [
      apiFetch(`/${CONFIG.userId}/insights`, { metric: 'reach', period: 'day', since: s, until: u }),
      apiFetch(`/${CONFIG.userId}/insights`, { metric: 'accounts_engaged,profile_views', metric_type: 'total_value', period: 'day', since: s, until: u }),
    ];
    const [p, t] = await Promise.all(calls);
    const all = [...(p.data ?? []), ...(t.data ?? [])];
    for (const m of all) {
      const val = m.total_value !== undefined
        ? (m.total_value?.value ?? m.total_value)
        : (m.values ?? []).reduce((a, v) => a + (v.value || 0), 0);
      result[m.name] = (result[m.name] ?? 0) + val;
    }
  }

  try {
    const fc = await apiFetch(`/${CONFIG.userId}/insights`, {
      metric: 'follower_count', period: 'day', since: last30Since, until: last30Until,
    });
    const m = fc.data?.[0];
    if (m) result.follower_count = (m.values ?? []).reduce((a, v) => a + (v.value || 0), 0);
    result.follower_count_note = '(últimos 30 dias)';
  } catch {}

  return result;
}

async function getMedia(sinceTs, untilTs) {
  const sinceDate = new Date(sinceTs * 1000);
  const posts = [];
  let nextUrl = null;
  let done = false;

  const firstPage = await apiFetch(`/${CONFIG.userId}/media`, {
    fields: 'id,caption,media_type,timestamp,like_count,comments_count,permalink,thumbnail_url,media_url',
    limit: 100,
  });

  let page = firstPage;

  while (!done) {
    for (const post of page.data ?? []) {
      const postDate = new Date(post.timestamp);
      if (postDate < sinceDate) { done = true; break; }
      if (postDate <= new Date(untilTs * 1000)) posts.push(post);
    }
    if (!done && page.paging?.next) {
      const res = await fetch(page.paging.next);
      page = await res.json();
      if (page.error) break;
    } else {
      done = true;
    }
  }

  await Promise.all(posts.map(async post => {
    try {
      const ins = await apiFetch(`/${post.id}/insights`, { metric: 'reach,saved' });
      for (const m of ins.data ?? []) {
        post[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? null;
      }
    } catch {}
  }));

  return posts;
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

const HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Instagram Dashboard</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f0f; color: #e0e0e0; min-height: 100vh; }
  header { background: linear-gradient(135deg, #833ab4, #fd1d1d, #fcb045); padding: 1px; }
  header > div { background: #0f0f0f; padding: 14px 24px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  header h1 { font-size: 18px; font-weight: 700; background: linear-gradient(135deg, #833ab4, #fd1d1d, #fcb045); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-right: 8px; }
  .controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  input[type=date] { background: #1e1e1e; border: 1px solid #333; color: #e0e0e0; padding: 6px 10px; border-radius: 6px; font-size: 13px; color-scheme: dark; }
  .presets { display: flex; gap: 6px; flex-wrap: wrap; }
  .preset { background: #1e1e1e; border: 1px solid #333; color: #aaa; padding: 5px 11px; border-radius: 6px; font-size: 12px; cursor: pointer; }
  .preset:hover, .preset.active { background: #2a2a2a; border-color: #833ab4; color: #fff; }
  .btn-load { background: linear-gradient(135deg, #833ab4, #fd1d1d); border: none; color: #fff; padding: 7px 18px; border-radius: 6px; font-size: 13px; cursor: pointer; font-weight: 600; margin-left: 4px; }
  .btn-load:hover { opacity: 0.85; }
  .sep { color: #444; font-size: 12px; }
  main { padding: 24px; max-width: 1200px; margin: 0 auto; }
  .profile { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
  .profile img { width: 64px; height: 64px; border-radius: 50%; border: 2px solid #833ab4; }
  .profile .name { font-size: 20px; font-weight: 700; }
  .profile .bio { font-size: 13px; color: #999; margin-top: 4px; max-width: 500px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; margin-bottom: 28px; }
  .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 10px; padding: 16px; text-align: center; }
  .card .val { font-size: 24px; font-weight: 700; color: #fff; }
  .card .lbl { font-size: 11px; color: #777; margin-top: 4px; text-transform: uppercase; letter-spacing: .5px; }
  h2 { font-size: 14px; font-weight: 600; color: #aaa; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
  th { text-align: left; padding: 8px 10px; color: #666; font-weight: 600; border-bottom: 1px solid #222; cursor: pointer; white-space: nowrap; }
  th:hover { color: #aaa; }
  td { padding: 9px 10px; border-bottom: 1px solid #1a1a1a; vertical-align: middle; }
  tr:hover td { background: #161616; }
  .caption { color: #ccc; word-break: break-word; white-space: normal; }
  .caption a { color: #ccc; }
  .caption a:hover { color: #b06bff; }
  .num { text-align: right; color: #e0e0e0; white-space: nowrap; }
  .thumb { width: 40px; height: 40px; object-fit: cover; border-radius: 4px; }
  .thumb-ph { width: 40px; height: 40px; border-radius: 4px; background: #222; display: inline-block; }
  .error { background: #2a1010; border: 1px solid #5a2020; border-radius: 8px; padding: 14px 18px; color: #e07070; margin-bottom: 20px; font-size: 13px; }
  .loading { text-align: center; padding: 60px; color: #555; font-size: 14px; }
  .section { margin-bottom: 32px; }
  .sort-arrow { font-size: 10px; margin-left: 2px; }
  .post-count { font-size: 12px; color: #555; margin-bottom: 10px; }
  @media (max-width: 700px) {
    .col-reach, .col-saved { display: none; }
  }
  @media (max-width: 500px) {
    .col-date, .col-comments { display: none; }
  }
  .filters { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
  .filter-btn { background: #1a1a1a; border: 1px solid #333; color: #aaa; padding: 5px 14px; border-radius: 20px; font-size: 12px; cursor: pointer; }
  .filter-btn:hover { border-color: #555; color: #fff; }
  .filter-btn.active { border-color: #833ab4; color: #fff; background: #2a1a3a; }
</style>
</head>
<body>
<header><div>
  <h1>Instagram Dashboard</h1>
  <div class="presets">
    <button class="preset" onclick="setPreset(7)">7d</button>
    <button class="preset" onclick="setPreset(30)">30d</button>
    <button class="preset" onclick="setPreset(90)">90d</button>
    <button class="preset" onclick="setPreset(180)">6m</button>
    <button class="preset" onclick="setPreset(365)">1a</button>
    <button class="preset" onclick="setPreset(729)">2a</button>
    <button class="preset" onclick="setPreset(0)">Tudo</button>
  </div>
  <span class="sep">|</span>
  <input type="date" id="dateFrom">
  <span class="sep">até</span>
  <input type="date" id="dateTo">
  <button class="btn-load" onclick="load()">Buscar</button>
</div></header>

<main>
  <div id="root"><div class="loading">Carregando...</div></div>
</main>

<script>
let sortKey = 'timestamp', sortDir = -1;
let activeFilter = 'all';

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function setPreset(days) {
  document.querySelectorAll('.preset').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  const until = new Date();
  const since = days === 0 ? new Date('2010-01-01') : new Date(Date.now() - days * 86400000);
  document.getElementById('dateFrom').value = toDateStr(since);
  document.getElementById('dateTo').value = toDateStr(until);
}

function initDates() {
  const until = new Date();
  const since = new Date(Date.now() - 30 * 86400000);
  document.getElementById('dateFrom').value = toDateStr(since);
  document.getElementById('dateTo').value = toDateStr(until);
  document.querySelector('.preset[onclick="setPreset(30)"]').classList.add('active');
}

function fmt(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('pt-BR');
}

function sortBy(key) {
  if (sortKey === key) sortDir *= -1;
  else { sortKey = key; sortDir = -1; }
  applyFilter();
}

function setFilter(f) {
  activeFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(\`.filter-btn[data-f="\${f}"]\`)?.classList.add('active');
  applyFilter();
}

function applyFilter() {
  let posts = window._allPosts ?? [];
  if (activeFilter === 'top') {
    posts = [...posts].sort((a, b) =>
      ((b.like_count ?? 0) + (b.comments_count ?? 0) + (b.saved ?? 0)) -
      ((a.like_count ?? 0) + (a.comments_count ?? 0) + (a.saved ?? 0))
    ).slice(0, 10);
  } else if (activeFilter === 'alura') {
    posts = posts.filter(p => (p.caption || '').toLowerCase().includes('alura'));
  }
  renderPosts(posts);
}

function renderPosts(posts) {
  const sorted = [...posts].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    if (typeof av === 'string') return sortDir * av.localeCompare(bv ?? '');
    return sortDir * ((av ?? -1) - (bv ?? -1));
  });

  const arrow = k => sortKey === k ? (sortDir === 1 ? '↑' : '↓') : '';

  const rows = sorted.map(p => {
    const date = new Date(p.timestamp).toLocaleDateString('pt-BR');
    const thumb = p.thumbnail_url || p.media_url
      ? \`<img class="thumb" src="\${p.thumbnail_url || p.media_url}" onerror="this.className='thumb-ph'">\`
      : '<span class="thumb-ph"></span>';
    const caption = (p.caption || '').replace(/\\n/g, ' ');
    return \`<tr>
      <td style="width:50px">\${thumb}</td>
      <td class="caption">\${caption ? \`<a href="\${p.permalink}" target="_blank">\${caption}</a>\` : '<span style="color:#555">—</span>'}</td>
      <td class="num col-date" style="width:95px">\${date}</td>
      <td class="num" style="width:70px">\${fmt(p.like_count)}</td>
      <td class="num col-comments" style="width:70px">\${fmt(p.comments_count)}</td>
      <td class="num col-reach" style="width:80px">\${fmt(p.reach)}</td>
      <td class="num col-saved" style="width:68px">\${fmt(p.saved)}</td>
    </tr>\`;
  }).join('');

  document.getElementById('posts-table').innerHTML = \`
    <div class="filters">
      <button class="filter-btn\${activeFilter==='all'?' active':''}" data-f="all" onclick="setFilter('all')">Todos</button>
      <button class="filter-btn\${activeFilter==='top'?' active':''}" data-f="top" onclick="setFilter('top')">🏆 Top 10 Engajamento</button>
      <button class="filter-btn\${activeFilter==='alura'?' active':''}" data-f="alura" onclick="setFilter('alura')">🎓 Posts da Alura</button>
    </div>
    <p class="post-count">\${posts.length} post\${posts.length !== 1 ? 's' : ''}\${activeFilter !== 'all' ? ' filtrados' : ' no período'}</p>
    <table>
      <thead><tr>
        <th style="width:50px"></th>
        <th onclick="sortBy('caption')">Legenda <span class="sort-arrow">\${arrow('caption')}</span></th>
        <th class="num col-date" style="width:95px" onclick="sortBy('timestamp')">Data <span class="sort-arrow">\${arrow('timestamp')}</span></th>
        <th class="num" style="width:70px" onclick="sortBy('like_count')">❤️ <span class="sort-arrow">\${arrow('like_count')}</span></th>
        <th class="num col-comments" style="width:70px" onclick="sortBy('comments_count')">💬 <span class="sort-arrow">\${arrow('comments_count')}</span></th>
        <th class="num col-reach" style="width:80px" onclick="sortBy('reach')">Alcance <span class="sort-arrow">\${arrow('reach')}</span></th>
        <th class="num col-saved" style="width:68px" onclick="sortBy('saved')">Salvos <span class="sort-arrow">\${arrow('saved')}</span></th>
      </tr></thead>
      <tbody>\${rows}</tbody>
    </table>\`;
}

async function load() {
  const fromVal = document.getElementById('dateFrom').value;
  const toVal = document.getElementById('dateTo').value;
  if (!fromVal || !toVal) { alert('Selecione as datas'); return; }

  const since = Math.floor(new Date(fromVal).getTime() / 1000);
  const until = Math.floor(new Date(toVal + 'T23:59:59').getTime() / 1000);
  const days = Math.round((until - since) / 86400);

  document.getElementById('root').innerHTML = '<div class="loading">Buscando posts do período... isso pode levar alguns segundos.</div>';

  try {
    const [accRes, insRes] = await Promise.all([
      fetch('/api/account').then(r => r.json()),
      fetch(\`/api/insights?since=\${since}&until=\${until}\`).then(r => r.json()),
    ]);

    if (accRes.error) throw new Error(accRes.error);
    if (insRes.error) throw new Error(insRes.error);

    const acc = accRes;
    const ins = insRes;

    const profilePic = acc.profile_picture_url
      ? \`<img src="\${acc.profile_picture_url}" alt="avatar">\`
      : '<span class="thumb-ph" style="width:64px;height:64px;border-radius:50%"></span>';

    document.getElementById('root').innerHTML = \`
      <div class="profile">
        \${profilePic}
        <div>
          <div class="name">@\${acc.username}</div>
          <div class="bio">\${(acc.biography || '').replace(/\\n/g,' ')}</div>
        </div>
      </div>
      <div class="section">
        <h2>Conta</h2>
        <div class="cards">
          <div class="card"><div class="val">\${fmt(acc.followers_count)}</div><div class="lbl">Seguidores</div></div>
          <div class="card"><div class="val">\${fmt(acc.follows_count)}</div><div class="lbl">Seguindo</div></div>
          <div class="card"><div class="val">\${fmt(acc.media_count)}</div><div class="lbl">Publicações</div></div>
        </div>
      </div>
      <div class="section">
        <h2>Insights — \${days} dias</h2>
        <div class="cards">
          <div class="card"><div class="val">\${fmt(ins.reach)}</div><div class="lbl">Alcance</div></div>
          <div class="card"><div class="val">\${fmt(ins.accounts_engaged)}</div><div class="lbl">Contas engajadas</div></div>
          <div class="card"><div class="val">\${fmt(ins.profile_views)}</div><div class="lbl">Visitas ao perfil</div></div>
          <div class="card"><div class="val">\${fmt(ins.follower_count)}</div><div class="lbl">Novos seguidores</div><div style="font-size:10px;color:#555;margin-top:2px">últimos 30d</div></div>
        </div>
      </div>
      <div class="section">
        <h2>Posts do período</h2>
        <div id="posts-table"><div class="loading">Carregando posts...</div></div>
      </div>
    \`;

    const mediaRes = await fetch(\`/api/media?since=\${since}&until=\${until}\`).then(r => r.json());
    if (mediaRes.error) throw new Error(mediaRes.error);
    window._allPosts = mediaRes;
    activeFilter = 'all';
    applyFilter();

  } catch (e) {
    document.getElementById('root').innerHTML = \`<div class="error">Erro: \${e.message}</div>\`;
  }
}

initDates();
load();
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  if (url.pathname === '/api/account') {
    try { json(res, await getAccount()); }
    catch (e) { json(res, { error: e.message }, 500); }
    return;
  }

  if (url.pathname === '/api/insights') {
    const since = parseInt(url.searchParams.get('since'), 10);
    const until = parseInt(url.searchParams.get('until'), 10);
    try { json(res, await getInsights(since, until)); }
    catch (e) { json(res, { error: e.message }, 500); }
    return;
  }

  if (url.pathname === '/api/media') {
    const since = parseInt(url.searchParams.get('since'), 10);
    const until = parseInt(url.searchParams.get('until'), 10);
    try { json(res, await getMedia(since, until)); }
    catch (e) { json(res, { error: e.message }, 500); }
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`\n📊 Instagram Dashboard rodando em http://localhost:${PORT}\n`);
});
