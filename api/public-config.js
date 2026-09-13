// GET /api/public-config.js
// Gera o config.js em produção a partir das variáveis de ambiente do Vercel,
// pra nunca precisar commitar a URL/chave do Supabase no git.
// A chave "publishable" do Supabase é segura de expor no navegador por
// design (é o RLS que protege os dados) — só a URL do projeto + essa chave.
module.exports = function handler(req, res) {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_ANON_KEY || '';

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');

  if (!url || !key) {
    res.status(200).send(
      "console.error('Configure SUPABASE_URL e SUPABASE_ANON_KEY nas variáveis de ambiente do Vercel.');"
    );
    return;
  }

  res.status(200).send(
    `if (!window.SUPABASE_URL) { window.SUPABASE_URL = ${JSON.stringify(url)}; window.SUPABASE_ANON_KEY = ${JSON.stringify(key)}; }`
  );
};
