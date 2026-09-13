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
    // Muitos bancos (Itaú, Nubank, Santander, Mercado Pago...) usam OAuth do
    // Open Finance: o navegador é levado pro site do banco pra fazer login e
    // depois precisa saber pra onde voltar. Sem isso a conexão trava numa
    // página em branco no celular (no desktop o popup só se fecha sozinho).
    if (body.oauthRedirectUri) payload.options.oauthRedirectUri = String(body.oauthRedirectUri);

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
