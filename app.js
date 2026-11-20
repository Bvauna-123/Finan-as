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

// Bloqueia zoom por gesto de pinça e duplo toque no app instalado no telemóvel
document.addEventListener('gesturestart', (e) => e.preventDefault());
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) e.preventDefault();
    lastTouchEnd = now;
}, { passive: false });

let currentUserId = null;
let cartoesUsuario = [];
let fotoCadastroBase64 = null;
let deferredInstallPrompt = null;

const formatadorReal = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
let meuGrafico = null;
let idEdicaoAtual = null;
const PALETA_CORES = ['#4f46e5', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#f43f5e', '#8b5cf6', '#14b8a6', '#f97316', '#84cc16'];

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
    showToast("FluxoPróximo instalado no telemóvel!", "📲");
});

function abrirPromptInstalacaoSeAplicavel() {
    if (isAppInstalled()) return;
    const textoEl = document.getElementById('instrucao-instalacao-texto');
    const btnInstalar = document.getElementById('btn-confirmar-instalacao');

    if (deferredInstallPrompt) {
        textoEl.textContent = "Instale o FluxoPróximo no ecrã inicial para acesso rápido e ecrã inteiro no telemóvel.";
        btnInstalar.classList.remove('hidden');
        toggleModal('modal-instalar-app', 'open');
    } else if (isIosDevice()) {
        textoEl.textContent = "No Safari do iPhone, toque em Partilhar (⬆️) e depois em 'Adicionar ao Ecrã Principal'.";
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
    if (!file) { fotoCadastroBase64 = null; return; }
    try {
        fotoCadastroBase64 = await lerImagemComprimida(file);
        const prev = document.getElementById('preview-foto-cadastro');
        prev.src = fotoCadastroBase64;
        prev.classList.remove('hidden');
    } catch {
        showToast("Erro ao carregar foto.", "❌");
    }
});

function showToast(mensagem, icon = '✅') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';

    const spanIcon = document.createElement('span');
    spanIcon.textContent = icon;

    const spanMsg = document.createElement('span');
    spanMsg.textContent = mensagem;

    toast.appendChild(spanIcon);
    toast.appendChild(spanMsg);
    container.appendChild(toast);

    setTimeout(() => { toast.style.animation = 'slideIn 0.3s reverse forwards'; setTimeout(() => toast.remove(), 300); }, 3000);
}

function toggleModal(modalId, action) {
    const modal = document.getElementById(modalId);
    if (action === 'open') modal.classList.remove('hidden');
    else modal.classList.add('hidden');
}

document.querySelectorAll('.btn-fechar').forEach(btn => {
    btn.addEventListener('click', (e) => e.target.closest('.modal-overlay').classList.add('hidden'));
});

function showConfirmModal(onConfirmCallback) {
    toggleModal('modal-confirmacao', 'open');
    const btnConfirmar = document.getElementById('btn-modal-confirmar');
    const btnCancelar = document.getElementById('btn-modal-cancelar');

    const fechar = () => { toggleModal('modal-confirmacao', 'close'); btnConfirmar.onclick = null; btnCancelar.onclick = null; };
    btnCancelar.onclick = fechar;
    btnConfirmar.onclick = () => { fechar(); onConfirmCallback(); };
}

document.querySelectorAll('input[name="authMode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const isRegister = e.target.value === 'register';
        document.getElementById('grupo-nome-cadastro').classList.toggle('hidden', !isRegister);
        document.getElementById('grupo-foto-cadastro').classList.toggle('hidden', !isRegister);
        document.getElementById('auth-nome').required = isRegister;
        document.getElementById('btn-auth-submit').textContent = isRegister ? 'Criar Conta' : 'Entrar';
        document.getElementById('btn-esqueci-senha').classList.toggle('hidden', isRegister);
    });
});

document.getElementById('btn-esqueci-senha').addEventListener('click', async () => {
    const email = document.getElementById('auth-email').value.trim();
    if (!email) {
        showToast("Digite o seu e-mail acima para recuperar a palavra-passe.", "⚠️");
        document.getElementById('auth-email').focus();
        return;
    }

    try {
        await sendPasswordResetEmail(auth, email);
        showToast("Ligação de redefinição enviada para o seu e-mail!", "📧");
    } catch (error) {
        let msg = "Não foi possível enviar o e-mail de recuperação.";
        if (error.code === 'auth/invalid-email') msg = "Informe um e-mail válido.";
        else if (error.code === 'auth/user-not-found') msg = "Nenhuma conta encontrada com este e-mail.";
        showToast(msg, "❌");
    }
});

document.getElementById('form-auth').addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode = document.querySelector('input[name="authMode"]:checked').value;
    const email = document.getElementById('auth-email').value.trim();
    const senha = document.getElementById('auth-senha').value;
    const nome = document.getElementById('auth-nome').value.trim();

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
            showToast("Conta criada com sucesso!", "🎉");
        } else {
            await signInWithEmailAndPassword(auth, email, senha);
            showToast("Bem-vindo de volta!", "👋");
        }
        document.getElementById('form-auth').reset();
        setTimeout(abrirPromptInstalacaoSeAplicavel, 700);
    } catch (error) {
        let msg = "Erro ao autenticar.";
        if (error.code === 'auth/email-already-in-use') msg = "Este e-mail já está em uso.";
        else if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') msg = "E-mail ou palavra-passe inválidos.";
        else if (error.code === 'auth/weak-password') msg = "A palavra-passe deve ter no mínimo 6 caracteres.";
        showToast(msg, "❌");
    }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
    try {
        await signOut(auth);
        showToast("Sessão encerrada.", "🔒");
    } catch (error) {
        showToast("Erro ao sair.", "❌");
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
        await inicializarApp();
    } else {
        currentUserId = null;
        cartoesUsuario = [];
        atualizarAvatarHeader("");
        if (meuGrafico) { meuGrafico.destroy(); meuGrafico = null; }
        appLayout.classList.add('hidden');
        authScreen.classList.remove('hidden');
    }
});

// Modal de Foto de Perfil
document.getElementById('btn-abrir-perfil').addEventListener('click', async () => {
    if (!currentUserId) return;
    const snap = await getDoc(doc(db, "usuarios", currentUserId));
    const fotoAtual = snap.exists() ? (snap.data().fotoUrl || "") : "";
    document.getElementById('input-foto-url').value = fotoAtual.startsWith('http') ? fotoAtual : '';
    document.getElementById('input-foto-arquivo').value = '';
    const prev = document.getElementById('preview-foto-modal');
    if (fotoAtual) { prev.src = fotoAtual; prev.classList.remove('hidden'); }
    else { prev.classList.add('hidden'); }
    toggleModal('modal-perfil', 'open');
});

document.getElementById('input-foto-arquivo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const base64 = await lerImagemComprimida(file);
    document.getElementById('input-foto-url').value = base64;
    const prev = document.getElementById('preview-foto-modal');
    prev.src = base64;
    prev.classList.remove('hidden');
});

document.getElementById('form-foto-perfil').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUserId) return;
    const fotoFinal = document.getElementById('input-foto-url').value.trim();
    try {
        await setDoc(doc(db, "usuarios", currentUserId), { fotoUrl: fotoFinal }, { merge: true });
        atualizarAvatarHeader(fotoFinal);
        toggleModal('modal-perfil', 'close');
        showToast("Foto atualizada!", "🖼️");
    } catch {
        showToast("Erro ao guardar foto.", "❌");
    }
});

// Gestão de Cartões de Crédito
async function carregarCartoesUsuario(selecionarId = null) {
    if (!currentUserId) return;
    const snap = await getDoc(doc(db, "usuarios", currentUserId));
    cartoesUsuario = snap.exists() && Array.isArray(snap.data().cartoes) ? snap.data().cartoes : [];

    const select = document.getElementById('cartao-id');
    select.innerHTML = '<option value="">Selecione um cartão...</option>';
    cartoesUsuario.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.fechamento ? `${c.nome} (Fecha dia ${c.fechamento})` : c.nome;
        select.appendChild(opt);
    });
    if (selecionarId) select.value = selecionarId;

    renderizarListaCartoes();
}

function renderizarListaCartoes() {
    const container = document.getElementById('lista-cartoes-container');
    container.innerHTML = '';
    if (!cartoesUsuario.length) {
        const p = document.createElement('p');
        p.className = 'text-muted text-sm text-center';
        p.textContent = 'Nenhum cartão registado ainda.';
        container.appendChild(p);
        return;
    }

    cartoesUsuario.forEach(c => {
        const div = document.createElement('div');
        div.className = 'cartao-item';

        const left = document.createElement('div');
        left.style.display = 'flex';
        left.style.alignItems = 'center';
        left.style.gap = '10px';

        const dot = document.createElement('span');
        dot.className = 'cartao-dot';
        dot.style.backgroundColor = c.cor || '#4f46e5';

        const info = document.createElement('div');
        const strong = document.createElement('strong');
        strong.textContent = c.nome;
        info.appendChild(strong);
        if (c.fechamento) {
            const small = document.createElement('div');
            small.className = 'text-muted text-sm';
            small.textContent = `Fechamento: dia ${c.fechamento}`;
            info.appendChild(small);
        }

        left.appendChild(dot);
        left.appendChild(info);

        const btnRem = document.createElement('button');
        btnRem.type = 'button';
        btnRem.className = 'btn-icon btn-remover-cartao';
        btnRem.dataset.id = c.id;
        btnRem.title = 'Remover cartão';
        btnRem.textContent = '🗑️';

        div.appendChild(left);
        div.appendChild(btnRem);
        container.appendChild(div);
    });
}

document.getElementById('btn-abrir-cartoes').addEventListener('click', async () => {
    await carregarCartoesUsuario();
    toggleModal('modal-cartoes', 'open');
});

document.getElementById('btn-atalho-novo-cartao').addEventListener('click', async () => {
    await carregarCartoesUsuario();
    toggleModal('modal-cartoes', 'open');
});

document.getElementById('form-novo-cartao').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUserId) return;
    const nome = document.getElementById('input-nome-cartao').value.trim();
    const fechamento = parseInt(document.getElementById('input-fechamento-cartao').value, 10) || null;
    const cor = document.getElementById('input-cor-cartao').value || '#4f46e5';
    if (!nome) return;

    const novoCartao = { id: 'card_' + Date.now(), nome, fechamento, cor };
    const atualizados = [...cartoesUsuario, novoCartao];

    try {
        await setDoc(doc(db, "usuarios", currentUserId), { cartoes: atualizados }, { merge: true });
        document.getElementById('form-novo-cartao').reset();
        await carregarCartoesUsuario(novoCartao.id);
        showToast("Cartão adicionado!", "💳");
    } catch {
        showToast("Erro ao adicionar cartão.", "❌");
    }
});

document.getElementById('lista-cartoes-container').addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-remover-cartao');
    if (!btn || !currentUserId) return;
    const idRemover = btn.dataset.id;
    const filtrados = cartoesUsuario.filter(c => c.id !== idRemover);
    try {
        await setDoc(doc(db, "usuarios", currentUserId), { cartoes: filtrados }, { merge: true });
        await carregarCartoesUsuario();
        showToast("Cartão removido.", "🗑️");
    } catch {
        showToast("Erro ao remover cartão.", "❌");
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

async function carregarCategoriasNoSelect(selecionarValor = null) {
    if (!currentUserId) return;
    const select = document.getElementById("categoria");
    const categoriasPadroes = ['Moradia', 'Alimentação', 'Tecnologia', 'Assinaturas', 'Lazer', 'Outros'];

    try {
        const userSnap = await getDoc(doc(db, "usuarios", currentUserId));
        const categoriasSalvas = userSnap.exists() && userSnap.data().categorias ? userSnap.data().categorias : [];
        const unicas = [...new Set([...categoriasPadroes, ...categoriasSalvas])];

        select.innerHTML = '<option value="" disabled selected>Selecione...</option>';
        unicas.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            select.appendChild(opt);
        });

        if (selecionarValor) select.value = selecionarValor;
    } catch (e) { console.error("Erro ao carregar categorias", e); }
}

document.getElementById('btn-abrir-nova-cat').addEventListener('click', () => {
    toggleModal('modal-nova-categoria', 'open');
});

document.getElementById('form-nova-categoria').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUserId) return;
    const inputCat = document.getElementById('input-nova-cat').value.trim();
    if (!inputCat) return;

    const catFormatada = inputCat.charAt(0).toUpperCase() + inputCat.slice(1).toLowerCase();

    try {
        const userRef = doc(db, "usuarios", currentUserId);
        const userSnap = await getDoc(userRef);
        let categorias = userSnap.exists() && userSnap.data().categorias ? userSnap.data().categorias : [];

        if (!categorias.includes(catFormatada)) {
            categorias.push(catFormatada);
            await setDoc(userRef, { categorias: categorias }, { merge: true });
        }

        await carregarCategoriasNoSelect(catFormatada);
        document.getElementById('input-nova-cat').value = '';
        toggleModal('modal-nova-categoria', 'close');
        showToast("Categoria criada!", "🏷️");
    } catch (error) {
        showToast("Erro ao criar categoria.", "❌");
    }
});

document.getElementById('btn-abrir-lancamento').addEventListener('click', async () => {
    idEdicaoAtual = null;
    document.getElementById("form-despesa").reset();
    document.getElementById("modal-lancamento-titulo").textContent = "Adicionar Lançamento";
    document.getElementById("btn-submit-lancamento").textContent = "Guardar Lançamento";
    document.getElementById("tipo-parcelada").click();
    document.getElementById("pag-debito").click();
    await carregarCategoriasNoSelect();
    await carregarCartoesUsuario();
    toggleModal('modal-form-lancamento', 'open');
});

document.getElementById('btn-abrir-simulador').addEventListener('click', () => toggleModal('modal-form-simulador', 'open'));

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
        const mapaCartoes = Object.fromEntries(cartoesUsuario.map(c => [c.id, c]));

        const q = query(collection(db, "transacoes"), where("userId", "==", currentUserId));
        const querySnapshot = await getDocs(q);

        let totalDespesasMes = 0;
        let totalDebitoMes = 0;
        let totalCreditoMes = 0;
        let countLancamentos = 0;
        let gastosCategoria = {};
        tbody.innerHTML = "";

        const dictCores = {};
        let corIndex = 0;

        querySnapshot.forEach((documento) => {
            const despesa = documento.data();
            const ehAtivaNoMes = despesa.isFixa ? (mesConsulta >= despesa.mesInicio) : (mesConsulta >= despesa.mesInicio && mesConsulta <= despesa.mesFim);

            if (ehAtivaNoMes) {
                const metodo = despesa.formaPagamento || 'debito';
                if (metodo === 'credito') totalCreditoMes += despesa.valorParcela;
                else totalDebitoMes += despesa.valorParcela;

                if (filtroMetodo !== 'todos' && metodo !== filtroMetodo) return;

                countLancamentos++;
                totalDespesasMes += despesa.valorParcela;

                const cat = despesa.categoria || 'Outros';
                if (gastosCategoria[cat] === undefined) gastosCategoria[cat] = 0;
                gastosCategoria[cat] += despesa.valorParcela;

                if (!dictCores[cat]) { dictCores[cat] = PALETA_CORES[corIndex % PALETA_CORES.length]; corIndex++; }

                const progresso = despesa.isFixa
                    ? "Fixa"
                    : `${((new Date(mesConsulta + "-15").getFullYear() - new Date(despesa.mesInicio + "-15").getFullYear()) * 12) + (new Date(mesConsulta + "-15").getMonth() - new Date(despesa.mesInicio + "-15").getMonth()) + 1}/${despesa.parcelasTotal}`;

                const cartaoObj = metodo === 'credito' && despesa.cartaoId ? mapaCartoes[despesa.cartaoId] : null;
                const rotuloMetodo = metodo === 'credito'
                    ? (cartaoObj ? `💳 ${cartaoObj.nome}` : '💳 Crédito')
                    : '💵 Débito';

                const tr = document.createElement("tr");

                const tdDesc = document.createElement("td");
                const strongDesc = document.createElement("strong");
                strongDesc.textContent = despesa.descricao;
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
                mBadge.textContent = rotuloMetodo;
                divMetodo.appendChild(mBadge);

                tdCat.appendChild(badge);
                tdCat.appendChild(divMetodo);

                const tdValor = document.createElement("td");
                tdValor.style.fontWeight = "600";
                tdValor.textContent = formatadorReal.format(despesa.valorParcela);

                const tdAcoes = document.createElement("td");
                tdAcoes.className = "text-right";

                const btnEditar = document.createElement("button");
                btnEditar.className = "btn-icon btn-editar";
                btnEditar.dataset.id = documento.id;
                btnEditar.title = "Editar";
                btnEditar.textContent = "✏️";

                const btnExcluir = document.createElement("button");
                btnExcluir.className = "btn-icon btn-excluir";
                btnExcluir.dataset.id = documento.id;
                btnExcluir.title = "Eliminar";
                btnExcluir.style.marginLeft = "8px";
                btnExcluir.textContent = "🗑️";

                tdAcoes.appendChild(btnEditar);
                tdAcoes.appendChild(btnExcluir);

                tr.appendChild(tdDesc);
                tr.appendChild(tdCat);
                tr.appendChild(tdValor);
                tr.appendChild(tdAcoes);
                tbody.appendChild(tr);
            }
        });

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
                        borderWidth: 0, hoverOffset: 4
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { display: false } } }
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
        document.getElementById("dash-renda").textContent = formatadorReal.format(rendaMensal);
        document.getElementById("dash-despesas").textContent = formatadorReal.format(totalDespesasMes);
        document.getElementById("dash-detalhe-metodos").textContent = `Débito: ${formatadorReal.format(totalDebitoMes)} • Crédito: ${formatadorReal.format(totalCreditoMes)}`;
        document.getElementById("dash-saldo").textContent = formatadorReal.format(saldoLivre);

        const cardSaldo = document.getElementById("card-saldo");
        if (saldoLivre < 0) {
            cardSaldo.classList.remove('balance-positive'); cardSaldo.classList.add('balance-negative');
        } else {
            cardSaldo.classList.remove('balance-negative'); cardSaldo.classList.add('balance-positive');
        }

        document.getElementById("dashboard-mensal").classList.remove("hidden-smooth");
        document.getElementById("dashboard-mensal").classList.add("show-smooth");

    } catch (error) { showToast("Erro ao carregar dados.", "❌"); }
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
            grupoParcelada.classList.remove('show-smooth'); grupoParcelada.classList.add('hidden-smooth');
            setTimeout(() => { grupoFixa.classList.remove('hidden-smooth'); grupoFixa.classList.add('show-smooth'); }, 200);
            document.getElementById('valor-total').required = false; document.getElementById('parcelas').required = false;
            document.getElementById('valor-mensal-fixo').required = true;
        } else {
            grupoFixa.classList.remove('show-smooth'); grupoFixa.classList.add('hidden-smooth');
            setTimeout(() => { grupoParcelada.classList.remove('hidden-smooth'); grupoParcelada.classList.add('show-smooth'); }, 200);
            document.getElementById('valor-total').required = true; document.getElementById('parcelas').required = true;
            document.getElementById('valor-mensal-fixo').required = false;
        }
    });
});

document.getElementById('grupo-parcelada').classList.add('show-smooth');

document.getElementById("form-usuario").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUserId) return;
    const salario = parseFloat(document.getElementById("salario").value);
    await setDoc(doc(db, "usuarios", currentUserId), { salarioBase: salario, atualizadoEm: new Date().toISOString() }, { merge: true });
    showToast("Renda atualizada!", "💰");
    inicializarApp();
});

document.getElementById("form-despesa").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUserId) return;
    const descricao = document.getElementById("descricao").value;
    const mesInicio = document.getElementById("mes-inicio").value;
    const categoria = document.getElementById("categoria").value;
    const isFixa = (document.querySelector('input[name="tipoDespesa"]:checked').value === 'fixa');
    const formaPagamento = document.querySelector('input[name="formaPagamento"]:checked').value;
    const cartaoId = formaPagamento === 'credito' ? (document.getElementById("cartao-id").value || null) : null;

    let valorParcela, valorTotal, parcelasTotal, mesFim;

    if (isFixa) {
        valorParcela = parseFloat(document.getElementById("valor-mensal-fixo").value);
        valorTotal = null; parcelasTotal = null; mesFim = null;
    } else {
        valorTotal = parseFloat(document.getElementById("valor-total").value);
        parcelasTotal = parseInt(document.getElementById("parcelas").value);
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

    try {
        if (idEdicaoAtual) {
            await updateDoc(doc(db, "transacoes", idEdicaoAtual), payload);
            showToast("Lançamento atualizado!", "✏️");
        } else {
            payload.dataCadastro = new Date().toISOString();
            await addDoc(collection(db, "transacoes"), payload);
            showToast("Lançamento efetuado!", "✅");
        }

        document.getElementById("form-despesa").reset();
        toggleModal('modal-form-lancamento', 'close');
        atualizarDashboardMensal();
    } catch (error) { showToast("Erro ao guardar.", "❌"); }
});

document.getElementById("lista-despesas-corpo").addEventListener("click", async (e) => {
    const btnExcluir = e.target.closest('.btn-excluir');
    const btnEditar = e.target.closest('.btn-editar');

    if (btnExcluir) {
        showConfirmModal(async () => {
            await deleteDoc(doc(db, "transacoes", btnExcluir.getAttribute("data-id")));
            showToast("Removido com sucesso.", "🗑️");
            atualizarDashboardMensal();
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
                document.getElementById("btn-submit-lancamento").textContent = "Atualizar Lançamento";
                toggleModal('modal-form-lancamento', 'open');
            }
        } catch (error) { showToast("Erro ao carregar dados.", "❌"); }
    }
});

document.getElementById("form-simulador").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUserId) return;
    const valorTotal = parseFloat(document.getElementById("sim-valor").value);
    const parcelas = parseInt(document.getElementById("sim-parcelas").value);
    const mesInicio = document.getElementById("sim-mes").value;
    const resultadoBox = document.getElementById("resultado-simulacao");
    const valorNovaParcela = valorTotal / parcelas;

    resultadoBox.classList.remove("hidden-smooth"); resultadoBox.classList.add("show-smooth");
    resultadoBox.innerHTML = "<p class='text-center'>A analisar cenários financeiros...</p>";

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
            if (saldoNoMes < menorSaldo) { menorSaldo = saldoNoMes; mesMaisCritico = `${mesSimuladoStr.split('-')[1]}/${mesSimuladoStr.split('-')[0]}`; }
            if (saldoNoMes < 0) mesesNegativos++;
        }

        const impactoRenda = rendaMensal > 0 ? ((valorNovaParcela / rendaMensal) * 100).toFixed(1) : "0.0";
        let statusHtml = "";

        if (mesesNegativos > 0) statusHtml = `<div class="status-bar status-danger">⚠️ Compra Inviável! Défice em ${mesesNegativos} meses.</div>`;
        else if (menorSaldo < (rendaMensal * 0.1)) statusHtml = `<div class="status-bar status-warning">⚡ Atenção: Margem de sobra muito baixa no pior mês.</div>`;
        else statusHtml = `<div class="status-bar status-safe">✅ Compra Segura! Margem confortável garantida.</div>`;

        resultadoBox.innerHTML = `
            <h3 style="font-size: 1.1rem; color: var(--slate-900); border-bottom: 1px solid var(--slate-200); padding-bottom: 8px;">📊 Relatório Analítico</h3>
            <div class="report-grid">
                <div class="report-item"><span class="report-label">Valor da Prestação</span><span class="report-value">${formatadorReal.format(valorNovaParcela)}</span></div>
                <div class="report-item"><span class="report-label">Impacto na Renda</span><span class="report-value text-rose">${impactoRenda}%</span></div>
                <div class="report-item"><span class="report-label">Pior Cenário (Data)</span><span class="report-value">${mesMaisCritico || '-'}</span></div>
                <div class="report-item"><span class="report-label">Saldo no Pior Cenário</span><span class="report-value ${menorSaldo < 0 ? 'text-rose' : 'text-emerald'}">${formatadorReal.format(menorSaldo)}</span></div>
            </div>
            ${statusHtml}
        `;
    } catch (error) { resultadoBox.innerHTML = "<p>Erro na simulação.</p>"; }
});