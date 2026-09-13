// ============================================================
// Abre o widget da Pluggy (Open Finance) e, no sucesso, manda
// buscar o saldo real e salvar no Supabase via app.js.
// Módulo ES — importado direto do CDN, sem precisar de build.
// Usa o endpoint "+esm" do jsDelivr: o pacote original importa seus
// próprios arquivos internos sem extensão ".js" (from './pluggy-connect'),
// o que funciona em bundlers mas quebra silenciosamente em ESM nativo do
// navegador — o "+esm" reempacota tudo num módulo válido.
// ============================================================
import { PluggyConnect } from 'https://cdn.jsdelivr.net/npm/pluggy-connect-sdk@2.14.2/+esm';

const PLUGGY_RESUME_KEY = 'pluggy_oauth_pending';
const PLUGGY_RESUME_MAX_IDADE_MS = 15 * 60 * 1000; // 15 min

window.iniciarConexaoPluggy = async function iniciarConexaoPluggy() {
  const statusEl = document.getElementById('pluggyStatus');
  const btn = document.getElementById('btnConectarBanco');
  statusEl.style.color = '';
  statusEl.textContent = 'Abrindo conexão segura com a Pluggy...';
  btn.disabled = true;

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    // URL "limpa" (sem query/hash) pra onde a Pluggy deve trazer o usuário de
    // volta depois do login no site do banco — necessário pra bancos que usam
    // OAuth (Itaú, Nubank, Santander, Mercado Pago...). Sem isso a conexão
    // trava numa página em branco no celular (no desktop o popup só se fecha
    // sozinho, por isso o problema só aparecia no celular).
    const oauthRedirectUri = window.location.origin + window.location.pathname;
    const resp = await fetch('/api/pluggy-connect-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientUserId: user?.id || 'meu-financeiro', oauthRedirectUri }),
    });
    if (!resp.ok) throw new Error(await resp.text());
    const { accessToken } = await resp.json();

    sessionStorage.setItem(PLUGGY_RESUME_KEY, String(Date.now()));

    const pluggyConnect = new PluggyConnect({
      connectToken: accessToken,
      includeSandbox: true, // deixa aparecer o "Pluggy Bank" de teste enquanto vocês não têm chave de produção
      onSuccess: async (itemData) => {
        try {
          sessionStorage.removeItem(PLUGGY_RESUME_KEY);
          statusEl.textContent = 'Conectado! Buscando saldo...';
          const itemId = itemData?.item?.id;
          if (!itemId) throw new Error('a Pluggy não devolveu o id da conexão (item.id ausente)');
          await sincronizarPluggy(itemId, itemData.item.connector?.name || 'Banco conectado');
        } catch (err) {
          console.error('Erro no onSuccess do Pluggy Connect', err);
          statusEl.textContent = 'Conectou, mas deu erro ao processar: ' + err.message;
          btn.disabled = false;
        }
      },
      onError: (error) => {
        sessionStorage.removeItem(PLUGGY_RESUME_KEY);
        console.error('Pluggy onError', error);
        const motivo = error?.message || error?.data?.message || 'erro desconhecido';
        statusEl.textContent = 'Não deu pra conectar (' + motivo + '). Tente de novo — conexões com bancos reais às vezes falham na primeira tentativa.';
        statusEl.style.color = 'var(--danger)';
        btn.disabled = false;
      },
      onClose: () => { btn.disabled = false; },
    });
    await pluggyConnect.init();
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Erro ao iniciar conexão: ' + err.message;
    btn.disabled = false;
  }
};

async function sincronizarPluggy(itemId, instituicao) {
  const statusEl = document.getElementById('pluggyStatus');
  try {
    const resp = await fetch('/api/pluggy-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId }),
    });
    if (!resp.ok) throw new Error(await resp.text());
    const { accounts, instituicao: nomeInstituicao } = await resp.json();
    await window.salvarContasPluggy(itemId, nomeInstituicao || instituicao, accounts);
    statusEl.textContent = `${accounts.length} conta(s) importada(s) de ${nomeInstituicao || instituicao}.`;
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Conectou, mas falhou ao buscar saldo: ' + err.message;
  } finally {
    document.getElementById('btnConectarBanco').disabled = false;
  }
}

// ---------- Retomar sozinho ao voltar do site do banco (OAuth) ----------
// Bancos como Itaú/Nubank/Santander/Mercado Pago redirecionam o navegador
// pro site deles pra fazer login. No celular isso navega a aba inteira pra
// fora do nosso app e, ao voltar, a página recarrega do zero — perdendo
// qualquer estado de JavaScript. Por isso guardamos um sinalizador antes de
// sair (sessionStorage) e, se ele existir quando a página carrega de novo,
// reabrimos o widget automaticamente: a própria Pluggy detecta pela URL que
// é uma volta de OAuth e resolve a conexão sem pedir os dados de novo.
async function tentarRetomarConexaoPluggy() {
  const marcado = sessionStorage.getItem(PLUGGY_RESUME_KEY);
  if (!marcado) return;
  if (Date.now() - Number(marcado) > PLUGGY_RESUME_MAX_IDADE_MS) {
    sessionStorage.removeItem(PLUGGY_RESUME_KEY);
    return;
  }

  // Espera o login (Supabase) e a tela do app carregarem antes de continuar.
  for (let tentativas = 0; tentativas < 40; tentativas++) {
    const appEl = document.getElementById('app');
    if (appEl && !appEl.classList.contains('hidden') && window.iniciarConexaoPluggy) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (document.getElementById('app')?.classList.contains('hidden')) return; // não logado, desiste

  document.querySelector('nav button[data-tela="cartoes"]')?.click();
  const statusEl = document.getElementById('pluggyStatus');
  if (statusEl) statusEl.textContent = 'Voltando da conexão com o banco, finalizando...';
  window.iniciarConexaoPluggy();
}

tentarRetomarConexaoPluggy();
