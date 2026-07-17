import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, addDoc, doc, setDoc, getDoc, updateDoc, query, where, getDocs, deleteDoc, enableIndexedDbPersistence } 
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

enableIndexedDbPersistence(db).catch(err => console.warn('Offline PWA indisponível', err));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(err => console.error(err));

const USER_ID = "meu_usuario_principal";
const formatadorReal = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
let meuGrafico = null;
let idEdicaoAtual = null; 
const PALETA_CORES = ['#4f46e5', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#f43f5e', '#8b5cf6', '#14b8a6', '#f97316', '#84cc16'];

function showToast(mensagem, icon = '✅') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>${icon}</span> <span>${mensagem}</span>`;
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

// Carregar Categorias no <select> dinamicamente
async function carregarCategoriasNoSelect(selecionarValor = null) {
    const select = document.getElementById("categoria");
    let categoriasPadroes = ['Moradia', 'Alimentação', 'Tecnologia', 'Assinaturas', 'Lazer', 'Outros'];
    
    try {
        const userSnap = await getDoc(doc(db, "usuarios", USER_ID));
        let categoriasSalvas = userSnap.exists() && userSnap.data().categorias ? userSnap.data().categorias : [];
        
        // Junta padrões e salvas sem duplicar
        const unicas = [...new Set([...categoriasPadroes, ...categoriasSalvas])];
        
        select.innerHTML = '<option value="" disabled selected>Selecione...</option>';
        unicas.forEach(cat => {
            select.innerHTML += `<option value="${cat}">${cat}</option>`;
        });

        if (selecionarValor) {
            select.value = selecionarValor;
        }
    } catch (e) { console.error("Erro ao carregar categorias", e); }
}

// Botão para abrir o modal de nova categoria
document.getElementById('btn-abrir-nova-cat').addEventListener('click', () => {
    toggleModal('modal-nova-categoria', 'open');
});

// Salvar Nova Categoria Criada pelo Usuário
document.getElementById('form-nova-categoria').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inputCat = document.getElementById('input-nova-cat').value.trim();
    if(!inputCat) return;

    const catFormatada = inputCat.charAt(0).toUpperCase() + inputCat.slice(1).toLowerCase();

    try {
        const userRef = doc(db, "usuarios", USER_ID);
        const userSnap = await getDoc(userRef);
        let categorias = userSnap.exists() && userSnap.data().categorias ? userSnap.data().categorias : [];

        if (!categorias.includes(catFormatada)) {
            categorias.push(catFormatada);
            await setDoc(userRef, { categorias: categorias }, { merge: true });
        }

        await carregarCategoriasNoSelect(catFormatada); // Já seleciona a nova criada
        document.getElementById('input-nova-cat').value = '';
        toggleModal('modal-nova-categoria', 'close');
        showToast("Categoria criada!", "🏷️");
    } catch (error) {
        showToast("Erro ao criar categoria.", "❌");
    }
});

// Abrir modal de Lançamento (Modo Criação)
document.getElementById('btn-abrir-lancamento').addEventListener('click', async () => {
    idEdicaoAtual = null;
    document.getElementById("form-despesa").reset();
    document.getElementById("modal-lancamento-titulo").textContent = "Adicionar Lançamento";
    document.getElementById("btn-submit-lancamento").textContent = "Salvar Lançamento";
    document.getElementById("tipo-parcelada").click();
    await carregarCategoriasNoSelect();
    toggleModal('modal-form-lancamento', 'open');
});

document.getElementById('btn-abrir-simulador').addEventListener('click', () => toggleModal('modal-form-simulador', 'open'));

// Dashboard e Tabela
async function atualizarDashboardMensal() {
    const mesConsulta = document.getElementById("consulta-mes").value;
    if (!mesConsulta) return;

    const tbody = document.getElementById("lista-despesas-corpo");
    const emptyState = document.getElementById("empty-state");
    
    try {
        const userSnap = await getDoc(doc(db, "usuarios", USER_ID));
        if (!userSnap.exists()) return; 
        const rendaMensal = userSnap.data().salarioBase || 0;

        const q = query(collection(db, "transacoes"), where("userId", "==", USER_ID));
        const querySnapshot = await getDocs(q);
        
        let totalDespesasMes = 0;
        let countLancamentos = 0;
        let gastosCategoria = {};
        tbody.innerHTML = "";

        const dictCores = {}; 
        let corIndex = 0;

        querySnapshot.forEach((documento) => {
            const despesa = documento.data();
            const ehAtivaNoMes = despesa.isFixa ? (mesConsulta >= despesa.mesInicio) : (mesConsulta >= despesa.mesInicio && mesConsulta <= despesa.mesFim);

            if (ehAtivaNoMes) {
                countLancamentos++;
                totalDespesasMes += despesa.valorParcela;
                
                const cat = despesa.categoria || 'Outros';
                if(gastosCategoria[cat] === undefined) gastosCategoria[cat] = 0;
                gastosCategoria[cat] += despesa.valorParcela;

                if(!dictCores[cat]) { dictCores[cat] = PALETA_CORES[corIndex % PALETA_CORES.length]; corIndex++; }

                let progresso = despesa.isFixa ? "Fixa" : `${((new Date(mesConsulta + "-15").getFullYear() - new Date(despesa.mesInicio + "-15").getFullYear()) * 12) + (new Date(mesConsulta + "-15").getMonth() - new Date(despesa.mesInicio + "-15").getMonth()) + 1}/${despesa.parcelasTotal}`;

                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>
                        <strong>${despesa.descricao}</strong>
                        <div class="text-muted text-sm mt-1">Ref: ${progresso}</div>
                    </td>
                    <td><span class="dynamic-badge" style="background-color: ${dictCores[cat]}">${cat}</span></td>
                    <td style="font-weight: 600;">${formatadorReal.format(despesa.valorParcela)}</td>
                    <td class="text-right">
                        <button class="btn-icon btn-editar" data-id="${documento.id}" title="Editar">✏️</button>
                        <button class="btn-icon btn-excluir" data-id="${documento.id}" title="Excluir" style="margin-left:8px;">🗑️</button>
                    </td>
                `;
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
    if(!input.value) return;
    const date = new Date(input.value + '-15');
    date.setMonth(date.getMonth() + delta);
    input.value = date.toISOString().substring(0, 7);
    atualizarDashboardMensal();
}
document.getElementById('btn-prev-month').addEventListener('click', () => mudarMes(-1));
document.getElementById('btn-next-month').addEventListener('click', () => mudarMes(1));
document.getElementById("consulta-mes").addEventListener("change", atualizarDashboardMensal);

// Inicialização
async function inicializarApp() {
    const hoje = new Date();
    const mesAtual = hoje.getFullYear() + "-" + String(hoje.getMonth() + 1).padStart(2, '0');
    if(!document.getElementById("consulta-mes").value) document.getElementById("consulta-mes").value = mesAtual;

    try {
        const userSnap = await getDoc(doc(db, "usuarios", USER_ID));
        if (userSnap.exists() && userSnap.data().salarioBase) {
            const renda = userSnap.data().salarioBase;
            document.getElementById("renda-valor-display").textContent = formatadorReal.format(renda);
            document.getElementById("renda-view").classList.remove("hidden");
            document.getElementById("form-usuario").classList.add("hidden");
            document.getElementById("btn-cancelar-renda").classList.remove("hidden");
            atualizarDashboardMensal();
        } else {
            document.getElementById("renda-view").classList.add("hidden");
            document.getElementById("form-usuario").classList.remove("hidden");
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
inicializarApp();

// Submits
document.getElementById("form-usuario").addEventListener("submit", async (e) => {
    e.preventDefault();
    const salario = parseFloat(document.getElementById("salario").value);
    await setDoc(doc(db, "usuarios", USER_ID), { salarioBase: salario, atualizadoEm: new Date().toISOString() }, { merge: true });
    showToast("Renda atualizada!", "💰");
    inicializarApp();
});

document.getElementById("form-despesa").addEventListener("submit", async (e) => {
    e.preventDefault();
    const descricao = document.getElementById("descricao").value;
    const mesInicio = document.getElementById("mes-inicio").value;
    const categoria = document.getElementById("categoria").value;
    const isFixa = (document.querySelector('input[name="tipoDespesa"]:checked').value === 'fixa');

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

    const payload = { userId: USER_ID, descricao, isFixa, valorTotal, parcelasTotal, valorParcela, mesInicio, mesFim, categoria, atualizadoEm: new Date().toISOString() };

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
    } catch (error) { showToast("Erro ao salvar.", "❌"); }
});

// Ações da Tabela (Editar / Excluir)
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

                if(data.isFixa) {
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

// Simulador
document.getElementById("form-simulador").addEventListener("submit", async (e) => {
    e.preventDefault();
    const valorTotal = parseFloat(document.getElementById("sim-valor").value);
    const parcelas = parseInt(document.getElementById("sim-parcelas").value);
    const mesInicio = document.getElementById("sim-mes").value;
    const resultadoBox = document.getElementById("resultado-simulacao");
    const valorNovaParcela = valorTotal / parcelas;
    
    resultadoBox.classList.remove("hidden-smooth"); resultadoBox.classList.add("show-smooth");
    resultadoBox.innerHTML = "<p class='text-center'>Analisando cenários financeiros...</p>";

    try {
        const userSnap = await getDoc(doc(db, "usuarios", USER_ID));
        if (!userSnap.exists()) return;
        const rendaMensal = userSnap.data().salarioBase;
        
        const q = query(collection(db, "transacoes"), where("userId", "==", USER_ID));
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
            if(saldoNoMes < 0) mesesNegativos++;
        }

        const impactoRenda = ((valorNovaParcela / rendaMensal) * 100).toFixed(1);
        let statusHtml = "";
        
        if (mesesNegativos > 0) statusHtml = `<div class="status-bar status-danger">⚠️ Compra Inviável! Déficit em ${mesesNegativos} meses.</div>`;
        else if (menorSaldo < (rendaMensal * 0.1)) statusHtml = `<div class="status-bar status-warning">⚡ Atenção: Margem de sobra muito baixa no pior mês.</div>`;
        else statusHtml = `<div class="status-bar status-safe">✅ Compra Segura! Margem confortável garantida.</div>`;

        resultadoBox.innerHTML = `
            <h3 style="font-size: 1.1rem; color: var(--slate-900); border-bottom: 1px solid var(--slate-200); padding-bottom: 8px;">📊 Relatório Analítico</h3>
            <div class="report-grid">
                <div class="report-item"><span class="report-label">Valor da Parcela</span><span class="report-value">${formatadorReal.format(valorNovaParcela)}</span></div>
                <div class="report-item"><span class="report-label">Impacto na Renda</span><span class="report-value text-rose">${impactoRenda}%</span></div>
                <div class="report-item"><span class="report-label">Pior Cenário (Data)</span><span class="report-value">${mesMaisCritico}</span></div>
                <div class="report-item"><span class="report-label">Saldo no Pior Cenário</span><span class="report-value ${menorSaldo < 0 ? 'text-rose' : 'text-emerald'}">${formatadorReal.format(menorSaldo)}</span></div>
            </div>
            ${statusHtml}
        `;
    } catch (error) { resultadoBox.innerHTML = "<p>Erro na simulação.</p>"; }
});