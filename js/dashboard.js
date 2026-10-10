const SUPABASE_URL = "https://qkkwvacltcmpgmtrvpjf.supabase.co";
const SUPABASE_KEY = "sb_publishable_UZnT5Fj2Hp8qLOyrWf4Ilw_1QcW_O5U";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* Paleta Compras / CxP — verde contable */
const C = {
  gold: "#10B981", goldLight: "#6EE7B7", goldDark: "#047857",
  orange: "#F97316", amber: "#F59E0B",
  green: "#22C55E", red: "#EF4444", blue: "#3B82F6",
  other: "#2A3B35", text: "#E6F0EC", dim: "#90A8A0", faint: "#5A7268",
  grid: "rgba(144, 168, 160, 0.10)", panel: "#0C1714",
};
const PALETTE = [C.gold, C.amber, C.blue, C.orange, C.green, C.goldLight, C.red];

Chart.register(ChartDataLabels);
Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.color = C.dim;
Chart.defaults.animation.duration = 450;
Chart.defaults.plugins.datalabels.display = false;
Chart.defaults.plugins.legend.display = false;

const state = { compras: null };
const charts = {};
let listenersReady = false;
let subActualC = "resumen";

const fmt = (v, d = 0) => Number(v).toLocaleString("es-PE", { maximumFractionDigits: d, minimumFractionDigits: 0 });
const round = (v, d = 1) => Number(Number(v).toFixed(d));
const truncar = (s, n = 30) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const $ = (id) => document.getElementById(id);
function hexRgba(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`; }

async function cargarHoja(nombre) {
  const { data, error } = await supabaseClient.from("dashboard_data").select("row_index, data").eq("sheet_name", nombre).order("row_index", { ascending: true }).limit(1);
  if (error) throw error;
  if (!data || data.length === 0) return null;
  return data[0].data;
}

const centerText = {
  id: "centerText",
  afterDraw(chart, _args, opts) {
    if (!opts || !opts.title) return;
    const { ctx, chartArea: a } = chart;
    const x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2;
    ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = C.text; ctx.font = "700 20px Sora, sans-serif";
    ctx.fillText(opts.title, x, y - 8);
    ctx.fillStyle = C.dim; ctx.font = "500 11px 'IBM Plex Sans', sans-serif";
    ctx.fillText(opts.sub || "", x, y + 16); ctx.restore();
  },
};

function tooltipStyle() {
  return {
    backgroundColor: "#070B12", titleColor: C.text, bodyColor: C.text,
    borderColor: "#2A3B35", borderWidth: 1, padding: 10, cornerRadius: 8, boxPadding: 4,
    callbacks: { label: (c) => ` ${c.dataset.label ? c.dataset.label + ": " : c.label ? c.label + ": " : ""}${fmt(c.parsed.y !== undefined ? c.parsed.y : c.parsed, 2)}` },
  };
}
function mount(id, config) {
  const canvas = $(id); if (!canvas) return;
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
  const vacio = !config.data.labels || config.data.labels.length === 0;
  canvas.parentElement.classList.toggle("is-empty", vacio);
  if (vacio) return;
  charts[id] = new Chart(canvas, config);
}
function gradV(c1, c2) { return (ctx) => { const a = ctx.chart.chartArea; if (!a) return c1; const g = ctx.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom); g.addColorStop(0, c1); g.addColorStop(1, c2); return g; }; }
function gradH(c1, c2) { return (ctx) => { const a = ctx.chart.chartArea; if (!a) return c1; const g = ctx.chart.ctx.createLinearGradient(a.left, 0, a.right, 0); g.addColorStop(0, c1); g.addColorStop(1, c2); return g; }; }
const scaleX = () => ({ grid: { display: false }, border: { color: "#2A3B35" }, ticks: { color: C.dim, maxRotation: 0, autoSkipPadding: 14 } });
const scaleY = (max) => ({ beginAtZero: true, suggestedMax: max, grid: { color: C.grid }, border: { display: false }, ticks: { color: C.faint, callback: (v) => fmt(v), maxTicksLimit: 6 } });
const labelBase = { color: C.text, font: { family: "'IBM Plex Sans', sans-serif", weight: "600", size: 10.5 } };

function renderColumns(id, labels, data, color1 = C.goldLight, color2 = C.goldDark, decimals = 0) {
  const max = Math.max(...data, 0);
  mount(id, {
    type: "bar",
    data: { labels, datasets: [{ data, borderRadius: { topLeft: 7, topRight: 7 }, borderSkipped: false, maxBarThickness: 54, backgroundColor: gradV(color1, color2) }] },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 14 } },
      plugins: { tooltip: tooltipStyle(), datalabels: { ...labelBase, display: labels.length <= 14, anchor: "end", align: "end", offset: 3, formatter: (v) => fmt(v, decimals) } },
      scales: { x: scaleX(), y: scaleY(max * 1.22) } },
  });
}
function renderScrollHBar(id, labels, data, color1 = C.goldDark, color2 = C.goldLight, decimals = 0) {
  const ctx = $(id); if (!ctx) return;
  if (charts[id]) charts[id].destroy();
  const wrap = ctx.parentElement;
  wrap.style.maxHeight = "420px"; wrap.style.overflowY = "auto"; wrap.style.overflowX = "hidden";
  ctx.style.height = Math.max(420, labels.length * 32) + "px"; ctx.style.maxHeight = "none";
  const max = Math.max(...data, 0);
  charts[id] = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ data, borderRadius: 6, borderSkipped: false, barThickness: 16, backgroundColor: gradH(color1, color2) }] },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, layout: { padding: { right: 12 } },
      plugins: { tooltip: tooltipStyle(), datalabels: { ...labelBase, display: true, anchor: "end", align: "right", offset: 4, formatter: (v) => fmt(v, decimals) } },
      scales: { x: { ...scaleY(max * 1.18), ticks: { color: C.faint, callback: (v) => fmt(v), maxTicksLimit: 5 } }, y: { grid: { display: false }, border: { display: false }, ticks: { color: C.text, callback(v) { return truncar(this.getLabelForValue(v), 30); } } } } },
  });
}
function renderDoughnut(id, labels, data, centerTitle, centerSub, decimals = 0) {
  const total = data.reduce((a, b) => a + Number(b), 0);
  const colores = labels.map((l, i) => (l === "Otros" ? C.other : PALETTE[i % PALETTE.length]));
  mount(id, {
    type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: colores, borderColor: "#0C1714", borderWidth: 3, hoverOffset: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: "68%",
      plugins: {
        tooltip: { ...tooltipStyle(), callbacks: { label: (c) => ` ${c.label}: ${fmt(c.parsed, decimals)} (${total ? Math.round((c.parsed / total) * 100) : 0}%)` } },
        datalabels: { ...labelBase, display: (c) => total > 0 && c.dataset.data[c.dataIndex] / total >= 0.06, color: "#08110F", font: { family: "'IBM Plex Sans', sans-serif", weight: "700", size: 11 }, formatter: (v) => Math.round((v / total) * 100) + "%" },
        centerText: { title: centerTitle, sub: centerSub },
      } },
    plugins: [centerText],
  });
  const lg = $(id + "Legend");
  if (lg) lg.innerHTML = labels.map((l, i) => `<div class="legend-item"><i style="background:${colores[i]}"></i><span title="${l}">${truncar(l, 22)}</span><b>${total ? Math.round((data[i] / total) * 100) : 0}%</b></div>`).join("");
}
function renderArea(id, labels, datasets, { decimals = 0 } = {}) {
  const maxAll = Math.max(...datasets.flatMap((d) => d.data), 0);
  mount(id, {
    type: "line",
    data: { labels, datasets: datasets.map((d) => ({
      label: d.label, data: d.data, borderColor: d.color, borderWidth: 2.5, tension: 0.35, fill: true,
      backgroundColor: (ctx) => { const a = ctx.chart.chartArea; if (!a) return hexRgba(d.color, 0.15); const g = ctx.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom); g.addColorStop(0, hexRgba(d.color, 0.34)); g.addColorStop(1, hexRgba(d.color, 0)); return g; },
      pointBackgroundColor: d.color, pointBorderColor: "#0C1714", pointBorderWidth: 2, pointRadius: 4, pointHoverRadius: 6,
      datalabels: { display: true, align: "top", anchor: "end", offset: 6, color: d.color, font: { family: "'IBM Plex Sans', sans-serif", weight: "600", size: 10 }, formatter: (v) => fmt(v, decimals) },
    })) },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22, right: 10 } },
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: datasets.length > 1, position: "bottom", labels: { color: C.dim, usePointStyle: true, pointStyle: "circle", boxWidth: 8, padding: 14 } }, tooltip: tooltipStyle() },
      scales: { x: scaleX(), y: scaleY(maxAll * 1.15) } },
  });
}

function heroCard({ title, value, unit, badge, note }) {
  return `<article class="card hero span-3">
    <span class="eyebrow">Indicador principal</span>
    <h3>${title}</h3>
    <div class="hero-val">${value}<small>${unit}</small></div>
    <p class="hero-note">${note}</p>
    <span class="pill pill-orange">${badge}</span>
  </article>`;
}
function kpiCard({ icon, tone, title, value, unit, pct, barLabel, foot }) {
  return `<article class="card kpi tone-${tone} span-3">
    <div class="kpi-head"><span class="kpi-ico"><i class="fas ${icon}"></i></span><h3>${title}</h3></div>
    <div class="kpi-val">${value}<small>${unit}</small></div>
    <div class="bar"><i style="width:${Math.min(100, Math.max(0, pct))}%"></i></div>
    <div class="kpi-foot"><span>${barLabel}</span><b>${fmt(pct, 1)}%</b></div>
    <p class="kpi-note">${foot}</p>
  </article>`;
}
function plotCard(id, titulo, sub, span, size = "") {
  return `<article class="card span-${span}"><div class="card-head"><h3>${titulo}</h3><p>${sub}</p></div>
    <div class="plot ${size}"><canvas id="${id}"></canvas><div class="plot-empty"><i class="fas fa-chart-simple"></i><span>Sin datos para mostrar</span></div></div></article>`;
}
function donutCard(id, titulo, sub, span) {
  return `<article class="card span-${span}"><div class="card-head"><h3>${titulo}</h3><p>${sub}</p></div>
    <div class="plot donut"><canvas id="${id}"></canvas><div class="plot-empty"><i class="fas fa-chart-pie"></i><span>Sin datos para mostrar</span></div></div>
    <div class="legend" id="${id}Legend"></div></article>`;
}
function slotCard(id, titulo, sub, span) {
  return `<article class="card span-${span}"><div class="card-head"><h3>${titulo}</h3><p>${sub}</p></div><div id="${id}" class="mini-table"></div></article>`;
}
function tabla(encabezados, filas) {
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${encabezados.map((h) => `<th class="${h.num ? "num" : ""}">${h.t}</th>`).join("")}</tr></thead><tbody>${filas.map((f) => `<tr>${f.map((c, i) => `<td class="${encabezados[i].num ? "num" : ""} ${i === 0 ? "name" : ""}">${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function vacioMensaje(span = 12) {
  return `<article class="card span-${span}"><div class="plot-empty" style="display:flex;position:static;min-height:200px"><i class="fas fa-database"></i><span>No se encontraron datos.</span></div></article>`;
}

function construirLayoutInterno() {
  // Resumen
  $("filtersCompRes").innerHTML = `
    <div class="filter-chip"><i class="fas fa-tags"></i>
      <select id="fCompResCategoria" class="filter-select"><option value="">Categoría</option></select></div>
    <div class="filter-chip"><i class="fas fa-building"></i>
      <select id="fCompResProveedor" class="filter-select"><option value="">Proveedor</option></select></div>
    <div class="filter-chip"><i class="fas fa-circle-check"></i>
      <select id="fCompResEstado" class="filter-select"><option value="">Estado</option></select></div>
    <button id="clearCompRes" class="btn-clear-chips"><i class="fas fa-eraser"></i> Limpiar</button>`;
  $("gridCompRes").innerHTML = [
    plotCard("ccMes", "Compras por mes", "Importe total por mes", 6, "tall"),
    donutCard("ccCategoria", "Compras por categoría", "MAT. PRIMA · ENVASES-EMBALAJES", 6),
    plotCard("ccProveedor", "Top proveedores por importe", "Ranking por monto comprado", 6, "tall"),
    donutCard("ccPagado", "Pagado vs Pendiente", "Estado de cuenta", 6),
    donutCard("ccEstado", "Comprobantes por estado", "Cancelado · Pendiente · Otros", 6),
    plotCard("ccRango", "Compras por rango de vencimiento", "Distribución por rango", 6, "tall"),
  ].join("");

  // Detalle
  $("filtersCompDet").innerHTML = `
    <div class="filter-chip"><i class="fas fa-tags"></i>
      <select id="fCompDetCategoria" class="filter-select"><option value="">Categoría</option></select></div>
    <div class="filter-chip"><i class="fas fa-circle-check"></i>
      <select id="fCompDetEstado" class="filter-select"><option value="">Estado</option></select></div>
    <div class="filter-chip"><i class="fas fa-building"></i>
      <select id="fCompDetProveedor" class="filter-select"><option value="">Proveedor</option></select></div>
    <button id="clearCompDet" class="btn-clear-chips"><i class="fas fa-eraser"></i> Limpiar</button>`;
  $("gridCompDet").innerHTML = [
    slotCard("cdTabla", "Detalle de comprobantes", "Fecha · Proveedor · Categoría · Importe · Pagos · Saldo · Estado", 12),
  ].join("");
}

function llenarSelect(id, valores, etiqueta) {
  const sel = $(id); if (!sel) return;
  const actual = sel.value;
  sel.innerHTML = `<option value="">${etiqueta}</option>`;
  valores.forEach((v) => { const o = document.createElement("option"); o.value = v; o.textContent = v; sel.appendChild(o); });
  if (actual && valores.includes(actual)) sel.value = actual;
}
function llenarSegmentadores() {
  if (!state.compras) return;
  const cats = [...new Set(state.compras.filas.map(f => f.categoria))].sort();
  const provs = [...new Set(state.compras.filas.map(f => f.razon))].sort();
  const ests = [...new Set(state.compras.filas.map(f => f.estado))].sort();
  llenarSelect("fCompResCategoria", cats, "Categoría");
  llenarSelect("fCompResProveedor", provs, "Proveedor");
  llenarSelect("fCompResEstado", ests, "Estado");
  llenarSelect("fCompDetCategoria", cats, "Categoría");
  llenarSelect("fCompDetEstado", ests, "Estado");
  llenarSelect("fCompDetProveedor", provs, "Proveedor");
}

function filtroActivo(id) { const el = $(id); return el ? el.value : ""; }

function renderCompResumen() {
  if (!state.compras) { $("gridCompRes").innerHTML = vacioMensaje(12); $("kpiCompRes").innerHTML = ""; return; }

  const fCat = filtroActivo("fCompResCategoria");
  const fProv = filtroActivo("fCompResProveedor");
  const fEst = filtroActivo("fCompResEstado");

  const filas = state.compras.filas.filter(f => {
    if (fCat && f.categoria !== fCat) return false;
    if (fProv && f.razon !== fProv) return false;
    if (fEst && f.estado !== fEst) return false;
    return true;
  });

  let totalCompras = 0, totalPagado = 0, totalSaldo = 0, totalIGV = 0;
  const porMes = {}, porCategoria = {}, porProveedor = {}, porEstado = {}, porRango = {};
  filas.forEach(f => {
    totalCompras += f.importe;
    totalPagado += f.pagos;
    totalSaldo += f.saldo;
    totalIGV += f.igv;

    if (f.mes) {
      if (!porMes[f.mes]) porMes[f.mes] = { mes: f.mes, importe: 0 };
      porMes[f.mes].importe += f.importe;
    }
    porCategoria[f.categoria] = (porCategoria[f.categoria] || 0) + f.importe;
    porProveedor[f.razon] = (porProveedor[f.razon] || 0) + f.importe;
    porEstado[f.estado] = (porEstado[f.estado] || 0) + f.importe;
    if (!porRango[f.rango]) porRango[f.rango] = { nombre: f.rango, importe: 0, count: 0 };
    porRango[f.rango].importe += f.importe;
    porRango[f.rango].count++;
  });

  $("kpiCompRes").innerHTML = [
    heroCard({
      title: "Total Compras", value: "S/ " + fmt(totalCompras, 2), unit: "",
      note: `${fmt(filas.length)} comprobantes · ${fmt(state.compras.kpis.totalProveedores)} proveedores`,
      badge: `IGV: S/ ${fmt(totalIGV, 2)}`,
    }),
    kpiCard({ icon: "fa-money-bill-wave", tone: "gold", title: "Total Pagado", value: "S/ " + fmt(totalPagado, 2), unit: "",
      pct: totalCompras ? (totalPagado / totalCompras) * 100 : 0, barLabel: "Del total comprado",
      foot: `${totalCompras ? ((totalPagado / totalCompras) * 100).toFixed(1) : 0}% pagado` }),
    kpiCard({ icon: "fa-hourglass-half", tone: "amber", title: "Saldo Pendiente", value: "S/ " + fmt(totalSaldo, 2), unit: "",
      pct: totalCompras ? (totalSaldo / totalCompras) * 100 : 0, barLabel: "Del total comprado",
      foot: `Por pagar` }),
    kpiCard({ icon: "fa-file-invoice", tone: "green", title: "Total IGV", value: "S/ " + fmt(totalIGV, 2), unit: "",
      pct: totalCompras ? (totalIGV / totalCompras) * 100 : 0, barLabel: "Sobre el importe",
      foot: `Impuesto general` }),
  ].join("");

  // Por mes
  const mesesArr = Object.values(porMes).sort((a, b) => a.mes.localeCompare(b.mes));
  const mesesAbrev = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  const labelsMes = mesesArr.map(m => {
    const [a, mm] = m.mes.split("-");
    return mesesAbrev[parseInt(mm) - 1] + " " + a.substring(2);
  });
  renderArea("ccMes", labelsMes, [
    { label: "Compras", color: C.gold, data: mesesArr.map(m => round(m.importe, 2)) },
  ], { decimals: 0 });

  // Por categoría
  const catArr = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);
  const top6 = catArr.slice(0, 6);
  const otros = catArr.slice(6).reduce((a, e) => a + e[1], 0);
  const cd = top6.map(c => round(c[1], 2)); const cl = top6.map(c => c[0]);
  if (otros > 0) { cd.push(round(otros, 2)); cl.push("Otros"); }
  renderDoughnut("ccCategoria", cl, cd, "S/ " + fmt(totalCompras, 0), "compras");

  // Por proveedor
  const provArr = Object.entries(porProveedor).sort((a, b) => b[1] - a[1]).slice(0, 20);
  renderScrollHBar("ccProveedor", provArr.map(p => truncar(p[0], 30)), provArr.map(p => round(p[1], 2)), C.goldDark, C.goldLight, 2);

  // Pagado vs Pendiente
  renderDoughnut("ccPagado", ["Pagado", "Pendiente"], [round(totalPagado, 2), round(totalSaldo, 2)], "S/ " + fmt(totalCompras, 0), "total");

  // Estado
  const estArr = Object.entries(porEstado).sort((a, b) => b[1] - a[1]);
  const top6e = estArr.slice(0, 6);
  const otrosE = estArr.slice(6).reduce((a, e) => a + e[1], 0);
  const ed = top6e.map(e => round(e[1], 2)); const el = top6e.map(e => e[0]);
  if (otrosE > 0) { ed.push(round(otrosE, 2)); el.push("Otros"); }
  renderDoughnut("ccEstado", el, ed, fmt(filas.length), "comprobantes");

  // Rango vencimiento
  const rangoArr = Object.entries(porRango).sort((a, b) => b[1].count - a[1].count);
  renderColumns("ccRango", rangoArr.map(r => r[0]), rangoArr.map(r => r[1].count), C.goldLight, C.goldDark, 0);
}

function renderCompDetalle() {
  if (!state.compras) { $("gridCompDet").innerHTML = vacioMensaje(12); return; }

  const fCat = filtroActivo("fCompDetCategoria");
  const fEst = filtroActivo("fCompDetEstado");
  const fProv = filtroActivo("fCompDetProveedor");

  const filas = state.compras.filas.filter(f => {
    if (fCat && f.categoria !== fCat) return false;
    if (fEst && f.estado !== fEst) return false;
    if (fProv && f.razon !== fProv) return false;
    return true;
  }).sort((a, b) => (b.fechaEmi || "").localeCompare(a.fechaEmi || ""));

  const top = filas.slice(0, 100);
  $("cdTabla").innerHTML = top.length
    ? tabla(
        [
          { t: "Fecha" }, { t: "Proveedor" }, { t: "Categoría" }, { t: "Producto" },
          { t: "Importe", num: 1 }, { t: "Pagos", num: 1 }, { t: "Saldo", num: 1 },
          { t: "Estado" }, { t: "Rango" }
        ],
        top.map(f => [
          f.fechaEt || "-",
          truncar(f.razon, 32),
          truncar(f.categoria, 18),
          truncar(f.producto, 30),
          fmt(f.importe, 2),
          fmt(f.pagos, 2),
          fmt(f.saldo, 2),
          f.estado,
          f.rango
        ])
      )
    : `<div class="plot-empty" style="display:flex;position:static;min-height:120px"><i class="fas fa-chart-simple"></i><span>Sin datos</span></div>`;
}

function cambiarSubC(sub) {
  subActualC = sub;
  document.querySelectorAll("#subTabsC .subtab").forEach(t => t.classList.toggle("active", t.dataset.sub === sub));
  ["resumen", "detalle"].forEach(s => {
    const el = document.getElementById("subC-" + s);
    if (el) el.style.display = s === sub ? "block" : "none";
  });
  if (sub === "resumen") renderCompResumen();
  else if (sub === "detalle") renderCompDetalle();
  requestAnimationFrame(() => Object.values(charts).forEach(c => c.resize()));
}

function engancharEventos() {
  if (listenersReady) return;
  listenersReady = true;

  document.querySelectorAll("#subTabsC .subtab").forEach(t => {
    t.addEventListener("click", () => cambiarSubC(t.dataset.sub));
  });
  ["fCompResCategoria","fCompResProveedor","fCompResEstado"].forEach(id => {
    const el = $(id); if (el) el.addEventListener("change", () => renderCompResumen());
  });
  ["fCompDetCategoria","fCompDetEstado","fCompDetProveedor"].forEach(id => {
    const el = $(id); if (el) el.addEventListener("change", () => renderCompDetalle());
  });
  $("clearCompRes").addEventListener("click", () => {
    ["fCompResCategoria","fCompResProveedor","fCompResEstado"].forEach(x => { const el = $(x); if (el) el.value = ""; });
    renderCompResumen();
  });
  $("clearCompDet").addEventListener("click", () => {
    ["fCompDetCategoria","fCompDetEstado","fCompDetProveedor"].forEach(x => { const el = $(x); if (el) el.value = ""; });
    renderCompDetalle();
  });

  document.querySelectorAll(".js-refresh").forEach((b) =>
    b.addEventListener("click", async () => {
      document.querySelectorAll(".js-refresh").forEach((x) => { x.disabled = true; x.classList.add("is-loading"); });
      try { await cargarTodo(); } catch (err) { console.error(err); }
      document.querySelectorAll(".js-refresh").forEach((x) => { x.disabled = false; x.classList.remove("is-loading"); });
    })
  );
}

async function cargarTodo() {
  const compras = await cargarHoja("COMPRAS_DATA").catch(() => null);
  state.compras = compras;

  const count = compras ? 1 : 0;
  $("stRegistros").textContent = `${count} / 1`;
  $("stSync").textContent = new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });

  $("chipRegistros").textContent = fmt(state.compras?.kpis?.totalRegistros || 0);
  $("chipSync").textContent = new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });

  llenarSegmentadores();
  cambiarSubC(subActualC);
}

(async function init() {
  construirLayoutInterno();
  try {
    await cargarTodo();
    $("loading").hidden = true;
    $("topbar").hidden = false;
    $("shell").hidden = false;
    $("compras").hidden = false;
    engancharEventos();
    cambiarSubC(subActualC);
  } catch (err) {
    console.error(err);
    $("loading").innerHTML = `<div class="error-box"><i class="fas fa-triangle-exclamation"></i><h3>No se pudieron cargar los datos</h3><p>${err.message || err}</p></div>`;
  }
})();