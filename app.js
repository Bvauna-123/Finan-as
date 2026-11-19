import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getFirestore, collection, addDoc, doc, setDoc, getDoc,
    updateDoc, query, where, getDocs, deleteDoc, enableIndexedDbPersistence
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
const db = getFirestore(app);

enableIndexedDbPersistence(db).catch(() => {});
if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
}

// Travamento de zoom por pinça e duplo toque para experiência de app mobile
document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
document.addEventListener("gesturechange", (e) => e.preventDefault(), { passive: false });
document.addEventListener("gestureend", (e) => e.preventDefault(), { passive: false });

document.addEventListener("touchmove", (e) => {
    if (e.touches && e.touches.length > 1) {
        e.preventDefault();
    }
}, { passive: false });

let ultimoToque = 0;
document.addEventListener("touchend", (e) => {
    const agora = Date.now();
    if (agora - ultimoToque <= 280) {
        e.preventDefault();
    }
    ultimoToque = agora;
}, { passive: false });

const USER_ID = "meu_usuario_principal";
const formatadorReal = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const CORES_GRAFICO = ["#ff8533", "#38d9a9", "#7b5cff", "#e44b8d", "#fcc419", "#74c0fc", "#b197fc", "#63e6be"];
const DOT_CLASSES = ["dot-orange", "dot-cyan", "dot-purple", "dot-pink"];

let meuGrafico = null;
let idEdicaoAtual = null;
let lancamentosMes = [];
let categoriasCache = [];
let categoriaAtiva = "TODAS";
let filtroTipoCartao = "TODOS";

function showToast(mensagem) {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = "toast-item";
    toast.textContent = mensagem;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 2800);
}

function abrirModal(id) {
    document.getElementById(id).classList.remove("hidden");
}

function fecharModal(id) {
    document.getElementById(id).classList.add("hidden");
}

document.querySelectorAll(".btn-fechar").forEach(btn => {
    btn.addEventListener("click", (e) => {
        e.target.closest(".sheet-backdrop").classList.add("hidden");
    });
});

document.querySelectorAll(".sheet-backdrop").forEach(backdrop => {
    backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) backdrop.classList.add("hidden");
    });
});

function confirmarNaInterface(titulo, mensagem, onConfirm) {
    document.getElementById("modal-titulo").textContent = titulo;
    document.getElementById("modal-mensagem").textContent = mensagem;
    abrirModal("modal-confirmacao");

    const btnOk = document.getElementById("btn-modal-confirmar");
    const btnCancel = document.getElementById("btn-modal-cancelar");

    const limpar = () => {
        fecharModal("modal-confirmacao");
        btnOk.onclick = null;
        btnCancel.onclick = null;
    };

    btnCancel.onclick = limpar;
    btnOk.onclick = async () => {
        limpar();
        await onConfirm();
    };
}

function parseMes(ym) {
    const [ano, mes] = ym.split("-").map(Number);
    return { ano, mes };
}

function somarMeses(ym, delta) {
    const { ano, mes } = parseMes(ym);
    const total = (ano * 12 + (mes - 1)) + delta;
    const novoAno = Math.floor(total / 12);
    const novoMes = (total % 12) + 1;
    return `${String(novoAno).padStart(4, "0")}-${String(novoMes).padStart(2, "0")}`;
}

function diffMeses(inicioYm, atualYm) {
    const a = parseMes(inicioYm);
    const b = parseMes(atualYm);
    return (b.ano - a.ano) * 12 + (b.mes - a.mes) + 1;
}

function formatarCategoria(texto) {
    const limpo = texto.trim();
    if (!limpo) return "";
    return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

// Alternância entre "Visão geral" e "Meu cartão"
function alternarTela(tela) {
    const isCartao = tela === "cartao";
    document.getElementById("vista-visao").classList.toggle("hidden", isCartao);
    document.getElementById("vista-cartao").classList.toggle("hidden", !isCartao);

    document.getElementById("tab-visao").classList.toggle("active", !isCartao);
    document.getElementById("tab-cartao").classList.toggle("active", isCartao);
    document.getElementById("tab-visao").setAttribute("aria-selected", String(!isCartao));
    document.getElementById("tab-cartao").setAttribute("aria-selected", String(isCartao));

    document.getElementById("nav-home").classList.toggle("active", !isCartao);
    document.getElementById("nav-card").classList.toggle("active", isCartao);
}

document.getElementById("tab-visao").addEventListener("click", () => alternarTela("visao"));
document.getElementById("tab-cartao").addEventListener("click", () => alternarTela("cartao"));
document.getElementById("nav-home").addEventListener("click", () => alternarTela("visao"));
document.getElementById("nav-card").addEventListener("click", () => alternarTela("cartao"));

// Categorias e Chips
async function obterCategoriasUnicas() {
    const padroes = ["Moradia", "Alimentação", "Tecnologia", "Assinaturas", "Lazer", "Outros"];
    const snap = await getDoc(doc(db, "usuarios", USER_ID));
    const salvas = snap.exists() && Array.isArray(snap.data().categorias) ? snap.data().categorias : [];
    return [...new Set([...padroes, ...salvas])];
}

function renderizarChipsCategorias(porCategoria = {}) {
    const strip = document.getElementById("pills-strip");
    strip.innerHTML = "";

    const totalGasto = Object.values(porCategoria).reduce((acc, v) => acc + v, 0);

    const btnTodas = document.createElement("button");
    btnTodas.type = "button";
    btnTodas.className = `metric-chip ${categoriaAtiva === "TODAS" ? "active" : ""}`;
    btnTodas.innerHTML = `<span class="chip-dot dot-orange"></span><span>Todas</span>`;
    btnTodas.onclick = () => {
        categoriaAtiva = "TODAS";
        renderizarChipsCategorias(porCategoria);
        renderizarListas();
    };
    strip.appendChild(btnTodas);

    categoriasCache.forEach((cat, idx) => {
        const valorCat = porCategoria[cat] || 0;
        const pct = totalGasto > 0 ? Math.round((valorCat / totalGasto) * 100) : 0;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `metric-chip ${categoriaAtiva === cat ? "active" : ""}`;
        const dotClass = DOT_CLASSES[idx % DOT_CLASSES.length];
        btn.innerHTML = `<span class="chip-dot ${dotClass}"></span><span>${cat}: ${pct}%</span>`;
        btn.onclick = () => {
            categoriaAtiva = categoriaAtiva === cat ? "TODAS" : cat;
            renderizarChipsCategorias(porCategoria);
            renderizarListas();
        };
        strip.appendChild(btn);
    });
}

async function popularSelectCategoria(selecionarValor = null) {
    const select = document.getElementById("categoria");
    try {
        categoriasCache = await obterCategoriasUnicas();
        select.innerHTML = `<option value="" disabled selected>Selecione...</option>`;
        categoriasCache.forEach(cat => {
            const opt = document.createElement("option");
            opt.value = cat;
            opt.textContent = cat;
            select.appendChild(opt);
        });
        if (selecionarValor) select.value = selecionarValor;
    } catch {
        showToast("Erro ao carregar categorias.");
    }
}

function abrirModalNovaCategoria() {
    document.getElementById("input-nova-cat").value = "";
    abrirModal("modal-nova-categoria");
}

document.getElementById("btn-abrir-nova-cat").addEventListener("click", abrirModalNovaCategoria);
document.getElementById("btn-abrir-nova-cat-rapida").addEventListener("click", abrirModalNovaCategoria);

document.getElementById("form-nova-categoria").addEventListener("submit", async (e) => {
    e.preventDefault();
    const catFormatada = formatarCategoria(document.getElementById("input-nova-cat").value);
    if (!catFormatada) return;

    try {
        const userRef = doc(db, "usuarios", USER_ID);
        const snap = await getDoc(userRef);
        const categorias = snap.exists() && Array.isArray(snap.data().categorias) ? snap.data().categorias : [];

        if (!categorias.includes(catFormatada)) {
            categorias.push(catFormatada);
            await setDoc(userRef, { categorias }, { merge: true });
        }

        await popularSelectCategoria(catFormatada);
        renderizarChipsCategorias();
        fecharModal("modal-nova-categoria");
        showToast("Categoria criada.");
    } catch {
        showToast("Erro ao criar categoria.");
    }
});

// Tipo de lançamento: Parcelada / Conta fixa
function aplicarTipoDespesa(tipo) {
    const isFixa = tipo === "fixa";
    document.getElementById("tipo-fixa").checked = isFixa;
    document.getElementById("tipo-parcelada").checked = !isFixa;

    document.getElementById("seg-fixa").classList.toggle("active", isFixa);
    document.getElementById("seg-parcelada").classList.toggle("active", !isFixa);

    document.getElementById("grupo-fixa").classList.toggle("hidden", !isFixa);
    document.getElementById("grupo-parcelada").classList.toggle("hidden", isFixa);

    document.getElementById("valor-total").required = !isFixa;
    document.getElementById("parcelas").required = !isFixa;
    document.getElementById("valor-mensal-fixo").required = isFixa;
}

document.getElementById("seg-parcelada").addEventListener("click", () => aplicarTipoDespesa("parcelada"));
document.getElementById("seg-fixa").addEventListener("click", () => aplicarTipoDespesa("fixa"));

// Novo lançamento
async function abrirNovoLancamento() {
    idEdicaoAtual = null;
    document.getElementById("form-despesa").reset();
    document.getElementById("mes-inicio").value = document.getElementById("consulta-mes").value;
    document.getElementById("modal-lancamento-titulo").textContent = "Adicionar lançamento";
    document.getElementById("btn-submit-lancamento").textContent = "Salvar lançamento";
    aplicarTipoDespesa("parcelada");
    await popularSelectCategoria();
    abrirModal("modal-form-lancamento");
}

document.getElementById("btn-abrir-lancamento").addEventListener("click", abrirNovoLancamento);
document.getElementById("btn-novo-lancamento-cartao").addEventListener("click", abrirNovoLancamento);
document.getElementById("nav-center-add").addEventListener("click", abrirNovoLancamento);

// Gráfico
function alternarGrafico() {
    document.getElementById("grafico-box").classList.toggle("hidden");
}

document.getElementById("btn-alternar-grafico").addEventListener("click", alternarGrafico);

// Simulador
function abrirSimulador() {
    document.getElementById("sim-mes").value = document.getElementById("consulta-mes").value;
    document.getElementById("resultado-simulacao").classList.add("hidden");
    abrirModal("modal-form-simulador");
}

document.getElementById("btn-abrir-simulador").addEventListener("click", abrirSimulador);
document.getElementById("btn-abrir-simulador-cartao").addEventListener("click", abrirSimulador);
document.getElementById("nav-sim").addEventListener("click", abrirSimulador);

// Renda Base
function toggleFormRenda(forcarAbrir = false) {
    const form = document.getElementById("form-usuario");
    if (forcarAbrir) form.classList.remove("hidden");
    else form.classList.toggle("hidden");
    if (!form.classList.contains("hidden")) {
        document.getElementById("salario").focus();
    }
}

document.getElementById("btn-toggle-renda").addEventListener("click", () => toggleFormRenda());
document.getElementById("btn-editar-renda-cartao").addEventListener("click", () => toggleFormRenda(true));
document.getElementById("nav-income").addEventListener("click", () => toggleFormRenda(true));
document.getElementById("btn-cancelar-renda").addEventListener("click", () => {
    document.getElementById("form-usuario").classList.add("hidden");
});

document.getElementById("form-usuario").addEventListener("submit", async (e) => {
    e.preventDefault();
    const salario = parseFloat(document.getElementById("salario").value);
    if (Number.isNaN(salario) || salario < 0) {
        showToast("Informe um valor de renda válido.");
        return;
    }

    try {
        await setDoc(doc(db, "usuarios", USER_ID), {
            salarioBase: salario,
            atualizadoEm: new Date().toISOString()
        }, { merge: true });
        document.getElementById("form-usuario").classList.add("hidden");
        showToast("Renda base salva.");
        await atualizarDashboardMensal();
    } catch {
        showToast("Erro ao salvar renda.");
    }
});

// Abas da tela do cartão
document.querySelectorAll(".filter-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".filter-tab-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        filtroTipoCartao = btn.getAttribute("data-filtro-tipo");
        renderizarListas();
    });
});

function criarCardTransacao(item) {
    const row = document.createElement("div");
    row.className = "tx-card";
    row.innerHTML = `
        <div class="tx-left-group">
            <div class="tx-badge-icon">${item.categoria.charAt(0).toUpperCase()}</div>
            <div class="tx-texts">
                <span class="tx-title-line">${item.descricao}</span>
                <span class="tx-sub-line">${item.subtitulo}</span>
            </div>
        </div>
        <div class="tx-right-group">
            <div class="tx-amount-col">
                <span class="tx-price">${formatadorReal.format(item.valorParcela)}</span>
                <span class="tx-kind">${item.isFixa ? "Fixa" : "Parcela"}</span>
            </div>
            <button type="button" class="tx-action-btn btn-editar" data-id="${item.id}" title="Editar" aria-label="Editar">✎</button>
            <button type="button" class="tx-action-btn btn-excluir" data-id="${item.id}" title="Excluir" aria-label="Excluir">✕</button>
        </div>
    `;
    return row;
}

function renderizarListas() {
    const listaVisao = document.getElementById("lista-despesas-corpo");
    const listaCartao = document.getElementById("lista-despesas-cartao");
    const emptyEl = document.getElementById("empty-state");

    const baseCat = categoriaAtiva === "TODAS"
        ? lancamentosMes
        : lancamentosMes.filter(item => item.categoria === categoriaAtiva);

    const baseCartao = baseCat.filter(item => {
        if (filtroTipoCartao === "FIXA") return item.isFixa;
        if (filtroTipoCartao === "PARCELADA") return !item.isFixa;
        return true;
    });

    listaVisao.innerHTML = "";
    listaCartao.innerHTML = "";

    emptyEl.classList.toggle("hidden", baseCat.length > 0);
    baseCat.forEach(item => listaVisao.appendChild(criarCardTransacao(item)));
    baseCartao.forEach(item => listaCartao.appendChild(criarCardTransacao(item)));
}

// Atualização Mensal
async function atualizarDashboardMensal() {
    const mesConsulta = document.getElementById("consulta-mes").value;
    if (!mesConsulta) return;

    try {
        categoriasCache = await obterCategoriasUnicas();

        const userSnap = await getDoc(doc(db, "usuarios", USER_ID));
        const rendaMensal = userSnap.exists() ? Number(userSnap.data().salarioBase || 0) : 0;

        if (userSnap.exists() && userSnap.data().salarioBase) {
            document.getElementById("salario").value = rendaMensal;
        }

        const q = query(collection(db, "transacoes"), where("userId", "==", USER_ID));
        const snap = await getDocs(q);

        let totalDespesas = 0;
        const porCategoria = {};
        lancamentosMes = [];

        snap.forEach((docItem) => {
            const d = docItem.data();
            const ativa = d.isFixa
                ? mesConsulta >= d.mesInicio
                : (mesConsulta >= d.mesInicio && mesConsulta <= d.mesFim);

            if (!ativa) return;

            const valor = Number(d.valorParcela || 0);
            totalDespesas += valor;

            const cat = d.categoria || "Outros";
            porCategoria[cat] = (porCategoria[cat] || 0) + valor;

            const subtitulo = d.isFixa
                ? `${cat} · Conta fixa`
                : `${cat} · Parcela ${diffMeses(d.mesInicio, mesConsulta)}/${d.parcelasTotal}`;

            lancamentosMes.push({
                id: docItem.id,
                descricao: d.descricao,
                categoria: cat,
                isFixa: Boolean(d.isFixa),
                subtitulo,
                valorParcela: valor
            });
        });

        renderizarChipsCategorias(porCategoria);

        const saldoLivre = rendaMensal - totalDespesas;
        const [anoStr, mesStr] = mesConsulta.split("-");

        document.getElementById("dash-saldo").textContent = formatadorReal.format(saldoLivre);
        document.getElementById("dash-renda-sub").textContent = `Renda: ${formatadorReal.format(rendaMensal)}`;
        document.getElementById("dash-despesas-label").textContent = formatadorReal.format(totalDespesas);
        document.getElementById("badge-qtd-itens").textContent = String(lancamentosMes.length);

        document.getElementById("dash-renda-destaque").textContent = formatadorReal.format(rendaMensal);
        document.getElementById("dash-saldo-destaque").textContent = `Saldo livre: ${formatadorReal.format(saldoLivre)}`;
        document.getElementById("gcard-despesas").textContent = formatadorReal.format(totalDespesas);
        document.getElementById("gcard-mes").textContent = `${mesStr}/${anoStr}`;
        document.getElementById("gcard-qtd").textContent = String(lancamentosMes.length);

        renderizarListas();

        const ctx = document.getElementById("categoryChart").getContext("2d");
        if (meuGrafico) meuGrafico.destroy();

        const labels = Object.keys(porCategoria);
        if (labels.length > 0) {
            meuGrafico = new Chart(ctx, {
                type: "doughnut",
                data: {
                    labels,
                    datasets: [{
                        data: Object.values(porCategoria),
                        backgroundColor: labels.map((_, idx) => CORES_GRAFICO[idx % CORES_GRAFICO.length]),
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: "74%",
                    plugins: {
                        legend: {
                            position: "right",
                            labels: { color: "#f4f5f9", boxWidth: 10, font: { size: 11 } }
                        }
                    }
                }
            });
        }
    } catch {
        showToast("Erro ao atualizar dados.");
    }
}

function mudarMes(delta) {
    const input = document.getElementById("consulta-mes");
    if (!input.value) return;
    input.value = somarMeses(input.value, delta);
    atualizarDashboardMensal();
}

document.getElementById("btn-mes-anterior-top").addEventListener("click", () => mudarMes(-1));
document.getElementById("btn-mes-seguinte-top").addEventListener("click", () => mudarMes(1));
document.getElementById("consulta-mes").addEventListener("change", atualizarDashboardMensal);

// Salvar / Editar Lançamento
document.getElementById("form-despesa").addEventListener("submit", async (e) => {
    e.preventDefault();

    const descricao = document.getElementById("descricao").value.trim();
    const mesInicio = document.getElementById("mes-inicio").value;
    const categoria = document.getElementById("categoria").value;
    const isFixa = document.getElementById("tipo-fixa").checked;

    let valorParcela, valorTotal, parcelasTotal, mesFim;

    if (isFixa) {
        valorParcela = parseFloat(document.getElementById("valor-mensal-fixo").value);
        valorTotal = null;
        parcelasTotal = null;
        mesFim = null;
    } else {
        valorParcela = parseFloat(document.getElementById("valor-total").value);
        parcelasTotal = parseInt(document.getElementById("parcelas").value, 10);
        valorTotal = valorParcela * parcelasTotal;
        mesFim = somarMeses(mesInicio, parcelasTotal - 1);
    }

    const payload = {
        userId: USER_ID,
        descricao,
        isFixa,
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
            showToast("Lançamento atualizado.");
        } else {
            payload.dataCadastro = new Date().toISOString();
            await addDoc(collection(db, "transacoes"), payload);
            showToast("Lançamento adicionado.");
        }

        fecharModal("modal-form-lancamento");
        await atualizarDashboardMensal();
    } catch {
        showToast("Erro ao salvar lançamento.");
    }
});

// Editar / Excluir nas listas
async function tratarCliqueLista(e) {
    const btnExcluir = e.target.closest(".btn-excluir");
    const btnEditar = e.target.closest(".btn-editar");

    if (btnExcluir) {
        const id = btnExcluir.getAttribute("data-id");
        confirmarNaInterface(
            "Excluir lançamento?",
            "O saldo do mês e as projeções serão recalculados.",
            async () => {
                try {
                    await deleteDoc(doc(db, "transacoes", id));
                    showToast("Lançamento excluído.");
                    await atualizarDashboardMensal();
                } catch {
                    showToast("Erro ao excluir lançamento.");
                }
            }
        );
    }

    if (btnEditar) {
        idEdicaoAtual = btnEditar.getAttribute("data-id");
        try {
            const snap = await getDoc(doc(db, "transacoes", idEdicaoAtual));
            if (!snap.exists()) return;
            const d = snap.data();

            document.getElementById("descricao").value = d.descricao;
            document.getElementById("mes-inicio").value = d.mesInicio;
            await popularSelectCategoria(d.categoria);

            if (d.isFixa) {
                aplicarTipoDespesa("fixa");
                document.getElementById("valor-mensal-fixo").value = d.valorParcela;
            } else {
                aplicarTipoDespesa("parcelada");
                document.getElementById("valor-total").value = d.valorParcela;
                document.getElementById("parcelas").value = d.parcelasTotal;
            }

            document.getElementById("modal-lancamento-titulo").textContent = "Editar lançamento";
            document.getElementById("btn-submit-lancamento").textContent = "Atualizar lançamento";
            abrirModal("modal-form-lancamento");
        } catch {
            showToast("Erro ao carregar lançamento.");
        }
    }
}

document.getElementById("lista-despesas-corpo").addEventListener("click", tratarCliqueLista);
document.getElementById("lista-despesas-cartao").addEventListener("click", tratarCliqueLista);

// Simulador de Compra
document.getElementById("form-simulador").addEventListener("submit", async (e) => {
    e.preventDefault();
    const valorNovaParcela = parseFloat(document.getElementById("sim-valor").value);
    const parcelas = parseInt(document.getElementById("sim-parcelas").value, 10);
    const mesInicio = document.getElementById("sim-mes").value;
    const box = document.getElementById("resultado-simulacao");

    box.classList.remove("hidden");

    try {
        const userSnap = await getDoc(doc(db, "usuarios", USER_ID));
        const rendaMensal = userSnap.exists() ? Number(userSnap.data().salarioBase || 0) : 0;

        if (rendaMensal <= 0) {
            box.innerHTML = `<span class="sim-warn">Defina primeiro a renda base para simular.</span>`;
            return;
        }

        const q = query(collection(db, "transacoes"), where("userId", "==", USER_ID));
        const snap = await getDocs(q);
        const despesas = snap.docs.map(item => item.data());

        let menorSaldo = Infinity;
        let mesCritico = mesInicio;
        let mesesNegativos = 0;

        for (let i = 0; i < parcelas; i++) {
            const mesSim = somarMeses(mesInicio, i);
            let gastoMes = 0;

            despesas.forEach(d => {
                const ativa = d.isFixa
                    ? mesSim >= d.mesInicio
                    : (mesSim >= d.mesInicio && mesSim <= d.mesFim);
                if (ativa) gastoMes += Number(d.valorParcela || 0);
            });

            const saldoSim = rendaMensal - (gastoMes + valorNovaParcela);
            if (saldoSim < menorSaldo) {
                menorSaldo = saldoSim;
                mesCritico = mesSim;
            }
            if (saldoSim < 0) mesesNegativos++;
        }

        const impacto = ((valorNovaParcela / rendaMensal) * 100).toFixed(1);
        let cls = "sim-safe";
        let resumo = "Margem confortável garantida.";

        if (mesesNegativos > 0) {
            cls = "sim-danger";
            resumo = `Déficit em ${mesesNegativos} mês(es).`;
        } else if (menorSaldo < rendaMensal * 0.1) {
            cls = "sim-warn";
            resumo = "Margem reduzida no pior mês.";
        }

        box.innerHTML = `
            <div>Parcela: <strong>${formatadorReal.format(valorNovaParcela)}</strong> (${impacto}% da renda)</div>
            <div>Pior mês: <strong>${mesCritico}</strong> · Saldo: <strong>${formatadorReal.format(menorSaldo)}</strong></div>
            <div class="${cls}">${resumo}</div>
        `;
    } catch {
        box.innerHTML = `<span class="sim-danger">Erro ao calcular a simulação.</span>`;
    }
});

async function init() {
    const hoje = new Date();
    const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
    if (!document.getElementById("consulta-mes").value) {
        document.getElementById("consulta-mes").value = mesAtual;
    }
    await atualizarDashboardMensal();
}

init();
