/* =====================================================================
   worker.js · Lee y procesa los 3 Excel de almacén fuera del hilo principal
   Pestañas que se usan (el resto del libro se ignora y ni se abre):
   - Kardex final ......... Detalle F.V. → kardex · Detalle I.E. → movimientos
   - Materiales HLC ....... VALO_DET._MATERIALES_2024 → valorización por proyecto
                            Ingreso_Egreso_HLC_2024 → movimientos por proyecto
   - Almacén central ...... Kardex Unificado / Kardex Materiales /
                            Kardex Activos y Tenencias → kardex · Detalle I.E. → movimientos
   Devuelve cada pestaña en columnas (diccionarios + arreglos) y comprimida
   con gzip + base64 para que el envío a Supabase sea liviano.
   ===================================================================== */

// Tablero de destino de cada pestaña. "sb" = sheet_name en Supabase (el mismo que lee dashboard.js)
const DESTINOS = {
  "kf-fv": { sb: "KF_DETALLE_FV", kind: "kardex", nombre: "Kardex valorizado" },
  "kf-ie": { sb: "KF_DETALLE_IE", kind: "mov", nombre: "Ingresos y egresos" },
  "hlc-valo": { sb: "HLC_VALO_PROYECTOS", kind: "valo", nombre: "Valorización por proyecto" },
  "hlc-ie": { sb: "HLC_ING_EGR", kind: "movHLC", nombre: "Movimientos por proyecto" },
  "alm-ku": { sb: "ALM_KARDEX_UNIFICADO", kind: "kardex", nombre: "Kardex unificado" },
  "alm-km": { sb: "ALM_KARDEX_MATERIALES", kind: "kardex", nombre: "Kardex de materiales" },
  "alm-ka": { sb: "ALM_KARDEX_ACTIVOS", kind: "kardex", nombre: "Activos y tenencias" },
  "alm-ie": { sb: "ALM_DETALLE_IE", kind: "mov", nombre: "Movimientos de activos" },
};

// Decide qué pestañas leer según los nombres de hoja del libro
function planificar(names, fileName) {
  const has = (re) => names.find((n) => re.test(String(n).trim()));
  const fv = has(/^detalle\s*f\.?\s*v/i), ie = has(/^detalle\s*i\.?\s*e/i);
  const valo = has(/^valo[_\s.]*det/i), hlc = has(/^ingreso[_\s]*egreso/i);
  const ku = has(/kardex\s*unificado/i), km = has(/kardex\s*materiales/i), ka = has(/kardex\s*activos/i);
  const plan = [];
  const add = (key, sheet, file) => plan.push({ key, sheet, file, ...DESTINOS[key] });
  // Primero se decide qué libro es; así una pestaña con el mismo nombre en otro libro no pisa otro tablero
  if (fv) {                                   // Kardex final
    add("kf-fv", fv, "kardex");
    if (ie) add("kf-ie", ie, "kardex");
  } else if (valo || hlc) {                   // Dashboard de Materiales HLC
    if (valo) add("hlc-valo", valo, "materiales");
    if (hlc) add("hlc-ie", hlc, "materiales");
  } else if (ku || km || ka) {                // Datos de almacén central
    if (ku) add("alm-ku", ku, "almacen");
    if (km) add("alm-km", km, "almacen");
    if (ka) add("alm-ka", ka, "almacen");
    if (ie) add("alm-ie", ie, "almacen");
  } else if (ie) {                            // Solo un Detalle I.E.: se decide por el nombre del archivo
    if (/kardex/i.test(fileName || "")) add("kf-ie", ie, "kardex"); else add("alm-ie", ie, "almacen");
  }
  return plan;
}

self.onmessage = async function (e) {
  const msg = e.data || {};
  const prog = (pct, label) => self.postMessage({ progress: true, pct, label });
  try {
    let plan, hojas = {};
    if (msg.buffer) {
      prog(4, "Cargando el lector de Excel…");
      if (typeof XLSX === "undefined") importScripts(msg.xlsxUrl);
      prog(8, "Leyendo los nombres de las pestañas…");
      const libro = XLSX.read(msg.buffer, { type: "array", bookSheets: true });
      plan = planificar(libro.SheetNames, msg.fileName);
      if (!plan.length) throw new Error(`No reconozco este Excel: no tiene ninguna de las pestañas esperadas (Detalle F.V., Detalle I.E., VALO_DET, Ingreso_Egreso, Kardex Unificado, Kardex Materiales o Kardex Activos). Pestañas encontradas: ${libro.SheetNames.slice(0, 12).join(", ")}.`);
      prog(12, `Abriendo ${plan.length} pestaña${plan.length > 1 ? "s" : ""}: ${plan.map((p) => p.sheet).join(", ")}…`);
      const wb = XLSX.read(msg.buffer, { type: "array", cellDates: true, cellNF: false, cellStyles: false, cellHTML: false, cellFormula: false, sheets: plan.map((p) => p.sheet) });
      plan.forEach((p) => { hojas[p.sheet] = leerHoja(wb.Sheets[p.sheet], p.kind); });
    } else {
      plan = planificar(Object.keys(msg.sheets || {}), msg.fileName);
      if (!plan.length) throw new Error("No reconozco las pestañas de este Excel.");
      hojas = msg.sheets;
    }
    const out = [];
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i];
      prog(40 + (i / plan.length) * 50, `Procesando «${p.sheet}» (${i + 1} de ${plan.length})…`);
      const t0 = Date.now();
      try {
        const r = procesar({ kind: p.kind, rows: hojas[p.sheet], sheet: p.sheet });
        const json = JSON.stringify(r.enc);
        const z = await gzipB64(json);
        const payload = { meta: r.meta, kpis: r.kpis, ...(z ? { z } : { enc: r.enc }) };
        out.push({ key: p.key, sb: p.sb, kind: p.kind, nombre: p.nombre, file: p.file, sheet: p.sheet, ok: true, payload, preview: r.preview, bytes: z ? z.length : json.length, crudo: json.length, ms: Date.now() - t0 });
      } catch (err) {
        out.push({ key: p.key, sb: p.sb, kind: p.kind, nombre: p.nombre, file: p.file, sheet: p.sheet, ok: false, error: err.message || String(err) });
      }
      hojas[p.sheet] = null;
    }
    self.postMessage({ ok: true, resultado: out });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message || String(err) });
  }
};

// gzip + base64 (si el navegador no lo soporta, se envía sin comprimir)
async function gzipB64(json) {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Lee la hoja solo hasta la última columna del encabezado (hay planillas con cientos de columnas vacías con formato)
function leerHoja(ws, kind) {
  if (!ws || !ws["!ref"]) return [];
  const R = XLSX.utils.decode_range(ws["!ref"]);
  const head = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "", range: { s: { r: R.s.r, c: R.s.c }, e: { r: Math.min(R.e.r, R.s.r + 40), c: Math.min(R.e.c, R.s.c + 120) } } });
  const MAP = MAPS[kind];
  let best = { score: 0, last: R.e.c };
  head.forEach((row) => {
    const score = new Set(row.map((c) => MAP[keyDe(c)]).filter(Boolean)).size;
    if (score > best.score) { let last = 0; row.forEach((c, j) => { if (String(c ?? "").trim() !== "") last = j; }); best = { score, last: R.s.c + last }; }
  });
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "", blankrows: true, range: { s: { r: R.s.r, c: R.s.c }, e: { r: R.e.r, c: Math.max(R.s.c, best.last) } } });
}

/* ---------- Utilidades ---------- */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
function norm(v) { return v === undefined || v === null ? "" : String(v).replace(/\s+/g, " ").trim(); }
function normKey(k) { return norm(k).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, ""); }
function txt(v) { const s = norm(v); return /^(#n\/a|n\/a|#¡?ref!?|#value!|#¡valor!|null|none|-)$/i.test(s) ? "" : s; }
function num(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (v === null || v === undefined) return 0;
  if (v instanceof Date) return v.getFullYear() <= 1900 ? Math.round(((Date.UTC(v.getFullYear(), v.getMonth(), v.getDate(), v.getHours(), v.getMinutes()) - EXCEL_EPOCH) / 86400000) * 1000) / 1000 : 0;
  let s = String(v).trim().replace(/[^\d.,\-]/g, "");
  if (!s || s === "-") return 0;
  const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
  if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (lc > -1) s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  else if (ld > -1 && /^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}
const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
const r4 = (n) => (n == null ? null : Math.round(n * 10000) / 10000);

// Fechas: Date de Excel, número de serie, "31/07/2025", "05/08/2025 11:51:22 a.m.", "2025-08-05"
function parseFecha(v) {
  if (v instanceof Date) {
    const d = new Date(v.getTime() + 60 * 1000);
    return isNaN(d) || d.getFullYear() < 1990 ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  if (typeof v === "number" && v > 30000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  const s = norm(v);
  if (!s || /^#/.test(s)) return null;
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return new Date(y, +m[2] - 1, +m[1]); }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}
function fechaISO(d) { if (!d) return ""; const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
// "2025-08 Agosto" → "2025-08"
function periodoKey(v, fecha) {
  const s = norm(v);
  const m = s.match(/(\d{4})[-\/ ](\d{1,2})/);
  if (m) return `${m[1]}-${String(+m[2]).padStart(2, "0")}`;
  const d = parseFecha(v);
  if (d) return fechaISO(d).slice(0, 7);
  return fecha ? fecha.slice(0, 7) : "";
}
function codigoTxt(v) { return typeof v === "number" ? String(Math.round(v)) : txt(v); }

/* ---------- Mapas de columnas por tipo de pestaña ---------- */
const MAPS = {
  kardex: {
    item: "item", tipodealmacen: "tipoAlm", descripcionalmacen: "almacen", almacen: "almacen", codigorecurso: "codigo", recurso: "recurso",
    unidad: "unidad", stockinicial: "sIni", cantidadingreso: "cIng", cantidadegreso: "cEgr", stockactual: "sAct",
    stockinicials: "vIni", ingresos: "vIng", egresos: "vEgr", stockactuals: "vAct",
  },
  mov: {
    item: "item", tipoalmacen: "tipoAlm", almacen: "almacen", tipomov: "tipoMov", movimiento: "mov", detallemovimiento: "movDesc",
    nroguia: "guia", fechaguia: "fecha", periodomensual: "periodo", registraguia: "registra", destinosolicitante: "destino",
    codigorecurso: "codigo", recurso: "recurso", unidad: "unidad", cantidad: "cant", precio: "precio", parcialnetomp: "monto",
    observacion: "obs", solicitantepedido: "solicitante", nroorden: "orden", fechaorden: "fechaOrden", ruc: "ruc", proveedor: "proveedor",
    fechadeentregaoc: "fechaEntOC", fechaaprobacionoc: "fechaAprOC", partidadecontrol: "partida", recurson2: "recursoN2",
  },
  movHLC: {
    detalleingresooegreso: "detalleIE", unidaddenegocio: "uneg", proyecto: "proyecto", almacen: "almacen", registraguia: "registra",
    estadoguiadealmacen: "estadoGuia", movimiento: "dirTxt", tipodemovimiento2: "mov", descripciondemovimiento: "movDesc",
    nroguia: "guia", destinosolicitante: "destino", fechaguia: "fecha", escaladetiempo: "escala", codigorecurso: "codigo",
    recurso: "recurso", unidad: "unidad", cantidad: "cant", preciosunitatio: "precio", preciosunitario: "precio", parcialsneto: "monto",
    observacion: "obs", nroorden: "orden", proveedor: "proveedor", recurson2: "recursoN2", tipodealmacen: "tipoAlm",
  },
  valo: {
    item: "item", centrodecostosyproyecto: "proyecto", proyecto: "proyecto", stockinicials: "vIni",
    ingresos: "vIng", egresos: "vEgr", stocksfin: "vFin", stockfinal: "vFin", stocksfinal: "vFin",
  },
};
// Encabezados con año pegado ("INGRESO (S/) 2024") → se quita el año
const keyDe = (h) => normKey(h).replace(/(19|20)\d{2}$/, "");

const TEXT_FIELDS = {
  kardex: ["tipoAlm", "almacen", "codigo", "recurso", "unidad"],
  mov: ["tipoAlm", "almacen", "tipoMov", "mov", "movDesc", "guia", "fecha", "mes", "registra", "destino", "codigo", "recurso", "unidad", "obs", "solicitante", "orden", "fechaOrden", "ruc", "proveedor", "fechaEntOC", "fechaAprOC", "partida", "recursoN2"],
  movHLC: ["detalleIE", "uneg", "proyecto", "almacen", "registra", "estadoGuia", "dirTxt", "mov", "movDesc", "guia", "destino", "fecha", "mes", "codigo", "recurso", "unidad", "obs", "orden", "proveedor", "recursoN2", "tipoAlm"],
  valo: ["proyecto", "anio"],
};
const NUM_FIELDS = {
  kardex: ["item", "sIni", "cIng", "cEgr", "sAct", "vIni", "vIng", "vEgr", "vAct"],
  mov: ["item", "cant", "precio", "monto"],
  movHLC: ["cant", "precio", "monto"],
  valo: ["item", "vIni", "vIng", "vEgr", "vFin"],
};
const OBLIGATORIAS = {
  kardex: ["almacen", "recurso", "vAct"],
  mov: ["tipoMov", "mov", "monto"],
  movHLC: ["mov", "monto"],
  valo: ["proyecto", "vFin"],
};

/* ---------- Proceso de una pestaña ---------- */
function procesar(job) {
  const { kind, rows, sheet } = job;
  const MAP = MAPS[kind];
  if (!rows || !rows.length) throw new Error(`La pestaña "${sheet}" está vacía.`);

  // 1) Encabezado: la fila con más columnas reconocidas (entre las 40 primeras)
  let hIdx = -1, mejor = 0;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i];
    if (!Array.isArray(r)) continue;
    const score = new Set(r.map((c) => MAP[keyDe(c)]).filter(Boolean)).size;
    if (score > mejor) { mejor = score; hIdx = i; }
  }
  if (hIdx < 0 || mejor < 3) throw new Error(`No se encontraron los encabezados en la pestaña "${sheet}".`);

  const header = rows[hIdx];
  const map = {}, columnas = {};
  let anio = "";
  header.forEach((h, i) => {
    const campo = MAP[keyDe(h)];
    const y = norm(h).match(/(19|20)\d{2}/);
    if (y && !anio && kind === "valo") anio = y[0];
    if (campo && !(campo in columnas)) { map[i] = campo; columnas[campo] = norm(h); }
  });
  const faltan = OBLIGATORIAS[kind].filter((c) => !(c in columnas));
  if (faltan.length) throw new Error(`En "${sheet}" faltan columnas obligatorias: ${faltan.join(", ")}.`);
  // Año de la valorización: del encabezado o del título de la hoja
  if (kind === "valo" && !anio) {
    for (let i = 0; i < hIdx; i++) { const m = (rows[i] || []).map(norm).join(" ").match(/(19|20)\d{2}/); if (m) { anio = m[0]; break; } }
  }
  // Título de la hoja (centro de costos, período) para mostrarlo en el tablero
  const titulo = [];
  for (let i = 0; i < Math.min(hIdx, 10); i++) { const t = (rows[i] || []).map(norm).filter((x) => x && isNaN(+x)).join(" · "); if (t && t.length > 8) titulo.push(t); }

  // 2) Filas
  const TF = TEXT_FIELDS[kind], NF = NUM_FIELDS[kind];
  const dicts = {}, idx = {}, cols = {};
  TF.forEach((f) => { dicts[f] = []; idx[f] = new Map(); cols[f] = []; });
  NF.forEach((f) => { cols[f] = []; });
  const enc = (f, v) => { const s = v == null ? "" : String(v); let i = idx[f].get(s); if (i === undefined) { i = dicts[f].length; dicts[f].push(s); idx[f].set(s, i); } return i; };

  let n = 0, omitidas = 0;
  const preview = [];
  for (let i = hIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!Array.isArray(r) || !r.length) { omitidas++; continue; }
    const o = {};
    for (const c in map) o[map[c]] = r[c];

    // Filas vacías, de totales o de un segundo bloque: se omiten
    const etiqueta = norm(o.proyecto || o.recurso || o.almacen || o.mov);
    if (!etiqueta || /^total(es)?\b/i.test(etiqueta) || /^total(es)?\b/i.test(norm(o.item))) { omitidas++; if (kind === "valo" && n > 0 && /^total/i.test(etiqueta)) break; continue; }
    if (kind === "kardex" && !txt(o.codigo) && !txt(o.recurso)) { omitidas++; continue; }

    const rec = {};
    if (kind === "kardex") {
      rec.tipoAlm = txt(o.tipoAlm); rec.almacen = txt(o.almacen); rec.codigo = codigoTxt(o.codigo); rec.recurso = txt(o.recurso); rec.unidad = txt(o.unidad).toLowerCase();
    } else if (kind === "valo") {
      rec.proyecto = txt(o.proyecto); rec.anio = anio;
    } else {
      const f = parseFecha(o.fecha) || parseFecha(o.escala);
      rec.fecha = fechaISO(f);
      rec.mes = kind === "mov" ? periodoKey(o.periodo, rec.fecha) : (fechaISO(parseFecha(o.escala)).slice(0, 7) || rec.fecha.slice(0, 7));
      TF.forEach((k) => { if (!(k in rec)) rec[k] = ["fechaOrden", "fechaEntOC", "fechaAprOC"].includes(k) ? fechaISO(parseFecha(o[k])) : ["codigo", "guia", "orden", "ruc"].includes(k) ? codigoTxt(o[k]) : txt(o[k]); });
    }
    TF.forEach((f) => cols[f].push(enc(f, rec[f] ?? "")));
    const nums = {};
    NF.forEach((f) => { nums[f] = f in columnas ? (f === "item" ? Math.round(num(o[f])) : f === "precio" ? r4(num(o[f])) : r2(num(o[f]))) : null; cols[f].push(nums[f]); });
    if (preview.length < 6) preview.push({ ...rec, ...nums });
    n++;
  }
  if (!n) throw new Error(`La pestaña "${sheet}" no tiene filas de datos válidas.`);

  // 3) Totales para la vista previa
  const sum = (f) => (cols[f] || []).reduce((a, b) => a + (b || 0), 0);
  const uniq = (f) => (dicts[f] ? new Set(cols[f].map((x) => dicts[f][x]).filter(Boolean)).size : 0);
  const kpis = { registros: n };
  if (kind === "kardex") Object.assign(kpis, { vIni: sum("vIni"), vIng: sum("vIng"), vEgr: sum("vEgr"), vAct: sum("vAct"), recursos: uniq("codigo") || uniq("recurso"), almacenes: uniq("almacen") });
  if (kind === "valo") Object.assign(kpis, { vIni: sum("vIni"), vIng: sum("vIng"), vEgr: sum("vEgr"), vFin: sum("vFin"), proyectos: uniq("proyecto"), anio });
  let desde = "", hasta = "";
  if (kind === "mov" || kind === "movHLC") {
    let ing = 0, egr = 0, nIng = 0, nEgr = 0;
    const dirF = kind === "mov" ? "tipoMov" : "dirTxt";
    for (let i = 0; i < n; i++) {
      const dTxt = (dicts[dirF] && dicts[dirF][cols[dirF][i]]) || dicts.mov[cols.mov[i]] || "";
      const m = Math.abs(cols.monto[i] || 0);
      if (/^\s*i/i.test(dTxt)) { ing += m; nIng++; } else { egr += m; nEgr++; }
      const f = dicts.fecha[cols.fecha[i]];
      if (f) { if (!desde || f < desde) desde = f; if (!hasta || f > hasta) hasta = f; }
    }
    Object.assign(kpis, { ing, egr, nIng, nEgr, recursos: uniq("codigo"), almacenes: uniq("almacen"), meses: uniq("mes") });
  }

  return {
    meta: { schema: 3, formato: "columnar", kind, hoja: sheet, columnas, faltantes: Object.keys(MAP).map((k) => MAP[k]).filter((c, i, a) => a.indexOf(c) === i && !(c in columnas)), titulo: titulo.slice(0, 4), filaEncabezado: hIdx + 1, filasOmitidas: omitidas, registros: n, anio, desde, hasta },
    kpis,
    preview,
    enc: { n, dicts, cols },
  };
}
