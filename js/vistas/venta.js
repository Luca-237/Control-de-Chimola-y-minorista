// =====================================================================
//  Formulario de venta (artículos, envío y pago) y diálogo para corregir
//  una consulta. Lo usan: Cargar, Lo piensan, Recientes y Planilla.
// =====================================================================
(function (R) {
  const { $, esc, fmtPesos, leerMonto, ICONOS, iconoCanal } = R.util;

  // Opciones activas de un tipo para un local (más la elegida aunque esté desactivada)
  function opcionesDe(localId, tipo, incluir) {
    return R.estado.catalogo.opciones.filter(o => o.local_id === localId && o.tipo === tipo && (o.activo || o.id === incluir));
  }
  const pastillas = (lista, elegida, attr) => `<div class="pastillas" role="group">${lista.map(o =>
    `<button type="button" class="pastilla" data-${attr}="${o.id}" aria-pressed="${o.id === elegida}">${esc(o.valor)}</button>`).join("")}</div>`;

  // Marca las pastillas de un grupo al hacer clic (una sola elegida)
  function grupoUnico(cont, attr, alCambiar) {
    cont.addEventListener("click", e => {
      const b = e.target.closest(`[data-${attr}]`);
      if (!b || !cont.contains(b)) return;
      const grupo = b.closest(".pastillas, .opciones-grandes");
      grupo.querySelectorAll(`[data-${attr}]`).forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      grupo.closest(".campo-error")?.classList.remove("campo-error");
      if (alCambiar) alCambiar(Number(b.dataset[attr.replace(/-./g, m => m[1].toUpperCase())]), b);
    });
  }
  const elegido = (cont, attr) => {
    const b = cont.querySelector(`[data-${attr}][aria-pressed="true"]`);
    return b ? Number(b.getAttribute(`data-${attr}`)) : null;
  };

  // ---------- Formulario de venta ----------
  // venta: { items: [...], envio_id, pago_id }. Cada artículo es de uno de dos tipos (it.modo):
  //   "catalogo" -> producto elegido en el buscador: { producto, producto_clave, categoria, categoria_ruta, categoria_tn_id }
  //   "libre"    -> "tal como está", fuera del catálogo: el nombre escrito (en descripcion); rubro y marca opcionales
  //   null       -> todavía sin elegir
  // y además { descripcion, cantidad, monto }.
  function crear(cont, localId, venta = {}) {
    venta = { ...venta };
    const marcas = () => opcionesDe(localId, "marca");
    const modoDe = i => (i.modo !== undefined ? i.modo : i.catalogo ? "catalogo" : i.rubro_id ? "libre" : null);
    let items = (venta.items && venta.items.length ? venta.items : [{ cantidad: 1 }]).map(i => ({ ...i, modo: modoDe(i) }));

    function htmlArticulo(it, i) {
      const libre = it.modo === "libre";
      const ms = opcionesDe(localId, "marca", it.marca_id);
      const unaMarca = ms.length === 1;
      if (libre && unaMarca && !it.marca_id) it.marca_id = ms[0].id;
      const marca = libre && !unaMarca ? `<div class="campo" data-campo="marca"><label>Marca (opcional)</label>
            <select data-marca><option value="">Elegir…</option>${ms.map(m => `<option value="${m.id}" ${m.id === it.marca_id ? "selected" : ""}>${esc(m.valor)}</option>`).join("")}</select></div>` : "";
      return `<div class="articulo" data-i="${i}">
        <div class="articulo-cab"><span>Artículo ${i + 1}</span>${items.length > 1 ? `<button type="button" class="btn-quitar" data-quitar="${i}" title="Quitar este artículo" aria-label="Quitar este artículo">${ICONOS.basura}</button>` : ""}</div>
        <div class="campo" data-campo="producto"><label>Producto</label><div data-buscador></div></div>

        <div class="articulo-fila">
          <div>${marca}${libre
            ? `<div class="campo" data-campo="nombre-libre"><label>Nombre del producto</label>
            <input type="text" data-desc maxlength="120" placeholder="Ej. Mochila escolar azul con ruedas" value="${esc(it.descripcion || "")}"></div>`
            : `<label>Detalle (opcional)</label>
            <input type="text" data-desc maxlength="120" placeholder="Ej. color, modelo" value="${esc(it.descripcion || "")}">`}</div>
          <div><label>Cantidad</label><div class="cantidad"><button type="button" data-menos aria-label="Una menos">−</button>
            <input type="number" inputmode="numeric" min="1" step="1" data-cant value="${it.cantidad || 1}" aria-label="Cantidad"><button type="button" data-mas aria-label="Una más">+</button></div></div>
          <div class="campo" data-campo="monto"><label>Monto total del artículo</label><div class="monto-wrap"><input type="text" inputmode="decimal" data-monto placeholder="0" value="${it.monto != null ? esc(R.util.fmtNum(it.monto, 2)) : ""}" aria-label="Monto"></div></div>
        </div></div>`;
    }

    // Vuelve a dibujar y deja el foco donde sigue el trabajo
    function redibujar(i, foco) {
      leerPantalla();
      dibujar();
      const a = cont.querySelector(`.articulo[data-i="${i}"]`);
      const el = a && a.querySelector(foco);
      if (el) el.focus();
    }

    function dibujar() {
      cont.innerHTML = `<div data-articulos>${items.map(htmlArticulo).join("")}</div>
        <button type="button" class="btn-agregar" data-agregar>${ICONOS.mas}Agregar otro artículo</button>
        <div class="campo" data-campo="envio" style="margin-top:18px"><label>Envío o entrega</label>${pastillas(opcionesDe(localId, "envio", venta.envio_id), venta.envio_id, "envio")}</div>
        <div class="campo" data-campo="pago"><label>Forma de pago</label>${pastillas(opcionesDe(localId, "pago", venta.pago_id), venta.pago_id, "pago")}</div>
        <div class="total-venta"><span>Total de la venta</span><strong data-total>${fmtPesos(0)}</strong></div>`;
      // El buscador de cada artículo; lo elegido queda guardado en el propio artículo (it)
      buscadores = [];
      cont.querySelectorAll(".articulo").forEach(a => {
        const i = Number(a.dataset.i), it = items[i];
        buscadores[i] = R.buscadorProducto.crear(a.querySelector("[data-buscador]"), {
          inicial: it,
          alElegir: () => { it.rubro_id = null; it.marca_id = null; redibujar(i, "[data-cant]"); },
          // Lo que se había escrito en el buscador queda como nombre del producto
          // (se lee la pantalla antes, si no el campo vacío de "Detalle" pisaría el nombre)
          alLibre: texto => {
            leerPantalla();
            if (texto && !it.descripcion) it.descripcion = texto;
            dibujar();
            cont.querySelector(`.articulo[data-i="${i}"] ${it.descripcion ? "[data-cant]" : "[data-desc]"}`)?.focus();
          },
          alCambiar: () => redibujar(i, ".bp-input"),
        });
      });
      pintarTotal();
    }

    // Lo escrito en pantalla -> items
    function leerPantalla() {
      cont.querySelectorAll(".articulo").forEach(a => {
        const it = items[Number(a.dataset.i)];
        const rb = a.querySelector('[data-rubro][aria-pressed="true"]');
        if (it.modo === "libre" && a.querySelector("[data-rubro]")) it.rubro_id = rb ? Number(rb.dataset.rubro) : null;   // si no hay pastillas de rubro, se conserva el que tuviera
        const ms = a.querySelector("[data-marca]");
        if (ms) it.marca_id = ms.value ? Number(ms.value) : null;
        it.descripcion = a.querySelector("[data-desc]").value.trim();
        it.cantidad = Number(a.querySelector("[data-cant]").value);
        it.monto = leerMonto(a.querySelector("[data-monto]").value);
      });
      // El envío y el pago elegidos sobreviven a los redibujos (elegir un producto, agregar o quitar un artículo)
      if (cont.querySelector('[data-campo="envio"]')) { venta.envio_id = elegido(cont, "envio"); venta.pago_id = elegido(cont, "pago"); }
    }
    function pintarTotal() {
      leerPantalla();
      const t = items.reduce((s, i) => s + (i.monto || 0), 0);
      const el = cont.querySelector("[data-total]");
      if (el) el.textContent = fmtPesos(t, t % 1 ? 2 : 0);
    }

    cont.addEventListener("click", e => {
      if (e.target.closest("[data-agregar]")) { leerPantalla(); items.push({ cantidad: 1, modo: null }); dibujar(); cont.querySelector(".articulo:last-child .bp-input")?.focus(); return; }
      const q = e.target.closest("[data-quitar]");
      if (q) { leerPantalla(); items.splice(Number(q.dataset.quitar), 1); dibujar(); return; }
      const mm = e.target.closest("[data-menos], [data-mas]");
      if (mm) {
        const input = mm.parentElement.querySelector("[data-cant]");
        input.value = Math.max(1, (Number(input.value) || 1) + (mm.hasAttribute("data-mas") ? 1 : -1));
        return;
      }
    });
    grupoUnico(cont, "rubro");
    grupoUnico(cont, "envio");
    grupoUnico(cont, "pago");
    cont.addEventListener("input", e => {
      if (e.target.matches("[data-monto]")) { pintarTotal(); e.target.closest(".campo-error")?.classList.remove("campo-error"); }
      if (e.target.matches("[data-desc]")) e.target.closest(".campo-error")?.classList.remove("campo-error");
    });
    cont.addEventListener("change", e => {
      if (e.target.matches("[data-marca]")) e.target.closest(".campo-error")?.classList.remove("campo-error");
    });
    // Al salir del monto se muestra con separador de miles
    cont.addEventListener("focusout", e => {
      if (!e.target.matches("[data-monto]")) return;
      const n = leerMonto(e.target.value);
      if (n != null) e.target.value = R.util.fmtNum(n, 2);
    });

    // ---------- Pistola de código de barras ----------
    // Un código leído va al artículo donde estaba el cursor (si todavía no tiene producto), o al primero vacío,
    // o a uno nuevo. Si el producto ya estaba cargado, suma una unidad.
    let buscadores = [];
    const vacio = k => !items[k].modo && !(cont.querySelector(`.articulo[data-i="${k}"] .bp-input`)?.value || "").trim();
    function destino(el) {
      const a = el && el.closest ? el.closest(".articulo") : null;
      if (a && el.matches(".bp-input") && !items[Number(a.dataset.i)].modo) return Number(a.dataset.i);
      const k = items.findIndex((_, n) => vacio(n));
      if (k >= 0) return k;
      items.push({ cantidad: 1, modo: null });
      return items.length - 1;
    }
    // Ya se leyó la pantalla antes de cambiar el artículo: se dibuja sin volver a leerla (si no, pisaría la cantidad)
    const mostrarEn = k => { dibujar(); cont.querySelector(`.articulo[data-i="${k}"] [data-monto]`)?.focus(); };
    async function alLeerCodigo(codigo, el) {
      if (!codigo || !cont.querySelector(".articulo")) return;
      let r;
      try { r = await R.api.productos.porCodigo(codigo); }
      catch (e) { R.util.toast("No se pudo buscar el código: " + e.message, "error", 6000); return; }
      leerPantalla();
      if (r.length === 1) {
        const p = r[0];
        const ya = items.findIndex(it => it.modo === "catalogo" && it.producto_clave === p.clave);
        if (ya >= 0) {
          items[ya].cantidad = (Number(items[ya].cantidad) || 1) + 1;
          mostrarEn(ya);
          R.util.toast(`Otra unidad de ${p.nombre}: ya son ${items[ya].cantidad}. Revisá el monto.`);
          return;
        }
        const k = destino(el);
        Object.assign(items[k], { modo: "catalogo", producto: p.nombre, producto_clave: p.clave, categoria: p.categoria,
          categoria_ruta: p.ruta, categoria_tn_id: p.categoria_id, rubro_id: null, marca_id: null, cantidad: items[k].cantidad || 1 });
        mostrarEn(k);
        return;
      }
      // Ninguno o varios: queda el código en el buscador para elegir, o para cargarlo tal como está
      const k = destino(el);
      dibujar();
      buscadores[k]?.mostrar(codigo, r, r.length ? "" : `No hay ningún producto con el código ${codigo} en Odoo.`);
    }
    if (R.lectorCodigos) R.lectorCodigos.registrar(cont, alLeerCodigo);

    dibujar();

    return {
      // Devuelve { ok, datos } o { ok: false, error } marcando lo que falta
      leer() {
        leerPantalla();
        cont.querySelectorAll(".campo-error").forEach(x => x.classList.remove("campo-error"));
        const faltan = [];
        const marcar = (el, texto) => { el.classList.add("campo-error"); faltan.push(texto); };
        const escritos = {};
        cont.querySelectorAll(".articulo").forEach(a => {
          const it = items[Number(a.dataset.i)], n = Number(a.dataset.i) + 1;
          // Producto no elegido en el buscador: no frena. Se guarda tal como se escribió (o sin nombre),
          // fuera del catálogo, y en las estadísticas cuenta como "Otros".
          // (no se toca el artículo en pantalla: si falta otra cosa, se sigue pudiendo elegir del buscador)
          if (!it.modo) escritos[n - 1] = (a.querySelector(".bp-input")?.value || "").replace(/\s+/g, " ").trim();
          if (!(it.cantidad >= 1) || it.cantidad % 1) faltan.push(`una cantidad válida en el artículo ${n}`);
          if (it.monto == null || it.monto < 0) marcar(a.querySelector('[data-campo="monto"]'), `el monto del artículo ${n}`);
        });
        const envio_id = elegido(cont, "envio"), pago_id = elegido(cont, "pago");
        if (!envio_id) marcar(cont.querySelector('[data-campo="envio"]'), "el envío");
        if (!pago_id) marcar(cont.querySelector('[data-campo="pago"]'), "la forma de pago");
        if (faltan.length) {
          cont.querySelector(".campo-error")?.scrollIntoView({ behavior: "smooth", block: "center" });
          return { ok: false, error: "Falta " + faltan.slice(0, 3).join(", ") + (faltan.length > 3 ? " y más." : ".") };
        }
        return { ok: true, datos: { envio_id, pago_id, items: items.map((i, n) => i.modo === "catalogo"
          ? { catalogo: true, producto: i.producto, producto_clave: i.producto_clave, categoria: i.categoria, categoria_ruta: i.categoria_ruta,
              categoria_tn_id: i.categoria_tn_id || null, rubro_id: null, marca_id: null, descripcion: i.descripcion || "", cantidad: i.cantidad, monto: i.monto }
          : i.modo === "libre"
            ? { catalogo: false, rubro_id: i.rubro_id, marca_id: i.marca_id || null, descripcion: i.descripcion || "", cantidad: i.cantidad, monto: i.monto }
            // Sin elegir: lo escrito en el buscador es el nombre; lo de "Detalle" se suma
            : { catalogo: false, rubro_id: null, marca_id: null, descripcion: [escritos[n], i.descripcion].filter(Boolean).join(" · ").slice(0, 120), cantidad: i.cantidad, monto: i.monto }) } };
      },
    };
  }

  // ---------- Diálogo: corregir una consulta ----------
  async function editar(c, { alGuardar } = {}) {
    const d = $("dlg-editar"), cuerpo = $("editar-cuerpo");
    $("editar-titulo").textContent = `Consulta del ${R.util.fechaHora(c.fecha_consulta)}`;
    cuerpo.innerHTML = R.util.esqueleto.grafico(220);
    d.showModal();
    let items = [];
    try { if (c.estado === "compro") items = await R.api.itemsDe([c.id]); }
    catch (e) { cuerpo.innerHTML = `<div class="mensaje-error">${esc(e.message)}</div>`; return; }

    const local = c.local_id;
    const vendedores = R.estado.catalogo.vendedores.filter(v => v.local_id === local && (v.activo || v.id === c.atendio_id));
    let estado = c.estado;
    cuerpo.innerHTML = `
      <div class="form-grid">
        <div><label>Fecha y hora</label><input type="datetime-local" id="ed-fecha" value="${R.util.aInputFechaHora(c.fecha_consulta)}"></div>
        <div><label>Atendió</label><select id="ed-atendio"><option value="">Sin indicar</option>${vendedores.map(v => `<option value="${v.id}" ${v.id === c.atendio_id ? "selected" : ""}>${esc(v.nombre)}</option>`).join("")}</select></div>
      </div>
      <label>Canal</label>${pastillas(opcionesDe(local, "canal", c.canal_id), c.canal_id, "canal")}
      <label>Cómo terminó</label>
      <div class="pastillas" id="ed-estados">${[["compro", "Compró"], ["lo_piensa", "Lo piensa"], ["no_compro", "No compró"]].map(([k, t]) =>
        `<button type="button" class="pastilla" data-estado="${k}" aria-pressed="${k === estado}">${t}</button>`).join("")}</div>
      <div id="ed-venta" style="margin-top:14px" ${estado === "compro" ? "" : "hidden"}></div>
      <div class="form-grid">
        <div><label for="ed-cliente-nombre">Cliente: nombre (opcional)</label>
          <input type="text" id="ed-cliente-nombre" maxlength="120" autocapitalize="words" value="${esc(c.cliente_nombre || "")}"></div>
        <div><label for="ed-cliente-contacto" id="ed-cliente-contacto-label">Usuario o nro. telefónico</label>
          <input type="text" id="ed-cliente-contacto" maxlength="80" value="${esc(c.cliente_contacto || "")}"></div>
      </div>
      <label>Nota</label><input type="text" id="ed-nota" maxlength="300" value="${esc(c.nota || "")}">
      <div class="mensaje-error" id="ed-error" role="alert"></div>
      <div class="dlg-pie"><button type="button" class="link peligro" id="ed-anular" style="margin-right:auto">Anular esta consulta</button><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="button" class="btn-sec primario" id="ed-guardar">Guardar cambios</button></div>`;
    const pintarContacto = () => prepararContacto($("ed-cliente-contacto"), $("ed-cliente-contacto-label"), nombreCanal(elegido(cuerpo, "canal")));
    grupoUnico(cuerpo, "canal", pintarContacto);
    pintarContacto();
    const venta = crear($("ed-venta"), local, { items, envio_id: c.envio_id, pago_id: c.pago_id });
    $("ed-estados").addEventListener("click", e => {
      const b = e.target.closest("[data-estado]");
      if (!b) return;
      estado = b.dataset.estado;
      $("ed-estados").querySelectorAll("[data-estado]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      $("ed-venta").hidden = estado !== "compro";
    });
    $("ed-anular").addEventListener("click", () => { d.close(); anular(c, { alAnular: alGuardar }); });
    $("ed-guardar").addEventListener("click", async () => {
      $("ed-error").textContent = "";
      const p = {
        id: c.id, estado, canal_id: elegido(cuerpo, "canal"),
        fecha_consulta: R.util.deInputFechaHora($("ed-fecha").value),
        atendio_id: $("ed-atendio").value ? Number($("ed-atendio").value) : null,
        nota: $("ed-nota").value.trim(),
      };
      // Cliente: todo opcional, en cualquier resultado
      const cl = validarCliente($("ed-cliente-nombre").value, $("ed-cliente-contacto").value);
      p.cliente_nombre = cl.nombre; p.cliente_contacto = cl.contacto;
      if (estado === "compro") {
        const r = venta.leer();
        if (!r.ok) { $("ed-error").textContent = r.error; return; }
        Object.assign(p, r.datos);
      }
      $("ed-guardar").disabled = true;
      try {
        await R.api.guardar(p);
        d.close();
        R.util.toast("Cambios guardados.");
        if (alGuardar) alGuardar();
      } catch (e) { $("ed-error").textContent = e.message; }
      finally { $("ed-guardar").disabled = false; }
    });
  }

  // Anular con motivo (diálogo propio)
  async function anular(c, { alAnular } = {}) {
    // Sin motivo: un toque para confirmar y listo (la base guarda "Sin motivo")
    const ok = await R.util.pedir({ titulo: "¿Anular esta consulta?", texto: "Deja de contar en el tablero. Queda en la planilla como anulada.", boton: "Sí, anular", peligro: true });
    if (ok == null) return;
    try { await R.api.anular(c.id, ""); R.util.toast("Consulta anulada."); if (alAnular) alAnular(); }
    catch (e) { R.util.toast(e.message, "error", 6000); }
  }

  // ---------- Datos del cliente (en "Lo piensa" alcanza con uno: nombre, teléfono o usuario) ----------
  // Una sola casilla que acepta las dos cosas, en cualquier canal: usuario de Instagram o número de teléfono.
  // Solo cambia el ejemplo, según por dónde consultó.
  function campoContacto(canal) {
    const placeholder = /whats/i.test(canal || "") ? "Ej. 353 4123456 o @usuario" : "Ej. @usuario o 353 4123456";
    return { label: "Usuario o nro. telefónico", placeholder, modo: "text" };
  }
  // ¿Lo escrito es un teléfono? Solo números, espacios, guiones, paréntesis, puntos o un + adelante
  const pareceTelefono = s => /^\+?[\d\s().-]+$/.test(s) && /\d/.test(s);
  // Todos los datos del cliente son opcionales y nunca frenan la carga: devuelve siempre { ok: true, nombre, contacto }.
  // Solo se ordena lo escrito: un teléfono queda con espacios simples y un usuario de Instagram válido queda como @usuario;
  // cualquier otra cosa se guarda tal cual.
  function validarCliente(nombre, contacto) {
    nombre = String(nombre || "").replace(/\s+/g, " ").trim().slice(0, 120);
    contacto = String(contacto || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!contacto || pareceTelefono(contacto)) return { ok: true, nombre, contacto };
    const u = contacto.replace(/^@+/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "");
    return { ok: true, nombre, contacto: /^[a-z0-9._]{2,30}$/i.test(u) ? "@" + u.toLowerCase() : contacto };
  }
  // Enlace para escribirle (WhatsApp o Instagram), o null
  function enlaceContacto(contacto) {
    const s = String(contacto || "").trim();
    if (!s) return null;
    if (s.startsWith("@")) return { url: "https://instagram.com/" + encodeURIComponent(s.slice(1)), texto: "Abrir Instagram" };
    let d = s.replace(/\D/g, "").replace(/^0+/, "");
    if (d.length === 10) d = "549" + d;                       // característica sin 0 + número sin 15
    else if (d.startsWith("54") && !d.startsWith("549") && d.length === 12) d = "549" + d.slice(2);
    if (!/^549\d{10}$/.test(d)) return null;
    return { url: "https://wa.me/" + d, texto: "Escribir por WhatsApp" };
  }
  // Pinta la etiqueta y el teclado del campo de contacto según el canal elegido
  function prepararContacto(input, label, canal) {
    const c = campoContacto(canal);
    label.textContent = c.label;
    input.placeholder = c.placeholder;
    input.inputMode = c.modo;
    input.autocapitalize = "off";
  }
  const nombreCanal = id => (R.estado.catalogo.opciones.find(o => o.id === id) || {}).valor || "";

  // Resumen de una consulta para tarjetas y planilla
  function textoArticulos(its) {
    return its.map(i => i.producto
      ? `${i.producto}${i.descripcion ? " (" + i.descripcion + ")" : ""} x${i.cantidad}`
      : i.catalogo === false && i.descripcion
        ? `${i.descripcion} (${[i.rubro, i.marca, "fuera del catálogo"].filter(Boolean).join(", ")}) x${i.cantidad}`
        : `${i.rubro || (i.catalogo === false ? "Otros" : "Sin rubro")}${i.marca ? " " + i.marca : ""}${i.descripcion ? " (" + i.descripcion + ")" : ""} x${i.cantidad}`).join(" · ");
  }

  R.venta = { opcionesDe, pastillas, grupoUnico, elegido, crear, editar, anular, textoArticulos, iconoCanal,
    campoContacto, validarCliente, enlaceContacto, prepararContacto, nombreCanal };
})(window.CMC);
