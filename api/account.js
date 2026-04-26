import { getAccount, checkAuth } from './_lib.js';

export default async function handler(req, res) {
  if (!checkAuth(req, res)) return;
  try { res.json(await getAccount()); }
  catch (e) { res.status(500).json({ error: e.message }); }
}
