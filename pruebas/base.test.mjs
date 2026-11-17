// Pruebas de la base: corre las migraciones en un Postgres en memoria (PGlite)
// con un esquema "auth" mínimo que imita a Supabase, y prueba las reglas
// de carga y los permisos de cada rol.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRACIONES = path.join(RAIZ, 'supabase', 'migrations');
const migraciones = () => fs.readdirSync(MIGRACIONES).filter(n => n.endsWith('.sql')).sort()
  .map(n => fs.readFileSync(path.join(MIGRACIONES, n), 'utf8'));

const U = {
  admin: '00000000-0000-0000-0000-00000000000a',
  cindy: '00000000-0000-0000-0000-00000000000c',   // carga, Cindy Minorista
  chimola: '00000000-0000-0000-0000-00000000000b', // carga, Chimola
  mariela: '00000000-0000-0000-0000-00000000000d', // consulta
  inactivo: '00000000-0000-0000-0000-00000000000e',
};
let db;
const L = {};   // id de cada local
const O = {};   // O['Cindy Minorista'].canal.WhatsApp -> id

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    -- Como en Supabase: auth.jwt() con los datos del token (PostgREST llena request.jwt.claims)
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
        || case when nullif(current_setting('request.jwt.claim.sub', true), '') is not null
                then jsonb_build_object('sub', current_setting('request.jwt.claim.sub', true), 'iss', 'https://x.supabase.co/auth/v1')
                else '{}'::jsonb end $$;
    grant execute on function auth.jwt() to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  for (const sql of migraciones()) await db.exec(sql);
  for (const [nombre, id] of Object.entries(U)) {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${nombre}@prueba`]);
  }
  for (const r of (await db.query('select id, nombre from public.locales')).rows) L[r.nombre] = r.id;
  for (const r of (await db.query('select o.id, l.nombre as local, o.tipo, o.valor from public.opciones o join public.locales l on l.id = o.local_id')).rows) {
    ((O[r.local] ??= {})[r.tipo] ??= {})[r.valor] = r.id;
  }
  await db.exec(`
    update public.perfiles set rol = 'admin', activo = true where id = '${U.admin}';
    update public.perfiles set rol = 'carga', activo = true where id in ('${U.cindy}', '${U.chimola}');
    update public.perfiles set rol = 'consulta', activo = true where id = '${U.mariela}';
    update public.perfiles set rol = 'carga' where id = '${U.inactivo}';
    insert into public.usuarios_locales values ('${U.cindy}', ${L['Cindy Minorista']}), ('${U.chimola}', ${L.Chimola}),
                                               ('${U.inactivo}', ${L['Cindy Minorista']});
    insert into public.vendedores (local_id, nombre) values (${L['Cindy Minorista']}, 'Vendedora A'), (${L.Chimola}, 'Vendedora B');
  `);
});

// Corre una consulta como un usuario (o sin sesión, con usuario = null).
// Si falla, la transacción se deshace, igual que un pedido a Supabase.
async function como(usuario, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec(usuario ? `set local role authenticated; set local request.jwt.claim.sub = '${usuario}';` : 'set local role anon;');
    return (await tx.query(sql, params)).rows;
  });
}
const guardar = (usuario, p) => como(usuario, 'select public.guardar_consulta($1) as id', [p]).then(f => Number(f[0].id));
const cerrar = (usuario, id, p) => como(usuario, 'select public.cerrar_lo_piensa($1, $2) as id', [id, p]);
const anular = (usuario, id, motivo) => como(usuario, 'select public.anular_consulta($1, $2)', [id, motivo]);
const fila = async id => (await db.query('select * from public.consultas where id = $1', [id])).rows[0];

const cm = () => O['Cindy Minorista'];
const ventaCindy = (extra = {}) => ({
  local_id: L['Cindy Minorista'], canal_id: cm().canal.WhatsApp, estado: 'compro',
  envio_id: cm().envio['Retiro en el local'], pago_id: cm().pago.QR,
  items: [
    { rubro_id: cm().rubro.Mochilas, marca_id: cm().marca.Unicross, cantidad: 1, monto: 49900 },
    { rubro_id: cm().rubro.Billeteras, marca_id: cm().marca.Amayra, cantidad: 2, monto: 30000.5 },
  ],
  ...extra,
});

test('datos iniciales: dos locales y listas propias', () => {
  assert.deepEqual(Object.keys(L).sort(), ['Chimola', 'Cindy Minorista']);
  assert.ok(cm().envio['Envío gratis a Villa María']);
  assert.equal(O.Chimola.envio['Envío gratis a Villa María'], undefined);
  assert.deepEqual(Object.keys(O.Chimola.marca), ['Chimola']);
  assert.ok(cm().pago['Go cuotas'] && O.Chimola.pago['Go cuotas']);
});

test('consulta que no compró: 3 datos y listo', async () => {
  const id = await guardar(U.cindy, { local_id: L['Cindy Minorista'], canal_id: cm().canal.Instagram, estado: 'no_compro' });
  const c = await fila(id);
  assert.equal(c.estado, 'no_compro');
  assert.equal(c.creado_por, U.cindy);
  assert.equal(Number(c.monto_total), 0);
});

test('venta con dos artículos: monto total calculado por la base', async () => {
  const id = await guardar(U.cindy, ventaCindy());
  const c = await fila(id);
  assert.equal(Number(c.monto_total), 79900.5);
  assert.ok(c.fecha_venta);
  const v = (await como(U.cindy, 'select unidades, canal, pago, estado_efectivo from public.consultas_vista where id = $1', [id]))[0];
  assert.equal(Number(v.unidades), 3);
  assert.equal(v.canal, 'WhatsApp');
  assert.equal(v.pago, 'QR');
  assert.equal(v.estado_efectivo, 'compro');
});

test('una venta incompleta se rechaza', async () => {
  await assert.rejects(guardar(U.cindy, ventaCindy({ items: [] })), /al menos un artículo/);
  await assert.rejects(guardar(U.cindy, ventaCindy({ pago_id: null })), /forma de pago/);
  await assert.rejects(guardar(U.cindy, ventaCindy({ items: [{ rubro_id: cm().rubro.Mochilas, cantidad: 1.5, monto: 10 }] })), /entero/);
  await assert.rejects(guardar(U.cindy, ventaCindy({ items: [{ rubro_id: cm().rubro.Mochilas, cantidad: 1, monto: -1 }] })), /monto/);
  await assert.rejects(guardar(U.cindy, ventaCindy({ items: [{ cantidad: 1, monto: 10 }] })), /Falta el nombre del producto/);   // ni producto, ni nombre, ni rubro
  await assert.rejects(guardar(U.cindy, { local_id: L['Cindy Minorista'], estado: 'no_compro' }), /canal/);
  await assert.rejects(guardar(U.cindy, { local_id: L['Cindy Minorista'], canal_id: cm().canal.WhatsApp, estado: 'tal vez' }), /Estado no válido/);
});

test('opciones de otro local o de otro tipo se rechazan', async () => {
  await assert.rejects(guardar(U.cindy, ventaCindy({ pago_id: O.Chimola.pago.QR })), /forma de pago no corresponde/);
  await assert.rejects(guardar(U.cindy, ventaCindy({ envio_id: cm().pago.QR })), /envío no corresponde/);
  await assert.rejects(guardar(U.cindy, ventaCindy({ items: [{ rubro_id: O.Chimola.rubro.Billeteras, cantidad: 1, monto: 1 }] })), /rubro no corresponde/);
  const vendedoraChimola = (await db.query(`select id from public.vendedores where nombre = 'Vendedora B'`)).rows[0].id;
  await assert.rejects(guardar(U.cindy, ventaCindy({ atendio_id: vendedoraChimola })), /vendedor no corresponde/);
});

test('cada local carga solo en lo suyo; consulta y anónimo no cargan', async () => {
  await assert.rejects(guardar(U.chimola, { local_id: L['Cindy Minorista'], canal_id: cm().canal.WhatsApp, estado: 'no_compro' }), /permiso/);
  await assert.rejects(guardar(U.mariela, { local_id: L['Cindy Minorista'], canal_id: cm().canal.WhatsApp, estado: 'no_compro' }), /permiso/);
  await assert.rejects(guardar(U.inactivo, { local_id: L['Cindy Minorista'], canal_id: cm().canal.WhatsApp, estado: 'no_compro' }), /permiso/);
  await assert.rejects(guardar(null, { local_id: L['Cindy Minorista'], canal_id: cm().canal.WhatsApp, estado: 'no_compro' }), /permission denied|permiso/);
  // Nadie escribe la tabla directo
  await assert.rejects(como(U.cindy, `insert into public.consultas (local_id, canal_id, estado) values (${L['Cindy Minorista']}, ${cm().canal.WhatsApp}, 'no_compro')`), /permission denied/);
  await assert.rejects(como(U.admin, `update public.consultas set monto_total = 1`), /permission denied/);
});

test('lectura: cada local ve lo suyo, Mariela ve todo, anónimo nada', async () => {
  await guardar(U.chimola, { local_id: L.Chimola, canal_id: O.Chimola.canal.Instagram, estado: 'no_compro' });
  const locales = async u => [...new Set((await como(u, 'select local from public.consultas_vista')).map(r => r.local))].sort();
  assert.deepEqual(await locales(U.cindy), ['Cindy Minorista']);
  assert.deepEqual(await locales(U.chimola), ['Chimola']);
  assert.deepEqual(await locales(U.mariela), ['Chimola', 'Cindy Minorista']);
  assert.deepEqual(await locales(U.inactivo), []);
  await assert.rejects(como(null, 'select * from public.consultas_vista'), /permission denied/);
  assert.equal((await como(U.cindy, 'select * from public.historial')).length, 0);
  assert.ok((await como(U.admin, 'select * from public.historial')).length > 0);
});

test('corregir: el local tiene 48 horas, después solo el admin', async () => {
  const id = await guardar(U.cindy, { local_id: L['Cindy Minorista'], canal_id: cm().canal.WhatsApp, estado: 'no_compro' });
  await guardar(U.cindy, { id, canal_id: cm().canal.Instagram, estado: 'no_compro' });
  assert.equal((await fila(id)).canal_id, cm().canal.Instagram);
  await db.query(`update public.consultas set creado_en = now() - interval '49 hours', fecha_consulta = now() - interval '49 hours' where id = $1`, [id]);
  await assert.rejects(guardar(U.cindy, { id, canal_id: cm().canal.WhatsApp, estado: 'no_compro' }), /solo un admin/);
  await assert.rejects(anular(U.cindy, id, 'error'), /solo un admin/);
  await guardar(U.admin, { id, canal_id: cm().canal.WhatsApp, estado: 'no_compro' });
  assert.equal((await fila(id)).canal_id, cm().canal.WhatsApp);
});

test('fechas: nada futuro y hasta 7 días atrás para el local', async () => {
  const futura = new Date(Date.now() + 86400000).toISOString();
  const vieja = new Date(Date.now() - 10 * 86400000).toISOString();
  const base = { local_id: L['Cindy Minorista'], canal_id: cm().canal.WhatsApp, estado: 'no_compro' };
  await assert.rejects(guardar(U.cindy, { ...base, fecha_consulta: futura }), /futura/);
  await assert.rejects(guardar(U.cindy, { ...base, fecha_consulta: vieja }), /7 días/);
  const id = await guardar(U.admin, { ...base, fecha_consulta: vieja });
  assert.ok(id > 0);
});

test('"Lo piensa" pide al menos un dato del cliente (nombre, teléfono o usuario); quedan guardados al cerrarla', async () => {
  const base = { local_id: L['Cindy Minorista'], canal_id: cm().canal.Instagram, estado: 'lo_piensa' };
  await assert.rejects(guardar(U.cindy, base), /falta un dato del cliente/);
  await assert.rejects(guardar(U.cindy, { ...base, cliente_nombre: '  ', cliente_contacto: ' ' }), /falta un dato del cliente/);
  // Con uno solo alcanza
  const soloUsuario = await guardar(U.cindy, { ...base, cliente_contacto: '@solo.usuario' });
  assert.equal((await fila(soloUsuario)).cliente_nombre, '');
  const soloNombre = await guardar(U.cindy, { ...base, cliente_nombre: 'Solo Nombre' });
  assert.equal((await fila(soloNombre)).cliente_contacto, '');
  const id = await guardar(U.cindy, { ...base, cliente_nombre: '  Ana Pérez ', cliente_contacto: '@ana.perez' });
  const v = (await como(U.cindy, 'select cliente_nombre, cliente_contacto from public.consultas_vista where id = $1', [id]))[0];
  assert.deepEqual(v, { cliente_nombre: 'Ana Pérez', cliente_contacto: '@ana.perez' });
  // Corregir sin mandar los datos del cliente no los borra; pasarla a "lo piensa" sin datos no se puede
  await guardar(U.cindy, { id, estado: 'lo_piensa', nota: 'vuelve el sábado' });
  assert.equal((await fila(id)).cliente_nombre, 'Ana Pérez');
  await guardar(U.cindy, { id, estado: 'lo_piensa', cliente_contacto: '' });   // queda el nombre: alcanza
  await assert.rejects(guardar(U.cindy, { id, estado: 'lo_piensa', cliente_nombre: '', cliente_contacto: '' }), /falta un dato del cliente/);
  await guardar(U.cindy, { id, estado: 'lo_piensa', cliente_contacto: '@ana.perez' });
  await cerrar(U.cindy, id, { estado: 'no_compro' });
  assert.equal((await fila(id)).cliente_contacto, '@ana.perez');
  // En las otras consultas el cliente es opcional
  const otra = await guardar(U.cindy, { local_id: L['Cindy Minorista'], canal_id: cm().canal.WhatsApp, estado: 'no_compro' });
  assert.equal((await fila(otra)).cliente_nombre, '');
  // Chimola no ve los datos del cliente de Cindy Minorista
  assert.equal((await como(U.chimola, 'select 1 from public.consultas_vista where id = $1', [id])).length, 0);
});

test('"Lo piensa": se cierra cuando sea, la venta cae en la fecha del cierre y vence a los 15 días', async () => {
  const id = await guardar(U.cindy, { local_id: L['Cindy Minorista'], canal_id: cm().canal.WhatsApp, estado: 'lo_piensa',
    cliente_nombre: 'Juan Gómez', cliente_contacto: '3534 123456' });
  await db.query(`update public.consultas set creado_en = now() - interval '20 days', fecha_consulta = now() - interval '20 days' where id = $1`, [id]);
  const v = (await como(U.mariela, 'select estado_efectivo from public.consultas_vista where id = $1', [id]))[0];
  assert.equal(v.estado_efectivo, 'vencida');
  await assert.rejects(cerrar(U.cindy, id, { estado: 'compro', items: [] }), /forma de pago|al menos un artículo/);
  await cerrar(U.cindy, id, {
    estado: 'compro', envio_id: cm().envio['Cadete (envío pago)'], pago_id: cm().pago.Efectivo,
    items: [{ rubro_id: cm().rubro.Valijas ?? cm().rubro['Valijas y carry on'], cantidad: 1, monto: 75000 }],
  });
  const c = await fila(id);
  assert.equal(c.estado, 'compro');
  assert.ok(c.cerrada_en);
  assert.ok(new Date(c.fecha_venta) > new Date(c.fecha_consulta));
  assert.equal(Number(c.monto_total), 75000);
  await assert.rejects(cerrar(U.cindy, id, { estado: 'no_compro' }), /no está en "Lo piensa"/);
});

test('anular: sin motivo se anula igual ("Sin motivo"); con motivo lo guarda; deja historial y sale de los artículos vendidos', async () => {
  const sinMotivo = await guardar(U.cindy, ventaCindy());
  await anular(U.cindy, sinMotivo, '  ');
  assert.equal((await fila(sinMotivo)).anulada_motivo, 'Sin motivo');
  const otra = await guardar(U.cindy, ventaCindy());
  await anular(U.cindy, otra, null);
  assert.equal((await fila(otra)).anulada, true);
  const id = await guardar(U.cindy, ventaCindy());
  await anular(U.cindy, id, 'cargada dos veces');
  const c = await fila(id);
  assert.equal(c.anulada, true);
  assert.equal(c.anulada_por, U.cindy);
  assert.equal((await como(U.mariela, 'select * from public.venta_items_vista where consulta_id = $1', [id])).length, 0);
  await assert.rejects(guardar(U.cindy, { id, estado: 'no_compro' }), /anulada/);
  const h = await como(U.admin, `select accion from public.historial where tabla = 'consultas' and registro_id = $1 order by id`, [id]);
  assert.ok(h.length >= 2);
});

test('pasar una venta a "no compró" borra sus artículos y el monto', async () => {
  const id = await guardar(U.cindy, ventaCindy());
  await guardar(U.cindy, { id, estado: 'no_compro' });
  const c = await fila(id);
  assert.equal(Number(c.monto_total), 0);
  assert.equal(c.fecha_venta, null);
  assert.equal((await db.query('select count(*)::int as n from public.venta_items where consulta_id = $1', [id])).rows[0].n, 0);
});

test('configuración: solo el admin cambia listas y usuarios; nunca queda sin admin', async () => {
  await assert.rejects(como(U.cindy, `insert into public.opciones (local_id, tipo, valor) values (${L['Cindy Minorista']}, 'marca', 'Nueva')`), /row-level security|permission denied/);
  await como(U.admin, `insert into public.opciones (local_id, tipo, valor) values (${L['Cindy Minorista']}, 'marca', 'Nueva')`);
  const cambio = await como(U.cindy, `update public.perfiles set rol = 'admin' where id = '${U.cindy}' returning id`);
  assert.equal(cambio.length, 0);
  await assert.rejects(como(U.admin, `update public.perfiles set activo = false where id = '${U.admin}'`), /último admin/);
});

// ---------- Producto del catálogo (buscador) ----------
const itemCatalogo = (extra = {}) => ({
  catalogo: true, producto: 'MOCHILA NBA LAKERS', producto_clave: 'mochila nba lakers|41283913', categoria: 'Urbanas',
  categoria_ruta: 'Marroquinería > Mochilas > Urbanas', categoria_tn_id: 41284162, cantidad: 2, monto: 64000, ...extra,
});

test('catálogo: un artículo del buscador no necesita rubro ni marca y guarda producto y categoría', async () => {
  const id = await guardar(U.cindy, ventaCindy({ items: [itemCatalogo(), { rubro_id: cm().rubro.Billeteras, cantidad: 1, monto: 15000 }] }));
  const filas = await como(U.cindy,
    'select producto, producto_clave, categoria, categoria_ruta, categoria_tn_id, catalogo, rubro, rubro_web, subrubro_web, cantidad, monto from public.venta_items_vista where consulta_id = $1 order by id', [id]);
  assert.equal(filas.length, 2);
  assert.equal(filas[0].producto, 'MOCHILA NBA LAKERS');
  assert.equal(filas[0].categoria, 'Urbanas');
  assert.equal(filas[0].categoria_ruta, 'Marroquinería > Mochilas > Urbanas');
  assert.equal(Number(filas[0].categoria_tn_id), 41284162);
  assert.equal(filas[0].catalogo, true);
  assert.equal(filas[0].rubro, null);
  assert.equal(filas[0].rubro_web, 'Marroquinería');
  assert.equal(filas[0].subrubro_web, 'Mochilas');
  // el artículo de texto libre sigue con su rubro de la lista y sin datos de catálogo
  assert.equal(filas[1].catalogo, false);
  assert.equal(filas[1].rubro, 'Billeteras');
  assert.equal(filas[1].producto, '');
  assert.equal(filas[1].rubro_web, null);
  assert.equal(Number((await fila(id)).monto_total), 79000);
});

test('catálogo: sin producto o sin categoría se rechaza; fuera del catálogo alcanza con el nombre tal como se escribió', async () => {
  await assert.rejects(guardar(U.cindy, ventaCindy({ items: [itemCatalogo({ producto: '  ' })] })), /Falta el producto/);
  await assert.rejects(guardar(U.cindy, ventaCindy({ items: [itemCatalogo({ categoria: '' })] })), /Falta la categoría/);
  // sin nombre y sin rubro no se puede
  await assert.rejects(guardar(U.cindy, ventaCindy({ items: [{ catalogo: false, descripcion: '  ', cantidad: 1, monto: 10 }] })), /Falta el nombre del producto/);
  // con el nombre solo, sin rubro, sí
  const id = await guardar(U.cindy, ventaCindy({ items: [{ catalogo: false, descripcion: 'Paraguas transparente con luces', cantidad: 2, monto: 30000 }] }));
  const it = (await como(U.cindy, 'select descripcion, rubro_id, catalogo from public.venta_items_vista where consulta_id = $1', [id]))[0];
  assert.deepEqual(it, { descripcion: 'Paraguas transparente con luces', rubro_id: null, catalogo: false });
  // los de antes (con rubro y sin nombre) siguen valiendo
  await guardar(U.cindy, ventaCindy({ items: [{ catalogo: false, rubro_id: cm().rubro.Mochilas, cantidad: 1, monto: 10 }] }));
  await assert.rejects(guardar(U.cindy, ventaCindy({ items: [itemCatalogo({ cantidad: 0 })] })), /entero mayor a cero/);
  await assert.rejects(guardar(U.cindy, ventaCindy({ items: [itemCatalogo({ monto: -5 })] })), /monto/);
});

test('catálogo: un artículo de texto libre no arrastra datos de producto aunque se los manden', async () => {
  const id = await guardar(U.cindy, ventaCindy({ items: [{ catalogo: false, producto: 'X', categoria: 'Y', categoria_ruta: 'A > B', rubro_id: cm().rubro.Mochilas, cantidad: 1, monto: 100 }] }));
  const f = (await como(U.cindy, 'select producto, categoria, categoria_ruta, catalogo from public.venta_items_vista where consulta_id = $1', [id]))[0];
  assert.deepEqual(f, { producto: '', categoria: '', categoria_ruta: '', catalogo: false });
});

test('catálogo: corregir una venta cambia el producto y los permisos de lectura siguen igual', async () => {
  const id = await guardar(U.cindy, ventaCindy({ items: [itemCatalogo()] }));
  await guardar(U.cindy, { id, estado: 'compro', envio_id: cm().envio['Retiro en el local'], pago_id: cm().pago.QR,
    items: [itemCatalogo({ producto: 'MOCHILA NBA SPURS', producto_clave: 'mochila nba spurs|41284162' })] });
  assert.equal((await como(U.mariela, 'select producto from public.venta_items_vista where consulta_id = $1', [id]))[0].producto, 'MOCHILA NBA SPURS');
  // Chimola no ve los artículos de Cindy Minorista
  assert.equal((await como(U.chimola, 'select 1 from public.venta_items_vista where consulta_id = $1', [id])).length, 0);
});
