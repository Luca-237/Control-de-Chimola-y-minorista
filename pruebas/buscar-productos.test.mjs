// Pruebas del buscador de productos (función buscar-productos, contra Odoo). Sin internet: respuestas armadas
// con la misma forma que la API JSON-2 de Odoo 19. Con la variable de entorno ODOO_PRUEBA_CLAVE (una clave de
// solo consulta; nunca se guarda en un archivo) además consulta Odoo de verdad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizar, palabras, dominio, agrupar, consultarOdoo, buscarProductos, CAMPOS, limpiarCodigo, dominioCodigo, buscarPorCodigo } from '../supabase/functions/buscar-productos/index.ts';

let n = 0;
const prod = (nombre, categoria, extra = {}) => ({ id: ++n, name: nombre, default_code: String(300000 + n), categ_id: categoria ? [categoria[0], categoria[1]] : false, qty_available: 1, ...extra });
const MOCHILAS = [10, 'Mochilas'], CARTERAS = [15, 'Carteras'];
const cfg = { url: 'https://odoo.prueba/', clave: 'clave-de-prueba' };

test('normaliza: mayúsculas, tildes, espacios y signos no cuentan', () => {
  assert.equal(normalizar('  Mochila   NBA  Lakers '), 'mochila nba lakers');
  assert.equal(normalizar('CARTUCHERA 1 DIVISIÓN "Disney"'), 'cartuchera 1 division disney');
  assert.equal(normalizar(null), '');
});

test('palabras y filtro de Odoo: cada palabra en el nombre o el código, solo lo que se vende', () => {
  assert.deepEqual(palabras(' trendy  mochila trendy x '), ['trendy', 'mochila']);
  assert.deepEqual(palabras('50%_off'), ['50', 'off']);   // los comodines de Odoo no pasan
  assert.deepEqual(dominio('mochila trendy'), [['sale_ok', '=', true],
    '|', ['name', 'ilike', 'mochila'], ['default_code', 'ilike', 'mochila'],
    '|', ['name', 'ilike', 'trendy'], ['default_code', 'ilike', 'trendy']]);
  assert.deepEqual(dominio('mochila tren', true).at(-1), ['name', '=ilike', 'mochila%tren%']);
});

test('junta los repetidos: mismo nombre y categoría es un resultado, con el stock sumado', () => {
  const r = agrupar([
    prod('MOCHILA CARRO TRENDY', MOCHILAS, { qty_available: 5 }), prod('Mochila  carro Trendy', MOCHILAS, { qty_available: 2.5 }),
    prod('mochila carro trendy', MOCHILAS, { qty_available: -3 }), prod('MOCHILA CARRO TRENDY', MOCHILAS, { qty_available: 0 }),
  ], 'mochila');
  assert.equal(r.length, 1);
  assert.equal(r[0].cantidad, 4);
  assert.equal(r[0].stock, 7.5);          // el stock negativo cuenta como 0
  assert.equal(r[0].con_stock, true);
  assert.equal(r[0].nombre, 'MOCHILA CARRO TRENDY');
  assert.equal(r[0].categoria, 'Mochilas');
  assert.equal(r[0].ruta, 'Mochilas');
  assert.equal(r[0].categoria_id, 10);
  assert.equal(r[0].codigos.length, 3);   // hasta 3 códigos de ejemplo
  assert.equal(r[0].clave, 'mochila carro trendy|10');
});

test('el mismo nombre en categorías distintas sale por separado; sin categoría no rompe', () => {
  const r = agrupar([prod('MOCHILA CAPYBARA', MOCHILAS), prod('MOCHILA CAPYBARA', CARTERAS), prod('MOCHILA SUELTA', null)], 'mochila');
  assert.equal(r.length, 3);
  const suelta = r.find(x => x.nombre === 'MOCHILA SUELTA');
  assert.equal(suelta.categoria, 'Sin categoría');
  assert.equal(suelta.categoria_id, null);
});

test('orden: primero los que empiezan con lo escrito, después los que tienen stock, después el orden de Odoo', () => {
  const r = agrupar([
    prod('BANCO CON MOCHILA', MOCHILAS), prod('MOCHILA SIN STOCK', MOCHILAS, { qty_available: 0 }), prod('MOCHILA CON STOCK', MOCHILAS),
  ], 'mochila');
  assert.deepEqual(r.map(x => x.nombre), ['MOCHILA CON STOCK', 'MOCHILA SIN STOCK', 'BANCO CON MOCHILA']);
  assert.equal(r[1].con_stock, false);   // los que no tienen stock se muestran igual
});

test('respeta el límite y un producto sin nombre no cuenta', () => {
  const lista = Array.from({ length: 12 }, (_, i) => prod('MOCHILA ' + i, MOCHILAS));
  assert.equal(agrupar(lista, 'mochila', 5).length, 5);
  assert.equal(agrupar([prod('', MOCHILAS)], 'mochila').length, 0);
});

test('Odoo: search_read con la clave en el encabezado, solo los campos necesarios', async () => {
  let pedido;
  const r = await consultarOdoo(dominio('mochila'), cfg, async (url, op) => { pedido = { url, op }; return new Response(JSON.stringify([prod('MOCHILA', MOCHILAS)]), { status: 200 }); });
  assert.equal(pedido.url, 'https://odoo.prueba/json/2/product.template/search_read');
  assert.equal(pedido.op.method, 'POST');
  assert.equal(pedido.op.headers.Authorization, 'bearer clave-de-prueba');
  const cuerpo = JSON.parse(pedido.op.body);
  assert.deepEqual(cuerpo.fields, CAMPOS);
  assert.ok(cuerpo.limit > 0 && cuerpo.limit <= 100);
  assert.equal(r.length, 1);
});

test('Odoo: clave rechazada y otros errores se explican', async () => {
  await assert.rejects(consultarOdoo([], cfg, async () => new Response('{}', { status: 401 })), /rechazó la clave/);
  await assert.rejects(consultarOdoo([], cfg, async () => new Response(JSON.stringify({ name: 'odoo.exceptions.AccessError', message: 'Sin acceso' }), { status: 403 })), /rechazó la clave/);
  await assert.rejects(consultarOdoo([], cfg, async () => new Response(JSON.stringify({ message: 'Invalid field' }), { status: 422 })), /422: Invalid field/);
  await assert.rejects(consultarOdoo([], cfg, async () => new Response('"hola"', { status: 200 })), /inesperado/);
});

test('busca primero los que empiezan con lo escrito y solo pide el resto si no alcanzan', async () => {
  const pedidos = [];
  const pedir = (respuestas) => async (url, op) => { pedidos.push(JSON.parse(op.body).domain); return new Response(JSON.stringify(respuestas.shift()), { status: 200 }); };
  pedidos.length = 0;
  let r = await buscarProductos('moch', 2, cfg, pedir([[prod('MOCHILA A', MOCHILAS), prod('MOCHILA B', MOCHILAS)]]));
  assert.equal(pedidos.length, 1);
  assert.equal(r.length, 2);
  pedidos.length = 0;
  const a = prod('MOCHILA A', MOCHILAS);
  r = await buscarProductos('moch', 5, cfg, pedir([[a], [a, prod('BANCO CON MOCHILA', MOCHILAS)]]));
  assert.equal(pedidos.length, 2);
  assert.deepEqual(r.map(x => [x.nombre, x.cantidad]), [['MOCHILA A', 1], ['BANCO CON MOCHILA', 1]]);
  assert.deepEqual(await buscarProductos(' a ', 5, cfg, async () => { throw new Error('no debería consultar'); }), []);
});

test('pistola de código de barras: código exacto en los códigos de barras de las variantes o en el código interno', async () => {
  assert.equal(limpiarCodigo(' 7791234567890 '), '7791234567890');
  assert.equal(limpiarCodigo('BZ-169'), 'BZ-169');
  assert.equal(limpiarCodigo('12'), '');                 // muy corto
  assert.equal(limpiarCodigo("x' or 1=1"), '');         // caracteres raros
  assert.deepEqual(dominioCodigo('7791234567890'), [['sale_ok', '=', true], '|',
    ['product_variant_ids.barcode', '=', '7791234567890'], ['default_code', '=ilike', '7791234567890']]);
  let cuerpo = null;
  const r = await buscarPorCodigo('7791234567890', cfg, async (_url, op) => { cuerpo = JSON.parse(op.body); return new Response(JSON.stringify([prod('MOCHILA TRENDY', MOCHILAS)]), { status: 200 }); });
  assert.deepEqual(cuerpo.domain, dominioCodigo('7791234567890'));
  assert.equal(r.length, 1);
  assert.equal(r[0].nombre, 'MOCHILA TRENDY');
  assert.deepEqual(await buscarPorCodigo('a', cfg, async () => { throw new Error('no tenía que consultar'); }), []);
});

test('un código de barras escrito a mano (8 números o más) también se busca en los códigos de barras', () => {
  assert.deepEqual(dominio('77912345').slice(1), ['|', '|', ['name', 'ilike', '77912345'], ['default_code', 'ilike', '77912345'], ['product_variant_ids.barcode', 'ilike', '77912345']]);
  assert.deepEqual(dominio('317000').slice(1), ['|', ['name', 'ilike', '317000'], ['default_code', 'ilike', '317000']]);
});

test('Odoo real (solo con ODOO_PRUEBA_CLAVE)', { skip: !process.env.ODOO_PRUEBA_CLAVE && 'sin ODOO_PRUEBA_CLAVE' }, async () => {
  const real = { url: process.env.ODOO_URL || 'https://cindymayorista.odoo.com', clave: process.env.ODOO_PRUEBA_CLAVE };
  const r = await buscarProductos('mochila trendy', 6, real);
  assert.ok(r.length > 0, 'tiene que encontrar algo');
  assert.ok(r.every(x => x.nombre && x.categoria && typeof x.stock === 'number'));
});
