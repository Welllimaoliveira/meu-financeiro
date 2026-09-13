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
  parcelamentos: [],
  parcelas: [],
  categoriasMap: {}, // id -> {nome, tipo}
};
let tipoLancamentoAtual = 'despesa';
let periodoAtual = 'semanal';
let tipoParcelamentoAtual = 'receber';
let periodoRelatorioAtual = 'mes';
let calcExpr = '';
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
  await Promise.all([carregarContas(), carregarLancamentos(), carregarCartoes(), carregarParcelamentos(), carregarParcelas()]);

  const lDataEl = document.getElementById('lData');
  if (lDataEl && !lDataEl.value) lDataEl.valueAsDate = new Date();

  renderAll();
}

async function garantirPerfil() {
  const { data, error } = await supabaseClient
    .from('fin_profiles').select('saldo_atual').eq('id', currentUser.id).maybeSingle();
  if (error) { console.error(error); return; }
  if (!data) {
    await supabaseClient.from('fin_profiles').insert({ id: currentUser.id, saldo_atual: 0 });
    state.saldo = 0;
  } else {
    state.saldo = Number(data.saldo_atual) || 0;
  }
}

async function carregarCategorias() {
  const { data, error } = await supabaseClient.from('fin_categorias').select('id,nome,tipo');
  if (error) { console.error(error); return; }
  state.categoriasMap = {};
  (data || []).forEach(c => { state.categoriasMap[c.id] = c; });
}

async function getOrCreateCategoria(nome, tipo) {
  const existente = Object.entries(state.categoriasMap).find(([, c]) => c.nome === nome && c.tipo === tipo);
  if (existente) return existente[0];
  const { data, error } = await supabaseClient
    .from('fin_categorias').insert({ user_id: currentUser.id, nome, tipo }).select('id,nome,tipo').single();
  if (error) { console.error(error); return null; }
  state.categoriasMap[data.id] = data;
  return data.id;
}

async function carregarContas() {
  const { data, error } = await supabaseClient
    .from('fin_contas').select('*').eq('ativa', true).order('dia_vencimento', { ascending: true });
  if (error) { console.error(error); return; }
  state.contas = data || [];
}

async function carregarLancamentos() {
  const { data, error } = await supabaseClient
    .from('fin_lancamentos').select('*').order('data', { ascending: false }).limit(50);
  if (error) { console.error(error); return; }
  state.lancamentos = data || [];
}

async function carregarCartoes() {
  const { data, error } = await supabaseClient
    .from('fin_cartoes').select('*').order('created_at', { ascending: true });
  if (error) { console.error(error); return; }
  state.cartoes = data || [];
}

async function carregarParcelamentos() {
  const { data, error } = await supabaseClient
    .from('fin_parcelamentos').select('*').order('created_at', { ascending: false });
  if (error) { console.error(error); return; }
  state.parcelamentos = data || [];
}

async function carregarParcelas() {
  const { data, error } = await supabaseClient
    .from('fin_parcelas').select('*').order('data_vencimento', { ascending: true });
  if (error) { console.error(error); return; }
  state.parcelas = data || [];
}

// ---------- Navegação ----------
function mudarTela(nome, btn) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById('tela-' + nome).classList.remove('hidden');
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderAll();
}

// Menu de cima (telona) — mesmos destinos da barra debaixo, mais fácil de
// alcançar com o polegar no celular.
function toggleMenu() {
  document.getElementById('menuOverlay').classList.toggle('hidden');
}

// Força buscar a versão mais nova do app (código) e dos dados — resolve
// quando alguém fica "preso" numa versão antiga por causa de cache do
// navegador ou do service worker do PWA.
async function atualizarApp() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if ('caches' in window) {
      const chaves = await caches.keys();
      await Promise.all(chaves.map(k => caches.delete(k)));
    }
  } catch (err) {
    console.error('Erro ao limpar cache/service worker', err);
  }
  location.reload();
}

const MAPA_DETALHE_CARTOES = {
  saldo: 'detalheSaldoCartoes',
  devedor: 'detalheDevedorCartoes',
  receber: 'detalheReceberPessoas',
  pagarPessoas: 'detalhePagarPessoas',
};
function toggleDetalheCartoes(tipo) {
  document.getElementById(MAPA_DETALHE_CARTOES[tipo]).classList.toggle('hidden');
}

// Troca de tela sem mexer no menu de cima (usado por botões fora do menu,
// como o de Relatório na barra superior).
function irPara(nome) {
  const btn = document.querySelector('nav button[data-tela="' + nome + '"]');
  mudarTela(nome, btn);
}

function navMenu(nome) {
  irPara(nome);
  document.getElementById('menuOverlay').classList.add('hidden');
}

// ---------- Saldo ----------
async function editarSaldo() {
  const novo = prompt('Novo saldo em conta:', state.saldo);
  if (novo !== null && !isNaN(parseFloat(novo))) {
    state.saldo = parseFloat(novo);
    await supabaseClient.from('fin_profiles').update({ saldo_atual: state.saldo }).eq('id', currentUser.id);
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
    cartao_id: document.getElementById('lCartao').value || null,
    status: 'pago',
    data: document.getElementById('lData').value || new Date().toISOString().slice(0, 10),
  };
  const { data, error } = await supabaseClient.from('fin_lancamentos').insert(registro).select().single();
  if (error) { alert('Erro ao salvar: ' + error.message); return false; }
  state.lancamentos.unshift(data);
  e.target.reset();
  setTipoLancamento('despesa');
  document.getElementById('lData').valueAsDate = new Date();
  renderAll();
  return false;
}

async function removerLancamento(id) {
  const { error } = await supabaseClient.from('fin_lancamentos').delete().eq('id', id);
  if (error) { alert('Erro ao remover: ' + error.message); return; }
  state.lancamentos = state.lancamentos.filter(l => l.id !== id);
  renderAll();
}

async function editarLancamento(id) {
  const l = state.lancamentos.find(x => x.id === id);
  if (!l) return;

  const novaDesc = prompt('Descrição:', l.descricao);
  if (novaDesc === null) return;
  const novoValorStr = prompt('Valor (R$):', l.valor);
  if (novoValorStr === null) return;
  const novoValor = parseFloat(novoValorStr.replace(',', '.'));
  if (isNaN(novoValor)) { alert('Valor inválido.'); return; }
  const novaData = prompt('Data (AAAA-MM-DD):', l.data);
  if (novaData === null) return;

  const registro = { descricao: novaDesc, valor: novoValor, data: novaData };
  const { data, error } = await supabaseClient.from('fin_lancamentos').update(registro).eq('id', id).select().single();
  if (error) { alert('Erro ao salvar: ' + error.message); return; }
  state.lancamentos = state.lancamentos.map(x => x.id === id ? data : x);
  renderAll();
}

// ---------- Contas fixas ----------
let contaEditandoId = null;

async function adicionarConta(e) {
  e.preventDefault();
  const nomeCategoria = document.getElementById('cCategoria').value;
  const categoriaId = await getOrCreateCategoria(nomeCategoria, 'despesa');
  const campos = {
    nome: document.getElementById('cNome').value,
    valor: parseFloat(document.getElementById('cValor').value),
    dia_vencimento: parseInt(document.getElementById('cDia').value, 10),
    categoria_id: categoriaId,
    alerta_dias_antes: parseInt(document.getElementById('cAlerta').value, 10) || 0,
  };

  if (contaEditandoId) {
    const { data, error } = await supabaseClient.from('fin_contas').update(campos).eq('id', contaEditandoId).select().single();
    if (error) { alert('Erro ao salvar: ' + error.message); return false; }
    state.contas = state.contas.map(x => x.id === contaEditandoId ? data : x);
    cancelarEdicaoConta();
  } else {
    const registro = { ...campos, user_id: currentUser.id, pago: false, ativa: true };
    const { data, error } = await supabaseClient.from('fin_contas').insert(registro).select().single();
    if (error) { alert('Erro ao salvar: ' + error.message); return false; }
    state.contas.push(data);
    e.target.reset();
    document.getElementById('cAlerta').value = 3;
  }
  renderAll();
  return false;
}

function cancelarEdicaoConta() {
  contaEditandoId = null;
  document.getElementById('contaFormTitulo').textContent = 'Cadastrar conta fixa';
  document.getElementById('contaSubmitBtn').textContent = 'Salvar conta';
  document.getElementById('contaCancelarBtn').classList.add('hidden');
  document.querySelector('#tela-contas form').reset();
  document.getElementById('cAlerta').value = 3;
}

async function toggleContaPaga(id) {
  const conta = state.contas.find(c => c.id === id);
  if (!conta) return;
  conta.pago = !conta.pago;
  const { error } = await supabaseClient.from('fin_contas').update({ pago: conta.pago }).eq('id', id);
  if (error) { alert('Erro ao atualizar: ' + error.message); conta.pago = !conta.pago; return; }
  renderAll();
}

async function removerConta(id) {
  const { error } = await supabaseClient.from('fin_contas').update({ ativa: false }).eq('id', id);
  if (error) { alert('Erro ao remover: ' + error.message); return; }
  state.contas = state.contas.filter(c => c.id !== id);
  renderAll();
}

function editarConta(id) {
  const c = state.contas.find(x => x.id === id);
  if (!c) return;
  const cat = state.categoriasMap[c.categoria_id];

  contaEditandoId = id;
  document.getElementById('cNome').value = c.nome;
  document.getElementById('cValor').value = c.valor;
  document.getElementById('cDia').value = c.dia_vencimento;
  document.getElementById('cAlerta').value = c.alerta_dias_antes ?? 3;
  const catSelect = document.getElementById('cCategoria');
  catSelect.value = cat && [...catSelect.options].some(o => o.value === cat.nome) ? cat.nome : 'Outros';

  document.getElementById('contaFormTitulo').textContent = 'Editar conta fixa';
  document.getElementById('contaSubmitBtn').textContent = 'Salvar edição';
  document.getElementById('contaCancelarBtn').classList.remove('hidden');

  document.querySelector('#tela-contas form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Cartões / contas bancárias (manual) ----------
async function adicionarCartao(e) {
  e.preventDefault();
  const registro = {
    user_id: currentUser.id,
    nome: document.getElementById('caNome').value,
    tipo_conta: document.getElementById('caTipo').value,
    saldo_atual: parseFloat(document.getElementById('caSaldo').value) || 0,
    saldo_devedor: parseFloat(document.getElementById('caDevedor').value) || 0,
    juros_credito: parseFloat(document.getElementById('caJurosCredito').value) || null,
    juros_debito: parseFloat(document.getElementById('caJurosDebito').value) || null,
    juros_pix: parseFloat(document.getElementById('caJurosPix').value) || null,
    origem: 'manual',
    atualizado_em: new Date().toISOString(),
  };
  const { data, error } = await supabaseClient.from('fin_cartoes').insert(registro).select().single();
  if (error) { alert('Erro ao salvar: ' + error.message); return false; }
  state.cartoes.push(data);
  e.target.reset();
  renderAll();
  return false;
}

async function removerCartao(id) {
  const { error } = await supabaseClient.from('fin_cartoes').delete().eq('id', id);
  if (error) { alert('Erro ao remover: ' + error.message); return; }
  state.cartoes = state.cartoes.filter(c => c.id !== id);
  renderAll();
}

async function editarCartao(id) {
  const c = state.cartoes.find(x => x.id === id);
  if (!c) return;

  const novoNome = prompt('Nome:', c.nome);
  if (novoNome === null) return;
  const novoSaldoStr = prompt('Saldo disponível (R$):', c.saldo_atual ?? 0);
  if (novoSaldoStr === null) return;
  const novoDevedorStr = prompt('Valor devedor (R$):', c.saldo_devedor ?? 0);
  if (novoDevedorStr === null) return;
  const jurosCreditoStr = prompt('Juros no crédito (% ao mês, deixe vazio se não souber):', c.juros_credito ?? '');
  if (jurosCreditoStr === null) return;
  const jurosDebitoStr = prompt('Juros no débito (% ao mês):', c.juros_debito ?? '');
  if (jurosDebitoStr === null) return;
  const jurosPixStr = prompt('Juros no Pix (% ao mês):', c.juros_pix ?? '');
  if (jurosPixStr === null) return;

  const registro = {
    nome: novoNome,
    saldo_atual: parseFloat(novoSaldoStr.replace(',', '.')) || 0,
    saldo_devedor: parseFloat(novoDevedorStr.replace(',', '.')) || 0,
    juros_credito: jurosCreditoStr.trim() === '' ? null : parseFloat(jurosCreditoStr.replace(',', '.')),
    juros_debito: jurosDebitoStr.trim() === '' ? null : parseFloat(jurosDebitoStr.replace(',', '.')),
    juros_pix: jurosPixStr.trim() === '' ? null : parseFloat(jurosPixStr.replace(',', '.')),
    atualizado_em: new Date().toISOString(),
  };
  const { data, error } = await supabaseClient.from('fin_cartoes').update(registro).eq('id', id).select().single();
  if (error) { alert('Erro ao salvar: ' + error.message); return; }
  state.cartoes = state.cartoes.map(x => x.id === id ? data : x);
  renderAll();
}

// ---------- Parcelamentos (a receber/a pagar de pessoas, parcelado) ----------
function setTipoParcelamento(tipo) {
  tipoParcelamentoAtual = tipo;
  document.getElementById('tipoReceberBtn').classList.toggle('active', tipo === 'receber');
  document.getElementById('tipoPagarBtn').classList.toggle('active', tipo === 'pagar');
}

function atualizarPreviewParcelas() {
  const total = parseFloat(document.getElementById('pcValorTotal').value);
  const qtd = parseInt(document.getElementById('pcParcelas').value, 10);
  const preview = document.getElementById('pcPreview');
  if (!total || !qtd || qtd < 1) { preview.textContent = ''; return; }
  preview.textContent = `${qtd}x de ${fmt(total / qtd)}`;
}

async function adicionarParcelamento(e) {
  e.preventDefault();
  const pessoa = document.getElementById('pcPessoa').value;
  const descricao = document.getElementById('pcDescricao').value || null;
  const valorTotal = parseFloat(document.getElementById('pcValorTotal').value);
  const qtd = parseInt(document.getElementById('pcParcelas').value, 10);
  const dataInicio = document.getElementById('pcDataInicio').value;

  const registro = {
    user_id: currentUser.id, pessoa, descricao, tipo: tipoParcelamentoAtual,
    valor_total: valorTotal, quantidade_parcelas: qtd, data_inicio: dataInicio,
  };
  const { data: plano, error } = await supabaseClient.from('fin_parcelamentos').insert(registro).select().single();
  if (error) { alert('Erro ao salvar: ' + error.message); return false; }
  state.parcelamentos.unshift(plano);

  // Parcelas iguais (total ÷ quantidade); a última absorve a sobra do
  // arredondamento pra soma bater certinho com o valor total.
  const valorBase = Math.round((valorTotal / qtd) * 100) / 100;
  const linhas = [];
  let somaParcial = 0;
  for (let i = 1; i <= qtd; i++) {
    const dataVenc = new Date(dataInicio + 'T00:00:00');
    dataVenc.setMonth(dataVenc.getMonth() + (i - 1));
    const valor = i === qtd ? Math.round((valorTotal - somaParcial) * 100) / 100 : valorBase;
    somaParcial += valor;
    linhas.push({
      user_id: currentUser.id, parcelamento_id: plano.id, numero: i, valor,
      data_vencimento: dataVenc.toISOString().slice(0, 10), pago: false,
    });
  }
  const { data: parcelasCriadas, error: err2 } = await supabaseClient.from('fin_parcelas').insert(linhas).select();
  if (err2) alert('O parcelamento foi salvo, mas houve erro ao criar as parcelas: ' + err2.message);
  else state.parcelas.push(...parcelasCriadas);

  e.target.reset();
  document.getElementById('pcParcelas').value = 1;
  document.getElementById('pcPreview').textContent = '';
  setTipoParcelamento('receber');
  renderAll();
  return false;
}

async function toggleParcelaPaga(id) {
  const p = state.parcelas.find(x => x.id === id);
  if (!p) return;
  p.pago = !p.pago;
  const registro = { pago: p.pago, data_pagamento: p.pago ? new Date().toISOString().slice(0, 10) : null };
  const { error } = await supabaseClient.from('fin_parcelas').update(registro).eq('id', id);
  if (error) { alert('Erro ao atualizar: ' + error.message); p.pago = !p.pago; return; }
  renderAll();
}

async function editarParcela(id) {
  const p = state.parcelas.find(x => x.id === id);
  if (!p) return;
  const novoValorStr = prompt('Valor desta parcela (R$):', p.valor);
  if (novoValorStr === null) return;
  const novoValor = parseFloat(novoValorStr.replace(',', '.'));
  if (isNaN(novoValor)) { alert('Valor inválido.'); return; }
  const novaData = prompt('Data de vencimento (AAAA-MM-DD):', p.data_vencimento);
  if (novaData === null) return;
  const { data, error } = await supabaseClient.from('fin_parcelas').update({ valor: novoValor, data_vencimento: novaData }).eq('id', id).select().single();
  if (error) { alert('Erro ao salvar: ' + error.message); return; }
  state.parcelas = state.parcelas.map(x => x.id === id ? data : x);
  renderAll();
}

async function removerParcelamento(id) {
  if (!confirm('Excluir esse parcelamento e todas as parcelas dele?')) return;
  const { error } = await supabaseClient.from('fin_parcelamentos').delete().eq('id', id);
  if (error) { alert('Erro ao remover: ' + error.message); return; }
  state.parcelamentos = state.parcelamentos.filter(x => x.id !== id);
  state.parcelas = state.parcelas.filter(x => x.parcelamento_id !== id);
  renderAll();
}

function renderParcelamentos() {
  const lista = document.getElementById('listaParcelamentos');
  if (!lista) return;
  if (!state.parcelamentos.length) { lista.innerHTML = '<p class="empty">Nenhum parcelamento cadastrado ainda.</p>'; return; }
  lista.innerHTML = state.parcelamentos.map(pl => {
    const parcelas = state.parcelas.filter(p => p.parcelamento_id === pl.id).sort((a, b) => a.numero - b.numero);
    const pagas = parcelas.filter(p => p.pago).length;
    const linhasHtml = parcelas.map(p => `
      <div class="parcela-linha ${p.pago ? 'paga' : ''}">
        <input type="checkbox" ${p.pago ? 'checked' : ''} onchange="toggleParcelaPaga('${p.id}')">
        <span>Parcela ${p.numero}/${pl.quantidade_parcelas} · ${p.data_vencimento.split('-').reverse().join('/')}</span>
        <span class="val">${fmt(p.valor)}</span>
        <button class="edit" onclick="editarParcela('${p.id}')" title="Editar">✎</button>
      </div>
    `).join('');
    return `
      <div class="parcelamento-item">
        <div class="row-top">
          <span class="pessoa">${pl.pessoa}</span>
          <span class="tipo-tag ${pl.tipo}">${pl.tipo === 'receber' ? 'A receber' : 'A pagar'}</span>
        </div>
        ${pl.descricao ? `<span class="desc">${pl.descricao}</span>` : ''}
        <p class="progresso">${pagas}/${pl.quantidade_parcelas} parcelas pagas · total ${fmt(pl.valor_total)}</p>
        ${linhasHtml}
        <button class="del" onclick="removerParcelamento('${pl.id}')" style="margin-top:8px;">Excluir parcelamento ×</button>
      </div>
    `;
  }).join('');
}

// ---------- Calculadora (tela Parcelas) ----------
function calcClear() { calcExpr = ''; document.getElementById('calcDisplay').value = '0'; }
function calcBackspace() { calcExpr = calcExpr.slice(0, -1); document.getElementById('calcDisplay').value = calcExpr || '0'; }
function calcInput(v) { calcExpr += v; document.getElementById('calcDisplay').value = calcExpr; }
function calcIgual() {
  try {
    if (!calcExpr || !/^[0-9+\-*/.() ]+$/.test(calcExpr)) throw new Error('expressão inválida');
    const resultado = Function('"use strict"; return (' + calcExpr + ')')();
    if (!isFinite(resultado)) throw new Error('resultado inválido');
    calcExpr = String(Math.round(resultado * 100) / 100);
    document.getElementById('calcDisplay').value = calcExpr;
  } catch (err) {
    document.getElementById('calcDisplay').value = 'Erro';
    calcExpr = '';
  }
}
function calcAplicar() {
  const valor = parseFloat(document.getElementById('calcDisplay').value.replace(',', '.'));
  if (isNaN(valor)) { alert('Calcule um valor primeiro.'); return; }
  document.getElementById('pcValorTotal').value = valor;
  atualizarPreviewParcelas();
}

// ---------- Relatório em PDF ----------
function formatarDataBR(iso) { return iso.split('-').reverse().join('/'); }

function obterPeriodoRelatorio() {
  const hoje = new Date();
  const iso = d => d.toISOString().slice(0, 10);
  if (periodoRelatorioAtual === 'dia') return { inicio: iso(hoje), fim: iso(hoje) };
  if (periodoRelatorioAtual === 'semana') {
    const ini = new Date(hoje); ini.setDate(ini.getDate() - 6);
    return { inicio: iso(ini), fim: iso(hoje) };
  }
  if (periodoRelatorioAtual === 'mes') {
    const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    return { inicio: iso(ini), fim: iso(hoje) };
  }
  const de = document.getElementById('relDe').value;
  const ate = document.getElementById('relAte').value;
  return { inicio: de || iso(hoje), fim: ate || iso(hoje) };
}

function setPeriodoRelatorio(tipo, btn) {
  periodoRelatorioAtual = tipo;
  document.querySelectorAll('#tela-relatorio .period-toggle button').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('relatorioPersonalizado').classList.toggle('hidden', tipo !== 'personalizado');
  const { inicio, fim } = obterPeriodoRelatorio();
  document.getElementById('relPeriodoResumo').textContent = `De ${formatarDataBR(inicio)} até ${formatarDataBR(fim)}`;
}

function abrirRelatorio() {
  irPara('relatorio');
  setPeriodoRelatorio('mes', document.querySelector('#tela-relatorio .period-toggle button'));
}

function desenharGraficoBarras(labels, valores) {
  if (!labels.length) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 700; canvas.height = 260;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const max = Math.max(...valores, 1);
  const larguraBarra = canvas.width / labels.length;
  labels.forEach((lbl, i) => {
    const h = (valores[i] / max) * 190;
    ctx.fillStyle = '#1F6B41';
    ctx.fillRect(i * larguraBarra + 8, 220 - h, larguraBarra - 16, h);
    ctx.fillStyle = '#1B1D1B';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(lbl.slice(5).split('-').reverse().join('/'), i * larguraBarra + larguraBarra / 2, 238);
  });
  return canvas.toDataURL('image/png');
}

function gerarRelatorioPDF() {
  const statusEl = document.getElementById('relStatus');
  statusEl.textContent = 'Gerando PDF...';
  try {
    if (!window.jspdf) throw new Error('biblioteca de PDF não carregou — verifique sua internet e tente de novo');
    const { inicio, fim } = obterPeriodoRelatorio();
    const lancsPeriodo = state.lancamentos.filter(l => l.data >= inicio && l.data <= fim);
    const despesas = lancsPeriodo.filter(l => l.tipo === 'despesa');
    const receitas = lancsPeriodo.filter(l => l.tipo === 'receita');
    const totalSaiu = despesas.reduce((s, l) => s + Number(l.valor), 0);
    const totalEntrou = receitas.reduce((s, l) => s + Number(l.valor), 0);
    const maiorGasto = despesas.length ? despesas.reduce((a, b) => Number(b.valor) > Number(a.valor) ? b : a) : null;
    const menorGasto = despesas.length ? despesas.reduce((a, b) => Number(b.valor) < Number(a.valor) ? b : a) : null;

    const rankingJuros = state.cartoes
      .map(c => ({ nome: c.nome, maiorJuros: Math.max(c.juros_credito || 0, c.juros_debito || 0, c.juros_pix || 0) }))
      .filter(c => c.maiorJuros > 0)
      .sort((a, b) => b.maiorJuros - a.maiorJuros);

    const extratoPorCartao = {};
    lancsPeriodo.forEach(l => {
      const chave = l.cartao_id || 'sem-cartao';
      (extratoPorCartao[chave] = extratoPorCartao[chave] || []).push(l);
    });

    const porDia = {};
    despesas.forEach(l => { porDia[l.data] = (porDia[l.data] || 0) + Number(l.valor); });
    const dias = Object.keys(porDia).sort();
    const chartImg = desenharGraficoBarras(dias, dias.map(d => porDia[d]));

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let y = 18;
    doc.setFontSize(16); doc.text('Meu Financeiro — Relatório', 14, y); y += 8;
    doc.setFontSize(10); doc.text(`Período: ${formatarDataBR(inicio)} a ${formatarDataBR(fim)}`, 14, y); y += 10;

    doc.setFontSize(12); doc.text('Resumo', 14, y); y += 7;
    doc.setFontSize(10);
    doc.text(`Total recebido: ${fmt(totalEntrou)}`, 14, y); y += 6;
    doc.text(`Total gasto: ${fmt(totalSaiu)}`, 14, y); y += 6;
    doc.text(`Saldo do período: ${fmt(totalEntrou - totalSaiu)}`, 14, y); y += 6;
    if (maiorGasto) { doc.text(`Maior gasto: ${maiorGasto.descricao} — ${fmt(maiorGasto.valor)} (${formatarDataBR(maiorGasto.data)})`, 14, y); y += 6; }
    if (menorGasto) { doc.text(`Menor gasto: ${menorGasto.descricao} — ${fmt(menorGasto.valor)} (${formatarDataBR(menorGasto.data)})`, 14, y); y += 6; }
    y += 4;

    if (chartImg) {
      doc.setFontSize(12); doc.text('Gastos por dia', 14, y); y += 4;
      doc.addImage(chartImg, 'PNG', 14, y, 180, 66);
      y += 74;
    }

    if (y > 250) { doc.addPage(); y = 18; }
    doc.setFontSize(12); doc.text('Juros por cartão (do maior pro menor)', 14, y); y += 7;
    doc.setFontSize(10);
    if (rankingJuros.length) rankingJuros.forEach(c => { doc.text(`${c.nome}: ${c.maiorJuros}% ao mês`, 14, y); y += 6; });
    else { doc.text('Nenhum cartão com juros cadastrado ainda.', 14, y); y += 6; }
    y += 4;

    if (y > 240) { doc.addPage(); y = 18; }
    doc.setFontSize(12); doc.text('Extrato por cartão/conta', 14, y); y += 7;
    doc.setFontSize(10);
    const entradasExtrato = Object.entries(extratoPorCartao);
    if (!entradasExtrato.length) { doc.text('Nenhum lançamento no período.', 14, y); y += 6; }
    entradasExtrato.forEach(([chave, itens]) => {
      const cartao = state.cartoes.find(c => c.id === chave);
      const nome = cartao ? cartao.nome : 'Sem cartão vinculado';
      const total = itens.reduce((s, l) => s + (l.tipo === 'despesa' ? Number(l.valor) : -Number(l.valor)), 0);
      if (y > 270) { doc.addPage(); y = 18; }
      doc.setFont(undefined, 'bold'); doc.text(`${nome} — total ${fmt(total)}`, 14, y); doc.setFont(undefined, 'normal'); y += 6;
      itens.forEach(l => {
        if (y > 280) { doc.addPage(); y = 18; }
        doc.text(`  ${formatarDataBR(l.data)} · ${l.descricao} · ${l.tipo === 'receita' ? '+' : '-'}${fmt(l.valor)}`, 14, y); y += 5;
      });
      y += 3;
    });

    doc.save(`relatorio-meu-financeiro-${inicio}-a-${fim}.pdf`);
    statusEl.textContent = 'PDF gerado! Confira na pasta de downloads do seu navegador.';
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Erro ao gerar PDF: ' + err.message;
  }
}

// ---------- Pluggy (Open Finance) — chamado por pluggy-connect-client.js ----------
async function salvarContasPluggy(itemId, instituicao, accounts) {
  await supabaseClient.from('fin_pluggy_items').upsert(
    { user_id: currentUser.id, item_id: itemId, instituicao, status: 'ativo', atualizado_em: new Date().toISOString() },
    { onConflict: 'item_id' }
  );

  const mapaTipo = { CHECKING_ACCOUNT: 'conta_corrente', SAVINGS_ACCOUNT: 'poupanca', CREDIT_CARD: 'cartao_credito' };

  for (const acc of accounts) {
    // Cartão de crédito: "balance" da Pluggy é o valor da fatura em aberto
    // (o que você deve), não dinheiro disponível — guarda em saldo_devedor,
    // e saldo_atual vira o limite ainda livre (quando a Pluggy manda esse
    // dado em creditData). Conta corrente/poupança: balance é mesmo saldo.
    const ehCredito = acc.type === 'CREDIT';
    const registro = {
      user_id: currentUser.id,
      nome: acc.marketingName || acc.name || instituicao,
      banco: instituicao,
      tipo_conta: mapaTipo[acc.subtype] || (ehCredito ? 'cartao_credito' : 'conta_corrente'),
      origem: 'open_finance',
      pluggy_item_id: itemId,
      pluggy_account_id: acc.id,
      saldo_atual: ehCredito ? (acc.creditData?.availableCreditLimit ?? 0) : acc.balance,
      saldo_devedor: ehCredito ? Math.abs(acc.creditData?.balanceCloseInvoice ?? acc.balance ?? 0) : 0,
      atualizado_em: new Date().toISOString(),
    };

    const { data: existente } = await supabaseClient
      .from('fin_cartoes').select('id').eq('pluggy_account_id', acc.id).maybeSingle();

    let linha;
    if (existente) {
      const { data } = await supabaseClient.from('fin_cartoes').update(registro).eq('id', existente.id).select().single();
      linha = data;
      state.cartoes = state.cartoes.map(c => c.id === linha.id ? linha : c);
    } else {
      const { data } = await supabaseClient.from('fin_cartoes').insert(registro).select().single();
      linha = data;
      state.cartoes.push(linha);
    }

    await supabaseClient.from('fin_saldos').insert({
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

  const totalSaldoCartoes = state.cartoes.reduce((s, c) => s + Number(c.saldo_atual || 0), 0);
  const totalDevedorCartoes = state.cartoes.reduce((s, c) => s + Number(c.saldo_devedor || 0), 0);
  document.getElementById('totalSaldoCartoes').textContent = fmt(totalSaldoCartoes);
  document.getElementById('totalDevedorCartoes').textContent = fmt(totalDevedorCartoes);
  document.getElementById('detalheSaldoCartoes').innerHTML = state.cartoes.length
    ? state.cartoes.map(c => `<div class="linha"><span>${c.nome}</span><span class="val">${fmt(c.saldo_atual)}</span></div>`).join('')
    : '<p class="empty">Nenhum cartão cadastrado ainda.</p>';
  document.getElementById('detalheDevedorCartoes').innerHTML = state.cartoes.length
    ? state.cartoes.map(c => `<div class="linha"><span>${c.nome}</span><span class="val">${fmt(c.saldo_devedor)}</span></div>`).join('')
    : '<p class="empty">Nenhum cartão cadastrado ainda.</p>';

  const parcelasPendentes = state.parcelas.filter(p => !p.pago);
  const parcelaComTipo = p => ({ p, pl: state.parcelamentos.find(x => x.id === p.parcelamento_id) });
  const receberPendentes = parcelasPendentes.map(parcelaComTipo).filter(x => x.pl && x.pl.tipo === 'receber');
  const pagarPendentes = parcelasPendentes.map(parcelaComTipo).filter(x => x.pl && x.pl.tipo === 'pagar');
  const totalReceberPessoas = receberPendentes.reduce((s, x) => s + Number(x.p.valor), 0);
  const totalPagarPessoas = pagarPendentes.reduce((s, x) => s + Number(x.p.valor), 0);
  document.getElementById('totalReceberPessoas').textContent = fmt(totalReceberPessoas);
  document.getElementById('totalPagarPessoas').textContent = fmt(totalPagarPessoas);
  const linhaParcela = x => `<div class="linha"><span>${x.pl.pessoa} (${x.p.numero}/${x.pl.quantidade_parcelas})</span><span class="val">${fmt(x.p.valor)}</span></div>`;
  document.getElementById('detalheReceberPessoas').innerHTML = receberPendentes.length
    ? receberPendentes.map(linhaParcela).join('') : '<p class="empty">Nada a receber pendente.</p>';
  document.getElementById('detalhePagarPessoas').innerHTML = pagarPendentes.length
    ? pagarPendentes.map(linhaParcela).join('') : '<p class="empty">Nada a pagar pendente.</p>';

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
      <button class="edit" onclick="editarLancamento('${l.id}')" title="Editar">✎</button>
      <button class="del" onclick="removerLancamento('${l.id}')" title="Excluir">×</button>
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
      <button class="edit" onclick="editarConta('${c.id}')" title="Editar">✎</button>
      <button class="del" onclick="removerConta('${c.id}')" title="Excluir">×</button>
    </div>`;
  }).join('') : '<p class="empty">Nenhuma conta cadastrada.</p>';
}

const LABEL_TIPO_CONTA = { conta_corrente: 'Conta corrente', poupanca: 'Poupança', cartao_credito: 'Cartão de crédito', outro: 'Outro' };

function renderCartoes() {
  const lista = document.getElementById('listaCartoes');
  lista.innerHTML = state.cartoes.length ? state.cartoes.map(c => {
    const juros = [
      c.juros_credito != null ? `crédito ${c.juros_credito}%` : null,
      c.juros_debito != null ? `débito ${c.juros_debito}%` : null,
      c.juros_pix != null ? `Pix ${c.juros_pix}%` : null,
    ].filter(Boolean).join(' · ');
    return `
    <div class="card-item">
      <div class="row-top">
        <span class="nome">${c.nome}</span>
        <span class="origem-tag ${c.origem}">${c.origem === 'open_finance' ? 'Open Finance' : 'Manual'}</span>
      </div>
      <span class="banco">${c.banco ? c.banco + ' · ' : ''}${LABEL_TIPO_CONTA[c.tipo_conta] || c.tipo_conta}</span>
      <div class="row-top">
        <span class="saldo">${fmt(c.saldo_atual)}</span>
        ${Number(c.saldo_devedor) > 0 ? `<span class="devedor">deve ${fmt(c.saldo_devedor)}</span>` : ''}
      </div>
      ${juros ? `<span class="juros">Juros: ${juros} a.m.</span>` : ''}
      <div class="row-top">
        <button class="edit" onclick="editarCartao('${c.id}')" title="Editar">✎ Editar</button>
        <button class="del" onclick="removerCartao('${c.id}')" title="Excluir">×</button>
      </div>
    </div>
  `;
  }).join('') : '<p class="empty">Nenhuma conta ou cartão cadastrado ainda.</p>';
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
  renderSelectCartoes();
  renderDashboard();
  renderLancamentos();
  renderContas();
  renderCartoes();
  renderParcelamentos();
  renderProjecao();
}

function renderSelectCartoes() {
  const sel = document.getElementById('lCartao');
  if (!sel) return;
  const atual = sel.value;
  sel.innerHTML = '<option value="">— nenhum —</option>' +
    state.cartoes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
  sel.value = atual;
}
