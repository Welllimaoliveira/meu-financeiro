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

## 1. Criar o projeto Supabase

1. Crie um projeto novo em [supabase.com](https://supabase.com/dashboard) —
   sugestão de nome: `meu-financeiro`.
2. Abra **SQL Editor** → cole o conteúdo de [`supabase/schema.sql`](supabase/schema.sql)
   → **Run**. Isso cria as tabelas e já liga o RLS (cada login só vê os
   próprios dados — como o login é único e compartilhado, os dois enxergam
   tudo igual).
3. Em **Authentication → Providers**, confirme que **Email** está habilitado.
   Se quiser pular a confirmação por e-mail (mais rápido pra vocês dois
   testarem), desative "Confirm email" em **Authentication → Settings**.
4. Em **Project Settings → API**, copie a **Project URL** e a chave
   **anon public**.

## 2. Configurar o app localmente

```bash
cp config.example.js config.js
```

Edite `config.js` com a URL e a chave anon copiadas acima. Esse arquivo **não
vai pro git** (está no `.gitignore`) — em produção (Vercel) você vai recriar
esses valores como variáveis de ambiente ou, mais simples aqui, gerar o
`config.js` direto no build (veja seção 5).

## 3. Criar a conta de login (a mesma pra vocês dois)

Abra o site (local ou já publicado), clique em **Criar conta**, cadastre um
e-mail e senha — pode ser um e-mail de família/compartilhado. É esse login
que os dois vão usar dali em diante.

## 4. Open Finance (Pluggy) — puxar saldo real do banco

1. Crie uma conta em [dashboard.pluggy.ai](https://dashboard.pluggy.ai) (tem
   modo **sandbox** gratuito, com um banco de teste chamado "Pluggy Bank" —
   dá pra testar o fluxo inteiro sem nenhum custo e sem usar seu banco real).
2. Em **Applications**, pegue o **Client ID** e o **Client Secret**.
3. Essas duas chaves vão como variáveis de ambiente do **Vercel** (nunca no
   `config.js`, nunca no navegador):
   - `PLUGGY_CLIENT_ID`
   - `PLUGGY_CLIENT_SECRET`
4. No app, aba **Cartões → Conectar banco**: abre o widget oficial da
   Pluggy, você escolhe o banco e loga direto com eles (a senha do banco não
   passa pelo nosso código); ao concluir, o app busca o saldo das contas e
   salva em `cartoes`/`saldos` no Supabase.
5. Enquanto vocês não pedem a chave de **produção** pra Pluggy (isso envolve
   aprovação/homologação deles, já que é dado bancário real via Open
   Finance), o widget está com `includeSandbox: true` — ou seja, além dos
   bancos reais aparece o "Pluggy Bank" de teste. Quando tiverem produção
   liberada, tirem essa flag em [`pluggy-connect-client.js`](pluggy-connect-client.js).

Sem essas duas variáveis configuradas, o botão "Conectar banco" simplesmente
mostra erro — o resto do app (cadastro manual de saldo/cartão, contas,
lançamentos, projeção) funciona normalmente sem a Pluggy.

## 5. Publicar (GitHub → Vercel)

```bash
gh repo create Welllimaoliveira/meu-financeiro --private --source=. --remote=origin --push
```

Depois, em [vercel.com/new](https://vercel.com/new), importe o repositório:
- Framework Preset: **Other** (é HTML/JS puro, sem build).
- Em **Environment Variables**, adicione `PLUGGY_CLIENT_ID` e
  `PLUGGY_CLIENT_SECRET`.
- Como o `config.js` (URL/chave do Supabase) fica fora do git, adicione
  também um passo de build simples que o gera a partir de variáveis de
  ambiente do Vercel (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) — ou, mais
  simples enquanto o projeto é só de vocês dois, comite um `config.js` com
  a chave **anon** (ela é pública por design, protegida pelo RLS) direto no
  repo privado.

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
