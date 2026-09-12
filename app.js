// ============================================================
// Lógica do app — lê/grava tudo no Supabase (tabelas do schema.sql).
// Login é único e compartilhado: os dois usam a mesma conta, então
// os dados já aparecem iguais nos dois aparelhos.
// ============================================================

let currentUser = null;
let state = {
  saldo: 0,
  contas: [],
  lancamentos: [],
  cartoes: [],
  categoriasMap: {}, // id -> {nome, tipo}
};
let tipoLancamentoAtual = 'despesa';
let periodoAtual = 'semanal';
const fmt = v => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hojeDia = new Date().getDate();
const CORES_DOT = ['var(--danger)', 'var(--orange-600)', 'var(--green-600)', 'var(--ink-soft)'];
const corPorId = id => CORES_DOT[Math.abs(hashStr(String(id))) % CORES_DOT.length];
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i); return h; }

// ---------- Boot ----------
async function iniciarApp() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  currentUser = user;
  if (!currentUser) return;

  await garantirPerfil();
  await carregarCategorias();
  await Promise.all([carregarContas(), carregarLancamentos(), carregarCartoes()]);

  const lDataEl = document.getElementById('lData');
  if (lDataEl && !lDataEl.value) lDataEl.valueAsDate = new Date();

  renderAll();
}

async function garantirPerfil() {
  const { data, error } = await supabaseClient
    .from('profiles').select('saldo_atual').eq('id', currentUser.id).maybeSingle();
  if (error) { console.error(error); return; }
  if (!data) {
    await supabaseClient.from('profiles').insert({ id: currentUser.id, saldo_atual: 0 });
    state.saldo = 0;
  } else {
    state.saldo = Number(data.saldo_atual) || 0;
  }
}

async function carregarCategorias() {
  const { data, error } = await supabaseClient.from('categorias').select('id,nome,tipo');
  if (error) { console.error(error); return; }
  state.categoriasMap = {};
  (data || []).forEach(c => { state.categoriasMap[c.id] = c; });
}

async function getOrCreateCategoria(nome, tipo) {
  const existente = Object.entries(state.categoriasMap).find(([, c]) => c.nome === nome && c.tipo === tipo);
  if (existente) return existente[0];
  const { data, error } = await supabaseClient
    .from('categorias').insert({ user_id: currentUser.id, nome, tipo }).select('id,nome,tipo').single();
  if (error) { console.error(error); return null; }
  state.categoriasMap[data.id] = data;
  return data.id;
}

async function carregarContas() {
  const { data, error } = await supabaseClient
    .from('contas').select('*').eq('ativa', true).order('dia_vencimento', { ascending: true });
  if (error) { console.error(error); return; }
  state.contas = data || [];
}

async function carregarLancamentos() {
  const { data, error } = await supabaseClient
    .from('lancamentos').select('*').order('data', { ascending: false }).limit(50);
  if (error) { console.error(error); return; }
  state.lancamentos = data || [];
}

async function carregarCartoes() {
  const { data, error } = await supabaseClient
    .from('cartoes').select('*').order('created_at', { ascending: true });
  if (error) { console.error(error); return; }
  state.cartoes = data || [];
}

// ---------- Navegação ----------
function mudarTela(nome, btn) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById('tela-' + nome).classList.remove('hidden');
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderAll();
}

// ---------- Saldo ----------
async function editarSaldo() {
  const novo = prompt('Novo saldo em conta:', state.saldo);
  if (novo !== null && !isNaN(parseFloat(novo))) {
    state.saldo = parseFloat(novo);
    await supabaseClient.from('profiles').update({ saldo_atual: state.saldo }).eq('id', currentUser.id);
    renderAll();
  }
}

// ---------- Lançamentos ----------
function setTipoLancamento(tipo) {
  tipoLancamentoAtual = tipo;
  document.getElementById('tipoDespesaBtn').classList.toggle('active', tipo === 'despesa');
  document.getElementById('tipoReceitaBtn').classList.toggle('active', tipo === 'receita');
}

async function adicionarLancamento(e) {
  e.preventDefault();
  const nomeCategoria = document.getElementById('lCategoria').value;
  const categoriaId = await getOrCreateCategoria(nomeCategoria, tipoLancamentoAtual);
  const registro = {
    user_id: currentUser.id,
    descricao: document.getElementById('lDesc').value,
    valor: parseFloat(document.getElementById('lValor').value),
    tipo: tipoLancamentoAtual,
    categoria_id: categoriaId,
    status: 'pago',
    data: document.getElementById('lData').value || new Date().toISOString().slice(0, 10),
  };
  const { data, error } = await supabaseClient.from('lancamentos').insert(registro).select().single();
  if (error) { alert('Erro ao salvar: ' + error.message); return false; }
  state.lancamentos.unshift(data);
  e.target.reset();
  setTipoLancamento('despesa');
  document.getElementById('lData').valueAsDate = new Date();
  renderAll();
  return false;
}

async function removerLancamento(id) {
  const { error } = await supabaseClient.from('lancamentos').delete().eq('id', id);
  if (error) { alert('Erro ao remover: ' + error.message); return; }
  state.lancamentos = state.lancamentos.filter(l => l.id !== id);
  renderAll();
}

// ---------- Contas fixas ----------
async function adicionarConta(e) {
  e.preventDefault();
  const nomeCategoria = document.getElementById('cCategoria').value;
  const categoriaId = await getOrCreateCategoria(nomeCategoria, 'despesa');
  const registro = {
    user_id: currentUser.id,
    nome: document.getElementById('cNome').value,
    valor: parseFloat(document.getElementById('cValor').value),
    dia_vencimento: parseInt(document.getElementById('cDia').value, 10),
    categoria_id: categoriaId,
    alerta_dias_antes: parseInt(document.getElementById('cAlerta').value, 10) || 0,
    pago: false,
    ativa: true,
  };
  const { data, error } = await supabaseClient.from('contas').insert(registro).select().single();
  if (error) { alert('Erro ao salvar: ' + error.message); return false; }
  state.contas.push(data);
  e.target.reset();
  document.getElementById('cAlerta').value = 3;
  renderAll();
  return false;
}

async function toggleContaPaga(id) {
  const conta = state.contas.find(c => c.id === id);
  if (!conta) return;
  conta.pago = !conta.pago;
  const { error } = await supabaseClient.from('contas').update({ pago: conta.pago }).eq('id', id);
  if (error) { alert('Erro ao atualizar: ' + error.message); conta.pago = !conta.pago; return; }
  renderAll();
}

async function removerConta(id) {
  const { error } = await supabaseClient.from('contas').update({ ativa: false }).eq('id', id);
  if (error) { alert('Erro ao remover: ' + error.message); return; }
  state.contas = state.contas.filter(c => c.id !== id);
  renderAll();
}

// ---------- Cartões / contas bancárias (manual) ----------
async function adicionarCartao(e) {
  e.preventDefault();
  const registro = {
    user_id: currentUser.id,
    nome: document.getElementById('caNome').value,
    tipo_conta: document.getElementById('caTipo').value,
    saldo_atual: parseFloat(document.getElementById('caSaldo').value),
    origem: 'manual',
    atualizado_em: new Date().toISOString(),
  };
  const { data, error } = await supabaseClient.from('cartoes').insert(registro).select().single();
  if (error) { alert('Erro ao salvar: ' + error.message); return false; }
  state.cartoes.push(data);
  e.target.reset();
  renderAll();
  return false;
}

async function removerCartao(id) {
  const { error } = await supabaseClient.from('cartoes').delete().eq('id', id);
  if (error) { alert('Erro ao remover: ' + error.message); return; }
  state.cartoes = state.cartoes.filter(c => c.id !== id);
  renderAll();
}

// ---------- Pluggy (Open Finance) — chamado por pluggy-connect-client.js ----------
async function salvarContasPluggy(itemId, instituicao, accounts) {
  await supabaseClient.from('pluggy_items').upsert(
    { user_id: currentUser.id, item_id: itemId, instituicao, status: 'ativo', atualizado_em: new Date().toISOString() },
    { onConflict: 'item_id' }
  );

  const mapaTipo = { CHECKING_ACCOUNT: 'conta_corrente', SAVINGS_ACCOUNT: 'poupanca', CREDIT_CARD: 'cartao_credito' };

  for (const acc of accounts) {
    const registro = {
      user_id: currentUser.id,
      nome: acc.marketingName || acc.name || instituicao,
      banco: instituicao,
      tipo_conta: mapaTipo[acc.subtype] || (acc.type === 'CREDIT' ? 'cartao_credito' : 'conta_corrente'),
      origem: 'open_finance',
      pluggy_item_id: itemId,
      pluggy_account_id: acc.id,
      saldo_atual: acc.balance,
      atualizado_em: new Date().toISOString(),
    };

    const { data: existente } = await supabaseClient
      .from('cartoes').select('id').eq('pluggy_account_id', acc.id).maybeSingle();

    let linha;
    if (existente) {
      const { data } = await supabaseClient.from('cartoes').update(registro).eq('id', existente.id).select().single();
      linha = data;
      state.cartoes = state.cartoes.map(c => c.id === linha.id ? linha : c);
    } else {
      const { data } = await supabaseClient.from('cartoes').insert(registro).select().single();
      linha = data;
      state.cartoes.push(linha);
    }

    await supabaseClient.from('saldos').insert({
      user_id: currentUser.id, cartao_id: linha.id, valor: acc.balance,
      origem: 'open_finance', pluggy_account_id: acc.id,
    });
  }
  renderAll();
}
window.salvarContasPluggy = salvarContasPluggy;

// ---------- Simulador ----------
function diasAteVencimento(dia) {
  let diff = dia - hojeDia;
  if (diff < 0) diff += 30;
  return diff;
}

function simular() {
  const val = parseFloat(document.getElementById('simInput').value);
  const box = document.getElementById('simResult');
  if (isNaN(val)) { box.innerHTML = 'Digite um valor para simular.'; return; }
  const totalContas = state.contas.filter(c => !c.pago).reduce((s, c) => s + Number(c.valor), 0);
  const gastosPendentes = state.lancamentos.filter(l => l.tipo === 'despesa').reduce((s, l) => s + Number(l.valor), 0);
  const receitas = state.lancamentos.filter(l => l.tipo === 'receita').reduce((s, l) => s + Number(l.valor), 0);
  const restante = state.saldo - totalContas - gastosPendentes + receitas - val;
  box.innerHTML = `Se você gastar mais <b>${fmt(val)}</b>, seu saldo no fim do mês fica em <b style="color:${restante < 0 ? 'var(--danger)' : 'var(--green-600)'}">${fmt(restante)}</b>`;
}

// ---------- Render ----------
function renderDashboard() {
  document.getElementById('saldoDisplay').textContent = fmt(state.saldo);
  const totalAPagar = state.contas.filter(c => !c.pago).reduce((s, c) => s + Number(c.valor), 0);
  const totalPago = state.contas.filter(c => c.pago).reduce((s, c) => s + Number(c.valor), 0);
  const gastosPendentes = state.lancamentos.filter(l => l.tipo === 'despesa').reduce((s, l) => s + Number(l.valor), 0);
  const receitas = state.lancamentos.filter(l => l.tipo === 'receita').reduce((s, l) => s + Number(l.valor), 0);
  const projetado = state.saldo - totalAPagar - gastosPendentes + receitas;

  document.getElementById('totalAPagar').textContent = fmt(totalAPagar);
  document.getElementById('totalPago').textContent = fmt(totalPago);
  document.getElementById('saldoProjetado').textContent = fmt(projetado);
  document.getElementById('saldoProjetadoCard').className = 'metric ' + (projetado < 0 ? 'bad' : '');

  const lista = document.getElementById('listaVencimentos');
  const ordenadas = [...state.contas].filter(c => !c.pago).sort((a, b) => diasAteVencimento(a.dia_vencimento) - diasAteVencimento(b.dia_vencimento));
  lista.innerHTML = ordenadas.length ? ordenadas.map(c => {
    const dias = diasAteVencimento(c.dia_vencimento);
    const label = dias === 0 ? 'Vence hoje' : dias === 1 ? 'Vence amanhã' : `Vence em ${dias} dias`;
    return `<div class="bill">
      <span class="dot" style="background:${corPorId(c.id)}"></span>
      <div class="info"><p class="name">${c.nome}</p><p class="due ${dias <= c.alerta_dias_antes ? 'soon' : ''}">${label} · dia ${c.dia_vencimento}</p></div>
      <p class="amount">${fmt(c.valor)}</p>
      <input type="checkbox" onchange="toggleContaPaga('${c.id}')">
    </div>`;
  }).join('') : '<p class="empty">Nenhuma conta pendente. 🎉</p>';

  simular();
}

function renderLancamentos() {
  const lista = document.getElementById('listaLancamentos');
  lista.innerHTML = state.lancamentos.length ? state.lancamentos.map(l => {
    const cat = state.categoriasMap[l.categoria_id];
    return `<div class="txn">
      <div class="info"><p style="font-size:14px; font-weight:500;">${l.descricao}</p><p style="font-size:12px; color:var(--ink-soft);">${cat ? cat.nome : ''} · ${l.data.split('-').reverse().join('/')}</p></div>
      <p class="val ${l.tipo === 'receita' ? 'pos' : 'neg'}">${l.tipo === 'receita' ? '+' : '-'} ${fmt(l.valor)}</p>
      <button class="del" onclick="removerLancamento('${l.id}')">×</button>
    </div>`;
  }).join('') : '<p class="empty">Nenhum lançamento ainda.</p>';
}

function renderContas() {
  const lista = document.getElementById('listaContas');
  lista.innerHTML = state.contas.length ? state.contas.map(c => {
    const cat = state.categoriasMap[c.categoria_id];
    return `<div class="bill ${c.pago ? 'paid' : ''}">
      <span class="dot" style="background:${corPorId(c.id)}"></span>
      <div class="info"><p class="name">${c.nome}</p><p class="due">${cat ? cat.nome : ''} · dia ${c.dia_vencimento}</p></div>
      <p class="amount">${fmt(c.valor)}</p>
      <button class="del" onclick="removerConta('${c.id}')">×</button>
    </div>`;
  }).join('') : '<p class="empty">Nenhuma conta cadastrada.</p>';
}

const LABEL_TIPO_CONTA = { conta_corrente: 'Conta corrente', poupanca: 'Poupança', cartao_credito: 'Cartão de crédito', outro: 'Outro' };

function renderCartoes() {
  const lista = document.getElementById('listaCartoes');
  lista.innerHTML = state.cartoes.length ? state.cartoes.map(c => `
    <div class="card-item">
      <div class="row-top">
        <span class="nome">${c.nome}</span>
        <span class="origem-tag ${c.origem}">${c.origem === 'open_finance' ? 'Open Finance' : 'Manual'}</span>
      </div>
      <span class="banco">${c.banco ? c.banco + ' · ' : ''}${LABEL_TIPO_CONTA[c.tipo_conta] || c.tipo_conta}</span>
      <div class="row-top">
        <span class="saldo">${fmt(c.saldo_atual)}</span>
        <button class="del" onclick="removerCartao('${c.id}')">×</button>
      </div>
    </div>
  `).join('') : '<p class="empty">Nenhuma conta ou cartão cadastrado ainda.</p>';
}

function setPeriodo(p, btn) {
  periodoAtual = p;
  document.querySelectorAll('.period-toggle button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderProjecao();
}

function renderProjecao() {
  const totalContasMes = state.contas.reduce((s, c) => s + Number(c.valor), 0);
  const gastosPendentes = state.lancamentos.filter(l => l.tipo === 'despesa').reduce((s, l) => s + Number(l.valor), 0);
  const receitas = state.lancamentos.filter(l => l.tipo === 'receita').reduce((s, l) => s + Number(l.valor), 0);
  const bars = document.getElementById('bars');
  const label = document.getElementById('projLabel');
  const valorEl = document.getElementById('projValor');
  const legenda = document.getElementById('projLegenda');
  let pontos = [];

  if (periodoAtual === 'semanal') {
    label.textContent = 'Saldo estimado ao fim da semana';
    const semanal = totalContasMes / 4.33 + gastosPendentes / 4;
    let saldo = state.saldo;
    for (let i = 1; i <= 4; i++) { saldo -= semanal; pontos.push({ lbl: 'S' + i, val: saldo }); }
    legenda.textContent = 'Estimativa dividindo as contas do mês em 4 semanas.';
  } else if (periodoAtual === 'mensal') {
    label.textContent = 'Saldo estimado ao fim do mês';
    let saldo = state.saldo;
    for (let i = 1; i <= 6; i++) { saldo += receitas - totalContasMes - (gastosPendentes / 6); pontos.push({ lbl: 'M' + i, val: saldo }); }
    legenda.textContent = 'Projeção repetindo as contas fixas pelos próximos 6 meses.';
  } else {
    label.textContent = 'Saldo estimado ao fim do ano';
    let saldo = state.saldo;
    for (let i = 1; i <= 4; i++) { saldo += (receitas - totalContasMes) * 3; pontos.push({ lbl: 'T' + i, val: saldo }); }
    legenda.textContent = 'Projeção trimestral repetindo o padrão atual de gastos fixos.';
  }

  valorEl.textContent = fmt(pontos[pontos.length - 1].val);
  const max = Math.max(...pontos.map(p => Math.abs(p.val)), 1);
  bars.innerHTML = pontos.map(p => {
    const h = Math.max(8, Math.abs(p.val) / max * 130);
    return `<div class="bar-col"><div class="bar ${p.val < 0 ? 'neg' : ''}" style="height:${h}px"></div><span class="lbl">${p.lbl}</span></div>`;
  }).join('');
}

function renderAll() {
  renderDashboard();
  renderLancamentos();
  renderContas();
  renderCartoes();
  renderProjecao();
}
