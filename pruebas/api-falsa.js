// =====================================================================
//  API falsa para probar la página sin base de datos. Solo se carga en
//  la PC (localhost) abriendo index.html?demo=admin | carga | consulta.
//  Genera unos meses de consultas inventadas y repite las reglas
//  principales de la base (venta completa, plazos, anulación).
// =====================================================================
(function (R) {
  const rolDemo = (location.search.match(/demo=(\w+)/) || [])[1] || "admin";
  // Números al azar pero siempre los mismos (para que la demo no cambie al recargar)
  let semilla = 20261112;
  const azar = () => { semilla = (semilla * 1664525 + 1013904223) % 4294967296; return semilla / 4294967296; };
  const elegir = lista => lista[Math.floor(azar() * lista.length)];
  const pesado = pares => { const t = pares.reduce((s, p) => s + p[1], 0); let r = azar() * t; for (const [v, w] of pares) { if ((r -= w) < 0) return v; } return pares[0][0]; };

  const locales = [
    { id: 1, nombre: "Cindy Minorista", color: "#e84e1b", logo_url: "", dias_lo_piensa: 15, horas_edicion: 48, dias_carga_atrasada: 7, activo: true },
    { id: 2, nombre: "Chimola", color: "#8a5cc2", logo_url: "", dias_lo_piensa: 15, horas_edicion: 48, dias_carga_atrasada: 7, activo: true },
  ];
  let idOp = 1;
  const opciones = [];
  const op = (local_id, tipo, valor, orden) => opciones.push({ id: idOp++, local_id, tipo, valor, orden, activo: true });
  for (const l of [1, 2]) {
    [["WhatsApp", 1], ["Instagram", 2]].forEach(([v, o]) => op(l, "canal", v, o));
    ["Efectivo", "Transferencia", "QR", "Tarjeta de crédito", "Tarjeta de débito", "Billetera electrónica", "Go cuotas"].forEach((v, i) => op(l, "pago", v, i + 1));
    op(l, "envio", "Retiro en el local", 1);
    if (l === 1) { op(l, "envio", "Envío gratis a Villa María", 2); op(l, "envio", "Envío gratis a Villa Nueva", 3); }
    op(l, "envio", "Cadete (envío pago)", 4); op(l, "envio", "Transporte / correo", 5);
  }
  ["Mochilas", "Valijas y carry on", "Bolsos", "Carteras", "Billeteras", "Riñoneras y morrales", "Materos", "Neceseres y organizadores",
    "Accesorios de viaje", "Loncheras y botellas", "Paraguas y pilotos", "Textil"].forEach((v, i) => op(1, "rubro", v, i + 1));
  op(1, "rubro", "Otros", 99);
  ["Amayra", "American Tourister", "Bagcherry", "Chimola", "David Jones", "Discovery", "Disney", "Everlast", "Las Oreiro", "Samsonite",
    "Skora", "Travel Blue", "Trendy", "Unicross", "Wanderlust", "Wilson", "Xtrem"].forEach((v, i) => op(1, "marca", v, i + 1));
  op(1, "marca", "Otra", 99);
  ["Billeteras", "Carteras", "Mochilas", "Accesorios", "Deco", "Textil"].forEach((v, i) => op(2, "rubro", v, i + 1));
  op(2, "rubro", "Otros", 99);
  op(2, "marca", "Chimola", 1);

  let idVend = 1;
  const vendedores = [
    { id: idVend++, local_id: 1, nombre: "Vendedora 1", activo: true },
    { id: idVend++, local_id: 1, nombre: "Vendedora 2", activo: true },
    { id: idVend++, local_id: 1, nombre: "Vendedor 3", activo: true },
    { id: idVend++, local_id: 2, nombre: "Vendedora 4", activo: true },
    { id: idVend++, local_id: 2, nombre: "Vendedora 5", activo: true },
  ];
  const perfiles = [
    { id: "u-admin", email: "luca@minorista.cindymayorista.com.ar", nombre: "Luca", rol: "admin", activo: true, creado_en: "2026-11-12T10:00:00Z" },
    { id: "u-cindy", email: "cindyminorista@minorista.cindymayorista.com.ar", nombre: "Cindy Minorista", rol: "carga", activo: true, creado_en: "2026-11-12T10:05:00Z" },
    { id: "u-chimola", email: "chimola@minorista.cindymayorista.com.ar", nombre: "Chimola", rol: "carga", activo: true, creado_en: "2026-11-12T10:06:00Z" },
    { id: "u-mariela", email: "mariela@minorista.cindymayorista.com.ar", nombre: "Mariela", rol: "consulta", activo: true, creado_en: "2026-11-12T10:07:00Z" },
    { id: "u-nuevo", email: "nuevo@minorista.cindymayorista.com.ar", nombre: "", rol: "consulta", activo: false, creado_en: "2026-11-12T10:08:00Z" },
  ];
  const asignaciones = [{ usuario_id: "u-cindy", local_id: 1 }, { usuario_id: "u-chimola", local_id: 2 }];
  const yo = { admin: "u-admin", carga: "u-cindy", consulta: "u-mariela" }[rolDemo] || "u-admin";

  // ---------- Catálogo de ejemplo (lo que devolvería la función buscar-productos) ----------
  // [nombre, ruta de categorías, publicado, cuántos productos iguales hay, precio base, locales (1 Cindy Minorista, 2 Chimola), peso de ventas]
  const CATALOGO = [
    ["Mochila Trendy", "Marroquinería > Mochilas > Urbanas", true, 12, 45000, [1], 9], ["Mochila NBA Lakers", "Marroquinería > Mochilas > Urbanas", true, 3, 52000, [1], 3],
    ["Mochila Cristal Cat Chimola", "Marroquinería > Mochilas > Infantiles", true, 1, 38000, [1, 2], 5], ["Mochila Everlast Training", "Marroquinería > Mochilas > Deportivas", true, 4, 47000, [1], 4],
    ["Valija Carry On Samsonite", "Viajes > Equipajes > Carry on", true, 6, 160000, [1], 3], ["Valija Mediana Travel Blue", "Viajes > Equipajes > Rígida", true, 5, 130000, [1], 3],
    ["Bolso Playero Amayra", "Marroquinería > Bolsos > Playeros", true, 9, 55000, [1], 5], ["Bolso de Viaje Discovery", "Marroquinería > Bolsos > Viaje", true, 3, 68000, [1], 2],
    ["Cartera Trendy", "Marroquinería > Moda > Carteras", true, 30, 48000, [1, 2], 8], ["Cartera Amayra", "Marroquinería > Moda > Carteras", true, 10, 52000, [1], 4],
    ["Billetera Amayra", "Marroquinería > Moda > Billeteras", true, 31, 22000, [1, 2], 9], ["Billetera Oreiro Love", "Marroquinería > Moda > Billeteras", true, 30, 24000, [1], 5],
    ["Riñonera Skora", "Marroquinería > Moda > Riñoneras y morrales", true, 8, 28000, [1], 3], ["Morral Amayra", "Marroquinería > Moda > Riñoneras y morrales", true, 14, 36000, [1], 3],
    ["Matero Wilson", "Marroquinería > Materos", true, 4, 35000, [1], 2], ["Neceser Disney Stitch", "Viajes > Organizadores y accesorios", true, 2, 18000, [1, 2], 3],
    ["Lonchera Térmica Chimola", "Hogar > Loncheras y botellas", true, 5, 16000, [1, 2], 3], ["Paraguas Plegable Trendy", "Accesorios > Paraguas y pilotos", true, 3, 11000, [1], 2],
    ["Cartuchera Trendy", "Escolar > Cartucheras", true, 42, 14000, [1, 2], 4], ["Broche Trendy", "Accesorios y Beauty > Acc. De Pelo", true, 41, 3500, [2], 6],
    ["Collar Trendy", "Accesorios y Beauty > Pulseras y accesorios", true, 30, 9000, [2], 4], ["Set Broches Trendy", "Accesorios y Beauty > Acc. De Pelo", true, 30, 6500, [2], 5],
    ["Almohada Cervical Travel Blue", "Viajes > Accesorios de viaje", false, 2, 21000, [1], 1], ["Peluche Funshie Buzz", "Juguetes > Peluches", true, 6, 26000, [2], 3],
  ];
  const resultadoCatalogo = c => {
    const partes = c[1].split(" > ");
    return { clave: c[0].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim() + "|" + (1000 + CATALOGO.indexOf(c)),
      nombre: c[0].toUpperCase(), categoria: partes[partes.length - 1], ruta: c[1], categoria_id: 1000 + CATALOGO.indexOf(c), cantidad: c[3], publicado: c[2], imagen: "" };
  };

  // ---------- Consultas inventadas ----------
  const consultas = [], items = [];
  let idC = 1, idI = 1;
  const de = (local, tipo) => opciones.filter(o => o.local_id === local && o.tipo === tipo);
  const montoRubro = { Mochilas: 45000, "Valijas y carry on": 110000, Bolsos: 55000, Carteras: 48000, Billeteras: 22000, "Riñoneras y morrales": 28000,
    Materos: 35000, "Neceseres y organizadores": 18000, "Accesorios de viaje": 12000, "Loncheras y botellas": 16000, "Paraguas y pilotos": 11000,
    Textil: 19000, Accesorios: 14000, Deco: 21000, Otros: 15000 };
  function venta(c, cuando) {
    const n = pesado([[1, 8], [2, 2]]);
    let total = 0;
    for (let k = 0; k < n; k++) {
      const cantidad = pesado([[1, 10], [2, 2], [3, 1]]);
      if (azar() < .8) {
        const prod = pesado(CATALOGO.filter(x => x[5].includes(c.local_id)).map(x => [x, x[6]]));
        const monto = Math.round((prod[4] * (.8 + azar() * .4) * cantidad) / 500) * 500 - (azar() < .4 ? 1 : 0);
        total += monto;
        const r = resultadoCatalogo(prod);
        items.push({ id: idI++, consulta_id: c.id, catalogo: true, producto: r.nombre, producto_clave: r.clave, categoria: r.categoria, categoria_ruta: r.ruta,
          categoria_tn_id: r.categoria_id, rubro_id: null, marca_id: null, descripcion: azar() < .15 ? elegir(["negra", "rosa", "grande", "oferta"]) : "", cantidad, monto });
        continue;
      }
      const rubro = elegir(de(c.local_id, "rubro").filter(o => o.valor !== "Otros"));
      const marcas = de(c.local_id, "marca").filter(o => o.valor !== "Otra");
      const base = montoRubro[rubro.valor] || 20000;
      const monto = Math.round((base * (.6 + azar() * .9) * cantidad) / 500) * 500 - (azar() < .4 ? 1 : 0);
      total += monto;
      items.push({ id: idI++, consulta_id: c.id, catalogo: false, producto: "", producto_clave: "", categoria: "", categoria_ruta: "", categoria_tn_id: null, rubro_id: rubro.id, marca_id: elegir(marcas).id, descripcion: azar() < .2 ? elegir(["negra", "rosa", "con ruedas", "grande", "oferta"]) : "", cantidad, monto });
    }
    Object.assign(c, { estado: "compro", fecha_venta: cuando, envio_id: pesado(de(c.local_id, "envio").map((o, i) => [o.id, i === 0 ? 10 : 1.5])),
      pago_id: pesado(de(c.local_id, "pago").map(o => [o.id, { "Tarjeta de crédito": 5, QR: 3, Efectivo: 3, Transferencia: 3 }[o.valor] || 1])), monto_total: total });
  }
  const ahora = Date.now();
  for (let d = 150; d >= 0; d--) {
    for (const local of [1, 2]) {
      const fecha = new Date(ahora - d * 86400000);
      const domingo = fecha.toLocaleDateString("en-US", { timeZone: R.util.ZONA, weekday: "short" }) === "Sun";
      if (domingo) continue;
      const crecimiento = 1 + (150 - d) / 250;
      let cantidad = Math.round((local === 1 ? 4.5 : 2.6) * crecimiento * (.5 + azar()));
      for (let k = 0; k < cantidad; k++) {
        const hora = pesado([[9, 1], [10, 3], [11, 4], [12, 3], [13, 1.5], [16, 2], [17, 4], [18, 5], [19, 4], [20, 2]]);
        const base = new Date(R.util.iso(fecha) + `T${String(hora).padStart(2, "0")}:${String(Math.floor(azar() * 60)).padStart(2, "0")}:00-03:00`);
        if (base.getTime() > ahora) continue;
        const canal = pesado(de(local, "canal").map(o => [o.id, o.valor === "WhatsApp" ? 7 : 3]));
        const vs = vendedores.filter(v => v.local_id === local);
        const c = { id: idC++, local_id: local, fecha_consulta: base.toISOString(), canal_id: canal, estado: "no_compro", atendio_id: azar() < .85 ? elegir(vs).id : null,
          fecha_venta: null, envio_id: null, pago_id: null, monto_total: 0, nota: azar() < .08 ? elegir(["preguntó precio por mayor", "quería otro color", "vuelve el sábado", "pidió fotos"]) : "",
          origen: "carga", cerrada_en: null, anulada: false, anulada_motivo: "", creado_por: local === 1 ? "u-cindy" : "u-chimola", creado_en: base.toISOString() };
        const esIg = de(local, "canal").find(o => o.id === canal).valor === "Instagram";
        const r = azar();
        if (r < (esIg ? .09 : .2)) venta(c, c.fecha_consulta);
        else if (r < .45) {
          c.estado = "lo_piensa";
          // Clientes inventados (no son personas reales)
          c.cliente_nombre = `${elegir(["Cliente", "Consulta", "Persona"])} ${elegir(["Prueba", "Demo", "Ejemplo"])} ${idC}`;
          c.cliente_contacto = esIg ? `@cliente.demo${idC}` : `353 4${String(100000 + idC).slice(-6)}`;
          if (azar() < .3 && d > 2) { // volvió y compró unos días después
            const despues = new Date(base.getTime() + (1 + Math.floor(azar() * 6)) * 86400000);
            if (despues.getTime() < ahora) { venta(c, despues.toISOString()); c.cerrada_en = despues.toISOString(); }
          }
        }
        if (azar() < .01) Object.assign(c, { anulada: true, anulada_motivo: "Cargada dos veces" });
        consultas.push(c);
      }
    }
  }

  // ---------- Lectura con la forma de las vistas ----------
  const nombreOp = id => (opciones.find(o => o.id === id) || {}).valor || null;
  function vista(c) {
    const l = locales.find(x => x.id === c.local_id);
    const vencida = c.estado === "lo_piensa" && Date.parse(c.fecha_consulta) < Date.now() - l.dias_lo_piensa * 86400000;
    return { ...c, local: l.nombre, dia_consulta: R.util.iso(new Date(c.fecha_consulta)), canal: nombreOp(c.canal_id),
      estado_efectivo: vencida ? "vencida" : c.estado, atendio: (vendedores.find(v => v.id === c.atendio_id) || {}).nombre || null,
      dia_venta: c.fecha_venta ? R.util.iso(new Date(c.fecha_venta)) : null, envio: nombreOp(c.envio_id), pago: nombreOp(c.pago_id),
      unidades: items.filter(i => i.consulta_id === c.id).reduce((s, i) => s + i.cantidad, 0),
      editable_por_local: Date.parse(c.creado_en) >= Date.now() - l.horas_edicion * 3600000 };
  }
  function vistaItem(i) {
    const c = consultas.find(x => x.id === i.consulta_id);
    return { ...i, local_id: c.local_id, fecha_venta: c.fecha_venta, dia_venta: c.fecha_venta ? R.util.iso(new Date(c.fecha_venta)) : null,
      rubro: nombreOp(i.rubro_id), marca: nombreOp(i.marca_id), anulada: c.anulada,
      rubro_web: (i.categoria_ruta || "").split(" > ")[0] || null, subrubro_web: (i.categoria_ruta || "").split(" > ")[1] || null };
  }
  const puedeVer = l => rolDemo !== "carga" || asignaciones.some(a => a.usuario_id === yo && a.local_id === l);
  const espera = (v, ms = 250) => new Promise(r => setTimeout(() => r(JSON.parse(JSON.stringify(v))), ms));
  const error = m => Promise.reject(new Error(m));

  // ---------- Reglas de carga (como guardar_consulta en la base) ----------
  function controlarVenta(local, p) {
    if (!p.envio_id || !p.pago_id) throw new Error("Falta el método de envío o la forma de pago");
    if (!Array.isArray(p.items) || !p.items.length) throw new Error("Una venta necesita al menos un artículo");
    for (const it of p.items) {
      if (it.catalogo) {
        if (!String(it.producto || "").trim()) throw new Error("Falta el producto de un artículo");
        if (!String(it.categoria || "").trim()) throw new Error("Falta la categoría del producto de un artículo");
      } else if (!it.rubro_id) throw new Error("Falta el rubro de un artículo");
      if (!(it.cantidad >= 1) || it.cantidad % 1) throw new Error("La cantidad tiene que ser un número entero mayor a cero");
      if (it.monto == null || it.monto < 0) throw new Error("Falta el monto de un artículo o es negativo");
    }
  }
  function ponerItems(id, lista) {
    for (let k = items.length - 1; k >= 0; k--) if (items[k].consulta_id === id) items.splice(k, 1);
    (lista || []).forEach(it => items.push({ id: idI++, consulta_id: id, catalogo: !!it.catalogo, producto: it.catalogo ? it.producto : "", producto_clave: it.catalogo ? it.producto_clave : "", categoria: it.catalogo ? it.categoria : "",
      categoria_ruta: it.catalogo ? it.categoria_ruta : "", categoria_tn_id: it.catalogo ? (it.categoria_tn_id || null) : null, rubro_id: it.rubro_id ? Number(it.rubro_id) : null, marca_id: it.marca_id ? Number(it.marca_id) : null, descripcion: it.descripcion || "", cantidad: Number(it.cantidad), monto: Math.round(Number(it.monto) * 100) / 100 }));
    const c = consultas.find(x => x.id === id);
    c.monto_total = items.filter(i => i.consulta_id === id).reduce((s, i) => s + i.monto, 0);
  }
  const puedeCargar = l => rolDemo === "admin" || (rolDemo === "carga" && puedeVer(l));

  let sesion = /[?&]demo/.test(location.search) ? { user: { id: yo } } : null;

  R.api = {
    configurado: () => true,
    iniciar() {},
    auth: {
      async ingresar() { sesion = { user: { id: yo } }; },
      async salir() { sesion = null; },
      async sesion() { return sesion; },
      alCambiar() {},
      async miPerfil() { return espera(perfiles.find(p => p.id === yo), 150); },
    },
    // Imita a la función buscar-productos: un resultado por nombre + categoría, desde 2 letras
    productos: {
      async buscar(q, { limite = 8, senal } = {}) {
        const norm = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const buscado = norm(q);
        await new Promise((ok, mal) => {
          const t = setTimeout(ok, 220);
          if (senal) senal.addEventListener("abort", () => { clearTimeout(t); mal(new DOMException("Cancelado", "AbortError")); }, { once: true });
        });
        if (buscado.length < 2) return [];
        const palabras = buscado.split(" ");
        return CATALOGO.filter(c => palabras.every(w => norm(c[0] + " " + c[1]).includes(w)))
          .sort((a, b) => Number(norm(b[0]).startsWith(buscado)) - Number(norm(a[0]).startsWith(buscado)) || Number(b[2]) - Number(a[2]))
          .slice(0, limite).map(resultadoCatalogo);
      },
    },
    async catalogo(perfil) {
      const mis = perfil.rol === "carga" ? locales.filter(l => puedeVer(l.id)) : locales;
      return espera({ locales, misLocales: mis, opciones: [...opciones].sort((a, b) => a.orden - b.orden), vendedores }, 150);
    },
    consultas({ desde, hasta, localId }) {
      return espera(consultas.map(vista).filter(c => puedeVer(c.local_id) && (!localId || c.local_id === localId)
        && ((c.dia_consulta >= desde && c.dia_consulta <= hasta) || (c.dia_venta && c.dia_venta >= desde && c.dia_venta <= hasta)))
        .sort((a, b) => b.fecha_consulta.localeCompare(a.fecha_consulta)), 450);
    },
    items({ desde, hasta, localId }) {
      return espera(items.map(vistaItem).filter(i => !i.anulada && puedeVer(i.local_id) && (!localId || i.local_id === localId) && i.dia_venta >= desde && i.dia_venta <= hasta));
    },
    itemsDe(ids) { return espera(items.filter(i => ids.includes(i.consulta_id)).map(vistaItem), 120); },
    abiertos(localId) {
      return espera(consultas.filter(c => c.estado === "lo_piensa" && !c.anulada && puedeVer(c.local_id) && (!localId || c.local_id === localId)).map(vista)
        .sort((a, b) => a.fecha_consulta.localeCompare(b.fecha_consulta)));
    },
    recientes(localId, horas = 48) {
      const desde = Date.now() - horas * 3600000;
      return espera(consultas.filter(c => Date.parse(c.creado_en) >= desde && puedeVer(c.local_id) && (!localId || c.local_id === localId)).map(vista)
        .sort((a, b) => b.creado_en.localeCompare(a.creado_en)));
    },
    delDia(localId) {
      const d = R.util.hoy();
      return espera(consultas.map(vista).filter(c => c.local_id === localId && (c.dia_consulta === d || c.dia_venta === d)), 150);
    },
    async guardar(p) {
      await espera(null, 300);
      const actual = p.id ? consultas.find(c => c.id === p.id) : null;
      const local = actual ? actual.local_id : Number(p.local_id);
      if (!puedeCargar(local)) return error("No tenés permiso para cargar en este local");
      if (actual && actual.anulada) return error(`La consulta ${p.id} está anulada`);
      const l = locales.find(x => x.id === local);
      if (actual && rolDemo !== "admin" && Date.parse(actual.creado_en) < Date.now() - l.horas_edicion * 3600000) return error(`Pasaron más de ${l.horas_edicion} horas desde que se cargó: solo un admin la puede corregir`);
      if (!["no_compro", "lo_piensa", "compro"].includes(p.estado)) return error("Estado no válido");
      if (!actual && !p.canal_id) return error("Falta el canal");
      const fecha = p.fecha_consulta || (actual ? actual.fecha_consulta : new Date().toISOString());
      if (Date.parse(fecha) > Date.now() + 300000) return error("La fecha de la consulta no puede ser futura");
      if (rolDemo !== "admin" && (!actual || fecha !== actual.fecha_consulta) && Date.parse(fecha) < Date.now() - l.dias_carga_atrasada * 86400000) return error(`Solo se pueden cargar consultas de hasta ${l.dias_carga_atrasada} días atrás`);
      if (p.estado === "compro") { try { controlarVenta(local, p); } catch (e) { return error(e.message); } }
      if (p.estado === "lo_piensa" && !(String(p.cliente_nombre ?? (actual && actual.cliente_nombre) ?? "").trim() && String(p.cliente_contacto ?? (actual && actual.cliente_contacto) ?? "").trim()))
        return error('Para dejarla en "Lo piensa" falta el nombre completo y el teléfono o usuario del cliente');
      const c = actual || { id: idC++, local_id: local, origen: "carga", anulada: false, anulada_motivo: "", creado_por: yo, creado_en: new Date().toISOString(), cerrada_en: null };
      Object.assign(c, {
        fecha_consulta: fecha, canal_id: Number(p.canal_id || c.canal_id), estado: p.estado, atendio_id: p.atendio_id ? Number(p.atendio_id) : null,
        nota: p.nota ?? c.nota ?? "",
        cliente_nombre: (p.cliente_nombre ?? c.cliente_nombre ?? "").trim(),
        cliente_contacto: (p.cliente_contacto ?? c.cliente_contacto ?? "").trim(),
        fecha_venta: p.estado === "compro" ? (p.fecha_venta || (actual && actual.fecha_venta) || (actual && actual.estado === "lo_piensa" ? new Date().toISOString() : fecha)) : null,
        envio_id: p.estado === "compro" ? Number(p.envio_id) : null, pago_id: p.estado === "compro" ? Number(p.pago_id) : null,
      });
      if (!actual) consultas.push(c);
      ponerItems(c.id, p.estado === "compro" ? p.items : []);
      return c.id;
    },
    async cerrar(id, p) {
      await espera(null, 300);
      const c = consultas.find(x => x.id === id);
      if (!puedeCargar(c.local_id)) return error("No tenés permiso para cargar en este local");
      if (c.estado !== "lo_piensa") return error(`La consulta ${id} no está en "Lo piensa"`);
      if (p.estado === "compro") { try { controlarVenta(c.local_id, p); } catch (e) { return error(e.message); } }
      Object.assign(c, { estado: p.estado, atendio_id: p.atendio_id ? Number(p.atendio_id) : c.atendio_id, cerrada_en: new Date().toISOString(),
        fecha_venta: p.estado === "compro" ? new Date().toISOString() : null, envio_id: p.estado === "compro" ? Number(p.envio_id) : null, pago_id: p.estado === "compro" ? Number(p.pago_id) : null });
      ponerItems(id, p.estado === "compro" ? p.items : []);
      return id;
    },
    async anular(id, motivo) {
      await espera(null, 250);
      const c = consultas.find(x => x.id === id);
      if (!puedeCargar(c.local_id)) return error("No tenés permiso para cargar en este local");
      if (!String(motivo || "").trim()) return error("Para anular hay que escribir el motivo");
      Object.assign(c, { anulada: true, anulada_motivo: motivo.trim() });
    },
    admin: {
      async guardarOpcion(o) {
        await espera(null, 200);
        const dup = opciones.find(x => x.id !== o.id && x.local_id === (o.local_id || (opciones.find(y => y.id === o.id) || {}).local_id) && x.tipo === (o.tipo || (opciones.find(y => y.id === o.id) || {}).tipo) && R.util.norm(x.valor) === R.util.norm(o.valor));
        if (dup) return error("Esa opción ya existe en la lista.");
        if (o.id) return Object.assign(opciones.find(x => x.id === o.id), { valor: o.valor, orden: o.orden, activo: o.activo });
        const n = { id: idOp++, local_id: o.local_id, tipo: o.tipo, valor: o.valor, orden: o.orden || 0, activo: true };
        opciones.push(n); return n;
      },
      async guardarVendedor(v) {
        await espera(null, 200);
        if (v.id) return Object.assign(vendedores.find(x => x.id === v.id), { nombre: v.nombre, activo: v.activo });
        const n = { id: idVend++, local_id: v.local_id, nombre: v.nombre, activo: true };
        vendedores.push(n); return n;
      },
      async guardarLocal(l) { await espera(null, 200); return Object.assign(locales.find(x => x.id === l.id), l); },
      async perfiles() { return espera(perfiles.map(p => ({ ...p, locales: asignaciones.filter(a => a.usuario_id === p.id).map(a => a.local_id) }))); },
      // Como la Edge Function admin-usuarios
      async crearUsuario(d) {
        await espera(null, 400);
        const email = d.usuario.includes("@") ? d.usuario : `${d.usuario}@minorista.cindymayorista.com.ar`;
        if (perfiles.some(p => p.email === email)) return error("Ya existe un usuario con ese nombre de usuario o email");
        if (String(d.password || "").length < 8) return error("La contraseña tiene que tener al menos 8 caracteres");
        if (d.rol === "carga" && !(d.locales || []).length) return error("Un usuario de local tiene que tener al menos un local");
        const id = "u-" + Date.now();
        perfiles.push({ id, email, nombre: d.nombre, rol: d.rol, activo: true, creado_en: new Date().toISOString() });
        if (d.rol === "carga") d.locales.forEach(local_id => asignaciones.push({ usuario_id: id, local_id }));
        return { ok: true, id, email };
      },
      async habilitarUsuario(id, activo) {
        await espera(null, 200);
        if (!activo && id === yo) return error("No podés desactivar tu propia cuenta");
        Object.assign(perfiles.find(p => p.id === id), { activo });
        return { ok: true };
      },
      async cambiarPassword(id, password) { await espera(null, 200); if (String(password).length < 8) return error("La contraseña tiene que tener al menos 8 caracteres"); return { ok: true }; },
      async ingresos() { return espera({ "u-admin": new Date().toISOString(), "u-cindy": new Date(Date.now() - 3600000).toISOString() }, 100); },
      async actualizarPerfil(id, cambios) {
        await espera(null, 200);
        const p = perfiles.find(x => x.id === id);
        if (p.rol === "admin" && (cambios.rol !== "admin" || !cambios.activo) && !perfiles.some(x => x.id !== id && x.rol === "admin" && x.activo)) return error("No se puede quitar el último admin activo.");
        return Object.assign(p, cambios);
      },
      async asignarLocal(usuarioId, localId, asignar) {
        await espera(null, 150);
        const k = asignaciones.findIndex(a => a.usuario_id === usuarioId && a.local_id === localId);
        if (asignar && k < 0) asignaciones.push({ usuario_id: usuarioId, local_id: localId });
        if (!asignar && k >= 0) asignaciones.splice(k, 1);
      },
    },
  };
  console.info(`[demo] ${consultas.length} consultas inventadas, rol: ${rolDemo}`);
})(window.CMC);
