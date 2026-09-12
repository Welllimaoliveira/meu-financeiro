// Helper interno (não é uma rota — nome com "_" na frente não vira endpoint).
// Troca CLIENT_ID/CLIENT_SECRET por um apiKey de curta duração (2h).
async function obterApiKeyPluggy() {
  const clientId = process.env.PLUGGY_CLIENT_ID;
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Configure PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET nas variáveis de ambiente do Vercel.');
  }
  const resp = await fetch('https://api.pluggy.ai/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (!resp.ok) throw new Error('Falha ao autenticar na Pluggy: ' + await resp.text());
  const { apiKey } = await resp.json();
  return apiKey;
}

module.exports = { obterApiKeyPluggy };
