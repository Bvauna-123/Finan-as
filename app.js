import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  query,
  where,
  getDocs,
  deleteDoc,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDTS3SboPCzvNOpEjtMhqiXFxHZxd7FiXo",
  authDomain: "financas-62b92.firebaseapp.com",
  projectId: "financas-62b92",
  storageBucket: "financas-62b92.firebasestorage.app",
  messagingSenderId: "310565146773",
  appId: "1:310565146773:web:01cbfcbb3bc4f97b624b9c",
  measurementId: "G-NFCBYPB4NJ"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

enableIndexedDbPersistence(db).catch(err => console.warn('Offline PWA indisponível', err));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(err => console.error(err));

setPersistence(auth, browserLocalPersistence).catch(err => console.warn("Persistência local:", err));

function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}
refreshIcons();

function detectarTamanhoTela() {
    const w = window.innerWidth;
    let mode = 'compact';

    if (w >= 1024) {
        mode = 'desktop';
    } else if (w >= 640) {
        mode = 'tablet';
    }

    document.documentElement.dataset.viewport = mode;
}

detectarTamanhoTela();
window.addEventListener('resize', detectarTamanhoTela, { passive: true });
window.addEventListener('orientationchange', () => setTimeout(detectarTamanhoTela, 120), { passive: true });

// Bloqueador de zoom (pinça, duplo toque e Ctrl+roda do mouse)
['gesturestart', 'gesturechange', 'gestureend'].forEach(evtName => {
    document.addEventListener(evtName, (e) => e.preventDefault(), { passive: false });
});

document.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length > 1) {
        e.preventDefault();
    }
}, { passive: false });

let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
    if (e.touches && e.touches.length > 0) return;
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
        e.preventDefault();
    }
    lastTouchEnd = now;
}, { passive: false });

document.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
        e.preventDefault();
    }
}, { passive: false });

let currentUserId = null;
let cartoesUsuario = [];
let categoriasUsuario = [];
let faturasPorCartaoMes = {};
let fotoCadastroBase64 = null;
let deferredInstallPrompt = null;

const formatadorReal = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
let meuGrafico = null;
let idEdicaoAtual = null;
const PALETA_CORES = ['#22E56D', '#38BDF8', '#A78BFA', '#FBBF24', '#FB7185', '#34D399', '#818CF8', '#F472B6', '#2DD4BF', '#A3E635'];

function setBotaoCarregando(btn, carregando, textoCarregando = 'Salvando...') {
    if (!btn) return;
    const span = btn.querySelector('span');
    if (carregando) {
        btn.disabled = true;
        btn.dataset.textoOriginal = span ? span.textContent : '';
        if (span) span.textContent = textoCarregando;
    } else {
        btn.disabled = false;
        if (span && btn.dataset.textoOriginal) {
            span.textContent = btn.dataset.textoOriginal;
        }
    }
}

function isAppInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIosDevice() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (!isAppInstalled()) {
        document.getElementById('btn-instalar-app-topbar').classList.remove('hidden');
    }
});

window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    document.getElementById('btn-instalar-app-topbar').classList.add('hidden');
    toggleModal('modal-instalar-app', 'close');
    showToast("Zedona instalado no dispositivo.", "success");
});

function abrirPromptInstalacaoSeAplicavel() {
    if (isAppInstalled()) return;
    const textoEl = document.getElementById('instrucao-instalacao-texto');
    const btnInstalar = document.getElementById('btn-confirmar-instalacao');

    if (deferredInstallPrompt) {
        textoEl.textContent = "Instale o Zedona na tela inicial para acesso rápido, tela cheia e sem zoom.";
        btnInstalar.classList.remove('hidden');
        toggleModal('modal-instalar-app', 'open');
    } else if (isIosDevice()) {
        textoEl.textContent = "No Safari do iPhone, toque em Compartilhar e escolha 'Adicionar à Tela de Início'.";
        btnInstalar.classList.add('hidden');
        toggleModal('modal-instalar-app', 'open');
    }
}

document.getElementById('btn-instalar-app-topbar').addEventListener('click', abrirPromptInstalacaoSeAplicavel);

document.getElementById('btn-confirmar-instalacao').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    toggleModal('modal-instalar-app', 'close');
    if (outcome === 'accepted') {
        document.getElementById('btn-instalar-app-topbar').classList.add('hidden');
    }
});

function lerImagemComprimida(file, maxSize = 240) {
    return new Promise((resolve, reject) => {
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let { width, height } = img;
                if (width > height && width > maxSize) {
                    height = Math.round((height * maxSize) / width);
                    width = maxSize;
                } else if (height >= width && height > maxSize) {
                    width = Math.round((width * maxSize) / height);
                    height = maxSize;
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.78));
            };
            img.onerror = reject;
            img.src = ev.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function atualizarAvatarHeader(fotoUrl) {
    const imgEl = document.getElementById('header-avatar-img');
    const fallbackEl = document.getElementById('header-avatar-fallback');
    if (fotoUrl) {
        imgEl.src = fotoUrl;
        imgEl.classList.remove('hidden');
        fallbackEl.classList.add('hidden');
    } else {
        imgEl.src = '';
        imgEl.classList.add('hidden');
        fallbackEl.classList.remove('hidden');
    }
}

document.getElementById('auth-foto-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) {
        fotoCadastroBase64 = null;
        document.getElementById('auth-foto-label').textContent = 'Selecionar imagem';
        return;
    }
    try {
        fotoCadastroBase64 = await lerImagemComprimida(file);
        const prev = document.getElementById('preview-foto-cadastro');
        prev.src = fotoCadastroBase64;
        prev.classList.remove('hidden');
        document.getElementById('auth-foto-label').textContent = file.name;
    } catch {
        showToast("Erro ao carregar imagem.", "error");
    }
});

function showToast(mensagem, tipo = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${tipo}`;

    const dot = document.createElement('span');
    dot.className = 'toast-dot';

    const spanMsg = document.createElement('span');
    spanMsg.textContent = mensagem;

    toast.appendChild(dot);
    toast.appendChild(spanMsg);
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideIn 0.25s reverse forwards';
        setTimeout(() => toast.remove(), 250);
    }, 3000);
}

function sincronizarRolagemModais() {
    const algumAberto = Array.from(document.querySelectorAll('.modal-overlay'))
        .some(m => !m.classList.contains('hidden'));
    document.body.style.overflow = algumAberto ? 'hidden' : '';
}

function toggleModal(modalId, action) {
    const modal = document.getElementById(modalId);
    if (action === 'open') {
        modal.classList.remove('hidden');
        modal.scrollTop = 0;
        const content = modal.querySelector('.modal-content');
        if (content) content.scrollTop = 0;
        sincronizarRolagemModais();
        refreshIcons();
    } else {
        modal.classList.add('hidden');
        sincronizarRolagemModais();
    }
}

document.querySelectorAll('.btn-fechar').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal-overlay');
        if (modal) {
            modal.classList.add('hidden');
            sincronizarRolagemModais();
        }
    });
});

function showConfirmModal(onConfirmCallback) {
    toggleModal('modal-confirmacao', 'open');
    const btnConfirmar = document.getElementById('btn-modal-confirmar');
    const btnCancelar = document.getElementById('btn-modal-cancelar');

    const fechar = () => {
        toggleModal('modal-confirmacao', 'close');
        btnConfirmar.onclick = null;
        btnCancelar.onclick = null;
    };
    btnCancelar.onclick = fechar;
    btnConfirmar.onclick = () => { fechar(); onConfirmCallback(); };
}

document.querySelectorAll('input[name="authMode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const isRegister = e.target.value === 'register';
        document.getElementById('grupo-nome-cadastro').classList.toggle('hidden', !isRegister);
        document.getElementById('grupo-foto-cadastro').classList.toggle('hidden', !isRegister);
        document.getElementById('auth-nome').required = isRegister;
        document.querySelector('#btn-auth-submit span').textContent = isRegister ? 'Criar Conta' : 'Entrar na Conta';
        document.getElementById('btn-esqueci-senha').classList.toggle('hidden', isRegister);
    });
});

document.getElementById('btn-esqueci-senha').addEventListener('click', async () => {
    const email = document.getElementById('auth-email').value.trim();
    if (!email) {
        showToast("Digite seu e-mail acima para recuperar a senha.", "error");
        document.getElementById('auth-email').focus();
        return;
    }

    try {
        await sendPasswordResetEmail(auth, email);
        showToast("Link de redefinição enviado para o seu e-mail.", "success");
    } catch (error) {
        let msg = "Não foi possível enviar o e-mail de recuperação.";
        if (error.code === 'auth/invalid-email') msg = "Informe um e-mail válido.";
        else if (error.code === 'auth/user-not-found') msg = "Nenhuma conta encontrada com este e-mail.";
        showToast(msg, "error");
    }
});

document.getElementById('form-auth').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSubmit = document.getElementById('btn-auth-submit');
    const mode = document.querySelector('input[name="authMode"]:checked').value;
    const email = document.getElementById('auth-email').value.trim();
    const senha = document.getElementById('auth-senha').value;
    const nome = document.getElementById('auth-nome').value.trim();

    setBotaoCarregando(btnSubmit, true, mode === 'register' ? 'Criando...' : 'Entrando...');
    try {
        if (mode === 'register') {
            const cred = await createUserWithEmailAndPassword(auth, email, senha);
            if (nome) await updateProfile(cred.user, { displayName: nome });

            await setDoc(doc(db, "usuarios", cred.user.uid), {
                nome: nome || email.split('@')[0],
                email,
                fotoUrl: fotoCadastroBase64 || "",
                salarioBase: 0,
                categorias: [],
                cartoes: [],
                criadoEm: new Date().toISOString()
            }, { merge: true });

            fotoCadastroBase64 = null;
            document.getElementById('preview-foto-cadastro').classList.add('hidden');
            document.getElementById('auth-foto-label').textContent = 'Selecionar imagem';
            showToast("Conta criada no Zedona.", "success");
        } else {
            await signInWithEmailAndPassword(auth, email, senha);
            showToast("Sessão iniciada no Zedona.", "success");
        }
        document.getElementById('form-auth').reset();
        setTimeout(abrirPromptInstalacaoSeAplicavel, 700);
    } catch (error) {
        let msg = "Erro ao autenticar.";
        if (error.code === 'auth/email-already-in-use') msg = "Este e-mail já está cadastrado.";
        else if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') msg = "E-mail ou senha inválidos.";
        else if (error.code === 'auth/weak-password') msg = "A senha deve ter no mínimo 6 caracteres.";
        showToast(msg, "error");
    } finally {
        setBotaoCarregando(btnSubmit, false);
    }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
    try {
        await signOut(auth);
        showToast("Sessão encerrada.", "success");
    } catch {
        showToast("Erro ao sair da conta.", "error");
    }
});

onAuthStateChanged(auth, async (user) => {
    const authScreen = document.getElementById('auth-screen');
    const appLayout = document.querySelector('.app-layout');
    const subtitulo = document.getElementById('usuario-subtitulo');

    if (user) {
        currentUserId = user.uid;
        subtitulo.textContent = `Olá, ${user.displayName || user.email}`;
        authScreen.classList.add('hidden');
        appLayout.classList.remove('hidden');
        detectarTamanhoTela();
        refreshIcons();
        await inicializarApp();
    } else {
        currentUserId = null;
        cartoesUsuario = [];
        categoriasUsuario = [];
        faturasPorCartaoMes = {};
        atualizarAvatarHeader("");
        if (meuGrafico) { meuGrafico.destroy(); meuGrafico = null; }
        appLayout.classList.add('hidden');
        authScreen.classList.remove('hidden');
        refreshIcons();
    }
});

// Modal de Foto de Perfil
document.getElementById('btn-abrir-perfil').addEventListener('click', async () => {
    if (!currentUserId) return;
    const snap = await getDoc(doc(db, "usuarios", currentUserId));
    const fotoAtual = snap.exists() ? (snap.data().fotoUrl || "") : "";
    document.getElementById('input-foto-url').value = fotoAtual.startsWith('http') ? fotoAtual : '';
    document.getElementById('input-foto-arquivo').value = '';
    document.getElementById('modal-foto-label').textContent = 'Escolher imagem';
    const prev = document.getElementById('preview-foto-modal');
    if (fotoAtual) {
        prev.src = fotoAtual;
        prev.classList.remove('hidden');
    } else {
        prev.classList.add('hidden');
    }
    toggleModal('modal-perfil', 'open');
});

document.getElementById('input-foto-arquivo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const base64 = await lerImagemComprimida(file);
    document.getElementById('input-foto-url').value = base64;
    document.getElementById('modal-foto-label').textContent = file.name;
    const prev = document.getElementById('preview-foto-modal');
    prev.src = base64;
    prev.classList.remove('hidden');
});

document.getElementById('form-foto-perfil').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUserId) return;
    const btnSubmit = e.target.querySelector('button[type="submit"]');
    const fotoFinal = document.getElementById('input-foto-url').value.trim();

    atualizarAvatarHeader(fotoFinal);
    toggleModal('modal-perfil', 'close');
    showToast("Foto de perfil atualizada.", "success");

    setBotaoCarregando(btnSubmit, true, 'Salvando...');
    try {
        await setDoc(doc(db, "usuarios", currentUserId), { fotoUrl: fotoFinal }, { merge: true });
    } catch {
        showToast("Falha ao sincronizar foto.", "error");
    } finally {
        setBotaoCarregando(btnSubmit, false);
    }
});

// Gerenciamento de Cartões de Crédito (Modo Cartões + Lançamento)
function aplicarCartoesNaTela(selecionarId = null) {
    const select = document.getElementById('cartao-id');
    const valorAlvo = selecionarId || select.value;

    select.innerHTML = '<option value="">Selecione um cartão...</option>';
    cartoesUsuario.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        const detalhes = [];
        if (c.fechamento) detalhes.push(`Fecha dia ${c.fechamento}`);
        if (c.vencimento) detalhes.push(`Vence dia ${c.vencimento}`);
        opt.textContent = detalhes.length ? `${c.nome} (${detalhes.join(' • ')})` : c.nome;
        select.appendChild(opt);
    });
    if (valorAlvo && cartoesUsuario.some(c => c.id === valorAlvo)) {
        select.value = valorAlvo;
    }

    renderizarListaCartoes();
}

async function carregarCartoesUsuario(selecionarId = null, forcarRede = false) {
    if (!currentUserId) return;
    if (!forcarRede && cartoesUsuario.length > 0) {
        aplicarCartoesNaTela(selecionarId);
        return;
    }

    try {
        const snap = await getDoc(doc(db, "usuarios", currentUserId));
        cartoesUsuario = snap.exists() && Array.isArray(snap.data().cartoes) ? snap.data().cartoes : [];
        aplicarCartoesNaTela(selecionarId);
    } catch (e) {
        console.error("Erro ao carregar cartões", e);
        aplicarCartoesNaTela(selecionarId);
    }
}

function renderizarListaCartoes() {
    const container = document.getElementById('lista-cartoes-container');
    container.innerHTML = '';
    container.className = 'cartoes-grid-cards';

    if (!cartoesUsuario.length) {
        const p = document.createElement('p');
        p.className = 'text-muted text-sm text-center';
        p.textContent = 'Nenhum cartão cadastrado ainda.';
        container.appendChild(p);
        return;
    }

    const mesReferencia = document.getElementById('consulta-mes')?.value || '';

    cartoesUsuario.forEach(c => {
        const corBase = c.cor || '#22E56D';
        const valorFatura = faturasPorCartaoMes[c.id] || 0;

        const cardEl = document.createElement('div');
        cardEl.className = 'cartao-visual-card';
        cardEl.style.setProperty('--card-color', corBase);

        const topRow = document.createElement('div');
        topRow.className = 'cartao-visual-top';

        const brandWrap = document.createElement('div');
        brandWrap.className = 'cartao-visual-brand';

        const chip = document.createElement('span');
        chip.className = 'cartao-chip';

        const nomeStrong = document.createElement('strong');
        nomeStrong.className = 'cartao-visual-nome';
        nomeStrong.textContent = c.nome;

        brandWrap.appendChild(chip);
        brandWrap.appendChild(nomeStrong);

        const btnRem = document.createElement('button');
        btnRem.type = 'button';
        btnRem.className = 'btn-icon danger btn-remover-cartao';
        btnRem.dataset.id = c.id;
        btnRem.title = 'Remover cartão';
        btnRem.innerHTML = '<i data-lucide="trash-2"></i>';

        topRow.appendChild(brandWrap);
        topRow.appendChild(btnRem);

        const faturaBox = document.createElement('div');
        faturaBox.className = 'cartao-visual-fatura';

        const faturaLabel = document.createElement('span');
        faturaLabel.textContent = mesReferencia
            ? `Fatura prevista (${mesReferencia.split('-').reverse().join('/')})`
            : 'Fatura prevista no vencimento';

        const faturaValor = document.createElement('strong');
        faturaValor.textContent = formatadorReal.format(valorFatura);

        faturaBox.appendChild(faturaLabel);
        faturaBox.appendChild(faturaValor);

        const metaRow = document.createElement('div');
        metaRow.className = 'cartao-visual-meta';

        const fechaSpan = document.createElement('span');
        fechaSpan.textContent = c.fechamento ? `Fechamento: dia ${c.fechamento}` : 'Fechamento: não informado';

        const venceSpan = document.createElement('span');
        venceSpan.textContent = c.vencimento ? `Vencimento: dia ${c.vencimento}` : 'Vencimento: não informado';

        metaRow.appendChild(fechaSpan);
        metaRow.appendChild(venceSpan);

        cardEl.appendChild(topRow);
        cardEl.appendChild(faturaBox);
        cardEl.appendChild(metaRow);
        container.appendChild(cardEl);
    });

    refreshIcons();
}

async function abrirModalCartoes() {
    await atualizarDashboardMensal();
    aplicarCartoesNaTela();
    toggleModal('modal-cartoes', 'open');
}

document.getElementById('btn-abrir-cartoes').addEventListener('click', abrirModalCartoes);
document.getElementById('dock-btn-cartoes').addEventListener('click', abrirModalCartoes);
document.getElementById('btn-atalho-novo-cartao').addEventListener('click', abrirModalCartoes);

document.getElementById('form-novo-cartao').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUserId) return;

    const btnSubmit = e.target.querySelector('button[type="submit"]');
    const nomeInput = document.getElementById('input-nome-cartao');
    const fechInput = document.getElementById('input-fechamento-cartao');
    const vencInput = document.getElementById('input-vencimento-cartao');
    const corInput = document.getElementById('input-cor-cartao');

    const nome = nomeInput.value.trim();
    const fechamento = parseInt(fechInput.value, 10) || null;
    const vencimento = parseInt(vencInput.value, 10) || null;
    const cor = corInput.value || '#22E56D';
    if (!nome) return;

    const estadoAnterior = [...cartoesUsuario];
    const novoCartao = { id: 'card_' + Date.now(), nome, fechamento, vencimento, cor };
    cartoesUsuario = [...cartoesUsuario, novoCartao];

    nomeInput.value = '';
    fechInput.value = '';
    vencInput.value = '';
    corInput.value = '#22e56d';

    aplicarCartoesNaTela(novoCartao.id);
    showToast("Cartão adicionado.", "success");

    setBotaoCarregando(btnSubmit, true, 'Salvando...');
    try {
        await setDoc(doc(db, "usuarios", currentUserId), { cartoes: cartoesUsuario }, { merge: true });
    } catch {
        cartoesUsuario = estadoAnterior;
        aplicarCartoesNaTela();
        showToast("Falha ao sincronizar cartão.", "error");
    } finally {
        setBotaoCarregando(btnSubmit, false);
    }
});

document.getElementById('lista-cartoes-container').addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-remover-cartao');
    if (!btn || !currentUserId || btn.disabled) return;

    const idRemover = btn.dataset.id;
    const estadoAnterior = [...cartoesUsuario];

    cartoesUsuario = cartoesUsuario.filter(c => c.id !== idRemover);
    aplicarCartoesNaTela();
    showToast("Cartão removido.", "success");

    btn.disabled = true;
    try {
        await setDoc(doc(db, "usuarios", currentUserId), { cartoes: cartoesUsuario }, { merge: true });
    } catch {
        cartoesUsuario = estadoAnterior;
        aplicarCartoesNaTela();
        showToast("Falha ao remover cartão na nuvem.", "error");
    } finally {
        btn.disabled = false;
    }
});

document.querySelectorAll('input[name="formaPagamento"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const isCredito = e.target.value === 'credito';
        document.getElementById('grupo-cartao-selecao').classList.toggle('hidden', !isCredito);
    });
});

document.querySelectorAll('input[name="filtroMetodo"]').forEach(radio => {
    radio.addEventListener('change', () => atualizarDashboardMensal());
});

// Gerenciamento de Categorias (vazio inicialmente, cadastrado e excluído pelo usuário)
function renderizarListaCategorias() {
    const container = document.getElementById('lista-categorias-container');
    if (!container) return;
    container.innerHTML = '';

    if (!categoriasUsuario.length) {
        const p = document.createElement('p');
        p.className = 'text-muted text-sm text-center';
        p.textContent = 'Nenhuma categoria cadastrada.';
        container.appendChild(p);
        return;
    }

    categoriasUsuario.forEach(cat => {
        const div = document.createElement('div');
        div.className = 'categoria-item';

        const info = document.createElement('div');
        const strong = document.createElement('strong');
        strong.textContent = cat;
        info.appendChild(strong);

        const btnRem = document.createElement('button');
        btnRem.type = 'button';
        btnRem.className = 'btn-icon danger btn-remover-categoria';
        btnRem.dataset.cat = cat;
        btnRem.title = 'Excluir categoria';
        btnRem.innerHTML = '<i data-lucide="trash-2"></i>';

        div.appendChild(info);
        div.appendChild(btnRem);
        container.appendChild(div);
    });

    refreshIcons();
}

function aplicarCategoriasNaTela(selecionarValor = null) {
    const select = document.getElementById("categoria");
    const valorAlvo = selecionarValor || select.value;
    const unicas = [...new Set(categoriasUsuario)];
    categoriasUsuario = unicas;

    select.innerHTML = '';

    const placeholderOpt = document.createElement('option');
    placeholderOpt.value = '';
    placeholderOpt.disabled = true;
    placeholderOpt.selected = !valorAlvo || !unicas.includes(valorAlvo);
    placeholderOpt.textContent = unicas.length
        ? 'Selecione uma categoria...'
        : 'Nenhuma categoria cadastrada (use +)';
    select.appendChild(placeholderOpt);

    unicas.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        select.appendChild(opt);
    });

    if (valorAlvo && unicas.includes(valorAlvo)) {
        select.value = valorAlvo;
    }

    renderizarListaCategorias();
}

async function carregarCategoriasNoSelect(selecionarValor = null, forcarRede = false) {
    if (!currentUserId) return;

    if (!forcarRede && categoriasUsuario.length > 0) {
        aplicarCategoriasNaTela(selecionarValor);
        return;
    }

    try {
        const userSnap = await getDoc(doc(db, "usuarios", currentUserId));
        categoriasUsuario = userSnap.exists() && Array.isArray(userSnap.data().categorias)
            ? [...new Set(userSnap.data().categorias)]
            : [];
        aplicarCategoriasNaTela(selecionarValor);
    } catch (e) {
        console.error("Erro ao carregar categorias", e);
        aplicarCategoriasNaTela(selecionarValor);
    }
}

document.getElementById('btn-abrir-nova-cat').addEventListener('click', async () => {
    aplicarCategoriasNaTela();
    toggleModal('modal-nova-categoria', 'open');
    await carregarCategoriasNoSelect(null, true);
});

document.getElementById('form-nova-categoria').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUserId) return;

    const btnSubmit = e.target.querySelector('button[type="submit"]');
    const inputEl = document.getElementById('input-nova-cat');
    const raw = inputEl.value.trim();
    if (!raw) return;

    const catFormatada = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    const estadoAnterior = [...categoriasUsuario];

    if (!categoriasUsuario.includes(catFormatada)) {
        categoriasUsuario = [...categoriasUsuario, catFormatada];
    }

    inputEl.value = '';
    aplicarCategoriasNaTela(catFormatada);
    showToast("Categoria adicionada.", "success");

    setBotaoCarregando(btnSubmit, true, 'Salvando...');
    try {
        await setDoc(doc(db, "usuarios", currentUserId), { categorias: categoriasUsuario }, { merge: true });
    } catch {
        categoriasUsuario = estadoAnterior;
        aplicarCategoriasNaTela();
        showToast("Falha ao sincronizar categoria.", "error");
    } finally {
        setBotaoCarregando(btnSubmit, false);
    }
});

document.getElementById('lista-categorias-container').addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-remover-categoria');
    if (!btn || !currentUserId || btn.disabled) return;

    const catRemover = btn.dataset.cat;
    const estadoAnterior = [...categoriasUsuario];

    categoriasUsuario = categoriasUsuario.filter(c => c !== catRemover);
    aplicarCategoriasNaTela();
    showToast("Categoria excluída.", "success");

    btn.disabled = true;
    try {
        await setDoc(doc(db, "usuarios", currentUserId), { categorias: categoriasUsuario }, { merge: true });
    } catch {
        categoriasUsuario = estadoAnterior;
        aplicarCategoriasNaTela();
        showToast("Falha ao excluir categoria na nuvem.", "error");
    } finally {
        btn.disabled = false;
    }
});

async function abrirModalLancamento() {
    idEdicaoAtual = null;
    document.getElementById("form-despesa").reset();
    document.getElementById("modal-lancamento-titulo").textContent = "Adicionar Lançamento";
    document.querySelector("#btn-submit-lancamento span").textContent = "Salvar Lançamento";
    document.getElementById("tipo-parcelada").click();
    document.getElementById("pag-debito").click();
    await carregarCategoriasNoSelect();
    await carregarCartoesUsuario();
    toggleModal('modal-form-lancamento', 'open');
}

function abrirModalSimulador() {
    toggleModal('modal-form-simulador', 'open');
}

document.getElementById('btn-abrir-lancamento').addEventListener('click', abrirModalLancamento);
document.getElementById('dock-btn-lancamento').addEventListener('click', abrirModalLancamento);
document.getElementById('btn-abrir-simulador').addEventListener('click', abrirModalSimulador);
document.getElementById('dock-btn-simulador').addEventListener('click', abrirModalSimulador);

async function atualizarDashboardMensal() {
    if (!currentUserId) return;
    const mesConsulta = document.getElementById("consulta-mes").value;
    if (!mesConsulta) return;

    const filtroMetodo = document.querySelector('input[name="filtroMetodo"]:checked')?.value || 'todos';
    const tbody = document.getElementById("lista-despesas-corpo");
    const emptyState = document.getElementById("empty-state");

    try {
        const userSnap = await getDoc(doc(db, "usuarios", currentUserId));
        if (!userSnap.exists()) return;
        const userData = userSnap.data();
        const rendaMensal = userData.salarioBase || 0;
        cartoesUsuario = Array.isArray(userData.cartoes) ? userData.cartoes : [];
        if (Array.isArray(userData.categorias)) {
            categoriasUsuario = [...new Set(userData.categorias)];
        }
        const mapaCartoes = Object.fromEntries(cartoesUsuario.map(c => [c.id, c]));

        const q = query(collection(db, "transacoes"), where("userId", "==", currentUserId));
        const querySnapshot = await getDocs(q);

        let totalDespesasMes = 0;
        let totalDebitoMes = 0;
        let totalCreditoMes = 0;
        let countLancamentos = 0;
        let gastosCategoria = {};
        let gastosPorCartao = {};
        tbody.innerHTML = "";

        const dictCores = {};
        let corIndex = 0;

        querySnapshot.forEach((documento) => {
            const despesa = documento.data();
            const ehAtivaNoMes = despesa.isFixa ? (mesConsulta >= despesa.mesInicio) : (mesConsulta >= despesa.mesInicio && mesConsulta <= despesa.mesFim);

            if (ehAtivaNoMes) {
                const metodo = despesa.formaPagamento || 'debito';
                if (metodo === 'credito') {
                    totalCreditoMes += despesa.valorParcela;
                    const chaveCartao = despesa.cartaoId || 'sem_cartao';
                    gastosPorCartao[chaveCartao] = (gastosPorCartao[chaveCartao] || 0) + despesa.valorParcela;
                } else {
                    totalDebitoMes += despesa.valorParcela;
                }

                if (filtroMetodo !== 'todos' && metodo !== filtroMetodo) return;

                countLancamentos++;
                totalDespesasMes += despesa.valorParcela;

                const cat = despesa.categoria || 'Sem categoria';
                if (gastosCategoria[cat] === undefined) gastosCategoria[cat] = 0;
                gastosCategoria[cat] += despesa.valorParcela;

                if (!dictCores[cat]) { dictCores[cat] = PALETA_CORES[corIndex % PALETA_CORES.length]; corIndex++; }

                const progresso = despesa.isFixa
                    ? "Fixa"
                    : `${((new Date(mesConsulta + "-15").getFullYear() - new Date(despesa.mesInicio + "-15").getFullYear()) * 12) + (new Date(mesConsulta + "-15").getMonth() - new Date(despesa.mesInicio + "-15").getMonth()) + 1}/${despesa.parcelasTotal}`;

                const cartaoObj = metodo === 'credito' && despesa.cartaoId ? mapaCartoes[despesa.cartaoId] : null;
                const rotuloMetodo = metodo === 'credito'
                    ? (cartaoObj ? cartaoObj.nome : 'Crédito')
                    : 'Débito';

                const tr = document.createElement("tr");

                const tdDesc = document.createElement("td");
                const strongDesc = document.createElement("strong");
                strongDesc.textContent = despesa.descricao;
                strongDesc.style.display = "block";

                const divRef = document.createElement("div");
                divRef.className = "text-muted text-sm mt-1";
                divRef.textContent = `Ref: ${progresso}`;
                tdDesc.appendChild(strongDesc);
                tdDesc.appendChild(divRef);

                const tdCat = document.createElement("td");
                const badge = document.createElement("span");
                badge.className = "dynamic-badge";
                badge.style.backgroundColor = dictCores[cat];
                badge.textContent = cat;

                const divMetodo = document.createElement("div");
                divMetodo.className = "mt-1";
                const mBadge = document.createElement("span");
                mBadge.className = "metodo-badge";
                if (cartaoObj?.cor) mBadge.style.borderColor = cartaoObj.cor;
                mBadge.innerHTML = metodo === 'credito'
                    ? `<i data-lucide="credit-card" style="width:12px;height:12px;"></i>`
                    : `<i data-lucide="banknote" style="width:12px;height:12px;"></i>`;
                const mText = document.createElement("span");
                mText.textContent = rotuloMetodo;
                mBadge.appendChild(mText);
                divMetodo.appendChild(mBadge);

                tdCat.appendChild(badge);
                tdCat.appendChild(divMetodo);

                const tdValor = document.createElement("td");
                tdValor.style.fontWeight = "700";
                tdValor.style.whiteSpace = "nowrap";
                tdValor.textContent = formatadorReal.format(despesa.valorParcela);

                const tdAcoes = document.createElement("td");
                tdAcoes.className = "text-right";
                tdAcoes.style.whiteSpace = "nowrap";

                const btnEditar = document.createElement("button");
                btnEditar.type = "button";
                btnEditar.className = "btn-icon btn-editar";
                btnEditar.dataset.id = documento.id;
                btnEditar.title = "Editar";
                btnEditar.innerHTML = '<i data-lucide="pencil"></i>';

                const btnExcluir = document.createElement("button");
                btnExcluir.type = "button";
                btnExcluir.className = "btn-icon danger btn-excluir";
                btnExcluir.dataset.id = documento.id;
                btnExcluir.title = "Excluir";
                btnExcluir.style.marginLeft = "4px";
                btnExcluir.innerHTML = '<i data-lucide="trash-2"></i>';

                tdAcoes.appendChild(btnEditar);
                tdAcoes.appendChild(btnExcluir);

                tr.appendChild(tdDesc);
                tr.appendChild(tdCat);
                tr.appendChild(tdValor);
                tr.appendChild(tdAcoes);
                tbody.appendChild(tr);
            }
        });

        faturasPorCartaoMes = { ...gastosPorCartao };
        renderizarListaCartoes();
        refreshIcons();

        const ctx = document.getElementById('categoryChart').getContext('2d');
        if (meuGrafico) meuGrafico.destroy();

        if (countLancamentos > 0) {
            const labels = Object.keys(gastosCategoria);
            const dataColors = labels.map(label => dictCores[label]);

            meuGrafico = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        data: Object.values(gastosCategoria),
                        backgroundColor: dataColors,
                        borderWidth: 0,
                        hoverOffset: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '72%',
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: { color: '#9AA6A0', boxWidth: 10, padding: 12 }
                        }
                    }
                }
            });
            document.querySelector('.chart-container').classList.remove('hidden');
            emptyState.classList.add('hidden');
            document.querySelector('.modern-table').classList.remove('hidden');
        } else {
            document.querySelector('.chart-container').classList.add('hidden');
            emptyState.classList.remove('hidden');
            document.querySelector('.modern-table').classList.add('hidden');
        }

        const saldoLivre = rendaMensal - totalDespesasMes;
        const percentualComprometido = rendaMensal > 0 ? Math.round((totalDespesasMes / rendaMensal) * 100) : 0;
        const larguraBarra = Math.min(100, Math.max(0, percentualComprometido));

        document.getElementById("dash-renda").textContent = formatadorReal.format(rendaMensal);
        document.getElementById("dash-despesas").textContent = formatadorReal.format(totalDespesasMes);
        document.getElementById("dash-detalhe-metodos").textContent = `Débito: ${formatadorReal.format(totalDebitoMes)} • Crédito: ${formatadorReal.format(totalCreditoMes)}`;
        document.getElementById("dash-saldo").textContent = formatadorReal.format(saldoLivre);
        document.getElementById("dash-comprometimento").textContent = `${percentualComprometido}%`;

        const barraEl = document.getElementById("dash-comprometimento-bar");
        barraEl.style.width = `${larguraBarra}%`;
        barraEl.classList.toggle("over-limit", percentualComprometido > 100);

        const faturasBox = document.getElementById("resumo-faturas-mes");
        const entradasFatura = Object.entries(gastosPorCartao);
        if (!entradasFatura.length) {
            faturasBox.innerHTML = `<div class="faturas-box-title">Faturas do Mês</div><p class="text-muted text-sm">Sem gastos no crédito neste período.</p>`;
        } else {
            const linhasHtml = entradasFatura.map(([cardId, valor]) => {
                const card = mapaCartoes[cardId];
                const nomeCard = card ? card.nome : 'Cartão não especificado';
                const vencTexto = card?.vencimento ? `Vence dia ${card.vencimento}` : 'Sem vencimento definido';
                return `<div class="fatura-row"><div><strong>${nomeCard}</strong><div class="text-muted text-sm">${vencTexto}</div></div><strong>${formatadorReal.format(valor)}</strong></div>`;
            }).join('');
            faturasBox.innerHTML = `<div class="faturas-box-title">Faturas do Mês</div>${linhasHtml}`;
        }

    } catch {
        showToast("Erro ao carregar dados.", "error");
    }
}

function mudarMes(delta) {
    const input = document.getElementById('consulta-mes');
    if (!input.value) return;
    const date = new Date(input.value + '-15');
    date.setMonth(date.getMonth() + delta);
    input.value = date.toISOString().substring(0, 7);
    atualizarDashboardMensal();
}
document.getElementById('btn-prev-month').addEventListener('click', () => mudarMes(-1));
document.getElementById('btn-next-month').addEventListener('click', () => mudarMes(1));
document.getElementById("consulta-mes").addEventListener("change", atualizarDashboardMensal);

async function inicializarApp() {
    if (!currentUserId) return;
    const hoje = new Date();
    const mesAtual = hoje.getFullYear() + "-" + String(hoje.getMonth() + 1).padStart(2, '0');
    if (!document.getElementById("consulta-mes").value) document.getElementById("consulta-mes").value = mesAtual;

    try {
        const userSnap = await getDoc(doc(db, "usuarios", currentUserId));
        if (userSnap.exists()) {
            const dados = userSnap.data();
            atualizarAvatarHeader(dados.fotoUrl || "");
            cartoesUsuario = Array.isArray(dados.cartoes) ? dados.cartoes : [];
            categoriasUsuario = Array.isArray(dados.categorias) ? [...new Set(dados.categorias)] : [];

            if (dados.salarioBase) {
                document.getElementById("renda-valor-display").textContent = formatadorReal.format(dados.salarioBase);
                document.getElementById("renda-view").classList.remove("hidden");
                document.getElementById("form-usuario").classList.add("hidden");
                document.getElementById("btn-cancelar-renda").classList.remove("hidden");
            } else {
                document.getElementById("renda-view").classList.add("hidden");
                document.getElementById("form-usuario").classList.remove("hidden");
                document.getElementById("btn-cancelar-renda").classList.add("hidden");
            }
            atualizarDashboardMensal();
        }
    } catch (error) { console.error(error); }
}

document.getElementById("btn-editar-renda").addEventListener("click", () => {
    document.getElementById("renda-view").classList.add("hidden");
    document.getElementById("form-usuario").classList.remove("hidden");
});
document.getElementById("btn-cancelar-renda").addEventListener("click", () => {
    document.getElementById("renda-view").classList.remove("hidden");
    document.getElementById("form-usuario").classList.add("hidden");
});

document.querySelectorAll('input[name="tipoDespesa"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const grupoParcelada = document.getElementById('grupo-parcelada');
        const grupoFixa = document.getElementById('grupo-fixa');

        if (e.target.value === 'fixa') {
            grupoParcelada.classList.remove('show-smooth');
            grupoParcelada.classList.add('hidden-smooth');
            setTimeout(() => {
                grupoFixa.classList.remove('hidden-smooth');
                grupoFixa.classList.add('show-smooth');
            }, 180);
            document.getElementById('valor-total').required = false;
            document.getElementById('parcelas').required = false;
            document.getElementById('valor-mensal-fixo').required = true;
        } else {
            grupoFixa.classList.remove('show-smooth');
            grupoFixa.classList.add('hidden-smooth');
            setTimeout(() => {
                grupoParcelada.classList.remove('hidden-smooth');
                grupoParcelada.classList.add('show-smooth');
            }, 180);
            document.getElementById('valor-total').required = true;
            document.getElementById('parcelas').required = true;
            document.getElementById('valor-mensal-fixo').required = false;
        }
    });
});

document.getElementById('grupo-parcelada').classList.add('show-smooth');

document.getElementById("form-usuario").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUserId) return;
    const btnSubmit = e.target.querySelector('button[type="submit"]');
    const salario = parseFloat(document.getElementById("salario").value);

    document.getElementById("renda-valor-display").textContent = formatadorReal.format(salario);
    document.getElementById("renda-view").classList.remove("hidden");
    document.getElementById("form-usuario").classList.add("hidden");
    document.getElementById("btn-cancelar-renda").classList.remove("hidden");
    showToast("Renda atualizada no Zedona.", "success");

    setBotaoCarregando(btnSubmit, true, 'Salvando...');
    try {
        await setDoc(doc(db, "usuarios", currentUserId), { salarioBase: salario, atualizadoEm: new Date().toISOString() }, { merge: true });
        await atualizarDashboardMensal();
    } catch {
        showToast("Falha ao sincronizar renda.", "error");
    } finally {
        setBotaoCarregando(btnSubmit, false);
    }
});

document.getElementById("form-despesa").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUserId) return;

    const btnSubmit = document.getElementById("btn-submit-lancamento");
    const descricao = document.getElementById("descricao").value.trim();
    const mesInicio = document.getElementById("mes-inicio").value;
    const categoria = document.getElementById("categoria").value;
    const isFixa = (document.querySelector('input[name="tipoDespesa"]:checked').value === 'fixa');
    const formaPagamento = document.querySelector('input[name="formaPagamento"]:checked').value;
    const cartaoId = formaPagamento === 'credito' ? (document.getElementById("cartao-id").value || null) : null;

    let valorParcela, valorTotal, parcelasTotal, mesFim;

    if (isFixa) {
        valorParcela = parseFloat(document.getElementById("valor-mensal-fixo").value);
        valorTotal = null;
        parcelasTotal = null;
        mesFim = null;
    } else {
        valorTotal = parseFloat(document.getElementById("valor-total").value);
        parcelasTotal = parseInt(document.getElementById("parcelas").value, 10);
        valorParcela = valorTotal / parcelasTotal;
        const dataInicio = new Date(mesInicio + "-15T00:00:00");
        const dataFim = new Date(dataInicio);
        dataFim.setMonth(dataFim.getMonth() + (parcelasTotal - 1));
        mesFim = dataFim.toISOString().substring(0, 7);
    }

    const payload = {
        userId: currentUserId,
        descricao,
        isFixa,
        formaPagamento,
        cartaoId,
        valorTotal,
        parcelasTotal,
        valorParcela,
        mesInicio,
        mesFim,
        categoria,
        atualizadoEm: new Date().toISOString()
    };

    setBotaoCarregando(btnSubmit, true, 'Salvando...');
    try {
        if (idEdicaoAtual) {
            await updateDoc(doc(db, "transacoes", idEdicaoAtual), payload);
            showToast("Lançamento atualizado.", "success");
        } else {
            payload.dataCadastro = new Date().toISOString();
            await addDoc(collection(db, "transacoes"), payload);
            showToast("Lançamento salvo.", "success");
        }

        document.getElementById("form-despesa").reset();
        toggleModal('modal-form-lancamento', 'close');
        await atualizarDashboardMensal();
    } catch {
        showToast("Erro ao salvar lançamento.", "error");
    } finally {
        setBotaoCarregando(btnSubmit, false);
    }
});

document.getElementById("lista-despesas-corpo").addEventListener("click", async (e) => {
    const btnExcluir = e.target.closest('.btn-excluir');
    const btnEditar = e.target.closest('.btn-editar');

    if (btnExcluir) {
        showConfirmModal(async () => {
            try {
                await deleteDoc(doc(db, "transacoes", btnExcluir.getAttribute("data-id")));
                showToast("Lançamento excluído.", "success");
                await atualizarDashboardMensal();
            } catch {
                showToast("Erro ao excluir lançamento.", "error");
            }
        });
    }

    if (btnEditar) {
        idEdicaoAtual = btnEditar.getAttribute("data-id");
        try {
            const docSnap = await getDoc(doc(db, "transacoes", idEdicaoAtual));
            if (docSnap.exists()) {
                const data = docSnap.data();
                document.getElementById("descricao").value = data.descricao;
                document.getElementById("mes-inicio").value = data.mesInicio;

                await carregarCategoriasNoSelect(data.categoria);
                await carregarCartoesUsuario(data.cartaoId || "");

                if ((data.formaPagamento || 'debito') === 'credito') {
                    document.getElementById("pag-credito").click();
                } else {
                    document.getElementById("pag-debito").click();
                }

                if (data.isFixa) {
                    document.getElementById("tipo-fixa").click();
                    document.getElementById("valor-mensal-fixo").value = data.valorParcela;
                } else {
                    document.getElementById("tipo-parcelada").click();
                    document.getElementById("valor-total").value = data.valorTotal;
                    document.getElementById("parcelas").value = data.parcelasTotal;
                }

                document.getElementById("modal-lancamento-titulo").textContent = "Editar Lançamento";
                document.querySelector("#btn-submit-lancamento span").textContent = "Atualizar Lançamento";
                toggleModal('modal-form-lancamento', 'open');
            }
        } catch {
            showToast("Erro ao carregar lançamento.", "error");
        }
    }
});

document.getElementById("form-simulador").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUserId) return;
    const btnSubmit = e.target.querySelector('button[type="submit"]');
    const valorTotal = parseFloat(document.getElementById("sim-valor").value);
    const parcelas = parseInt(document.getElementById("sim-parcelas").value, 10);
    const mesInicio = document.getElementById("sim-mes").value;
    const resultadoBox = document.getElementById("resultado-simulacao");
    const valorNovaParcela = valorTotal / parcelas;

    resultadoBox.classList.remove("hidden-smooth");
    resultadoBox.classList.add("show-smooth");
    resultadoBox.innerHTML = "<p class='text-center text-muted'>Analisando cenários financeiros...</p>";

    setBotaoCarregando(btnSubmit, true, 'Analisando...');
    try {
        const userSnap = await getDoc(doc(db, "usuarios", currentUserId));
        if (!userSnap.exists()) return;
        const rendaMensal = userSnap.data().salarioBase || 0;

        const q = query(collection(db, "transacoes"), where("userId", "==", currentUserId));
        const querySnapshot = await getDocs(q);
        const todasDespesas = [];
        querySnapshot.forEach(doc => todasDespesas.push(doc.data()));

        let menorSaldo = rendaMensal;
        let mesMaisCritico = "";
        let mesesNegativos = 0;
        const dataInicio = new Date(mesInicio + "-15T00:00:00");

        for (let i = 0; i < parcelas; i++) {
            const dataSimulada = new Date(dataInicio);
            dataSimulada.setMonth(dataSimulada.getMonth() + i);
            const mesSimuladoStr = dataSimulada.toISOString().substring(0, 7);

            let despesasMes = 0;
            todasDespesas.forEach(despesa => {
                if (despesa.isFixa ? (mesSimuladoStr >= despesa.mesInicio) : (mesSimuladoStr >= despesa.mesInicio && mesSimuladoStr <= despesa.mesFim)) {
                    despesasMes += despesa.valorParcela;
                }
            });

            const saldoNoMes = rendaMensal - (despesasMes + valorNovaParcela);
            if (saldoNoMes < menorSaldo) {
                menorSaldo = saldoNoMes;
                mesMaisCritico = `${mesSimuladoStr.split('-')[1]}/${mesSimuladoStr.split('-')[0]}`;
            }
            if (saldoNoMes < 0) mesesNegativos++;
        }

        const impactoRenda = rendaMensal > 0 ? ((valorNovaParcela / rendaMensal) * 100).toFixed(1) : "0.0";
        let statusHtml = "";

        if (mesesNegativos > 0) statusHtml = `<div class="status-bar status-danger">Compra inviável: déficit previsto em ${mesesNegativos} mês(es).</div>`;
        else if (menorSaldo < (rendaMensal * 0.1)) statusHtml = `<div class="status-bar status-warning">Atenção: margem livre muito baixa no pior mês.</div>`;
        else statusHtml = `<div class="status-bar status-safe">Compra viável: margem livre confortável garantida.</div>`;

        resultadoBox.innerHTML = `
            <h3 style="font-size: 0.95rem; color: #fff; border-bottom: 1px solid var(--border-dark); padding-bottom: 8px;">Relatório Analítico Zedona</h3>
            <div class="report-grid">
                <div class="report-item"><span class="report-label">Valor da Parcela</span><span class="report-value">${formatadorReal.format(valorNovaParcela)}</span></div>
                <div class="report-item"><span class="report-label">Impacto na Renda</span><span class="report-value text-rose">${impactoRenda}%</span></div>
                <div class="report-item"><span class="report-label">Pior Cenário</span><span class="report-value">${mesMaisCritico || '-'}</span></div>
                <div class="report-item"><span class="report-label">Saldo no Pior Mês</span><span class="report-value ${menorSaldo < 0 ? 'text-rose' : 'text-emerald'}">${formatadorReal.format(menorSaldo)}</span></div>
            </div>
            ${statusHtml}
        `;
    } catch {
        resultadoBox.innerHTML = "<p class='text-center text-rose'>Erro ao processar simulação.</p>";
    } finally {
        setBotaoCarregando(btnSubmit, false);
    }
});