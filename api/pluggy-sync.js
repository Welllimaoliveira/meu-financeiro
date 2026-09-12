// POST /api/pluggy-sync  { itemId }
// Busca as contas/saldos do item conectado na Pluggy. Não toca no Supabase
// aqui — devolve os dados crus pro navegador salvar já autenticado como o
// usuário logado (assim o RLS do Supabase se aplica normalmente).
const { obterApiKeyPluggy } = require('./_pluggy-auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const { itemId } = body;
  if (!itemId) return res.status(400).json({ error: 'itemId é obrigatório' });

  try {
    const apiKey = await obterApiKeyPluggy();
    const [accountsResp, itemResp] = await Promise.all([
      fetch(`https://api.pluggy.ai/accounts?itemId=${encodeURIComponent(itemId)}`, { headers: { 'X-API-KEY': apiKey } }),
      fetch(`https://api.pluggy.ai/items/${encodeURIComponent(itemId)}`, { headers: { 'X-API-KEY': apiKey } }),
    ]);
    if (!accountsResp.ok) throw new Error('Falha ao buscar contas: ' + await accountsResp.text());
    const accountsData = await accountsResp.json();
    const itemData = itemResp.ok ? await itemResp.json() : null;

    res.status(200).json({
      accounts: accountsData.results || [],
      instituicao: itemData?.connector?.name || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
