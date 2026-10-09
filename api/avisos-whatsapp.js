// GET /api/avisos-whatsapp
// Roda sozinha todo dia (agendador da Vercel, ver vercel.json): olha o que
// vence/está atrasado e manda um resumo pro SEU WhatsApp via CallMeBot
// (serviço gratuito, só pra uso pessoal, só manda texto pra você mesmo).
//
// Variáveis de ambiente (Vercel → Settings → Environment Variables):
//   CRON_SECRET       segredo longo. A Vercel manda ele sozinha ao agendar, e a
//                     função do banco só responde com ele (fin_dados_avisos).
//   WHATSAPP_PHONE    seu número com país e DDD, ex.: +5581999999999
//   CALLMEBOT_APIKEY  a chave que o bot do CallMeBot te devolve ao ativar
//   SUPABASE_URL / SUPABASE_ANON_KEY   já existem (usadas pelo config do app)
//
// Parâmetros (só funcionam com o segredo certo):
//   ?dry=1    não envia; devolve o texto que seria enviado
//   ?teste=1  manda uma mensagem curta de teste, mesmo sem nada a avisar
const TZ = 'America/Sao_Paulo';
const DIA_MS = 86400000;
const DIAS_AVISO_PADRAO = 3;
const APP_URL = 'https://meu-financeiro-six-phi.vercel.app';

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (iso) => iso.split('-').reverse().join('/');

// 'YYYY-MM-DD' de hoje no horário de Brasília (o servidor roda em UTC).
function hojeISO(agora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(agora);
}

const utc = (ano, mes, dia) => Date.UTC(ano, mes - 1, dia);
const ultimoDiaDoMes = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
// Vencimento no mês pedido; dia 31 em mês curto vira o último dia do mês.
const vencimentoNoMes = (ano, mes, dia) => utc(ano, mes, Math.min(dia, ultimoDiaDoMes(ano, mes)));

function quando(diff) {
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'amanhã';
  if (diff > 1) return `em ${diff} dias`;
  return `venceu há ${-diff} dia${diff === -1 ? '' : 's'}`;
}

// Monta o texto do aviso a partir do que a função do banco devolveu.
function montarAviso(dados, hoje) {
  const [ano, mes, dia] = hoje.split('-').map(Number);
  const hojeMs = utc(ano, mes, dia);
  const pagas = new Set(dados.pagas || []);

  const atrasadas = [];
  const proximas = [];
  const aReceber = [];
  const aPagarParcelas = [];

  // Contas fixas do mês que ainda não foram pagas.
  (dados.contas || []).filter((c) => !pagas.has(c.id)).forEach((c) => {
    const diff = Math.round((vencimentoNoMes(ano, mes, c.dia_vencimento) - hojeMs) / DIA_MS);
    const janela = c.alerta_dias_antes ?? DIAS_AVISO_PADRAO;
    const linha = { diff, texto: `• ${String(c.nome).trim()} — ${brl(c.valor)} (${quando(diff)})` };
    if (diff < 0) atrasadas.push(linha);
    else if (diff <= janela) proximas.push(linha);
  });

  // Fatura de cartão com valor devedor: próximo vencimento, só se for em breve.
  (dados.cartoes || []).forEach((k) => {
    let venc = vencimentoNoMes(ano, mes, k.dia_vencimento);
    if (venc < hojeMs) venc = vencimentoNoMes(mes === 12 ? ano + 1 : ano, mes === 12 ? 1 : mes + 1, k.dia_vencimento);
    const diff = Math.round((venc - hojeMs) / DIA_MS);
    if (diff <= DIAS_AVISO_PADRAO) {
      proximas.push({ diff, texto: `• Fatura ${String(k.nome).trim()} — ${brl(k.saldo_devedor)} (${quando(diff)})` });
    }
  });

  // Parcelas de pessoas (a receber / a pagar) que vencem logo ou já passaram.
  (dados.parcelas || []).forEach((p) => {
    const [a, m, d] = String(p.data_vencimento).split('-').map(Number);
    const diff = Math.round((utc(a, m, d) - hojeMs) / DIA_MS);
    if (diff > DIAS_AVISO_PADRAO) return;
    const linha = { diff, texto: `• ${String(p.pessoa).trim()} — parcela ${p.numero}/${p.total} — ${brl(p.valor)} (${quando(diff)})` };
    (p.tipo === 'receber' ? aReceber : aPagarParcelas).push(linha);
  });

  const ordenar = (lista) => lista.sort((x, y) => x.diff - y.diff).map((l) => l.texto);
  const blocos = [];
  if (atrasadas.length) blocos.push('🔴 *Atrasadas*\n' + ordenar(atrasadas).join('\n'));
  if (proximas.length) blocos.push('🟠 *Vencendo em breve*\n' + ordenar(proximas).join('\n'));
  if (aPagarParcelas.length) blocos.push('💸 *Parcelas a pagar*\n' + ordenar(aPagarParcelas).join('\n'));
  if (aReceber.length) blocos.push('💰 *A receber*\n' + ordenar(aReceber).join('\n'));
  if (!blocos.length) return null;

  const cabecalho = `*Meu Financeiro* — avisos de ${dataBR(hoje)}`;
  return [cabecalho, ...blocos, APP_URL].join('\n\n');
}

async function buscarDados(hoje, segredo) {
  const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/fin_dados_avisos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: process.env.SUPABASE_ANON_KEY },
    body: JSON.stringify({ p_token: segredo, p_mes: hoje.slice(0, 7) }),
  });
  if (!resp.ok) throw new Error('falha ao ler os dados no banco: ' + (await resp.text()).slice(0, 200));
  return resp.json();
}

async function enviarWhatsApp(texto) {
  const url = 'https://api.callmebot.com/whatsapp.php'
    + `?phone=${encodeURIComponent(process.env.WHATSAPP_PHONE)}`
    + `&text=${encodeURIComponent(texto)}`
    + `&apikey=${encodeURIComponent(process.env.CALLMEBOT_APIKEY)}`;
  const resp = await fetch(url);
  const corpo = (await resp.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!resp.ok) throw new Error(`CallMeBot respondeu ${resp.status}: ${corpo}`);
  return corpo;
}

module.exports = async function handler(req, res) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return res.status(500).json({ erro: 'CRON_SECRET não configurado na Vercel' });
  if (req.headers.authorization !== `Bearer ${segredo}`) return res.status(401).json({ erro: 'não autorizado' });

  const faltando = ['WHATSAPP_PHONE', 'CALLMEBOT_APIKEY', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'].filter((k) => !process.env[k]);
  if (faltando.length) return res.status(500).json({ erro: 'faltam variáveis de ambiente: ' + faltando.join(', ') });

  try {
    const hoje = hojeISO();
    if (req.query && req.query.teste === '1') {
      const resposta = await enviarWhatsApp(`*Meu Financeiro* — teste ✅\nSe você leu isso, os avisos no WhatsApp estão funcionando.\n${APP_URL}`);
      return res.status(200).json({ enviado: true, teste: true, resposta });
    }

    const dados = await buscarDados(hoje, segredo);
    const texto = montarAviso(dados, hoje);
    if (req.query && req.query.dry === '1') return res.status(200).json({ hoje, enviado: false, texto });
    if (!texto) return res.status(200).json({ hoje, enviado: false, motivo: 'nada vencendo ou atrasado hoje' });

    const resposta = await enviarWhatsApp(texto);
    return res.status(200).json({ hoje, enviado: true, resposta });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: err.message });
  }
};

module.exports.montarAviso = montarAviso;
module.exports.hojeISO = hojeISO;
