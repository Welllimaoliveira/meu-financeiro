# Meu Financeiro

App de controle financeiro pessoal (web + PWA, mesmo padrão do Fala Real /
Soletra: um repo só, GitHub → Vercel, wrapper Android depois via WebView).
Login único compartilhado — você e sua esposa usam a mesma conta e veem os
mesmos dados nos dois aparelhos.

Telas: **Início** (saldo, a pagar, projeção, próximos vencimentos, simulador),
**Lançar** (gastos/receitas do dia a dia), **Contas** (contas fixas
recorrentes com alerta de vencimento), **Cartões** (contas bancárias e
cartões — manual ou conectado de verdade via Open Finance), **Projeção**
(gráfico semanal/mensal/anual).

## Status atual (o que já está pronto)

- ✅ Banco: tabelas `fin_*` criadas no projeto Supabase **fala-real-soletra**
  (reaproveitado — prefixo `fin_` pra não colidir com as tabelas do Fala Real
  Academy/Soletra que já vivem lá: `profiles`, `child_profiles`, `payments`,
  `subscriptions`).
- ✅ Pluggy: aplicação "Meu Financeiro" criada (Client ID
  `188b4624-72e5-4096-91ae-09f2fe98372e`), sandbox habilitado.
- ✅ Deploy: [meu-financeiro-six-phi.vercel.app](https://meu-financeiro-six-phi.vercel.app)
  (projeto Vercel `meu-financeiro`, time WEL3D), com `PLUGGY_CLIENT_ID` e
  `PLUGGY_CLIENT_SECRET` já configurados lá.
- ⏳ Falta: adicionar `SUPABASE_URL` e `SUPABASE_ANON_KEY` nas variáveis de
  ambiente do Vercel (passo 2 abaixo) e criar a conta de login (passo 3).

## 1. Banco de dados (Supabase)

Já feito no projeto `fala-real-soletra`. Se algum dia precisar rodar de novo
(ou migrar pra outro projeto Supabase), o script completo está em
[`supabase/schema.sql`](supabase/schema.sql) — cole no **SQL Editor** do
projeto e rode. Ele usa `create table if not exists`, então rodar de novo não
duplica nada. **Antes de rodar num projeto compartilhado com outro app**,
confira se os nomes `fin_*` não colidem com nada existente lá.

## 2. Ligar o Supabase ao site publicado

O app busca a URL/chave do Supabase por uma função serverless
([`api/public-config.js`](api/public-config.js)) que lê variáveis de
ambiente do Vercel — assim a chave nunca precisa ser commitada no git (o
classificador de segurança do próprio Claude Code bloqueia esse tipo de
commit, e com razão).

No painel do projeto na Vercel → **Settings → Environment Variables**,
adicione:
- `SUPABASE_URL` = `https://jptxomplvexsfyynmxju.supabase.co`
- `SUPABASE_ANON_KEY` = a chave **publishable** (Project Settings → API Keys
  no Supabase, começa com `sb_publishable_...`)

Depois clique em **Redeploy** (ou dê qualquer novo `git push`) pra essas
variáveis entrarem em vigor.

Pra rodar **localmente** durante desenvolvimento, copie
`config.example.js` para `config.js` (fica de fora do git) e preencha com os
mesmos valores — o `config.js` local tem prioridade sobre a função
serverless, então funciona igual sem precisar do Vercel.

## 3. Criar a conta de login (a mesma pra vocês dois)

Abra o site (local ou já publicado), clique em **Criar conta**, cadastre um
e-mail e senha — pode ser um e-mail de família/compartilhado. É esse login
que os dois vão usar dali em diante.

## 4. Open Finance (Pluggy) — puxar saldo real do banco

Já criado: aplicação "Meu Financeiro" na Pluggy, `PLUGGY_CLIENT_ID` e
`PLUGGY_CLIENT_SECRET` já estão nas variáveis de ambiente do Vercel.

No app, aba **Cartões → Conectar banco**: abre o widget oficial da Pluggy,
você escolhe o banco e loga direto com eles (a senha do banco não passa pelo
nosso código); ao concluir, o app busca o saldo das contas e salva em
`fin_cartoes`/`fin_saldos` no Supabase.

Enquanto vocês não pedem a chave de **produção** pra Pluggy (isso envolve
aprovação/homologação deles, já que é dado bancário real via Open Finance),
o widget está com `includeSandbox: true` — ou seja, além dos bancos reais
aparece o "Pluggy Bank" de teste, pra validar o fluxo sem usar conta real.
Quando tiverem produção liberada, tirem essa flag em
[`pluggy-connect-client.js`](pluggy-connect-client.js).

Sem `PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET` configurados, o botão
"Conectar banco" simplesmente mostra erro — o resto do app (cadastro manual
de saldo/cartão, contas, lançamentos, projeção) funciona normalmente sem a
Pluggy.

## 5. Publicar (GitHub → Vercel)

Já feito: repo em
[github.com/Welllimaoliveira/meu-financeiro](https://github.com/Welllimaoliveira/meu-financeiro)
(privado), projeto Vercel `meu-financeiro` no time WEL3D, Framework Preset
**Other** (HTML/JS puro, sem build).

Depois do primeiro deploy, todo `git push` atualiza o site sozinho — mesmo
fluxo dos outros apps (Soletra, Estuda Aí).

**Importante (visto antes com esses apps):** confira `git config user.email`
antes de commitar — precisa ser `wellinson25@hotmail.com` (conta GitHub
`Welllimaoliveira`), senão a Vercel pode bloquear o deploy automático.

## 6. App no celular

Mesmo caminho do Fala Real Academy: depois que o site estiver no ar, um
wrapper Android (WebView/Capacitor) simples aponta pra URL da Vercel. Posso
montar isso depois que o site estiver publicado e testado.

## Roadmap / próximos passos sugeridos

- Notificação push nos dias de vencimento (hoje o alerta é só visual dentro
  do app).
- Tela de categorias (hoje elas são criadas automaticamente a partir das
  opções fixas dos formulários).
- Suporte a mais de uma instituição conectada ao mesmo tempo pela Pluggy
  (o código já guarda várias linhas em `pluggy_items`/`cartoes`, falta só UI
  de "reconectar" quando uma conexão expira).
