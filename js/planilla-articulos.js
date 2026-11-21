// =====================================================================
//  Lectura de la planilla de artículos propia de un local (Chimola).
//  Acepta el Excel tal como lo usan ("BASE DE ARTICULO"): busca, en la
//  primera hoja que las tenga, las columnas de código y descripción (y,
//  si están, rubro y temporada). Las demás columnas (precios, promos) no
//  se usan. La librería de Excel (SheetJS) se carga recién al elegir el
//  archivo.
//
//  La función pura filasDeMatriz() también corre en Node para las pruebas.
// =====================================================================
(function (global) {
  'use strict';

  const plano = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ�]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  // Nombres de columna aceptados (sin tildes ni mayúsculas)
  const COLUMNAS = {
    codigo: ['codigo', 'cod', 'cod.', 'articulo', 'art', 'art.', 'sku'],
    nombre: ['descripcion', 'descripcin', 'nombre', 'producto', 'detalle'],
    rubro: ['rubro', 'categoria', 'familia'],
    temporada: ['temporada', 'coleccion'],
  };
  const FILAS_CABECERA = 10; // la cabecera tiene que estar en las primeras filas

  // matriz: filas de una hoja (arrays de celdas). Devuelve null si no tiene las columnas, o
  // { filas: [{ codigo, nombre, rubro, temporada }], repetidos, sinNombre }
  function filasDeMatriz(matriz) {
    if (!Array.isArray(matriz)) return null;
    for (let f = 0; f < Math.min(FILAS_CABECERA, matriz.length); f++) {
      const cab = (matriz[f] || []).map(plano);
      const col = {};
      for (const [campo, nombres] of Object.entries(COLUMNAS)) {
        // "Descripción" puede venir con la tilde rota ("Descripci?n", "DescripciÃ³n"): alcanza con que empiece igual
        const i = cab.findIndex(c => nombres.includes(c) || (campo === 'nombre' && c.startsWith('descripci')));
        if (i >= 0) col[campo] = i;
      }
      if (col.codigo == null || col.nombre == null) continue;
      const vistos = new Set(), filas = [];
      let repetidos = 0, sinNombre = 0;
      for (const fila of matriz.slice(f + 1)) {
        if (!fila) continue;
        const codigo = String(fila[col.codigo] == null ? '' : fila[col.codigo]).replace(/\s+/g, '').trim();
        if (!codigo || /^#?n\/?a$/i.test(codigo)) continue;
        const nombre = String(fila[col.nombre] == null ? '' : fila[col.nombre]).replace(/\s+/g, ' ').trim();
        if (!nombre || /^#?n\/?a$/i.test(nombre)) { sinNombre++; continue; }
        const k = codigo.toLowerCase();
        if (vistos.has(k)) { repetidos++; continue; }
        vistos.add(k);
        filas.push({
          codigo: codigo.slice(0, 40), nombre: nombre.slice(0, 200),
          rubro: col.rubro == null ? '' : String(fila[col.rubro] == null ? '' : fila[col.rubro]).replace(/\s+/g, ' ').trim().slice(0, 80),
          temporada: col.temporada == null ? '' : String(fila[col.temporada] == null ? '' : fila[col.temporada]).replace(/\s+/g, ' ').trim().slice(0, 80),
        });
      }
      if (filas.length) return { filas, repetidos, sinNombre };
    }
    return null;
  }

  const puro = { filasDeMatriz };
  if (typeof module !== 'undefined' && module.exports) { module.exports = puro; return; }

  // SheetJS oficial (versión con los arreglos de seguridad), se carga una sola vez y solo si hace falta
  const SHEETJS = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
  let cargando = null;
  function cargarSheetJS() {
    if (global.XLSX) return Promise.resolve(global.XLSX);
    if (!cargando) cargando = new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = SHEETJS; s.async = true;
      s.onload = () => ok(global.XLSX);
      s.onerror = () => { cargando = null; mal(new Error('No se pudo cargar el lector de Excel. Revisá internet.')); };
      document.head.appendChild(s);
    });
    return cargando;
  }

  // archivo (File) -> { filas, repetidos, sinNombre, hoja }
  async function leerArchivo(archivo) {
    const XLSX = await cargarSheetJS();
    // Un CSV se lee como texto UTF-8 (si no, las tildes se rompen); un Excel, como archivo
    const libro = /.(csv|txt)$/i.test(archivo.name || '')
      ? XLSX.read(await archivo.text(), { type: 'string' })
      : XLSX.read(await archivo.arrayBuffer(), { type: 'array' });
    for (const nombre of libro.SheetNames) {
      const matriz = XLSX.utils.sheet_to_json(libro.Sheets[nombre], { header: 1, raw: false, defval: '' });
      const r = filasDeMatriz(matriz);
      if (r) return { ...r, hoja: nombre };
    }
    throw new Error('No encontré una hoja con las columnas de código y descripción.');
  }

  global.CMC.planillaArticulos = { leerArchivo, filasDeMatriz };
})(typeof window !== 'undefined' ? window : globalThis);
