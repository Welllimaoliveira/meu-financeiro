-- ============================================================
-- Meu Financeiro — esquema do banco (Supabase / Postgres)
-- Cole tudo isto no SQL Editor do seu projeto Supabase e rode uma vez.
-- Login único compartilhado: você e sua esposa usam a mesma conta,
-- então as políticas de RLS (auth.uid() = user_id) já cobrem o
-- compartilhamento — não existe conceito de "dono" separado.
-- ============================================================

-- 1) PERFIL -------------------------------------------------------
create table if not exists fin_profiles (
  id uuid references auth.users on delete cascade primary key,
  nome text,
  salario_mensal numeric(12,2) default 0,
  saldo_atual numeric(12,2) default 0,
  created_at timestamptz default now()
);

-- 2) CATEGORIAS -----------------------------------------------------
create table if not exists fin_categorias (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  nome text not null,
  cor text default '#1F6B41',
  tipo text check (tipo in ('receita','despesa')) not null,
  created_at timestamptz default now()
);

-- 3) CONTAS FIXAS / RECORRENTES (aluguel, energia, assinaturas) -----
create table if not exists fin_contas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  nome text not null,
  valor numeric(12,2) not null,
  categoria_id uuid references fin_categorias(id),
  dia_vencimento int check (dia_vencimento between 1 and 31),
  frequencia text check (frequencia in ('mensal','semanal','anual','unica')) default 'mensal',
  alerta_dias_antes int default 3,
  pago boolean default false,
  ativa boolean default true,
  created_at timestamptz default now()
);

-- 4) LANÇAMENTOS (gastos e receitas do dia a dia) --------------------
create table if not exists fin_lancamentos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  conta_id uuid references fin_contas(id) on delete set null,
  categoria_id uuid references fin_categorias(id) on delete set null,
  descricao text not null,
  valor numeric(12,2) not null,
  tipo text check (tipo in ('receita','despesa')) not null,
  status text check (status in ('pendente','pago','atrasado')) default 'pendente',
  data date not null default current_date,
  data_pagamento date,
  created_at timestamptz default now()
);

-- 5) CARTÕES E CONTAS BANCÁRIAS (manual ou via Open Finance/Pluggy) --
create table if not exists fin_cartoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  nome text not null,
  banco text,
  tipo_conta text check (tipo_conta in ('conta_corrente','poupanca','cartao_credito','outro')) default 'cartao_credito',
  limite numeric(12,2),
  dia_fechamento int,
  dia_vencimento int,
  origem text check (origem in ('manual','open_finance')) default 'manual',
  pluggy_item_id text,
  pluggy_account_id text,
  saldo_atual numeric(12,2),        -- dinheiro disponível (conta) ou limite livre (cartão)
  saldo_devedor numeric(12,2) default 0, -- o que você deve (fatura do cartão, cheque especial usado...)
  juros_credito numeric(6,2),       -- % ao mês, opcional
  juros_debito numeric(6,2),        -- % ao mês, opcional
  juros_pix numeric(6,2),           -- % ao mês, opcional
  atualizado_em timestamptz,
  created_at timestamptz default now()
);

-- Migração pra quem já tinha a tabela fin_cartoes sem essas colunas:
-- alter table fin_cartoes add column if not exists saldo_devedor numeric(12,2) default 0;
-- alter table fin_cartoes add column if not exists juros_credito numeric(6,2);
-- alter table fin_cartoes add column if not exists juros_debito numeric(6,2);
-- alter table fin_cartoes add column if not exists juros_pix numeric(6,2);

-- fin_lancamentos ganha o vínculo opcional com fin_cartoes aqui (depois que
-- a tabela fin_cartoes já existe) — qual cartão/conta foi usado, pro
-- relatório por cartão.
alter table fin_lancamentos add column if not exists cartao_id uuid references fin_cartoes(id) on delete set null;

-- 6) SALDOS (histórico — manual ou vindo do Pluggy/Open Finance) -----
create table if not exists fin_saldos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  cartao_id uuid references fin_cartoes(id) on delete cascade,
  valor numeric(12,2) not null,
  origem text check (origem in ('manual','open_finance')) default 'manual',
  pluggy_account_id text,
  atualizado_em timestamptz default now()
);

-- 7) ITENS PLUGGY (uma "conexão" com um banco via Open Finance) -----
create table if not exists fin_pluggy_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  item_id text not null unique,
  instituicao text,
  status text default 'ativo',
  created_at timestamptz default now(),
  atualizado_em timestamptz default now()
);

-- 8) PARCELAMENTOS (dinheiro a receber/pagar de pessoas, parcelado) -----
create table if not exists fin_parcelamentos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  pessoa text not null,
  descricao text,
  tipo text check (tipo in ('receber','pagar')) not null,
  valor_total numeric(12,2) not null,
  quantidade_parcelas int not null check (quantidade_parcelas >= 1),
  data_inicio date not null default current_date,
  created_at timestamptz default now()
);

-- 9) PARCELAS (cada parcela individual de um parcelamento) -----
create table if not exists fin_parcelas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  parcelamento_id uuid references fin_parcelamentos(id) on delete cascade,
  numero int not null,
  valor numeric(12,2) not null,
  data_vencimento date not null,
  pago boolean default false,
  data_pagamento date,
  created_at timestamptz default now()
);

-- ============================================================
-- SEGURANÇA: cada usuário logado só enxerga os próprios dados.
-- Como vocês usam o MESMO login, os dois enxergam os mesmos dados.
-- ============================================================
alter table fin_profiles enable row level security;
alter table fin_categorias enable row level security;
alter table fin_contas enable row level security;
alter table fin_lancamentos enable row level security;
alter table fin_cartoes enable row level security;
alter table fin_saldos enable row level security;
alter table fin_pluggy_items enable row level security;
alter table fin_parcelamentos enable row level security;
alter table fin_parcelas enable row level security;

drop policy if exists "usuario ve seu proprio perfil" on fin_profiles;
create policy "usuario ve seu proprio perfil" on fin_profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "usuario gerencia suas fin_categorias" on fin_categorias;
create policy "usuario gerencia suas fin_categorias" on fin_categorias
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "usuario gerencia suas fin_contas" on fin_contas;
create policy "usuario gerencia suas fin_contas" on fin_contas
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "usuario gerencia seus fin_lancamentos" on fin_lancamentos;
create policy "usuario gerencia seus fin_lancamentos" on fin_lancamentos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "usuario gerencia seus fin_cartoes" on fin_cartoes;
create policy "usuario gerencia seus fin_cartoes" on fin_cartoes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "usuario gerencia seus fin_saldos" on fin_saldos;
create policy "usuario gerencia seus fin_saldos" on fin_saldos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "usuario gerencia seus items pluggy" on fin_pluggy_items;
create policy "usuario gerencia seus items pluggy" on fin_pluggy_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "usuario gerencia seus fin_parcelamentos" on fin_parcelamentos;
create policy "usuario gerencia seus fin_parcelamentos" on fin_parcelamentos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "usuario gerencia suas fin_parcelas" on fin_parcelas;
create policy "usuario gerencia suas fin_parcelas" on fin_parcelas
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- Dica de uso:
-- - "fin_contas"      = despesas fixas/recorrentes (gera o alerta de vencimento)
-- - "fin_lancamentos" = gastos e receitas do dia a dia
-- - "fin_cartoes"     = contas bancárias e cartões (manual ou conectado via Pluggy)
-- - "fin_saldos"      = histórico de saldo de cada cartão/conta
-- - "fin_pluggy_items"= cada conexão feita com um banco via Open Finance
-- ============================================================

-- ============================================================
-- MIGRAÇÃO — pagamento de contas fixas por mês, com histórico
-- Antes, "fin_contas.pago" era um interruptor único pra sempre: uma vez
-- marcada como paga, a conta não voltava a aparecer nos vencimentos do
-- mês seguinte sozinha. Agora cada mês tem seu próprio registro de
-- pago/não pago por conta, e o app já sabe zerar sozinho quando o mês vira
-- (não precisa fazer nada manual todo mês).
-- Pode colar e rodar mesmo se "fin_contas" já existir - é só uma tabela nova.
-- ============================================================
create table if not exists fin_contas_pagamentos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  conta_id uuid references fin_contas(id) on delete cascade,
  mes_referencia text not null, -- formato 'YYYY-MM', ex: '2026-09'
  pago boolean not null default true,
  pago_em timestamptz default now(),
  unique (conta_id, mes_referencia)
);

alter table fin_contas_pagamentos enable row level security;

drop policy if exists "usuario gerencia seus fin_contas_pagamentos" on fin_contas_pagamentos;
create policy "usuario gerencia seus fin_contas_pagamentos" on fin_contas_pagamentos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- MIGRAÇÃO — saldo que acompanha pagamentos + comprovantes
-- 1) fin_ajustar_saldo(delta): soma/subtrai do saldo de forma atômica
--    (pagar conta, receber parcela, lançar gasto...). Atômica = dois
--    aparelhos mexendo ao mesmo tempo não sobrescrevem um ao outro.
-- 2) fin_comprovantes + bucket PRIVADO "fin-comprovantes" no Storage: foto
--    ou PDF anexado a uma conta paga, lançamento ou parcela. Cada arquivo
--    fica numa pasta com o id do usuário e só ele (o login do casal) enxerga.
-- Pode rodar mais de uma vez sem problema.
-- ============================================================
create or replace function fin_ajustar_saldo(delta numeric)
returns numeric
language sql
security invoker
as $$
  update fin_profiles
     set saldo_atual = coalesce(saldo_atual, 0) + delta
   where id = auth.uid()
  returning saldo_atual;
$$;

create table if not exists fin_comprovantes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  ref_tipo text not null check (ref_tipo in ('conta','lancamento','parcela')),
  ref_id uuid not null,
  mes_referencia text,            -- só pra comprovante de conta fixa: 'YYYY-MM'
  arquivo_path text not null,     -- caminho no bucket: <user_id>/<tipo>/<ref_id>/<arquivo>
  nome_arquivo text,
  tipo_mime text,
  created_at timestamptz default now()
);
create index if not exists fin_comprovantes_ref_idx on fin_comprovantes (ref_tipo, ref_id);

alter table fin_comprovantes enable row level security;
drop policy if exists "usuario gerencia seus fin_comprovantes" on fin_comprovantes;
create policy "usuario gerencia seus fin_comprovantes" on fin_comprovantes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit)
values ('fin-comprovantes', 'fin-comprovantes', false, 10485760)
on conflict (id) do nothing;

drop policy if exists "fin_comprovantes_ver" on storage.objects;
create policy "fin_comprovantes_ver" on storage.objects for select to authenticated
  using (bucket_id = 'fin-comprovantes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "fin_comprovantes_enviar" on storage.objects;
create policy "fin_comprovantes_enviar" on storage.objects for insert to authenticated
  with check (bucket_id = 'fin-comprovantes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "fin_comprovantes_apagar" on storage.objects;
create policy "fin_comprovantes_apagar" on storage.objects for delete to authenticated
  using (bucket_id = 'fin-comprovantes' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- MIGRAÇÃO — avisos no WhatsApp (agendador diário da Vercel)
-- A função /api/avisos-whatsapp precisa saber o que vence, mas sem ter a
-- "chave-mestra" do projeto (que enxerga os dados dos outros apps que
-- dividem este Supabase). Então ela chama fin_dados_avisos(), que só
-- devolve a lista de vencimentos do app financeiro e só responde se vier o
-- segredo certo (guardado aqui apenas como hash SHA-256).
-- A linha em fin_avisos_config (com o hash do segredo) é criada à parte, na
-- hora de configurar — o segredo em si fica só na Vercel (CRON_SECRET).
-- ============================================================
create table if not exists fin_avisos_config (
  user_id uuid primary key references auth.users on delete cascade,
  token_hash text not null,
  criado_em timestamptz default now()
);
alter table fin_avisos_config enable row level security;
-- Sem nenhuma policy de propósito: ninguém (nem logado) lê ou grava direto.

create or replace function fin_dados_avisos(p_token text, p_mes text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_user uuid;
begin
  select user_id into v_user from fin_avisos_config
   where token_hash = encode(digest(convert_to(coalesce(p_token, ''), 'utf8'), 'sha256'), 'hex');
  if v_user is null then
    raise exception 'token invalido' using errcode = '28000';
  end if;

  return json_build_object(
    'contas', coalesce((
      select json_agg(json_build_object('id', c.id, 'nome', c.nome, 'valor', c.valor,
                                        'dia_vencimento', c.dia_vencimento, 'alerta_dias_antes', c.alerta_dias_antes))
        from fin_contas c where c.user_id = v_user and coalesce(c.ativa, true)), '[]'::json),
    'pagas', coalesce((
      select json_agg(p.conta_id)
        from fin_contas_pagamentos p
       where p.user_id = v_user and p.mes_referencia = p_mes and p.pago), '[]'::json),
    'parcelas', coalesce((
      select json_agg(json_build_object('pessoa', pl.pessoa, 'tipo', pl.tipo, 'numero', pa.numero,
                                        'total', pl.quantidade_parcelas, 'valor', pa.valor,
                                        'data_vencimento', pa.data_vencimento))
        from fin_parcelas pa join fin_parcelamentos pl on pl.id = pa.parcelamento_id
       where pa.user_id = v_user and not coalesce(pa.pago, false)), '[]'::json),
    'cartoes', coalesce((
      select json_agg(json_build_object('nome', k.nome, 'saldo_devedor', k.saldo_devedor,
                                        'dia_vencimento', k.dia_vencimento))
        from fin_cartoes k
       where k.user_id = v_user and coalesce(k.saldo_devedor, 0) > 0 and k.dia_vencimento is not null), '[]'::json)
  );
end;
$$;

revoke all on function fin_dados_avisos(text, text) from public;
grant execute on function fin_dados_avisos(text, text) to anon, authenticated;
