const BASE_URL = 'https://graph.facebook.com/v25.0';

export const CONFIG = {
  token: process.env.ACCESS_TOKEN || '',
  userId: process.env.IG_USER_ID || '17841400529260114',
};

export function checkAuth(req, res) {
  const pwd = process.env.DASHBOARD_PASSWORD;
  if (!pwd) return true;
  if ((req.headers['x-password'] || '') !== pwd) {
    res.status(401).json({ error: 'Senha incorreta' });
    return false;
  }
  return true;
}

export async function apiFetch(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set('access_token', CONFIG.token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  const data = await res.json();
  if (data.error) throw new Error(`${data.error.code}: ${data.error.message}`);
  return data;
}

export async function getAccount() {
  return apiFetch(`/${CONFIG.userId}`, {
    fields: 'username,followers_count,follows_count,media_count,biography,profile_picture_url',
  });
}

export function chunkRange(since, until, chunkDays = 30) {
  const chunks = [];
  let s = since;
  while (s < until) {
    const e = Math.min(s + chunkDays * 86400, until);
    chunks.push([s, e]);
    s = e;
  }
  return chunks;
}

export async function getInsights(since, until) {
  const chunks = chunkRange(since, until);
  const result = {};
  const last30Since = Math.floor((Date.now() - 30 * 86400000) / 1000);
  const last30Until = Math.floor(Date.now() / 1000);

  for (const [s, u] of chunks) {
    const [p, t] = await Promise.all([
      apiFetch(`/${CONFIG.userId}/insights`, { metric: 'reach', period: 'day', since: s, until: u }),
      apiFetch(`/${CONFIG.userId}/insights`, { metric: 'accounts_engaged,profile_views', metric_type: 'total_value', period: 'day', since: s, until: u }),
    ]);
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
  } catch {}

  return result;
}

export async function getMedia(sinceTs, untilTs) {
  const sinceDate = new Date(sinceTs * 1000);
  const posts = [];
  let done = false;

  let page = await apiFetch(`/${CONFIG.userId}/media`, {
    fields: 'id,caption,media_type,timestamp,like_count,comments_count,permalink,thumbnail_url,media_url',
    limit: 100,
  });

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
      const ins = await apiFetch(`/${post.id}/insights`, { metric: 'reach,saved,shares' });
      for (const m of ins.data ?? []) {
        post[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? null;
      }
    } catch {}
  }));

  await generateTitles(posts);
  return posts;
}

export async function generateTitles(posts) {
  const key = process.env.GROQ_API_KEY;
  if (!key || !posts.length) return;

  const items = posts.map((p, i) => ({
    i,
    caption: (p.caption || '').slice(0, 300),
    type: p.media_type,
    likes: p.like_count,
    reach: p.reach,
  }));

  const prompt = `Você é um especialista em conteúdo de redes sociais.
Para cada post do Instagram abaixo, crie um título curto (máximo 6 palavras) em português que capture o tema central — sem hashtags, sem emoji, direto ao ponto. Seja específico e criativo.
Retorne SOMENTE um JSON válido: array de objetos com "i" (índice) e "title" (string).

Posts:
${JSON.stringify(items)}`;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        response_format: { type: 'json_object' },
      }),
    });
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) return;
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : (parsed.titles ?? parsed.posts ?? Object.values(parsed)[0]);
    if (!Array.isArray(list)) return;
    for (const { i, title } of list) {
      if (posts[i]) posts[i].ai_title = title;
    }
  } catch {}
}
