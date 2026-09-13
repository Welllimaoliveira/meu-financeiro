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

window.iniciarConexaoPluggy = async function iniciarConexaoPluggy() {
  const statusEl = document.getElementById('pluggyStatus');
  const btn = document.getElementById('btnConectarBanco');
  statusEl.style.color = '';
  statusEl.textContent = 'Abrindo conexão segura com a Pluggy...';
  btn.disabled = true;

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const resp = await fetch('/api/pluggy-connect-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientUserId: user?.id || 'meu-financeiro' }),
    });
    if (!resp.ok) throw new Error(await resp.text());
    const { accessToken } = await resp.json();

    const pluggyConnect = new PluggyConnect({
      connectToken: accessToken,
      includeSandbox: true, // deixa aparecer o "Pluggy Bank" de teste enquanto vocês não têm chave de produção
      onSuccess: async (itemData) => {
        try {
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
