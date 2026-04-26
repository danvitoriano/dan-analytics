const ACCESS_TOKEN = process.env.ACCESS_TOKEN || '';
const IG_USER_ID = '17841400529260114';
const BASE_URL = 'https://graph.facebook.com/v25.0';

async function apiFetch(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set('access_token', ACCESS_TOKEN);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString());
  const data = await res.json();

  if (data.error) {
    throw new Error(`API Error ${data.error.code}: ${data.error.message}`);
  }

  return data;
}

function formatNumber(n) {
  return n?.toLocaleString('pt-BR') ?? 'N/A';
}

function printSection(title) {
  console.log('\n' + '─'.repeat(50));
  console.log(`  ${title}`);
  console.log('─'.repeat(50));
}

async function fetchAccountData() {
  const fields = 'username,followers_count,follows_count,media_count,biography';
  return apiFetch(`/${IG_USER_ID}`, { fields });
}

async function fetchInsightsPeriod() {
  const since = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
  const until = Math.floor(Date.now() / 1000);

  return apiFetch(`/${IG_USER_ID}/insights`, {
    metric: 'reach,follower_count',
    period: 'day',
    since,
    until,
  });
}

async function fetchInsightsTotal() {
  const since = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
  const until = Math.floor(Date.now() / 1000);

  return apiFetch(`/${IG_USER_ID}/insights`, {
    metric: 'accounts_engaged,profile_views',
    metric_type: 'total_value',
    period: 'day',
    since,
    until,
  });
}

async function fetchRecentMedia(limit = 10) {
  const fields = 'id,caption,media_type,timestamp,like_count,comments_count';
  const data = await apiFetch(`/${IG_USER_ID}/media`, { fields, limit });
  const posts = data.data ?? [];

  await Promise.all(posts.map(async post => {
    try {
      const ins = await apiFetch(`/${post.id}/insights`, { metric: 'reach,saved' });
      for (const m of ins.data ?? []) {
        post[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? null;
      }
    } catch {
      // insights indisponíveis para este post
    }
  }));

  return posts;
}

function sumMetric(data, metricName) {
  const entry = data.find(d => d.name === metricName);
  if (!entry) return null;
  if (entry.total_value !== undefined) return entry.total_value.value ?? entry.total_value;
  return entry.values.reduce((acc, v) => acc + (v.value || 0), 0);
}

async function main() {
  console.log('\n📊 Instagram Metrics — Meta Graph API v25.0');
  console.log(`   Conta ID: ${IG_USER_ID}`);
  console.log(`   Data: ${new Date().toLocaleString('pt-BR')}`);

  let account, periodData, totalData, media;

  try {
    account = await fetchAccountData();
  } catch (err) {
    console.error(`\n❌ Falha ao buscar dados da conta: ${err.message}`);
    process.exit(1);
  }

  printSection('Dados da Conta');
  console.log(`  Username    : @${account.username}`);
  console.log(`  Seguidores  : ${formatNumber(account.followers_count)}`);
  console.log(`  Seguindo    : ${formatNumber(account.follows_count)}`);
  console.log(`  Publicações : ${formatNumber(account.media_count)}`);
  if (account.biography) {
    console.log(`  Bio         : ${account.biography.replace(/\n/g, ' ')}`);
  }

  try {
    [periodData, totalData, media] = await Promise.all([fetchInsightsPeriod(), fetchInsightsTotal(), fetchRecentMedia()]);
  } catch (err) {
    console.error(`\n⚠️  Falha ao buscar insights (últimos 7 dias): ${err.message}`);
    console.log('   Verifique se o token tem permissão instagram_manage_insights.');
    console.log('\n' + '─'.repeat(50));
    return;
  }

  const periodInsights = periodData.data ?? [];
  const totalInsights = totalData.data ?? [];
  const insightData = [...periodInsights, ...totalInsights];

  printSection('Insights — Últimos 7 Dias');
  console.log(`  Alcance (reach)       : ${formatNumber(sumMetric(insightData, 'reach'))}`);
  console.log(`  Contas engajadas      : ${formatNumber(sumMetric(insightData, 'accounts_engaged'))}`);
  console.log(`  Visitas ao perfil     : ${formatNumber(sumMetric(insightData, 'profile_views'))}`);
  console.log(`  Novos seguidores      : ${formatNumber(sumMetric(insightData, 'follower_count'))}`);
  console.log('─'.repeat(50));

  printSection('Últimos 10 Posts');
  for (const post of media) {
    const date = new Date(post.timestamp).toLocaleDateString('pt-BR');
    const caption = (post.caption ?? '').replace(/\n/g, ' ').slice(0, 50);
    const preview = caption ? `"${caption}${caption.length === 50 ? '…' : ''}"` : `[${post.media_type}]`;
    console.log(`\n  ${date} — ${preview}`);
    console.log(`    Curtidas    : ${formatNumber(post.like_count)}`);
    console.log(`    Comentários : ${formatNumber(post.comments_count)}`);
    console.log(`    Alcance     : ${formatNumber(post.reach)}`);
    console.log(`    Salvos      : ${formatNumber(post.saved)}`);
  }
  console.log('\n' + '─'.repeat(50) + '\n');
}

main();
