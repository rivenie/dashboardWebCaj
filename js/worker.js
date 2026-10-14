self.onmessage = function (e) {
  try {
    const { hojas } = e.data;
    if (!hojas || !Array.isArray(hojas)) throw new Error("Hojas inválidas.");
    const resultado = procesarInventario(hojas);
    self.postMessage({ ok: true, resultado });
  } catch (err) {
    self.postMessage({ ok: false, error: (err && err.message) ? err.message : String(err) });
  }
};

function norm(v) { return v !== undefined && v !== null ? v.toString().trim() : ""; }
function num(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (v === null || v === undefined || v === "") return 0;
  const s = v.toString().replace(",", ".").replace(/[^0-9.\-]/g, "");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}
function safe(v) { return (typeof v === "number" && !isFinite(v)) ? 0 : v; }

function rangoAntiguedad(d) {
  const n = Number(d);
  if (!isFinite(n) || n <= 0) return "Sin dato";
  if (n <= 30) return "0-30 días";
  if (n <= 90) return "31-90 días";
  if (n <= 180) return "91-180 días";
  return "+180 días";
}

function procesarInventario(hojas) {
  const conteo = { filas: [], series: new Set() };
  const stock = { filas: [], series: new Set() };

  hojas.forEach(({ nombre, rows }) => {
    if (!rows || rows.length === 0) return;
    const esStock = nombre.toUpperCase().includes("STOCK");
    const destino = esStock ? stock : conteo;

    // Detectar cabecera por palabras exactas "LINEA" y "COSTO"
    let hIdx = -1;
for (let i = 0; i < Math.min(rows.length, 12); i++) {
  const f = (rows[i] || []).map(c => (c || "").toString().trim().toUpperCase());
  const conocidas = ["SERIE", "SKU", "DESCRIPCION", "MARCA", "LINEA", "SUBLINEA", "TIENDA", "ESTADO", "COSTO", "MONEDA"];
  const hits = conocidas.filter(k => f.some(x => x.includes(k))).length;
  if (hits >= 6) { hIdx = i; break; }
}
    if (hIdx < 0) return;

    const headers = (rows[hIdx] || []).map((h, i) => {
      const limpio = (h || "").toString().trim().replace(/\s+/g, " ").replace(/\u00A0/g, " ");
      return limpio === "" ? `Columna_${i + 1}` : limpio;
    });
    const idx = (pred) => headers.findIndex(h => pred(h.toLowerCase()));

    const cSerie = idx(h => h === "serie");
    const cSKU = idx(h => h.includes("sku"));
    const cDesc = idx(h => h.includes("descripcion") || h.includes("descripción"));
    const cMarca = idx(h => h === "marca");
    const cLinea = idx(h => h === "linea" || h === "línea");
    const cSub = idx(h => h === "sublinea" || h === "sublínea");
    const cTienda = idx(h => h === "tienda");
    const cEstado = idx(h => h === "estado");
    const cFechaIng = idx(h => h.includes("fecha ingreso"));
    const cAntig = idx(h => h.includes("antiguedad") || h.includes("antigüedad"));
    const cCosto = idx(h => h === "costo");
    const cMoneda = idx(h => h === "moneda");
    const cUltTranx = idx(h => h.includes("fecha ult") || h.includes("fecha últ"));

    const get = (r, i) => (i >= 0 && r[i] !== undefined) ? r[i] : "";

    for (let i = hIdx + 1; i < rows.length; i++) {
      const r = rows[i]; if (!r) continue;
      const serie = norm(get(r, cSerie));
const sku = norm(get(r, cSKU));
const desc = norm(get(r, cDesc));
if (!serie && !sku && !desc) continue;      
      const marca = norm(get(r, cMarca)) || "Sin marca";
      const linea = norm(get(r, cLinea)) || "Sin línea";
      const sublinea = norm(get(r, cSub)) || "Sin sublínea";
      const tienda = norm(get(r, cTienda)) || "Sin tienda";
      const estado = norm(get(r, cEstado)) || "Sin estado";
      const fechaIng = norm(get(r, cFechaIng));
      const antiguedad = num(get(r, cAntig));
      const costo = num(get(r, cCosto));
      const moneda = norm(get(r, cMoneda)) || "PEN";
      const ultTranx = norm(get(r, cUltTranx));

      const fila = { serie, sku, desc, marca, linea, sublinea, tienda, estado,
                     fechaIng, antiguedad, costo, moneda, ultTranx, esStock };
      destino.filas.push(fila);
      if (serie) destino.series.add(serie);
    }
  });

  const faltantes = conteo.filas.filter(f => f.serie && !stock.series.has(f.serie));
  const sobrantes = stock.filas.filter(f => f.serie && !conteo.series.has(f.serie));

  const porLinea = {}, porSublinea = {}, porMarca = {}, porEstado = {}, porMoneda = {}, porTienda = {}, porRango = {};
  let totalCosto = 0, sumAntig = 0, cntAntig = 0, sinMovimiento = 0;

  const hoy = Date.now();
  conteo.filas.forEach(f => {
    totalCosto += f.costo;
    if (f.antiguedad > 0) { sumAntig += f.antiguedad; cntAntig++; }
    if (f.ultTranx) {
      const d = new Date(f.ultTranx);
      if (!isNaN(d.getTime()) && (hoy - d.getTime()) / 86400000 > 180) sinMovimiento++;
    }
    const kL = f.linea, kS = f.sublinea, kM = f.marca, kE = f.estado, kMo = f.moneda, kT = f.tienda;
    const kR = rangoAntiguedad(f.antiguedad);

    if (!porLinea[kL]) porLinea[kL] = { nombre: kL, equipos: 0, costo: 0 };
    porLinea[kL].equipos++; porLinea[kL].costo += f.costo;

    if (!porSublinea[kS]) porSublinea[kS] = { nombre: kS, equipos: 0, costo: 0 };
    porSublinea[kS].equipos++; porSublinea[kS].costo += f.costo;

    if (!porMarca[kM]) porMarca[kM] = { nombre: kM, equipos: 0, costo: 0 };
    porMarca[kM].equipos++; porMarca[kM].costo += f.costo;

    if (!porEstado[kE]) porEstado[kE] = { nombre: kE, equipos: 0, costo: 0 };
    porEstado[kE].equipos++; porEstado[kE].costo += f.costo;

    if (!porMoneda[kMo]) porMoneda[kMo] = { nombre: kMo, equipos: 0, costo: 0 };
    porMoneda[kMo].equipos++; porMoneda[kMo].costo += f.costo;

    if (!porTienda[kT]) porTienda[kT] = { nombre: kT, equipos: 0, costo: 0 };
    porTienda[kT].equipos++; porTienda[kT].costo += f.costo;

    if (!porRango[kR]) porRango[kR] = { nombre: kR, equipos: 0 };
    porRango[kR].equipos++;
  });

  const ordenar = (obj, campo) => Object.values(obj).sort((a, b) => b[campo] - a[campo]);

  return {
    tipo: "INVENTARIO_DATA",
    kpis: {
      totalEquipos: conteo.filas.length,
      totalSeries: conteo.series.size,
      totalStock: stock.filas.length,
      totalFaltantes: faltantes.length,
      totalSobrantes: sobrantes.length,
      totalCosto: safe(totalCosto),
      antiguedadPromedio: cntAntig ? safe(sumAntig / cntAntig) : 0,
      sinMovimiento,
    },
    porLinea: ordenar(porLinea, "costo"),
    porSublinea: ordenar(porSublinea, "costo"),
    porMarca: ordenar(porMarca, "costo"),
    porEstado: ordenar(porEstado, "costo"),
    porMoneda: ordenar(porMoneda, "costo"),
    porTienda: ordenar(porTienda, "costo"),
    porRango: [
      { nombre: "0-30 días", equipos: (porRango["0-30 días"]?.equipos) || 0 },
      { nombre: "31-90 días", equipos: (porRango["31-90 días"]?.equipos) || 0 },
      { nombre: "91-180 días", equipos: (porRango["91-180 días"]?.equipos) || 0 },
      { nombre: "+180 días", equipos: (porRango["+180 días"]?.equipos) || 0 },
      { nombre: "Sin dato", equipos: (porRango["Sin dato"]?.equipos) || 0 },
    ],
    filas: conteo.filas,
    filasStock: stock.filas,
    faltantes,
    sobrantes,
  };
}