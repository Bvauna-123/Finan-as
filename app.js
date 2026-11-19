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

const USER_ID = "meu_usuario_principal";
const formatadorReal = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const CORES_GRAFICO = ["#66d9e8", "#8ce99a", "#ffd43b", "#ff8787", "#b197fc", "#ffa94d", "#63e6be", "#74c0fc"];

let meuGrafico = null;
let idEdicaoAtual = null;
let lancamentosMesCache = [];

function showToast(mensagem) {
    const container = document.getElementById("toast-container");
    const item = document.createElement("div");
    item.className = "toast-msg";
    item.textContent = mensagem;
    container.appendChild(item);
    setTimeout(() => item.remove(), 2800);
}

function abrirModal(id) {
    document.getElementById(id).classList.remove("hidden");
}

function fecharModal(id) {
    document.getElementById(id).classList.add("hidden");
}

document.querySelectorAll(".btn-fechar").forEach(btn => {
    btn.addEventListener("click", (e) => {
        e.target.closest(".modal-backdrop").classList.add("hidden");
    });
});

document.querySelectorAll(".modal-backdrop").forEach(backdrop => {
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

// Helpers numéricos de mês ("YYYY-MM")
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

// Categorias
async function obterCategoriasUnicas() {
    const padroes = ["Moradia", "Alimentação", "Tecnologia", "Assinaturas", "Lazer", "Outros"];
    const snap = await getDoc(doc(db, "usuarios", USER_ID));
    const salvas = snap.exists() && Array.isArray(snap.data().categorias) ? snap.data().categorias : [];
    return [...new Set([...padroes, ...salvas])];
}

async function carregarCategoriasNoSelect(selecionarValor = null) {
    const select = document.getElementById("categoria");
    const filtro = document.getElementById("filtro-categoria");
    const valorFiltroAtual = filtro.value || "TODAS";

    try {
        const unicas = await obterCategoriasUnicas();

        select.innerHTML = `<option value="" disabled selected>Selecione...</option>`;
        unicas.forEach(cat => {
            const opt = document.createElement("option");
            opt.value = cat;
            opt.textContent = cat;
            select.appendChild(opt);
        });
        if (selecionarValor) select.value = selecionarValor;

        filtro.innerHTML = `<option value="TODAS">TODAS</option>`;
        unicas.forEach(cat => {
            const opt = document.createElement("option");
            opt.value = cat;
            opt.textContent = cat.toUpperCase();
            filtro.appendChild(opt);
        });
        filtro.value = [...filtro.options].some(o => o.value === valorFiltroAtual) ? valorFiltroAtual : "TODAS";
    } catch {
        showToast("Não foi possível carregar as categorias.");
    }
}

document.getElementById("btn-abrir-nova-cat").addEventListener("click", () => {
    document.getElementById("input-nova-cat").value = "";
    abrirModal("modal-nova-categoria");
});

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

        await carregarCategoriasNoSelect(catFormatada);
        fecharModal("modal-nova-categoria");
        showToast("Categoria criada.");
    } catch {
        showToast("Erro ao criar categoria.");
    }
});

// Alternância Parcelada / Conta Fixa
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

// Abrir Modal de Lançamento
async function abrirNovoLancamento() {
    idEdicaoAtual = null;
    document.getElementById("form-despesa").reset();
    document.getElementById("mes-inicio").value = document.getElementById("consulta-mes").value;
    document.getElementById("modal-lancamento-titulo").textContent = "Adicionar lançamento";
    document.getElementById("btn-submit-lancamento").textContent = "Salvar lançamento";
    aplicarTipoDespesa("parcelada");
    await carregarCategoriasNoSelect();
    abrirModal("modal-form-lancamento");
}

document.getElementById("nav-lancamento").addEventListener("click", abrirNovoLancamento);

// Gráfico
function alternarGrafico() {
    document.getElementById("painel-grafico").classList.toggle("hidden");
}

document.getElementById("btn-toggle-grafico").addEventListener("click", alternarGrafico);
document.getElementById("nav-grafico").addEventListener("click", alternarGrafico);

// Simulador
function abrirSimulador() {
    document.getElementById("sim-mes").value = document.getElementById("consulta-mes").value;
    document.getElementById("resultado-simulacao").classList.add("hidden");
    abrirModal("modal-form-simulador");
}

document.getElementById("btn-abrir-simulador-card").addEventListener("click", abrirSimulador);
document.getElementById("nav-simulador").addEventListener("click", abrirSimulador);

// Renda Base
function abrirEdicaoRenda() {
    document.getElementById("form-usuario").classList.remove("hidden");
    document.getElementById("salario").focus();
}

document.getElementById("btn-editar-renda").addEventListener("click", abrirEdicaoRenda);
document.getElementById("btn-editar-renda-top").addEventListener("click", abrirEdicaoRenda);
document.getElementById("nav-renda").addEventListener("click", abrirEdicaoRenda);

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
        showToast("Renda base atualizada.");
        await atualizarDashboardMensal();
    } catch {
        showToast("Erro ao salvar a renda.");
    }
});

// Renderização da Lista com Filtro de Categoria
function renderizarListaLancamentos() {
    const listaEl = document.getElementById("lista-despesas-corpo");
    const emptyEl = document.getElementById("empty-state");
    const catFiltro = document.getElementById("filtro-categoria").value || "TODAS";

    const itensFiltrados = catFiltro === "TODAS"
        ? lancamentosMesCache
        : lancamentosMesCache.filter(item => item.categoria === catFiltro);

    listaEl.innerHTML = "";
    emptyEl.classList.toggle("hidden", itensFiltrados.length > 0);

    itensFiltrados.forEach(item => {
        const row = document.createElement("div");
        row.className = "tx-item";
        row.innerHTML = `
            <div class="tx-left">
                <div class="tx-circle">${item.categoria.charAt(0).toUpperCase()}</div>
                <div class="tx-meta">
                    <span class="tx-title">${item.descricao}</span>
                    <span class="tx-sub">${item.subtitulo}</span>
                </div>
            </div>
            <div class="tx-right">
                <span class="tx-value">-${formatadorReal.format(item.valorParcela)}</span>
                <button type="button" class="tx-icon-btn btn-editar" data-id="${item.id}" title="Editar">✎</button>
                <button type="button" class="tx-icon-btn btn-excluir" data-id="${item.id}" title="Excluir">✕</button>
            </div>
        `;
        listaEl.appendChild(row);
    });
}

document.getElementById("filtro-categoria").addEventListener("change", renderizarListaLancamentos);

// Dashboard Mensal
async function atualizarDashboardMensal() {
    const mesConsulta = document.getElementById("consulta-mes").value;
    if (!mesConsulta) return;

    try {
        await carregarCategoriasNoSelect();

        const userSnap = await getDoc(doc(db, "usuarios", USER_ID));
        const rendaMensal = userSnap.exists() ? Number(userSnap.data().salarioBase || 0) : 0;

        if (userSnap.exists() && userSnap.data().salarioBase) {
            document.getElementById("salario").value = rendaMensal;
        }

        const q = query(collection(db, "transacoes"), where("userId", "==", USER_ID));
        const snap = await getDocs(q);

        let totalDespesas = 0;
        const porCategoria = {};
        lancamentosMesCache = [];

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
                ? `${cat} · Fixa`
                : `${cat} · Parcela ${diffMeses(d.mesInicio, mesConsulta)}/${d.parcelasTotal}`;

            lancamentosMesCache.push({
                id: docItem.id,
                descricao: d.descricao,
                categoria: cat,
                subtitulo,
                valorParcela: valor
            });
        });

        const qtd = lancamentosMesCache.length;
        const saldoLivre = rendaMensal - totalDespesas;

        document.getElementById("dash-renda").textContent = formatadorReal.format(rendaMensal);
        document.getElementById("dash-despesas").textContent = formatadorReal.format(totalDespesas);
        document.getElementById("dash-saldo").textContent = formatadorReal.format(saldoLivre);
        document.getElementById("qtd-lancamentos-label").textContent = `${qtd} LANÇAMENTO${qtd === 1 ? "" : "S"}`;

        renderizarListaLancamentos();

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
                    cutout: "72%",
                    plugins: {
                        legend: {
                            position: "right",
                            labels: { color: "#ffffff", boxWidth: 10, font: { size: 11 } }
                        }
                    }
                }
            });
        }
    } catch {
        showToast("Erro ao atualizar o painel.");
    }
}

function mudarMes(delta) {
    const input = document.getElementById("consulta-mes");
    if (!input.value) return;
    input.value = somarMeses(input.value, delta);
    atualizarDashboardMensal();
}

document.getElementById("btn-prev-month").addEventListener("click", () => mudarMes(-1));
document.getElementById("btn-next-month").addEventListener("click", () => mudarMes(1));
document.getElementById("consulta-mes").addEventListener("change", atualizarDashboardMensal);

// Salvar / Editar Lançamento (valor da parcela é o valor informado)
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

// Editar / Excluir na Lista
document.getElementById("lista-despesas-corpo").addEventListener("click", async (e) => {
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
            await carregarCategoriasNoSelect(d.categoria);

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
});

// Simulador de Compra (valor informado é o valor da parcela mensal)
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
            box.innerHTML = `<span class="sim-badge-warn">Defina primeiro a sua renda base para simular.</span>`;
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
        let diagClass = "sim-badge-safe";
        let diagTexto = "Margem confortável garantida.";

        if (mesesNegativos > 0) {
            diagClass = "sim-badge-danger";
            diagTexto = `Saldo negativo em ${mesesNegativos} mês(es).`;
        } else if (menorSaldo < rendaMensal * 0.1) {
            diagClass = "sim-badge-warn";
            diagTexto = "Margem apertada no pior mês.";
        }

        box.innerHTML = `
            <div>Parcela: <strong>${formatadorReal.format(valorNovaParcela)}</strong> (${impacto}% da renda)</div>
            <div>Pior mês: <strong>${mesCritico}</strong> · Saldo: <strong>${formatadorReal.format(menorSaldo)}</strong></div>
            <div class="${diagClass}">${diagTexto}</div>
        `;
    } catch {
        box.innerHTML = `<span class="sim-badge-danger">Erro ao calcular a simulação.</span>`;
    }
});

// Inicialização
async function init() {
    const hoje = new Date();
    const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
    if (!document.getElementById("consulta-mes").value) {
        document.getElementById("consulta-mes").value = mesAtual;
    }
    await atualizarDashboardMensal();
}

init();