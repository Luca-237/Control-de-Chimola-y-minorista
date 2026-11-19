// Pruebas de las medidas del tablero (js/medidas.js), sin navegador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const M = require('../js/medidas.js');

const c = (id, dia_consulta, estado, extra = {}) => ({
  id, local_id: 1, local: 'Cindy Minorista', canal: 'WhatsApp', estado, estado_efectivo: estado, anulada: false,
  dia_consulta, fecha_consulta: dia_consulta + 'T14:30:00-03:00', dia_venta: estado === 'compro' ? dia_consulta : null,
  monto_total: 0, unidades: 0, ...extra,
});

test('rangos del filtro de período', () => {
  assert.deepEqual(M.rango('mes', '2026-11-12'), { desde: '2026-11-01', hasta: '2026-11-12' });
  assert.deepEqual(M.rango('mes-anterior', '2026-03-05'), { desde: '2026-02-01', hasta: '2026-02-28' });
  assert.deepEqual(M.rango('7d', '2026-11-12'), { desde: '2026-11-06', hasta: '2026-11-12' });
  assert.deepEqual(M.rango('semana', '2026-11-12'), { desde: '2026-11-09', hasta: '2026-11-12' }); // jueves -> lunes
  assert.deepEqual(M.rango('anio', '2026-11-12'), { desde: '2026-01-01', hasta: '2026-11-12' });
});

test('período de comparación', () => {
  assert.deepEqual(M.comparacion('2026-11-01', '2026-11-12', 'periodo'), { desde: '2026-10-20', hasta: '2026-10-31' });
  assert.deepEqual(M.comparacion('2026-10-01', '2026-10-31', 'periodo'), { desde: '2026-09-01', hasta: '2026-09-30' });
  assert.deepEqual(M.comparacion('2028-02-29', '2028-02-29', 'anio'), { desde: '2027-02-28', hasta: '2027-02-28' });
});

test('resumen: ventas por fecha de venta, conversión por fecha de consulta, sin anuladas', () => {
  const filas = [
    c(1, '2026-10-30', 'compro', { dia_venta: '2026-11-02', monto_total: 50000, unidades: 1 }), // consulta en octubre, venta en noviembre
    c(2, '2026-11-03', 'compro', { monto_total: 30000, unidades: 2 }),
    c(3, '2026-11-04', 'no_compro'),
    c(4, '2026-11-05', 'lo_piensa'),
    c(5, '2026-11-05', 'lo_piensa', { estado_efectivo: 'vencida' }),
    c(6, '2026-11-06', 'compro', { monto_total: 99999, anulada: true }),
  ];
  const r = M.resumen(filas, '2026-11-01', '2026-11-30');
  assert.equal(r.consultas, 4);
  assert.equal(r.ventas, 2);
  assert.equal(r.total, 80000);
  assert.equal(r.ticket, 40000);
  assert.equal(r.unidades, 3);
  assert.equal(r.compraron, 1);
  assert.equal(r.conversion, 0.25);
  assert.equal(r.loPiensan, 1);
  assert.equal(r.vencidas, 1);
  assert.equal(M.variacion(120, 100), 0.2);
  assert.equal(M.variacion(5, 0), null);
});

test('serie por día y por semana', () => {
  const filas = [c(1, '2026-11-02', 'compro', { monto_total: 100 }), c(2, '2026-11-02', 'no_compro'), c(3, '2026-11-10', 'no_compro')];
  const dias = M.serie(filas, '2026-11-01', '2026-11-10');
  assert.equal(dias.paso, 'dia');
  assert.equal(dias.puntos.length, 10);
  assert.deepEqual(dias.puntos[1], { clave: '2026-11-02', etiqueta: '02/11', consultas: 2, ventas: 1, monto: 100 });
  const semanas = M.serie(filas, '2026-11-01', '2026-11-10', 'semana');
  assert.deepEqual(semanas.puntos.map(p => [p.clave, p.consultas]), [['2026-10-26', 0], ['2026-11-02', 2], ['2026-11-09', 1]]);
});

test('agrupaciones y filtros', () => {
  const filas = [
    c(1, '2026-11-02', 'compro', { pago: 'QR', monto_total: 100, unidades: 1, atendio: 'Ana' }),
    c(2, '2026-11-03', 'compro', { pago: 'QR', monto_total: 50, unidades: 1, canal: 'Instagram' }),
    c(3, '2026-11-03', 'compro', { pago: 'Efectivo', monto_total: 500, unidades: 2 }),
  ];
  assert.deepEqual(M.ventasPor(filas, '2026-11-01', '2026-11-30', 'pago').map(g => [g.nombre, g.ventas, g.monto]), [['Efectivo', 1, 500], ['QR', 2, 150]]);
  assert.equal(M.filtrar(filas, { canal: 'Instagram' }).length, 1);
  assert.equal(M.filtrar(filas, { vendedor: '(sin indicar)' }).length, 2);
  const canales = M.porCanal(filas, '2026-11-01', '2026-11-30');
  assert.equal(canales.find(x => x.nombre === 'WhatsApp').conversion, 1);
  const items = [{ consulta_id: 1, rubro: 'Mochilas', cantidad: 1, monto: 100 }, { consulta_id: 3, rubro: 'Mochilas', cantidad: 2, monto: 500 }, { consulta_id: 2, rubro: null, cantidad: 1, monto: 50 }];
  assert.deepEqual(M.itemsPor(items, 'rubro', 'Sin rubro'), [{ nombre: 'Mochilas', unidades: 3, monto: 600, ventas: 2 }, { nombre: 'Sin rubro', unidades: 1, monto: 50, ventas: 1 }]);
});

test('día y hora en Argentina', () => {
  assert.deepEqual(M.diaHora('2026-11-12T23:30:00Z'), { dia: 3, hora: 20 }); // jueves 20:30 en Córdoba
  const m = M.mapaCalor([c(1, '2026-11-12', 'no_compro', { fecha_consulta: '2026-11-12T23:30:00Z' })], '2026-11-01', '2026-11-30');
  assert.equal(m[3][20], 1);
});

// ---------- Categorías y productos (buscador) ----------
const art = (consulta_id, extra) => ({ consulta_id, cantidad: 1, monto: 1000, producto: '', producto_clave: '', categoria: '', categoria_ruta: '', rubro: null, ...extra });
const mochilaUrb = { producto: 'MOCHILA NBA LAKERS', producto_clave: 'mochila nba lakers|1', categoria: 'Urbanas', categoria_ruta: 'Marroquinería > Mochilas > Urbanas' };
const mochilaInf = { producto: 'MOCHILA CRISTAL CAT', producto_clave: 'mochila cristal cat|2', categoria: 'Infantiles', categoria_ruta: 'Marroquinería > Mochilas > Infantiles' };
const cartuchera = { producto: 'CARTUCHERA TRENDY', producto_clave: 'cartuchera trendy|3', categoria: 'Cartucheras', categoria_ruta: 'Escolar > Cartucheras' };

test('categoría de un artículo: rubro, subrubro o la más profunda; sin ruta cuenta el rubro de la lista', () => {
  assert.equal(M.categoriaDe(art(1, mochilaUrb), 1), 'Marroquinería');
  assert.equal(M.categoriaDe(art(1, mochilaUrb), 2), 'Mochilas');
  assert.equal(M.categoriaDe(art(1, mochilaUrb), 3), 'Urbanas');
  // una ruta corta: el nivel 2 y 3 caen en lo último que hay
  assert.equal(M.categoriaDe(art(1, cartuchera), 1), 'Escolar');
  assert.equal(M.categoriaDe(art(1, cartuchera), 2), 'Cartucheras');
  assert.equal(M.categoriaDe(art(1, cartuchera), 3), 'Cartucheras');
  // texto libre o de antes del buscador
  assert.equal(M.categoriaDe(art(1, { rubro: 'Billeteras' }), 1), 'Billeteras');
  assert.equal(M.categoriaDe(art(1, {}), 2), 'Otros');
});

test('categorías más vendidas: agrupa por nivel y ordena por monto', () => {
  const items = [
    art(1, { ...mochilaUrb, cantidad: 2, monto: 64000 }), art(2, { ...mochilaInf, cantidad: 1, monto: 30000 }), art(3, { ...cartuchera, cantidad: 3, monto: 21000 }),
    art(4, { rubro: 'Billeteras', cantidad: 1, monto: 22000 }),
  ];
  const r1 = M.itemsPorCategoria(items, 1);
  assert.deepEqual(r1.map(g => [g.nombre, g.unidades, g.monto, g.ventas]), [['Marroquinería', 3, 94000, 2], ['Billeteras', 1, 22000, 1], ['Escolar', 3, 21000, 1]]);
  const r2 = M.itemsPorCategoria(items, 2);
  assert.deepEqual(r2.map(g => g.nombre), ['Mochilas', 'Billeteras', 'Cartucheras']);
  assert.deepEqual(M.itemsPorCategoria(items, 3).map(g => g.nombre), ['Urbanas', 'Infantiles', 'Billeteras', 'Cartucheras']);
  assert.deepEqual(M.itemsPorCategoria([], 1), []);
});

test('productos más vendidos: el mismo producto en varias ventas se junta; lo sin producto se cuenta aparte', () => {
  const items = [
    art(1, { ...mochilaUrb, cantidad: 1, monto: 30000 }), art(2, { ...mochilaUrb, cantidad: 2, monto: 64000 }),
    art(3, { ...cartuchera, cantidad: 5, monto: 35000 }), art(4, { rubro: 'Billeteras', cantidad: 2, monto: 40000 }),
  ];
  const r = M.productosTop(items);
  assert.deepEqual(r.productos.map(p => [p.nombre, p.unidades, p.monto, p.ventas]), [['CARTUCHERA TRENDY', 5, 35000, 1], ['MOCHILA NBA LAKERS', 3, 94000, 2]]);
  assert.equal(r.sinProducto, 2);
  assert.equal(r.productos[1].categoria, 'Urbanas');
  // por monto el orden cambia
  assert.equal(M.productosTop(items, 'monto').productos[0].nombre, 'MOCHILA NBA LAKERS');
  assert.deepEqual(M.productosTop([]), { productos: [], sinProducto: 0 });
});
