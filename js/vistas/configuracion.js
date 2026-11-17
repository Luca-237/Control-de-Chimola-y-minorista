// =====================================================================
//  Vistas: Configuración (listas, vendedores y datos de cada local;
//  color de fondo de cada uno) y Usuarios (roles y locales).
// =====================================================================
(function (R) {
  const { $, esc, aUsuario, info } = R.util;
  const TIPOS = [["canal", "Canales"], ["envio", "Envíos"], ["pago", "Formas de pago"], ["rubro", "Rubros"], ["marca", "Marcas"]];  // los vendedores se manejan en Usuarios y empleados
  let pestana = "rubro";
  const cfgLocal = () => Number($("cfg-local").value) || null;

  // Vuelve a leer listas y vendedores (después de un cambio) y avisa al resto de las pantallas
  async function recargarCatalogo() {
    R.estado.catalogo = await R.api.catalogo(R.estado.perfil);
    R.app.pintarLocales();
    R.vistaTablero.olvidar();
  }

  // ---------- Color de fondo (de cada persona, en su navegador) ----------
  const SUGERIDOS = ["#C8F0D6", "#FFE3D3", "#DDE7FF", "#F3E1FA", "#FFF1C1", "#E3E8E5"];
  function pintarColor() {
    const actual = (window.ColorFondo.leer() || window.ColorFondo.DEFECTO).toLowerCase();
    $("cfg-sugeridos").innerHTML = SUGERIDOS.map(c => `<button type="button" class="cfg-color" style="--c:${c}" data-color="${c}" aria-pressed="${c.toLowerCase() === actual}" title="${c}" aria-label="Color ${c}"></button>`).join("");
    $("cfg-color-propio").value = actual;
    $("cfg-color-hex").textContent = actual.toUpperCase();
  }
  function aplicarColor(hex) {
    window.ColorFondo.guardar(hex);
    window.ColorFondo.aplicar(hex);
    pintarColor();
  }

  // ---------- Local ----------
  function pintarLocal() {
    const l = R.estado.catalogo.locales.find(x => x.id === cfgLocal());
    if (!l) return;
    $("cfg-nombre").value = l.nombre;
    $("cfg-color-local").value = l.color;
    $("cfg-dias-piensa").value = l.dias_lo_piensa;
    $("cfg-horas").value = l.horas_edicion;
    $("cfg-dias-atraso").value = l.dias_carga_atrasada;
    $("cfg-activo").checked = l.activo;
  }
  async function guardarLocal() {
    const l = R.estado.catalogo.locales.find(x => x.id === cfgLocal());
    try {
      await R.api.admin.guardarLocal({
        id: l.id, nombre: $("cfg-nombre").value.trim(), color: $("cfg-color-local").value,
        dias_lo_piensa: Number($("cfg-dias-piensa").value), horas_edicion: Number($("cfg-horas").value),
        dias_carga_atrasada: Number($("cfg-dias-atraso").value), activo: $("cfg-activo").checked,
      });
      await recargarCatalogo();
      R.util.toast("Datos del local guardados.");
    } catch (e) { R.util.toast(e.message, "error", 6000); }
  }

  // ---------- Listas ----------
  function pintarLista() {
    $("cfg-pestanas").querySelectorAll("button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tipo === pestana)));
    const lid = cfgLocal();
    const esVend = pestana === "vendedores";
    const lista = esVend
      ? R.estado.catalogo.vendedores.filter(v => v.local_id === lid).map(v => ({ id: v.id, valor: v.nombre, activo: v.activo }))
      : R.estado.catalogo.opciones.filter(o => o.local_id === lid && o.tipo === pestana);
    $("cfg-lista").innerHTML = lista.length ? lista.map(o => `<li data-id="${o.id}" class="${o.activo ? "" : "inactivo"}">
        <input type="text" value="${esc(o.valor)}" data-valor aria-label="Nombre">
        ${esVend ? "<span></span>" : `<input type="number" value="${o.orden}" data-orden aria-label="Orden" title="Orden en que aparece">`}
        <label class="interruptor" title="${o.activo ? "Se usa" : "Desactivada: no aparece para cargar"}"><input type="checkbox" data-activo ${o.activo ? "checked" : ""}><span class="interruptor-pista"></span></label>
      </li>`).join("") : `<li class="vacio">Todavía no hay nada en esta lista.</li>`;
    $("cfg-nuevo").placeholder = esVend ? "Nombre del vendedor" : "Nueva opción";
  }
  async function guardarFila(li) {
    const id = Number(li.dataset.id);
    const valor = li.querySelector("[data-valor]").value.trim();
    const activo = li.querySelector("[data-activo]").checked;
    if (!valor) { R.util.toast("El nombre no puede quedar vacío.", "error"); return pintarLista(); }
    try {
      if (pestana === "vendedores") await R.api.admin.guardarVendedor({ id, nombre: valor, activo });
      else await R.api.admin.guardarOpcion({ id, valor, activo, orden: Number(li.querySelector("[data-orden]").value) || 0 });
      await recargarCatalogo();
      pintarLista();
      R.util.toast("Guardado.");
    } catch (e) { R.util.toast(e.message, "error", 6000); pintarLista(); }
  }
  async function agregar(e) {
    e.preventDefault();
    const valor = $("cfg-nuevo").value.trim();
    if (!valor) return;
    try {
      if (pestana === "vendedores") await R.api.admin.guardarVendedor({ local_id: cfgLocal(), nombre: valor });
      else {
        const ordenes = R.estado.catalogo.opciones.filter(o => o.local_id === cfgLocal() && o.tipo === pestana).map(o => o.orden).filter(o => o < 99);
        await R.api.admin.guardarOpcion({ local_id: cfgLocal(), tipo: pestana, valor, orden: (ordenes.length ? Math.max(...ordenes) : 0) + 1 });
      }
      $("cfg-nuevo").value = "";
      await recargarCatalogo();
      pintarLista();
    } catch (err) { R.util.toast(err.message, "error", 6000); }
  }

  function mostrar() {
    pintarColor();
    if (!R.app.esAdmin()) return;
    const sel = $("cfg-local"), antes = sel.value;
    sel.innerHTML = R.estado.catalogo.locales.map(l => `<option value="${l.id}">${esc(l.nombre)}</option>`).join("");
    sel.value = antes || (R.estado.local ? R.estado.local.id : sel.options[0]?.value);
    pintarLocal();
    pintarLista();
  }

  function iniciar() {
    $("cfg-sugeridos").addEventListener("click", e => { const b = e.target.closest("[data-color]"); if (b) aplicarColor(b.dataset.color); });
    $("cfg-color-propio").addEventListener("input", e => aplicarColor(e.target.value));
    $("cfg-local").addEventListener("change", () => { pintarLocal(); pintarLista(); });
    $("cfg-guardar-local").addEventListener("click", guardarLocal);
    $("cfg-pestanas").innerHTML = TIPOS.map(([k, t]) => `<button type="button" role="tab" data-tipo="${k}">${t}</button>`).join("");
    $("cfg-pestanas").addEventListener("click", e => { const b = e.target.closest("[data-tipo]"); if (b) { pestana = b.dataset.tipo; pintarLista(); } });
    $("cfg-lista").addEventListener("change", e => { const li = e.target.closest("li[data-id]"); if (li) guardarFila(li); });
    $("cfg-agregar").addEventListener("submit", agregar);
  }

  R.vistaConfiguracion = { iniciar, mostrar };

  // ---------- Usuarios y empleados ----------
  const ROLES = [["carga", "Local (carga)"], ["consulta", "Consulta (solo mira)"], ["admin", "Admin"]];
  let perfilesActuales = [];

  // Contraseña al azar fácil de dictar: sin letras que se confunden (l, 1, O, 0)
  function generarPassword() {
    const letras = "abcdefghjkmnpqrstuvwxyz", nums = "23456789";
    const al = (s, n) => Array.from(crypto.getRandomValues(new Uint32Array(n)), x => s[x % s.length]).join("");
    return al(letras, 4) + "-" + al(nums, 4) + "-" + al(letras, 3).toUpperCase();
  }

  async function mostrarUsuarios() {
    const cuerpo = $("us-cuerpo");
    cuerpo.innerHTML = R.util.esqueleto.filas(7, 4);
    pintarEmpleados();
    let perfiles, ingresos;
    try { [perfiles, ingresos] = await Promise.all([R.api.admin.perfiles(), R.api.admin.ingresos()]); }
    catch (e) { cuerpo.innerHTML = `<tr><td colspan="7"><div class="mensaje-error">${esc(e.message)}</div></td></tr>`; return; }
    perfilesActuales = perfiles;
    const locales = R.estado.catalogo.locales;
    const yo = R.estado.perfil.id;
    cuerpo.innerHTML = perfiles.map(p => {
      const soyYo = p.id === yo;
      const fecha = ingresos ? ingresos[p.auth_id || p.id] : null; // último ingreso: solo del login propio
      const ingreso = ingresos ? (fecha ? R.util.fechaHora(fecha) : (p.clerk_id && !p.auth_id ? "Cuenta Cindy" : "Nunca")) : "—";
      const propio = p.auth_id !== null || !("auth_id" in p); // base sin la migración: todos son propios
      return `<tr data-id="${p.id}" class="${p.activo ? "" : "inactivo"}">
        <td><strong>${esc(aUsuario(p.email))}</strong>${soyYo ? "<small>(vos)</small>" : ""}
          <div>${propio ? `<span class="chip-login">Usuario de siempre</span>` : ""}${p.clerk_id ? `<span class="chip-login">Cuenta Cindy</span>` : ""}</div></td>
        <td><input type="text" value="${esc(p.nombre)}" data-nombre maxlength="60" style="min-width:140px" aria-label="Nombre"></td>
        <td><select data-rol ${soyYo ? "disabled title=\"No podés cambiar tu propio rol\"" : ""} aria-label="Rol">${ROLES.map(([k, t]) => `<option value="${k}" ${k === p.rol ? "selected" : ""}>${t}</option>`).join("")}</select></td>
        <td>${p.rol === "carga" ? `<div class="locales-usuario">${locales.map(l => `<label><input type="checkbox" data-local="${l.id}" ${p.locales.includes(l.id) ? "checked" : ""}>${esc(l.nombre)}</label>`).join("")}</div>`
          + (p.locales.length ? "" : `<small class="aviso">Sin local: no puede entrar</small>`) : `<small>Todos</small>`}</td>
        <td><small>${esc(ingreso)}</small></td>
        <td><label class="interruptor" ${soyYo ? "title=\"No podés deshabilitar tu propia cuenta\"" : ""}><input type="checkbox" data-activo ${p.activo ? "checked" : ""} ${soyYo ? "disabled" : ""}><span class="interruptor-pista"></span>${p.activo ? "Habilitado" : "Deshabilitado"}</label></td>
        <td>${propio ? `<button type="button" class="link" data-password>Cambiar contraseña</button>` : ""}
          ${p.clerk_id && propio ? `<button type="button" class="link" data-desvincular>Desvincular cuenta Cindy</button>` : ""}
          ${p.clerk_id && !propio ? `<button type="button" class="link" data-unir>Unir con usuario de siempre</button>` : ""}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="7" class="vacio">No hay usuarios.</td></tr>`;
  }

  // ---------- Empleados (vendedores) por local ----------
  function pintarEmpleados() {
    const cont = $("us-empleados");
    const { locales, vendedores } = R.estado.catalogo;
    cont.innerHTML = locales.map(l => {
      const lista = vendedores.filter(v => v.local_id === l.id).sort((a, b) => (b.activo - a.activo) || a.nombre.localeCompare(b.nombre, "es"));
      return `<div class="empleados-local" data-local="${l.id}" style="--c:${esc(l.color)}">
        <h3><span class="punto"></span>${esc(l.nombre)} <small>${lista.filter(v => v.activo).length} activos</small></h3>
        <ul class="lista-edit">${lista.map(v => `<li data-id="${v.id}" class="${v.activo ? "" : "inactivo"}">
          <input type="text" value="${esc(v.nombre)}" data-valor maxlength="60" aria-label="Nombre del empleado">
          <span></span>
          <label class="interruptor" title="${v.activo ? "Aparece en Atendió" : "Desactivado: no aparece para cargar"}"><input type="checkbox" data-activo ${v.activo ? "checked" : ""}><span class="interruptor-pista"></span></label>
        </li>`).join("") || `<li class="vacio">Todavía no hay empleados cargados.</li>`}</ul>
        <form class="agregar-fila" data-agregar><input type="text" maxlength="60" placeholder="Nombre y apellido" aria-label="Nuevo empleado"><button type="submit" class="btn-sec">Agregar</button></form>
      </div>`;
    }).join("");
  }
  async function guardarEmpleado(li) {
    const nombre = li.querySelector("[data-valor]").value.trim();
    if (!nombre) { R.util.toast("El nombre no puede quedar vacío.", "error"); return pintarEmpleados(); }
    try {
      await R.api.admin.guardarVendedor({ id: Number(li.dataset.id), nombre, activo: li.querySelector("[data-activo]").checked });
      await recargarCatalogo();
      R.util.toast("Empleado guardado.");
    } catch (e) { R.util.toast(e.message, "error", 6000); }
    pintarEmpleados();
  }

  // ---------- Nuevo usuario ----------
  function abrirNuevo() {
    $("nu-formulario").hidden = false;
    $("nu-listo").hidden = true;
    $("form-usuario").reset();
    $("nu-error").textContent = "";
    $("nu-password").value = generarPassword();
    $("nu-locales").innerHTML = R.estado.catalogo.locales.filter(l => l.activo).map(l =>
      `<label><input type="checkbox" value="${l.id}" ${R.estado.local && R.estado.local.id === l.id ? "checked" : ""}>${esc(l.nombre)}</label>`).join("");
    pintarNuevo();
    $("dlg-usuario").showModal();
    $("nu-nombre").focus();
  }
  function pintarNuevo() {
    $("nu-locales-wrap").hidden = $("nu-rol").value !== "carga";
    const u = $("nu-usuario").value.trim().toLowerCase();
    $("nu-usuario-hint").textContent = u.includes("@") ? "Se entra con este email." : `Se entra escribiendo "${u || "usuario"}" (sin el dominio).`;
  }
  async function crearNuevo(e) {
    e.preventDefault();
    $("nu-error").textContent = "";
    const d = {
      nombre: $("nu-nombre").value.trim(),
      usuario: $("nu-usuario").value.trim().toLowerCase(),
      password: $("nu-password").value,
      rol: $("nu-rol").value,
      locales: [...$("nu-locales").querySelectorAll("input:checked")].map(i => Number(i.value)),
    };
    if (!d.nombre) return ($("nu-error").textContent = "Falta el nombre.");
    if (!/^[a-z0-9._-]{2,40}$/.test(d.usuario) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.usuario)) return ($("nu-error").textContent = "El usuario solo puede tener letras sin tilde, números, puntos y guiones (o un email).");
    if (d.password.length < 8) return ($("nu-error").textContent = "La contraseña tiene que tener al menos 8 caracteres.");
    if (d.rol === "carga" && !d.locales.length) return ($("nu-error").textContent = "Elegí al menos un local.");
    $("nu-crear").disabled = true;
    try {
      await R.api.admin.crearUsuario(d);
      const lineas = [`Página: ${location.origin}${location.pathname}`, `Usuario: ${d.usuario}`, `Contraseña: ${d.password}`];
      $("nu-datos").innerHTML = lineas.map(l => `<div>${esc(l)}</div>`).join("");
      $("nu-copiar").onclick = async () => {
        try { await navigator.clipboard.writeText(lineas.join("\n")); R.util.toast("Copiado."); }
        catch (err) { R.util.toast("No se pudo copiar: seleccionalo a mano.", "error"); }
      };
      $("nu-formulario").hidden = true;
      $("nu-listo").hidden = false;
      mostrarUsuarios();
    } catch (err) { $("nu-error").textContent = err.message; }
    finally { $("nu-crear").disabled = false; }
  }

  async function cambiarPassword(p) {
    const nueva = await R.util.pedir({ titulo: `Contraseña de ${p.nombre || aUsuario(p.email)}`, texto: "Escribí la nueva (mínimo 8 caracteres). La sesión que tenga abierta sigue hasta que salga.", campo: "Nueva contraseña", boton: "Cambiar" });
    if (nueva == null) return;
    if (nueva.length < 8) return R.util.toast("La contraseña tiene que tener al menos 8 caracteres.", "error", 5000);
    try { await R.api.admin.cambiarPassword(p.id, nueva); R.util.toast("Contraseña cambiada."); }
    catch (e) { R.util.toast(e.message, "error", 7000); }
  }

  function iniciarUsuarios() {
    $("us-nuevo").addEventListener("click", abrirNuevo);
    $("nu-rol").addEventListener("change", pintarNuevo);
    $("nu-usuario").addEventListener("input", pintarNuevo);
    $("nu-generar").addEventListener("click", () => { $("nu-password").value = generarPassword(); });
    $("form-usuario").addEventListener("submit", crearNuevo);
    $("us-cuerpo").addEventListener("click", async e => {
      const b = e.target.closest("[data-password], [data-desvincular], [data-unir]");
      if (!b) return;
      const p = perfilesActuales.find(x => x.id === b.closest("tr").dataset.id);
      if (!p) return;
      if (b.matches("[data-password]")) return cambiarPassword(p);
      try {
        if (b.matches("[data-desvincular]")) {
          if ((await R.util.pedir({ titulo: "Desvincular cuenta Cindy", texto: `${p.nombre || aUsuario(p.email)} va a seguir entrando con su usuario de siempre.`, boton: "Desvincular" })) == null) return;
          await R.api.admin.desvincularClerk(p.id);
          R.util.toast("Cuenta Cindy desvinculada.");
        } else {
          const destino = await R.util.pedir({ titulo: "Unir con usuario de siempre", texto: `La cuenta Cindy de ${p.nombre || aUsuario(p.email)} pasa al usuario que escribas (con su rol, locales y estado). El registro suelto se borra.`, campo: "Usuario (ej: chimola)", boton: "Unir" });
          if (!destino) return;
          const buscado = destino.trim().toLowerCase();
          const d = perfilesActuales.find(x => x.auth_id && !x.clerk_id && (aUsuario(x.email) === buscado || (x.email || "").toLowerCase() === buscado));
          if (!d) return R.util.toast(`No hay un usuario "${destino}" sin cuenta Cindy.`, "error", 6000);
          await R.api.admin.unirCuentas(p.id, d.id);
          R.util.toast("Cuentas unidas.");
        }
      } catch (err) { R.util.toast(err.message, "error", 7000); }
      mostrarUsuarios();
    });
    $("us-cuerpo").addEventListener("change", async e => {
      const tr = e.target.closest("tr[data-id]");
      if (!tr) return;
      const id = tr.dataset.id;
      try {
        if (e.target.matches("[data-local]")) await R.api.admin.asignarLocal(id, Number(e.target.dataset.local), e.target.checked);
        else if (e.target.matches("[data-activo]")) await R.api.admin.habilitarUsuario(id, e.target.checked);
        else await R.api.admin.actualizarPerfil(id, {
          nombre: tr.querySelector("[data-nombre]").value.trim(),
          rol: tr.querySelector("[data-rol]").value,
        });
        R.util.toast("Usuario actualizado.");
      } catch (err) { R.util.toast(err.message, "error", 7000); }
      mostrarUsuarios();
    });
    $("us-empleados").addEventListener("change", e => { const li = e.target.closest("li[data-id]"); if (li) guardarEmpleado(li); });
    $("us-empleados").addEventListener("submit", async e => {
      e.preventDefault();
      const f = e.target.closest("[data-agregar]"), input = f.querySelector("input");
      const nombre = input.value.trim();
      if (!nombre) return;
      try {
        await R.api.admin.guardarVendedor({ local_id: Number(f.closest("[data-local]").dataset.local), nombre });
        await recargarCatalogo();
        pintarEmpleados();
        R.util.toast("Empleado agregado.");
        $("us-empleados").querySelector(`[data-local="${f.closest("[data-local]").dataset.local}"] [data-agregar] input`)?.focus();
      } catch (err) { R.util.toast(err.message, "error", 6000); }
    });
  }
  R.vistaUsuarios = { iniciar: iniciarUsuarios, mostrar: mostrarUsuarios };
})(window.CMC);
