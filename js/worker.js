self.onmessage = function (e) {
  const { tipo, rows } = e.data;
  try {
    let resultado;
    if (tipo === "Compras" || tipo === "COMPRAS_DATA") resultado = procesarCompras(rows);
    else throw new Error("Tipo desconocido: " + tipo);
    self.postMessage({ ok: true, tipo, resultado });
  } catch (err) {
    self.postMessage({ ok: false, tipo, error: err.message });
  }
};

function norm(v) { return v !== undefined && v !== null ? v.toString().trim() : ""; }
function num(v) {
  if (typeof v === "number") return v;
  if (!v) return 0;
  const s = v.toString().replace(",", ".").replace(/[^0-9.-]/g, "");
  return parseFloat(s) || 0;
}
function fechaOrdenable(valor) {
  const s = norm(valor);
  if (!s) return "";
  if (/^\d{5}$/.test(s)) {
    const serial = parseInt(s);
    const d = new Date((serial - 25569) * 86400 * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${String(+m[2]).padStart(2, "0")}-${String(+m[3]).padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (m) {
    let a = +m[3]; if (a < 100) a += 2000;
    return `${a}-${String(+m[2]).padStart(2, "0")}-${String(+m[1]).padStart(2, "0")}`;
  }
  return s;
}
const MESES_ABREV = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
function etiquetaFecha(iso) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return String(+m[3]).padStart(2, "0") + " " + MESES_ABREV[+m[2] - 1];
}

function procesarCompras(rows) {
  // Buscar la fila de encabezados
  let headerIndex = 0;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const f = rows[i].map(c => (c || "").toString().trim().toLowerCase().replace(/\s+/g, " "));
    const tieneRuc = f.some(c => c === "ruc");
    const tieneRazon = f.some(c => c.includes("razon social") || c.includes("razón social"));
    const tieneImporte = f.some(c => c.includes("importe total"));
    if (tieneRuc && tieneRazon && tieneImporte) { headerIndex = i; break; }
  }
  const headers = rows[headerIndex].map((h, i) => {
    let limpio = (h || "").toString().trim().replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ");
    return limpio === "" ? `Columna_${i + 1}` : limpio;
  });

  // Detectar columnas por nombre
  const cFechaEmi = headers.findIndex(h => h.toLowerCase().includes("fecha emision") || h.toLowerCase().includes("fecha emisión"));
  const cFechaVenc = headers.findIndex(h => h.toLowerCase().includes("fecha venc"));
  const cTipo = headers.findIndex(h => h.toLowerCase().includes("tipo comprobante"));
  const cRuc = headers.findIndex(h => h.toLowerCase() === "ruc");
  const cRazon = headers.findIndex(h => h.toLowerCase().includes("razon social") || h.toLowerCase().includes("razón social"));
  const cCategoria = headers.findIndex(h => h.toLowerCase() === "categoria" || h.toLowerCase() === "categoría");
  const cProducto = headers.findIndex(h => h.toLowerCase().includes("producto/servico") || h.toLowerCase().includes("producto"));
  const cCantidad = headers.findIndex(h => h.toLowerCase() === "cantidad");
  const cPrecioIgv = headers.findIndex(h => h.toLowerCase().includes("precio con igv"));
  const cTotal1 = headers.findIndex(h => h.toLowerCase().includes("total1"));
  const cCond1 = headers.findIndex(h => h.toLowerCase().includes("codicion1") || h.toLowerCase().includes("condicion1"));
  const cCond2 = headers.findIndex(h => h.toLowerCase().includes("codicion2") || h.toLowerCase().includes("condicion2"));
  const cMedio = headers.findIndex(h => h.toLowerCase().includes("medio de pago"));
  const cMoneda = headers.findIndex(h => h.toLowerCase() === "moneda");
  const cCC = headers.findIndex(h => h.toLowerCase().includes("c. costos") || h.toLowerCase().includes("centro de costo"));
  const cBase = headers.findIndex(h => h.toLowerCase().includes("base imp"));
  const cIGV = headers.findIndex(h => h.toLowerCase() === "igv");
  const cPerc = headers.findIndex(h => h.toLowerCase() === "percep.");
  const cDetr = headers.findIndex(h => h.toLowerCase() === "detraccion" || h.toLowerCase() === "detracción");
  const cImporte = headers.findIndex(h => h.toLowerCase().includes("importe total"));
  const cPagos = headers.findIndex(h => h.toLowerCase() === "pagos");
  const cSaldo = headers.findIndex(h => h.toLowerCase() === "saldo");
  const cEstado = headers.findIndex(h => h.toLowerCase() === "estado");
  const cRango = headers.findIndex(h => h.toLowerCase() === "rango");

  const porMes = {}, porCategoria = {}, porProveedor = {}, porProducto = {}, porMedio = {}, porMoneda = {}, porEstado = {}, porRango = {}, porTipoDoc = {};
  let totalCompras = 0, totalPagado = 0, totalSaldo = 0, totalIGV = 0, totalPerc = 0, totalDetr = 0, totalBase = 0;
  const setProveedores = new Set();
  const filas = [];

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = rows[i]; if (!r) continue;
    const razon = norm(r[cRazon]);
    if (!razon) continue;

    const fechaEmi = fechaOrdenable(r[cFechaEmi]);
    const fechaVenc = fechaOrdenable(r[cFechaVenc]);
    const fechaEt = fechaEmi ? etiquetaFecha(fechaEmi) : "";
    const mes = fechaEmi ? fechaEmi.substring(0, 7) : "";
    const tipoDoc = norm(r[cTipo]) || "Sin tipo";
    const ruc = norm(r[cRuc]);
    const categoria = norm(r[cCategoria]) || "Sin categoría";
    const producto = norm(r[cProducto]) || "Sin producto";
    const cantidad = num(r[cCantidad]);
    const precioIgv = num(r[cPrecioIgv]);
    const total1 = num(r[cTotal1]);
    const cond1 = norm(r[cCond1]);
    const cond2 = norm(r[cCond2]);
    const medio = norm(r[cMedio]) || "Sin medio";
    const moneda = norm(r[cMoneda]) || "Sin moneda";
    const cc = norm(r[cCC]);
    const base = num(r[cBase]);
    const igv = num(r[cIGV]);
    const perc = num(r[cPerc]);
    const detr = num(r[cDetr]);
    const importe = num(r[cImporte]);
    const pagos = num(r[cPagos]);
    const saldo = num(r[cSaldo]);
    const estado = norm(r[cEstado]) || "SIN ESTADO";
    const rango = norm(r[cRango]) || "Sin rango";

    totalCompras += importe;
    totalPagado += pagos;
    totalSaldo += saldo;
    totalIGV += igv;
    totalPerc += perc;
    totalDetr += detr;
    totalBase += base;
    if (ruc || razon) setProveedores.add(razon);

    if (mes) {
      if (!porMes[mes]) porMes[mes] = { mes, importe: 0, pagos: 0, saldo: 0 };
      porMes[mes].importe += importe;
      porMes[mes].pagos += pagos;
      porMes[mes].saldo += saldo;
    }

    if (!porCategoria[categoria]) porCategoria[categoria] = { nombre: categoria, importe: 0 };
    porCategoria[categoria].importe += importe;

    if (!porProveedor[razon]) porProveedor[razon] = { nombre: razon, importe: 0, comprobantes: 0 };
    porProveedor[razon].importe += importe;
    porProveedor[razon].comprobantes++;

    const keyProd = producto;
    if (!porProducto[keyProd]) porProducto[keyProd] = { nombre: producto, importe: 0, cantidad: 0 };
    porProducto[keyProd].importe += importe;
    porProducto[keyProd].cantidad += cantidad;

    if (!porMedio[medio]) porMedio[medio] = { nombre: medio, importe: 0 };
    porMedio[medio].importe += importe;

    if (!porMoneda[moneda]) porMoneda[moneda] = { nombre: moneda, importe: 0 };
    porMoneda[moneda].importe += importe;

    if (!porEstado[estado]) porEstado[estado] = { nombre: estado, importe: 0 };
    porEstado[estado].importe += importe;

    if (!porRango[rango]) porRango[rango] = { nombre: rango, importe: 0, count: 0 };
    porRango[rango].importe += importe;
    porRango[rango].count++;

    if (!porTipoDoc[tipoDoc]) porTipoDoc[tipoDoc] = { nombre: tipoDoc, importe: 0, count: 0 };
    porTipoDoc[tipoDoc].importe += importe;
    porTipoDoc[tipoDoc].count++;

    filas.push({
      fechaEmi, fechaEt, fechaVenc, mes, tipoDoc, ruc, razon, categoria, producto,
      cantidad, precioIgv, total1, cond1, cond2, medio, moneda, cc,
      base, igv, perc, detr, importe, pagos, saldo, estado, rango,
    });
  }

  return {
    tipo: "COMPRAS_DATA",
    kpis: {
      totalRegistros: filas.length,
      totalCompras, totalPagado, totalSaldo, totalIGV, totalPerc, totalDetr, totalBase,
      totalProveedores: setProveedores.size,
    },
    porMes: Object.values(porMes).sort((a, b) => a.mes.localeCompare(b.mes)),
    porCategoria: Object.values(porCategoria).sort((a, b) => b.importe - a.importe),
    porProveedor: Object.values(porProveedor).sort((a, b) => b.importe - a.importe),
    porProducto: Object.values(porProducto).sort((a, b) => b.importe - a.importe),
    porMedio: Object.values(porMedio).sort((a, b) => b.importe - a.importe),
    porMoneda: Object.values(porMoneda).sort((a, b) => b.importe - a.importe),
    porEstado: Object.values(porEstado).sort((a, b) => b.importe - a.importe),
    porRango: Object.values(porRango).sort((a, b) => b.count - a.count),
    porTipoDoc: Object.values(porTipoDoc).sort((a, b) => b.importe - a.importe),
    filas,
  };
}