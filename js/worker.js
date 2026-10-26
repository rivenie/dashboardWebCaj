self.onmessage = function (e) {
  try {
    const { rows } = e.data;
    if (!rows || rows.length === 0) throw new Error("Hoja vacía");
    const resultado = procesarAlmacen(rows);
    self.postMessage({ ok: true, resultado });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message });
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

function procesarAlmacen(rows) {
  let hIdx = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] && rows[i].some(cell => cell && cell.toString().toUpperCase().includes("ORDER NO"))) {
      hIdx = i; break;
    }
  }
  const headers = (rows[hIdx] || []).map(h => (h || "").toString().trim().toUpperCase());
  
  const cOrder = headers.findIndex(h => h.includes("ORDER NO"));
  const cCliente = headers.findIndex(h => h === "CLIENTE" || (h.includes("CLIENTE") && !h.includes("NOMBRE")));
  const cNombre = headers.findIndex(h => h.includes("NOMBRE DEL CLIENTE"));
  const cModelo = headers.findIndex(h => h === "MODELO" || h.includes("MODELO"));
  const cLinea = headers.findIndex(h => h === "LINEA" || (h.includes("LINEA") && !h.includes("SUB") && !h.includes("Nº")));
  const cSubLinea = headers.findIndex(h => h.includes("SUB-LINEA") || h.includes("SUBLINEA"));
  const cQty = headers.findIndex(h => h === "QTY");
  const cM3 = headers.findIndex(h => h === "M3");
  const cEtiquetas = headers.findIndex(h => h.includes("CANTIDAD DE ETIQUETA"));
  const cFechaCita = headers.findIndex(h => h.includes("FECHA DE CITA"));

  const filas = [];
  const porCliente = {}, porLinea = {}, porSubLinea = {}, porModelo = {};
  const porFecha = {};
  let tQty = 0, tM3 = 0, tEtiquetas = 0;
  const setPedidos = new Set();

  for (let i = hIdx + 1; i < rows.length; i++) {
    const r = rows[i]; if (!r) continue;
    const order = norm(r[cOrder]);
    if (!order || order.toUpperCase().includes("TOTAL")) continue;

    // AQUI ESTA LA CORRECCION DE LAS COLUMNAS
    const clienteCod = norm(r[cCliente]) || "SIN CLIENTE"; // B2C, GS-ESALE
    const clienteNom = norm(r[cNombre]) || "SIN NOMBRE";    // Ever Huamani...
    const modelo = norm(r[cModelo]) || "SIN MODELO";
    const linea = norm(r[cLinea]) || "SIN LÍNEA";          // NARANJA, BLANCA
    const subLinea = norm(r[cSubLinea]) || "SIN SUB-LÍNEA"; // TELEVISOR, LAVADORA
    const qty = num(r[cQty]);
    const m3 = num(r[cM3]);
    const etiquetas = num(r[cEtiquetas]);
    
    let fechaStr = "";
    let fechaVal = r[cFechaCita];
    if (fechaVal) {
      if (typeof fechaVal === 'string') {
        fechaStr = fechaVal.substring(0, 10); 
      } else if (typeof fechaVal === 'number') {
        const date = new Date((fechaVal - 25569) * 86400 * 1000);
        fechaStr = date.toISOString().split('T')[0];
      } else if (fechaVal instanceof Date) {
        fechaStr = fechaVal.toISOString().split('T')[0];
      }
    }

    tQty += qty;
    tM3 += m3;
    tEtiquetas += etiquetas;

    setPedidos.add(order);
    if (fechaStr) porFecha[fechaStr] = (porFecha[fechaStr] || 0) + 1;

    porCliente[clienteNom] = (porCliente[clienteNom] || 0) + 1;
    porLinea[linea] = (porLinea[linea] || 0) + 1;
    porSubLinea[subLinea] = (porSubLinea[subLinea] || 0) + 1;
    porModelo[modelo] = (porModelo[modelo] || 0) + 1;

    filas.push({ order, clienteCod, cliente: clienteNom, modelo, linea, subLinea, qty, m3, etiquetas, fecha: fechaStr });
  }

  const tPedidos = setPedidos.size;

  return {
    kpis: { tPedidos, tQty, tM3, tEtiquetas },
    porCliente: Object.entries(porCliente).map(([k, v]) => ({ nombre: k, valor: v })).sort((a, b) => b.valor - a.valor),
    porLinea: Object.entries(porLinea).map(([k, v]) => ({ nombre: k, valor: v })).sort((a, b) => b.valor - a.valor),
    porSubLinea: Object.entries(porSubLinea).map(([k, v]) => ({ nombre: k, valor: v })).sort((a, b) => b.valor - a.valor),
    porModelo: Object.entries(porModelo).map(([k, v]) => ({ nombre: k, valor: v })).sort((a, b) => b.valor - a.valor).slice(0, 10),
    porFecha: Object.entries(porFecha).map(([k, v]) => ({ fecha: k, valor: v })).sort((a, b) => a.fecha.localeCompare(b.fecha)),
    filas
  };
}