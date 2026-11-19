// =====================================================================
//  Vista: Cargar. La pantalla del local: canal, cómo terminó y, si
//  compró, qué se llevó. Una consulta que no compró son 2 toques.
// =====================================================================
(function (R) {
  const { $, esc, ICONOS, iconoCanal, fmtNum, fmtPesos, plural, pref } = R.util;
  const V = R.venta;
  let canal = null, venta = null, guardando = false;

  const local = () => R.estado.local;

  async function contador() {
    const l = local();
    if (!l) return;
    try {
      const filas = (await R.api.delDia(l.id)).filter(c => !c.anulada);
      const d = R.util.hoy();
      const consultas = filas.filter(c => c.dia_consulta === d).length;
      const ventas = filas.filter(c => c.estado === "compro" && c.dia_venta === d);
      const total = ventas.reduce((s, c) => s + c.monto_total, 0);
      $("cargar-contador").innerHTML = `<span><strong>${fmtNum(consultas)}</strong>consultas hoy</span>`
        + `<span><strong>${fmtNum(ventas.length)}</strong>${ventas.length === 1 ? "venta" : "ventas"}</span>`
        + `<span><strong>${fmtPesos(total)}</strong>vendido hoy</span>`;
    } catch (e) { $("cargar-contador").textContent = e.message; }
  }

  // ---------- Historial rápido de ventas (a la derecha) ----------
  // Las últimas ventas del local de los últimos 7 días, por fecha de venta (incluye las que cerró un "Lo piensa").
  // Cada una se puede corregir con el mismo diálogo de Recientes mientras el local todavía pueda.
  const HIST_DIAS = 7, HIST_MAX = 25;
  let pedidoHist = 0, nuevaId = null;
  const etiquetaDia = d => {
    const hoy = R.util.hoy();
    if (d === hoy) return "Hoy";
    if (d === R.util.iso(new Date(Date.now() - 86400000))) return "Ayer";
    return R.util.fmtFecha(d);
  };

  async function historial() {
    const aside = $("cargar-historial"), l = local();
    aside.hidden = !l;
    if (!l) return;
    const n = ++pedidoHist;
    const lista = $("hist-lista");
    if (!lista.children.length) lista.innerHTML = R.util.esqueleto.tarjetas ? R.util.esqueleto.tarjetas(3) : "";
    let ventas, items;
    try {
      const hoy = R.util.hoy(), desde = R.util.iso(new Date(Date.now() - (HIST_DIAS - 1) * 86400000));
      const filas = await R.api.consultas({ desde, hasta: hoy, localId: l.id });
      ventas = filas.filter(c => c.estado === "compro" && !c.anulada && c.dia_venta >= desde && c.dia_venta <= hoy)
        .sort((a, b) => Date.parse(b.fecha_venta) - Date.parse(a.fecha_venta) || b.id - a.id);
      items = await R.api.itemsDe(ventas.slice(0, HIST_MAX).map(c => c.id));
    } catch (e) {
      if (n === pedidoHist) { $("hist-resumen").textContent = ""; lista.innerHTML = `<p class="hist-vacio">No se pudieron traer las ventas: ${esc(e.message)}</p>`; }
      return;
    }
    if (n !== pedidoHist) return;
    const hoy = R.util.hoy();
    const deHoy = ventas.filter(c => c.dia_venta === hoy);
    $("hist-resumen").innerHTML = `<span><strong>${fmtNum(deHoy.length)}</strong>${deHoy.length === 1 ? "venta hoy" : "ventas hoy"}</span>`
      + `<span><strong>${fmtPesos(deHoy.reduce((s, c) => s + c.monto_total, 0))}</strong>vendido hoy</span>`;
    const mostradas = ventas.slice(0, HIST_MAX);
    if (!mostradas.length) { lista.innerHTML = `<p class="hist-vacio">Todavía no hay ventas en los últimos ${HIST_DIAS} días.</p>`; return; }
    let dia = null, html = "";
    for (const c of mostradas) {
      if (c.dia_venta !== dia) {
        dia = c.dia_venta;
        const delDia = ventas.filter(x => x.dia_venta === dia);
        html += `<div class="hist-dia">${etiquetaDia(dia)}<span>${plural(delDia.length, "venta", "ventas")} · ${fmtPesos(delDia.reduce((s, x) => s + x.monto_total, 0))}</span></div>`;
      }
      const editable = R.app.puedeCargar() && (R.app.esAdmin() || c.editable_por_local);
      html += `<article class="hist-item${c.id === nuevaId ? " nueva" : ""}" data-id="${c.id}">
        <div class="hist-fila"><span class="hist-hora">${esc(R.util.fmtHora(c.fecha_venta))}</span>${editable ? `<button type="button" class="link hist-corregir" data-corregir>Corregir</button>` : ""}<span class="hist-monto">${fmtPesos(c.monto_total, c.monto_total % 1 ? 2 : 0)}</span></div>
        <div class="hist-prod">${esc(V.textoArticulos(items.filter(i => i.consulta_id === c.id)) || "Sin detalle de artículos")}</div>
        <div class="hist-meta">${iconoCanal(c.canal)}<span>${esc([c.pago, c.envio, c.atendio ? "atendió " + c.atendio : ""].filter(Boolean).join(" · "))}</span></div>
      </article>`;
    }
    lista.innerHTML = html + (ventas.length > HIST_MAX ? `<p class="hist-vacio">Se muestran las últimas ${HIST_MAX} de ${fmtNum(ventas.length)}.${R.app.esAdmin() ? ' Todas están en la <a href="#planilla">Planilla</a>.' : ""}</p>` : "");
    nuevaId = null;
    lista.querySelectorAll(".hist-item").forEach(a => {
      const c = mostradas.find(x => x.id === Number(a.dataset.id));
      a.querySelector("[data-corregir]")?.addEventListener("click", () => V.editar(c, { alGuardar: () => { historial(); contador(); R.app.contadores(); } }));
    });
  }

  const pintarContacto = () => V.prepararContacto($("cargar-cliente-contacto"), $("cargar-cliente-contacto-label"), V.nombreCanal(canal));

  function pintarPasos() {
    if (canal) pintarContacto();
    $("paso-canal").classList.toggle("listo", !!canal);
    $("paso-canal").querySelectorAll("[data-canal]").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.canal) === canal)));
  }

  function reiniciar() {
    canal = null;
    venta = null;
    $("cargar-venta").hidden = true;
    $("cargar-venta-form").innerHTML = "";
    $("cargar-cliente").hidden = true;
    $("cargar-cliente-nombre").value = "";
    $("cargar-cliente-contacto").value = "";
    $("cargar-cliente").querySelectorAll(".campo-error").forEach(x => x.classList.remove("campo-error"));
    $("cargar-error").textContent = "";
    $("cargar-nota").value = "";
    $("cargar-fecha").value = "";
    $("cargar-mas").open = false;
    document.querySelectorAll("#paso-resultado [data-resultado]").forEach(b => b.setAttribute("aria-pressed", "false"));
    pintarPasos();
  }

  function mostrar() {
    const l = local();
    if (!l) {
      $("cargar-cuerpo").hidden = true;
      $("cargar-sin-local").hidden = false;
      return;
    }
    $("cargar-cuerpo").hidden = false;
    $("cargar-sin-local").hidden = true;
    $("cargar-local").textContent = l.nombre;
    const canales = V.opcionesDe(l.id, "canal");
    $("paso-canal-opciones").innerHTML = canales.map(o =>
      `<button type="button" class="opcion-grande" data-canal="${o.id}" aria-pressed="false">${iconoCanal(o.valor)}${esc(o.valor)}</button>`).join("")
      || `<p class="vacio">Este local no tiene canales cargados. Un admin los agrega en Configuración.</p>`;
    const vendedores = R.estado.catalogo.vendedores.filter(v => v.local_id === l.id && v.activo);
    const ultimo = pref.leer("vendedor-" + l.id, "");
    $("cargar-atendio").innerHTML = `<option value="">Sin indicar</option>` + vendedores.map(v =>
      `<option value="${v.id}" ${String(v.id) === String(ultimo) ? "selected" : ""}>${esc(v.nombre)}</option>`).join("");
    $("cargar-atendio-wrap").hidden = !vendedores.length;
    reiniciar();
    contador();
    historial();
  }

  async function guardar(estado) {
    if (guardando) return;
    $("cargar-error").textContent = "";
    if (!canal) {
      $("paso-canal").classList.add("campo-error");
      document.querySelectorAll("#paso-resultado [data-resultado]").forEach(b => b.setAttribute("aria-pressed", "false"));
      $("cargar-error").textContent = "Elegí primero por dónde consultó.";
      $("paso-canal").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const l = local();
    const p = {
      local_id: l.id, canal_id: canal, estado,
      atendio_id: $("cargar-atendio").value ? Number($("cargar-atendio").value) : null,
      fecha_consulta: R.util.deInputFechaHora($("cargar-fecha").value),
      nota: $("cargar-nota").value.trim(),
    };
    if (estado === "compro") {
      const r = venta.leer();
      if (!r.ok) { $("cargar-error").textContent = r.error; return; }
      Object.assign(p, r.datos);
    }
    if (estado === "lo_piensa") {
      $("cargar-cliente").querySelectorAll(".campo-error").forEach(x => x.classList.remove("campo-error"));
      // Datos del cliente: todos opcionales, nunca frenan la carga
      const cl = V.validarCliente($("cargar-cliente-nombre").value, $("cargar-cliente-contacto").value);
      p.cliente_nombre = cl.nombre;
      p.cliente_contacto = cl.contacto;
    }
    guardando = true;
    document.querySelectorAll("#vista-cargar button").forEach(b => { b.disabled = true; });
    try {
      const id = await R.api.guardar(p);
      const textos = { compro: "Venta guardada", lo_piensa: "Guardada en Lo piensan", no_compro: "Consulta guardada" };
      R.util.toast(textos[estado] + ".", "ok", 8000, {
        texto: "Deshacer",
        fn: async () => {
          try { await R.api.anular(id, "Deshecho al cargar"); R.util.toast("Se deshizo la carga."); contador(); historial(); R.app.contadores(); }
          catch (e) { R.util.toast(e.message, "error", 6000); }
        },
      });
      if (estado === "compro") nuevaId = id;
      reiniciar();
      contador();
      historial();
      R.app.contadores();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      $("cargar-error").textContent = e.message;
    } finally {
      guardando = false;
      document.querySelectorAll("#vista-cargar button").forEach(b => { b.disabled = false; });
    }
  }

  function iniciar() {
    $("paso-canal-opciones").addEventListener("click", e => {
      const b = e.target.closest("[data-canal]");
      if (!b) return;
      canal = Number(b.dataset.canal);
      $("paso-canal").classList.remove("campo-error");
      if ($("cargar-error").textContent.startsWith("Elegí primero")) $("cargar-error").textContent = "";
      pintarPasos();
    });
    $("paso-resultado").addEventListener("click", e => {
      const b = e.target.closest("[data-resultado]");
      if (!b) return;
      const r = b.dataset.resultado;
      document.querySelectorAll("#paso-resultado [data-resultado]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      $("cargar-cliente").hidden = r !== "lo_piensa";
      if (r === "compro") {
        if (!venta) venta = V.crear($("cargar-venta-form"), local().id);
        $("cargar-venta").hidden = false;
        $("cargar-venta").scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (r === "lo_piensa") {
        // Antes de guardar hace falta saber quién es: nombre y teléfono o usuario
        $("cargar-venta").hidden = true;
        if (!canal) { $("cargar-cliente").hidden = true; guardar(r); return; }  // avisa que falta el canal
        pintarContacto();
        $("cargar-cliente").scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => $("cargar-cliente-nombre").focus({ preventScroll: true }), 250);
      } else {
        $("cargar-venta").hidden = true;
        guardar(r);
      }
    });
    $("cargar-guardar-cliente").addEventListener("click", () => guardar("lo_piensa"));
    $("cargar-cancelar-cliente").addEventListener("click", () => {
      $("cargar-cliente").hidden = true;
      $("cargar-error").textContent = "";
      document.querySelectorAll("#paso-resultado [data-resultado]").forEach(x => x.setAttribute("aria-pressed", "false"));
    });
    // Enter en el nombre pasa al contacto; Enter en el contacto guarda
    $("cargar-cliente-nombre").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("cargar-cliente-contacto").focus(); } });
    $("cargar-cliente-contacto").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); guardar("lo_piensa"); } });
    ["cargar-cliente-nombre", "cargar-cliente-contacto"].forEach(id => $(id).addEventListener("input", e => e.target.closest(".campo-error")?.classList.remove("campo-error")));
    $("cargar-guardar-venta").addEventListener("click", () => guardar("compro"));
    $("cargar-cancelar-venta").addEventListener("click", () => {
      $("cargar-venta").hidden = true;
      venta = null;
      $("cargar-venta-form").innerHTML = "";
      document.querySelectorAll("#paso-resultado [data-resultado]").forEach(x => x.setAttribute("aria-pressed", "false"));
    });
    $("hist-actualizar").addEventListener("click", () => { historial(); contador(); });
    $("cargar-atendio").addEventListener("change", () => { if (local()) pref.guardar("vendedor-" + local().id, $("cargar-atendio").value); });
    $("cargar-fecha").max = R.util.aInputFechaHora();
  }

  R.vistaCargar = { iniciar, mostrar };
})(window.CMC);
