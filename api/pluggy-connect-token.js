// POST /api/pluggy-connect-token
// Devolve um connectToken de uso único pro widget Pluggy Connect abrir.
// Roda no servidor (Vercel Function) pra nunca expor o CLIENT_SECRET no navegador.
const { obterApiKeyPluggy } = require('./_pluggy-auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  try {
    const apiKey = await obterApiKeyPluggy();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const payload = { options: {} };
    if (body.clientUserId) payload.options.clientUserId = String(body.clientUserId);
    if (body.itemId) payload.itemId = body.itemId; // presente = modo "atualizar conexão existente"

    const tokenResp = await fetch('https://api.pluggy.ai/connect_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      body: JSON.stringify(payload),
    });
    if (!tokenResp.ok) throw new Error('Falha ao criar connect token: ' + await tokenResp.text());
    const { accessToken } = await tokenResp.json();
    res.status(200).json({ accessToken });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
