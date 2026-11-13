// =====================================================================
//  Vista: Planilla (admin y consulta). Todas las consultas con sus
//  artículos, filtros y exportación a Excel. El admin corrige o anula.
// =====================================================================
(function (R) {
  const { $, esc, norm, fmtNum, fmtPesos, fmtFecha, fmtHora, chipEstado, pref } = R.util;
  const V = R.venta;
  const LOTE = 200;
  let filas = [], items = [], visibles = [], mostradas = LOTE, pedido = 0;

  function rango() {
    const hoy = R.util.hoy();
    let desde = $("pl-desde").value || window.Medidas.inicioMes(hoy), hasta = $("pl-hasta").value || hoy;
    if (desde > hasta) [desde, hasta] = [hasta, desde];
    return { desde, hasta };
  }

  async function mostrar() {
    const { desde, hasta } = rango();
    const lid = R.estado.local ? R.estado.local.id : null;
    const n = ++pedido;
    $("pl-cuerpo").innerHTML = R.util.esqueleto.filas(R.estado.local ? 10 : 11, 8);
    try {
      const todas = await R.api.consultas({ desde, hasta, localId: lid });
      filas = todas.filter(c => c.dia_consulta >= desde && c.dia_consulta <= hasta);
      items = await R.api.itemsDe(filas.filter(c => c.estado === "compro").map(c => c.id));
    } catch (e) {
      if (n === pedido) $("pl-cuerpo").innerHTML = `<tr><td colspan="11"><div class="mensaje-error">${esc(e.message)}</div></td></tr>`;
      return;
    }
    if (n !== pedido) return;
    const canales = [...new Set(filas.map(c => c.canal))].sort();
    const sel = $("pl-canal"), v = sel.value;
    sel.innerHTML = `<option value="">Todos</option>` + canales.map(c => `<option>${esc(c)}</option>`).join("");
    if (canales.includes(v)) sel.value = v;
    filtrar();
  }

  const articulosDe = id => items.filter(i => i.consulta_id === id);
  const estadoDe = c => c.anulada ? "anulada" : c.estado_efectivo;

  function filtrar() {
    const canal = $("pl-canal").value, estado = $("pl-estado").value, q = norm($("pl-buscar").value);
    visibles = filas.filter(c => {
      const e = estadoDe(c);
      if (estado === "" && e === "anulada") return false;
      if (estado && estado !== "todas" && e !== estado) return false;
      if (canal && c.canal !== canal) return false;
      if (q) {
        const texto = norm([c.nota, c.cliente_nombre, c.cliente_contacto, c.atendio, c.canal, c.envio, c.pago, c.local, V.textoArticulos(articulosDe(c.id))].join(" "));
        if (!texto.includes(q)) return false;
      }
      return true;
    });
    mostradas = LOTE;
    pintar();
  }

  function pintar() {
    const conLocal = !R.estado.local;
    $("pl-th-local").hidden = !conLocal;
    const ventas = visibles.filter(c => c.estado === "compro" && !c.anulada);
    const total = ventas.reduce((s, c) => s + c.monto_total, 0);
    $("pl-resumen").innerHTML = `<strong>${fmtNum(visibles.length)}</strong> consultas, <strong>${fmtNum(ventas.length)}</strong> terminaron en compra por <strong>${fmtPesos(total)}</strong>. `
      + `Se listan por la fecha de la consulta (el Tablero cuenta las ventas por la fecha en que se concretaron).`;
    if (!visibles.length) {
      $("pl-cuerpo").innerHTML = `<tr><td colspan="11" class="vacio">No hay consultas con estos filtros.</td></tr>`;
      $("pl-mas").hidden = true;
      return;
    }
    $("pl-cuerpo").innerHTML = visibles.slice(0, mostradas).map(c => {
      const its = articulosDe(c.id);
      return `<tr class="clic${c.anulada ? " inactivo" : ""}" data-id="${c.id}">
        <td><strong>${fmtFecha(c.dia_consulta)}</strong><small>${fmtHora(c.fecha_consulta)}</small></td>
        ${conLocal ? `<td>${esc(c.local)}</td>` : ""}
        <td>${esc(c.canal)}</td>
        <td>${chipEstado(estadoDe(c))}</td>
        <td>${esc(c.atendio || "")}</td>
        <td class="texto-largo">${esc(V.textoArticulos(its))}</td>
        <td class="num">${c.estado === "compro" ? fmtNum(c.unidades) : ""}</td>
        <td class="num">${c.estado === "compro" ? fmtPesos(c.monto_total) : ""}</td>
        <td>${esc(c.envio || "")}</td>
        <td>${esc(c.pago || "")}</td>
        <td>${c.estado === "compro" && c.dia_venta !== c.dia_consulta ? fmtFecha(c.dia_venta) : ""}${c.cliente_nombre || c.cliente_contacto ? `<small>${esc([c.cliente_nombre, c.cliente_contacto].filter(Boolean).join(" · "))}</small>` : ""}${c.nota ? `<small>${esc(c.nota)}</small>` : ""}${c.anulada ? `<small>Anulada: ${esc(c.anulada_motivo)}</small>` : ""}</td>
      </tr>`;
    }).join("");
    $("pl-mas").hidden = visibles.length <= mostradas;
    $("pl-mas").textContent = `Mostrar ${fmtNum(Math.min(LOTE, visibles.length - mostradas))} más (quedan ${fmtNum(visibles.length - mostradas)})`;
  }

  function exportar() {
    const conLocal = !R.estado.local;
    const cab = ["Fecha", "Hora", ...(conLocal ? ["Local"] : []), "Canal", "Resultado", "Atendió", "Artículos", "Unidades", "Monto", "Envío", "Forma de pago", "Fecha de venta", "Cliente", "Contacto", "Nota", "Anulada"];
    const datos = visibles.map(c => [
      fmtFecha(c.dia_consulta), fmtHora(c.fecha_consulta), ...(conLocal ? [c.local] : []), c.canal, R.util.ESTADOS[estadoDe(c)],
      c.atendio || "", V.textoArticulos(articulosDe(c.id)), c.estado === "compro" ? c.unidades : "",
      c.estado === "compro" ? String(c.monto_total).replace(".", ",") : "", c.envio || "", c.pago || "",
      c.dia_venta ? fmtFecha(c.dia_venta) : "", c.cliente_nombre || "", c.cliente_contacto || "", c.nota || "", c.anulada ? c.anulada_motivo : "",
    ]);
    const { desde, hasta } = rango();
    R.util.descargarCSV(`consultas ${R.estado.local ? R.estado.local.nombre : "todos los locales"} ${desde} a ${hasta}.csv`, [cab, ...datos]);
  }

  function iniciar() {
    const hoy = R.util.hoy();
    const g = pref.leer("planilla-filtros", {});
    $("pl-desde").value = g.desde || window.Medidas.inicioMes(hoy);
    $("pl-hasta").value = g.hasta || hoy;
    ["pl-desde", "pl-hasta"].forEach(id => $(id).addEventListener("change", () => {
      pref.guardar("planilla-filtros", { desde: $("pl-desde").value, hasta: $("pl-hasta").value });
      mostrar();
    }));
    ["pl-canal", "pl-estado"].forEach(id => $(id).addEventListener("change", filtrar));
    let t;
    $("pl-buscar").addEventListener("input", () => { clearTimeout(t); t = setTimeout(filtrar, 200); });
    $("pl-mas").addEventListener("click", () => { mostradas += LOTE; pintar(); });
    $("pl-exportar").addEventListener("click", exportar);
    $("pl-cuerpo").addEventListener("click", e => {
      const tr = e.target.closest("tr[data-id]");
      if (!tr) return;
      const c = filas.find(x => x.id === Number(tr.dataset.id));
      if (!c) return;
      if (R.app.esAdmin() && !c.anulada) {
        V.editar(c, { alGuardar: () => { R.vistaTablero.olvidar(); mostrar(); } });
      } else detalle(c);
    });
  }

  // Solo lectura (consulta, o una anulada)
  function detalle(c) {
    const d = $("dlg-editar");
    $("editar-titulo").textContent = `Consulta del ${R.util.fechaHora(c.fecha_consulta)}`;
    const its = articulosDe(c.id);
    const dato = (t, v) => v ? `<dt>${esc(t)}</dt><dd>${v}</dd>` : "";
    $("editar-cuerpo").innerHTML = `<dl class="ficha-datos">
      ${dato("Local", esc(c.local))}${dato("Canal", esc(c.canal))}${dato("Resultado", chipEstado(estadoDe(c)))}${dato("Atendió", esc(c.atendio || ""))}
      ${c.estado === "compro" ? dato("Vendido", fmtPesos(c.monto_total)) + dato("Fecha de venta", R.util.fechaHora(c.fecha_venta)) + dato("Envío", esc(c.envio || "")) + dato("Forma de pago", esc(c.pago || "")) : ""}
      ${dato("Cliente", esc([c.cliente_nombre, c.cliente_contacto].filter(Boolean).join(" · ")))}${dato("Nota", esc(c.nota || ""))}${c.anulada ? dato("Anulada", esc(c.anulada_motivo)) : ""}</dl>
      ${its.length ? `<ul class="lista-simple">${its.map(i => `<li><span>${esc(i.rubro || "Sin rubro")}${i.marca ? " · " + esc(i.marca) : ""}${i.descripcion ? `<small>${esc(i.descripcion)}</small>` : ""}</span><span>x${fmtNum(i.cantidad)} · ${fmtPesos(i.monto)}</span></li>`).join("")}</ul>` : ""}
      <div class="dlg-pie"><button type="button" class="btn-sec" data-cerrar>Cerrar</button></div>`;
    d.showModal();
  }

  R.vistaPlanilla = { iniciar, mostrar };
})(window.CMC);
