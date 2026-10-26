const SUPABASE_URL = "https://ieblbnoyvppyiixtjgpk.supabase.co";
const SUPABASE_KEY = "sb_publishable_jDIyPv2xMqmOMrQr6oaHog_jec-bv6T";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const C = {
  gold: "#1E3A8A", goldLight: "#3B82F6", goldDark: "#0F172A",
  orange: "#EA580C", amber: "#D97706",
  green: "#10B981", red: "#EF4444", blue: "#2563EB", cyan: "#06B6D4",
  other: "#CBD5E1", text: "#1E293B", dim: "#64748B", faint: "#94A3B8",
  grid: "rgba(100, 116, 139, 0.14)", panel: "#FFFFFF",
};
const PALETTE = [C.gold, C.orange, C.green, C.blue, C.amber, C.cyan, C.red, C.goldLight];

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

const fmt = (v, d = 0) => Number(v).toLocaleString("es-PE", { maximumFractionDigits: d, minimumFractionDigits: 0 });
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

function mount(id, config) {
  const canvas = $(id); if (!canvas) return;
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
  const vacio = !config.data.labels || config.data.labels.length === 0;
  canvas.parentElement.classList.toggle("is-empty", vacio);
  if (vacio) return;
  charts[id] = new Chart(canvas, config);
}

const scaleX = () => ({ grid: { display: false }, border: { color: "#E2E8F0" }, ticks: { color: C.dim, maxRotation: 0, autoSkipPadding: 14 } });
const scaleY = (max) => ({ beginAtZero: true, suggestedMax: max, grid: { color: C.grid }, border: { display: false }, ticks: { color: C.faint, maxTicksLimit: 6 } });

function renderLine(id, labels, datasets) {
  const maxAll = Math.max(...datasets.flatMap(d => d.data), 0);
  mount(id, {
    type: "line",
    data: { labels, datasets: datasets.map(d => ({
      label: d.label, data: d.data, borderColor: d.color, borderWidth: 2.5, tension: 0.35, fill: false,
      pointBackgroundColor: d.color, pointBorderColor: "#FFFFFF", pointBorderWidth: 2, pointRadius: 4, pointHoverRadius: 6,
    })) },
    options: { responsive: true, maintainAspectRatio: false, 
      interaction: { mode: "index", intersect: false },
      layout: { padding: { top: 22, right: 10 } },
      plugins: {
        legend: { display: true, position: "bottom", labels: { color: C.dim, usePointStyle: true, pointStyle: "circle", boxWidth: 8, padding: 14 } },
        tooltip: { backgroundColor: "#FFFFFF", titleColor: C.text, bodyColor: C.text, borderColor: "#E2E8F0", borderWidth: 1, padding: 12, displayColors: true, boxWidth: 10, boxHeight: 10, callbacks: { title: (c) => c[0].label, label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` } },
      },
      scales: { x: scaleX(), y: scaleY(maxAll * 1.18) } },
  });
}

function renderGrouped(id, labels, datasets, horizontal = false) {
  const canvas = $(id); 
  if (canvas) { canvas.style.width = '100%'; canvas.style.height = '400px'; }
  mount(id, {
    type: "bar",
    data: { labels, datasets: datasets.map(d => ({
      label: d.label, data: d.data, backgroundColor: d.color,
      borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: false, maxBarThickness: 35,
      datalabels: { display: false }
    })) },
    options: { responsive: true, maintainAspectRatio: false, 
      interaction: { mode: "index", intersect: false },
      layout: { padding: { top: 18, bottom: 10 } },
      plugins: {
        legend: { display: true, position: "bottom", labels: { color: C.dim, usePointStyle: true, pointStyle: "circle", boxWidth: 8, padding: 14 } },
        tooltip: { backgroundColor: "#FFFFFF", titleColor: C.text, bodyColor: C.text, borderColor: "#E2E8F0", borderWidth: 1, padding: 12, displayColors: true, boxWidth: 10, boxHeight: 10, callbacks: { title: (c) => c[0].label, label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` } },
      },
      indexAxis: horizontal ? 'y' : 'x',
      scales: { 
        x: horizontal ? { beginAtZero: true, grid: { color: C.grid }, ticks: { color: C.faint } } : { ...scaleX(), ticks: { color: C.dim, maxRotation: 0, autoSkip: false, callback: function(val) { const label = this.getLabelForValue(val); const words = label.split(' '); const lineas = []; let linea = ''; words.forEach(w => { if ((linea + w).length > 15) { lineas.push(linea.trim()); linea = w + ' '; } else { linea += w + ' '; } }); if (linea) lineas.push(linea.trim()); return lineas; } } }, 
        y: horizontal ? { grid: { display: false }, ticks: { color: C.dim } } : { beginAtZero: true, suggestedMax: Math.max(...datasets.flatMap(d => d.data)) * 1.15, grid: { color: C.grid }, border: { display: false }, ticks: { color: C.faint, maxTicksLimit: 6 } }  
      } 
    },
  });
}

function renderDoughnut(id, labels, data, centerTitle, centerSub) {
  const total = data.reduce((a, b) => a + Number(b), 0);
  const colores = labels.map((l, i) => PALETTE[i % PALETTE.length]);
  mount(id, {
    type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: colores, borderColor: "#FFFFFF", borderWidth: 3, hoverOffset: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: "68%",
      plugins: {
        tooltip: { backgroundColor: "#FFFFFF", titleColor: C.text, bodyColor: C.text, borderColor: "#E2E8F0", borderWidth: 1, padding: 12, displayColors: true, boxWidth: 10, boxHeight: 10, callbacks: { title: (c) => c[0].label, label: (c) => ` ${fmt(c.parsed)} (${total ? Math.round((c.parsed / total) * 100) : 0}%)` } },
        datalabels: { display: (c) => total > 0 && c.dataset.data[c.dataIndex] / total >= 0.06, color: "#1E293B", font: { family: "'IBM Plex Sans', sans-serif", weight: "700", size: 11 }, formatter: (v) => Math.round((v / total) * 100) + "%" },
        centerText: { title: centerTitle, sub: centerSub },
      } },
    plugins: [centerText],
  });
  const lg = $(id + "Legend");
  if (lg) lg.innerHTML = labels.map((l, i) => `<div class="legend-item"><i style="background:${colores[i]}"></i><span title="${l}">${l}</span><b>${total ? Math.round((data[i] / total) * 100) : 0}%</b></div>`).join("");
}

function heroCard({ title, value, unit, badge, note }) {
  return `<article class="card hero span-3"><span class="eyebrow">Indicador principal</span><h3>${title}</h3><div class="hero-val">${value}<small>${unit}</small></div><p class="hero-note">${note}</p><span class="pill pill-orange">${badge}</span></article>`;
}
function kpiCard({ icon, tone, title, value, unit, pct, barLabel, foot }) {
  return `<article class="card kpi tone-${tone} span-3"><div class="kpi-head"><span class="kpi-ico"><i class="fas ${icon}"></i></span><h3>${title}</h3></div><div class="kpi-val">${value}<small>${unit}</small></div><div class="bar"><i style="width:${Math.min(100, Math.max(0, pct))}%"></i></div><div class="kpi-foot"><span>${barLabel}</span><b>${fmt(pct, 1)}%</b></div><p class="kpi-note">${foot}</p></article>`;
}
function plotCard(id, titulo, sub, span, size = "") {
  return `<article class="card span-${span}"><div class="card-head"><h3>${titulo}</h3><p>${sub}</p></div><div class="plot ${size}"><canvas id="${id}"></canvas><div class="plot-empty"><i class="fas fa-chart-simple"></i><span>Sin datos</span></div></div></article>`;
}
function donutCard(id, titulo, sub, span) {
  return `<article class="card span-${span}"><div class="card-head"><h3>${titulo}</h3><p>${sub}</p></div><div class="plot donut"><canvas id="${id}"></canvas><div class="plot-empty"><i class="fas fa-chart-pie"></i><span>Sin datos</span></div></div><div class="legend" id="${id}Legend"></div></article>`;
}
function slotCard(id, titulo, sub, span) {
  return `<article class="card span-${span}"><div class="card-head"><h3>${titulo}</h3><p>${sub}</p></div><div id="${id}" class="mini-table"></div></article>`;
}
function tabla(encabezados, filas) {
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${encabezados.map((h) => `<th class="${h.num ? "num" : ""}">${h.t}</th>`).join("")}</tr></thead><tbody>${filas.map((f) => `<tr>${f.map((c, i) => `<td class="${encabezados[i].num ? "num" : ""} ${i === 0 ? "name" : ""}">${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function vacioMensaje(span = 12) { return `<article class="card span-${span}"><div class="plot-empty" style="display:flex;position:static;min-height:200px"><i class="fas fa-database"></i><span>No se encontraron datos.</span></div></article>`; }

function construirLayoutInterno() {
  // EVOLUCIÓN
  const divFiltrosEvo = $("filtersEvolucion");
  if (divFiltrosEvo) {
    divFiltrosEvo.innerHTML = `
      <div class="filter-chip"><i class="fas fa-filter"></i>
        <select id="eCliente" class="filter-select"><option value="">Cliente</option></select></div>
      <div class="filter-chip"><i class="fas fa-layer-group"></i>
        <select id="eLinea" class="filter-select"><option value="">Línea</option></select></div>
      <button id="eClear" class="btn-clear-chips"><i class="fas fa-eraser"></i> Limpiar</button>`;
  }

  $("gridEvolucion").innerHTML = [
    plotCard("eLineas", "Evolución de Pedidos", "Cantidad por fecha", 8, "tall"),
    donutCard("eGasto", "Pedidos por Línea", "Distribución Naranja/Blanca", 4),
    slotCard("eTabla", "Resumen General", "Indicadores clave", 12)
  ].join("");

  // SEGUIMIENTO
  const divFiltros = $("filtersSeguimiento");
  if (divFiltros) {
    divFiltros.innerHTML = `
      <div class="filter-chip"><i class="fas fa-filter"></i>
        <select id="sCliente" class="filter-select"><option value="">Cliente</option></select></div>
      <div class="filter-chip"><i class="fas fa-layer-group"></i>
        <select id="sLinea" class="filter-select"><option value="">Línea</option></select></div>
      <button id="sClear" class="btn-clear-chips"><i class="fas fa-eraser"></i> Limpiar</button>`;
  }

  $("gridSeguimiento").innerHTML = [
    plotCard("sBarras", "Pedidos por Línea / Sub-Línea", "Distribución por categoría", 8, "tall"),
    plotCard("sDona", "Pedidos por Cliente", "Distribución por cliente", 4, "tall"), // <-- CAMBIADO AQUI
    plotCard("sModelos", "Top 10 Modelos", "Modelos más solicitados", 12, "tall")
  ].join("");

  // TABLAS
  const divFiltrosTablas = $("filtersTablas");
  if (divFiltrosTablas) {
    divFiltrosTablas.innerHTML = `
      <div class="filter-chip"><i class="fas fa-filter"></i>
        <select id="tCliente" class="filter-select"><option value="">Cliente</option></select></div>
      <div class="filter-chip"><i class="fas fa-layer-group"></i>
        <select id="tLinea" class="filter-select"><option value="">Línea</option></select></div>
      <button id="tClear" class="btn-clear-chips"><i class="fas fa-eraser"></i> Limpiar</button>`;
  }
}

function llenarSegmentadores() {
  if (!state.data) return;
  
  const llenar = (id, set, def) => {
    const sel = $(id); if (!sel) return;
    sel.innerHTML = `<option value="">${def}</option>`;
    [...set].sort().forEach(v => { 
      if(v) {
        const o = document.createElement("option"); o.value = v; o.textContent = v; sel.appendChild(o); 
      }
    });
  };
  
  const tClientes = new Set(), tLineas = new Set();
  state.data.filas.forEach(f => { 
    if(f.cliente) tClientes.add(f.cliente); // Usa nombre del cliente
    if(f.linea) tLineas.add(f.linea);       // Usa NARANJA, BLANCA, etc.
  });

  llenar("eCliente", tClientes, "Cliente"); llenar("eLinea", tLineas, "Línea");
  llenar("sCliente", tClientes, "Cliente"); llenar("sLinea", tLineas, "Línea");
  llenar("tCliente", tClientes, "Cliente"); llenar("tLinea", tLineas, "Línea");
}

function renderEvolucion() {
  if (!state.data) { $("kpiEvolucion").innerHTML = ""; $("gridEvolucion").innerHTML = vacioMensaje(12); return; }
  const d = state.data;
  
  const eCliente = $("eCliente") ? $("eCliente").value : "";
  const eLinea = $("eLinea") ? $("eLinea").value : "";

  const filas = d.filas.filter(f => {
    if (eCliente && f.cliente !== eCliente) return false;
    if (eLinea && f.linea !== eLinea) return false;
    return true;
  });

  let tPedidos = 0, tQty = 0, tM3 = 0, tEtiquetas = 0;
  const setPedidos = new Set();
  const porFecha = {};

  filas.forEach(f => {
    setPedidos.add(f.order);
    tQty += f.qty;
    tM3 += f.m3;
    tEtiquetas += f.etiquetas;
    if (f.fecha) porFecha[f.fecha] = (porFecha[f.fecha] || 0) + 1;
  });
  tPedidos = setPedidos.size;

  $("kpiEvolucion").innerHTML = [
    heroCard({ title: "Total Pedidos", value: fmt(tPedidos), unit: "", note: `Volumen: ${fmt(tM3, 2)} m3`, badge: `Etiquetas: ${fmt(tEtiquetas)}` }),
    kpiCard({ icon: "fa-box", tone: "gold", title: "Total Productos", value: fmt(tQty), unit: "unid", pct: 100, barLabel: "QTY", foot: "" }),
    kpiCard({ icon: "fa-cubes", tone: "amber", title: "Total Volumen", value: fmt(tM3, 2), unit: "m3", pct: 100, barLabel: "M3", foot: "" }),
    kpiCard({ icon: "fa-tags", tone: "green", title: "Total Etiquetas", value: fmt(tEtiquetas), unit: "", pct: 100, barLabel: "Generadas", foot: "" }),
  ].join("");

  // CORRECCION: Grafico de lineas
    // Gráfico de líneas
  const fechasOrdenadas = Object.keys(porFecha).sort();
  renderLine("eLineas", fechasOrdenadas, [{ 
    label: "Pedidos", 
    color: C.gold, 
    data: fechasOrdenadas.map(f => porFecha[f]) 
  }]);

  // CORRECCION: Grafico de anillos usa porLinea
  renderDoughnut("eGasto", d.porLinea.map(x => x.nombre), d.porLinea.map(x => x.valor), fmt(tPedidos), "Pedidos");

  $("eTabla").innerHTML = tabla(
    [ { t: "Métrica" }, { t: "Valor", num: 1 } ],
    [
      ["Total Pedidos (únicos)", fmt(tPedidos)],
      ["Total Productos", fmt(tQty)],
      ["Total Volumen", fmt(tM3, 2) + " m3"],
      ["Total Etiquetas", fmt(tEtiquetas)]
    ]
  );
}

function renderSeguimiento() {
  if (!state.data) { $("kpiSeguimiento").innerHTML = ""; $("gridSeguimiento").innerHTML = vacioMensaje(12); return; }
  const d = state.data;
  const sCliente = $("sCliente") ? $("sCliente").value : "";
  const sLinea = $("sLinea") ? $("sLinea").value : "";

  const filas = d.filas.filter(f => {
    if (sCliente && f.cliente !== sCliente) return false;
    if (sLinea && f.linea !== sLinea) return false;
    return true;
  });

  // Recalcular para el filtro (opcional, pero para que sea exacto)
  const subLineas = {}, clientes = {}, modelos = {};
  filas.forEach(f => {
      subLineas[f.subLinea] = (subLineas[f.subLinea] || 0) + 1;
      clientes[f.cliente] = (clientes[f.cliente] || 0) + 1;
      modelos[f.modelo] = (modelos[f.modelo] || 0) + 1;
  });

  const arrSub = Object.entries(subLineas).map(([k,v]) => ({nombre:k, valor:v})).sort((a,b)=>b.valor-a.valor).slice(0, 8);
  const arrCli = Object.entries(clientes).map(([k,v]) => ({nombre:k, valor:v})).sort((a,b)=>b.valor-a.valor);
  const arrMod = Object.entries(modelos).map(([k,v]) => ({nombre:k, valor:v})).sort((a,b)=>b.valor-a.valor).slice(0, 10);

  renderGrouped("sBarras", arrSub.map(x=>x.nombre), [
    { label: "Pedidos", color: C.gold, data: arrSub.map(x=>x.valor) }
  ]);

    // Cambiamos el gráfico de anillo por barras para clientes
  const topClientes = arrCli.slice(0, 8); // Mostramos solo los 8 primeros para que no se sature
  renderGrouped("sDona", topClientes.map(x=>x.nombre), [
    { label: "Pedidos", color: C.gold, data: topClientes.map(x=>x.valor) }
  ]);

  renderGrouped("sModelos", arrMod.map(x=>x.nombre), [
    { label: "Pedidos", color: C.orange, data: arrMod.map(x=>x.valor) }
  ]);
}

function renderSeguimiento() {
  if (!state.data) { $("kpiSeguimiento").innerHTML = ""; $("gridSeguimiento").innerHTML = vacioMensaje(12); return; }
  const d = state.data;
  
  const sCliente = $("sCliente") ? $("sCliente").value : "";
  const sLinea = $("sLinea") ? $("sLinea").value : "";

  const filas = d.filas.filter(f => {
    if (sCliente && f.cliente !== sCliente) return false;
    if (sLinea && f.linea !== sLinea) return false;
    return true;
  });

  const subLineas = {}, clientes = {}, modelos = {};
  filas.forEach(f => {
      if(f.subLinea) subLineas[f.subLinea] = (subLineas[f.subLinea] || 0) + 1;
      if(f.cliente) clientes[f.cliente] = (clientes[f.cliente] || 0) + 1;
      if(f.modelo) modelos[f.modelo] = (modelos[f.modelo] || 0) + 1;
  });

  const arrSub = Object.entries(subLineas).map(([k,v]) => ({nombre:k, valor:v})).sort((a,b)=>b.valor-a.valor).slice(0, 8);
  const arrCli = Object.entries(clientes).map(([k,v]) => ({nombre:k, valor:v})).sort((a,b)=>b.valor-a.valor);
  const arrMod = Object.entries(modelos).map(([k,v]) => ({nombre:k, valor:v})).sort((a,b)=>b.valor-a.valor).slice(0, 10);

  // 1. Sub-Líneas
  renderGrouped("sBarras", arrSub.map(x=>x.nombre), [
    { label: "Pedidos", color: C.gold, data: arrSub.map(x=>x.valor) }
  ], true);

  // 2. Clientes
  const topClientes = arrCli.slice(0, 8);
  renderGrouped("sDona", topClientes.map(x=>x.nombre), [
    { label: "Pedidos", color: C.orange, data: topClientes.map(x=>x.valor) }
  ], true);

  // 3. Modelos
  renderGrouped("sModelos", arrMod.map(x=>x.nombre), [
    { label: "Pedidos", color: C.blue, data: arrMod.map(x=>x.valor) }
  ], true);
}

function renderTablas() {
  if (!state.data) return;
  const tCliente = $("tCliente") ? $("tCliente").value : "";
  const tLinea = $("tLinea") ? $("tLinea").value : "";

  const filas = state.data.filas.filter(f => {
    if (tCliente && f.cliente !== tCliente) return false;
    if (tLinea && f.linea !== tLinea) return false;
    return true;
  });

  let html = `<div class="tbl-wrap"><table class="tbl"><thead><tr>
    <th>Order No</th><th>Cliente</th><th>Modelo</th><th>Línea</th><th>Sub-Línea</th><th class="num">QTY</th><th class="num">M3</th>
  </tr></thead><tbody>`;

  filas.slice(0, 500).forEach(f => {
    html += `<tr>
      <td>${f.order}</td>
      <td class="name">${f.cliente}</td>
      <td>${f.modelo}</td>
      <td>${f.linea}</td>
      <td>${f.subLinea}</td>
      <td class="num">${fmt(f.qty)}</td>
      <td class="num">${fmt(f.m3, 2)}</td>
    </tr>`;
  });
  html += `</tbody></table></div>`;
  $("tablaDetalle").innerHTML = html;
}

function cambiarSeccion(seccion) {
  document.querySelectorAll("#dashTabs .tab").forEach(t => t.classList.toggle("active", t.dataset.seccion === seccion));
  ["evolucion", "seguimiento", "tablas"].forEach(s => { const el = document.getElementById(s); if (el) el.hidden = s !== seccion; });
  
  if (seccion === "evolucion") renderEvolucion();
  if (seccion === "seguimiento") renderSeguimiento();
  if (seccion === "tablas") renderTablas();
  
  requestAnimationFrame(() => Object.values(charts).forEach(c => c.resize()));
}

function engancharEventos() {
  if (listenersReady) return;
  listenersReady = true;

  document.querySelectorAll("#dashTabs .tab").forEach(tab => {
    tab.addEventListener("click", (e) => { e.preventDefault(); cambiarSeccion(tab.dataset.seccion); });
  });

  ["eCliente", "eLinea", "sCliente", "sLinea", "tCliente", "tLinea"].forEach(id => {
    const el = $(id); if (el) el.addEventListener("change", () => {
      if(id.startsWith("e")) renderEvolucion();
      if(id.startsWith("s")) renderSeguimiento();
      if(id.startsWith("t")) renderTablas();
    });
  });

  if ($("eClear")) $("eClear").addEventListener("click", () => {
    ["eCliente", "eLinea"].forEach(id => { const el = $(id); if (el) el.value = ""; });
    renderEvolucion();
  });
  if ($("sClear")) $("sClear").addEventListener("click", () => {
    ["sCliente", "sLinea"].forEach(id => { const el = $(id); if (el) el.value = ""; });
    renderSeguimiento();
  });
  if ($("tClear")) $("tClear").addEventListener("click", () => {
    ["tCliente", "tLinea"].forEach(id => { const el = $(id); if (el) el.value = ""; });
    renderTablas();
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
  const data = await cargarHoja("ALMACEN_DATA").catch(() => null);
  state.data = data;

  const count = data ? 1 : 0;
  $("stRegistros").textContent = `${count} / 1`;
  $("stSync").textContent = new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
  $("chipRegistros").textContent = fmt(state.data?.filas?.length || 0);
  $("chipSync").textContent = new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });

  llenarSegmentadores();
  cambiarSeccion("evolucion");
}

(async function init() {
  construirLayoutInterno();
  try {
    await cargarTodo();
    $("loading").hidden = true;
    $("topbar").hidden = false;
    $("shell").hidden = false;
    engancharEventos();
    cambiarSeccion("evolucion");
  } catch (err) {
    console.error(err);
    $("loading").innerHTML = `<div class="error-box"><i class="fas fa-triangle-exclamation"></i><h3>No se pudieron cargar los datos</h3><p>${err.message || err}</p></div>`;
  }
})();