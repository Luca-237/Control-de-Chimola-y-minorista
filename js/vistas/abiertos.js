// =====================================================================
//  Vistas: "Lo piensan" (consultas abiertas para cerrar cuando el
//  cliente vuelve) y "Recientes" (lo cargado que todavía se corrige).
// =====================================================================
(function (R) {
  const { $, esc, iconoCanal, hace, fmtPesos, chipEstado, plural } = R.util;
  const V = R.venta;
  const puedeCargar = () => R.app.puedeCargar();
  const localId = () => (R.estado.local ? R.estado.local.id : null);
  const nombreLocal = c => (R.estado.local ? "" : ` · ${esc(c.local)}`);
  // Contacto del cliente con un enlace para escribirle (WhatsApp o Instagram)
  function cliente(c) {
    if (!c.cliente_contacto) return "";
    const e = V.enlaceContacto(c.cliente_contacto);
    return `<div class="cliente-contacto"><span>${esc(c.cliente_contacto)}</span>`
      + (e ? `<a class="btn-sec" href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.texto)}</a>` : "") + `</div>`;
  }

  // ---------- Lo piensan ----------
  async function mostrarAbiertos() {
    const cont = $("abiertos-lista");
    cont.innerHTML = R.util.esqueleto.tarjetas(3);
    $("abiertos-vencidas").innerHTML = "";
    let filas;
    try { filas = await R.api.abiertos(localId()); }
    catch (e) { cont.innerHTML = `<div class="mensaje-error">${esc(e.message)}</div>`; return; }
    const abiertas = filas.filter(c => c.estado_efectivo === "lo_piensa");
    const vencidas = filas.filter(c => c.estado_efectivo === "vencida").reverse();
    $("abiertos-resumen").textContent = abiertas.length
      ? `${plural(abiertas.length, "consulta espera", "consultas esperan")} respuesta. Si el cliente vuelve y compra, tocá "Compró".`
      : "No hay consultas esperando respuesta.";
    const locales = R.estado.catalogo.locales;
    const tarjeta = c => {
      const dias = (locales.find(l => l.id === c.local_id) || {}).dias_lo_piensa || 15;
      const pasaron = Math.floor((Date.now() - Date.parse(c.fecha_consulta)) / 86400000);
      const quedan = dias - pasaron;
      const atrasada = R.avisos.esAtrasada(c);
      return `<article class="tarjeta-consulta ${c.estado_efectivo}${atrasada ? " atrasada" : ""}" data-id="${c.id}">
        <div class="cab"><span class="cuando">${esc(c.cliente_nombre || c.cliente_contacto || "Sin datos del cliente")}</span>${chipEstado(c.estado_efectivo)}</div>
        ${atrasada ? `<div class="aviso-atrasada">Más de ${R.avisos.HORAS_AVISO} horas sin respuesta</div>` : ""}
        ${cliente(c)}
        <div class="detalle">Consultó ${esc(hace(c.fecha_consulta))}</div>
        <div class="detalle">${esc(c.canal)}${c.atendio ? " · atendió " + esc(c.atendio) : ""}${nombreLocal(c)}${c.nota ? `<br><strong>${esc(c.nota)}</strong>` : ""}</div>
        <div class="detalle">${quedan > 0 ? `Vence en ${plural(quedan, "día", "días")}` : "Ya cuenta como no compró, pero se puede cerrar igual"}</div>
        ${puedeCargar() ? `<div class="acciones"><button type="button" class="btn-sec primario" data-cerrar-compro>Compró</button><button type="button" class="btn-sec" data-cerrar-no>No compró</button></div>` : ""}
      </article>`;
    };
    cont.innerHTML = abiertas.length ? `<div class="tarjetas">${abiertas.map(tarjeta).join("")}</div>` : "";
    $("abiertos-vencidas").innerHTML = vencidas.length
      ? `<h2>Vencidas (${vencidas.length})</h2><div class="tarjetas">${vencidas.slice(0, 60).map(tarjeta).join("")}</div>` : "";
    const todas = [...abiertas, ...vencidas];
    document.querySelectorAll("#vista-abiertos [data-id]").forEach(t => {
      const c = todas.find(x => x.id === Number(t.dataset.id));
      t.querySelector("[data-cerrar-compro]")?.addEventListener("click", () => cerrarCompro(c));
      t.querySelector("[data-cerrar-no]")?.addEventListener("click", () => cerrarNo(c));
    });
    // Llegando desde la campanita: mostrar esa tarjeta y marcarla un momento
    const resaltar = R.estado.resaltar;
    R.estado.resaltar = null;
    const elegida = resaltar && document.querySelector(`#vista-abiertos [data-id="${Number(resaltar)}"]`);
    if (elegida) {
      elegida.scrollIntoView({ behavior: "smooth", block: "center" });
      elegida.classList.add("resaltada");
      setTimeout(() => elegida.classList.remove("resaltada"), 2400);
    }
    R.avisos.pintar(filas); // la lista recién leída también pone al día la campanita
  }

  async function cerrarNo(c) {
    try { await R.api.cerrar(c.id, { estado: "no_compro" }); R.util.toast("Cerrada como no compró."); mostrarAbiertos(); R.app.contadores(); }
    catch (e) { R.util.toast(e.message, "error", 6000); }
  }

  function cerrarCompro(c) {
    const d = $("dlg-cerrar");
    $("cerrar-sub").textContent = `${c.cliente_nombre ? c.cliente_nombre + ", c" : "C"}onsulta de ${hace(c.fecha_consulta)} por ${c.canal}. La venta queda con la fecha de hoy.`;
    $("cerrar-error").textContent = "";
    const form = V.crear($("cerrar-venta"), c.local_id);
    const vendedores = R.estado.catalogo.vendedores.filter(v => v.local_id === c.local_id && v.activo);
    $("cerrar-atendio").innerHTML = `<option value="">Sin cambiar</option>` + vendedores.map(v => `<option value="${v.id}">${esc(v.nombre)}</option>`).join("");
    $("cerrar-atendio-wrap").hidden = !vendedores.length;
    $("cerrar-guardar").onclick = async () => {
      $("cerrar-error").textContent = "";
      const r = form.leer();
      if (!r.ok) { $("cerrar-error").textContent = r.error; return; }
      $("cerrar-guardar").disabled = true;
      try {
        await R.api.cerrar(c.id, { estado: "compro", atendio_id: $("cerrar-atendio").value || null, ...r.datos });
        d.close();
        R.util.toast("Venta guardada.");
        mostrarAbiertos();
        R.app.contadores();
      } catch (e) { $("cerrar-error").textContent = e.message; }
      finally { $("cerrar-guardar").disabled = false; }
    };
    d.showModal();
  }

  // ---------- Recientes ----------
  async function mostrarRecientes() {
    const cont = $("recientes-lista");
    cont.innerHTML = R.util.esqueleto.tarjetas(4);
    const horas = R.estado.local ? R.estado.local.horas_edicion : 48;
    $("recientes-sub").textContent = `Lo cargado en las últimas ${horas} horas: hasta entonces se puede corregir o anular.`;
    let filas, items = [];
    try {
      filas = await R.api.recientes(localId(), horas);
      items = await R.api.itemsDe(filas.filter(c => c.estado === "compro").map(c => c.id));
    } catch (e) { cont.innerHTML = `<div class="mensaje-error">${esc(e.message)}</div>`; return; }
    if (!filas.length) { cont.innerHTML = `<p class="vacio">No hay nada cargado en las últimas ${horas} horas.</p>`; return; }
    cont.innerHTML = `<div class="tarjetas">${filas.map(c => {
      const its = items.filter(i => i.consulta_id === c.id);
      const estado = c.anulada ? "anulada" : c.estado_efectivo;
      const editable = !c.anulada && (R.app.esAdmin() || c.editable_por_local) && puedeCargar();
      return `<article class="tarjeta-consulta ${c.anulada ? "anulada" : ""}" data-id="${c.id}">
        <div class="cab"><span class="cuando">${esc(hace(c.fecha_consulta))}</span>${chipEstado(estado)}</div>
        <div class="detalle">${esc(c.canal)}${c.atendio ? " · atendió " + esc(c.atendio) : ""}${nombreLocal(c)}</div>
        ${c.cliente_nombre || c.cliente_contacto ? `<div class="detalle"><strong>${esc([c.cliente_nombre, c.cliente_contacto].filter(Boolean).join(" · "))}</strong></div>` : ""}
        ${c.estado === "compro" ? `<div class="detalle"><strong>${fmtPesos(c.monto_total)}</strong> · ${esc(V.textoArticulos(its))}<br>${esc(c.envio || "")}${c.pago ? " · " + esc(c.pago) : ""}</div>` : ""}
        ${c.nota ? `<div class="detalle">${esc(c.nota)}</div>` : ""}
        ${c.anulada ? `<div class="detalle">Anulada: ${esc(c.anulada_motivo)}</div>` : ""}
        ${editable ? `<div class="acciones"><button type="button" class="btn-sec" data-editar>Corregir</button><button type="button" class="btn-sec" data-anular>Anular</button></div>` : ""}
      </article>`;
    }).join("")}</div>`;
    cont.querySelectorAll("[data-id]").forEach(t => {
      const c = filas.find(x => x.id === Number(t.dataset.id));
      t.querySelector("[data-editar]")?.addEventListener("click", () => V.editar(c, { alGuardar: mostrarRecientes }));
      t.querySelector("[data-anular]")?.addEventListener("click", () => V.anular(c, { alAnular: () => { mostrarRecientes(); R.app.contadores(); } }));
    });
  }

  R.vistaAbiertos = { iniciar() {}, mostrar: mostrarAbiertos };
  R.vistaRecientes = { iniciar() {}, mostrar: mostrarRecientes };
})(window.CMC);
