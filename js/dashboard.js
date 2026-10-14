const SUPABASE_URL = "https://ffiuayjfnhlvxgktxbal.supabase.co";
const SUPABASE_KEY = "sb_publishable_F8h3Zay5r9pVATEnvAIa-Q_bnaXgj1U";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const C = {
  gold: "#334155", goldLight: "#64748B", goldDark: "#1E293B",
  orange: "#EA580C", amber: "#B45309",
  green: "#15803D", red: "#B91C1C", blue: "#1D4ED8", cyan: "#0E7490",
  other: "#CBD5E1", text: "#26251F", dim: "#6E6C63", faint: "#9C9A90",
  grid: "rgba(110, 108, 99, 0.14)", panel: "#FFFFFF",
};
const PALETTE = [C.gold, C.amber, C.blue, C.orange, C.green, C.cyan, C.red, C.goldLight];

Chart.register(ChartDataLabels);
Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.color = C.dim;
Chart.defaults.animation.duration = 450;
Chart.defaults.plugins.datalabels.display = false;
Chart.defaults.plugins.legend.display = false;

const state = { data: null };
const charts = {};
let listenersReady = false;
let subActualC = "general";

const fmt = (v, d = 0) => Number(v).toLocaleString("es-PE", { maximumFractionDigits: d, minimumFractionDigits: 0 });
const fmtM = (v) => {
  const n = Number(v);
  if (!isFinite(n)) return "0";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + " M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + " K";
  return fmt(n, 0);
};
const round = (v, d = 1) => Number(Number(v).toFixed(d));
const truncar = (s, n = 30) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");
const $ = (id) => document.getElementById(id);

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
    ctx.fillStyle = C.text; ctx.font = "700 18px Sora, sans-serif";
    ctx.fillText(opts.title, x, y - 8);
    ctx.fillStyle = C.dim; ctx.font = "500 11px 'IBM Plex Sans', sans-serif";
    ctx.fillText(opts.sub || "", x, y + 14); ctx.restore();
  },
};

function tooltipStyle() {
  return {
    backgroundColor: "#FFFFFF", titleColor: C.text, bodyColor: C.text,
    borderColor: "#E5E4DE", borderWidth: 1, padding: 10, cornerRadius: 8, boxPadding: 4,
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
const scaleX = () => ({ grid: { display: false }, border: { color: "#E5E4DE" }, ticks: { color: C.dim, maxRotation: 0, autoSkipPadding: 14 } });
const scaleY = (max, decimals = 0) => ({ beginAtZero: true, suggestedMax: max, grid: { color: C.grid }, border: { display: false }, ticks: { color: C.faint, callback: (v) => fmt(v, decimals), maxTicksLimit: 6 } });
const labelBase = { color: C.text, font: { family: "'IBM Plex Sans', sans-serif", weight: "600", size: 10.5 } };

function renderColumns(id, labels, data, color1 = C.goldLight, color2 = C.goldDark, decimals = 0) {
  const max = Math.max(...data, 0);
  mount(id, {
    type: "bar",
    data: { labels, datasets: [{ data, borderRadius: { topLeft: 7, topRight: 7 }, borderSkipped: false, maxBarThickness: 54, backgroundColor: gradV(color1, color2) }] },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 14 } },
      plugins: { tooltip: tooltipStyle(), datalabels: { ...labelBase, display: labels.length <= 14, anchor: "end", align: "end", offset: 3, formatter: (v) => fmt(v, decimals) } },
      scales: { x: scaleX(), y: scaleY(max * 1.22, decimals) } },
  });
}
function renderScrollHBar(id, labels, data, color1 = C.goldDark, color2 = C.goldLight, decimals = 0) {
  const ctx = $(id); if (!ctx) return;
  if (charts[id]) charts[id].destroy();
  const wrap = ctx.parentElement;
  wrap.style.maxHeight = "420px"; wrap.style.overflowY = "auto"; wrap.style.overflowX = "hidden";
  ctx.style.height = Math.max(420, labels.length * 30) + "px"; ctx.style.maxHeight = "none";
  const max = Math.max(...data, 0);
  charts[id] = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ data, borderRadius: 6, borderSkipped: false, barThickness: 14, backgroundColor: gradH(color1, color2) }] },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, layout: { padding: { right: 12 } },
      plugins: { tooltip: tooltipStyle(), datalabels: { ...labelBase, display: true, anchor: "end", align: "right", offset: 4, formatter: (v) => fmt(v, decimals) } },
      scales: { x: { ...scaleY(max * 1.18, decimals), ticks: { color: C.faint, callback: (v) => fmt(v, decimals), maxTicksLimit: 5 } }, y: { grid: { display: false }, border: { display: false }, ticks: { color: C.text, callback(v) { return truncar(this.getLabelForValue(v), 28); } } } } },
  });
}
function renderDoughnut(id, labels, data, centerTitle, centerSub, decimals = 0) {
  const total = data.reduce((a, b) => a + Number(b), 0);
  const colores = labels.map((l, i) => {
    const k = (l || "").toUpperCase();
    if (k.includes("GENERAL EX")) return C.amber;
    if (k.includes("GENERAL")) return C.gold;
    if (k === "OTROS") return C.other;
    return PALETTE[i % PALETTE.length];
  });
  mount(id, {
    type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: colores, borderColor: "#FFFFFF", borderWidth: 3, hoverOffset: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: "68%",
      plugins: {
        tooltip: { ...tooltipStyle(), callbacks: { label: (c) => ` ${c.label}: ${fmt(c.parsed, decimals)} (${total ? Math.round((c.parsed / total) * 100) : 0}%)` } },
        datalabels: { ...labelBase, display: (c) => total > 0 && c.dataset.data[c.dataIndex] / total >= 0.06, color: "#26251F", font: { family: "'IBM Plex Sans', sans-serif", weight: "700", size: 11 }, formatter: (v) => Math.round((v / total) * 100) + "%" },
        centerText: { title: centerTitle, sub: centerSub },
      } },
    plugins: [centerText],
  });
  const lg = $(id + "Legend");
  if (lg) lg.innerHTML = labels.map((l, i) => `<div class="legend-item"><i style="background:${colores[i]}"></i><span title="${l}">${truncar(l, 22)}</span><b>${total ? Math.round((data[i] / total) * 100) : 0}%</b></div>`).join("");
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

function construirLayoutInterno() {
  // GENERAL
  $("gridGeneral").innerHTML = [
    plotCard("gLinea", "Costo por línea", "Conteo físico", 6, "tall"),
    plotCard("gRango", "Distribución por antigüedad", "0-30 · 31-90 · 91-180 · +180 días", 6, "tall"),
    donutCard("gEstado", "Costo por estado", "General · General Ex", 6),
    plotCard("gConteoStock", "Conteo vs Stock sistema", "Equipos encontrados vs sistema", 6, "tall"),
  ].join("");

  // INVENTARIO
  $("gridInventario").innerHTML = [
    plotCard("invTienda", "Equipos por tienda", "Conteo físico", 6, "tall"),
    donutCard("invMoneda", "Costo por moneda", "PEN · USD", 6),
    plotCard("invSublinea", "Equipos por sublínea", "Top sublíneas", 6, "tall"),
    donutCard("invEstado2", "Equipos por estado", "General · General Ex", 6),
  ].join("");

  // LÍNEA / MARCA
  $("gridLineaMarca").innerHTML = [
    plotCard("lmLinea", "Equipos por línea", "Motos · Cómputo · Telefonía · Marrón", 6, "tall"),
    plotCard("lmMarca", "Costo por marca", "Ranking por costo", 6, "tall"),
    plotCard("lmMarcaEquipos", "Equipos por marca", "Ranking por cantidad", 6, "tall"),
    plotCard("lmSublineaCosto", "Costo por sublínea", "Top sublíneas", 6, "tall"),
  ].join("");

  // ANTIGÜEDAD
  $("gridAntig").innerHTML = [
    plotCard("antRango", "Distribución por antigüedad", "0-30 · 31-90 · 91-180 · +180 días", 6, "tall"),
    plotCard("antTop", "Top 15 equipos más antiguos", "Mayor antigüedad en días", 6, "tall"),
  ].join("");

  // DIFERENCIAS
  $("gridDif").innerHTML = [
    plotCard("difResumen", "Conteo vs Stock", "Equipos en sistema vs conteo físico", 6, "tall"),
    plotCard("difTopFaltantes", "Faltantes (conteo sin stock)", "Top 15", 6, "tall"),
    plotCard("difTopSobrantes", "Sobrantes (stock sin conteo)", "Top 15", 6, "tall"),
  ].join("");

  // DETALLE
  $("filtersCompDet").innerHTML = `
    <div class="filter-chip"><i class="fas fa-tag"></i>
      <select id="fLineaDet" class="filter-select"><option value="">Línea</option></select></div>
    <div class="filter-chip"><i class="fas fa-copyright"></i>
      <select id="fMarcaDet" class="filter-select"><option value="">Marca</option></select></div>
    <div class="filter-chip"><i class="fas fa-store"></i>
      <select id="fTiendaDet" class="filter-select"><option value="">Tienda</option></select></div>
    <button id="clearCompDet" class="btn-clear-chips"><i class="fas fa-eraser"></i> Limpiar</button>`;
  $("gridCompDet").innerHTML = [
    slotCard("cdTabla", "Detalle de equipos (solo conteo)", "SKU · Serie · Descripción · Marca · Línea · Estado · Costo · Antigüedad", 12),
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
  if (!state.data) return;
  const lineas = [...new Set(state.data.filas.map(f => f.linea))].sort();
  const marcas = [...new Set(state.data.filas.map(f => f.marca))].sort();
  const tiendas = [...new Set(state.data.filas.map(f => f.tienda))].sort();
  llenarSelect("fLineaDet", lineas, "Línea");
  llenarSelect("fMarcaDet", marcas, "Marca");
  llenarSelect("fTiendaDet", tiendas, "Tienda");
}
function filtroActivo(id) { const el = $(id); return el ? el.value : ""; }
function filtrar(fLin, fMar, fTie) {
  return state.data.filas.filter(f => {
    if (fLin && f.linea !== fLin) return false;
    if (fMar && f.marca !== fMar) return false;
    if (fTie && f.tienda !== fTie) return false;
    return true;
  });
}

/* ---------- GENERAL ---------- */
function renderGeneral() {
  if (!state.data) { $("kpiGeneral").innerHTML = ""; $("gridGeneral").innerHTML = ""; return; }
  const d = state.data;

  let totalCosto = 0, sumAntig = 0, cntAntig = 0, sinMov = 0;
  const porLinea = {}, porEstado = {}, porRango = {};
  d.filas.forEach(f => {
    totalCosto += f.costo;
    if (f.antiguedad > 0) { sumAntig += f.antiguedad; cntAntig++; }
    if (f.ultTranx) {
      const dd = new Date(f.ultTranx);
      if (!isNaN(dd.getTime()) && (Date.now() - dd.getTime()) / 86400000 > 180) sinMov++;
    }
    porLinea[f.linea] = (porLinea[f.linea] || 0) + f.costo;
    porEstado[f.estado] = (porEstado[f.estado] || 0) + f.costo;
    const r = (() => { const n = Number(f.antiguedad); if (!isFinite(n) || n <= 0) return "Sin dato"; if (n <= 30) return "0-30 días"; if (n <= 90) return "31-90 días"; if (n <= 180) return "91-180 días"; return "+180 días"; })();
    porRango[r] = (porRango[r] || 0) + 1;
  });
  const antigProm = cntAntig ? sumAntig / cntAntig : 0;

  $("kpiGeneral").innerHTML = [
    heroCard({
      title: "Costo Total Conteo", value: "S/ " + fmtM(totalCosto), unit: "",
      note: `${fmt(d.filas.length)} equipos · ${fmt(d.kpis.totalSeries)} series`,
      badge: `Stock: ${fmt(d.kpis.totalStock)}`,
    }),
    kpiCard({ icon: "fa-boxes-stacked", tone: "gold", title: "Total Equipos (Conteo)", value: fmt(d.filas.length), unit: "",
      pct: Math.min(100, d.filas.length / 10), barLabel: "Sobre 1000", foot: `Faltantes: ${fmt(d.kpis.totalFaltantes)} · Sobrantes: ${fmt(d.kpis.totalSobrantes)}` }),
    kpiCard({ icon: "fa-clock", tone: "amber", title: "Antigüedad promedio", value: fmt(antigProm, 0), unit: "días",
      pct: Math.min(100, antigProm / 3), barLabel: "Sobre 300 días", foot: `${fmt(cntAntig)} equipos con dato` }),
    kpiCard({ icon: "fa-hourglass-end", tone: "orange", title: "Sin movimiento +180d", value: fmt(sinMov), unit: "",
      pct: d.filas.length ? (sinMov / d.filas.length) * 100 : 0, barLabel: "Del total", foot: `${fmt(d.filas.length ? (sinMov/d.filas.length)*100 : 0, 1)}% sin movimiento` }),
  ].join("");

  const linArr = Object.entries(porLinea).sort((a, b) => b[1] - a[1]);
  renderColumns("gLinea", linArr.map(l => truncar(l[0], 14)), linArr.map(l => round(l[1], 2)), C.goldLight, C.goldDark, 0);

  const rangoOrden = ["0-30 días", "31-90 días", "91-180 días", "+180 días", "Sin dato"];
  renderColumns("gRango", rangoOrden, rangoOrden.map(r => porRango[r] || 0), C.amber, C.orange, 0);

  const estArr = Object.entries(porEstado).sort((a, b) => b[1] - a[1]);
  renderDoughnut("gEstado", estArr.map(e => e[0]), estArr.map(e => round(e[1], 2)), fmtM(totalCosto), "costo total");

  mount("gConteoStock", {
    type: "bar",
    data: { labels: ["Conteo Láser", "Stock Sistema", "Faltantes", "Sobrantes"],
      datasets: [{ data: [d.kpis.totalEquipos, d.kpis.totalStock, d.kpis.totalFaltantes, d.kpis.totalSobrantes],
        backgroundColor: [C.gold, C.blue, C.red, C.amber],
        borderRadius: { topLeft: 7, topRight: 7 }, borderSkipped: false, maxBarThickness: 56 }] },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 16 } },
      plugins: { tooltip: tooltipStyle(), datalabels: { ...labelBase, display: true, anchor: "end", align: "end", offset: 3, formatter: (v) => fmt(v) } },
      scales: { x: scaleX(), y: scaleY(Math.max(d.kpis.totalEquipos, d.kpis.totalStock) * 1.25, 0) } },
  });
}

/* ---------- INVENTARIO ---------- */
function renderInventario() {
  if (!state.data) return;
  const d = state.data;

  let totalCosto = 0;
  const porTienda = {}, porMoneda = {}, porSublinea = {}, porEstado = {};
  d.filas.forEach(f => {
    totalCosto += f.costo;
    porTienda[f.tienda] = (porTienda[f.tienda] || 0) + 1;
    porMoneda[f.moneda] = (porMoneda[f.moneda] || 0) + f.costo;
    porSublinea[f.sublinea] = (porSublinea[f.sublinea] || 0) + 1;
    porEstado[f.estado] = (porEstado[f.estado] || 0) + f.costo;
  });

  $("kpiInventario").innerHTML = [
    heroCard({ title: "Equipos en Conteo", value: fmt(d.filas.length), unit: "", note: `${fmt(Object.keys(porTienda).length)} tiendas · ${fmt(Object.keys(porSublinea).length)} sublíneas`, badge: `Costo: S/ ${fmtM(totalCosto)}` }),
    kpiCard({ icon: "fa-store", tone: "gold", title: "Tiendas", value: fmt(Object.keys(porTienda).length), unit: "", pct: 100, barLabel: "—", foot: "Puntos de inventario" }),
    kpiCard({ icon: "fa-layer-group", tone: "blue", title: "Sublíneas", value: fmt(Object.keys(porSublinea).length), unit: "", pct: 100, barLabel: "—", foot: "Categorías de producto" }),
    kpiCard({ icon: "fa-coins", tone: "green", title: "Costo Total", value: "S/ " + fmtM(totalCosto), unit: "", pct: 100, barLabel: "—", foot: `${fmt(d.kpis.totalSeries)} series` }),
  ].join("");

  const tArr = Object.entries(porTienda).sort((a, b) => b[1] - a[1]);
  renderScrollHBar("invTienda", tArr.map(t => truncar(t[0], 24)), tArr.map(t => t[1]), C.goldDark, C.goldLight, 0);

  const mArr = Object.entries(porMoneda).sort((a, b) => b[1] - a[1]);
  renderDoughnut("invMoneda", mArr.map(m => m[0]), mArr.map(m => round(m[1], 2)), "S/ " + fmtM(totalCosto), "costo");

  const sArr = Object.entries(porSublinea).sort((a, b) => b[1] - a[1]);
  renderScrollHBar("invSublinea", sArr.map(s => truncar(s[0], 24)), sArr.map(s => s[1]), C.blue, C.cyan, 0);

  const eArr = Object.entries(porEstado).sort((a, b) => b[1] - a[1]);
  renderDoughnut("invEstado2", eArr.map(e => e[0]), eArr.map(e => round(e[1], 2)), "S/ " + fmtM(totalCosto), "costo");
}

/* ---------- LÍNEA / MARCA ---------- */
function renderLineaMarca() {
  if (!state.data) return;
  const d = state.data;

  const porLineaEq = {}, porLineaCos = {}, porMarcaCos = {}, porMarcaEq = {}, porSublineaCos = {};
  d.filas.forEach(f => {
    porLineaEq[f.linea] = (porLineaEq[f.linea] || 0) + 1;
    porLineaCos[f.linea] = (porLineaCos[f.linea] || 0) + f.costo;
    porMarcaCos[f.marca] = (porMarcaCos[f.marca] || 0) + f.costo;
    porMarcaEq[f.marca] = (porMarcaEq[f.marca] || 0) + 1;
    porSublineaCos[f.sublinea] = (porSublineaCos[f.sublinea] || 0) + f.costo;
  });

  const lEq = Object.entries(porLineaEq).sort((a, b) => b[1] - a[1]);
  renderColumns("lmLinea", lEq.map(l => truncar(l[0], 14)), lEq.map(l => l[1]), C.goldLight, C.goldDark, 0);

  const mCos = Object.entries(porMarcaCos).sort((a, b) => b[1] - a[1]).slice(0, 20);
  renderScrollHBar("lmMarca", mCos.map(m => truncar(m[0], 24)), mCos.map(m => round(m[1], 2)), C.goldDark, C.goldLight, 0);

  const mEq = Object.entries(porMarcaEq).sort((a, b) => b[1] - a[1]).slice(0, 20);
  renderScrollHBar("lmMarcaEquipos", mEq.map(m => truncar(m[0], 24)), mEq.map(m => m[1]), C.blue, C.cyan, 0);

  const sCos = Object.entries(porSublineaCos).sort((a, b) => b[1] - a[1]).slice(0, 20);
  renderScrollHBar("lmSublineaCosto", sCos.map(s => truncar(s[0], 24)), sCos.map(s => round(s[1], 2)), C.amber, C.orange, 0);
}

/* ---------- ANTIGÜEDAD ---------- */
function renderAntiguedad() {
  if (!state.data) return;
  const d = state.data;

  let sumA = 0, cntA = 0, maxA = 0;
  const porRango = {};
  d.filas.forEach(f => {
    const n = Number(f.antiguedad);
    if (n > 0) { sumA += n; cntA++; if (n > maxA) maxA = n; }
    const r = (() => { if (!isFinite(n) || n <= 0) return "Sin dato"; if (n <= 30) return "0-30 días"; if (n <= 90) return "31-90 días"; if (n <= 180) return "91-180 días"; return "+180 días"; })();
    porRango[r] = (porRango[r] || 0) + 1;
  });
  const prom = cntA ? sumA / cntA : 0;

  $("kpiAntig").innerHTML = [
    heroCard({ title: "Antigüedad promedio", value: fmt(prom, 0), unit: "días", note: `${fmt(cntA)} equipos con dato`, badge: `Máx: ${fmt(maxA)} días` }),
    kpiCard({ icon: "fa-calendar", tone: "gold", title: "0-30 días", value: fmt(porRango["0-30 días"] || 0), unit: "", pct: d.filas.length ? ((porRango["0-30 días"]||0)/d.filas.length)*100 : 0, barLabel: "Del total", foot: "Nuevos" }),
    kpiCard({ icon: "fa-calendar-days", tone: "amber", title: "31-180 días", value: fmt((porRango["31-90 días"]||0) + (porRango["91-180 días"]||0)), unit: "", pct: d.filas.length ? (((porRango["31-90 días"]||0)+(porRango["91-180 días"]||0))/d.filas.length)*100 : 0, barLabel: "Del total", foot: "Rotación media" }),
    kpiCard({ icon: "fa-hourglass-end", tone: "orange", title: "+180 días", value: fmt(porRango["+180 días"] || 0), unit: "", pct: d.filas.length ? ((porRango["+180 días"]||0)/d.filas.length)*100 : 0, barLabel: "Del total", foot: "Stock inmovilizado" }),
  ].join("");

  const rangoOrden = ["0-30 días", "31-90 días", "91-180 días", "+180 días", "Sin dato"];
  renderColumns("antRango", rangoOrden, rangoOrden.map(r => porRango[r] || 0), C.amber, C.orange, 0);

  const top = [...d.filas].filter(f => f.antiguedad > 0).sort((a, b) => b.antiguedad - a.antiguedad).slice(0, 15);
  const ctx = $("antTop"); if (!ctx) return;
  if (charts["antTop"]) charts["antTop"].destroy();
  const wrap = ctx.parentElement;
  wrap.style.maxHeight = "420px"; wrap.style.overflowY = "auto"; wrap.style.overflowX = "hidden";
  ctx.style.height = Math.max(420, top.length * 30) + "px"; ctx.style.maxHeight = "none";
  if (!top.length) { wrap.classList.add("is-empty"); return; }
  wrap.classList.remove("is-empty");
  const max = Math.max(...top.map(t => t.antiguedad), 0);
  charts["antTop"] = new Chart(ctx, {
    type: "bar",
    data: { labels: top.map(t => truncar(t.desc, 30)), datasets: [{ data: top.map(t => t.antiguedad), borderRadius: 6, borderSkipped: false, barThickness: 14, backgroundColor: gradH(C.goldDark, C.goldLight) }] },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, layout: { padding: { right: 12 } },
      plugins: { tooltip: tooltipStyle(), datalabels: { ...labelBase, display: true, anchor: "end", align: "right", offset: 4, formatter: (v) => fmt(v) } },
      scales: { x: { ...scaleY(max * 1.18, 0), ticks: { color: C.faint, callback: (v) => fmt(v), maxTicksLimit: 5 } }, y: { grid: { display: false }, border: { display: false }, ticks: { color: C.text, callback(v) { return truncar(this.getLabelForValue(v), 28); } } } } },
  });
}

/* ---------- DIFERENCIAS ---------- */
function renderDiferencias() {
  if (!state.data) return;
  const d = state.data;

  $("kpiDif").innerHTML = [
    heroCard({ title: "Diferencias totales", value: fmt(d.kpis.totalFaltantes + d.kpis.totalSobrantes), unit: "", note: `Faltantes: ${fmt(d.kpis.totalFaltantes)} · Sobrantes: ${fmt(d.kpis.totalSobrantes)}`, badge: `Conteo: ${fmt(d.kpis.totalEquipos)}` }),
    kpiCard({ icon: "fa-circle-minus", tone: "orange", title: "Faltantes", value: fmt(d.kpis.totalFaltantes), unit: "", pct: d.kpis.totalEquipos ? (d.kpis.totalFaltantes/d.kpis.totalEquipos)*100 : 0, barLabel: "Del conteo", foot: "Series en conteo sin stock" }),
    kpiCard({ icon: "fa-circle-plus", tone: "amber", title: "Sobrantes", value: fmt(d.kpis.totalSobrantes), unit: "", pct: d.kpis.totalStock ? (d.kpis.totalSobrantes/d.kpis.totalStock)*100 : 0, barLabel: "Del stock", foot: "Series en stock sin conteo" }),
    kpiCard({ icon: "fa-boxes-stacked", tone: "blue", title: "Stock Sistema", value: fmt(d.kpis.totalStock), unit: "", pct: 100, barLabel: "—", foot: `${fmt(d.kpis.totalStock)} series` }),
  ].join("");

  mount("difResumen", {
    type: "bar",
    data: { labels: ["Conteo Láser", "Stock Sistema", "Faltantes", "Sobrantes"],
      datasets: [{ data: [d.kpis.totalEquipos, d.kpis.totalStock, d.kpis.totalFaltantes, d.kpis.totalSobrantes],
        backgroundColor: [C.gold, C.blue, C.red, C.amber],
        borderRadius: { topLeft: 7, topRight: 7 }, borderSkipped: false, maxBarThickness: 56 }] },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 16 } },
      plugins: { tooltip: tooltipStyle(), datalabels: { ...labelBase, display: true, anchor: "end", align: "end", offset: 3, formatter: (v) => fmt(v) } },
      scales: { x: scaleX(), y: scaleY(Math.max(d.kpis.totalEquipos, d.kpis.totalStock) * 1.25, 0) } },
  });

  const topF = d.faltantes.slice(0, 15);
  renderScrollHBar("difTopFaltantes", topF.map(f => truncar(f.desc, 30)), topF.map(f => round(f.costo, 2)), C.red, C.orange, 0);

  const topS = d.sobrantes.slice(0, 15);
  renderScrollHBar("difTopSobrantes", topS.map(f => truncar(f.desc, 30)), topS.map(f => round(f.costo, 2)), C.amber, C.goldLight, 0);
}

/* ---------- DETALLE ---------- */
function renderDetalle() {
  if (!state.data) return;
  const filas = filtrar(filtroActivo("fLineaDet"), filtroActivo("fMarcaDet"), filtroActivo("fTiendaDet"));

  $("cdTabla").innerHTML = filas.length
    ? tabla(
        [
          { t: "SKU" }, { t: "Serie" }, { t: "Descripción" }, { t: "Marca" }, { t: "Línea" },
          { t: "Sublínea" }, { t: "Estado" }, { t: "Tienda" },
          { t: "Costo", num: 1 }, { t: "Mon." }, { t: "Antig.", num: 1 },
        ],
        filas.slice(0, 200).map(f => [
          f.sku, truncar(f.serie, 22), truncar(f.desc, 40), truncar(f.marca, 16), f.linea,
          truncar(f.sublinea, 18), f.estado, truncar(f.tienda, 16),
          fmt(f.costo, 2), f.moneda, fmt(f.antiguedad),
        ])
      )
    : `<div class="plot-empty" style="display:flex;position:static;min-height:120px"><i class="fas fa-chart-simple"></i><span>Sin datos</span></div>`;
}

function cambiarSubC(sub) {
  subActualC = sub;
  document.querySelectorAll("#subTabsC .subtab").forEach(t => t.classList.toggle("active", t.dataset.sub === sub));
  ["general", "inventario", "lineamarca", "antiguedad", "diferencias", "detalle"].forEach(s => {
    const el = document.getElementById("subC-" + s);
    if (el) el.style.display = s === sub ? "block" : "none";
  });
  if (sub === "general") renderGeneral();
  else if (sub === "inventario") renderInventario();
  else if (sub === "lineamarca") renderLineaMarca();
  else if (sub === "antiguedad") renderAntiguedad();
  else if (sub === "diferencias") renderDiferencias();
  else if (sub === "detalle") renderDetalle();
  requestAnimationFrame(() => Object.values(charts).forEach(c => c.resize()));
}

function engancharEventos() {
  if (listenersReady) return;
  listenersReady = true;

  document.querySelectorAll("#subTabsC .subtab").forEach(t => {
    t.addEventListener("click", () => cambiarSubC(t.dataset.sub));
  });
  ["fLineaDet", "fMarcaDet", "fTiendaDet"].forEach(id => { const el = $(id); if (el) el.addEventListener("change", () => renderDetalle()); });
  $("clearCompDet").addEventListener("click", () => {
    ["fLineaDet", "fMarcaDet", "fTiendaDet"].forEach(x => { const el = $(x); if (el) el.value = ""; });
    renderDetalle();
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
  const data = await cargarHoja("INVENTARIO_DATA").catch(() => null);
  state.data = data;

  const count = data ? 1 : 0;
  $("stRegistros").textContent = `${count} / 1`;
  $("stSync").textContent = new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });

  $("chipRegistros").textContent = fmt(state.data?.kpis?.totalEquipos || 0);
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
    $("inventario").hidden = false;
    engancharEventos();
    cambiarSubC(subActualC);
  } catch (err) {
    console.error(err);
    $("loading").innerHTML = `<div class="error-box"><i class="fas fa-triangle-exclamation"></i><h3>No se pudieron cargar los datos</h3><p>${err.message || err}</p></div>`;
  }
})();