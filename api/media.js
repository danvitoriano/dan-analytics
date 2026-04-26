import { getMedia, checkAuth } from './_lib.js';

export default async function handler(req, res) {
  if (!checkAuth(req, res)) return;
  const since = parseInt(req.query.since, 10);
  const until = parseInt(req.query.until, 10);
  try { res.json(await getMedia(since, until)); }
  catch (e) { res.status(500).json({ error: e.message }); }
}
