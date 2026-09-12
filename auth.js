// ============================================================
// Autenticação (Supabase) — login único compartilhado do casal.
// Precisa de config.js (copie de config.example.js) com
// SUPABASE_URL e SUPABASE_ANON_KEY do SEU projeto.
// ============================================================

if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('authError').textContent =
      'Faltou configurar config.js com a URL e a chave anon do Supabase (veja config.example.js).';
    document.getElementById('authError').classList.add('show');
  });
}

const supabaseClient = window.supabase && window.SUPABASE_URL
  ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
  : null;

let authMode = 'login';

function setAuthTab(mode) {
  authMode = mode;
  document.getElementById('authTabLogin').classList.toggle('active', mode === 'login');
  document.getElementById('authTabSignup').classList.toggle('active', mode === 'signup');
  document.getElementById('authSubmitBtn').textContent = mode === 'login' ? 'Entrar' : 'Criar conta';
  hideAuthError();
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.classList.add('show');
}
function hideAuthError() {
  document.getElementById('authError').classList.remove('show');
}

async function submitAuth(e) {
  e.preventDefault();
  hideAuthError();
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const btn = document.getElementById('authSubmitBtn');
  btn.disabled = true;

  try {
    if (authMode === 'login') {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else {
      const { error } = await supabaseClient.auth.signUp({ email, password });
      if (error) throw error;
      showAuthError('Conta criada! Se o Supabase pedir confirmação por e-mail, confirme antes de entrar.');
    }
    await onAuthReady();
  } catch (err) {
    showAuthError(traduzErroAuth(err.message));
  } finally {
    btn.disabled = false;
  }
  return false;
}

function traduzErroAuth(msg) {
  if (/Invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/User already registered/i.test(msg)) return 'Já existe uma conta com esse e-mail — use "Entrar".';
  if (/Password should be/i.test(msg)) return 'A senha precisa ter pelo menos 6 caracteres.';
  return msg;
}

async function logout() {
  await supabaseClient.auth.signOut();
  document.getElementById('app').classList.add('hidden');
  document.getElementById('auth-wrap').classList.remove('hidden');
}

async function onAuthReady() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    document.getElementById('auth-wrap').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    await iniciarApp();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (!supabaseClient) return;
  onAuthReady();
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    if (!session) {
      document.getElementById('app').classList.add('hidden');
      document.getElementById('auth-wrap').classList.remove('hidden');
    }
  });
});
