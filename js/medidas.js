// =====================================================================
//  Medidas del tablero. Funciones puras (sin pantalla ni base): reciben
//  las filas de consultas_vista y venta_items_vista y devuelven números.
//  Funcionan en el navegador (window.Medidas) y en Node (pruebas).
//
//  Definiciones:
//    Consultas      -> consultas no anuladas cuya fecha de consulta cae en el período.
//    Ventas         -> consultas no anuladas con estado "compró" cuya FECHA DE VENTA cae en el período.
//    Total vendido  -> suma del monto de esas ventas. Ticket = total / ventas.
//    Conversión     -> de las consultas del período, cuántas terminaron en compra (sin importar cuándo).
//    Lo piensan     -> de las consultas del período, las que siguen abiertas (no vencidas).
// =====================================================================
(function (global) {
  'use strict';
  const ZONA = 'America/Argentina/Cordoba';

  // ---------- Fechas como texto YYYY-MM-DD (sin problemas de zona horaria) ----------
  const aFecha = s => new Date(s + 'T00:00:00Z');
  const aTexto = d => d.toISOString().slice(0, 10);
  const sumarDias = (s, n) => { const d = aFecha(s); d.setUTCDate(d.getUTCDate() + n); return aTexto(d); };
  const diasEntre = (a, b) => Math.round((aFecha(b) - aFecha(a)) / 86400000);
  const enRango = (d, desde, hasta) => !!d && d >= desde && d <= hasta;
  function sumarAnios(s, n) {
    const [y, m, d] = s.split('-').map(Number);
    const ultimo = new Date(Date.UTC(y + n, m, 0)).getUTCDate();
    return `${y + n}-${String(m).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
  }
  const inicioMes = s => s.slice(0, 8) + '01';
  const finMes = s => { const [y, m] = s.split('-').map(Number); return aTexto(new Date(Date.UTC(y, m, 0))); };
  // Lunes de la semana de una fecha
  const inicioSemana = s => { const d = aFecha(s); return sumarDias(s, -((d.getUTCDay() + 6) % 7)); };

  // Rangos predefinidos del filtro de período (hoy = YYYY-MM-DD)
  function rango(clave, hoy) {
    switch (clave) {
      case 'hoy': return { desde: hoy, hasta: hoy };
      case 'ayer': { const a = sumarDias(hoy, -1); return { desde: a, hasta: a }; }
      case '7d': return { desde: sumarDias(hoy, -6), hasta: hoy };
      case '30d': return { desde: sumarDias(hoy, -29), hasta: hoy };
      case 'semana': return { desde: inicioSemana(hoy), hasta: hoy };
      case 'mes': return { desde: inicioMes(hoy), hasta: hoy };
      case 'mes-anterior': { const f = sumarDias(inicioMes(hoy), -1); return { desde: inicioMes(f), hasta: f }; }
      case '90d': return { desde: sumarDias(hoy, -89), hasta: hoy };
      case 'anio': return { desde: hoy.slice(0, 4) + '-01-01', hasta: hoy };
      default: return null;
    }
  }
  // Período con el que se compara: el inmediatamente anterior de igual largo, o el mismo del año pasado
  function comparacion(desde, hasta, tipo) {
    if (tipo === 'anio') return { desde: sumarAnios(desde, -1), hasta: sumarAnios(hasta, -1) };
    const largo = diasEntre(desde, hasta) + 1;
    // Mes completo contra mes completo anterior (no 30 días corridos)
    if (desde === inicioMes(desde) && hasta === finMes(desde)) {
      const f = sumarDias(desde, -1);
      return { desde: inicioMes(f), hasta: f };
    }
    return { desde: sumarDias(desde, -largo), hasta: sumarDias(desde, -1) };
  }

  // ---------- Filtros ----------
  // Canal y vendedor por nombre: cada local tiene sus propias listas, pero "WhatsApp" es WhatsApp en todos
  function filtrar(filas, f = {}) {
    return filas.filter(c =>
      (!f.localId || c.local_id === f.localId) &&
      (!f.canal || c.canal === f.canal) &&
      (!f.vendedor || (f.vendedor === '(sin indicar)' ? !c.atendio : c.atendio === f.vendedor)));
  }

  // ---------- Medidas principales ----------
  function resumen(filas, desde, hasta) {
    const validas = filas.filter(c => !c.anulada);
    const consultas = validas.filter(c => enRango(c.dia_consulta, desde, hasta));
    const ventas = validas.filter(c => c.estado === 'compro' && enRango(c.dia_venta, desde, hasta));
    const total = ventas.reduce((s, c) => s + (Number(c.monto_total) || 0), 0);
    const unidades = ventas.reduce((s, c) => s + (Number(c.unidades) || 0), 0);
    const cuenta = e => consultas.filter(c => (c.estado_efectivo || c.estado) === e).length;
    const compraron = cuenta('compro');
    return {
      consultas: consultas.length,
      ventas: ventas.length,
      total,
      unidades,
      ticket: ventas.length ? total / ventas.length : null,
      conversion: consultas.length ? compraron / consultas.length : null,
      compraron,
      loPiensan: cuenta('lo_piensa'),
      vencidas: cuenta('vencida'),
      noCompraron: cuenta('no_compro'),
    };
  }
  // Variación relativa (null si no hay contra qué comparar)
  const variacion = (actual, anterior) => (actual == null || anterior == null || anterior === 0) ? null : (actual - anterior) / anterior;

  // ---------- Evolución en el tiempo ----------
  const pasoSugerido = (desde, hasta) => { const d = diasEntre(desde, hasta) + 1; return d <= 45 ? 'dia' : d <= 190 ? 'semana' : 'mes'; };
  const claveDe = (s, paso) => paso === 'mes' ? s.slice(0, 7) : paso === 'semana' ? inicioSemana(s) : s;
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const etiqueta = (clave, paso) => paso === 'mes'
    ? `${MESES[Number(clave.slice(5, 7)) - 1]} ${clave.slice(2, 4)}`
    : `${clave.slice(8, 10)}/${clave.slice(5, 7)}`;

  function serie(filas, desde, hasta, paso = pasoSugerido(desde, hasta)) {
    const cubos = new Map();
    for (let d = desde; d <= hasta; d = sumarDias(d, 1)) {
      const k = claveDe(d, paso);
      if (!cubos.has(k)) cubos.set(k, { clave: k, etiqueta: etiqueta(k, paso), consultas: 0, ventas: 0, monto: 0 });
    }
    for (const c of filas) {
      if (c.anulada) continue;
      if (enRango(c.dia_consulta, desde, hasta)) cubos.get(claveDe(c.dia_consulta, paso)).consultas++;
      if (c.estado === 'compro' && enRango(c.dia_venta, desde, hasta)) {
        const b = cubos.get(claveDe(c.dia_venta, paso));
        b.ventas++;
        b.monto += Number(c.monto_total) || 0;
      }
    }
    return { paso, puntos: [...cubos.values()] };
  }

  // ---------- Agrupaciones ----------
  // Ventas del período agrupadas por un campo de la consulta (pago, envio, atendio, canal, local)
  function ventasPor(filas, desde, hasta, campo, sinDato = 'Sin dato') {
    const m = new Map();
    for (const c of filas) {
      if (c.anulada || c.estado !== 'compro' || !enRango(c.dia_venta, desde, hasta)) continue;
      const k = c[campo] || sinDato;
      const g = m.get(k) || { nombre: k, ventas: 0, monto: 0, unidades: 0 };
      g.ventas++; g.monto += Number(c.monto_total) || 0; g.unidades += Number(c.unidades) || 0;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.monto - a.monto || b.ventas - a.ventas);
  }
  // Artículos vendidos agrupados por rubro o marca
  function itemsPor(items, campo, sinDato = 'Sin dato') {
    const m = new Map();
    for (const i of items) {
      const k = i[campo] || sinDato;
      const g = m.get(k) || { nombre: k, unidades: 0, monto: 0, ventas: new Set() };
      g.unidades += Number(i.cantidad) || 0; g.monto += Number(i.monto) || 0; g.ventas.add(i.consulta_id);
      m.set(k, g);
    }
    return [...m.values()].map(g => ({ ...g, ventas: g.ventas.size })).sort((a, b) => b.monto - a.monto || b.unidades - a.unidades);
  }
  // Categoría de un artículo para las estadísticas.
  //   nivel 1 = rubro (primer tramo de la ruta de la tienda: "Marroquinería"), nivel 2 = subrubro ("Mochilas"),
  //   nivel 3 = la categoría más profunda ("Infantiles").
  // Los artículos de "Otro producto" o cargados antes del buscador no tienen ruta: cuentan con el rubro de la lista.
  function categoriaDe(i, nivel = 1) {
    if (i.categoria_ruta) {
      const partes = i.categoria_ruta.split(' > ').map(x => x.trim()).filter(Boolean);
      if (partes.length) return nivel >= 3 ? partes[partes.length - 1] : partes[Math.min(nivel, partes.length) - 1];
    }
    return i.rubro || 'Sin categoría';
  }
  // Artículos vendidos agrupados por categoría (rubro, subrubro o la más profunda)
  function itemsPorCategoria(items, nivel = 1) {
    const m = new Map();
    for (const i of items) {
      const k = categoriaDe(i, nivel);
      const g = m.get(k) || { nombre: k, unidades: 0, monto: 0, ventas: new Set() };
      g.unidades += Number(i.cantidad) || 0; g.monto += Number(i.monto) || 0; g.ventas.add(i.consulta_id);
      m.set(k, g);
    }
    return [...m.values()].map(g => ({ ...g, ventas: g.ventas.size })).sort((a, b) => b.monto - a.monto || b.unidades - a.unidades);
  }
  // Productos más vendidos: solo los elegidos en el buscador (el mismo nombre y categoría es un solo producto).
  // Devuelve { productos: [...], sinProducto: unidades de artículos sin producto del catálogo }
  function productosTop(items, orden = 'unidades') {
    const m = new Map();
    let sinProducto = 0;
    for (const i of items) {
      if (!i.producto) { sinProducto += Number(i.cantidad) || 0; continue; }
      const k = i.producto_clave || i.producto;
      const g = m.get(k) || { nombre: i.producto, categoria: i.categoria || '', ruta: i.categoria_ruta || '', unidades: 0, monto: 0, ventas: new Set() };
      g.unidades += Number(i.cantidad) || 0; g.monto += Number(i.monto) || 0; g.ventas.add(i.consulta_id);
      m.set(k, g);
    }
    const productos = [...m.values()].map(g => ({ ...g, ventas: g.ventas.size }))
      .sort((a, b) => (orden === 'monto' ? b.monto - a.monto || b.unidades - a.unidades : b.unidades - a.unidades || b.monto - a.monto) || a.nombre.localeCompare(b.nombre, 'es'));
    return { productos, sinProducto };
  }
  // Por canal: consultas, ventas, monto y conversión
  function porCanal(filas, desde, hasta) {
    const m = new Map();
    const g = k => { if (!m.has(k)) m.set(k, { nombre: k, consultas: 0, compraron: 0, ventas: 0, monto: 0 }); return m.get(k); };
    for (const c of filas) {
      if (c.anulada) continue;
      if (enRango(c.dia_consulta, desde, hasta)) { const x = g(c.canal); x.consultas++; if (c.estado === 'compro') x.compraron++; }
      if (c.estado === 'compro' && enRango(c.dia_venta, desde, hasta)) { const x = g(c.canal); x.ventas++; x.monto += Number(c.monto_total) || 0; }
    }
    return [...m.values()].map(x => ({ ...x, conversion: x.consultas ? x.compraron / x.consultas : null })).sort((a, b) => b.consultas - a.consultas);
  }

  // ---------- Día de la semana x hora ----------
  const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const fmtDiaHora = new Intl.DateTimeFormat('en-US', { timeZone: ZONA, weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
  const IDX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  function diaHora(t) {
    const p = Object.fromEntries(fmtDiaHora.formatToParts(new Date(t)).map(x => [x.type, x.value]));
    return { dia: IDX[p.weekday], hora: Number(p.hour) % 24 };
  }
  function mapaCalor(filas, desde, hasta) {
    const m = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const c of filas) {
      if (c.anulada || !enRango(c.dia_consulta, desde, hasta)) continue;
      const { dia, hora } = diaHora(c.fecha_consulta);
      m[dia][hora]++;
    }
    return m;
  }

  const api = {
    sumarDias, diasEntre, sumarAnios, inicioMes, finMes, inicioSemana, rango, comparacion, filtrar, resumen, variacion,
    pasoSugerido, serie, ventasPor, itemsPor, categoriaDe, itemsPorCategoria, productosTop, porCanal, DIAS, diaHora, mapaCalor,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Medidas = api;
})(typeof window !== 'undefined' ? window : globalThis);
