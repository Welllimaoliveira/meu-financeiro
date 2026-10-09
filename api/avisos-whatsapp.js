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
//   WHATSAPP_PHONE_2 + CALLMEBOT_APIKEY_2   (opcional) outra pessoa, ex.: a esposa
//   WHATSAPP_PHONE_3 + CALLMEBOT_APIKEY_3   (opcional) mais uma
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

// Quem recebe: o CallMeBot só manda pro número que ativou o bot e tem a
// própria chave, então cada pessoa é um par número+chave. O primeiro par usa
// WHATSAPP_PHONE / CALLMEBOT_APIKEY; os outros usam o mesmo nome com _2 e _3.
function destinatarios() {
  return ['', '_2', '_3']
    .map((s) => ({
      // Aceita "5541984330694", "+55 41 98433-0694" etc.: só os dígitos, com "+" na frente.
      phone: (process.env['WHATSAPP_PHONE' + s] || '').replace(/\D/g, '').replace(/^(?=.)/, '+'),
      // Tira espaços/quebras de linha que costumam vir junto ao colar a chave.
      apikey: (process.env['CALLMEBOT_APIKEY' + s] || '').trim(),
    }))
    .filter((d) => d.phone.length > 1 && d.apikey);
}

const mascarar = (phone) => '…' + String(phone).replace(/\D/g, '').slice(-4);

// Celular brasileiro: o WhatsApp de vários DDDs guarda o número SEM o nono
// dígito (554184330694 em vez de 5541984330694), e a chave do CallMeBot fica
// atrelada à forma que o bot viu. Então, se a chave for recusada, tenta
// também a outra forma do mesmo número.
function variantesDoNumero(phone) {
  const d = phone.replace(/\D/g, '');
  if (/^55\d{2}9\d{8}$/.test(d)) return [phone, '+' + d.slice(0, 4) + d.slice(5)];
  if (/^55\d{2}[6-9]\d{7}$/.test(d)) return [phone, '+' + d.slice(0, 4) + '9' + d.slice(4)];
  return [phone];
}

async function chamarCallMeBot(phone, apikey, texto) {
  const url = 'https://api.callmebot.com/whatsapp.php'
    + `?phone=${encodeURIComponent(phone)}`
    + `&text=${encodeURIComponent(texto)}`
    + `&apikey=${encodeURIComponent(apikey)}`;
  const resp = await fetch(url);
  const completo = (await resp.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  // O CallMeBot responde HTTP 200/203 mesmo quando recusa (ex.: "APIKey is
  // invalid"), então olhar só o status não basta: confere o texto também.
  const chaveInvalida = /api\s*key is invalid|invalid api\s*key|not (been )?(activated|registered)/i.test(completo);
  const recusou = chaveInvalida || /^error/i.test(completo);
  return { ok: resp.ok && !recusou, chaveInvalida, status: resp.status, completo };
}

async function enviarParaUm(destino, texto) {
  let ultimo;
  for (const phone of variantesDoNumero(destino.phone)) {
    ultimo = await chamarCallMeBot(phone, destino.apikey, texto);
    if (ultimo.ok) {
      const alternativo = phone !== destino.phone;
      return completo200(ultimo.completo) + (alternativo ? ` [funcionou com ${mascarar(phone)}: o número sem/com o nono dígito]` : '');
    }
    if (!ultimo.chaveInvalida) break; // outro tipo de erro: tentar outra forma do número não ajuda
  }
  throw new Error(`CallMeBot recusou (${ultimo.status}): ${ultimo.completo.slice(-160)}`);
}

const completo200 = (s) => s.slice(0, 200);

// Manda pra todo mundo, um de cada vez; se um falhar, os outros ainda recebem.
async function enviarWhatsApp(texto) {
  const resultados = [];
  for (const d of destinatarios()) {
    try {
      resultados.push({ para: mascarar(d.phone), ok: true, resposta: await enviarParaUm(d, texto) });
    } catch (err) {
      console.error('falha ao enviar pra', mascarar(d.phone), err.message);
      resultados.push({ para: mascarar(d.phone), ok: false, erro: err.message });
    }
  }
  return resultados;
}

module.exports = async function handler(req, res) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return res.status(500).json({ erro: 'CRON_SECRET não configurado na Vercel' });
  if (req.headers.authorization !== `Bearer ${segredo}`) return res.status(401).json({ erro: 'não autorizado' });

  const faltando = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'].filter((k) => !process.env[k]);
  if (faltando.length) return res.status(500).json({ erro: 'faltam variáveis de ambiente: ' + faltando.join(', ') });
  if (!destinatarios().length) {
    return res.status(500).json({ erro: 'configure WHATSAPP_PHONE e CALLMEBOT_APIKEY (os dois) na Vercel' });
  }

  try {
    const hoje = hojeISO();
    if (req.query && req.query.teste === '1') {
      const envios = await enviarWhatsApp(`*Meu Financeiro* — teste ✅\nSe você leu isso, os avisos no WhatsApp estão funcionando.\n${APP_URL}`);
      return res.status(envios.some((e) => e.ok) ? 200 : 502).json({ teste: true, envios });
    }

    const dados = await buscarDados(hoje, segredo);
    const texto = montarAviso(dados, hoje);
    if (req.query && req.query.dry === '1') return res.status(200).json({ hoje, enviado: false, texto });
    if (!texto) return res.status(200).json({ hoje, enviado: false, motivo: 'nada vencendo ou atrasado hoje' });

    const envios = await enviarWhatsApp(texto);
    return res.status(envios.some((e) => e.ok) ? 200 : 502).json({ hoje, envios });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: err.message });
  }
};

module.exports.montarAviso = montarAviso;
module.exports.hojeISO = hojeISO;
