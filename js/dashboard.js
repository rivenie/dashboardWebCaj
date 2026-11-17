/* =====================================================================
   dashboard.js · CORE Almacén · Kardex, materiales y almacén central
   Un solo dashboard con 8 tableros (uno por pestaña de Excel):
   - Kardex final ............ Detalle F.V. · Detalle I.E.
   - Materiales HLC .......... VALO_DET (proyectos) · Ingreso_Egreso_HLC
   - Almacén central ......... Kardex Unificado · Kardex Materiales ·
                               Kardex Activos y Tenencias · Detalle I.E.
   Tres motores de cálculo (kardex, movimientos, valorización) leen las filas
   publicadas en Supabase: categorías, almacenes, proyectos y meses salen
   siempre de los datos, nada está escrito a mano.
   Sincronización: aviso entre pestañas, Realtime, sondeo liviano, al volver
   a la pestaña y al restaurar desde el historial (bfcache).
   ===================================================================== */
"use strict";

/* =========================== CONFIGURACIÓN =========================== */
const CONFIG = {
  SUPABASE_URL: "https://ieblbnoyvppyiixtjgpk.supabase.co",
  SUPABASE_KEY: "sb_publishable_jDIyPv2xMqmOMrQr6oaHog_jec-bv6T",
  TABLE: "dashboard_data",
  HOME_URL: "index.html",
  BUS: "core-dashboard",
  LS_UPLOAD: "core:lastUpload",
  LS_THEME: "core:theme",
  LS_DATASET: "core:almacen:tablero",
  POLL_MS: 20000,

  // Reglas de negocio (editables)
  OBSOLETO: /vencid|obsolet/i,      // almacén de materiales vencidos u obsoletos
  INMOV_ALTO: 10000,                // S/: inmovilizado desde el que se sugiere transferir o vender
  TOL_VALOR: 1,                     // S/: diferencia tolerada en las validaciones de saldo
  TOL_CANT: 0.01,                   // unidades: diferencia tolerada en el saldo físico
  ROT_MIN_PROM: 100,                // S/: stock promedio mínimo para calcular rotación (evita «miles de veces» con stock casi 0)
  LT_LIMITE: 30,                    // días: lead time de compra considerado largo
  META_GUIA: 95,                    // % de movimientos con guía "en meta"
  TRANSF: /\bT[EI]P?\b|transf/i,    // códigos o descripciones de transferencias internas
  // Grupos de activos (Kardex Activos y Tenencias) a partir de la descripción del almacén
  GRUPOS_ACTIVO: [
    [/tenenc/i, "Tenencias"],
    [/maquin|equipo(s)? pesad/i, "Maquinaria y equipos"],
    [/facilid/i, "Facilidades"],
    [/medici|medic/i, "Equipos de medición"],
    [/\bti\b|tecnolog|inform|c[oó]mput/i, "Equipos TI"],
  ],
  TOP_N: 15,
  PAGE_SIZE: 50,
};

const noStoreFetch = (input, init = {}) => fetch(input, { ...init, cache: "no-store" });
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
  global: { fetch: noStoreFetch },
  auth: { persistSession: false },
});
const REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* =========================== CONSTANTES =========================== */
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MES_CORTO = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const DIA_CORTO = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

// Catálogo de segmentadores (cada tablero elige los suyos)
const DIMCAT = {
  tipoAlm: { label: "Tipo de almacén", icon: "fa-layer-group", empty: "(Sin tipo)" },
  almacen: { label: "Almacén", icon: "fa-warehouse", empty: "(Sin almacén)" },
  recurso: { label: "Recurso", icon: "fa-box", empty: "(Sin recurso)" },
  unidad: { label: "Unidad", icon: "fa-ruler", empty: "(Sin unidad)" },
  estadoInv: { label: "Estado del inventario", icon: "fa-circle-half-stroke" },
  grupo: { label: "Grupo de activo", icon: "fa-tags" },
  tipoMov: { label: "Tipo Mov.", icon: "fa-right-left", empty: "(Sin tipo)" },
  mov: { label: "Movimiento", icon: "fa-tag", empty: "(Sin código)" },
  proveedor: { label: "Proveedor", icon: "fa-truck", empty: "(Sin proveedor)" },
  partida: { label: "Partida de control", icon: "fa-sitemap", empty: "(Sin partida)" },
  recursoN2: { label: "Recurso N2", icon: "fa-shapes", empty: "(Sin recurso N2)" },
  mes: { label: "Período mensual", icon: "fa-calendar", sort: "mes", empty: "(Sin fecha)" },
  destino: { label: "Destino / solicitante", icon: "fa-location-dot", empty: "(Sin destino)" },
  registra: { label: "Registra guía", icon: "fa-user-pen", empty: "(Sin registro)" },
  solicitante: { label: "Solicitante pedido", icon: "fa-user", empty: "(Sin solicitante)" },
  uneg: { label: "Unidad de negocio", icon: "fa-building", empty: "(Sin unidad)" },
  proyecto: { label: "Proyecto", icon: "fa-diagram-project", empty: "(Sin proyecto)" },
  tipo: { label: "Tipo de proyecto", icon: "fa-tags", empty: "(Sin prefijo)" },
  anio: { label: "Año", icon: "fa-calendar", empty: "(Sin año)" },
};

const FILES = {
  kardex: { label: "Kardex final", icon: "fa-book", excel: "2. KARDEX FINAL VAL." },
  materiales: { label: "Materiales HLC", icon: "fa-cubes", excel: "Dashboard de Materiales HLC" },
  almacen: { label: "Almacén central", icon: "fa-warehouse", excel: "DATOS DE ALMACÉN CENTRAL" },
};

/* ---------- Los 8 tableros ----------
   sheet  = sheet_name en Supabase (el mismo que usa index.js)
   dims   = segmentadores [clave, grupo, etiqueta opcional]
   secs   = secciones con sus gráficos [id, ancho, tamaño opcional] y tablas/hallazgos */
const DATASETS = {
  "kf-fv": {
    file: "kardex", sheet: "KF_DETALLE_FV", tab: "Detalle F.V.", engine: "kardex",
    titulo: "Kardex valorizado", icon: "fa-scale-balanced", term: ["recurso", "recursos"],
    dims: [["tipoAlm", "main"], ["almacen", "main", "Descripción almacén"], ["recurso", "main"], ["unidad", "main"], ["estadoInv", "more"]],
    kpis: ["kStock", "kIngreso", "kEgreso", "kSinMov"],
    secs: [
      { k: "resumen", t: "Resumen", icon: "fa-gauge-high", desc: "Stock valorizado, ingresos, egresos y recursos inmovilizados de un vistazo.", kpis: true,
        items: [["kPuente", 6], ["kMovDonut", 6], ["kAlmStock", 6], ["kIniAct", 6], ["xHall", 12]] },
      { k: "almacenes", t: "Almacenes", icon: "fa-warehouse", desc: "Qué almacén concentra el stock, cuánto se movió y dónde está lo inmovilizado.",
        items: [["kIngEgrAlm", 7], ["kTipoAlm", 5], ["kSinMovAlm", 6], ["kVarAlm", 6], ["tAlmK", 12]] },
      { k: "recursos", t: "Recursos", icon: "fa-boxes-stacked", desc: "Los recursos de mayor valor, su rotación y la consistencia de los saldos.",
        items: [["kTopValor", 6], ["kABC", 6], ["kRotRec", 6], ["kControl", 6], ["tRecK", 12]] },
      { k: "detalle", t: "Detalle", icon: "fa-table-list", desc: "Cada línea del kardex con buscador, orden y paginación. Respeta los filtros.", items: [["tDetK", 12]] },
    ],
  },
  "kf-ie": {
    file: "kardex", sheet: "KF_DETALLE_IE", tab: "Detalle I.E.", engine: "mov", hasProv: true,
    titulo: "Ingresos y egresos", icon: "fa-right-left", term: ["recurso", "recursos"],
    dims: [["tipoMov", "main"], ["almacen", "main"], ["mov", "main"], ["mes", "main"], ["tipoAlm", "more", "Tipo almacén"], ["proveedor", "more"], ["partida", "more"], ["recursoN2", "more"], ["destino", "more"]],
    kpis: ["mIng", "mEgr", "mLeadTime", "mGuia"],
    secs: [
      { k: "resumen", t: "Resumen", icon: "fa-gauge-high", desc: "Ingresos, egresos, lead time de compra y registro de guías, con la variación del último mes.", kpis: true,
        items: [["mMes", 8], ["mTipoDonut", 4, "donut"], ["mVarMes", 6], ["mGuiaObs", 6], ["xHall", 12]] },
      { k: "movimientos", t: "Movimientos", icon: "fa-arrows-turn-to-dots", desc: "Monto y cantidad por tipo de movimiento, almacén y destino.",
        items: [["mTipoMonto", 6], ["mTipoCount", 6], ["mAlm", 6], ["mDestino", 6], ["tTipoM", 12], ["tAlmM", 6], ["tMesM", 6]] },
      { k: "compras", t: "Compras y proveedores", icon: "fa-truck-fast", desc: "Quién abastece, cuánto se le compró y cuánto tarda desde la orden hasta la guía.",
        items: [["mProv", 6], ["mLtProv", 6], ["mLtMes", 4], ["mLtDist", 4], ["mDiasOC", 4], ["tProvM", 12]] },
      { k: "recursos", t: "Recursos y partidas", icon: "fa-boxes-stacked", desc: "En qué partidas de control, familias (recurso N2) y recursos se concentra el monto.",
        items: [["mPartida", 6], ["mN2", 6], ["mTopRec", 12, "xl"]] },
      { k: "detalle", t: "Detalle", icon: "fa-table-list", desc: "Cada movimiento con buscador, orden y paginación. Respeta los filtros.", items: [["tDetM", 12]] },
    ],
  },
  "hlc-valo": {
    file: "materiales", sheet: "HLC_VALO_PROYECTOS", tab: "VALO_DET._MATERIALES", engine: "valo",
    titulo: "Valorización por proyecto", icon: "fa-sack-dollar", term: ["proyecto", "proyectos"],
    dims: [["proyecto", "main", "Centro de costos y proyecto"], ["tipo", "main"], ["anio", "main"]],
    kpis: ["vFin", "vEgr", "vIng", "vRot"],
    secs: [
      { k: "resumen", t: "Resumen", icon: "fa-gauge-high", desc: "Stock final, ingresos y egresos del año por centro de costos y proyecto.", kpis: true,
        items: [["vPuente", 6], ["vTipo", 6, "donut"], ["vTopFin", 6], ["vPart", 6], ["xHall", 12]] },
      { k: "proyectos", t: "Proyectos", icon: "fa-diagram-project", desc: "Qué proyecto consume más, cuál acumula stock y cuánto rota cada uno.",
        items: [["vTopEgr", 6], ["vIniFin", 6], ["vVar", 6], ["vRotP", 6], ["tRankV", 12]] },
      { k: "control", t: "Control contable", icon: "fa-clipboard-check", desc: "Stock inicial + ingreso − egreso contra el stock final informado.",
        items: [["vDiff", 6], ["vIngEgr", 6], ["tCtrlV", 12]] },
      { k: "detalle", t: "Detalle", icon: "fa-table-list", desc: "Cada proyecto con sus importes, variación, rotación y validación.", items: [["tDetV", 12]] },
    ],
  },
  "hlc-ie": {
    file: "materiales", sheet: "HLC_ING_EGR", tab: "Ingreso_Egreso_HLC", engine: "mov", hlc: true, hasProv: true,
    titulo: "Movimientos por proyecto", icon: "fa-arrows-turn-to-dots", term: ["recurso", "recursos"],
    dims: [["uneg", "main"], ["proyecto", "main"], ["tipoMov", "main", "Movimiento"], ["mes", "main", "Escala de tiempo"], ["almacen", "more"], ["mov", "more", "Tipo de movimiento"], ["proveedor", "more"], ["recursoN2", "more"], ["tipoAlm", "more"]],
    kpis: ["mIng", "mEgr", "mProyectos", "mGuia"],
    secs: [
      { k: "resumen", t: "Resumen", icon: "fa-gauge-high", desc: "Ingresos y egresos del año por unidad de negocio, proyecto y mes.", kpis: true,
        items: [["mMes", 8], ["mUnegDonut", 4, "donut"], ["mVarMes", 6], ["mGuiaObs", 6], ["xHall", 12]] },
      { k: "proyectos", t: "Unidades y proyectos", icon: "fa-diagram-project", desc: "Monto movido y saldo neto por unidad de negocio y proyecto; transferencias que no netean.",
        items: [["mUneg", 6], ["mProy", 6], ["mProySaldo", 6], ["mTransf", 6], ["tUnegM", 12], ["tProyM", 12]] },
      { k: "movimientos", t: "Movimientos", icon: "fa-right-left", desc: "Tipos de movimiento, almacenes y tipo de almacén.",
        items: [["mTipoMonto", 6], ["mTipoCount", 6], ["mAlm", 6], ["mMovMes", 6], ["mTipoAlm", 6, "donut"], ["tTipoM", 6], ["tAlmM", 6], ["tMesM", 6]] },
      { k: "recursos", t: "Proveedores y recursos", icon: "fa-boxes-stacked", desc: "Proveedores, recursos, familias y destinos con más monto.",
        items: [["mProv", 6], ["mTopRec", 6], ["mN2", 6], ["mPrecio", 6], ["mDestino", 12]] },
      { k: "detalle", t: "Detalle", icon: "fa-table-list", desc: "Cada movimiento con buscador, orden y paginación. Respeta los filtros.", items: [["tDetM", 12]] },
    ],
  },
  "alm-ku": {
    file: "almacen", sheet: "ALM_KARDEX_UNIFICADO", tab: "Kardex Unificado", engine: "kardex",
    titulo: "Kardex unificado", icon: "fa-layer-group", term: ["recurso", "recursos"],
    dims: [["tipoAlm", "main"], ["almacen", "main", "Descripción almacén"], ["recurso", "main"], ["unidad", "main"], ["estadoInv", "more"]],
    kpis: ["kStock", "kInmov", "kObs", "kSinMovN"],
    secs: [
      { k: "resumen", t: "Resumen", icon: "fa-gauge-high", desc: "Stock del almacén central, cuánto está inmovilizado y cuánto es obsoleto.", kpis: true,
        items: [["kPuente", 6], ["kEstadoInv", 6, "donut"], ["kAlmStock", 6], ["kMovDonut", 6, "donut"], ["xHall", 12]] },
      { k: "almacenes", t: "Almacenes", icon: "fa-warehouse", desc: "Movimiento, inmovilizado y participación de cada almacén.",
        items: [["kIngEgrAlm", 7], ["kTipoAlm", 5, "donut"], ["kSinMovAlm", 6], ["kObsAlm", 6], ["tAlmK", 12]] },
      { k: "recursos", t: "Recursos", icon: "fa-boxes-stacked", desc: "Recursos de mayor valor, concentración, rotación y obsoletos más caros.",
        items: [["kTopValor", 6], ["kABC", 6], ["kRotRec", 6], ["kTopObs", 6], ["tTopK", 12]] },
      { k: "control", t: "Control e inmovilizados", icon: "fa-clipboard-check", desc: "Saldos que no cuadran, variación por almacén y qué hacer con lo obsoleto o inmovilizado.",
        items: [["kControl", 6], ["kVarAlm", 6], ["tObsK", 12]] },
      { k: "detalle", t: "Detalle", icon: "fa-table-list", desc: "Cada línea del kardex con buscador, orden y paginación. Respeta los filtros.", items: [["tDetK", 12]] },
    ],
  },
  "alm-km": {
    file: "almacen", sheet: "ALM_KARDEX_MATERIALES", tab: "Kardex Materiales", engine: "kardex",
    titulo: "Kardex de materiales", icon: "fa-box-open", term: ["recurso", "recursos"],
    dims: [["almacen", "main", "Descripción almacén"], ["recurso", "main"], ["unidad", "main"], ["estadoInv", "more"]],
    kpis: ["kStock", "kInmov", "kObs", "kSinMovN"],
    secs: [
      { k: "resumen", t: "Resumen", icon: "fa-gauge-high", desc: "Stock de materiales, inmovilizado y obsoleto de un vistazo.", kpis: true,
        items: [["kPuente", 6], ["kEstadoInv", 6, "donut"], ["kAlmStock", 6], ["kMovDonut", 6, "donut"], ["xHall", 12]] },
      { k: "almacenes", t: "Almacenes", icon: "fa-warehouse", desc: "Ingresos, egresos, inmovilizado y variación por almacén.",
        items: [["kIngEgrAlm", 6], ["kSinMovAlm", 6], ["kObsAlm", 6], ["kVarAlm", 6], ["tAlmK", 12]] },
      { k: "recursos", t: "Recursos", icon: "fa-boxes-stacked", desc: "Materiales de mayor valor, concentración, rotación y obsoletos más caros.",
        items: [["kTopValor", 6], ["kABC", 6], ["kRotRec", 6], ["kTopObs", 6], ["tObsK", 12]] },
      { k: "detalle", t: "Detalle", icon: "fa-table-list", desc: "Cada línea del kardex con buscador, orden y paginación. Respeta los filtros.", items: [["tDetK", 12]] },
    ],
  },
  "alm-ka": {
    file: "almacen", sheet: "ALM_KARDEX_ACTIVOS", tab: "Kardex Activos y Tenencias", engine: "kardex", activos: true,
    titulo: "Activos y tenencias", icon: "fa-screwdriver-wrench", term: ["activo", "activos"],
    dims: [["almacen", "main", "Descripción almacén"], ["recurso", "main"], ["unidad", "main"], ["grupo", "more"], ["estadoInv", "more"]],
    kpis: ["kStock", "kIngresoA", "kSinMov", "kTenencias"],
    secs: [
      { k: "resumen", t: "Resumen", icon: "fa-gauge-high", desc: "Valor de tenencias y activos fijos, ingresos del período y activos sin movimiento.", kpis: true,
        items: [["kGrupo", 6, "donut"], ["kPuente", 6], ["kAlmStock", 6], ["kMovDonut", 6, "donut"], ["xHall", 12]] },
      { k: "almacenes", t: "Almacenes y grupos", icon: "fa-warehouse", desc: "Movimiento por grupo de activo y por almacén.",
        items: [["kGrupoMov", 6], ["kIngEgrAlm", 6], ["kSinMovAlm", 6], ["kVarAlm", 6], ["tAlmK", 12]] },
      { k: "recursos", t: "Activos", icon: "fa-screwdriver-wrench", desc: "Activos de mayor valor, concentración, rotación y validación de saldos.",
        items: [["kTopValor", 6], ["kABC", 6], ["kRotRec", 6], ["kControl", 6], ["tTopA", 12]] },
      { k: "detalle", t: "Detalle", icon: "fa-table-list", desc: "Cada línea del kardex con buscador, orden y paginación. Respeta los filtros.", items: [["tDetK", 12]] },
    ],
  },
  "alm-ie": {
    file: "almacen", sheet: "ALM_DETALLE_IE", tab: "Detalle I.E.", engine: "mov",
    titulo: "Movimientos de activos", icon: "fa-dolly", term: ["recurso", "recursos"],
    dims: [["tipoMov", "main"], ["almacen", "main"], ["mov", "main"], ["mes", "main"], ["tipoAlm", "more", "Tipo almacén"], ["destino", "more"], ["recursoN2", "more"], ["registra", "more"], ["solicitante", "more"]],
    kpis: ["mIng", "mEgr", "mTotal", "mGuia"],
    secs: [
      { k: "resumen", t: "Resumen", icon: "fa-gauge-high", desc: "Ingresos, egresos y registro de guías de activos y tenencias.", kpis: true,
        items: [["mMes", 8], ["mTipoDonut", 4, "donut"], ["mTipoCount", 6], ["mGuiaObs", 6], ["xHall", 12]] },
      { k: "movimientos", t: "Movimientos", icon: "fa-right-left", desc: "Tipos de movimiento, almacenes, evolución y transferencias que no netean.",
        items: [["mTipoMonto", 6], ["mAlm", 6], ["mMovMes", 6], ["mVarMes", 6], ["mTransf", 12], ["tTipoM", 12], ["tAlmM", 6], ["tMesM", 6]] },
      { k: "destinos", t: "Destinos y personas", icon: "fa-people-arrows", desc: "A dónde va cada activo, quién registra las guías y quién pide.",
        items: [["mDestino", 6], ["mRegistra", 6], ["mSolic", 6], ["mN2", 6], ["mTopRec", 12, "xl"], ["tDestM", 6], ["tN2M", 6]] },
      { k: "detalle", t: "Detalle", icon: "fa-table-list", desc: "Cada movimiento con buscador, orden y paginación. Respeta los filtros.", items: [["tDetM", 12]] },
    ],
  },
};
const DS_KEYS = Object.keys(DATASETS);
DS_KEYS.forEach((k) => { DATASETS[k].key = k; });
const dsOf = (sheet) => DS_KEYS.find((k) => DATASETS[k].sheet === sheet);

/* =========================== ESTADO =========================== */
// Lo que depende del tablero se guarda en STORE[clave] y se copia a `state` al cambiar de tablero
const DS_FIELDS = ["payload", "filas", "dims", "rango", "filtros", "seccion", "signature", "uploadedAt", "sort", "page", "q", "moreOpen"];
const nuevoStore = () => ({ payload: null, filas: [], dims: {}, rango: { min: "", max: "" }, filtros: { desde: "", hasta: "" }, seccion: "", signature: null, uploadedAt: null, sort: {}, page: {}, q: {}, moreOpen: false });
const STORE = Object.fromEntries(DS_KEYS.map((k) => [k, nuevoStore()]));
const PUB = {};   // último estado publicado por tablero: { row_index, meta }

const state = {
  ds: DS_KEYS[0],
  ...nuevoStore(),
  vista: [],
  d: null,
  lastSync: null,
  loading: null,
  error: null,
  tk: null,
};
const charts = {};
const outs = {};
const tables = {};
const DS = () => DATASETS[state.ds];
const ENG = () => ENGINES[DS().engine];

/* =========================== UTILIDADES =========================== */
const $ = (id) => document.getElementById(id);
const NF = {};
const fmt = (v, d = 0) => (NF[d] || (NF[d] = new Intl.NumberFormat("es-PE", { maximumFractionDigits: d, minimumFractionDigits: d }))).format(Number(v || 0));
const compactNF = new Intl.NumberFormat("es-PE", { notation: "compact", maximumFractionDigits: 1 });
const fmtS = (v) => "S/ " + fmt(v, 0);                 // soles sin decimales (tarjetas, gráficos)
const fmtS2 = (v) => "S/ " + fmt(v, 2);                // soles con céntimos (tablas)
const fmtSC = (v) => "S/ " + compactNF.format(Number(v || 0));
const fmtD = (v) => fmt(v, 1) + " días";
const fmtPct = (v, d = 1) => fmt(v, d) + " %";
const fmtC = (v) => compactNF.format(Number(v || 0));
const fmtX = (v) => (v == null ? "—" : fmt(v, 2) + "×");
const signo = (v, f = fmtS) => (v > 0 ? "+" : v < 0 ? "−" : "") + f(Math.abs(v));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cell = (v, f) => ({ v, f: f ? f(v) : v });
const slug = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const fold2 = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const maxBy = (arr, k) => arr.reduce((a, b) => (b[k] > a[k] ? b : a), arr[0]);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const trunc = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const nOpt = (d = 0) => (v) => (v == null ? "—" : fmt(v, d));
const pOpt = (v) => (v == null ? "—" : fmt(v, 1));
const si = (b) => (b ? "Sí" : "—");
const vacio = (s) => !s || String(s).startsWith("(");

function rgba(hex, a) {
  const h = String(hex).trim().replace("#", "");
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function isObj(x) { return x && typeof x === "object" && !Array.isArray(x) && !(x instanceof Function); }
function merge(target, ...srcs) {
  srcs.forEach((src) => {
    Object.keys(src || {}).forEach((k) => {
      if (isObj(src[k]) && isObj(target[k])) merge(target[k], src[k]);
      else target[k] = src[k];
    });
  });
  return target;
}
function relTime(date) {
  if (!date) return "—";
  const s = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (isNaN(s)) return "—";
  if (s < 10) return "recién";
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return new Date(date).toLocaleDateString("es-PE", { day: "2-digit", month: "short" });
}
function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const g = (n) => cs.getPropertyValue(n).trim();
  const series = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => g(`--series-${i}`));
  return {
    ink: g("--ink"), ink2: g("--ink-2"), ink3: g("--ink-3"), line: g("--line"), lineStrong: g("--line-strong"),
    grid: g("--grid"), surface: g("--surface"), brand: g("--brand"), series,
    neutral: g("--series-neutral"), good: g("--good"), warn: g("--warn"), crit: g("--crit"),
    // Colores fijos de significado en todo el dashboard
    stock: series[0], ing: series[2], egr: series[1],
  };
}

/* ---------- Fechas ---------- */
const parseISO = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
const fmtDia = (iso) => { if (!iso) return "—"; const d = parseISO(iso); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; };
const fdia = (v) => (v ? fmtDia(v) + "/" + v.slice(2, 4) : "—");
const fmtDiaLargo = (iso) => { if (!iso) return "—"; const d = parseISO(iso); return `${DIA_CORTO[d.getDay()]} ${d.getDate()} ${MES_CORTO[d.getMonth()]} ${d.getFullYear()}`; };
const diasEntre = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
const mesLabel = (key, multi) => { const [y, m] = key.split("-").map(Number); const n = MESES[m - 1]; return n ? (multi ? `${MES_CORTO[m - 1]} ${y}` : n.charAt(0).toUpperCase() + n.slice(1)) : key; };
function lunesDe(iso) { const d = parseISO(iso); const day = d.getDay() || 7; d.setDate(d.getDate() - day + 1); return toISO(d); }

/* =========================== DATOS: DECODIFICACIÓN =========================== */
// El payload llega comprimido (data.z = gzip + base64) o en columnas planas (data.enc)
async function descomprimir(data) {
  if (data.enc) return data.enc;
  if (!data.z) return null;
  if (typeof DecompressionStream === "undefined") throw new Error("Este navegador no puede leer datos comprimidos. Actualizalo (Chrome, Edge, Firefox o Safari recientes).");
  const bin = atob(data.z);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}
function decodificar(e) {
  if (!e || !e.n) return [];
  const D = e.dicts, C = e.cols, n = e.n;
  const dictF = Object.keys(D), numF = Object.keys(C).filter((f) => !(f in D));
  const filas = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = {};
    for (const f of dictF) r[f] = D[f][C[f][i]] ?? "";
    for (const f of numF) r[f] = C[f][i] == null ? null : Number(C[f][i]);
    filas[i] = r;
  }
  return filas;
}

/* =========================== DIMENSIONES =========================== */
const dimDef = (k) => {
  const x = DS().dims.find((d) => d[0] === k);
  return x ? { ...DIMCAT[k], group: x[1], label: x[2] || DIMCAT[k].label } : DIMCAT[k] ? { ...DIMCAT[k], group: "" } : null;
};
const FILTER_KEYS = () => DS().dims.map((d) => d[0]);
const EXTRA_LABEL = { codigo: "Recurso", set: "Selección", flag: "Control", mesKey: "Mes", item: "Ítem", _movCat: "Movimiento del período", _ltBin: "Lead time de compra", _docBin: "Días aprobación → entrega OC", transf: "Transferencias", _nombre: "Recurso" };
const dimLabel = (k) => (dimDef(k) ? dimDef(k).label : EXTRA_LABEL[k] || k);
const term = (i = 1, cap = false) => { const s = DS().term[i]; return cap ? s.charAt(0).toUpperCase() + s.slice(1) : s; };

function rellenarDims(r, keys) {
  for (const k of keys) if (!r[k]) r[k] = (DIMCAT[k] && DIMCAT[k].empty) || "(Sin dato)";
}
function calcDims(filas) {
  const porTexto = (a, b) => (a.startsWith("(") ? 1 : b.startsWith("(") ? -1 : a.localeCompare(b, "es", { numeric: true, sensitivity: "base" }));
  const out = {};
  const keys = new Set([...FILTER_KEYS(), "almacen", "tipoAlm", "grupo", "estadoInv", "mov", "tipoMov", "uneg", "recursoN2", "tipo"]);
  keys.forEach((k) => {
    if (!filas.length || !(k in filas[0])) { out[k] = []; return; }
    const vals = Array.from(new Set(filas.map((r) => r[k])));
    if (DIMCAT[k] && DIMCAT[k].sort === "mes") {
      const key = new Map(filas.map((r) => [r.mes, r._m || "9999"]));
      out[k] = vals.sort((a, b) => (key.get(a) < key.get(b) ? -1 : 1));
    } else out[k] = vals.sort(porTexto);
  });
  out.fechas = Array.from(new Set(filas.map((r) => r.fecha).filter(Boolean))).sort();
  return out;
}

/* =========================== AGREGACIÓN GENÉRICA =========================== */
function groupBy(rows, fn) {
  const m = new Map();
  for (const r of rows) { const k = fn(r); let a = m.get(k); if (!a) { a = []; m.set(k, a); } a.push(r); }
  return m;
}
function porDim(rows, dim, sortKey = "n") {
  const agg = ENG().agg;
  return Array.from(groupBy(rows, (r) => r[dim]).entries())
    .map(([label, v]) => ({ label, ...agg(v), _rows: v }))
    .sort((a, b) => b[sortKey] - a[sortKey]);
}
function porMes(rows) {
  const agg = ENG().agg;
  return Array.from(groupBy(rows.filter((r) => r._m), (r) => r._m).entries())
    .map(([key, v]) => ({ key, label: v[0].mes, short: MES_CORTO[+key.slice(5, 7) - 1] || key, ...agg(v), _rows: v }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
}
// Una fila por recurso (código), con sus totales en todos los almacenes
function porRecurso(rows, sortKey) {
  const agg = ENG().agg;
  return Array.from(groupBy(rows, (r) => r._id).entries()).map(([id, v]) => {
    const f = v[0];
    const alms = Array.from(new Set(v.map((r) => r.almacen).filter((a) => !vacio(a))));
    return { label: id, nombre: f._nombre, codigo: f.codigo, unidad: f.unidad, almacenes: alms, almTxt: alms.join(", "), ...agg(v), _rows: v };
  }).sort((a, b) => b[sortKey] - a[sortKey]);
}
// Propiedades que se calculan solo si un gráfico las pide
function lazy(obj, defs) {
  Object.keys(defs).forEach((k) => {
    let val, done = false;
    Object.defineProperty(obj, k, { enumerable: true, get() { if (!done) { val = defs[k](); done = true; } return val; } });
  });
  return obj;
}

function filtrar(rows, f, except) {
  const usaFecha = except !== "fecha" && (f.desde || f.hasta);
  const dims = FILTER_KEYS().filter((k) => k !== except && f[k]);
  if (!usaFecha && !dims.length) return rows;
  return rows.filter((r) => {
    if (usaFecha && (!r.fecha || (f.desde && r.fecha < f.desde) || (f.hasta && r.fecha > f.hasta))) return false;
    for (const k of dims) if (r[k] !== f[k]) return false;
    return true;
  });
}
function matchCond(r, c) {
  if (c.dim === "codigo") return r._id === c.value;
  if (c.dim === "set") return c.value.includes(r._id);
  if (c.dim === "flag") return !!(r._f && r._f[c.value]);
  if (c.dim === "mesKey") return r._m === c.value;
  if (c.dim === "transf") return r._transf;
  return r[c.dim] === c.value;
}

/* Color por entidad (no por ranking): un filtro nunca repinta a los que quedan */
function colorOf(dim, value, t) {
  if (value === "Otros" || vacio(value)) return t.neutral;
  const list = (state.dims[dim] || []).filter((x) => !vacio(x));
  const i = list.indexOf(value);
  return i < 0 ? t.neutral : t.series[i % t.series.length];
}
function fold(list, max = 7, keys = []) {
  if (list.length <= max + 1) return list;
  const top = list.slice(0, max), rest = list.slice(max);
  const otros = { label: "Otros", _otros: rest.map((r) => r.label) };
  keys.forEach((k) => { otros[k] = rest.reduce((a, r) => a + (r[k] || 0), 0); });
  return [...top, otros];
}
const pctDe = (a, b) => (b ? (a / b) * 100 : null);

/* =========================== MOTOR 1 · KARDEX =========================== */
const KFLAGS = [
  { k: "fisico", label: "Saldo físico no cuadra", how: "Stock inicial + cantidad ingreso − cantidad egreso ≠ stock actual" },
  { k: "valor", label: "Saldo valorizado no cuadra", how: "Stock inicial (S/) + ingreso (S/) − egreso (S/) ≠ stock actual (S/)" },
  { k: "ceroConValor", label: "Stock 0 con valor", how: "Stock actual en 0 pero con valor en soles" },
  { k: "stockSinValor", label: "Stock sin valor", how: "Hay unidades en stock pero el valor es 0 o negativo" },
  { k: "negativo", label: "Saldo negativo", how: "Stock actual o valor actual negativos" },
];
function grupoActivo(alm) {
  const g = CONFIG.GRUPOS_ACTIVO.find(([re]) => re.test(alm || ""));
  return g ? g[1] : alm || "(Sin almacén)";
}
const ESTADOS_INV = ["Con movimiento", "Inmovilizado (sin movimiento)", "Obsoleto / vencido"];

const ENGINE_KARDEX = {
  prep(filas, meta, ds) {
    const keys = [...FILTER_KEYS(), "almacen", "tipoAlm", "unidad", "recurso"];
    filas.forEach((r) => {
      ["sIni", "cIng", "cEgr", "sAct", "vIni", "vIng", "vEgr", "vAct"].forEach((f) => { r[f] = r[f] || 0; });
      r._id = r.codigo || r.recurso || "(Sin código)";
      r._nombre = r.recurso || r.codigo || "(Sin nombre)";
      r._var = r.vAct - r.vIni;
      r._vu = r.sAct ? r.vAct / r.sAct : null;
      const prom = (r.vIni + r.vAct) / 2;
      r._rot = prom >= CONFIG.ROT_MIN_PROM ? r.vEgr / prom : null;
      r._sinMov = !r.cIng && !r.cEgr;
      r._obs = CONFIG.OBSOLETO.test(r.almacen || "");
      r.estadoInv = r._obs ? ESTADOS_INV[2] : r._sinMov ? ESTADOS_INV[1] : ESTADOS_INV[0];
      r._movCat = r.cIng > 0 && r.cEgr > 0 ? "Con ingreso y egreso" : r.cIng > 0 ? "Solo ingreso" : r.cEgr > 0 ? "Solo egreso" : "Sin movimiento";
      if (ds.activos) r.grupo = grupoActivo(r.almacen);
      const f = {};
      f.fisico = Math.abs(r.sIni + r.cIng - r.cEgr - r.sAct) > CONFIG.TOL_CANT;
      f.valor = Math.abs(r.vIni + r.vIng - r.vEgr - r.vAct) > CONFIG.TOL_VALOR;
      f.ceroConValor = Math.abs(r.sAct) < 1e-9 && Math.abs(r.vAct) > CONFIG.TOL_VALOR;
      f.stockSinValor = r.sAct > 0 && r.vAct <= 0;
      f.negativo = r.sAct < 0 || r.vAct < -CONFIG.TOL_VALOR;
      r._f = f;
      r._issues = KFLAGS.filter((x) => f[x.k]).length;
      rellenarDims(r, keys);
    });
    return filas;
  },
  agg(rows) {
    let sIni = 0, cIng = 0, cEgr = 0, sAct = 0, vIni = 0, vIng = 0, vEgr = 0, vAct = 0;
    let sinMov = 0, vSinMov = 0, nObs = 0, vObs = 0, conIng = 0, conEgr = 0, ambos = 0, soloIng = 0, soloEgr = 0, issues = 0, rotS = 0, rotN = 0;
    const ids = new Set(), alms = new Set();
    for (const r of rows) {
      sIni += r.sIni; cIng += r.cIng; cEgr += r.cEgr; sAct += r.sAct; vIni += r.vIni; vIng += r.vIng; vEgr += r.vEgr; vAct += r.vAct;
      if (r._sinMov) { sinMov++; vSinMov += r.vAct; }
      if (r._obs) { nObs++; vObs += r.vAct; }
      const i = r.cIng > 0, e = r.cEgr > 0;
      if (i) conIng++; if (e) conEgr++;
      if (i && e) ambos++; else if (i) soloIng++; else if (e) soloEgr++;
      if (r._issues) issues++;
      if (r._rot != null) { rotS += r._rot; rotN++; }
      ids.add(r._id); alms.add(r.almacen);
    }
    const n = rows.length, prom = (vIni + vAct) / 2;
    return {
      n, sIni, cIng, cEgr, sAct, vIni, vIng, vEgr, vAct,
      var: vAct - vIni, pctVar: pctDe(vAct - vIni, vIni), vu: sAct ? vAct / sAct : null,
      rot: prom >= CONFIG.ROT_MIN_PROM ? vEgr / prom : null, rotProm: rotN ? rotS / rotN : null, pctEgrIng: pctDe(vEgr, vIng),
      sinMov, pctSinMov: pctDe(sinMov, n) || 0, vSinMov, pctInmov: pctDe(vSinMov, vAct) || 0,
      nObs, vObs, pctObs: pctDe(vObs, vAct) || 0,
      conIng, conEgr, ambos, soloIng, soloEgr, issues,
      recursos: ids.size, almacenes: alms.size,
    };
  },
  calc(v, filas) {
    const ds = DS();
    const flags = Object.fromEntries(KFLAGS.map((x) => [x.k, 0]));
    v.forEach((r) => { for (const x of KFLAGS) if (r._f[x.k]) flags[x.k]++; });
    return lazy({ k: this.agg(v), flags }, {
      alm: () => porDim(v, "almacen", "vAct"),
      tipoAlm: () => porDim(v, "tipoAlm", "vAct"),
      grupo: () => (ds.activos ? porDim(v, "grupo", "vAct") : []),
      estado: () => porDim(v, "estadoInv", "vAct"),
      rec: () => porRecurso(v, "vAct"),
      obsRec: () => porRecurso(v.filter((r) => r._obs), "vAct"),
    });
  },
  drillMini(k) {
    return [
      ["Líneas del kardex", fmt(k.n)], [term(1, true) + " distintos", fmt(k.recursos)],
      ["Stock inicial", fmtS(k.vIni)], ["Stock actual", fmtS(k.vAct)],
      ["Ingreso", fmtS(k.vIng)], ["Egreso", fmtS(k.vEgr)],
      ["Variación", `${signo(k.var)}${k.pctVar != null ? ` (${signo(k.pctVar, (x) => fmt(x, 1) + " %")})` : ""}`], ["Rotación", fmtX(k.rot)],
      ["Sin movimiento", `${fmt(k.sinMov)} · ${fmtPct(k.pctSinMov)}`], ["Inmovilizado", fmtS(k.vSinMov)],
    ];
  },
  shareKey: "vAct",
  drillDims: [["almacen", "Almacén"], ["tipoAlm", "Tipo de almacén"], ["grupo", "Grupo"], ["estadoInv", "Estado"], ["_nombre", "Recurso"], ["unidad", "Unidad"]],
  drillCols: (x) => [["Líneas", x.n, fmt, 1], ["Stock S/", x.vAct, fmtS], ["Ingreso S/", x.vIng, fmtS], ["Egreso S/", x.vEgr, fmtS]],
};

/* =========================== MOTOR 2 · MOVIMIENTOS =========================== */
const ENGINE_MOV = {
  prep(filas, meta, ds) {
    const keys = [...FILTER_KEYS(), "almacen", "mov", "tipoMov", "proveedor", "destino", "recursoN2", "partida", "registra", "solicitante", "uneg", "proyecto", "tipoAlm"];
    const años = new Set(filas.map((r) => (r.mes || r.fecha || "").slice(0, 4)).filter(Boolean));
    const multi = años.size > 1;
    const descs = new Map();
    filas.forEach((r) => {
      r._m = r.mes || (r.fecha ? r.fecha.slice(0, 7) : "");
      r.mes = r._m ? mesLabel(r._m, multi) : "";
      const src = ds.hlc ? (r.dirTxt || r.mov) : (r.tipoMov || r.mov);
      r._ing = /^\s*i/i.test(src || "");
      r.tipoMov = ds.hlc ? (r._ing ? "Ingreso" : "Egreso") : (r.tipoMov || (r._ing ? "INGRESOS" : "EGRESOS"));
      r._monto = Math.abs(r.monto || 0);
      r._cant = Math.abs(r.cant || 0);
      r._guia = !!r.guia;
      r._obsv = !!r.obs;
      r._lt = r._ing && r.fechaOrden && r.fecha ? diasEntre(r.fechaOrden, r.fecha) : null;
      r._ltNeg = r._lt != null && r._lt < 0;
      if (r._ltNeg) r._lt = null;
      r._doc = r.fechaAprOC && r.fechaEntOC ? diasEntre(r.fechaAprOC, r.fechaEntOC) : null;
      if (r._doc != null && r._doc < 0) r._doc = null;
      r._ltBin = rangoDe(r._lt);
      r._docBin = rangoDe(r._doc);
      r._transf = CONFIG.TRANSF.test(r.mov || "") || CONFIG.TRANSF.test(r.movDesc || "");
      r._id = r.codigo || r.recurso || "(Sin código)";
      r._nombre = r.recurso || r.codigo || "(Sin nombre)";
      if (r.mov && r.movDesc && !descs.has(r.mov)) descs.set(r.mov, r.movDesc);
      rellenarDims(r, keys);
    });
    state.movDesc = descs;
    return filas;
  },
  agg(rows) {
    let nIng = 0, nEgr = 0, ing = 0, egr = 0, cant = 0, pS = 0, pN = 0, guia = 0, obs = 0, ltS = 0, ltN = 0, ltMax = 0, lt30 = 0, ltNeg = 0, ocS = 0, ocN = 0;
    let tIng = 0, tEgr = 0, nTransf = 0;
    const ids = new Set(), provs = new Set(), proys = new Set(), unegs = new Set(), alms = new Set();
    for (const r of rows) {
      if (r._ing) { nIng++; ing += r._monto; } else { nEgr++; egr += r._monto; }
      cant += r._cant;
      if (r.precio > 0) { pS += r.precio; pN++; }
      if (r._guia) guia++;
      if (r._obsv) obs++;
      if (r._lt != null) { ltS += r._lt; ltN++; if (r._lt > ltMax) ltMax = r._lt; if (r._lt > CONFIG.LT_LIMITE) lt30++; }
      if (r._ltNeg) ltNeg++;
      if (r._doc != null) { ocS += r._doc; ocN++; }
      if (r._transf) { nTransf++; if (r._ing) tIng += r._monto; else tEgr += r._monto; }
      ids.add(r._id);
      if (!vacio(r.proveedor)) provs.add(r.proveedor);
      if (!vacio(r.proyecto)) proys.add(r.proyecto);
      if (!vacio(r.uneg)) unegs.add(r.uneg);
      alms.add(r.almacen);
    }
    const n = rows.length;
    return {
      n, nIng, nEgr, ing, egr, monto: ing + egr, neto: ing - egr, cant, precioProm: pN ? pS / pN : 0,
      guia, pctGuia: pctDe(guia, n) || 0, sinGuia: n - guia, obs, pctObs: pctDe(obs, n) || 0, sinObs: n - obs,
      ltProm: ltN ? ltS / ltN : null, ltN, ltMax, lt30, pctLt30: pctDe(lt30, ltN) || 0, ltNeg, ocProm: ocN ? ocS / ocN : null, ocN,
      nTransf, tIng, tEgr, tNeto: tIng - tEgr,
      recursos: ids.size, proveedores: provs.size, proyectos: proys.size, unegs: unegs.size, almacenes: alms.size,
    };
  },
  calc(v, filas) {
    const sinTiempo = filtrar(filas, { ...state.filtros, mes: "" }, "fecha");
    const conProv = () => v.filter((r) => !vacio(r.proveedor));
    return lazy({ k: this.agg(v) }, {
      meses: () => porMes(v),
      tendencia: () => porMes(sinTiempo),
      tipo: () => porDim(v, "mov", "monto").map((x) => ({ ...x, desc: state.movDesc.get(x.label) || "" })),
      alm: () => porDim(v, "almacen", "monto"),
      prov: () => porDim(conProv(), "proveedor", "monto"),
      destino: () => porDim(v, "destino", "monto"),
      registra: () => porDim(v, "registra", "n"),
      solic: () => porDim(v, "solicitante", "n"),
      partida: () => porDim(v, "partida", "monto"),
      n2: () => porDim(v, "recursoN2", "monto"),
      uneg: () => porDim(v, "uneg", "monto"),
      proy: () => porDim(v, "proyecto", "monto"),
      tipoAlm: () => porDim(v, "tipoAlm", "monto"),
      rec: () => porRecurso(v, "monto"),
    });
  },
  drillMini(k) {
    return [
      ["Movimientos", fmt(k.n)], [term(1, true) + " distintos", fmt(k.recursos)],
      ["Ingresos", `${fmtS(k.ing)} · ${fmt(k.nIng)}`], ["Egresos", `${fmtS(k.egr)} · ${fmt(k.nEgr)}`],
      ["Saldo neto", signo(k.neto)], ["Precio promedio", "S/ " + fmt(k.precioProm, 2)],
      ["Con guía", fmtPct(k.pctGuia)], ["Con observación", fmtPct(k.pctObs)],
      ["Lead time compra", k.ltProm != null ? fmtD(k.ltProm) : "—"], ["Proveedores", fmt(k.proveedores)],
    ];
  },
  shareKey: "monto",
  drillDims: [["mes", "Mes"], ["mov", "Movimiento"], ["almacen", "Almacén"], ["proyecto", "Proyecto"], ["proveedor", "Proveedor"], ["destino", "Destino"], ["_nombre", "Recurso"]],
  drillCols: (x) => [["Movs.", x.n, fmt, 1], ["Ingresos S/", x.ing, fmtS], ["Egresos S/", x.egr, fmtS]],
};

/* =========================== MOTOR 3 · VALORIZACIÓN POR PROYECTO =========================== */
const ENGINE_VALO = {
  prep(filas, meta) {
    filas.forEach((r) => {
      ["vIni", "vIng", "vEgr", "vFin"].forEach((f) => { r[f] = r[f] || 0; });
      const m = String(r.proyecto || "").trim().match(/^([A-Za-z]{2,3})(?=[\s\-_.]*\d)/);
      r.tipo = m ? m[1].toUpperCase() : "";
      r.anio = r.anio || (meta && meta.anio) || "";
      r._id = r.proyecto;
      r._nombre = r.proyecto;
      r._var = r.vFin - r.vIni;
      r._pctVar = r.vIni ? (r._var / r.vIni) * 100 : null;
      const prom = (r.vIni + r.vFin) / 2;
      r._rot = prom >= CONFIG.ROT_MIN_PROM ? r.vEgr / prom : null;
      r._calc = r.vIni + r.vIng - r.vEgr;
      r._diff = r.vFin - r._calc;
      r._ok = Math.abs(r._diff) <= CONFIG.TOL_VALOR;
      r._sinMov = !r.vIng && !r.vEgr;
      r._f = { diff: !r._ok };
      rellenarDims(r, ["proyecto", "tipo", "anio"]);
    });
    return filas;
  },
  agg(rows) {
    let vIni = 0, vIng = 0, vEgr = 0, vFin = 0, finMayor = 0, egrMayor = 0, sinMov = 0, conIng = 0, nDiff = 0, diffAbs = 0, rotS = 0, rotN = 0;
    for (const r of rows) {
      vIni += r.vIni; vIng += r.vIng; vEgr += r.vEgr; vFin += r.vFin;
      if (r.vFin > r.vIni) finMayor++;
      if (r.vEgr > r.vIng) egrMayor++;
      if (r._sinMov) sinMov++;
      if (r.vIng > 0) conIng++;
      if (!r._ok) { nDiff++; diffAbs += Math.abs(r._diff); }
      if (r._rot != null) { rotS += r._rot; rotN++; }
    }
    const n = rows.length, prom = (vIni + vFin) / 2;
    return {
      n, proyectos: n, vIni, vIng, vEgr, vFin, var: vFin - vIni, pctVar: pctDe(vFin - vIni, vIni),
      rot: prom >= CONFIG.ROT_MIN_PROM ? vEgr / prom : null, rotProm: rotN ? rotS / rotN : null, pctEgrIng: pctDe(vEgr, vIng),
      finMayor, egrMayor, sinMov, conIng, nDiff, diffAbs, calc: vIni + vIng - vEgr, diff: vFin - (vIni + vIng - vEgr),
    };
  },
  calc(v) {
    return lazy({ k: this.agg(v) }, {
      proy: () => porDim(v, "proyecto", "vFin"),
      tipo: () => porDim(v, "tipo", "vFin"),
    });
  },
  drillMini(k) {
    return [
      ["Proyectos", fmt(k.n)], ["Rotación", fmtX(k.rot)],
      ["Stock inicial", fmtS(k.vIni)], ["Stock final", fmtS(k.vFin)],
      ["Ingreso", fmtS(k.vIng)], ["Egreso", fmtS(k.vEgr)],
      ["Variación", signo(k.var)], ["% egreso / ingreso", k.pctEgrIng != null ? fmtPct(k.pctEgrIng) : "—"],
      ["Sin movimiento", fmt(k.sinMov)], ["Con diferencia", fmt(k.nDiff)],
    ];
  },
  shareKey: "vFin",
  drillDims: [["tipo", "Tipo de proyecto"], ["proyecto", "Proyecto"]],
  drillCols: (x) => [["Proy.", x.n, fmt, 1], ["Stock final S/", x.vFin, fmtS], ["Egreso S/", x.vEgr, fmtS]],
};

const ENGINES = { kardex: ENGINE_KARDEX, mov: ENGINE_MOV, valo: ENGINE_VALO };
/* =========================== CHART.JS: PLUGINS =========================== */
const bgPlugin = {
  id: "coreBg",
  beforeDraw(chart) {
    const { ctx, width, height } = chart;
    ctx.save(); ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = (state.tk && state.tk.surface) || "#fff";
    ctx.fillRect(0, 0, width, height); ctx.restore();
  },
};
const crossPlugin = {
  id: "coreCross",
  afterDatasetsDraw(chart, _a, opts) {
    if (!opts || !opts.enabled) return;
    const act = chart.tooltip && chart.tooltip.getActiveElements ? chart.tooltip.getActiveElements() : [];
    if (!act.length) return;
    const x = act[0].element.x, a = chart.chartArea, ctx = chart.ctx;
    ctx.save(); ctx.strokeStyle = state.tk.lineStrong; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke(); ctx.restore();
  },
};
const refPlugin = {
  id: "coreRef",
  afterDatasetsDraw(chart, _a, opts) {
    if (!opts || !Array.isArray(opts.lines)) return;
    const { ctx, chartArea: a } = chart;
    opts.lines.forEach((l) => {
      const sc = chart.scales[l.axis || "y"];
      if (!sc || l.value == null || !isFinite(l.value)) return;
      const p = sc.getPixelForValue(l.value);
      const vertical = sc.axis === "x";
      if (vertical ? (p < a.left - 1 || p > a.right + 1) : (p < a.top - 1 || p > a.bottom + 1)) return;
      ctx.save();
      ctx.strokeStyle = l.color || state.tk.ink3; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.beginPath();
      if (vertical) { ctx.moveTo(p, a.top); ctx.lineTo(p, a.bottom); } else { ctx.moveTo(a.left, p); ctx.lineTo(a.right, p); }
      ctx.stroke(); ctx.setLineDash([]);
      if (l.label) {
        ctx.font = "600 11px 'Instrument Sans', system-ui, sans-serif";
        const w = ctx.measureText(l.label).width + 12;
        const x = vertical ? Math.min(p + 4, a.right - w) : a.right - w;
        const y = vertical ? a.top : p - 20;
        ctx.fillStyle = state.tk.surface; ctx.globalAlpha = 0.92;
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, 18, 5) : ctx.rect(x, y, w, 18); ctx.fill();
        ctx.globalAlpha = 1; ctx.fillStyle = state.tk.ink2; ctx.textBaseline = "middle";
        ctx.fillText(l.label, x + 6, y + 9);
      }
      ctx.restore();
    });
  },
};
const centerPlugin = {
  id: "coreCenter",
  afterDraw(chart, _a, opts) {
    if (!opts || !opts.title) return;
    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data || !meta.data[0]) return;
    const { x, y } = meta.data[0];
    const ctx = chart.ctx;
    ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = state.tk.ink; ctx.font = "700 19px 'Bricolage Grotesque', system-ui, sans-serif";
    ctx.fillText(opts.title, x, y - 8);
    ctx.fillStyle = state.tk.ink3; ctx.font = "500 11px 'Instrument Sans', system-ui, sans-serif";
    ctx.fillText(opts.sub || "", x, y + 13);
    ctx.restore();
  },
};

/* =========================== CHART.JS: FÁBRICAS =========================== */
function setupChartDefaults() {
  Chart.register(ChartDataLabels, bgPlugin, crossPlugin, refPlugin, centerPlugin);
  Chart.defaults.font.family = "'Instrument Sans', system-ui, sans-serif";
  Chart.defaults.font.size = 11.5;
  Chart.defaults.plugins.datalabels.display = false;
  Chart.defaults.plugins.legend.display = false;
  if (REDUCED) Chart.defaults.animation = false;
}

function tooltipCfg(t) {
  return {
    backgroundColor: t.surface, titleColor: t.ink, bodyColor: t.ink2, footerColor: t.ink,
    borderColor: t.lineStrong, borderWidth: 1, padding: 12, cornerRadius: 10, caretSize: 6,
    titleFont: { weight: "700", size: 12.5 }, bodyFont: { size: 12 }, footerFont: { weight: "600", size: 12 },
    boxWidth: 9, boxHeight: 9, boxPadding: 5, usePointStyle: true, displayColors: true,
  };
}
function legendCfg(t, show) {
  return {
    display: !!show, position: "bottom", align: "start",
    labels: { color: t.ink2, usePointStyle: true, pointStyle: "circle", boxWidth: 8, boxHeight: 8, padding: 16, font: { size: 12 } },
  };
}
function baseOptions(t, o = {}) {
  const fmtAxis = o.axisFmt || ((v) => fmt(v));
  const valueAxis = {
    beginAtZero: o.min == null, min: o.min, max: o.max, suggestedMax: o.suggestedMax, suggestedMin: o.suggestedMin, stacked: !!o.stacked,
    grid: { color: t.grid, drawTicks: false }, border: { display: false },
    ticks: { color: t.ink3, padding: 8, maxTicksLimit: 6, callback: (v) => fmtAxis(v) },
    title: o.valueTitle ? { display: true, text: o.valueTitle, color: t.ink3, font: { size: 11 } } : undefined,
  };
  const catAxis = {
    stacked: !!o.stacked, grid: { display: false }, border: { color: t.line },
    ticks: {
      color: t.ink2, padding: 6, autoSkip: !o.horizontal, maxRotation: 0, autoSkipPadding: 12, font: { size: 11.5 },
      callback: o.horizontal ? function (v) { const l = this && this.getLabelForValue ? this.getLabelForValue(v) : v; return trunc(l, o.maxLabel || 30); } : undefined,
    },
  };
  return {
    responsive: true, maintainAspectRatio: false,
    animation: REDUCED ? false : { duration: 650, easing: "easeOutQuart" },
    interaction: { mode: o.mode || "index", intersect: false, axis: o.horizontal ? "y" : "x" },
    indexAxis: o.horizontal ? "y" : "x",
    layout: { padding: { top: o.padTop ?? 10, right: o.padRight ?? 8, left: 0, bottom: 0 } },
    scales: o.horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
    plugins: { legend: legendCfg(t, o.legend), tooltip: tooltipCfg(t), datalabels: { display: false } },
  };
}

// Atenúa lo que no está bajo el cursor (enfoque visual)
const focusColor = (c, by = "index") => (ctx) => {
  const base = Array.isArray(c) ? c[ctx.dataIndex % c.length] : c;
  const f = ctx.chart.$focus;
  if (!f) return base;
  const hit = by === "dataset" ? ctx.datasetIndex === f.ds : by === "cell" ? (ctx.datasetIndex === f.ds && ctx.dataIndex === f.i) : ctx.dataIndex === f.i;
  return hit ? base : rgba(base, 0.28);
};
function barDs(t, label, data, color, o = {}) {
  return {
    label, data,
    backgroundColor: focusColor(color, o.by || "index"),
    hoverBackgroundColor: Array.isArray(color) ? color : color,
    borderRadius: o.stacked ? 3 : 5,
    borderSkipped: o.stacked ? false : "start",
    borderWidth: o.stacked ? 1 : 0,
    borderColor: t.surface,
    maxBarThickness: o.thick || 40,
    barPercentage: 0.78, categoryPercentage: 0.82,
    order: o.order || 1,
  };
}
function lineDs(t, label, data, color, o = {}) {
  return {
    label, data,
    borderColor: color, borderWidth: 2, tension: 0.35,
    borderDash: o.dashed ? [6, 5] : [],
    fill: o.fill ? "origin" : false,
    backgroundColor: o.fill
      ? (ctx) => {
          const { chart } = ctx; const a = chart.chartArea;
          if (!a) return rgba(color, 0.1);
          const g = chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
          g.addColorStop(0, rgba(color, 0.24)); g.addColorStop(1, rgba(color, 0));
          return g;
        }
      : color,
    pointStyle: o.dashed ? "line" : "circle",
    pointRadius: o.dashed ? 0 : 4, pointHoverRadius: o.dashed ? 0 : 7, pointHitRadius: 16,
    pointBackgroundColor: t.surface, pointBorderColor: color, pointBorderWidth: 2,
    pointHoverBackgroundColor: color, pointHoverBorderColor: t.surface, pointHoverBorderWidth: 3,
    spanGaps: true,
  };
}
const endLabels = (t, formatter) => ({
  display: (ctx) => ctx.dataset.data[ctx.dataIndex] != null,
  anchor: "end", align: "end", offset: 4, clamp: true,
  color: t.ink2, font: { weight: "600", size: 11 }, formatter,
});

/* =========================== INFO (botón "i") =========================== */
const INFO = {};
const txt = (x) => (typeof x === "function" ? x(DS()) : x);

/* =========================== CONSTRUCTORES DE GRÁFICOS =========================== */
// Ranking horizontal (un valor por categoría)
function ranking(d, t, o) {
  const all = o.list;
  const L = all.slice(0, o.top || CONFIG.TOP_N);
  const color = o.color || t.series[0];
  const colors = o.colorFn ? L.map((x) => o.colorFn(x)) : color;
  const lbl = (x) => (o.labelFn ? o.labelFn(x) : x.label);
  const cond = (x) => (x._otros ? null : o.condFn ? o.condFn(x) : [{ dim: o.dim, value: x.label, label: o.labelFn ? lbl(x) : undefined }]);
  return {
    empty: !L.length || (o.emptyIf && o.emptyIf(L)),
    emptyMsg: o.emptyMsg,
    sub: all.length > L.length ? `Top ${L.length} de ${fmt(all.length)}` : "",
    config: {
      type: "bar",
      data: { labels: L.map(lbl), datasets: [barDs(t, o.name, L.map((x) => x[o.key]), colors, { thick: 22 })] },
      options: merge(baseOptions(t, { horizontal: true, axisFmt: o.axisFmt || ((v) => fmtC(v)), padRight: 74, padTop: o.ref ? 22 : 10, mode: "nearest", maxLabel: o.maxLabel || 30, min: o.min, max: o.max }), {
        layout: o.padLeft ? { padding: { left: o.padLeft } } : {},
        plugins: {
          coreRef: o.ref ? { lines: [{ axis: "x", value: o.ref.value, label: o.ref.label }] } : undefined,
          datalabels: endLabels(t, o.endFmt || ((v) => fmtC(v))),
          tooltip: { callbacks: {
            title: (items) => (o.titleFn ? o.titleFn(L[items[0].dataIndex]) : L[items[0].dataIndex].label),
            label: (c) => ` ${o.name}: ${o.fmtV(c.parsed.x)}`,
            afterLabel: (c) => (o.extra ? o.extra(L[c.dataIndex]) : []),
          } },
        },
      }),
    },
    table: {
      head: [{ t: o.colName || dimLabel(o.dim) }, ...o.cols.map((c) => ({ t: c[0], num: 1 }))],
      rows: all.map((x) => [o.labelFn ? cell(x.label, () => (o.titleFn ? o.titleFn(x) : lbl(x))) : x.label, ...o.cols.map((c) => cell(x[c[1]], c[2]))]),
      conds: all.map(cond),
      searchable: all.length > 20, pageSize: 25,
    },
    drill: (e) => { const x = L[e.index]; return x && cond(x); },
  };
}

// Barras agrupadas (dos o más series por categoría)
function grouped(d, t, o) {
  const all = o.list;
  const L = all.slice(0, o.top || 12);
  const lbl = (x) => (o.labelFn ? o.labelFn(x) : x.label);
  const cond = (x) => (x._otros ? null : o.condFn ? o.condFn(x) : [{ dim: o.dim, value: x.label }]);
  const h = !!o.horizontal;
  return {
    empty: !L.length,
    emptyMsg: o.emptyMsg,
    sub: all.length > L.length ? `Top ${L.length} de ${fmt(all.length)}` : "",
    config: {
      type: "bar",
      data: { labels: L.map(lbl), datasets: o.series.map((s) => barDs(t, s.name, L.map((x) => x[s.key]), s.color, { thick: h ? 13 : 30, stacked: o.stacked })) },
      options: merge(baseOptions(t, { horizontal: h, legend: true, stacked: o.stacked, axisFmt: o.axisFmt || fmtSC, mode: "index", maxLabel: o.maxLabel || 28 }), {
        plugins: { tooltip: { callbacks: {
          title: (items) => (o.titleFn ? o.titleFn(L[items[0].dataIndex]) : L[items[0].dataIndex].label),
          label: (c) => ` ${c.dataset.label}: ${o.fmtV(h ? c.parsed.x : c.parsed.y)}`,
          footer: (items) => (o.extra ? o.extra(L[items[0].dataIndex]) : []),
        } } },
      }),
    },
    table: {
      head: [{ t: o.colName || dimLabel(o.dim) }, ...o.cols.map((c) => ({ t: c[0], num: 1 }))],
      rows: all.map((x) => [o.labelFn ? cell(x.label, () => lbl(x)) : x.label, ...o.cols.map((c) => cell(x[c[1]], c[2]))]),
      conds: all.map(cond), searchable: all.length > 20, pageSize: 25,
    },
    drill: (e) => { const x = L[e.index]; return x && cond(x); },
  };
}

// Anillo con leyenda directa (valor y %)
function donut(d, t, o) {
  const L = o.list.filter((x) => x[o.key] > 0);
  const total = L.reduce((a, x) => a + x[o.key], 0) || 1;
  const colors = L.map((x, i) => (o.colorFn ? o.colorFn(x, i) : colorOf(o.dim, x.label, t)));
  const cond = (x) => (x._otros ? null : o.condFn ? o.condFn(x) : [{ dim: o.dim, value: x.label }]);
  return {
    empty: !L.length, emptyMsg: o.emptyMsg,
    config: {
      type: "doughnut",
      data: { labels: L.map((x) => x.label), datasets: [{ data: L.map((x) => x[o.key]), backgroundColor: focusColor(colors), hoverBackgroundColor: colors, borderColor: t.surface, borderWidth: 3, hoverOffset: 10, borderRadius: 4 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "70%",
        animation: REDUCED ? false : { animateRotate: true, duration: 750, easing: "easeOutQuart" },
        layout: { padding: 10 },
        plugins: {
          legend: { display: false },
          tooltip: merge(tooltipCfg(t), { callbacks: { label: (c) => ` ${c.label}: ${o.fmtV(c.parsed)} (${fmtPct((c.parsed / total) * 100)})`, afterLabel: (c) => (o.extra ? o.extra(L[c.dataIndex]) : []) } }),
          coreCenter: o.center ? o.center(total) : undefined,
          datalabels: { display: false },
        },
      },
    },
    legend: L.map((x, i) => ({ label: x.label, full: x.label, color: colors[i], value: o.legendFmt ? o.legendFmt(x[o.key]) : o.fmtV(x[o.key]), pct: (x[o.key] / total) * 100, index: i })),
    table: {
      head: [{ t: o.colName || dimLabel(o.dim) }, { t: o.name, num: 1 }, { t: "%", num: 1 }, ...(o.cols || []).map((c) => ({ t: c[0], num: 1 }))],
      rows: L.map((x) => [x.label, cell(x[o.key], o.fmtV), cell((x[o.key] / total) * 100, fmtPct), ...(o.cols || []).map((c) => cell(x[c[1]], c[2]))]),
      conds: L.map(cond),
    },
    drill: (e) => { const x = L[e.index]; return x && cond(x); },
  };
}

// Puente (cascada): del saldo inicial al final
function puente(t, steps, o = {}) {
  let acc = 0;
  const data = [], colors = [];
  steps.forEach((s) => {
    if (s.kind === "total") { data.push([0, s.value]); acc = s.value; colors.push(s.color || t.stock); }
    else if (s.kind === "up") { data.push([acc, acc + s.value]); acc += s.value; colors.push(t.ing); }
    else if (s.kind === "down") { data.push([acc - s.value, acc]); acc -= s.value; colors.push(t.egr); }
    else { data.push([Math.min(acc, acc + s.value), Math.max(acc, acc + s.value)]); acc += s.value; colors.push(t.neutral); }
  });
  const fv = (s) => (s.kind === "total" ? fmtSC(s.value) : (s.kind === "down" ? "−" : s.value >= 0 ? "+" : "−") + fmtSC(Math.abs(s.value)));
  return {
    empty: steps.every((s) => !s.value),
    config: {
      type: "bar",
      data: { labels: steps.map((s) => s.label), datasets: [barDs(t, "Importe", data, colors, { thick: 70 })] },
      options: merge(baseOptions(t, { axisFmt: fmtSC, padTop: 26, mode: "nearest" }), {
        plugins: {
          datalabels: { display: true, anchor: "end", align: "end", offset: 2, clamp: true, color: t.ink2, font: { weight: "650", size: 11.5 }, formatter: (_v, c) => fv(steps[c.dataIndex]) },
          tooltip: { callbacks: { label: (c) => { const s = steps[c.dataIndex]; return ` ${s.label}: ${s.kind === "down" ? "−" : ""}${fmtS2(Math.abs(s.value))}`; }, afterLabel: (c) => steps[c.dataIndex].note || "" } },
        },
      }),
    },
    table: {
      head: [{ t: "Concepto" }, { t: "Importe (S/)", num: 1 }, { t: "Acumulado (S/)", num: 1 }],
      rows: steps.map((s, i) => [s.label, cell(s.kind === "down" ? -s.value : s.value, fmtS2), cell(data[i][s.kind === "down" ? 0 : 1], fmtS2)]),
    },
  };
}

// Histograma por rangos
function histo(t, o) {
  const total = o.bins.reduce((a, b) => a + b.n, 0) || 1;
  return {
    empty: !o.bins.some((b) => b.n), emptyMsg: o.emptyMsg,
    config: {
      type: "bar",
      data: { labels: o.bins.map((b) => b.label), datasets: [barDs(t, o.name, o.bins.map((b) => b.n), o.bins.map((b) => b.color || o.color || t.series[0]), { thick: 56 })] },
      options: merge(baseOptions(t, { axisFmt: (v) => fmt(v), padTop: 22, mode: "nearest" }), {
        plugins: { datalabels: endLabels(t, (v) => fmt(v)), tooltip: { callbacks: { label: (c) => ` ${fmt(c.parsed.y)} ${o.unit} (${fmtPct((c.parsed.y / total) * 100)})` } } },
      }),
    },
    table: {
      head: [{ t: o.colName || "Rango" }, { t: o.name, num: 1 }, { t: "%", num: 1 }],
      rows: o.bins.map((b) => [b.label, cell(b.n, fmt), cell((b.n / total) * 100, fmtPct)]),
      conds: o.bins.map((b) => (b.n ? [{ dim: o.dim, value: b.label, label: `${o.colName || "Rango"}: ${b.label}` }] : null)),
    },
    drill: (e) => { const b = o.bins[e.index]; return b && b.n && [{ dim: o.dim, value: b.label, label: `${o.colName || "Rango"}: ${b.label}` }]; },
  };
}
const RANGOS_LT = [["0–7 días", 7], ["8–15 días", 15], ["16–30 días", 30], ["31–60 días", 60], ["61–90 días", 90], ["Más de 90 días", Infinity]];
const rangoDe = (v) => (v == null ? "" : RANGOS_LT.find((x) => v <= x[1])[0]);
const binsDe = (rows, key) => { const c = new Map(RANGOS_LT.map((x) => [x[0], 0])); rows.forEach((r) => { if (r[key]) c.set(r[key], c.get(r[key]) + 1); }); return RANGOS_LT.map(([label]) => ({ label, n: c.get(label) })); };

const mesDrill = (P) => (e) => { const p = P[e.index]; return p && [{ dim: "mesKey", value: p.key, label: p.label }]; };
const recLabel = (x) => trunc(x.nombre || x.label, 34);
const recTitle = (x) => `${x.nombre}${x.codigo && x.codigo !== x.nombre ? " · " + x.codigo : ""}`;
const recCond = (x) => [{ dim: "codigo", value: x.label, label: x.nombre }];
const varPct = (a, b) => (b ? ((a - b) / Math.abs(b)) * 100 : null);
const tipoLabel = (x) => (x.desc ? `${x.label} · ${trunc(x.desc, 26)}` : x.label);
const dirColor = (t) => (x) => (x.nIng >= x.nEgr ? t.ing : t.egr);

/* =========================== BIBLIOTECA DE GRÁFICOS =========================== */
const CHARTLIB = {
  /* ======================= KARDEX ======================= */
  kPuente: {
    size: "lg", focus: false,
    title: "Del stock inicial al stock actual", sub: "Soles · inicial + ingresos − egresos",
    info: { what: "Cómo se llega del stock inicial al stock actual en soles.", how: "Stock Inicial (S/) + Ingreso (S/) − Egreso (S/). Si el resultado no coincide con el Stock Actual (S/) del Excel, aparece una barra gris «Diferencia» (ajustes, revalorizaciones o errores de la planilla).", tip: "Pasá el cursor por cada barra para ver el importe exacto." },
    build(d, t) {
      const k = d.k, calc = k.vIni + k.vIng - k.vEgr, dif = k.vAct - calc;
      const steps = [{ label: "Stock inicial", value: k.vIni, kind: "total", color: rgba(t.stock, 0.55) }, { label: "Ingresos", value: k.vIng, kind: "up" }, { label: "Egresos", value: k.vEgr, kind: "down", note: k.pctEgrIng != null ? `${fmtPct(k.pctEgrIng)} de lo ingresado` : "" }];
      if (Math.abs(dif) > CONFIG.TOL_VALOR) steps.push({ label: "Diferencia", value: dif, kind: "adj", note: "Stock actual informado − calculado" });
      steps.push({ label: "Stock actual", value: k.vAct, kind: "total", note: k.pctVar != null ? `Variación: ${signo(k.var)} (${signo(k.pctVar, (x) => fmt(x, 1) + " %")})` : "" });
      return puente(t, steps);
    },
  },
  kMovDonut: {
    size: "donut", focus: true,
    title: (ds) => `${ds.term[1].charAt(0).toUpperCase() + ds.term[1].slice(1)} según su movimiento`, sub: "Líneas del kardex por tipo de movimiento del período",
    info: (ds) => ({ what: `Cuántos ${ds.term[1]} tuvieron ingresos, egresos, ambos o ninguno en el período.`, how: "Con ingreso y egreso: Cantidad Ingreso > 0 y Cantidad Egreso > 0. Sin movimiento: ambas en 0 (spec: Recursos sin Movimiento). Cada línea es un recurso en un almacén.", tip: "Clic en un segmento para ver qué almacenes y recursos lo componen." }),
    build(d, t) {
      const k = d.k;
      const L = [["Con ingreso y egreso", k.ambos, t.stock], ["Solo ingreso", k.soloIng, t.ing], ["Solo egreso", k.soloEgr, t.egr], ["Sin movimiento", k.sinMov, t.series[3]]].map(([label, n, c]) => ({ label, n, c }));
      return donut(d, t, { list: L, key: "n", name: "Líneas", dim: "_movCat", colName: "Movimiento", fmtV: fmt, colorFn: (x) => x.c,
        center: () => ({ title: fmtPct(k.pctSinMov, 0), sub: "sin movimiento" }) });
    },
  },
  kAlmStock: {
    size: "lg", focus: true,
    title: "Stock actual por almacén", sub: "Soles · Descripción Almacén",
    info: { what: "En qué almacén está el valor del stock.", how: "Suma de Stock Actual (S/) agrupada por Descripción Almacén.", tip: "Clic en un almacén para ver su detalle y filtrar el tablero." },
    build: (d, t) => ranking(d, t, { list: d.alm.filter((x) => x.vAct), dim: "almacen", key: "vAct", name: "Stock actual", fmtV: fmtS2, axisFmt: fmtSC, endFmt: fmtSC, color: t.stock,
      extra: (x) => [`${fmtPct(pctDe(x.vAct, d.k.vAct) || 0)} del stock total`, `Recursos: ${fmt(x.recursos)} · sin movimiento: ${fmtPct(x.pctSinMov)}`],
      cols: [["Stock S/", "vAct", fmtS2], ["Recursos", "recursos", fmt], ["Sin mov. %", "pctSinMov", pOpt]] }),
  },
  kIniAct: {
    size: "lg", focus: true,
    title: "Stock inicial vs. actual por almacén", sub: "Soles · los almacenes de mayor stock",
    info: { what: "Si cada almacén creció o bajó en el período.", how: "Stock Inicial (S/) y Stock Actual (S/) por Descripción Almacén. Variación = actual − inicial; % variación = variación ÷ inicial × 100." },
    build: (d, t) => grouped(d, t, { list: d.alm.filter((x) => x.vAct || x.vIni), dim: "almacen", horizontal: true, top: 10, fmtV: fmtS2,
      series: [{ key: "vIni", name: "Stock inicial", color: rgba(t.stock, 0.45) }, { key: "vAct", name: "Stock actual", color: t.stock }],
      extra: (x) => [`Variación: ${signo(x.var)}${x.pctVar != null ? ` (${signo(x.pctVar, (v) => fmt(v, 1) + " %")})` : ""}`],
      cols: [["Inicial S/", "vIni", fmtS2], ["Actual S/", "vAct", fmtS2], ["Variación S/", "var", fmtS2], ["Var. %", "pctVar", pOpt]] }),
  },
  kIngEgrAlm: {
    size: "lg", focus: true,
    title: "Ingresos vs. egresos por almacén", sub: "Soles en el período",
    info: { what: "Cuánto entró y cuánto salió de cada almacén.", how: "Suma de Ingreso (S/) y Egreso (S/) por Descripción Almacén. En el detalle: % egreso sobre ingreso y rotación (egreso ÷ stock promedio)." },
    build: (d, t) => grouped(d, t, { list: [...d.alm].filter((x) => x.vIng || x.vEgr).sort((a, b) => b.vIng + b.vEgr - a.vIng - a.vEgr), dim: "almacen", horizontal: true, top: 10, fmtV: fmtS2,
      emptyMsg: "Ningún almacén tuvo ingresos ni egresos valorizados con estos filtros.",
      series: [{ key: "vIng", name: "Ingreso", color: t.ing }, { key: "vEgr", name: "Egreso", color: t.egr }],
      extra: (x) => [`Egreso / ingreso: ${x.pctEgrIng != null ? fmtPct(x.pctEgrIng) : "—"}`, `Rotación: ${fmtX(x.rot)}`],
      cols: [["Ingreso S/", "vIng", fmtS2], ["Egreso S/", "vEgr", fmtS2], ["Egr./Ing. %", "pctEgrIng", pOpt], ["Rotación", "rot", nOpt(2)]] }),
  },
  kTipoAlm: {
    size: "donut", focus: true,
    title: "Stock por tipo de almacén", sub: "Participación en el stock actual (S/)",
    info: { what: "Cómo se reparte el stock valorizado entre tipos de almacén.", how: "Suma de Stock Actual (S/) por Tipo de almacén ÷ stock total." },
    build: (d, t) => donut(d, t, { list: fold(d.tipoAlm, 6, ["vAct", "n"]), key: "vAct", name: "Stock S/", dim: "tipoAlm", fmtV: fmtS2, legendFmt: fmtSC,
      emptyMsg: "Las líneas en vista no tienen stock valorizado.",
      center: () => ({ title: fmtSC(d.k.vAct), sub: "stock actual" }), cols: [["Líneas", "n", fmt]] }),
  },
  kSinMovAlm: {
    size: "lg", focus: true,
    title: (ds) => `% de ${ds.term[1]} sin movimiento por almacén`, sub: "La línea punteada es el promedio del tablero",
    info: (ds) => ({ what: `Qué almacenes acumulan más ${ds.term[1]} parados.`, how: "Líneas con Cantidad Ingreso = 0 y Cantidad Egreso = 0 ÷ líneas del almacén × 100. En el detalle: el valor inmovilizado (Stock Actual S/ de esas líneas)." }),
    build: (d, t) => ranking(d, t, { list: [...d.alm].filter((x) => x.n).sort((a, b) => b.pctSinMov - a.pctSinMov), dim: "almacen", key: "pctSinMov", name: "Sin movimiento", fmtV: fmtPct, axisFmt: (v) => v + " %", endFmt: (v) => fmt(v, 0) + " %", min: 0, max: 100,
      ref: { value: d.k.pctSinMov, label: `Prom. ${fmt(d.k.pctSinMov, 0)} %` }, color: t.series[3],
      extra: (x) => [`${fmt(x.sinMov)} de ${fmt(x.n)} líneas`, `Inmovilizado: ${fmtS(x.vSinMov)}`],
      cols: [["Sin mov. %", "pctSinMov", pOpt], ["Sin mov.", "sinMov", fmt], ["Líneas", "n", fmt], ["Inmovilizado S/", "vSinMov", fmtS2]] }),
  },
  kVarAlm: {
    size: "lg", focus: true,
    title: "Variación del stock por almacén", sub: "Soles · stock actual − stock inicial",
    info: { what: "Qué almacenes ganaron o perdieron valor de stock.", how: "Stock Actual (S/) − Stock Inicial (S/) por Descripción Almacén. Azul: creció; naranja: bajó. Se ordena por tamaño de la variación." },
    build(d, t) {
      const L = d.alm.filter((x) => Math.abs(x.var) > CONFIG.TOL_VALOR).sort((a, b) => Math.abs(b.var) - Math.abs(a.var));
      return ranking(d, t, { list: L, dim: "almacen", key: "var", name: "Variación", fmtV: (v) => signo(v, fmtS2), axisFmt: fmtSC, endFmt: (v) => signo(v, fmtSC), padLeft: 46,
        colorFn: (x) => (x.var >= 0 ? t.stock : t.egr), emptyMsg: "El stock de los almacenes en vista no cambió.",
        extra: (x) => [`${fmtS(x.vIni)} → ${fmtS(x.vAct)}`, x.pctVar != null ? `Variación: ${signo(x.pctVar, (v) => fmt(v, 1) + " %")}` : "Sin stock inicial"],
        cols: [["Variación S/", "var", fmtS2], ["Var. %", "pctVar", pOpt], ["Inicial S/", "vIni", fmtS2], ["Actual S/", "vAct", fmtS2]] });
    },
  },
  kObsAlm: {
    size: "lg", focus: true,
    title: "Stock inmovilizado por almacén", sub: "Soles en líneas sin ingresos ni egresos",
    info: { what: "Dónde está el dinero parado.", how: "Suma de Stock Actual (S/) de las líneas con Cantidad Ingreso = 0 y Cantidad Egreso = 0, por almacén. En el detalle: qué parte del almacén representa." },
    build: (d, t) => ranking(d, t, { list: [...d.alm].filter((x) => x.vSinMov > 0).sort((a, b) => b.vSinMov - a.vSinMov), dim: "almacen", key: "vSinMov", name: "Inmovilizado", fmtV: fmtS2, axisFmt: fmtSC, endFmt: fmtSC, color: t.series[3],
      emptyMsg: "No hay stock inmovilizado con estos filtros.",
      extra: (x) => [`${fmtPct(x.pctInmov)} del stock del almacén`, `${fmt(x.sinMov)} líneas sin movimiento`],
      cols: [["Inmovilizado S/", "vSinMov", fmtS2], ["% del almacén", "pctInmov", pOpt], ["Líneas", "sinMov", fmt]] }),
  },
  kEstadoInv: {
    size: "donut", focus: true,
    title: "Estado del inventario", sub: "Stock actual (S/) por estado",
    info: { what: "Qué parte del stock se mueve, cuál está inmovilizada y cuál es obsoleta o vencida.", how: `Obsoleto / vencido: almacén cuyo nombre contiene «vencidos» u «obsoletos». Inmovilizado: el resto de líneas sin ingresos ni egresos. Con movimiento: lo demás. (La tarjeta «% stock inmovilizado» incluye también lo obsoleto sin movimiento, como pide la métrica.)`, tip: "También está como segmentador en «Más filtros»." },
    build(d, t) {
      const col = { [ESTADOS_INV[0]]: t.stock, [ESTADOS_INV[1]]: t.series[3], [ESTADOS_INV[2]]: t.series[7] };
      const L = ESTADOS_INV.map((e) => d.estado.find((x) => x.label === e)).filter(Boolean);
      const parado = L.filter((x) => x.label !== ESTADOS_INV[0]).reduce((a, x) => a + x.vAct, 0);
      return donut(d, t, { list: L, key: "vAct", name: "Stock S/", dim: "estadoInv", fmtV: fmtS2, legendFmt: fmtSC, colorFn: (x) => col[x.label],
        center: (tot) => ({ title: fmtPct((parado / tot) * 100, 0), sub: "parado u obsoleto" }), cols: [["Líneas", "n", fmt]] });
    },
  },
  kTopValor: {
    size: "xl", focus: true,
    title: (ds) => `${ds.term[1].charAt(0).toUpperCase() + ds.term[1].slice(1)} con mayor valor de stock`, sub: "Stock actual (S/) sumando todos sus almacenes",
    info: (ds) => ({ what: `Los ${ds.term[1]} que concentran el valor del inventario.`, how: "Suma de Stock Actual (S/) por Código Recurso. En el detalle: stock en unidades, valor unitario promedio (S/ ÷ unidades) y rotación." }),
    build: (d, t) => ranking(d, t, { list: d.rec.filter((x) => x.vAct > 0), dim: "codigo", key: "vAct", name: "Stock actual", fmtV: fmtS2, axisFmt: fmtSC, endFmt: fmtSC, labelFn: recLabel, titleFn: recTitle, condFn: recCond, colName: term(0, true), maxLabel: 34, color: t.stock,
      extra: (x) => [`${fmtPct(pctDe(x.vAct, d.k.vAct) || 0)} del total`, `Stock: ${fmt(x.sAct, 2)} ${x.unidad} · VU: ${x.vu != null ? "S/ " + fmt(x.vu, 2) : "—"}`, `Rotación: ${fmtX(x.rot)} · ${trunc(x.almTxt, 40)}`],
      cols: [["Stock S/", "vAct", fmtS2], ["Stock", "sAct", nOpt(2)], ["VU prom.", "vu", nOpt(2)], ["Rotación", "rot", nOpt(2)]] }),
  },
  kABC: {
    size: "xl", focus: false,
    title: "Concentración del stock (curva ABC)", sub: "Qué % de recursos explica qué % del valor",
    info: { what: "Si el valor del inventario está concentrado en pocos recursos.", how: "Se ordenan los recursos por Stock Actual (S/) de mayor a menor y se acumula su participación. Clase A: hasta el 80 % del valor; B: del 80 al 95 %; C: el resto.", tip: "Clic en la curva para ver los recursos de esa clase." },
    build(d, t) {
      const L = d.rec.filter((x) => x.vAct > 0);
      const tot = L.reduce((a, x) => a + x.vAct, 0);
      if (!L.length || !tot) return { empty: true, emptyMsg: "No hay stock valorizado positivo con estos filtros." };
      let acc = 0;
      const cum = L.map((x) => { acc += x.vAct; return (acc / tot) * 100; });
      const clase = (p) => (p <= 80 ? "A" : p <= 95 ? "B" : "C");
      const ids = { A: [], B: [], C: [] }, val = { A: 0, B: 0, C: 0 };
      L.forEach((x, i) => { const c = i === 0 ? "A" : clase(cum[i - 1]); ids[c].push(x.label); val[c] += x.vAct; });
      const N = L.length, P = Math.min(N, 60);
      const pts = Array.from({ length: P }, (_, j) => { const i = Math.max(0, Math.ceil(((j + 1) / P) * N) - 1); return { i, x: ((i + 1) / N) * 100, y: cum[i] }; });
      const claseDe = (p) => (p.i === 0 ? "A" : clase(cum[p.i - 1]));
      const condC = (c) => (ids[c].length ? [{ dim: "set", value: ids[c], label: `Clase ${c} (${fmt(ids[c].length)} recursos)` }] : null);
      return {
        sub: `A: ${fmt(ids.A.length)} recursos (${fmtPct((ids.A.length / N) * 100)}) = ${fmtPct((val.A / tot) * 100, 0)} del valor`,
        config: {
          type: "line",
          data: { labels: pts.map((p) => fmt(p.x, 0) + " %"), datasets: [lineDs(t, "Valor acumulado", pts.map((p) => p.y), t.stock, { fill: true })] },
          options: merge(baseOptions(t, { min: 0, max: 100, axisFmt: (v) => v + " %", padTop: 22, valueTitle: "% del valor" }), {
            plugins: {
              coreCross: { enabled: true },
              coreRef: { lines: [{ axis: "y", value: 80, label: "80 % · A" }, { axis: "y", value: 95, label: "95 % · B" }] },
              tooltip: { callbacks: { title: (it) => `El ${pts[it[0].dataIndex].x.toFixed(1)} % de los recursos (${fmt(pts[it[0].dataIndex].i + 1)})`, label: (c) => ` concentra el ${fmt(c.parsed.y, 1)} % del valor`, afterLabel: (c) => `Clase ${claseDe(pts[c.dataIndex])}` } },
            },
          }),
        },
        table: {
          head: [{ t: "Clase" }, { t: "Recursos", num: 1 }, { t: "% recursos", num: 1 }, { t: "Stock S/", num: 1 }, { t: "% valor", num: 1 }],
          rows: ["A", "B", "C"].map((c) => [`Clase ${c}`, cell(ids[c].length, fmt), cell((ids[c].length / N) * 100, fmtPct), cell(val[c], fmtS2), cell((val[c] / tot) * 100, fmtPct)]),
          conds: ["A", "B", "C"].map(condC),
        },
        drill: (e) => condC(claseDe(pts[e.index])),
      };
    },
  },
  kRotRec: {
    size: "xl", focus: true,
    title: (ds) => `${ds.term[1].charAt(0).toUpperCase() + ds.term[1].slice(1)} con mayor rotación`, sub: "Egreso (S/) ÷ stock promedio (S/)",
    info: { what: "Qué recursos salen más rápido respecto de lo que se tiene en stock.", how: `Rotación = Egreso (S/) ÷ ((Stock Inicial (S/) + Stock Actual (S/)) ÷ 2). 2× significa que en el período salió el doble de lo que se guarda en promedio. Solo se calcula con stock promedio de al menos S/ ${CONFIG.ROT_MIN_PROM} (CONFIG.ROT_MIN_PROM): con stock casi 0 la división da miles de veces y no dice nada.` },
    build: (d, t) => ranking(d, t, { list: d.rec.filter((x) => x.rot > 0).sort((a, b) => b.rot - a.rot), dim: "codigo", key: "rot", name: "Rotación", fmtV: fmtX, axisFmt: (v) => fmt(v, 1) + "×", endFmt: (v) => fmt(v, 1) + "×", labelFn: recLabel, titleFn: recTitle, condFn: recCond, colName: term(0, true), maxLabel: 34, color: t.series[4],
      emptyMsg: "Ningún recurso en vista tuvo egresos con stock promedio mayor a 0.",
      extra: (x) => [`Egreso: ${fmtS(x.vEgr)} · stock prom.: ${fmtS((x.vIni + x.vAct) / 2)}`],
      cols: [["Rotación", "rot", nOpt(2)], ["Egreso S/", "vEgr", fmtS2], ["Stock S/", "vAct", fmtS2]] }),
  },
  kControl: {
    size: "md", focus: true,
    title: "Validación de saldos del kardex", sub: "Líneas que no pasan cada control",
    info: { what: "Si el stock físico y el valorizado cuadran línea por línea.", how: `${KFLAGS.map((x) => `${x.label}: ${x.how}`).join(". ")}. Tolerancia: ${CONFIG.TOL_CANT} unidades y S/ ${CONFIG.TOL_VALOR}.`, tip: "Clic en una barra para ver qué recursos corregir." },
    build(d, t) {
      const L = KFLAGS.map((x) => ({ k: x.k, label: x.label, n: d.flags[x.k] }));
      const total = d.k.n || 1;
      return {
        empty: !d.k.n,
        sub: d.k.issues ? `${fmt(d.k.issues)} líneas con al menos una alerta` : "Todas las líneas cuadran",
        config: {
          type: "bar",
          data: { labels: L.map((x) => x.label), datasets: [barDs(t, "Líneas", L.map((x) => x.n), L.map((x) => (x.n ? t.series[1] : t.neutral)), { thick: 20 })] },
          options: merge(baseOptions(t, { horizontal: true, axisFmt: (v) => fmtC(v), padRight: 60, mode: "nearest", maxLabel: 30 }), {
            plugins: { datalabels: endLabels(t, (v) => fmt(v)), tooltip: { callbacks: { label: (c) => ` ${fmt(c.parsed.x)} líneas (${fmtPct((c.parsed.x / total) * 100)})`, afterLabel: (c) => KFLAGS[c.dataIndex].how } } },
          }),
        },
        table: { head: [{ t: "Control" }, { t: "Líneas", num: 1 }, { t: "% del total", num: 1 }], rows: L.map((x) => [x.label, cell(x.n, fmt), cell((x.n / total) * 100, fmtPct)]), conds: L.map((x) => (x.n ? [{ dim: "flag", value: x.k, label: x.label }] : null)) },
        drill: (e) => { const x = L[e.index]; return x && x.n && [{ dim: "flag", value: x.k, label: x.label }]; },
      };
    },
  },
  kTopObs: {
    size: "xl", focus: true,
    title: "Materiales obsoletos de mayor valor", sub: "Stock actual (S/) en almacenes de vencidos u obsoletos",
    info: { what: "Qué materiales vencidos u obsoletos tienen más plata inmovilizada.", how: `Suma de Stock Actual (S/) de las líneas cuyo almacén contiene «vencidos» u «obsoletos» (regla editable en CONFIG.OBSOLETO), por Código Recurso.` },
    build: (d, t) => ranking(d, t, { list: d.obsRec.filter((x) => x.vAct > 0), dim: "codigo", key: "vAct", name: "Stock obsoleto", fmtV: fmtS2, axisFmt: fmtSC, endFmt: fmtSC, labelFn: recLabel, titleFn: recTitle, condFn: recCond, colName: term(0, true), maxLabel: 34, color: t.series[7],
      emptyMsg: "No hay materiales en almacenes de vencidos u obsoletos con estos filtros.",
      extra: (x) => [`${fmtPct(pctDe(x.vAct, d.k.vObs) || 0)} de lo obsoleto`, `Stock: ${fmt(x.sAct, 2)} ${x.unidad}`],
      cols: [["Stock S/", "vAct", fmtS2], ["Stock", "sAct", nOpt(2)], ["Unidad", "unidad", (v) => v]] }),
  },
  kGrupo: {
    size: "donut", focus: true,
    title: "Tenencias vs. activos fijos", sub: "Stock actual (S/) por grupo de activo",
    info: { what: "Cuánto del valor son tenencias y cuánto maquinaria, facilidades, equipos de medición o TI.", how: "Suma de Stock Actual (S/) por grupo. El grupo sale de la descripción del almacén (reglas editables en CONFIG.GRUPOS_ACTIVO); si no coincide con ninguna, se usa el nombre del almacén." },
    build: (d, t) => donut(d, t, { list: fold(d.grupo, 6, ["vAct", "n"]), key: "vAct", name: "Stock S/", dim: "grupo", fmtV: fmtS2, legendFmt: fmtSC,
      center: (tot) => { const te = d.grupo.find((x) => /tenenc/i.test(x.label)); return { title: fmtPct(te ? (te.vAct / tot) * 100 : 0, 0), sub: "tenencias" }; }, cols: [["Activos", "n", fmt]] }),
  },
  kGrupoMov: {
    size: "lg", focus: true,
    title: "Activos con ingreso y con egreso por grupo", sub: "Cantidad de líneas con movimiento en el período",
    info: { what: "Cuántos activos ingresaron o salieron en cada grupo.", how: "Activos con ingreso: Cantidad Ingreso > 0. Activos con egreso: Cantidad Egreso > 0. Un activo puede estar en ambas. En el detalle: los importes en soles." },
    build: (d, t) => grouped(d, t, { list: d.grupo.filter((x) => x.conIng || x.conEgr), dim: "grupo", fmtV: fmt, axisFmt: (v) => fmt(v),
      emptyMsg: "Ningún activo en vista tuvo ingresos ni egresos.",
      series: [{ key: "conIng", name: "Con ingreso", color: t.ing }, { key: "conEgr", name: "Con egreso", color: t.egr }],
      extra: (x) => [`Ingreso: ${fmtS(x.vIng)} · Egreso: ${fmtS(x.vEgr)}`, `Sin movimiento: ${fmt(x.sinMov)} de ${fmt(x.n)}`],
      cols: [["Con ingreso", "conIng", fmt], ["Con egreso", "conEgr", fmt], ["Ingreso S/", "vIng", fmtS2], ["Egreso S/", "vEgr", fmtS2]] }),
  },

  /* ======================= MOVIMIENTOS ======================= */
  mMes: {
    size: "lg", focus: true,
    title: "Ingresos y egresos por mes", sub: "Soles · Parcial neto",
    info: (ds) => ({ what: "Cuánto entró y cuánto salió cada mes.", how: ds.hlc ? "Suma de Parcial (S/) Neto por mes de ESCALA DE TIEMPO, separando Movimiento = Ingreso y Egreso." : "Suma de Parcial Neto MP por Período Mensual, separando Tipo Mov. = INGRESOS y EGRESOS.", tip: "Clic en un mes para ver sus movimientos." }),
    build(d, t) {
      const P = d.meses;
      return {
        empty: !P.length,
        config: {
          type: "bar",
          data: { labels: P.map((p) => p.label), datasets: [barDs(t, "Ingresos", P.map((p) => p.ing), t.ing, { thick: 30 }), barDs(t, "Egresos", P.map((p) => p.egr), t.egr, { thick: 30 })] },
          options: merge(baseOptions(t, { legend: true, axisFmt: fmtSC, mode: "index" }), {
            plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmtS2(c.parsed.y)}`, footer: (items) => { const p = P[items[0].dataIndex]; return [`Saldo neto: ${signo(p.neto)}`, `Movimientos: ${fmt(p.nIng)} ingresos · ${fmt(p.nEgr)} egresos`]; } } } },
          }),
        },
        table: {
          head: [{ t: "Mes" }, { t: "Ingresos S/", num: 1 }, { t: "Egresos S/", num: 1 }, { t: "Neto S/", num: 1 }, { t: "Movimientos", num: 1 }],
          rows: P.map((p) => [cell(p.key, () => p.label), cell(p.ing, fmtS2), cell(p.egr, fmtS2), cell(p.neto, fmtS2), cell(p.n, fmt)]),
          conds: P.map((p) => [{ dim: "mesKey", value: p.key, label: p.label }]),
        },
        drill: mesDrill(P),
      };
    },
  },
  mTipoDonut: {
    size: "donut", focus: true,
    title: "Monto por tipo de movimiento", sub: "Participación en el monto movido",
    info: (ds) => ({ what: "Qué tipos de movimiento (compras, transferencias, vales, devoluciones…) mueven más plata.", how: `Suma de ${ds.hlc ? "Parcial (S/) Neto" : "Parcial Neto MP"} por código de movimiento ÷ monto total.` }),
    build: (d, t) => donut(d, t, { list: fold(d.tipo, 6, ["monto", "n"]), key: "monto", name: "Monto", dim: "mov", fmtV: fmtS2, legendFmt: fmtSC,
      extra: (x) => [x.desc || "", `${fmt(x.n)} movimientos`], center: () => ({ title: fmtSC(d.k.monto), sub: "monto movido" }), cols: [["Movs.", "n", fmt]] }),
  },
  mUnegDonut: {
    size: "donut", focus: true,
    title: "Monto por unidad de negocio", sub: "Construcción, fabricación, HLC, ventas…",
    info: { what: "Cómo se reparte el monto movido entre unidades de negocio.", how: "Suma de Parcial (S/) Neto (ingresos + egresos) por Unidad de negocio. En el detalle: cantidad de movimientos." },
    build: (d, t) => donut(d, t, { list: fold(d.uneg, 6, ["monto", "n"]), key: "monto", name: "Monto", dim: "uneg", fmtV: fmtS2, legendFmt: fmtSC,
      extra: (x) => [`${fmt(x.n)} movimientos`], center: () => ({ title: fmt(d.k.unegs), sub: "unidades activas" }), cols: [["Movs.", "n", fmt]] }),
  },
  mVarMes: {
    size: "md", focus: true,
    title: "Variación mensual de ingresos y egresos", sub: "% contra el mes anterior",
    info: { what: "Si los ingresos y egresos crecen o caen mes a mes.", how: "(Monto del mes − monto del mes anterior) ÷ monto del mes anterior × 100, por separado para ingresos y egresos. Si el mes anterior fue 0, no se calcula." },
    build(d, t) {
      const P = d.meses.slice(1).map((p, i) => ({ ...p, vIng: varPct(p.ing, d.meses[i].ing), vEgr: varPct(p.egr, d.meses[i].egr), prev: d.meses[i] }));
      return {
        empty: !P.length, emptyMsg: "Hace falta más de un mes en vista para comparar.",
        config: {
          type: "bar",
          data: { labels: P.map((p) => p.label), datasets: [barDs(t, "Ingresos", P.map((p) => p.vIng), t.ing, { thick: 24 }), barDs(t, "Egresos", P.map((p) => p.vEgr), t.egr, { thick: 24 })] },
          options: merge(baseOptions(t, { legend: true, axisFmt: (v) => fmt(v) + " %", mode: "index" }), {
            scales: { y: { beginAtZero: true } },
            plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.y == null ? "sin base" : signo(c.parsed.y, (x) => fmt(x, 1) + " %")}`, footer: (items) => { const p = P[items[0].dataIndex]; return [`vs. ${p.prev.label}`, `Ingresos: ${fmtS(p.prev.ing)} → ${fmtS(p.ing)}`, `Egresos: ${fmtS(p.prev.egr)} → ${fmtS(p.egr)}`]; } } } },
          }),
        },
        table: {
          head: [{ t: "Mes" }, { t: "Var. ingresos %", num: 1 }, { t: "Var. egresos %", num: 1 }, { t: "Ingresos S/", num: 1 }, { t: "Egresos S/", num: 1 }],
          rows: P.map((p) => [cell(p.key, () => p.label), cell(p.vIng, pOpt), cell(p.vEgr, pOpt), cell(p.ing, fmtS2), cell(p.egr, fmtS2)]),
          conds: P.map((p) => [{ dim: "mesKey", value: p.key, label: p.label }]),
        },
        drill: mesDrill(P),
      };
    },
  },
  mGuiaObs: {
    size: "md", focus: false,
    title: "Registro de guías y observaciones", sub: "% de movimientos por mes",
    info: { what: "Qué tan completo está el registro: movimientos con guía y con observación.", how: `% con guía = movimientos con Nro. Guía ÷ movimientos. % con observación = movimientos con Observación ÷ movimientos. La línea punteada es la meta de guías (${CONFIG.META_GUIA} %).` },
    build(d, t) {
      const P = d.meses;
      return {
        empty: !P.length,
        config: {
          type: "line",
          data: { labels: P.map((p) => p.label), datasets: [lineDs(t, "Con guía", P.map((p) => p.pctGuia), t.series[0], { fill: true }), lineDs(t, "Con observación", P.map((p) => p.pctObs), t.series[3])] },
          options: merge(baseOptions(t, { legend: true, min: 0, max: 100, axisFmt: (v) => v + " %", padTop: 22 }), {
            plugins: { coreCross: { enabled: true }, coreRef: { lines: [{ axis: "y", value: CONFIG.META_GUIA, label: `Meta ${CONFIG.META_GUIA} %` }] },
              tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmtPct(c.parsed.y)}`, footer: (items) => { const p = P[items[0].dataIndex]; return [`Sin guía: ${fmt(p.sinGuia)} de ${fmt(p.n)}`]; } } } },
          }),
        },
        table: {
          head: [{ t: "Mes" }, { t: "% con guía", num: 1 }, { t: "Sin guía", num: 1 }, { t: "% con obs.", num: 1 }, { t: "Movimientos", num: 1 }],
          rows: P.map((p) => [cell(p.key, () => p.label), cell(p.pctGuia, pOpt), cell(p.sinGuia, fmt), cell(p.pctObs, pOpt), cell(p.n, fmt)]),
          conds: P.map((p) => [{ dim: "mesKey", value: p.key, label: p.label }]),
        },
        drill: mesDrill(P),
      };
    },
  },
  mTipoMonto: {
    size: "lg", focus: true,
    title: "Monto por tipo de movimiento", sub: "Verde: ingreso · naranja: egreso",
    info: (ds) => ({ what: "Cuánta plata mueve cada código de movimiento.", how: `Suma de ${ds.hlc ? "Parcial (S/) Neto" : "Parcial Neto MP"} por ${ds.hlc ? "Tipo de Movimiento2" : "Movimiento"}. El color indica si el código es de ingreso o de egreso.` }),
    build: (d, t) => ranking(d, t, { list: d.tipo, dim: "mov", key: "monto", name: "Monto", fmtV: fmtS2, axisFmt: fmtSC, endFmt: fmtSC, labelFn: tipoLabel, titleFn: tipoLabel, colName: dimLabel("mov"), colorFn: dirColor(t), maxLabel: 36,
      extra: (x) => [`${fmt(x.n)} movimientos · ${fmtPct(pctDe(x.monto, d.k.monto) || 0)} del monto`],
      cols: [["Monto S/", "monto", fmtS2], ["Movs.", "n", fmt]] }),
  },
  mTipoCount: {
    size: "lg", focus: true,
    title: "Movimientos por tipo", sub: "Cantidad de líneas por código",
    info: { what: "Qué movimientos son más frecuentes, aunque muevan poco dinero.", how: "Cantidad de filas por código de movimiento." },
    build: (d, t) => ranking(d, t, { list: [...d.tipo].sort((a, b) => b.n - a.n), dim: "mov", key: "n", name: "Movimientos", fmtV: fmt, endFmt: (v) => fmt(v), labelFn: tipoLabel, titleFn: tipoLabel, colName: dimLabel("mov"), colorFn: dirColor(t), maxLabel: 36,
      extra: (x) => [`Monto: ${fmtS(x.monto)}`, `Recursos distintos: ${fmt(x.recursos)}`],
      cols: [["Movs.", "n", fmt], ["Monto S/", "monto", fmtS2], ["Recursos", "recursos", fmt]] }),
  },
  mAlm: {
    size: "lg", focus: true,
    title: "Ingresos y egresos por almacén", sub: "Soles",
    info: { what: "Qué almacenes reciben y despachan más.", how: "Suma del parcial neto por Almacén, separando ingresos y egresos. En el detalle: cantidad de movimientos y recursos distintos." },
    build: (d, t) => grouped(d, t, { list: d.alm, dim: "almacen", horizontal: true, top: 10, fmtV: fmtS2,
      series: [{ key: "ing", name: "Ingresos", color: t.ing }, { key: "egr", name: "Egresos", color: t.egr }],
      extra: (x) => [`${fmt(x.n)} movimientos · ${fmt(x.recursos)} recursos`],
      cols: [["Ingresos S/", "ing", fmtS2], ["Egresos S/", "egr", fmtS2], ["Movs.", "n", fmt], ["Recursos", "recursos", fmt]] }),
  },
  mDestino: {
    size: "lg", focus: true,
    title: "Movimientos por destino / solicitante", sub: "Soles · a dónde va el material",
    info: { what: "Qué destinos o solicitantes concentran el monto movido.", how: "Suma del parcial neto y cantidad de movimientos por Destino/Solicitante." },
    build: (d, t) => ranking(d, t, { list: d.destino.filter((x) => x.monto > 0), dim: "destino", key: "monto", name: "Monto", fmtV: fmtS2, axisFmt: fmtSC, endFmt: fmtSC, color: t.series[4], maxLabel: 34,
      extra: (x) => [`${fmt(x.n)} movimientos · ${fmt(x.recursos)} recursos`],
      cols: [["Monto S/", "monto", fmtS2], ["Movs.", "n", fmt], ["Recursos", "recursos", fmt]] }),
  },
  mProv: {
    size: "lg", focus: true,
    title: "Top proveedores por monto", sub: "Soles ingresados por proveedor",
    info: { what: "A qué proveedores se les compra más.", how: "Suma del parcial neto de los ingresos por Proveedor (los movimientos sin proveedor no entran). En el detalle: movimientos, lead time promedio y recursos distintos." },
    build: (d, t) => ranking(d, t, { list: [...d.prov].filter((x) => x.ing > 0).sort((a, b) => b.ing - a.ing), dim: "proveedor", key: "ing", name: "Ingresos", fmtV: fmtS2, axisFmt: fmtSC, endFmt: fmtSC, color: t.ing, maxLabel: 34,
      emptyMsg: "No hay ingresos con proveedor en vista.",
      extra: (x) => [`${fmt(x.nIng)} ingresos · ${fmt(x.recursos)} recursos`, x.ltProm != null ? `Lead time prom.: ${fmtD(x.ltProm)}` : "Sin fechas de orden"],
      cols: [["Ingresos S/", "ing", fmtS2], ["Movs.", "n", fmt], ["LT prom. (d)", "ltProm", nOpt(1)], ["Recursos", "recursos", fmt]] }),
  },
  mLtProv: {
    size: "lg", focus: true,
    title: "Lead time de compra por proveedor", sub: `Días de la orden a la guía · límite ${CONFIG.LT_LIMITE} días`,
    info: { what: "Qué proveedores tardan más en entregar.", how: `Promedio de (Fecha Guía − Fecha Orden) en los ingresos con número y fecha de orden. Las diferencias negativas (guía antes que la orden) se excluyen. Línea punteada: ${CONFIG.LT_LIMITE} días.` },
    build: (d, t) => ranking(d, t, { list: d.prov.filter((x) => x.ltN > 0).sort((a, b) => b.ltProm - a.ltProm), dim: "proveedor", key: "ltProm", name: "Lead time", fmtV: fmtD, axisFmt: (v) => fmt(v) + " d", endFmt: (v) => fmt(v, 1) + " d", ref: { value: CONFIG.LT_LIMITE, label: `${CONFIG.LT_LIMITE} d` }, color: t.series[6], maxLabel: 34,
      emptyMsg: "No hay ingresos con Fecha Orden y Fecha Guía en vista.",
      extra: (x) => [`Máximo: ${fmt(x.ltMax)} días · ${fmt(x.ltN)} ingresos medidos`, `Más de ${CONFIG.LT_LIMITE} días: ${fmtPct(x.pctLt30)}`],
      cols: [["LT prom. (d)", "ltProm", nOpt(1)], ["LT máx. (d)", "ltMax", fmt], ["Medidos", "ltN", fmt], [`% > ${CONFIG.LT_LIMITE} d`, "pctLt30", pOpt]] }),
  },
  mLtMes: {
    size: "md", focus: false,
    title: "Lead time de compra por mes", sub: "Promedio de días orden → guía",
    info: { what: "Si las compras llegan más rápido o más lento con el tiempo.", how: "Promedio de (Fecha Guía − Fecha Orden) de los ingresos de cada mes." },
    build(d, t) {
      const P = d.meses.filter((p) => p.ltN > 0);
      return {
        empty: !P.length, emptyMsg: "No hay ingresos con fecha de orden en vista.",
        config: {
          type: "line",
          data: { labels: P.map((p) => p.label), datasets: [lineDs(t, "Lead time", P.map((p) => p.ltProm), t.series[6], { fill: true })] },
          options: merge(baseOptions(t, { min: 0, suggestedMax: CONFIG.LT_LIMITE * 1.2, axisFmt: (v) => fmt(v) + " d", padTop: 22 }), {
            plugins: { coreCross: { enabled: true }, coreRef: { lines: [{ axis: "y", value: CONFIG.LT_LIMITE, label: `${CONFIG.LT_LIMITE} d` }] },
              tooltip: { callbacks: { label: (c) => ` Lead time: ${fmtD(c.parsed.y)}`, afterLabel: (c) => { const p = P[c.dataIndex]; return [`Máximo: ${fmt(p.ltMax)} d · ${fmt(p.ltN)} ingresos`]; } } } },
          }),
        },
        table: { head: [{ t: "Mes" }, { t: "LT prom. (d)", num: 1 }, { t: "LT máx. (d)", num: 1 }, { t: "Medidos", num: 1 }], rows: P.map((p) => [cell(p.key, () => p.label), cell(p.ltProm, nOpt(1)), cell(p.ltMax, fmt), cell(p.ltN, fmt)]), conds: P.map((p) => [{ dim: "mesKey", value: p.key, label: p.label }]) },
        drill: mesDrill(P),
      };
    },
  },
  mLtDist: {
    size: "md", focus: true,
    title: "Distribución del lead time de compra", sub: "Ingresos por rango de días",
    info: { what: "Cuántas compras llegan en una semana, en un mes o tardan más.", how: "Cada ingreso con orden se ubica en un rango según (Fecha Guía − Fecha Orden)." },
    build: (d, t) => histo(t, { bins: binsDe(state.vista, "_ltBin"), dim: "_ltBin", name: "Ingresos", unit: "ingresos", colName: "Lead time", color: t.series[6], emptyMsg: "No hay ingresos con fecha de orden en vista." }),
  },
  mDiasOC: {
    size: "md", focus: true,
    title: "Días entre aprobación de la OC y entrega", sub: "Movimientos por rango de días",
    info: { what: "Cuánto tiempo pasa entre que se aprueba la orden de compra y la fecha de entrega pactada.", how: "Fecha de Entrega OC − Fecha Aprobación OC. En el detalle del cursor: el promedio." },
    build(d, t) {
      const r = histo(t, { bins: binsDe(state.vista, "_docBin"), dim: "_docBin", name: "Movimientos", unit: "movimientos", colName: "Días OC", color: t.series[4], emptyMsg: "No hay movimientos con fechas de aprobación y entrega de OC." });
      if (d.k.ocN) r.sub = `Promedio: ${fmtD(d.k.ocProm)}`;
      return r;
    },
  },
  mPartida: {
    size: "lg", focus: true,
    title: "Monto por partida de control", sub: "Soles",
    info: { what: "En qué partidas presupuestales se concentra el gasto.", how: "Suma de Parcial Neto MP por Partida de Control." },
    build: (d, t) => ranking(d, t, { list: d.partida.filter((x) => x.monto > 0), dim: "partida", key: "monto", name: "Monto", fmtV: fmtS2, axisFmt: fmtSC, endFmt: fmtSC, color: t.series[6], maxLabel: 34,
      extra: (x) => [`${fmtPct(pctDe(x.monto, d.k.monto) || 0)} del monto · ${fmt(x.n)} movimientos`],
      cols: [["Monto S/", "monto", fmtS2], ["Ingresos S/", "ing", fmtS2], ["Egresos S/", "egr", fmtS2], ["Movs.", "n", fmt]] }),
  },
  mN2: {
    size: "lg", focus: true,
    title: "Monto por recurso N2", sub: "Familia de recursos",
    info: { what: "Qué familias de recursos mueven más dinero.", how: "Suma del parcial neto por Recurso N2." },
    build: (d, t) => ranking(d, t, { list: d.n2.filter((x) => x.monto > 0), dim: "recursoN2", key: "monto", name: "Monto", fmtV: fmtS2, axisFmt: fmtSC, endFmt: fmtSC, colorFn: (x) => colorOf("recursoN2", x.label, t), maxLabel: 34,
      extra: (x) => [`${fmtPct(pctDe(x.monto, d.k.monto) || 0)} del monto · ${fmt(x.n)} movimientos`],
      cols: [["Monto S/", "monto", fmtS2], ["Movs.", "n", fmt], ["Recursos", "recursos", fmt]] }),
  },
  mTopRec: {
    size: "xl", focus: true,
    title: "Recursos con mayor monto movido", sub: "Ingresos + egresos (S/)",
    info: { what: "Los recursos que más plata movieron.", how: "Suma del parcial neto (ingresos y egresos) por Código Recurso. En el detalle: cantidad movida y precio promedio." },
    build: (d, t) => ranking(d, t, { list: d.rec.filter((x) => x.monto > 0), dim: "codigo", key: "monto", name: "Monto", fmtV: fmtS2, axisFmt: fmtSC, endFmt: fmtSC, labelFn: recLabel, titleFn: recTitle, condFn: recCond, colName: "Recurso", maxLabel: 34, color: t.series[0],
      extra: (x) => [`Ingresos: ${fmtS(x.ing)} · Egresos: ${fmtS(x.egr)}`, `Cantidad: ${fmt(x.cant, 2)} ${x.unidad} · precio prom.: S/ ${fmt(x.precioProm, 2)}`],
      cols: [["Monto S/", "monto", fmtS2], ["Ingresos S/", "ing", fmtS2], ["Egresos S/", "egr", fmtS2], ["Movs.", "n", fmt]] }),
  },
  mPrecio: {
    size: "lg", focus: true,
    title: "Precio promedio por recurso", sub: "Soles por unidad · los más caros",
    info: { what: "Qué recursos tienen el precio unitario más alto.", how: "Promedio de Precio (S/) Unitario de las líneas del recurso con precio mayor a 0." },
    build: (d, t) => ranking(d, t, { list: d.rec.filter((x) => x.precioProm > 0).sort((a, b) => b.precioProm - a.precioProm), dim: "codigo", key: "precioProm", name: "Precio prom.", fmtV: (v) => "S/ " + fmt(v, 2), axisFmt: fmtSC, endFmt: fmtSC, labelFn: recLabel, titleFn: recTitle, condFn: recCond, colName: "Recurso", maxLabel: 34, color: t.series[6],
      extra: (x) => [`Unidad: ${x.unidad} · ${fmt(x.n)} movimientos`],
      cols: [["Precio prom.", "precioProm", nOpt(2)], ["Movs.", "n", fmt], ["Monto S/", "monto", fmtS2]] }),
  },
  mUneg: {
    size: "lg", focus: true,
    title: "Ingresos y egresos por unidad de negocio", sub: "Soles",
    info: { what: "Qué unidad de negocio recibe y consume más material.", how: "Suma de Parcial (S/) Neto por Unidad de negocio, separando Movimiento = Ingreso y Egreso." },
    build: (d, t) => grouped(d, t, { list: d.uneg, dim: "uneg", fmtV: fmtS2,
      series: [{ key: "ing", name: "Ingresos", color: t.ing }, { key: "egr", name: "Egresos", color: t.egr }],
      extra: (x) => [`${fmt(x.n)} movimientos · ${fmt(x.proyectos)} proyectos`],
      cols: [["Ingresos S/", "ing", fmtS2], ["Egresos S/", "egr", fmtS2], ["Movs.", "n", fmt], ["Proyectos", "proyectos", fmt]] }),
  },
  mProy: {
    size: "xl", focus: true,
    title: "Proyectos con más monto movido", sub: "Ingresos + egresos (S/)",
    info: { what: "Qué proyectos concentran la actividad del almacén.", how: "Suma de Parcial (S/) Neto por Proyecto. En el detalle: unidad de negocio, ingresos, egresos y saldo." },
    build: (d, t) => ranking(d, t, { list: d.proy.filter((x) => x.monto > 0), dim: "proyecto", key: "monto", name: "Monto", fmtV: fmtS2, axisFmt: fmtSC, endFmt: fmtSC, color: t.series[0], maxLabel: 34,
      extra: (x) => [`Unidad: ${x._rows[0].uneg}`, `Ingresos: ${fmtS(x.ing)} · Egresos: ${fmtS(x.egr)}`],
      cols: [["Monto S/", "monto", fmtS2], ["Ingresos S/", "ing", fmtS2], ["Egresos S/", "egr", fmtS2], ["Movs.", "n", fmt]] }),
  },
  mProySaldo: {
    size: "xl", focus: true,
    title: "Saldo neto por proyecto", sub: "Ingresos − egresos (S/)",
    info: { what: "Qué proyectos recibieron más de lo que consumieron (acumulan material) y cuáles al revés.", how: "Suma de ingresos − suma de egresos del parcial neto por Proyecto. Verde: acumula; naranja: consumió más de lo que ingresó." },
    build: (d, t) => ranking(d, t, { list: d.proy.filter((x) => Math.abs(x.neto) > CONFIG.TOL_VALOR).sort((a, b) => Math.abs(b.neto) - Math.abs(a.neto)), dim: "proyecto", key: "neto", name: "Saldo neto", fmtV: (v) => signo(v, fmtS2), axisFmt: fmtSC, endFmt: (v) => signo(v, fmtSC), padLeft: 46, maxLabel: 34,
      colorFn: (x) => (x.neto >= 0 ? t.ing : t.egr),
      extra: (x) => [`Ingresos: ${fmtS(x.ing)} · Egresos: ${fmtS(x.egr)}`],
      cols: [["Saldo S/", "neto", fmtS2], ["Ingresos S/", "ing", fmtS2], ["Egresos S/", "egr", fmtS2]] }),
  },
  mTransf: {
    size: "xl", focus: true,
    title: "Transferencias internas que no netean", sub: "Ingresos − egresos por transferencia (S/)",
    info: (ds) => ({ what: `Transferencias entre almacenes ${ds.hlc ? "o proyectos" : ""} cuyo ingreso y egreso no se compensan.`, how: `Se toman los movimientos de transferencia (códigos como ${ds.hlc ? "E TI / I TI" : "I TE / E TEP"} o descripción «transferencia»; regla en CONFIG.TRANSF). Neto = ingresos − egresos por ${ds.hlc ? "proyecto" : "recurso"}. Debería ser 0: lo que queda indica transferencias abiertas o mal registradas.` }),
    build(d, t) {
      const ds = DS();
      const rows = state.vista.filter((r) => r._transf);
      const by = ds.hlc ? "proyecto" : "_id";
      const L = Array.from(groupBy(rows, (r) => r[by]).entries()).map(([label, v]) => ({ label, nombre: v[0]._nombre, codigo: v[0].codigo, ...ENGINE_MOV.agg(v) }))
        .filter((x) => Math.abs(x.tNeto) > CONFIG.TOL_VALOR).sort((a, b) => Math.abs(b.tNeto) - Math.abs(a.tNeto));
      const r = ranking(d, t, { list: L, dim: ds.hlc ? "proyecto" : "codigo", key: "tNeto", name: "Neto", fmtV: (v) => signo(v, fmtS2), axisFmt: fmtSC, endFmt: (v) => signo(v, fmtSC), padLeft: 46, maxLabel: 34,
        labelFn: ds.hlc ? undefined : recLabel, titleFn: ds.hlc ? undefined : recTitle, condFn: (x) => [ds.hlc ? { dim: "proyecto", value: x.label } : recCond(x)[0], { dim: "transf", value: true, label: "Transferencias" }],
        colName: ds.hlc ? "Proyecto" : "Recurso", colorFn: (x) => (x.tNeto >= 0 ? t.ing : t.egr),
        emptyMsg: rows.length ? "Todas las transferencias en vista netean a cero." : "No hay movimientos de transferencia en vista.",
        extra: (x) => [`Ingresó: ${fmtS(x.tIng)} · salió: ${fmtS(x.tEgr)}`, `${fmt(x.nTransf)} movimientos`],
        cols: [["Neto S/", "tNeto", fmtS2], ["Ingreso S/", "tIng", fmtS2], ["Egreso S/", "tEgr", fmtS2], ["Movs.", "nTransf", fmt]] });
      if (rows.length) r.sub = `Neto total: ${signo(d.k.tNeto, fmtS2)} en ${fmt(d.k.nTransf)} movimientos`;
      return r;
    },
  },
  mMovMes: {
    size: "md", focus: true,
    title: "Cantidad de movimientos por mes", sub: "Líneas de ingreso y egreso",
    info: { what: "Cuánta actividad tiene el almacén cada mes, más allá del monto.", how: "Cantidad de filas por mes, apiladas por ingreso y egreso." },
    build(d, t) {
      const P = d.meses;
      return {
        empty: !P.length,
        config: {
          type: "bar",
          data: { labels: P.map((p) => p.label), datasets: [barDs(t, "Ingresos", P.map((p) => p.nIng), t.ing, { stacked: true, thick: 34 }), barDs(t, "Egresos", P.map((p) => p.nEgr), t.egr, { stacked: true, thick: 34 })] },
          options: merge(baseOptions(t, { legend: true, stacked: true, axisFmt: (v) => fmt(v), mode: "index" }), {
            plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y)}`, footer: (items) => `Total: ${fmt(P[items[0].dataIndex].n)} movimientos` } } },
          }),
        },
        table: { head: [{ t: "Mes" }, { t: "Ingresos", num: 1 }, { t: "Egresos", num: 1 }, { t: "Total", num: 1 }], rows: P.map((p) => [cell(p.key, () => p.label), cell(p.nIng, fmt), cell(p.nEgr, fmt), cell(p.n, fmt)]), conds: P.map((p) => [{ dim: "mesKey", value: p.key, label: p.label }]) },
        drill: mesDrill(P),
      };
    },
  },
  mTipoAlm: {
    size: "donut", focus: true,
    title: "Monto por tipo de almacén", sub: "Participación en el monto movido",
    info: { what: "Qué tipo de almacén concentra los movimientos.", how: "Suma de Parcial (S/) Neto por Tipo de almacén ÷ monto total." },
    build: (d, t) => donut(d, t, { list: fold(d.tipoAlm, 6, ["monto", "n"]), key: "monto", name: "Monto", dim: "tipoAlm", fmtV: fmtS2, legendFmt: fmtSC,
      extra: (x) => [`${fmt(x.n)} movimientos`], center: () => ({ title: fmt(d.tipoAlm.length), sub: "tipos de almacén" }), cols: [["Movs.", "n", fmt]] }),
  },
  mRegistra: {
    size: "lg", focus: true,
    title: "Movimientos por registrador", sub: "Guías registradas por persona",
    info: { what: "Quién registra las guías de almacén y cuánta carga tiene cada uno.", how: "Cantidad de movimientos por Registra Guía. En el detalle: monto y % con observación." },
    build: (d, t) => ranking(d, t, { list: d.registra, dim: "registra", key: "n", name: "Movimientos", fmtV: fmt, endFmt: (v) => fmt(v), color: t.series[2], maxLabel: 30,
      extra: (x) => [`Monto: ${fmtS(x.monto)} · con observación: ${fmtPct(x.pctObs)}`],
      cols: [["Movs.", "n", fmt], ["Monto S/", "monto", fmtS2], ["% con obs.", "pctObs", pOpt]] }),
  },
  mSolic: {
    size: "lg", focus: true,
    title: "Movimientos por solicitante del pedido", sub: "Quién pide los activos",
    info: { what: "Qué personas generan más pedidos.", how: "Cantidad de movimientos por Solicitante Pedido. En el detalle: monto y recursos distintos." },
    build: (d, t) => ranking(d, t, { list: d.solic, dim: "solicitante", key: "n", name: "Movimientos", fmtV: fmt, endFmt: (v) => fmt(v), color: t.series[5], maxLabel: 30,
      extra: (x) => [`Monto: ${fmtS(x.monto)} · ${fmt(x.recursos)} recursos`],
      cols: [["Movs.", "n", fmt], ["Monto S/", "monto", fmtS2], ["Recursos", "recursos", fmt]] }),
  },

  /* ======================= VALORIZACIÓN POR PROYECTO ======================= */
  vPuente: {
    size: "lg", focus: false,
    title: "Del stock inicial al stock final", sub: "Soles del año · todos los proyectos en vista",
    info: { what: "Cómo se pasa del stock inicial al final del año.", how: "STOCK INICIAL (S/) + INGRESO (S/) − EGRESO (S/). Si no coincide con STOCK (S/) FIN, aparece la barra gris «Diferencia» (ver «Control contable»)." },
    build(d, t) {
      const k = d.k, dif = k.vFin - k.calc;
      const steps = [{ label: "Stock inicial", value: k.vIni, kind: "total", color: rgba(t.stock, 0.55) }, { label: "Ingresos", value: k.vIng, kind: "up" }, { label: "Egresos", value: k.vEgr, kind: "down", note: k.pctEgrIng != null ? `${fmtPct(k.pctEgrIng)} de lo ingresado` : "" }];
      if (Math.abs(dif) > CONFIG.TOL_VALOR) steps.push({ label: "Diferencia", value: dif, kind: "adj", note: "Stock final informado − calculado" });
      steps.push({ label: "Stock final", value: k.vFin, kind: "total", note: k.pctVar != null ? `Variación: ${signo(k.var)} (${signo(k.pctVar, (x) => fmt(x, 1) + " %")})` : "" });
      return puente(t, steps);
    },
  },
  vTipo: {
    size: "donut", focus: true,
    title: "Stock final por tipo de proyecto", sub: "Prefijo del código (GC, GF, GI, GM, ID…)",
    info: { what: "Cómo se reparte el stock final entre tipos de proyecto.", how: "El tipo es el prefijo de letras del CENTRO DE COSTOS Y PROYECTO. Suma de STOCK (S/) FIN por tipo." },
    build: (d, t) => donut(d, t, { list: d.tipo, key: "vFin", name: "Stock final", dim: "tipo", fmtV: fmtS2, legendFmt: fmtSC,
      extra: (x) => [`${fmt(x.n)} proyectos · egreso ${fmtS(x.vEgr)}`], center: () => ({ title: fmtSC(d.k.vFin), sub: "stock final" }), cols: [["Proyectos", "n", fmt]] }),
  },
  vTopFin: {
    size: "lg", focus: true,
    title: "Proyectos con mayor stock final", sub: "STOCK (S/) FIN",
    info: { what: "Qué proyectos terminaron el año con más material valorizado.", how: "STOCK (S/) FIN por CENTRO DE COSTOS Y PROYECTO, de mayor a menor." },
    build: (d, t) => ranking(d, t, { list: d.proy.filter((x) => x.vFin > 0), dim: "proyecto", key: "vFin", name: "Stock final", fmtV: fmtS2, axisFmt: fmtSC, endFmt: fmtSC, color: t.stock, maxLabel: 34,
      extra: (x) => [`${fmtPct(pctDe(x.vFin, d.k.vFin) || 0)} del total`, `Variación: ${signo(x.var)}`],
      cols: [["Stock final S/", "vFin", fmtS2], ["Stock inicial S/", "vIni", fmtS2], ["Variación S/", "var", fmtS2]] }),
  },
  vPart: {
    size: "lg", focus: true,
    title: "Participación en el stock final", sub: "% de cada proyecto · acumulado en el detalle",
    info: { what: "Cuánto del stock final explica cada proyecto y cuánto suman los primeros.", how: "STOCK (S/) FIN del proyecto ÷ STOCK (S/) FIN total × 100. El detalle del cursor muestra el % acumulado hasta ese proyecto." },
    build(d, t) {
      const tot = d.k.vFin || 1;
      let acc = 0;
      const L = d.proy.filter((x) => x.vFin > 0).map((x) => { acc += x.vFin; return { ...x, part: (x.vFin / tot) * 100, cum: (acc / tot) * 100 }; });
      return ranking(d, t, { list: L, dim: "proyecto", key: "part", name: "Participación", fmtV: fmtPct, axisFmt: (v) => v + " %", endFmt: (v) => fmt(v, 1) + " %", color: t.series[6], maxLabel: 34, min: 0,
        extra: (x) => [`Acumulado: ${fmtPct(x.cum)}`, `Stock final: ${fmtS(x.vFin)}`],
        cols: [["% part.", "part", pOpt], ["% acumulado", "cum", pOpt], ["Stock final S/", "vFin", fmtS2]] });
    },
  },
  vTopEgr: {
    size: "lg", focus: true,
    title: "Proyectos con mayor egreso", sub: "EGRESO (S/) del año",
    info: { what: "Qué proyectos consumieron más material.", how: "EGRESO (S/) por proyecto. En el detalle: % de egreso sobre ingreso." },
    build: (d, t) => ranking(d, t, { list: [...d.proy].filter((x) => x.vEgr > 0).sort((a, b) => b.vEgr - a.vEgr), dim: "proyecto", key: "vEgr", name: "Egreso", fmtV: fmtS2, axisFmt: fmtSC, endFmt: fmtSC, color: t.egr, maxLabel: 34,
      emptyMsg: "Ningún proyecto en vista tuvo egresos.",
      extra: (x) => [`Ingreso: ${fmtS(x.vIng)} · egreso/ingreso: ${x.pctEgrIng != null ? fmtPct(x.pctEgrIng) : "—"}`],
      cols: [["Egreso S/", "vEgr", fmtS2], ["Ingreso S/", "vIng", fmtS2], ["Egr./Ing. %", "pctEgrIng", pOpt]] }),
  },
  vIniFin: {
    size: "lg", focus: true,
    title: "Stock inicial vs. final por proyecto", sub: "Los proyectos de mayor stock",
    info: { what: "Qué proyectos crecieron y cuáles redujeron su stock.", how: "STOCK INICIAL (S/) y STOCK (S/) FIN por proyecto." },
    build: (d, t) => grouped(d, t, { list: d.proy.filter((x) => x.vFin || x.vIni), dim: "proyecto", horizontal: true, top: 10, fmtV: fmtS2, maxLabel: 30,
      series: [{ key: "vIni", name: "Stock inicial", color: rgba(t.stock, 0.45) }, { key: "vFin", name: "Stock final", color: t.stock }],
      extra: (x) => [`Variación: ${signo(x.var)}${x.pctVar != null ? ` (${signo(x.pctVar, (v) => fmt(v, 1) + " %")})` : ""}`],
      cols: [["Inicial S/", "vIni", fmtS2], ["Final S/", "vFin", fmtS2], ["Variación S/", "var", fmtS2], ["Var. %", "pctVar", pOpt]] }),
  },
  vVar: {
    size: "lg", focus: true,
    title: "Variación de stock por proyecto", sub: "Stock final − stock inicial (S/)",
    info: { what: "Qué proyectos acumularon o liberaron stock en el año.", how: "STOCK (S/) FIN − STOCK INICIAL (S/). Azul: creció; naranja: bajó." },
    build: (d, t) => ranking(d, t, { list: d.proy.filter((x) => Math.abs(x.var) > CONFIG.TOL_VALOR).sort((a, b) => Math.abs(b.var) - Math.abs(a.var)), dim: "proyecto", key: "var", name: "Variación", fmtV: (v) => signo(v, fmtS2), axisFmt: fmtSC, endFmt: (v) => signo(v, fmtSC), padLeft: 46, maxLabel: 34,
      colorFn: (x) => (x.var >= 0 ? t.stock : t.egr), emptyMsg: "Ningún proyecto en vista cambió su stock.",
      extra: (x) => [`${fmtS(x.vIni)} → ${fmtS(x.vFin)}`, x.pctVar != null ? `Variación: ${signo(x.pctVar, (v) => fmt(v, 1) + " %")}` : "Sin stock inicial"],
      cols: [["Variación S/", "var", fmtS2], ["Var. %", "pctVar", pOpt]] }),
  },
  vRotP: {
    size: "lg", focus: true,
    title: "Rotación por proyecto", sub: "Egreso ÷ stock promedio",
    info: { what: "Qué proyectos consumen rápido su stock y cuáles lo tienen parado.", how: "Rotación = EGRESO (S/) ÷ ((STOCK INICIAL + STOCK FIN) ÷ 2). Solo proyectos con stock promedio de al menos S/ " + CONFIG.ROT_MIN_PROM + " (si el stock es casi 0, la rotación se dispara y no es comparable)." },
    build: (d, t) => ranking(d, t, { list: d.proy.filter((x) => x.rot > 0).sort((a, b) => b.rot - a.rot), dim: "proyecto", key: "rot", name: "Rotación", fmtV: fmtX, axisFmt: (v) => fmt(v, 1) + "×", endFmt: (v) => fmt(v, 1) + "×", color: t.series[4], maxLabel: 34,
      ref: d.k.rot ? { value: d.k.rot, label: `Global ${fmt(d.k.rot, 1)}×` } : undefined,
      emptyMsg: "Ningún proyecto en vista tuvo egresos con stock.",
      extra: (x) => [`Egreso: ${fmtS(x.vEgr)} · stock prom.: ${fmtS((x.vIni + x.vFin) / 2)}`],
      cols: [["Rotación", "rot", nOpt(2)], ["Egreso S/", "vEgr", fmtS2]] }),
  },
  vDiff: {
    size: "lg", focus: true,
    title: "Diferencias de la validación contable", sub: "Stock final real − calculado (S/)",
    info: { what: "Proyectos cuyo stock final no coincide con inicial + ingreso − egreso.", how: `Diferencia = STOCK (S/) FIN − (STOCK INICIAL + INGRESO − EGRESO). Se muestran las mayores a S/ ${CONFIG.TOL_VALOR}.` },
    build: (d, t) => ranking(d, t, { list: d.proy.filter((x) => x.nDiff).map((x) => ({ ...x, dif: x.diff })).sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif)), dim: "proyecto", key: "dif", name: "Diferencia", fmtV: (v) => signo(v, fmtS2), axisFmt: fmtSC, endFmt: (v) => signo(v, fmtSC), padLeft: 46, maxLabel: 34,
      colorFn: () => t.series[1], emptyMsg: "Todos los proyectos cuadran: stock inicial + ingreso − egreso = stock final.",
      extra: (x) => [`Calculado: ${fmtS2(x.calc)} · real: ${fmtS2(x.vFin)}`],
      cols: [["Diferencia S/", "dif", fmtS2], ["Calculado S/", "calc", fmtS2], ["Real S/", "vFin", fmtS2]] }),
  },
  vIngEgr: {
    size: "lg", focus: true,
    title: "Ingreso vs. egreso por proyecto", sub: "Arriba de la diagonal: egresó más de lo que ingresó",
    info: { what: "Qué proyectos consumieron más de lo que recibieron en el año (bajaron stock).", how: "Cada punto es un proyecto: horizontal = INGRESO (S/), vertical = EGRESO (S/). Naranja: egreso > ingreso.", tip: "Clic en un punto para ver el proyecto." },
    build(d, t) {
      const L = d.proy.filter((x) => x.vIng > 0 || x.vEgr > 0);
      const max = Math.max(1, ...L.map((x) => Math.max(x.vIng, x.vEgr)));
      const cols = L.map((x) => (x.vEgr > x.vIng ? t.egr : t.ing));
      return {
        empty: !L.length, emptyMsg: "Ningún proyecto en vista tuvo ingresos ni egresos.",
        sub: `${fmt(d.k.egrMayor)} proyectos egresaron más de lo que ingresaron`,
        config: {
          type: "scatter",
          data: { datasets: [
            { label: "Proyectos", data: L.map((x) => ({ x: x.vIng, y: x.vEgr })), backgroundColor: focusColor(cols, "index"), borderColor: t.surface, borderWidth: 1, pointRadius: 6, pointHoverRadius: 9 },
            { type: "line", label: "Ingreso = egreso", data: [{ x: 0, y: 0 }, { x: max, y: max }], borderColor: t.ink3, borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, pointHitRadius: 0, fill: false },
          ] },
          options: merge(baseOptions(t, { axisFmt: fmtSC, mode: "nearest" }), {
            interaction: { mode: "nearest", intersect: true },
            scales: { x: { type: "linear", beginAtZero: true, grid: { color: t.grid }, ticks: { color: t.ink3, callback: (v) => fmtSC(v) }, title: { display: true, text: "Ingreso (S/)", color: t.ink3 } }, y: { beginAtZero: true, title: { display: true, text: "Egreso (S/)", color: t.ink3 } } },
            plugins: { tooltip: { filter: (c) => c.datasetIndex === 0, callbacks: { title: (it) => L[it[0].dataIndex].label, label: (c) => [` Ingreso: ${fmtS2(c.parsed.x)}`, ` Egreso: ${fmtS2(c.parsed.y)}`] } } },
          }),
        },
        table: {
          head: [{ t: "Proyecto" }, { t: "Ingreso S/", num: 1 }, { t: "Egreso S/", num: 1 }, { t: "Egr. − ing. S/", num: 1 }],
          rows: L.map((x) => [x.label, cell(x.vIng, fmtS2), cell(x.vEgr, fmtS2), cell(x.vEgr - x.vIng, fmtS2)]),
          conds: L.map((x) => [{ dim: "proyecto", value: x.label }]), searchable: L.length > 20, pageSize: 25,
        },
        drill: (e) => { if (e.datasetIndex) return null; const x = L[e.index]; return x && [{ dim: "proyecto", value: x.label }]; },
      };
    },
  },
};

/* =========================== TABLAS =========================== */
// Columnas reutilizables del detalle: [encabezado, valor, formato, numérica]
const COLS_MOV = {
  item: ["Ítem", (r) => r.item, nOpt(), 1],
  detalleIE: ["Detalle I/E", (r) => r.detalleIE || "—"],
  uneg: ["Unidad de negocio", (r) => r.uneg],
  proyecto: ["Proyecto", (r) => r.proyecto],
  tipoAlm: ["Tipo almacén", (r) => r.tipoAlm],
  almacen: ["Almacén", (r) => r.almacen],
  tipoMov: ["Tipo Mov.", (r) => r.tipoMov],
  dirHLC: ["Movimiento", (r) => r.tipoMov],
  mov: ["Movimiento", (r) => r.mov],
  movHLC: ["Tipo de movimiento", (r) => r.mov],
  movDesc: ["Descripción", (r) => r.movDesc || "—"],
  guia: ["Nro. guía", (r) => r.guia || "—"],
  fecha: ["Fecha guía", (r) => r.fecha, fdia],
  mes: ["Período", (r) => r._m, (v) => (v ? mesLabel(v, true) : "—")],
  destino: ["Destino / solicitante", (r) => r.destino],
  codigo: ["Código", (r) => r.codigo || "—"],
  recurso: ["Recurso", (r) => r.recurso || "—"],
  unidad: ["Unidad", (r) => r.unidad || "—"],
  cant: ["Cantidad", (r) => r.cant, nOpt(2), 1],
  precio: ["Precio", (r) => r.precio, nOpt(2), 1],
  monto: ["Parcial neto S/", (r) => r.monto, nOpt(2), 1],
  proveedor: ["Proveedor", (r) => r.proveedor],
  orden: ["Nro. orden", (r) => r.orden || "—"],
  fechaOrden: ["Fecha orden", (r) => r.fechaOrden, fdia],
  fechaEntOC: ["Fecha entrega OC", (r) => r.fechaEntOC, fdia],
  partida: ["Partida de control", (r) => r.partida],
  recursoN2: ["Recurso N2", (r) => r.recursoN2],
  registra: ["Registra guía", (r) => r.registra],
  solicitante: ["Solicitante pedido", (r) => r.solicitante],
  obs: ["Observación", (r) => r.obs || "—"],
  lt: ["Lead time compra (d)", (r) => r._lt, nOpt(), 1],
};
const DET_MOV = {
  "kf-ie": ["item", "tipoAlm", "almacen", "tipoMov", "mov", "guia", "fecha", "mes", "codigo", "recurso", "unidad", "cant", "precio", "monto", "proveedor", "orden", "fechaOrden", "fechaEntOC", "partida", "recursoN2", "lt"],
  "alm-ie": ["item", "tipoAlm", "almacen", "tipoMov", "mov", "guia", "fecha", "mes", "destino", "codigo", "recurso", "unidad", "cant", "precio", "monto", "recursoN2", "registra", "solicitante", "obs"],
  "hlc-ie": ["detalleIE", "uneg", "proyecto", "almacen", "dirHLC", "movHLC", "movDesc", "guia", "fecha", "codigo", "recurso", "unidad", "cant", "precio", "monto", "proveedor", "orden", "recursoN2", "tipoAlm", "obs"],
};
function accionSugerida(r) {
  if (Math.abs(r.sAct) < 1e-9 && Math.abs(r.vAct) > CONFIG.TOL_VALOR) return "Regularizar valorización (stock 0 con valor)";
  if (r._obs) return r.vAct >= CONFIG.INMOV_ALTO ? "Gestionar baja contable o venta por remate" : "Dar de baja y desechar según procedimiento";
  return r.vAct >= CONFIG.INMOV_ALTO ? "Ofrecer a otros proyectos o vender" : "Confirmar uso previsto y congelar reposición";
}

const TLIB = {
  /* ---------- Kardex ---------- */
  tDetK: {
    title: "Detalle del kardex", sub: "Tabla 1 · una línea por recurso y almacén · buscá por cualquier texto",
    info: { what: "El kardex completo, ya limpio y filtrado.", how: "Valor unitario promedio = Stock Actual (S/) ÷ Stock Actual. Rotación = Egreso (S/) ÷ stock promedio (S/). Sin movimiento: cantidad ingreso y egreso en 0. Obsoleto: almacén de vencidos u obsoletos." },
    table() {
      const ds = DS(), conTipo = ds.dims.some((x) => x[0] === "tipoAlm"), flags = ds.key !== "kf-fv", flagObs = ds.key === "alm-ku" || ds.key === "alm-km";
      const n2 = nOpt(2);
      const cols = [
        { t: "Ítem", num: 1, get: (r) => r.item, f: nOpt() },
        ...(conTipo ? [{ t: "Tipo de almacén", get: (r) => r.tipoAlm }] : []),
        { t: "Descripción almacén", get: (r) => r.almacen }, { t: "Código", get: (r) => r.codigo || "—" }, { t: term(0, true), get: (r) => r._nombre }, { t: "Unidad", get: (r) => r.unidad },
        { t: "Stock inicial", num: 1, get: (r) => r.sIni, f: n2 }, { t: "Cant. ingreso", num: 1, get: (r) => r.cIng, f: n2 }, { t: "Cant. egreso", num: 1, get: (r) => r.cEgr, f: n2 }, { t: "Stock actual", num: 1, get: (r) => r.sAct, f: n2 },
        { t: "Stock inicial S/", num: 1, get: (r) => r.vIni, f: n2 }, { t: "Ingreso S/", num: 1, get: (r) => r.vIng, f: n2 }, { t: "Egreso S/", num: 1, get: (r) => r.vEgr, f: n2 }, { t: "Stock actual S/", num: 1, get: (r) => r.vAct, f: n2 },
        { t: "VU prom. S/", num: 1, get: (r) => r._vu, f: n2 }, { t: "Rotación", num: 1, get: (r) => r._rot, f: n2 },
        ...(flags ? [{ t: "Sin movimiento", get: (r) => si(r._sinMov) }] : []), ...(flagObs ? [{ t: "Obsoleto", get: (r) => si(r._obs) }] : []),
      ];
      return { src: state.vista, cols, condFn: (r) => [{ dim: "codigo", value: r._id, label: r._nombre }], searchable: true, pageSize: CONFIG.PAGE_SIZE, defaultSort: { col: 0, dir: "asc" } };
    },
  },
  tAlmK: {
    title: "Resumen por almacén", sub: "Tabla 2 · ordená por cualquier columna · clic en una fila para ver el detalle",
    info: { what: "Todos los indicadores de cada almacén en una tabla.", how: "Recursos distintos = códigos distintos. Stock total und = suma de Stock Actual (mezcla unidades distintas: úsalo como referencia). % sin movimiento = líneas sin ingreso ni egreso ÷ líneas. % obsoleto = stock obsoleto (S/) ÷ stock del almacén (S/)." },
    table(d) {
      const obs = DS().key === "alm-ku" || DS().key === "alm-km";
      return {
        head: [{ t: "Descripción almacén" }, { t: "Recursos distintos", num: 1 }, { t: "Stock total und", num: 1 }, { t: "Stock total S/", num: 1, bar: 1 }, { t: "Ingreso S/", num: 1 }, { t: "Egreso S/", num: 1 }, { t: "% sin movimiento", num: 1 }, ...(obs ? [{ t: "% obsoleto", num: 1 }] : [])],
        rows: d.alm.map((x) => [x.label, cell(x.recursos, fmt), cell(x.sAct, nOpt(2)), cell(x.vAct, fmtS2), cell(x.vIng, fmtS2), cell(x.vEgr, fmtS2), cell(x.pctSinMov, pOpt), ...(obs ? [cell(x.pctObs, pOpt)] : [])]),
        conds: d.alm.map((x) => [{ dim: "almacen", value: x.label }]),
        searchable: d.alm.length > 20, pageSize: 25,
      };
    },
  },
  tRecK: {
    title: "Resumen por recurso", sub: "Tabla 3 · un recurso por fila sumando sus almacenes",
    info: { what: "Cada recurso con su stock, valor unitario, movimiento y rotación.", how: "Valor unitario promedio = Stock Actual (S/) ÷ Stock Actual. Rotación = Egreso (S/) ÷ ((Stock Inicial S/ + Stock Actual S/) ÷ 2)." },
    table: (d) => ({
      head: [{ t: "Código" }, { t: "Recurso" }, { t: "Unidad" }, { t: "Stock actual", num: 1 }, { t: "Stock actual S/", num: 1, bar: 1 }, { t: "VU prom. S/", num: 1 }, { t: "Ingreso S/", num: 1 }, { t: "Egreso S/", num: 1 }, { t: "Rotación", num: 1 }],
      rows: d.rec.map((x) => [x.codigo || "—", x.nombre, x.unidad, cell(x.sAct, nOpt(2)), cell(x.vAct, fmtS2), cell(x.vu, nOpt(2)), cell(x.vIng, fmtS2), cell(x.vEgr, fmtS2), cell(x.rot, nOpt(2))]),
      conds: d.rec.map(recCond), searchable: true, pageSize: 25,
    }),
  },
  tObsK: {
    title: "Materiales obsoletos e inmovilizados", sub: "Tabla 3 · con valor en stock · acción sugerida según reglas editables",
    info: { what: "Qué hacer con el stock que no se mueve o está vencido.", how: `Incluye líneas en almacenes de vencidos/obsoletos y líneas sin ingresos ni egresos, con valor. Acción sugerida: obsoleto ≥ S/ ${fmt(CONFIG.INMOV_ALTO)} → baja contable o remate; obsoleto menor → desechar; inmovilizado ≥ S/ ${fmt(CONFIG.INMOV_ALTO)} → ofrecer a otros proyectos o vender; menor → confirmar uso y congelar reposición; stock 0 con valor → regularizar. Umbral en CONFIG.INMOV_ALTO.` },
    table() {
      const L = state.vista.filter((r) => (r._obs || r._sinMov) && (Math.abs(r.vAct) > CONFIG.TOL_VALOR || r.sAct > 0)).sort((a, b) => b.vAct - a.vAct);
      return {
        head: [{ t: "Código" }, { t: "Recurso" }, { t: "Almacén" }, { t: "Estado" }, { t: "Stock actual", num: 1 }, { t: "Stock actual S/", num: 1, bar: 1 }, { t: "Acción sugerida" }],
        rows: L.map((r) => [r.codigo || "—", r._nombre, r.almacen, r._obs ? "Obsoleto / vencido" : "Inmovilizado", cell(r.sAct, nOpt(2)), cell(r.vAct, fmtS2), accionSugerida(r)]),
        conds: L.map((r) => [{ dim: "codigo", value: r._id, label: r._nombre }]),
        searchable: true, pageSize: 25, empty: "No hay stock obsoleto ni inmovilizado con valor en vista.",
      };
    },
  },
  tTopK: {
    title: "Top recursos por valor", sub: "Tabla 4 · ranking por stock actual (S/)",
    info: { what: "El ranking completo de recursos por valor de stock.", how: "Stock Actual (S/) sumando almacenes; % participación = stock del recurso ÷ stock total; rotación = egreso ÷ stock promedio." },
    table(d) {
      const L = d.rec.filter((x) => x.vAct > 0);
      return {
        head: [{ t: "Ranking", num: 1 }, { t: "Código" }, { t: "Recurso" }, { t: "Stock actual S/", num: 1, bar: 1 }, { t: "% participación", num: 1 }, { t: "Rotación", num: 1 }],
        rows: L.map((x, i) => [cell(i + 1, fmt), x.codigo || "—", x.nombre, cell(x.vAct, fmtS2), cell(pctDe(x.vAct, d.k.vAct), pOpt), cell(x.rot, nOpt(2))]),
        conds: L.map(recCond), searchable: true, pageSize: 25, defaultSort: { col: 0, dir: "asc" },
      };
    },
  },
  tTopA: {
    title: "Top activos por valor", sub: "Tabla 3 · ranking por stock actual (S/)",
    info: { what: "Los activos y tenencias que concentran el valor.", how: "Stock Actual (S/) sumando almacenes; % participación = valor del activo ÷ valor total." },
    table(d) {
      const L = d.rec.filter((x) => x.vAct > 0);
      return {
        head: [{ t: "Ranking", num: 1 }, { t: "Código" }, { t: "Activo" }, { t: "Almacén" }, { t: "Stock actual", num: 1 }, { t: "Stock actual S/", num: 1, bar: 1 }, { t: "% participación", num: 1 }],
        rows: L.map((x, i) => [cell(i + 1, fmt), x.codigo || "—", x.nombre, x.almTxt || "—", cell(x.sAct, nOpt(2)), cell(x.vAct, fmtS2), cell(pctDe(x.vAct, d.k.vAct), pOpt)]),
        conds: L.map(recCond), searchable: true, pageSize: 25, defaultSort: { col: 0, dir: "asc" },
      };
    },
  },

  /* ---------- Movimientos ---------- */
  tDetM: {
    title: "Detalle de movimientos", sub: "Tabla 1 · una fila por línea de guía · buscá por cualquier texto",
    info: (ds) => ({ what: "El registro completo de ingresos y egresos, filtrado.", how: `La cantidad respeta el signo del Excel (negativa en egresos); el parcial neto es siempre positivo.${ds.key === "kf-ie" ? " Lead time de compra = Fecha Guía − Fecha Orden (solo ingresos con orden)." : ""}` }),
    table() {
      const C = DET_MOV[state.ds].map((k) => COLS_MOV[k]);
      return {
        src: state.vista, cols: C.map((c) => ({ t: c[0], get: c[1], f: c[2], num: c[3] })),
        condFn: (r) => [{ dim: "codigo", value: r._id, label: r._nombre }],
        searchable: true, pageSize: CONFIG.PAGE_SIZE, defaultSort: { col: C.findIndex((c) => c[0] === "Fecha guía"), dir: "desc" },
      };
    },
  },
  tProvM: {
    title: "Resumen por proveedor", sub: "Tabla 2 · ordená por cualquier columna",
    info: { what: "Lo comprado a cada proveedor y cuánto tarda en entregar.", how: "Movimientos, ingresos y egresos del parcial neto por Proveedor. Lead time promedio = promedio de (Fecha Guía − Fecha Orden)." },
    table: (d) => ({
      head: [{ t: "Proveedor" }, { t: "RUC" }, { t: "Movimientos", num: 1 }, { t: "Total ingreso S/", num: 1, bar: 1 }, { t: "Total egreso S/", num: 1 }, { t: "Lead time prom. (d)", num: 1 }, { t: "Recursos distintos", num: 1 }],
      rows: d.prov.map((x) => [x.label, (x._rows.find((r) => r.ruc) || {}).ruc || "—", cell(x.n, fmt), cell(x.ing, fmtS2), cell(x.egr, fmtS2), cell(x.ltProm, nOpt(1)), cell(x.recursos, fmt)]),
      conds: d.prov.map((x) => [{ dim: "proveedor", value: x.label }]), searchable: true, pageSize: 25,
    }),
  },
  tAlmM: {
    title: "Resumen por almacén", sub: "Movimientos, ingresos y egresos",
    info: { what: "La actividad de cada almacén.", how: "Total S/ = ingresos + egresos del parcial neto. Recursos distintos = códigos distintos movidos." },
    table: (d) => ({
      head: [{ t: "Almacén" }, { t: "Movimientos", num: 1 }, { t: "Total S/", num: 1, bar: 1 }, { t: "Ingresos S/", num: 1 }, { t: "Egresos S/", num: 1 }, { t: "Recursos distintos", num: 1 }],
      rows: d.alm.map((x) => [x.label, cell(x.n, fmt), cell(x.monto, fmtS2), cell(x.ing, fmtS2), cell(x.egr, fmtS2), cell(x.recursos, fmt)]),
      conds: d.alm.map((x) => [{ dim: "almacen", value: x.label }]), searchable: d.alm.length > 20, pageSize: 25,
    }),
  },
  tTipoM: {
    title: "Resumen por tipo de movimiento", sub: "Cantidad, monto y participación de cada código",
    info: { what: "Qué representa cada código de movimiento.", how: "Descripción = la que trae el Excel para el código. % participación = monto del código ÷ monto total." },
    table: (d) => ({
      head: [{ t: dimLabel("mov") }, { t: "Descripción" }, { t: "Dirección" }, { t: "Movimientos", num: 1 }, { t: "Total S/", num: 1, bar: 1 }, { t: "% participación", num: 1 }],
      rows: d.tipo.map((x) => [x.label, x.desc || "—", x.nIng >= x.nEgr ? "Ingreso" : "Egreso", cell(x.n, fmt), cell(x.monto, fmtS2), cell(pctDe(x.monto, d.k.monto), pOpt)]),
      conds: d.tipo.map((x) => [{ dim: "mov", value: x.label }]),
    }),
  },
  tMesM: {
    title: "Resumen mensual", sub: "Ingresos, egresos y variación contra el mes anterior",
    info: { what: "La evolución mes a mes.", how: "Variación % = (mes − mes anterior) ÷ mes anterior × 100, para ingresos y egresos por separado." },
    table: (d) => ({
      head: [{ t: "Período" }, { t: "Ingresos S/", num: 1 }, { t: "Egresos S/", num: 1 }, { t: "Movimientos", num: 1 }, { t: "Var. ingresos %", num: 1 }, { t: "Var. egresos %", num: 1 }],
      rows: d.meses.map((p, i) => [cell(p.key, () => p.label), cell(p.ing, fmtS2), cell(p.egr, fmtS2), cell(p.n, fmt), cell(i ? varPct(p.ing, d.meses[i - 1].ing) : null, pOpt), cell(i ? varPct(p.egr, d.meses[i - 1].egr) : null, pOpt)]),
      conds: d.meses.map((p) => [{ dim: "mesKey", value: p.key, label: p.label }]),
    }),
  },
  tDestM: {
    title: "Resumen por destino / solicitante", sub: "Tabla 3",
    info: { what: "A dónde se despacha y cuánto.", how: "Movimientos, monto (parcial neto) y recursos distintos por Destino/Solicitante." },
    table: (d) => ({
      head: [{ t: "Destino / solicitante" }, { t: "Movimientos", num: 1 }, { t: "Total S/", num: 1, bar: 1 }, { t: "Recursos distintos", num: 1 }],
      rows: d.destino.map((x) => [x.label, cell(x.n, fmt), cell(x.monto, fmtS2), cell(x.recursos, fmt)]),
      conds: d.destino.map((x) => [{ dim: "destino", value: x.label }]), searchable: d.destino.length > 20, pageSize: 25,
    }),
  },
  tN2M: {
    title: "Resumen por recurso N2", sub: "Tabla 6",
    info: { what: "Monto y movimientos por familia de recurso.", how: "% participación = monto de la familia ÷ monto total." },
    table: (d) => ({
      head: [{ t: "Recurso N2" }, { t: "Movimientos", num: 1 }, { t: "Total S/", num: 1, bar: 1 }, { t: "% participación", num: 1 }],
      rows: d.n2.map((x) => [x.label, cell(x.n, fmt), cell(x.monto, fmtS2), cell(pctDe(x.monto, d.k.monto), pOpt)]),
      conds: d.n2.map((x) => [{ dim: "recursoN2", value: x.label }]),
    }),
  },
  tUnegM: {
    title: "Resumen por unidad de negocio", sub: "Tabla 2",
    info: { what: "La actividad de cada unidad de negocio.", how: "Movimientos, ingresos y egresos del parcial neto; proyectos y recursos distintos." },
    table: (d) => ({
      head: [{ t: "Unidad de negocio" }, { t: "Movimientos", num: 1 }, { t: "Total ingreso S/", num: 1, bar: 1 }, { t: "Total egreso S/", num: 1 }, { t: "Proyectos distintos", num: 1 }, { t: "Recursos distintos", num: 1 }],
      rows: d.uneg.map((x) => [x.label, cell(x.n, fmt), cell(x.ing, fmtS2), cell(x.egr, fmtS2), cell(x.proyectos, fmt), cell(x.recursos, fmt)]),
      conds: d.uneg.map((x) => [{ dim: "uneg", value: x.label }]),
    }),
  },
  tProyM: {
    title: "Resumen por proyecto", sub: "Tabla 3 · saldo neto = ingresos − egresos",
    info: { what: "Cada proyecto con lo que recibió, consumió y su saldo.", how: "Saldo neto = total ingreso − total egreso del parcial neto." },
    table: (d) => ({
      head: [{ t: "Proyecto" }, { t: "Unidad de negocio" }, { t: "Movimientos", num: 1 }, { t: "Total ingreso S/", num: 1 }, { t: "Total egreso S/", num: 1 }, { t: "Saldo neto S/", num: 1, bar: 1 }, { t: "Recursos distintos", num: 1 }],
      rows: d.proy.map((x) => [x.label, x._rows[0].uneg, cell(x.n, fmt), cell(x.ing, fmtS2), cell(x.egr, fmtS2), cell(x.neto, fmtS2), cell(x.recursos, fmt)]),
      conds: d.proy.map((x) => [{ dim: "proyecto", value: x.label }]), searchable: true, pageSize: 25,
    }),
  },

  /* ---------- Valorización ---------- */
  tDetV: {
    title: "Detalle por proyecto", sub: "Tabla 1 · importes, variación, rotación y validación",
    info: { what: "Cada centro de costos y proyecto del VALO_DET.", how: "Variación = stock final − inicial. % variación = variación ÷ inicial. Rotación = egreso ÷ stock promedio. Validación: OK si inicial + ingreso − egreso = final (± S/ " + CONFIG.TOL_VALOR + ")." },
    table: () => ({
      head: [{ t: "Ítem", num: 1 }, { t: "Centro de costos y proyecto" }, { t: "Stock inicial S/", num: 1 }, { t: "Ingreso S/", num: 1 }, { t: "Egreso S/", num: 1 }, { t: "Stock final S/", num: 1, bar: 1 }, { t: "Variación S/", num: 1 }, { t: "% variación", num: 1 }, { t: "Rotación", num: 1 }, { t: "Validación" }],
      rows: state.vista.map((r) => [cell(r.item, nOpt()), r.proyecto, cell(r.vIni, fmtS2), cell(r.vIng, fmtS2), cell(r.vEgr, fmtS2), cell(r.vFin, fmtS2), cell(r._var, fmtS2), cell(r._pctVar, pOpt), cell(r._rot, nOpt(2)), r._ok ? "OK" : "Diferencia " + signo(r._diff, fmtS2)]),
      conds: state.vista.map((r) => [{ dim: "proyecto", value: r.proyecto }]),
      searchable: true, pageSize: CONFIG.PAGE_SIZE, defaultSort: { col: 0, dir: "asc" },
    }),
  },
  tRankV: {
    title: "Ranking de proyectos", sub: "Tabla 2 · por stock final y por egreso",
    info: { what: "La posición de cada proyecto por stock final y por consumo.", how: "Ranking stock: 1 = mayor STOCK (S/) FIN. Ranking egreso: 1 = mayor EGRESO (S/)." },
    table(d) {
      const rkE = new Map([...d.proy].sort((a, b) => b.vEgr - a.vEgr).map((x, i) => [x.label, i + 1]));
      return {
        head: [{ t: "Centro de costos y proyecto" }, { t: "Stock final S/", num: 1, bar: 1 }, { t: "% participación", num: 1 }, { t: "Egreso S/", num: 1 }, { t: "Rotación", num: 1 }, { t: "Ranking stock", num: 1 }, { t: "Ranking egreso", num: 1 }],
        rows: d.proy.map((x, i) => [x.label, cell(x.vFin, fmtS2), cell(pctDe(x.vFin, d.k.vFin), pOpt), cell(x.vEgr, fmtS2), cell(x.rot, nOpt(2)), cell(i + 1, fmt), cell(rkE.get(x.label), fmt)]),
        conds: d.proy.map((x) => [{ dim: "proyecto", value: x.label }]), searchable: d.proy.length > 20, pageSize: 25,
      };
    },
  },
  tCtrlV: {
    title: "Control de validación", sub: "Tabla 3 · stock final calculado vs. real",
    info: { what: "La prueba contable proyecto por proyecto.", how: "Stock final calculado = STOCK INICIAL + INGRESO − EGRESO. Diferencia = real − calculado. OK si la diferencia no supera S/ " + CONFIG.TOL_VALOR + "." },
    table: () => ({
      head: [{ t: "Centro de costos y proyecto" }, { t: "Stock inicial S/", num: 1 }, { t: "Ingreso S/", num: 1 }, { t: "Egreso S/", num: 1 }, { t: "Stock final calculado S/", num: 1 }, { t: "Stock final real S/", num: 1 }, { t: "Diferencia S/", num: 1 }, { t: "Validación" }],
      rows: state.vista.map((r) => [r.proyecto, cell(r.vIni, fmtS2), cell(r.vIng, fmtS2), cell(r.vEgr, fmtS2), cell(r._calc, fmtS2), cell(r.vFin, fmtS2), cell(r._diff, fmtS2), r._ok ? "✓ OK" : "✗ Revisar"]),
      conds: state.vista.map((r) => [{ dim: "proyecto", value: r.proyecto }]), searchable: state.vista.length > 20, pageSize: 25,
      defaultSort: { col: 6, dir: "desc" },
    }),
  },
};

/* =========================== KPIs =========================== */
// cmp: comparación para tableros sin fechas (kardex, valorización). Los de movimientos comparan con el mes anterior.
const pctTxt = (v) => (v == null ? "—" : signo(v, (x) => fmt(x, 1) + " %"));
const KLIB = {
  kStock: { label: "Stock actual total", icon: "fa-sack-dollar", slot: 0, val: (k) => k.vAct, f: fmtS,
    sub: (k) => `Stock inicial: <b>${fmtS(k.vIni)}</b> · variación <b>${signo(k.var)}</b>`,
    cmp: (k) => ({ v: k.pctVar, txt: pctTxt(k.pctVar), ref: "vs. stock inicial", better: "none" }),
    info: { what: "El valor del inventario al cierre.", how: "Suma de Stock Actual (S/). Variación = Stock Actual (S/) − Stock Inicial (S/); % variación = variación ÷ inicial × 100." } },
  kIngreso: { label: "Ingreso total", icon: "fa-arrow-right-to-bracket", slot: 2, val: (k) => k.vIng, f: fmtS,
    sub: (k) => `<b>${fmt(k.cIng, 0)}</b> unidades ingresadas en ${fmt(k.conIng)} líneas`,
    cmp: (k) => ({ v: pctDe(k.vIng, k.vIni), txt: k.vIni ? fmtPct(pctDe(k.vIng, k.vIni)) : "—", ref: "del stock inicial", better: "none" }),
    info: { what: "Lo que entró al almacén en el período, en soles.", how: "Suma de Ingreso (S/). Unidades = suma de Cantidad Ingreso (mezcla unidades de medida distintas)." } },
  kIngresoA: { label: "Ingreso total", icon: "fa-arrow-right-to-bracket", slot: 2, val: (k) => k.vIng, f: fmtS,
    sub: (k) => `<b>${fmt(k.conIng)}</b> activos ingresados (cantidad ingreso > 0)`,
    cmp: (k) => ({ v: pctDe(k.vIng, k.vIni), txt: k.vIni ? fmtPct(pctDe(k.vIng, k.vIni)) : "—", ref: "del stock inicial", better: "none" }),
    info: { what: "El valor de los activos y tenencias que ingresaron en el período.", how: "Suma de Ingreso (S/). Activos ingresados = líneas con Cantidad Ingreso > 0." } },
  kEgreso: { label: "Egreso total", icon: "fa-arrow-right-from-bracket", slot: 1, val: (k) => k.vEgr, f: fmtS,
    sub: (k) => `<b>${fmt(k.cEgr, 0)}</b> unidades egresadas en ${fmt(k.conEgr)} líneas`,
    cmp: (k) => ({ v: k.pctEgrIng, txt: k.pctEgrIng != null ? fmtPct(k.pctEgrIng) : "—", ref: "egreso sobre ingreso", better: "none" }),
    info: { what: "Lo que salió del almacén en el período, en soles.", how: "Suma de Egreso (S/). % egreso sobre ingreso = Egreso (S/) ÷ Ingreso (S/) × 100." } },
  kSinMov: { label: (ds) => `% ${ds.term[1]} sin movimiento`, icon: "fa-hourglass-half", slot: 3, val: (k) => k.pctSinMov, f: (v) => fmt(v, 1), unit: "%", bar: (k) => k.pctSinMov,
    sub: (k) => `<b>${fmt(k.sinMov)}</b> inmovilizados de ${fmt(k.n)} líneas · ${fmtS(k.vSinMov)}`,
    cmp: (k) => ({ v: -k.pctSinMov, txt: fmtPct(100 - k.pctSinMov), ref: "con algún movimiento", better: "none" }),
    info: { what: "Qué parte del kardex no tuvo ni ingresos ni egresos.", how: "Líneas con Cantidad Ingreso = 0 y Cantidad Egreso = 0 ÷ total de líneas × 100. Cada línea es un recurso en un almacén." } },
  kInmov: { label: "% stock inmovilizado", icon: "fa-hourglass-half", slot: 3, val: (k) => k.pctInmov, f: (v) => fmt(v, 1), unit: "%", bar: (k) => k.pctInmov,
    sub: (k) => `<b>${fmtS(k.vSinMov)}</b> sin ingresos ni egresos`,
    cmp: (k) => ({ v: k.vSinMov, txt: fmt(k.sinMov), ref: "líneas inmovilizadas", better: "none" }),
    info: { what: "Qué parte del valor del stock está parada.", how: "Stock inmovilizado = suma de Stock Actual (S/) donde Cantidad Ingreso = 0 y Cantidad Egreso = 0. % = inmovilizado ÷ stock actual total × 100." } },
  kObs: { label: "% stock obsoleto", icon: "fa-trash-can-arrow-up", slot: 7, val: (k) => k.pctObs, f: (v) => fmt(v, 1), unit: "%", bar: (k) => k.pctObs,
    sub: (k) => `<b>${fmtS(k.vObs)}</b> en almacenes de vencidos u obsoletos`,
    cmp: (k) => ({ v: k.nObs, txt: fmt(k.nObs), ref: "líneas obsoletas", better: "none" }),
    status: (v, k) => (k.vAct ? (v === 0 ? ["good", "fa-circle-check", "Sin obsoletos"] : v < 5 ? ["warn", "fa-circle-exclamation", "Gestionar baja"] : ["crit", "fa-circle-xmark", "Alto obsoleto"]) : null),
    info: { what: "Qué parte del stock está vencida u obsoleta.", how: "Stock obsoleto = suma de Stock Actual (S/) donde la Descripción Almacén es «Materiales VENCIDOS - OBSOLETOS» (cualquier almacén que contenga «vencidos» u «obsoletos»). % = obsoleto ÷ stock total × 100. Estado: 0 % sin obsoletos; menos de 5 % gestionar baja; 5 % o más alto." } },
  kSinMovN: { label: "Recursos sin movimiento", icon: "fa-box-archive", slot: 4, val: (k) => k.sinMov, f: (v) => fmt(v), bar: (k) => k.pctSinMov,
    sub: (k) => `De <b>${fmt(k.recursos)}</b> recursos en almacén (${fmt(k.n)} líneas)`,
    cmp: (k) => ({ v: k.pctSinMov, txt: fmtPct(k.pctSinMov), ref: "de las líneas", better: "none" }),
    info: { what: "Cuántos recursos no se movieron en el período.", how: "Cantidad de líneas con Cantidad Ingreso = 0 y Cantidad Egreso = 0. Total de recursos = códigos distintos." } },
  kTenencias: { label: "Tenencias vs. activos fijos", icon: "fa-scale-unbalanced", slot: 6, val: (k, d) => (d.grupo.find((x) => /tenenc/i.test(x.label)) || { vAct: 0 }).vAct, f: fmtS,
    bar: (k, d) => pctDe((d.grupo.find((x) => /tenenc/i.test(x.label)) || { vAct: 0 }).vAct, k.vAct) || 0,
    sub: (k, d) => { const te = (d.grupo.find((x) => /tenenc/i.test(x.label)) || { vAct: 0 }).vAct; return `Tenencias <b>${fmtPct(pctDe(te, k.vAct) || 0)}</b> · activos fijos <b>${fmtS(k.vAct - te)}</b> (${fmtPct(pctDe(k.vAct - te, k.vAct) || 0)})`; },
    cmp: (k, d) => ({ v: 0, txt: fmt(d.grupo.length), ref: "grupos de activo", better: "none" }),
    info: { what: "Cuánto del valor son tenencias y cuánto activos fijos (maquinaria, facilidades, equipos de medición y TI).", how: "Suma de Stock Actual (S/) del grupo Tenencias contra el resto. El grupo sale de la Descripción Almacén (reglas en CONFIG.GRUPOS_ACTIVO)." } },

  mIng: { label: "Total ingresos", icon: "fa-arrow-right-to-bracket", slot: 2, val: (k) => k.ing, f: fmtS, delta: "pct", better: "none",
    sub: (k) => `<b>${fmt(k.nIng)}</b> movimientos de ingreso`,
    info: (ds) => ({ what: "Lo que entró en soles.", how: `Suma de ${ds.hlc ? "Parcial (S/) Neto donde Movimiento = Ingreso" : "Parcial Neto MP donde Tipo Mov. = INGRESOS"}. La flecha compara el último mes con el anterior.` }) },
  mEgr: { label: "Total egresos", icon: "fa-arrow-right-from-bracket", slot: 1, val: (k) => k.egr, f: fmtS, delta: "pct", better: "none",
    sub: (k) => `<b>${fmt(k.nEgr)}</b> movimientos de egreso`,
    info: (ds) => ({ what: "Lo que salió en soles.", how: `Suma de ${ds.hlc ? "Parcial (S/) Neto donde Movimiento = Egreso" : "Parcial Neto MP donde Tipo Mov. = EGRESOS"}. La flecha compara el último mes con el anterior.` }) },
  mLeadTime: { label: "Lead time promedio de compra", icon: "fa-stopwatch", slot: 4, val: (k) => k.ltProm, f: (v) => (v == null ? "—" : fmt(v, 1)), unit: "días", delta: "pct", better: "down",
    sub: (k) => (k.ltN ? `<b>${fmtPct(k.pctLt30)}</b> tardó más de ${CONFIG.LT_LIMITE} días · ${fmt(k.ltN)} ingresos medidos` : "Sin ingresos con fecha de orden"),
    info: { what: "Cuántos días pasan desde la orden de compra hasta la guía de ingreso.", how: "Promedio de (Fecha Guía − Fecha Orden) en los ingresos con Nro. Orden y Fecha Orden. Las diferencias negativas se excluyen (dato a revisar). Bajar es bueno." } },
  mProyectos: { label: "Proyectos activos", icon: "fa-diagram-project", slot: 0, val: (k) => k.proyectos, f: (v) => fmt(v), delta: "abs", dec: 0, better: "none",
    sub: (k) => `<b>${fmt(k.unegs)}</b> unidades de negocio activas`,
    info: { what: "Cuántos proyectos tuvieron movimientos.", how: "Proyectos distintos con al menos un movimiento en vista; unidades de negocio distintas." } },
  mTotal: { label: "Movimientos totales", icon: "fa-list-ol", slot: 0, val: (k) => k.n, f: (v) => fmt(v), delta: "pct", better: "none",
    sub: (k) => `<b>${fmt(k.recursos)}</b> recursos distintos movidos`,
    info: { what: "Cuántas líneas de guía hay.", how: "Cantidad de filas (COUNT). Recursos distintos = códigos de recurso distintos." } },
  mGuia: { label: "% movimientos con guía", icon: "fa-file-invoice", slot: 5, val: (k) => k.pctGuia, f: (v) => fmt(v, 1), unit: "%", delta: "pp", better: "up", bar: (k) => k.pctGuia,
    sub: (k, d, ds) => (ds.key === "kf-ie" ? `<b>${fmt(k.sinObs)}</b> movimientos sin observación` : `<b>${fmt(k.obs)}</b> movimientos con observación (${fmtPct(k.pctObs)})`),
    status: (v, k) => (k.n ? (v >= CONFIG.META_GUIA ? ["good", "fa-circle-check", "En meta"] : ["warn", "fa-circle-exclamation", `${fmt(k.sinGuia)} sin guía`]) : null),
    info: { what: "Qué parte de los movimientos tiene número de guía registrado.", how: `Movimientos con Nro. Guía ÷ total × 100. Meta: ${CONFIG.META_GUIA} %.` } },

  vFin: { label: "Stock final total", icon: "fa-sack-dollar", slot: 0, val: (k) => k.vFin, f: fmtS,
    sub: (k) => `Stock inicial: <b>${fmtS(k.vIni)}</b> · variación <b>${signo(k.var)}</b>`,
    cmp: (k) => ({ v: k.pctVar, txt: pctTxt(k.pctVar), ref: "vs. stock inicial", better: "none" }),
    info: { what: "El stock valorizado de todos los proyectos al cierre del año.", how: "Suma de STOCK (S/) FIN. Variación = stock final − stock inicial." } },
  vEgr: { label: "Egreso total", icon: "fa-arrow-right-from-bracket", slot: 1, val: (k) => k.vEgr, f: fmtS,
    sub: (k) => `<b>${k.pctEgrIng != null ? fmtPct(k.pctEgrIng) : "—"}</b> sobre lo ingresado`,
    cmp: (k) => ({ v: 0, txt: fmt(k.egrMayor), ref: "proyectos con egreso > ingreso", better: "none" }),
    info: { what: "Lo consumido por los proyectos en el año.", how: "Suma de EGRESO (S/). % sobre ingreso = egreso ÷ ingreso × 100." } },
  vIng: { label: "Ingreso total", icon: "fa-arrow-right-to-bracket", slot: 2, val: (k) => k.vIng, f: fmtS,
    sub: (k) => `<b>${fmt(k.conIng)}</b> proyectos con ingreso de ${fmt(k.n)}`,
    cmp: (k) => ({ v: 0, txt: fmt(k.finMayor), ref: "proyectos con stock final > inicial", better: "none" }),
    info: { what: "Lo que ingresó a los proyectos en el año.", how: "Suma de INGRESO (S/). Proyectos con ingreso = INGRESO > 0." } },
  vRot: { label: "Rotación promedio", icon: "fa-rotate", slot: 4, val: (k) => k.rot, f: (v) => (v == null ? "—" : fmt(v, 2)), unit: "veces",
    sub: (k) => `<b>${fmt(k.sinMov)}</b> proyectos sin movimiento · promedio simple ${fmtX(k.rotProm)}`,
    cmp: (k) => ({ v: 0, txt: fmt(k.nDiff), ref: "proyectos con diferencia contable", better: "none" }),
    info: { what: "Cuántas veces se consumió el stock promedio en el año.", how: "Rotación global = egreso total ÷ ((stock inicial + stock final) ÷ 2). También se muestra el promedio simple de la rotación de cada proyecto, que pesa igual a proyectos chicos y grandes." } },
};

/* =========================== HALLAZGOS =========================== */
function hallazgosKardex(d) {
  const k = d.k, ds = DS(), L = [];
  if (k.vIni || k.vAct) L.push({ icon: "fa-scale-balanced", tone: "brand", html: `El stock valorizado pasó de <b>${fmtS(k.vIni)}</b> a <b>${fmtS(k.vAct)}</b> (${k.pctVar != null ? pctTxt(k.pctVar) : "sin stock inicial"}). Egresó el <b>${k.pctEgrIng != null ? fmtPct(k.pctEgrIng) : "—"}</b> de lo que ingresó.` });
  if (d.alm.length > 1 && k.vAct) {
    const a = d.alm[0];
    L.push({ icon: "fa-warehouse", tone: "brand", html: `<b>${esc(trunc(a.label, 48))}</b> concentra el <b>${fmtPct(pctDe(a.vAct, k.vAct))}</b> del stock (${fmtS(a.vAct)}).`, cond: [{ dim: "almacen", value: a.label }] });
  }
  if (ds.activos && d.grupo.length) {
    const te = d.grupo.find((x) => /tenenc/i.test(x.label));
    if (te) L.push({ icon: "fa-scale-unbalanced", tone: "brand", html: `Las tenencias suman <b>${fmtS(te.vAct)}</b> (${fmtPct(pctDe(te.vAct, k.vAct) || 0)}); los activos fijos, <b>${fmtS(k.vAct - te.vAct)}</b>.`, cond: [{ dim: "grupo", value: te.label }] });
  }
  if (k.sinMov) L.push({ icon: "fa-hourglass-half", tone: k.pctSinMov > 50 ? "warn" : "brand", html: `<b>${fmt(k.sinMov)} de ${fmt(k.n)}</b> líneas (${fmtPct(k.pctSinMov)}) no tuvieron ingresos ni egresos: <b>${fmtS(k.vSinMov)}</b> parados (${fmtPct(k.pctInmov)} del stock).`, cond: [{ dim: "_movCat", value: "Sin movimiento", label: "Sin movimiento" }] });
  if (k.vObs > CONFIG.TOL_VALOR) L.push({ icon: "fa-trash-can-arrow-up", tone: "warn", html: `Hay <b>${fmtS(k.vObs)}</b> (${fmtPct(k.pctObs)}) en almacenes de vencidos u obsoletos: candidatos a baja o remate.`, cond: [{ dim: "estadoInv", value: ESTADOS_INV[2] }] });
  const pos = d.rec.filter((x) => x.vAct > 0);
  const tot = pos.reduce((a, x) => a + x.vAct, 0);
  if (pos.length > 4 && tot) {
    let acc = 0, i = 0;
    while (i < pos.length && acc < tot * 0.8) acc += pos[i++].vAct;
    L.push({ icon: "fa-chart-pie", tone: "brand", html: `Solo <b>${fmt(i)} ${term(1)}</b> (${fmtPct((i / pos.length) * 100)}) explican el 80 % del valor: ahí conviene concentrar los conteos cíclicos.`, cond: [{ dim: "set", value: pos.slice(0, i).map((x) => x.label), label: `Clase A (${fmt(i)})` }] });
  }
  const rot = d.rec.filter((x) => x.rot > 0).sort((a, b) => b.rot - a.rot)[0];
  if (rot) L.push({ icon: "fa-rotate", tone: "brand", html: `El ${term(0)} de mayor rotación es <b>${esc(trunc(rot.nombre, 46))}</b>: salió <b>${fmtX(rot.rot)}</b> su stock promedio.`, cond: recCond(rot) });
  if (k.issues) {
    const top = KFLAGS.map((x) => ({ ...x, n: d.flags[x.k] })).filter((x) => x.n).sort((a, b) => b.n - a.n)[0];
    L.push({ icon: "fa-clipboard-list", tone: "warn", html: `Validación: <b>${fmt(k.issues)} líneas</b> con saldos a revisar; la más frecuente, «${esc(top.label)}» (${fmt(top.n)}).`, cond: [{ dim: "flag", value: top.k, label: top.label }] });
  } else if (k.n) L.push({ icon: "fa-circle-check", tone: "good", html: "Todas las líneas en vista cuadran: el saldo físico y el valorizado son consistentes." });
  return L;
}
function hallazgosMov(d) {
  const k = d.k, ds = DS(), L = [];
  if (d.meses.length > 1) {
    const b = maxBy(d.meses, "monto");
    L.push({ icon: "fa-calendar-check", tone: "brand", html: `<b>${esc(b.label)}</b> fue el mes de mayor movimiento: <b>${fmtS(b.monto)}</b> (${fmt(b.n)} líneas).`, cond: [{ dim: "mesKey", value: b.key, label: b.label }] });
  }
  if (k.n) L.push({ icon: "fa-right-left", tone: "brand", html: `Ingresaron <b>${fmtS(k.ing)}</b> y egresaron <b>${fmtS(k.egr)}</b>: saldo neto <b>${signo(k.neto)}</b>.` });
  if (d.tipo.length > 1 && k.monto) {
    const x = d.tipo[0];
    L.push({ icon: "fa-tag", tone: "brand", html: `El movimiento <b>${esc(x.label)}</b>${x.desc ? ` (${esc(trunc(x.desc, 40))})` : ""} concentra el <b>${fmtPct(pctDe(x.monto, k.monto))}</b> del monto.`, cond: [{ dim: "mov", value: x.label }] });
  }
  if (ds.hlc && d.proy.length > 1) {
    const p = d.proy[0];
    L.push({ icon: "fa-diagram-project", tone: "brand", html: `<b>${esc(trunc(p.label, 46))}</b> es el proyecto con más monto movido: <b>${fmtS(p.monto)}</b> (${fmtPct(pctDe(p.monto, k.monto) || 0)}).`, cond: [{ dim: "proyecto", value: p.label }] });
  }
  if (ds.hasProv) {
    const pv = [...d.prov].filter((x) => x.ing > 0).sort((a, b) => b.ing - a.ing);
    if (pv.length > 1 && k.ing) L.push({ icon: "fa-truck", tone: "brand", html: `<b>${esc(trunc(pv[0].label, 46))}</b> es el principal proveedor: <b>${fmtPct(pctDe(pv[0].ing, k.ing))}</b> de los ingresos (${fmtS(pv[0].ing)}).`, cond: [{ dim: "proveedor", value: pv[0].label }] });
  } else if (d.destino.length > 1) {
    const x = d.destino[0];
    L.push({ icon: "fa-location-dot", tone: "brand", html: `<b>${esc(trunc(x.label, 46))}</b> es el destino con más monto: <b>${fmtS(x.monto)}</b> en ${fmt(x.n)} movimientos.`, cond: [{ dim: "destino", value: x.label }] });
  }
  if (k.ltN) {
    const lento = d.prov.filter((x) => x.ltN >= 3).sort((a, b) => b.ltProm - a.ltProm)[0];
    L.push({ icon: "fa-stopwatch", tone: k.ltProm > CONFIG.LT_LIMITE ? "warn" : "good", html: `Las compras tardan en promedio <b>${fmtD(k.ltProm)}</b> de la orden a la guía.${lento ? ` El proveedor más lento (con 3 o más entregas): <b>${esc(trunc(lento.label, 40))}</b>, ${fmtD(lento.ltProm)}.` : ""}`, cond: lento ? [{ dim: "proveedor", value: lento.label }] : null });
  }
  if (k.n) L.push({ icon: "fa-file-invoice", tone: k.pctGuia >= CONFIG.META_GUIA ? "good" : "warn", html: `El <b>${fmtPct(k.pctGuia)}</b> de los movimientos tiene guía${k.sinGuia ? `; faltan <b>${fmt(k.sinGuia)}</b>` : ""}. El ${fmtPct(k.pctObs)} tiene observación.` });
  if (k.nTransf && Math.abs(k.tNeto) > CONFIG.TOL_VALOR) L.push({ icon: "fa-arrows-rotate", tone: "warn", html: `Las transferencias internas no netean: quedan <b>${signo(k.tNeto)}</b> entre ingresos y egresos de transferencia.`, cond: [{ dim: "transf", value: true, label: "Transferencias" }] });
  if (d.meses.length > 1) {
    const a = d.meses[d.meses.length - 1], b = d.meses[d.meses.length - 2], v = varPct(a.egr, b.egr);
    if (v != null) L.push({ icon: v >= 0 ? "fa-arrow-trend-up" : "fa-arrow-trend-down", tone: "brand", html: `En <b>${esc(a.label)}</b> los egresos ${v >= 0 ? "subieron" : "bajaron"} <b>${fmt(Math.abs(v), 1)} %</b> contra ${esc(b.label)}.`, cond: [{ dim: "mesKey", value: a.key, label: a.label }] });
  }
  return L;
}
function hallazgosValo(d) {
  const k = d.k, L = [];
  if (k.n) L.push({ icon: "fa-scale-balanced", tone: "brand", html: `El stock de los ${fmt(k.n)} proyectos pasó de <b>${fmtS(k.vIni)}</b> a <b>${fmtS(k.vFin)}</b> (${pctTxt(k.pctVar)}).` });
  if (d.proy.length > 1 && k.vFin) { const p = d.proy[0]; L.push({ icon: "fa-diagram-project", tone: "brand", html: `<b>${esc(trunc(p.label, 46))}</b> tiene el <b>${fmtPct(pctDe(p.vFin, k.vFin))}</b> del stock final (${fmtS(p.vFin)}).`, cond: [{ dim: "proyecto", value: p.label }] }); }
  const e = [...d.proy].sort((a, b) => b.vEgr - a.vEgr)[0];
  if (e && e.vEgr) L.push({ icon: "fa-arrow-right-from-bracket", tone: "brand", html: `El mayor consumo fue de <b>${esc(trunc(e.label, 46))}</b>: <b>${fmtS(e.vEgr)}</b> (${fmtPct(pctDe(e.vEgr, k.vEgr) || 0)} del egreso).`, cond: [{ dim: "proyecto", value: e.label }] });
  if (k.egrMayor) L.push({ icon: "fa-arrow-trend-down", tone: "brand", html: `<b>${fmt(k.egrMayor)} proyectos</b> egresaron más de lo que ingresaron (redujeron stock); <b>${fmt(k.finMayor)}</b> terminaron con más stock que al inicio.` });
  if (k.sinMov) L.push({ icon: "fa-hourglass-half", tone: "warn", html: `<b>${fmt(k.sinMov)} proyectos</b> no tuvieron ingresos ni egresos en el año: su stock (${fmtS(d.proy.filter((x) => x.sinMov).reduce((a, x) => a + x.vFin, 0))}) está parado.`, cond: [{ dim: "set", value: state.vista.filter((r) => r._sinMov).map((r) => r._id), label: "Proyectos sin movimiento" }] });
  if (d.tipo.length > 1 && k.vFin) { const t = d.tipo[0]; L.push({ icon: "fa-tags", tone: "brand", html: `Los proyectos <b>${esc(t.label)}</b> suman el <b>${fmtPct(pctDe(t.vFin, k.vFin))}</b> del stock final.`, cond: [{ dim: "tipo", value: t.label }] }); }
  L.push(k.nDiff
    ? { icon: "fa-clipboard-list", tone: "warn", html: `<b>${fmt(k.nDiff)} proyectos</b> no cuadran (inicial + ingreso − egreso ≠ final); diferencia absoluta total <b>${fmtS2(k.diffAbs)}</b>.`, cond: [{ dim: "flag", value: "diff", label: "Con diferencia contable" }] }
    : { icon: "fa-circle-check", tone: "good", html: "La validación contable cuadra en todos los proyectos en vista." });
  return L;
}
function renderHallazgos(d, el) {
  const fn = { kardex: hallazgosKardex, mov: hallazgosMov, valo: hallazgosValo }[DS().engine];
  const shown = fn(d).slice(0, 8);
  el._conds = shown.map((x) => x.cond || null);
  el.innerHTML = shown.length
    ? `<ul class="insights cols-2">${shown.map((x, i) => `
        <li class="insight tone-${x.tone}">
          ${x.cond ? `<button type="button" class="insight-btn" data-insight="${i}">` : `<div class="insight-btn is-static">`}
            <span class="insight-ico"><i class="fas ${x.icon}"></i></span>
            <span class="insight-text">${x.html}</span>
            ${x.cond ? `<i class="fas fa-chevron-right insight-go" aria-hidden="true"></i></button>` : `</div>`}
        </li>`).join("")}</ul>`
    : `<p class="table-empty">No hay suficientes datos en vista para generar hallazgos.</p>`;
}
const XLIB = {
  xHall: { title: "Hallazgos automáticos", sub: "Lo que más se destaca con los filtros actuales",
    info: { what: "Frases que resumen lo más relevante del tablero con los filtros actuales.", how: "Se recalculan cada vez que cambiás un filtro o llegan datos nuevos. Ninguna está escrita a mano: salen de comparar los totales.", tip: "Clic en un hallazgo para abrir su detalle." },
    render: renderHallazgos },
};

/* =========================== KPIs: utilidades =========================== */
function sparkSVG(values, hi, color) {
  const v = values.filter((x) => isFinite(x));
  if (v.length < 2) return "";
  values = values.map((x) => (isFinite(x) ? x : Math.min(...v)));
  const W = 92, H = 32, pad = 3;
  const min = Math.min(...v), max = Math.max(...v), rng = max - min || 1;
  const pts = values.map((x, i) => [pad + (i / (values.length - 1)) * (W - pad * 2), H - pad - ((x - min) / rng) * (H - pad * 2)]);
  const dPath = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${dPath} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`;
  const h = pts[Math.max(0, Math.min(pts.length - 1, hi))];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
    <path d="${area}" fill="${color}" opacity=".12"></path>
    <path d="${dPath}" fill="none" stroke="${color}" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"></path>
    <circle cx="${h[0].toFixed(1)}" cy="${h[1].toFixed(1)}" r="3" fill="${color}" stroke="var(--surface)" stroke-width="1.5"></circle>
  </svg>`;
}
function animateNumber(el, to, f) {
  const from = typeof el._val === "number" ? el._val : 0;
  el._val = to;
  if (REDUCED || from === to) { el.textContent = f(to); return; }
  cancelAnimationFrame(el._raf);
  const t0 = performance.now(), dur = 750;
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = f(from + (to - from) * e);
    if (p < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

/* =========================== KPIs: render =========================== */
function kpiTxt(def, key) { const v = def[key]; return typeof v === "function" ? v(DS()) : v; }
function renderKPIs() {
  const d = state.d, ds = DS();
  const conTiempo = ds.engine === "mov";
  let S = [];
  if (conTiempo) {
    let T = d.tendencia.filter((p) => !state.filtros.hasta || p.key <= state.filtros.hasta.slice(0, 7));
    if (state.filtros.mes) { const i = T.findIndex((p) => p.label === state.filtros.mes); if (i >= 0) T = T.slice(0, i + 1); }
    S = T.slice(-12);
  }
  const cur = S.length - 1, prev = cur - 1;
  ds.kpis.forEach((id) => {
    const k = KLIB[id];
    const card = document.querySelector(`.kpi[data-kpi="${id}"]`);
    if (!card) return;
    const valor = k.val(d.k, d);
    const num = card.querySelector(".kpi-num");
    if (num.querySelector(".sk")) num.textContent = "";
    if (valor == null) { num._val = null; num.textContent = "—"; } else animateNumber(num, valor, k.f);
    num.title = valor == null ? "" : k.f(valor);

    let mid = `<p class="kpi-sub">${k.sub(d.k, d, ds)}</p>`;
    if (k.bar) mid += `<div class="kpi-bar" role="presentation"><i style="width:${Math.max(0, Math.min(100, k.bar(d.k, d) || 0))}%"></i></div>`;
    const st = k.status ? k.status(valor, d.k) : null;
    if (st) mid += `<span class="status status-${st[0]}"><i class="fas ${st[1]}"></i>${st[2]}</span>`;
    card.querySelector(".kpi-mid").innerHTML = mid;

    const foot = card.querySelector(".kpi-foot");
    if (!conTiempo) {
      const c = k.cmp ? k.cmp(d.k, d) : null;
      foot.innerHTML = c ? `<div class="delta-wrap"><span class="delta ref"><i class="fas fa-code-compare"></i>${esc(c.txt)}</span><span class="delta-ref">${esc(c.ref)}</span></div>` : "";
      return;
    }
    let deltaHTML = `<span class="delta flat"><i class="fas fa-minus"></i>Sin mes anterior</span>`;
    if (cur >= 1) {
      const a = k.val(S[cur], d), b = k.val(S[prev], d);
      if (a == null || b == null) deltaHTML = `<span class="delta flat"><i class="fas fa-minus"></i>Sin dato para comparar</span>`;
      else {
        let diff, t;
        if (k.delta === "pct") { diff = b ? ((a - b) / Math.abs(b)) * 100 : 0; t = `${diff >= 0 ? "+" : "−"}${fmt(Math.abs(diff), 1)} %`; }
        else if (k.delta === "pp") { diff = a - b; t = `${diff >= 0 ? "+" : "−"}${fmt(Math.abs(diff), 1)} pp`; }
        else { diff = a - b; t = `${diff >= 0 ? "+" : "−"}${fmt(Math.abs(diff), k.dec ?? 1)}`; }
        const eps = 1e-6, up = diff > eps, down = diff < -eps;
        const good = (k.better === "up" && up) || (k.better === "down" && down);
        const bad = (k.better === "up" && down) || (k.better === "down" && up);
        const cls = !up && !down ? "flat" : good ? "good" : bad ? "bad" : "ref";
        const ico = up ? "fa-arrow-trend-up" : down ? "fa-arrow-trend-down" : "fa-minus";
        deltaHTML = `<span class="delta ${cls}" title="${esc(S[cur].label)} comparado con ${esc(S[prev].label)}"><i class="fas ${ico}"></i>${t}</span><span class="delta-ref">${esc(S[cur].short)} vs. ${esc(S[prev].short)}</span>`;
      }
    }
    foot.innerHTML = `<div class="delta-wrap">${deltaHTML}</div>${sparkSVG(S.map((p) => k.val(p, d) ?? NaN), cur, state.tk.series[k.slot] || state.tk.brand)}`;
  });
}

/* =========================== LAYOUT (se arma por tablero) =========================== */
let SPECS = [];     // gráficos del tablero actual
let XSPECS = [];    // tablas y hallazgos del tablero actual
const SEC_KEYS = () => DS().secs.map((s) => s.k);
const secDef = (k) => DS().secs.find((s) => s.k === k) || DS().secs[0];

function renderBoardNav() {
  const grupos = Object.keys(FILES).map((f) => ({ f, list: DS_KEYS.filter((k) => DATASETS[k].file === f) }));
  $("boardNav").innerHTML = grupos.map(({ f, list }) => `
    <div class="board-group">
      <p class="bg-label"><i class="fas ${FILES[f].icon}"></i>${FILES[f].label}</p>
      ${list.map((k) => {
        const ds = DATASETS[k], pub = PUB[ds.sheet], on = k === state.ds;
        const n = pub && pub.meta ? pub.meta.registros : null;
        const estado = pub ? (STORE[k].signature && STORE[k].signature !== firmaPub(pub) ? "stale" : "ok") : PUB._checked ? "empty" : "wait";
        return `<a href="#${k}/${(on ? state.seccion : "") || ds.secs[0].k}" class="board ${on ? "active" : ""}" data-ds="${k}" ${on ? 'aria-current="page"' : ""} title="${esc(FILES[f].excel)} · pestaña ${esc(ds.tab)}">
          <i class="fas ${ds.icon} board-ico"></i>
          <span class="board-txt"><b>${ds.titulo}</b><small>${esc(ds.tab)}${n != null ? ` · ${fmt(n)} filas` : estado === "empty" ? " · sin datos" : ""}</small></span>
          <span class="board-dot is-${estado}" aria-hidden="true"></span></a>`;
      }).join("")}
    </div>`).join("");
}

function construirLayout() {
  const ds = DS();
  Object.keys(charts).forEach((id) => { charts[id].destroy(); delete charts[id]; });
  Object.keys(outs).forEach((id) => delete outs[id]);
  Object.keys(tables).forEach((id) => delete tables[id]);
  Object.keys(INFO).forEach((k) => delete INFO[k]);
  SPECS = []; XSPECS = [];

  renderBoardNav();
  $("dashTabs").innerHTML = ds.secs.map((s, i) => `<a href="#${state.ds}/${s.k}" class="tab" role="tab" data-seccion="${s.k}" aria-selected="false"><i class="fas ${s.icon}"></i><span>${s.t}</span><kbd>${i + 1}</kbd></a>`).join("");
  $("boardHead").innerHTML = `
    <span class="bh-ico"><i class="fas ${ds.icon}"></i></span>
    <div class="bh-txt"><p class="bh-kicker"><i class="fas ${FILES[ds.file].icon}"></i>${FILES[ds.file].label} · pestaña «${esc(ds.tab)}»</p><h1>${ds.titulo}</h1></div>
    <span class="bh-meta" id="bhMeta"></span>`;
  $("stSheet").textContent = `${CONFIG.TABLE} · ${ds.sheet}`;

  $("sections").innerHTML = ds.secs.map((s) => {
    const items = s.items.map(([id, span, size]) => {
      const c = CHARTLIB[id];
      if (c) {
        const spec = { id, sec: s.k, span, size: size || c.size, focus: c.focus, title: txt(c.title), sub: txt(c.sub), build: c.build.bind(c) };
        SPECS.push(spec);
        INFO["chart:" + id] = { title: spec.title, ...txt(c.info) };
        return chartCard(spec);
      }
      const x = TLIB[id] || XLIB[id];
      if (!x) return "";
      const xs = { id, sec: s.k, span, title: txt(x.title), sub: txt(x.sub), table: x.table, render: x.render };
      XSPECS.push(xs);
      INFO["extra:" + id] = { title: xs.title, ...txt(x.info) };
      return extraCard(xs);
    }).join("");
    const kpis = s.kpis ? `<div class="kpi-row" id="kpiRow">${ds.kpis.map((id) => {
      const k = KLIB[id], label = kpiTxt(k, "label");
      INFO["kpi:" + id] = { title: label, ...txt(k.info) };
      return `<article class="card kpi" data-kpi="${id}" style="--accent: var(--series-${k.slot + 1})">
        <header class="kpi-head"><span class="kpi-ico"><i class="fas ${k.icon}"></i></span><h3>${label}</h3>${infoBtn("kpi:" + id, label)}</header>
        <div class="kpi-val"><span class="kpi-num"><span class="sk sk-kpi"></span></span>${k.unit ? `<small>${k.unit}</small>` : ""}</div>
        <div class="kpi-mid"></div>
        <footer class="kpi-foot"><span class="sk sk-line"></span></footer>
      </article>`;
    }).join("")}</div>` : "";
    return `<section id="sec-${s.k}" class="dash-section" data-seccion="${s.k}" hidden>
      <header class="page-head"><div class="page-head-ico"><i class="fas ${s.icon}"></i></div><div><h2>${s.t}</h2><p>${s.desc}</p></div></header>
      ${kpis}<div class="grid" id="grid-${s.k}">${items}</div></section>`;
  }).join("");
  const nCharts = SPECS.length, nTablas = XSPECS.filter((x) => x.table).length;
  $("stContenido").textContent = `${ds.kpis.length} KPIs · ${nCharts} gráficos · ${nTablas} tablas`;
  $("kbdN").textContent = ds.secs.length;
}

function infoBtn(key, label) {
  return `<button type="button" class="card-btn info-btn js-info" data-info="${key}" aria-label="Qué significa: ${esc(label)}" aria-expanded="false"><i class="fas fa-circle-info"></i></button>`;
}
function chartCard(c) {
  return `
  <article class="card chart-card span-${c.span}" id="card-${c.id}" data-chart="${c.id}">
    <header class="card-head">
      <div class="card-titles"><h3>${c.title}</h3><p data-sub="${esc(c.sub)}">${c.sub}</p></div>
      <div class="card-actions">
        ${infoBtn("chart:" + c.id, c.title)}
        <button type="button" class="card-btn js-table" aria-pressed="false" title="Ver como tabla" aria-label="Ver ${esc(c.title)} como tabla"><i class="fas fa-table-list"></i></button>
        <button type="button" class="card-btn js-expand" title="Ampliar" aria-label="Ampliar ${esc(c.title)}"><i class="fas fa-up-right-and-down-left-from-center"></i></button>
        <button type="button" class="card-btn js-png" title="Descargar imagen PNG" aria-label="Descargar ${esc(c.title)} como imagen"><i class="fas fa-download"></i></button>
      </div>
    </header>
    <div class="card-body">
      <div class="plot plot-${c.size}">
        <canvas id="${c.id}" role="img" aria-label="${esc(c.title)}"></canvas>
        <div class="sk sk-plot" aria-hidden="true"></div>
      </div>
      ${c.size === "donut" ? `<ul class="donut-legend" data-legend="${c.id}"></ul>` : ""}
      <div class="table-view" data-tableview="${c.id}" hidden></div>
      <div class="empty-card" hidden>
        <i class="fas fa-filter-circle-xmark"></i>
        <p>No hay datos para esta combinación de filtros.</p>
        <button type="button" class="btn-chip js-clear">Limpiar filtros</button>
      </div>
    </div>
  </article>`;
}
function extraCard(x) {
  return `
  <article class="card extra-card span-${x.span}" id="card-${x.id}" data-extra="${x.id}">
    <header class="card-head">
      <div class="card-titles"><h3>${x.title}</h3><p>${x.sub}</p></div>
      <div class="card-actions">${infoBtn("extra:" + x.id, x.title)}${x.table ? `<button type="button" class="card-btn js-csv-table" data-table="${x.id}" title="Descargar esta tabla en CSV" aria-label="Descargar ${esc(x.title)} en CSV"><i class="fas fa-file-csv"></i></button>` : ""}</div>
    </header>
    <div class="card-body" id="${x.id}"><div class="sk sk-block"></div></div>
  </article>`;
}

/* =========================== MONTAJE DE GRÁFICOS =========================== */
function wire(spec, out, config) {
  config.options = config.options || {};
  config.options.onHover = (evt, els, chart) => {
    const e = els[0];
    const f = e ? { i: e.index, ds: e.datasetIndex } : null;
    const p = chart.$focus;
    if (spec.focus && ((p && p.i) !== (f && f.i) || (p && p.ds) !== (f && f.ds))) { chart.$focus = f; chart.update("none"); }
    chart.canvas.style.cursor = e && out.drill ? "pointer" : "default";
  };
  config.options.onClick = (evt, els) => {
    const e = els[0];
    if (!e || !out.drill) return;
    const cond = out.drill(e);
    if (cond) abrirDrill(cond.filter(Boolean));
  };
  return config;
}
function mountChart(spec, { force = false } = {}) {
  const canvas = $(spec.id);
  if (!canvas) return;
  const card = $("card-" + spec.id);
  let out;
  try { out = spec.build(state.d, state.tk, DS()); }
  catch (err) { console.error(`Gráfico ${spec.id}:`, err); out = { empty: true, emptyMsg: "No se pudo calcular este gráfico con los datos publicados." }; }
  outs[spec.id] = out;
  card.classList.toggle("is-empty", !!out.empty);
  card.querySelector(".empty-card").hidden = !out.empty;
  card.querySelector(".empty-card p").textContent = out.emptyMsg || "No hay datos para esta combinación de filtros.";
  const sub = card.querySelector(".card-titles p");
  sub.textContent = out.sub ? `${sub.dataset.sub} · ${out.sub}` : sub.dataset.sub;

  renderTabla(card.querySelector(`[data-tableview="${spec.id}"]`), "tv-" + spec.id, out.table);
  const leg = card.querySelector(`[data-legend="${spec.id}"]`);
  if (leg) renderDonutLegend(leg, spec, out);

  if (out.empty) { if (charts[spec.id]) { charts[spec.id].destroy(); delete charts[spec.id]; } return; }

  const config = wire(spec, out, out.config);
  const prev = charts[spec.id];
  if (prev && !force && prev.config.type === config.type && prev.data.datasets.length === config.data.datasets.length) {
    prev.data.labels = config.data.labels;
    config.data.datasets.forEach((ds, i) => { Object.assign(prev.data.datasets[i], ds); });
    prev.options = config.options;
    prev.$focus = null;
    prev.update();
    return;
  }
  if (prev) prev.destroy();
  charts[spec.id] = new Chart(canvas, config);
}
function renderDonutLegend(ul, spec, out) {
  if (!out.legend || out.empty) { ul.innerHTML = ""; return; }
  ul.innerHTML = out.legend.map((l) => `
    <li><button type="button" class="dl-item" data-chart="${spec.id}" data-index="${l.index}" title="${esc(l.full || l.label)}">
      <span class="dl-dot" style="background:${l.color}"></span>
      <span class="dl-label">${esc(l.label)}</span>
      <span class="dl-val">${l.value}</span>
      <span class="dl-pct">${fmt(l.pct, 1)} %</span>
    </button></li>`).join("");
}

/* =========================== TABLAS (orden, búsqueda y páginas) =========================== */
const COLL = new Intl.Collator("es", { numeric: true, sensitivity: "base" });
const cellVal = (c) => (c && typeof c === "object" && "v" in c ? c.v : c);
const cellTxt = (c) => (c && typeof c === "object" && "f" in c ? c.f : c);
/* Una tabla puede venir de dos formas:
   - rows: arreglo de filas ya armadas (tablas chicas)
   - src + cols: filas crudas y columnas {t, get, f, num, bar}; solo se formatea la página visible
     (así el detalle de 50 000 movimientos se abre al instante) */
function acceso(def) {
  if (def.src) {
    const C = def.cols;
    return {
      n: def.src.length,
      val: (i, c) => C[c].get(def.src[i]),
      txt: (i, c) => { const v = C[c].get(def.src[i]); return C[c].f ? C[c].f(v) : v ?? ""; },
      buscable: (i) => { const Q = def._qs || (def._qs = []); return Q[i] ?? (Q[i] = fold2(C.map((x) => x.get(def.src[i]) ?? "").join(" "))); },
      cond: (i) => (def.condFn ? def.condFn(def.src[i]) : null),
      head: C,
    };
  }
  return {
    n: def.rows.length,
    val: (i, c) => cellVal(def.rows[i][c]),
    txt: (i, c) => cellTxt(def.rows[i][c]),
    buscable: (i) => (def._txt || (def._txt = def.rows.map((r) => fold2(r.map(cellTxt).join(" ")))))[i],
    cond: (i) => (def.conds ? def.conds[i] : null),
    head: def.head,
  };
}
function renderTabla(container, id, def) {
  if (!container) return;
  tables[id] = { def, container };
  if (!def || !(def.src || def.rows) || !(def.src || def.rows).length) {
    container.innerHTML = `<p class="table-empty">${esc((def && def.empty) || "Sin filas para mostrar.")}</p>`;
    return;
  }
  def._a = acceso(def);
  let host = container.querySelector(":scope > .tbl-host");
  if (!host || !!container.querySelector(":scope > .tbl-tools") !== !!def.searchable) {
    container.innerHTML = (def.searchable
      ? `<div class="tbl-tools"><label class="tbl-search"><i class="fas fa-magnifying-glass"></i><input type="search" data-table="${id}" placeholder="Buscar en la tabla…" aria-label="Buscar en la tabla" autocomplete="off"></label><span class="tbl-count"></span></div>`
      : "") + `<div class="tbl-host"></div>`;
    host = container.querySelector(":scope > .tbl-host");
    const inp = container.querySelector(".tbl-search input");
    if (inp) inp.value = state.q[id] || "";
  }
  pintarTabla(id);
}

function pintarTabla(id) {
  const tb = tables[id]; if (!tb) return;
  const { def, container } = tb;
  const A = def._a;
  const host = container.querySelector(":scope > .tbl-host");
  if (!host || !A) return;
  const head = A.head;
  // Búsqueda (sin acentos ni mayúsculas)
  const q = fold2(state.q[id] || "").trim();
  let idx = [];
  for (let i = 0; i < A.n; i++) if (!q || A.buscable(i).includes(q)) idx.push(i);
  // Orden
  const s = state.sort[id] || def.defaultSort;
  if (s && s.col >= 0) {
    const vals = new Map(idx.map((i) => [i, A.val(i, s.col)]));
    idx.sort((a, b) => {
      const x = vals.get(a), y = vals.get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const r = typeof x === "number" && typeof y === "number" ? x - y : COLL.compare(String(x), String(y));
      return s.dir === "asc" ? r : -r;
    });
  }
  // Páginas
  const size = def.pageSize || idx.length || 1;
  const pages = Math.max(1, Math.ceil(idx.length / size));
  const page = Math.min(state.page[id] || 0, pages - 1);
  state.page[id] = page;
  const slice = idx.slice(page * size, page * size + size);

  const barCols = head.map((h, i) => (h.bar ? i : -1)).filter((i) => i >= 0);
  const maxes = {};
  barCols.forEach((c) => { let m = 1e-9; for (let i = 0; i < A.n; i++) { const v = Math.abs(Number(A.val(i, c)) || 0); if (v > m) m = v; } maxes[c] = m; });

  const count = container.querySelector(".tbl-count");
  if (count) count.textContent = q ? `${fmt(idx.length)} de ${fmt(A.n)} filas` : `${fmt(A.n)} filas`;

  host.innerHTML = (idx.length ? `<div class="tbl-wrap"><table class="tbl">
    <thead><tr>${head.map((h, i) => {
      const act = s && s.col === i;
      const dir = act ? (s.dir === "asc" ? "ascending" : "descending") : "none";
      return `<th class="${h.num ? "num" : ""}" aria-sort="${dir}"><button type="button" class="th-sort" data-table="${id}" data-col="${i}">${h.t}<i class="fas ${act ? (s.dir === "asc" ? "fa-arrow-up-short-wide" : "fa-arrow-down-wide-short") : "fa-sort"}"></i></button></th>`;
    }).join("")}</tr></thead>
    <tbody>${slice.map((ri) => {
      const cond = A.cond(ri);
      return `<tr ${cond ? `class="is-clickable" tabindex="0" data-table="${id}" data-row="${ri}"` : ""}>${head.map((h, ci) => {
        const f = A.txt(ri, ci);
        const bar = barCols.includes(ci) ? `<span class="cell-bar" style="--w:${Math.max(2, (Math.abs(Number(A.val(ri, ci)) || 0) / maxes[ci]) * 100)}%"></span>` : "";
        return `<td class="${h.num ? "num" : ""} ${ci === 0 ? "name" : ""}" ${String(f).length > 40 ? `title="${esc(f)}"` : ""}>${bar}<span>${esc(trunc(f, 60))}</span></td>`;
      }).join("")}</tr>`;
    }).join("")}</tbody></table></div>` : `<p class="table-empty">Ninguna fila coincide con «${esc(state.q[id])}».</p>`)
    + (pages > 1 ? `<div class="tbl-pager">
        <span>Filas ${fmt(page * size + 1)}–${fmt(Math.min(idx.length, page * size + size))} de ${fmt(idx.length)}</span>
        <div class="pager-btns">
          <button type="button" class="btn-chip js-page" data-table="${id}" data-page="0" ${page === 0 ? "disabled" : ""} aria-label="Primera página"><i class="fas fa-angles-left"></i></button>
          <button type="button" class="btn-chip js-page" data-table="${id}" data-page="${page - 1}" ${page === 0 ? "disabled" : ""} aria-label="Página anterior"><i class="fas fa-angle-left"></i></button>
          <span class="pager-n">Página ${fmt(page + 1)} de ${fmt(pages)}</span>
          <button type="button" class="btn-chip js-page" data-table="${id}" data-page="${page + 1}" ${page >= pages - 1 ? "disabled" : ""} aria-label="Página siguiente"><i class="fas fa-angle-right"></i></button>
          <button type="button" class="btn-chip js-page" data-table="${id}" data-page="${pages - 1}" ${page >= pages - 1 ? "disabled" : ""} aria-label="Última página"><i class="fas fa-angles-right"></i></button>
        </div></div>` : "");
}

/* =========================== FILTROS =========================== */
const conFecha = () => DS().engine === "mov";
function filtrosActivos() { return FILTER_KEYS().filter((k) => state.filtros[k]); }
function hayFecha() { return !!(state.filtros.desde || state.filtros.hasta); }
function textoFecha() {
  const { desde, hasta } = state.filtros;
  if (!desde && !hasta) return "Todo el período";
  if (desde && desde === hasta) return fmtDiaLargo(desde);
  return `${fdia(desde || state.rango.min)} – ${fdia(hasta || state.rango.max)}`;
}
function fchip(k) {
  const cur = state.filtros[k], d = dimDef(k);
  return `<button type="button" class="fchip js-fopen ${cur ? "is-active" : ""}" data-dim="${k}" aria-haspopup="dialog" aria-expanded="false" title="${esc(cur || "Todos")}">
    <i class="fas ${d.icon}"></i><span class="fchip-label">${d.label}</span>
    <span class="fchip-value">${cur ? esc(cur) : "Todos"}</span><i class="fas fa-chevron-down fchip-caret" aria-hidden="true"></i></button>`;
}
function renderFiltros() {
  const fb = $("filterbar");
  const keys = FILTER_KEYS();
  const n = filtrosActivos().length + (hayFecha() ? 1 : 0);
  const more = keys.filter((k) => dimDef(k).group === "more");
  const masActivos = more.filter((k) => state.filtros[k]).length;
  fb.innerHTML = `
    <div class="fb-main">
      <span class="fb-title"><i class="fas fa-sliders"></i><span>Segmentadores</span>${n ? `<b class="fb-count">${n}</b>` : ""}</span>
      <div class="fb-chips">
        ${conFecha() ? `<button type="button" class="fchip js-fopen ${hayFecha() ? "is-active" : ""}" data-dim="fecha" aria-haspopup="dialog" aria-expanded="false">
          <i class="fas fa-calendar-days"></i><span class="fchip-label">Fecha guía</span><span class="fchip-value">${esc(textoFecha())}</span><i class="fas fa-chevron-down fchip-caret" aria-hidden="true"></i></button>` : ""}
        ${keys.filter((k) => dimDef(k).group === "main").map(fchip).join("")}
        ${more.length ? `<button type="button" class="fchip fchip-more js-more ${masActivos ? "is-active" : ""}" aria-expanded="${state.moreOpen}">
          <i class="fas ${state.moreOpen ? "fa-minus" : "fa-plus"}"></i><span class="fchip-value">${state.moreOpen ? "Menos filtros" : `Más filtros (${more.length})`}</span>${masActivos ? `<b class="fb-count">${masActivos}</b>` : ""}</button>` : ""}
      </div>
      <div class="fb-actions">
        <button type="button" class="btn-chip js-clear" ${n ? "" : "disabled"}><i class="fas fa-filter-circle-xmark"></i>Limpiar</button>
        <button type="button" class="btn-chip js-csv" title="Descargar el detalle en vista"><i class="fas fa-file-csv"></i>Exportar CSV</button>
      </div>
    </div>
    ${more.length ? `<div class="fb-more" ${state.moreOpen ? "" : "hidden"}>${more.map(fchip).join("")}</div>` : ""}`;
}

let fpState = { dim: null, btn: null };
const FP_MAX = 400; // opciones dibujadas a la vez; el buscador recorre todas
function abrirPanel(btn) {
  const dim = btn.dataset.dim;
  if (fpState.dim === dim) { cerrarPanel(); return; }
  cerrarPanel();
  const p = $("fpanel");
  if (dim === "fecha") {
    const meses = Array.from(new Set(state.dims.fechas.map((f) => f.slice(0, 7))));
    const { min, max } = state.rango;
    p.innerHTML = `
      <div class="fp-head"><b>Fecha guía</b><small>Datos del ${fdia(min)} al ${fdia(max)}</small></div>
      <div class="fp-presets">
        <button type="button" class="fp-preset" data-preset="all">Todo el período</button>
        <button type="button" class="fp-preset" data-preset="30">Últimos 30 días</button>
        <button type="button" class="fp-preset" data-preset="90">Últimos 90 días</button>
        <button type="button" class="fp-preset" data-preset="year">Año de la última fecha</button>
        ${meses.map((m) => { const [y, mm] = m.split("-"); return `<button type="button" class="fp-preset" data-month="${m}">${MES_CORTO[+mm - 1]} ${y}</button>`; }).join("")}
      </div>
      <div class="fp-dates">
        <label>Desde<input type="date" id="fpDesde" min="${min}" max="${max}" value="${state.filtros.desde || min}"></label>
        <label>Hasta<input type="date" id="fpHasta" min="${min}" max="${max}" value="${state.filtros.hasta || max}"></label>
      </div>
      <div class="fp-foot"><button type="button" class="btn-primary js-fp-apply"><i class="fas fa-check"></i>Aplicar rango</button></div>`;
  } else {
    const def = dimDef(dim);
    const base = filtrar(state.filas, state.filtros, dim);
    const counts = new Map();
    base.forEach((r) => counts.set(r[dim], (counts.get(r[dim]) || 0) + 1));
    const all = (state.dims[dim] || []).slice();
    const vals = def.sort === "mes" ? all : all.sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0));
    const cur = state.filtros[dim];
    p._vals = vals; p._counts = counts; p._dim = dim;
    p.innerHTML = `
      <div class="fp-head"><b>${def.label}</b><small>${fmt(vals.length)} valores · el número es la cantidad de filas con los demás filtros</small></div>
      ${vals.length > 8 ? `<label class="fp-search"><i class="fas fa-magnifying-glass"></i><input type="search" id="fpSearch" placeholder="Buscar ${def.label.toLowerCase()}…" autocomplete="off" aria-label="Buscar"></label>` : ""}
      <ul class="fp-list" role="listbox" aria-label="${def.label}">
        <li><button type="button" role="option" class="fp-opt ${!cur ? "is-sel" : ""}" data-value="" aria-selected="${!cur}"><span>Todos</span><b>${fmt(base.length)}</b></button></li>
        ${fpOpciones(vals, counts, cur, "")}
      </ul>`;
  }
  p.dataset.dim = dim;
  p.hidden = false;
  fpState = { dim, btn };
  btn.setAttribute("aria-expanded", "true");
  posicionarPanel();
  requestAnimationFrame(() => {
    p.classList.add("show");
    const f = p.querySelector("#fpSearch") || p.querySelector(".fp-opt.is-sel") || p.querySelector(".fp-preset");
    if (f) f.focus({ preventScroll: true });
  });
}
function fpOpciones(vals, counts, cur, q) {
  const L = q ? vals.filter((v) => fold2(v).includes(q)) : vals;
  const shown = L.slice(0, FP_MAX);
  return shown.map((v) => { const c = counts.get(v) || 0; return `<li data-opt><button type="button" role="option" class="fp-opt ${v === cur ? "is-sel" : ""} ${c ? "" : "is-zero"}" data-value="${esc(v)}" aria-selected="${v === cur}" title="${esc(v)}"><span>${esc(v)}</span><b>${fmt(c)}</b></button></li>`; }).join("")
    + (L.length > shown.length ? `<li class="fp-more">Se muestran ${fmt(shown.length)} de ${fmt(L.length)}: escribí para encontrar el resto.</li>` : "")
    + (q && !L.length ? `<li class="fp-more">Ningún valor contiene «${esc(q)}».</li>` : "");
}
function filtrarPanel(q) {
  const p = $("fpanel");
  if (!p._vals) return;
  const list = p.querySelector(".fp-list");
  list.querySelectorAll("li[data-opt], li.fp-more").forEach((li) => li.remove());
  list.insertAdjacentHTML("beforeend", fpOpciones(p._vals, p._counts, state.filtros[p._dim], fold2(q).trim()));
}
function posicionarPanel() {
  const p = $("fpanel"), b = fpState.btn;
  if (!b || p.hidden) return;
  const r = b.getBoundingClientRect(), m = 10;
  const w = Math.min(fpState.dim === "fecha" ? 390 : 360, window.innerWidth - m * 2);
  p.style.width = w + "px";
  p.style.left = Math.min(window.innerWidth - w - m, Math.max(m, r.left)) + "px";
  const espacio = window.innerHeight - r.bottom - m - 8;
  p.style.top = r.bottom + 8 + "px";
  p.style.maxHeight = Math.max(240, espacio) + "px";
}
function cerrarPanel() {
  const p = $("fpanel");
  if (fpState.btn) fpState.btn.setAttribute("aria-expanded", "false");
  p.classList.remove("show"); p.hidden = true; p.dataset.dim = ""; p._vals = null;
  fpState = { dim: null, btn: null };
}
function aplicarPreset(btn) {
  const { min, max } = state.rango;
  let desde = "", hasta = "";
  const pr = btn.dataset.preset, mo = btn.dataset.month;
  if (pr === "30") { desde = addDays(max, -29); hasta = max; }
  else if (pr === "90") { desde = addDays(max, -89); hasta = max; }
  else if (pr === "year") { desde = max.slice(0, 4) + "-01-01"; hasta = max; }
  else if (mo) { const [y, m] = mo.split("-").map(Number); desde = `${mo}-01`; hasta = toISO(new Date(y, m, 0)); }
  if (desde && desde < min) desde = min;
  if (hasta && hasta > max) hasta = max;
  if (desde === min && hasta === max) { desde = ""; hasta = ""; }
  setFecha(desde, hasta);
}
function setFecha(desde, hasta) {
  if (desde && hasta && desde > hasta) [desde, hasta] = [hasta, desde];
  state.filtros.desde = desde || "";
  state.filtros.hasta = hasta || "";
  cerrarPanel();
  render();
}
function setFiltro(k, v) {
  if (k === "fecha") { setFecha("", ""); return; }
  if (!FILTER_KEYS().includes(k)) return;
  state.filtros[k] = v || "";
  if (dimDef(k).group === "more" && v) state.moreOpen = true;
  cerrarPanel();
  render();
}
function limpiarFiltros() {
  state.filtros = { desde: "", hasta: "" };
  cerrarPanel();
  render();
}

/* =========================== CONTEXTO =========================== */
const UNIDAD = { kardex: "líneas del kardex", mov: "movimientos", valo: "proyectos" };
function renderContexto() {
  const s = secDef(state.seccion), ds = DS();
  const total = state.filas.length, enVista = state.vista.length;
  const chips = [];
  if (hayFecha()) chips.push({ k: "fecha", icon: "fa-calendar-days", label: "Fecha", val: textoFecha() });
  filtrosActivos().forEach((k) => chips.push({ k, icon: dimDef(k).icon, label: dimDef(k).label, val: state.filtros[k] }));

  $("crumbs").innerHTML = `
    <span class="crumb-sec"><i class="fas ${ds.icon}"></i>${ds.titulo}</span>
    <i class="fas fa-chevron-right crumb-sep" aria-hidden="true"></i>
    <span class="crumb-sec is-sub">${s.t}</span>
    <i class="fas fa-chevron-right crumb-sep" aria-hidden="true"></i>
    <span class="crumb-filters">${chips.length ? chips.map((c) => `${c.label}: <b>${esc(trunc(c.val, 28))}</b>`).join('<span class="crumb-dot"></span>') : "Todos los datos"}</span>`;

  $("contextBar").innerHTML = `
    <div class="ctx-main">
      <span class="ctx-pill"><i class="fas ${s.icon}"></i>Estás en <b>${ds.titulo} › ${s.t}</b></span>
      <span class="ctx-count">Mostrando <b>${fmt(enVista)}</b> de ${fmt(total)} ${UNIDAD[ds.engine]}${total ? ` · ${fmtPct((enVista / total) * 100, 0)}` : ""}${conFecha() ? ` · <b>${esc(textoFecha())}</b>` : ""}</span>
    </div>
    <div class="ctx-filters">
      ${chips.length
        ? chips.map((c) => `<button type="button" class="ctx-chip js-remove-filter" data-dim="${c.k}" title="Quitar este filtro"><i class="fas ${c.icon}"></i>${c.label}: <b>${esc(trunc(c.val, 34))}</b><i class="fas fa-xmark ctx-x"></i></button>`).join("")
        : `<span class="ctx-none"><i class="fas fa-layer-group"></i>Sin filtros: ves todos los datos</span>`}
    </div>`;
  $("contextBar").classList.toggle("has-filters", chips.length > 0);
  $("contextBar").classList.toggle("is-empty-view", total > 0 && enVista === 0);
  document.title = `${ds.titulo} · ${s.t}${chips.length ? " · " + chips.map((c) => trunc(c.val, 20)).join(" · ") : ""} | CORE Almacén`;
}

/* =========================== RENDER =========================== */
function render({ force = false } = {}) {
  if (!state.payload) return;
  state.tk = tokens();
  state.vista = filtrar(state.filas, state.filtros);
  state.d = ENG().calc(state.vista, state.filas);
  renderFiltros();
  renderContexto();
  writeHash();
  renderSeccion(state.seccion, { force });
}
function renderSeccion(sec, { force = false } = {}) {
  SEC_KEYS().forEach((k) => {
    const el = $("sec-" + k);
    const on = k === sec;
    if (on && el.hidden) { el.classList.remove("enter"); void el.offsetWidth; el.classList.add("enter"); }
    el.hidden = !on;
  });
  document.querySelectorAll("#dashTabs .tab").forEach((t) => {
    const on = t.dataset.seccion === sec;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  });
  if (!state.payload || !state.d) return;
  if (secDef(sec).kpis) renderKPIs();
  SPECS.filter((c) => c.sec === sec).forEach((c) => mountChart(c, { force }));
  XSPECS.filter((x) => x.sec === sec).forEach((x) => {
    const el = $(x.id);
    try {
      if (x.render) x.render(state.d, el);
      else { if (el.querySelector(".sk")) el.innerHTML = ""; renderTabla(el, x.id, x.table(state.d)); }
    } catch (err) { console.error(`Tabla ${x.id}:`, err); el.innerHTML = `<p class="table-empty">No se pudo calcular esta tabla.</p>`; }
  });
}
function cambiarSeccion(sec) {
  if (!SEC_KEYS().includes(sec)) sec = SEC_KEYS()[0];
  const cambio = sec !== state.seccion;
  state.seccion = sec;
  cerrarPopover(); cerrarPanel();
  if (state.payload) renderContexto();
  writeHash();
  renderSeccion(sec, { force: cambio });
  renderBoardNav();
  if (cambio) window.scrollTo({ top: 0, behavior: REDUCED ? "auto" : "smooth" });
}

/* =========================== TABLEROS =========================== */
function guardarStore() { DS_FIELDS.forEach((f) => { STORE[state.ds][f] = state[f]; }); }
function cambiarDataset(key, { sec, filtros } = {}) {
  if (!DATASETS[key]) return;
  if (key === state.ds && !filtros) { if (sec) cambiarSeccion(sec); return; }
  cerrarPopover(); cerrarPanel(); cerrarDrill(); cerrarModal();
  guardarStore();
  state.ds = key;
  DS_FIELDS.forEach((f) => { state[f] = STORE[key][f]; });
  if (filtros) state.filtros = filtros;
  state.seccion = sec && SEC_KEYS().includes(sec) ? sec : state.seccion && SEC_KEYS().includes(state.seccion) ? state.seccion : SEC_KEYS()[0];
  state.vista = []; state.d = null;
  try { localStorage.setItem(CONFIG.LS_DATASET, key); } catch (_) {}
  construirLayout();
  const pub = PUB[DS().sheet];
  const vigente = state.payload && (!PUB._checked || (pub && firmaPub(pub) === state.signature));
  if (vigente) {
    mostrarEstadoGlobal(null);
    pintarStatus();
    render({ force: true });
  } else {
    if (PUB._checked && !pub) { state.payload = null; state.filas = []; pintarStatus(); mostrarEstadoGlobal("vacio"); writeHash(); renderSeccion(state.seccion); return; }
    document.body.classList.add("is-loading");
    mostrarEstadoGlobal(null);
    $("filterbar").innerHTML = ""; $("contextBar").innerHTML = "";
    renderSeccion(state.seccion);
    writeHash();
    cargarDatos("tablero");
  }
  window.scrollTo({ top: 0, behavior: "auto" });
}

/* =========================== URL (#tablero/sección?filtros) =========================== */
function leerHash() {
  const raw = location.hash.replace(/^#/, "");
  const [path, qs] = raw.split("?");
  const [ds, sec] = path.split("/").map((x) => decodeURIComponent(x || ""));
  const p = new URLSearchParams(qs || "");
  const filtros = {};
  p.forEach((v, k) => { filtros[k] = v; });
  return { ds: DATASETS[ds] ? ds : null, sec, filtros };
}
function writeHash() {
  const p = new URLSearchParams();
  ["desde", "hasta", ...FILTER_KEYS()].forEach((k) => { if (state.filtros[k]) p.set(k, state.filtros[k]); });
  const qs = p.toString();
  const url = new URL(location.href);
  url.searchParams.delete("t");
  url.hash = `${state.ds}/${state.seccion}` + (qs ? "?" + qs : "");
  if (url.href !== location.href) history.replaceState(null, "", url.href);
}

/* =========================== DRILL-DOWN =========================== */
let drillReturnFocus = null;
const SHARE_LABEL = { kardex: "el stock actual en vista", mov: "el monto movido en vista", valo: "el stock final en vista" };
function abrirDrill(conds) {
  if (!conds || !conds.length || !state.d) return;
  cerrarPanel();
  const eng = ENG(), ds = DS();
  const rows = state.vista.filter((r) => conds.every((c) => matchCond(r, c)));
  const k = eng.agg(rows);
  const sk = eng.shareKey, tot = state.d.k[sk];
  const porValor = tot > 0 && k[sk] > 0;
  const share = porValor ? (k[sk] / tot) * 100 : state.d.k.n ? (k.n / state.d.k.n) * 100 : 0;
  $("drawerKicker").textContent = `${ds.titulo} · ${conds.map((c) => dimLabel(c.dim)).join(" · ")}`;
  $("drawerTitle").textContent = conds.map((c) => c.label || String(c.value)).join(" · ");

  const usados = new Set(conds.map((c) => (c.dim === "mesKey" ? "mes" : c.dim === "codigo" || c.dim === "set" ? "_nombre" : c.dim)));
  const [bdim, blabel] = eng.drillDims.find(([dm]) => !usados.has(dm) && rows.length && dm in rows[0] && new Set(rows.map((r) => r[dm])).size > 1) || [];
  let breakdown = null;
  if (bdim) {
    const list = bdim === "mes" ? porMes(rows) : porDim(rows, bdim, sk);
    const c0 = eng.drillCols(list[0]);
    breakdown = {
      head: [{ t: blabel }, ...c0.map((c, i) => ({ t: c[0], num: 1, bar: c[3] ? 1 : 0 }))],
      rows: list.map((x) => [bdim === "mes" ? cell(x.key, () => x.label) : x.label, ...eng.drillCols(x).map((c) => cell(c[1], c[2]))]),
      searchable: list.length > 15, pageSize: 15,
    };
  }
  $("drawerBody").innerHTML = `
    <div class="drill-share">
      <div class="drill-share-top"><span>Peso en ${porValor ? SHARE_LABEL[ds.engine] : "las filas en vista"}</span><b>${fmtPct(share)}</b></div>
      <div class="kpi-bar"><i style="width:${Math.min(100, share)}%"></i></div>
      <small>${fmt(rows.length)} ${UNIDAD[ds.engine]} · ${conds.length > 1 ? "combinación seleccionada" : "dentro de los filtros actuales"}</small>
    </div>
    <dl class="drill-grid">${eng.drillMini(k).map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join("")}</dl>
    ${breakdown ? `<h3 class="drill-sub">Desglose por ${blabel.toLowerCase()}</h3><div id="drillTable"></div>` : ""}`;
  if (breakdown) { state.page.drill = 0; state.q.drill = ""; renderTabla($("drillTable"), "drill", breakdown); }

  const aplicables = [];
  conds.forEach((c) => {
    if (c.dim === "mesKey") { if (FILTER_KEYS().includes("mes") && rows[0]) aplicables.push({ dim: "mes", value: rows[0].mes, label: rows[0].mes }); }
    else if (c.dim === "codigo" && FILTER_KEYS().includes("recurso") && rows[0]) aplicables.push({ dim: "recurso", value: rows[0].recurso, label: rows[0].recurso });
    else if (FILTER_KEYS().includes(c.dim)) aplicables.push({ dim: c.dim, value: c.value, label: c.label || c.value });
  });
  $("drawerFoot").innerHTML = aplicables.length
    ? `<button type="button" class="btn-primary" id="drillApply"><i class="fas fa-filter"></i>Filtrar el tablero por ${esc(trunc(aplicables.map((a) => a.label).join(" + "), 56))}</button>
       <button type="button" class="btn-ghost" id="drillCancel">Cerrar</button>`
    : `<p class="drill-note"><i class="fas fa-circle-info"></i>${esc(dimLabel(conds[0].dim))} no es un segmentador de este tablero: esta vista es solo de detalle.</p>
       <button type="button" class="btn-ghost" id="drillCancel">Cerrar</button>`;
  const ap = $("drillApply");
  if (ap) ap.addEventListener("click", () => {
    aplicables.forEach((a) => { state.filtros[a.dim] = a.value; if (dimDef(a.dim).group === "more") state.moreOpen = true; });
    cerrarDrill(); render();
    toast(`Filtro aplicado: ${aplicables.map((a) => a.label).join(", ")}`, "info");
  });
  $("drillCancel").addEventListener("click", cerrarDrill);

  drillReturnFocus = document.activeElement;
  $("scrim").hidden = false;
  requestAnimationFrame(() => { document.body.classList.add("drawer-open"); $("drawer").setAttribute("aria-hidden", "false"); });
  setTimeout(() => $("drawerClose").focus(), 60);
}
function cerrarDrill() {
  if (!document.body.classList.contains("drawer-open")) return;
  document.body.classList.remove("drawer-open");
  $("drawer").setAttribute("aria-hidden", "true");
  setTimeout(() => { $("scrim").hidden = true; }, 280);
  if (drillReturnFocus && drillReturnFocus.focus) drillReturnFocus.focus();
}

/* =========================== POPOVER DE AYUDA =========================== */
let popState = { btn: null, pinned: false, timer: null };
function mostrarPopover(btn, pinned = false) {
  const info = INFO[btn.dataset.info];
  if (!info) return;
  const pop = $("popover");
  pop.innerHTML = `
    <p class="pop-title">${esc(info.title)}</p>
    <div class="pop-block"><span class="pop-label"><i class="fas fa-eye"></i>Qué muestra</span><p>${esc(info.what)}</p></div>
    <div class="pop-block"><span class="pop-label"><i class="fas fa-calculator"></i>Cómo se calcula</span><p>${esc(info.how)}</p></div>
    ${info.tip ? `<p class="pop-tip"><i class="fas fa-hand-pointer"></i>${esc(info.tip)}</p>` : ""}`;
  if (popState.btn && popState.btn !== btn) popState.btn.setAttribute("aria-expanded", "false");
  popState.btn = btn; popState.pinned = pinned;
  btn.setAttribute("aria-expanded", "true");
  pop.hidden = false;
  pop.classList.toggle("is-pinned", pinned);
  // Posición: debajo y alineado a la derecha del botón, sin salirse de la pantalla
  const r = btn.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight, m = 10;
  let left = Math.min(window.innerWidth - pw - m, Math.max(m, r.right - pw + 8));
  let top = r.bottom + 8, above = false;
  if (top + ph > window.innerHeight - m) { top = r.top - ph - 8; above = true; }
  pop.style.left = left + "px"; pop.style.top = Math.max(m, top) + "px";
  pop.style.setProperty("--arrow-x", Math.min(pw - 14, Math.max(14, r.left + r.width / 2 - left)) + "px");
  pop.classList.toggle("above", above);
  pop.classList.remove("show"); void pop.offsetWidth; pop.classList.add("show");
}
function cerrarPopover() {
  const pop = $("popover");
  if (popState.btn) popState.btn.setAttribute("aria-expanded", "false");
  popState = { btn: null, pinned: false, timer: null };
  pop.classList.remove("show"); pop.hidden = true;
}


/* =========================== MODAL (ampliar) =========================== */
let modalChart = null, modalReturnFocus = null;
function abrirModal(id) {
  const spec = SPECS.find((c) => c.id === id);
  if (!spec || !state.d) return;
  const out = spec.build(state.d, state.tk, DS());
  if (out.empty) { toast("No hay datos para ampliar con estos filtros.", "info"); return; }
  $("modalTitle").textContent = spec.title;
  const ctx = filtrosActivos().map((k) => `${dimLabel(k)}: ${state.filtros[k]}`).join(" · ");
  $("modalSub").textContent = `${DS().titulo} · ${spec.sub}${ctx ? " · " + ctx : ""}`;
  modalReturnFocus = document.activeElement;
  $("modal").hidden = false;
  document.body.classList.add("modal-open");
  if (modalChart) modalChart.destroy();
  const cfg = wire(spec, out, out.config);
  if (cfg.type === "doughnut") cfg.options.plugins.legend = merge(legendCfg(state.tk, true), { position: "right" });
  if (cfg.type === "bar" && cfg.options.indexAxis === "y") cfg.options.scales.y.ticks.callback = function (v) { const l = this && this.getLabelForValue ? this.getLabelForValue(v) : v; return trunc(l, 60); };
  modalChart = new Chart($("modalCanvas"), cfg);
  setTimeout(() => $("modalClose").focus(), 30);
}
function cerrarModal() {
  if ($("modal").hidden) return;
  $("modal").hidden = true;
  document.body.classList.remove("modal-open");
  if (modalChart) { modalChart.destroy(); modalChart = null; }
  if (modalReturnFocus && modalReturnFocus.focus) modalReturnFocus.focus();
}

/* =========================== EXPORTAR =========================== */
function descargarPNG(id) {
  const ch = charts[id];
  const spec = SPECS.find((c) => c.id === id);
  if (!ch || !spec) { toast("Este gráfico no tiene datos para exportar.", "info"); return; }
  const a = document.createElement("a");
  a.href = ch.toBase64Image("image/png", 1);
  a.download = `${slug(DS().titulo)}_${slug(spec.title)}_${new Date().toISOString().slice(0, 10)}.png`;
  document.body.appendChild(a); a.click(); a.remove();
  toast(`Imagen descargada: ${spec.title}`, "ok", 2600);
}
function descargarCSV(def, nombre) {
  const q = (v) => { const s = v == null ? "" : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const A = acceso(def);
  const val = (i, c) => { const v = A.val(i, c); return typeof v === "string" && v.startsWith("(") ? "" : v; };
  const lines = [A.head.map((h) => q(h.t)).join(",")];
  for (let i = 0; i < A.n; i++) lines.push(A.head.map((_, c) => q(val(i, c))).join(","));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const suf = [state.filtros.desde, state.filtros.hasta, ...filtrosActivos().map((k) => slug(trunc(state.filtros[k], 24)))].filter(Boolean).join("_");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${nombre}${suf ? "_" + suf : ""}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`CSV descargado: ${fmt(A.n)} filas`, "ok", 2600);
}
function exportarCSV(id) {
  if (!state.d) return;
  const det = id || DS().secs.flatMap((s) => s.items.map((i) => i[0])).find((x) => /^tDet/.test(x));
  const x = TLIB[det];
  if (!x) return;
  descargarCSV(x.table(state.d), `${slug(DS().titulo)}_${slug(txt(x.title))}`);
}

/* =========================== TOASTS =========================== */
function toast(texto, tipo = "info", ms = 4200) {
  const t = document.createElement("div");
  t.className = `toast ${tipo}`;
  const ico = { ok: "fa-circle-check", error: "fa-circle-exclamation", info: "fa-circle-info", new: "fa-bolt" }[tipo] || "fa-circle-info";
  t.innerHTML = `<i class="fas ${ico}"></i><span>${esc(texto)}</span><button type="button" class="toast-x" aria-label="Cerrar aviso"><i class="fas fa-xmark"></i></button>`;
  const close = () => { t.classList.add("out"); setTimeout(() => t.remove(), 260); };
  t.querySelector(".toast-x").addEventListener("click", close);
  $("toasts").appendChild(t);
  setTimeout(close, ms);
}

/* =========================== DATOS: CARGA Y SINCRONIZACIÓN =========================== */
function firma(rowIndex, meta) { return `${rowIndex}|${(meta && meta.uploadedAt) || "legacy"}`; }
const firmaPub = (pub) => (pub ? firma(pub.row_index, pub.meta) : null);

// Consulta liviana: la última versión de los 8 tableros (sin traer los datos)
async function consultarPublicados() {
  const sheets = DS_KEYS.map((k) => DATASETS[k].sheet);
  const { data, error } = await sb.from(CONFIG.TABLE)
    .select("sheet_name, row_index, meta:data->meta")
    .in("sheet_name", sheets)
    .order("row_index", { ascending: false });
  if (error) throw error;
  const ult = {};
  (data || []).forEach((r) => { if (!ult[r.sheet_name]) ult[r.sheet_name] = r; });
  sheets.forEach((s) => { PUB[s] = ult[s] || null; });
  PUB._checked = true;
  // Los tableros guardados en memoria con una versión vieja se vuelven a leer al abrirlos
  DS_KEYS.forEach((k) => {
    if (k === state.ds) return;
    const st = STORE[k], pub = PUB[DATASETS[k].sheet];
    if (st.signature && (!pub || firmaPub(pub) !== st.signature)) { st.payload = null; st.filas = []; st.signature = null; }
  });
  renderBoardNav();
  return PUB;
}

async function fetchDataset(key) {
  const { data, error } = await sb.from(CONFIG.TABLE)
    .select("row_index, data")
    .eq("sheet_name", DATASETS[key].sheet)
    .order("row_index", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data && data[0] ? data[0] : null;
}

function setSync(modo, texto) {
  const s = $("syncStatus");
  s.dataset.mode = modo;
  $("syncText").textContent = texto;
}
function pintarSync() {
  if (!state.lastSync) return;
  if ($("syncStatus").dataset.mode === "error") return;
  setSync("live", `En vivo · ${relTime(state.lastSync)}`);
  $("stSync").textContent = relTime(state.lastSync);
  if (state.uploadedAt) { $("stPublicado").textContent = relTime(state.uploadedAt); const bm = $("bhMeta"); if (bm) bm.innerHTML = `<i class="fas fa-cloud-arrow-up"></i>Publicado ${relTime(state.uploadedAt)}`; }
}
function pintarStatus() {
  const m = (state.payload && state.payload.meta) || {};
  $("stArchivo").textContent = m.archivo || "—";
  $("stArchivo").title = m.archivo || "";
  $("stHoja").textContent = m.hoja || DS().tab;
  $("stRegistros").textContent = state.payload ? fmt(state.filas.length) : "—";
  $("stPeriodo").textContent = state.rango.min ? `${fdia(state.rango.min)} – ${fdia(state.rango.max)}` : m.anio ? `Año ${m.anio}` : "Foto al cierre";
  $("stPublicado").textContent = state.uploadedAt ? relTime(state.uploadedAt) : "—";
  $("stPublicado").title = state.uploadedAt ? new Date(state.uploadedAt).toLocaleString("es-PE") : "";
  const bm = $("bhMeta");
  if (bm) bm.innerHTML = state.uploadedAt ? `<i class="fas fa-cloud-arrow-up"></i>Publicado ${relTime(state.uploadedAt)}${m.archivo ? ` · <span title="${esc(m.archivo)}">${esc(trunc(m.archivo, 34))}</span>` : ""}` : "";
}

/**
 * Carga completa del tablero actual desde Supabase.
 * motivo: "inicial" | "manual" | "nuevo" | "aviso" | "visible" | "tablero"
 */
function cargarDatos(motivo = "inicial") {
  if (state.loading) return state.loading;
  const key = state.ds;
  const inicial = !state.payload;
  document.body.classList.add(inicial ? "is-loading" : "is-refreshing");
  document.querySelectorAll(".js-refresh").forEach((b) => { b.disabled = true; b.classList.add("is-loading"); });
  setSync("syncing", "Sincronizando…");

  state.loading = (async () => {
    try {
      const firmaPrev = state.signature;
      await consultarPublicados().catch((e) => console.warn("Consulta de tableros falló:", e));
      let row = await fetchDataset(key);
      const debeEsperar = motivo === "aviso" || motivo === "nuevo" || !!state.payload;
      for (let i = 0; !row && debeEsperar && i < 3; i++) { await sleep(600 * (i + 1)); row = await fetchDataset(key); }
      if (key !== state.ds) return;          // el usuario cambió de tablero mientras cargaba
      await aplicarRow(row);
      state.lastSync = new Date();
      state.error = null;
      pintarSync();
      renderBoardNav();
      if (motivo === "manual") toast(firmaPrev && firmaPrev === state.signature ? "Ya tenés los datos más recientes." : "Datos actualizados desde Supabase.", "ok", 2800);
      else if ((motivo === "nuevo" || motivo === "aviso") && firmaPrev && firmaPrev !== state.signature) toast(`Llegó una versión nueva de «${DS().tab}»: el tablero se actualizó.`, "new", 5000);
    } catch (err) {
      console.error(err);
      state.error = err;
      setSync("error", "Sin conexión · reintentando");
      if (!state.payload) mostrarEstadoGlobal("error", err);
      else if (motivo === "manual") toast("No se pudo actualizar: " + (err.message || err), "error", 6000);
    } finally {
      document.body.classList.remove("is-loading", "is-refreshing");
      document.querySelectorAll(".js-refresh").forEach((b) => { b.disabled = false; b.classList.remove("is-loading"); });
      state.loading = null;
    }
  })();
  return state.loading;
}

async function aplicarRow(row) {
  const ds = DS();
  const enc = row && row.data ? await descomprimir(row.data) : null;
  const filas = enc ? decodificar(enc) : [];
  if (!filas.length) {
    state.payload = null; state.filas = []; state.signature = row ? firma(row.row_index, row.data && row.data.meta) : null;
    state.rango = { min: "", max: "" }; state.uploadedAt = null;
    Object.keys(charts).forEach((id) => { charts[id].destroy(); delete charts[id]; });
    pintarStatus();
    mostrarEstadoGlobal("vacio");
    guardarStore();
    return;
  }
  const meta = row.data.meta || {};
  state.signature = firma(row.row_index, meta);
  state.payload = { meta, kpis: row.data.kpis };
  state.uploadedAt = meta.uploadedAt || null;
  state.filas = ENGINES[ds.engine].prep(filas, meta, ds);
  state.dims = calcDims(state.filas);
  state.rango = { min: state.dims.fechas[0] || "", max: state.dims.fechas[state.dims.fechas.length - 1] || "" };

  FILTER_KEYS().forEach((k) => { if (state.filtros[k] && !(state.dims[k] || []).includes(state.filtros[k])) state.filtros[k] = ""; });
  if (state.filtros.desde && state.filtros.desde > state.rango.max) state.filtros.desde = "";
  if (state.filtros.hasta && state.filtros.hasta < state.rango.min) state.filtros.hasta = "";

  pintarStatus();
  mostrarEstadoGlobal(null);
  render({ force: true });
  guardarStore();
}

function mostrarEstadoGlobal(tipo, err) {
  const g = $("globalState");
  document.body.classList.toggle("no-data", !!tipo);
  if (!tipo) { g.innerHTML = ""; return; }
  SEC_KEYS().forEach((k) => { const s = $("sec-" + k); if (s) s.hidden = true; });
  $("filterbar").innerHTML = ""; $("contextBar").innerHTML = ""; cerrarPanel();
  const ds = DS();
  $("crumbs").innerHTML = `<span class="crumb-sec"><i class="fas ${ds.icon}"></i>${ds.titulo}</span><i class="fas fa-chevron-right crumb-sep"></i><span class="crumb-filters">Sin datos</span>`;
  const otros = DS_KEYS.filter((k) => k !== state.ds && PUB[DATASETS[k].sheet]);
  g.innerHTML = tipo === "vacio"
    ? `<div class="global-empty">
         <span class="ge-ico"><i class="fas fa-file-excel"></i></span>
         <h2>«${ds.titulo}» todavía no tiene datos</h2>
         <p>Cargá el Excel <b>${esc(FILES[ds.file].excel)}</b> (pestaña «${esc(ds.tab)}») en la pantalla de inicio. Apenas lo publiques, este tablero se actualiza solo.</p>
         <a class="btn-primary js-go-home" href="${CONFIG.HOME_URL}"><i class="fas fa-file-arrow-up"></i>Cargar Excel</a>
         ${otros.length ? `<p class="ge-alt">Con datos ahora: ${otros.map((k) => `<a href="#${k}/${DATASETS[k].secs[0].k}" class="ge-link" data-ds="${k}">${DATASETS[k].titulo}</a>`).join(" · ")}</p>` : ""}
       </div>`
    : `<div class="global-empty is-error">
         <span class="ge-ico"><i class="fas fa-plug-circle-xmark"></i></span>
         <h2>No se pudo leer el tablero</h2>
         <p>${esc((err && err.message) || "Revisá tu conexión a internet.")}</p>
         <button type="button" class="btn-primary js-refresh"><i class="fas fa-rotate"></i>Reintentar</button>
       </div>`;
}

/* Chequeo liviano: solo trae la versión de cada tablero, no los datos */
async function hayNovedades() {
  if (state.loading || document.visibilityState !== "visible") return;
  try {
    await consultarPublicados();
    state.lastSync = new Date();
    if (state.error) { state.error = null; setSync("live", "En vivo"); }
    const pub = PUB[DS().sheet];
    if (!pub) { if (state.payload) await cargarDatos("nuevo"); else pintarSync(); return; }
    if (firmaPub(pub) !== state.signature) await cargarDatos("nuevo");
    else pintarSync();
  } catch (err) {
    console.warn("Chequeo de novedades falló:", err);
    setSync("error", "Sin conexión · reintentando");
  }
}
const hayNovedadesDebounced = debounce(hayNovedades, 400);

function iniciarSincronizacion() {
  let ultimoAviso = 0;
  const alAviso = (msg) => {
    if (!msg || msg.type !== "data-updated" || msg.at === ultimoAviso) return;   // llega por BroadcastChannel y por storage
    ultimoAviso = msg.at;
    const sheets = msg.sheets || [];
    if (!sheets.length || sheets.includes(DS().sheet)) cargarDatos("aviso");
    else consultarPublicados().catch(() => {});
    if (sheets.length) {
      const nombres = sheets.map(dsOf).filter(Boolean).filter((k) => k !== state.ds).map((k) => DATASETS[k].titulo);
      if (nombres.length) toast(`Datos nuevos en: ${nombres.join(", ")}`, "new", 5000);
    }
  };
  // 1) Aviso inmediato desde la pestaña de carga (mismo navegador)
  try { const bc = new BroadcastChannel(CONFIG.BUS); bc.onmessage = (e) => alAviso(e.data); } catch (_) {}
  window.addEventListener("storage", (e) => { if (e.key === CONFIG.LS_UPLOAD && e.newValue) { try { alAviso(JSON.parse(e.newValue)); } catch (_) {} } });
  // 2) Supabase Realtime (si está habilitado para la tabla; si no, no molesta)
  try { sb.channel("core-almacen-data").on("postgres_changes", { event: "*", schema: "public", table: CONFIG.TABLE }, () => hayNovedadesDebounced()).subscribe(); } catch (_) {}
  // 3) Al volver a la pestaña / ventana
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") hayNovedadesDebounced(); });
  window.addEventListener("focus", hayNovedadesDebounced);
  // 4) Restaurado desde el historial (bfcache)
  window.addEventListener("pageshow", (e) => { if (e.persisted) cargarDatos("visible"); });
  // 5) Sondeo liviano
  setInterval(hayNovedades, CONFIG.POLL_MS);
  setInterval(pintarSync, 15000);
  // 6) Vuelve la red
  window.addEventListener("online", () => cargarDatos("visible"));
}

/* =========================== TEMA =========================== */
function setTheme(t, { rerender = true } = {}) {
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem(CONFIG.LS_THEME, t); } catch (_) {}
  const b = $("btnTheme");
  b.innerHTML = `<i class="fas ${t === "dark" ? "fa-sun" : "fa-moon"}"></i>`;
  b.title = `Cambiar a tema ${t === "dark" ? "claro" : "oscuro"} (tecla T)`;
  if (rerender && state.payload) render({ force: true });
}
function toggleTheme() { setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"); }

/* =========================== EVENTOS =========================== */
function engancharEventos() {
  document.addEventListener("click", (e) => {
    const t = e.target;
    const board = t.closest(".board[data-ds], .ge-link[data-ds]");
    if (board) { e.preventDefault(); cambiarDataset(board.dataset.ds); return; }
    const tab = t.closest("#dashTabs .tab");
    if (tab) { e.preventDefault(); cambiarSeccion(tab.dataset.seccion); return; }

    const home = t.closest(".js-go-home");
    if (home) { e.preventDefault(); window.location.href = `${CONFIG.HOME_URL}?t=${Date.now()}`; return; }

    if (t.closest(".js-refresh")) { cargarDatos("manual"); return; }
    if (t.closest("#btnTheme")) { toggleTheme(); return; }

    const info = t.closest(".js-info");
    if (info) {
      e.stopPropagation();
      if (popState.btn === info && popState.pinned) cerrarPopover(); else mostrarPopover(info, true);
      return;
    }
    if (!t.closest("#popover") && popState.pinned) cerrarPopover();

    const fo = t.closest(".js-fopen");
    if (fo) { e.stopPropagation(); abrirPanel(fo); return; }
    if (t.closest(".js-more")) { state.moreOpen = !state.moreOpen; cerrarPanel(); renderFiltros(); return; }
    const opt = t.closest(".fp-opt");
    if (opt) { setFiltro($("fpanel").dataset.dim, opt.dataset.value); return; }
    const pre = t.closest(".fp-preset");
    if (pre) { aplicarPreset(pre); return; }
    if (t.closest(".js-fp-apply")) { setFecha($("fpDesde").value, $("fpHasta").value); return; }
    if (!t.closest("#fpanel") && fpState.dim) cerrarPanel();

    const pg = t.closest(".js-page");
    if (pg) { state.page[pg.dataset.table] = +pg.dataset.page; pintarTabla(pg.dataset.table); return; }

    if (t.closest(".js-clear")) { limpiarFiltros(); return; }
    if (t.closest(".js-csv")) { exportarCSV(); return; }
    const csvT = t.closest(".js-csv-table");
    if (csvT) { exportarCSV(csvT.dataset.table); return; }
    const rm = t.closest(".js-remove-filter");
    if (rm) { setFiltro(rm.dataset.dim, ""); return; }

    const card = t.closest(".chart-card");
    if (card && t.closest(".js-table")) {
      const btn = t.closest(".js-table");
      const on = !card.classList.contains("show-table");
      card.classList.toggle("show-table", on);
      card.querySelector(".table-view").hidden = !on;
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.innerHTML = `<i class="fas ${on ? "fa-chart-simple" : "fa-table-list"}"></i>`;
      btn.title = on ? "Ver como gráfico" : "Ver como tabla";
      return;
    }
    if (card && t.closest(".js-expand")) { abrirModal(card.dataset.chart); return; }
    if (card && t.closest(".js-png")) { descargarPNG(card.dataset.chart); return; }

    const dl = t.closest(".dl-item");
    if (dl) {
      const out = outs[dl.dataset.chart];
      const cond = out && out.drill && out.drill({ index: +dl.dataset.index, datasetIndex: 0 });
      if (cond) abrirDrill(cond);
      return;
    }
    const th = t.closest(".th-sort");
    if (th) {
      const id = th.dataset.table, col = +th.dataset.col;
      const s = state.sort[id];
      state.sort[id] = s && s.col === col ? { col, dir: s.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" };
      state.page[id] = 0;
      pintarTabla(id);
      return;
    }
    const tr = t.closest("tr.is-clickable");
    if (tr) { const tb = tables[tr.dataset.table]; const c = tb && tb.def._a && tb.def._a.cond(+tr.dataset.row); if (c) abrirDrill(c); return; }

    const ins = t.closest(".insight-btn[data-insight]");
    if (ins) { const host = ins.closest(".card-body"); const c = host && host._conds && host._conds[+ins.dataset.insight]; if (c) abrirDrill(c); return; }

    if (t.closest("#drawerClose") || t.closest("#scrim")) { cerrarDrill(); return; }
    if (t.closest("#modalClose") || t === $("modal")) { cerrarModal(); return; }
  });

  const buscarTabla = debounce((id) => { state.page[id] = 0; pintarTabla(id); }, 180);
  const buscarPanel = debounce((q) => filtrarPanel(q), 120);
  document.addEventListener("input", (e) => {
    const ts = e.target.closest(".tbl-search input");
    if (ts) { state.q[ts.dataset.table] = ts.value; buscarTabla(ts.dataset.table); return; }
    if (e.target.id === "fpSearch") buscarPanel(e.target.value);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "fpSearch") {
      const first = document.querySelector("#fpanel .fp-list li[data-opt] .fp-opt");
      if (first) { e.preventDefault(); first.click(); }
    }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && e.target.closest && e.target.closest("#fpanel")) {
      const items = Array.from(document.querySelectorAll("#fpanel .fp-opt, #fpanel #fpSearch"));
      const i = items.indexOf(document.activeElement);
      const nxt = items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (nxt) { e.preventDefault(); nxt.focus(); }
    }
  });

  document.addEventListener("mouseover", (e) => {
    const b = e.target.closest(".js-info");
    if (!b || popState.pinned) return;
    clearTimeout(popState.timer);
    popState.timer = setTimeout(() => mostrarPopover(b, false), 140);
  });
  document.addEventListener("mouseout", (e) => {
    const b = e.target.closest(".js-info");
    if (!b || popState.pinned) return;
    clearTimeout(popState.timer);
    if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest(".js-info")) cerrarPopover();
  });
  document.addEventListener("focusin", (e) => { const b = e.target.closest && e.target.closest(".js-info"); if (b && !popState.pinned) mostrarPopover(b, false); });
  document.addEventListener("focusout", (e) => { const b = e.target.closest && e.target.closest(".js-info"); if (b && !popState.pinned) cerrarPopover(); });
  window.addEventListener("scroll", () => { if (popState.btn && !popState.pinned) cerrarPopover(); posicionarPanel(); }, { passive: true });
  window.addEventListener("resize", debounce(() => { if (popState.btn) mostrarPopover(popState.btn, popState.pinned); posicionarPanel(); }, 100));

  document.addEventListener("mouseover", (e) => {
    const dl = e.target.closest(".dl-item");
    if (!dl) return;
    const ch = charts[dl.dataset.chart];
    if (!ch) return;
    const i = +dl.dataset.index;
    ch.$focus = { i, ds: 0 };
    ch.setActiveElements([{ datasetIndex: 0, index: i }]);
    ch.tooltip.setActiveElements([{ datasetIndex: 0, index: i }], { x: 0, y: 0 });
    ch.update("none");
  });
  document.addEventListener("mouseout", (e) => {
    const dl = e.target.closest(".dl-item");
    if (!dl || (e.relatedTarget && dl.contains(e.relatedTarget))) return;
    const ch = charts[dl.dataset.chart];
    if (!ch) return;
    ch.$focus = null; ch.setActiveElements([]); ch.tooltip.setActiveElements([], { x: 0, y: 0 }); ch.update("none");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (fpState.dim) { const b = fpState.btn; cerrarPanel(); if (b) b.focus(); return; }
      cerrarPopover(); cerrarDrill(); cerrarModal(); return;
    }
    const tr = e.target.closest && e.target.closest("tr.is-clickable");
    if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); tr.click(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    if (document.body.classList.contains("drawer-open") || document.body.classList.contains("modal-open")) return;
    const secs = SEC_KEYS();
    if (e.key >= "1" && e.key <= String(secs.length)) cambiarSeccion(secs[+e.key - 1]);
    else if (e.key === "[" || e.key === "]") { const i = DS_KEYS.indexOf(state.ds); cambiarDataset(DS_KEYS[(i + (e.key === "]" ? 1 : DS_KEYS.length - 1)) % DS_KEYS.length]); }
    else if (e.key === "r" || e.key === "R") cargarDatos("manual");
    else if (e.key === "t" || e.key === "T") toggleTheme();
  });

  window.addEventListener("hashchange", () => {
    const h = leerHash();
    if (h.ds && h.ds !== state.ds) { cambiarDataset(h.ds, { sec: h.sec, filtros: { desde: "", hasta: "", ...h.filtros } }); return; }
    const f = { desde: "", hasta: "", ...h.filtros };
    const same = ["desde", "hasta", ...FILTER_KEYS()].every((k) => (state.filtros[k] || "") === (f[k] || ""));
    if (!same) { state.filtros = f; if (h.sec && SEC_KEYS().includes(h.sec)) state.seccion = h.sec; render(); }
    else if (h.sec && h.sec !== state.seccion) cambiarSeccion(h.sec);
  });

  try {
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (ev) => {
      let saved = null; try { saved = localStorage.getItem(CONFIG.LS_THEME); } catch (_) {}
      if (!saved) setTheme(ev.matches ? "dark" : "light");
    });
  } catch (_) {}
}

/* =========================== INICIO =========================== */
(async function init() {
  setupChartDefaults();
  const h = leerHash();
  let ini = h.ds;
  if (!ini) { try { ini = localStorage.getItem(CONFIG.LS_DATASET); } catch (_) {} }
  if (!DATASETS[ini]) ini = DS_KEYS[0];
  state.ds = ini;
  DS_FIELDS.forEach((f) => { state[f] = STORE[ini][f]; });
  if (h.ds) state.filtros = { desde: "", hasta: "", ...h.filtros };
  state.seccion = h.ds && SEC_KEYS().includes(h.sec) ? h.sec : SEC_KEYS()[0];
  construirLayout();
  setTheme(document.documentElement.getAttribute("data-theme") || "light", { rerender: false });
  engancharEventos();
  renderSeccion(state.seccion);   // esqueletos mientras llega Supabase
  writeHash();
  iniciarSincronizacion();
  await cargarDatos("inicial");
})();
