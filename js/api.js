// =====================================================================
//  Única capa de datos: todo lo que habla con Supabase pasa por acá.
//  Las vistas nunca llaman a Supabase directo.
//  (Para probar sin base: pruebas/api-falsa.js reemplaza este objeto.)
// =====================================================================
(function (R) {
  // Dos conexiones a la misma base, una por tipo de login:
  //   sbPropio -> usuario y contraseña del programa (Auth de Supabase)
  //   sbClerk  -> cuenta Cindy (token de Clerk; ahí supabase.auth no se usa)
  let sbPropio = null, sbClerk = null, sb = null;
  let via = null; // "clerk" | "propio" | null

  function configurado() {
    const c = window.CMC_CONFIG || {};
    return /^https:\/\/\S+$/.test(c.supabaseUrl || "") && (c.supabaseKey || "").length > 20;
  }

  function iniciar() {
    if (!window.supabase || !window.supabase.createClient) {
      throw new Error("No se pudo cargar la librería de Supabase. Revisá la conexión a internet.");
    }
    const c = window.CMC_CONFIG;
    const url = c.supabaseUrl.replace(/\/+$/, "");
    sbPropio = window.supabase.createClient(url, c.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "cmc.sesion" },
    });
    sbClerk = window.supabase.createClient(url, c.supabaseKey, { accessToken: () => window.CuentaCindy.token() });
    sb = sbPropio;
  }

  function usar(v) { via = v; sb = v === "clerk" ? sbClerk : sbPropio; }

  // Token para las Edge Functions, según con qué se entró
  async function tokenSesion() {
    if (via === "clerk") return await window.CuentaCindy.token();
    const { data } = await sbPropio.auth.getSession();
    return data.session ? data.session.access_token : null;
  }

  // Errores de Supabase -> mensajes para el usuario (los de las funciones de carga ya vienen en castellano)
  function mensaje(error) {
    const m = (error && (error.message || error.error_description)) || String(error);
    if (/Invalid login credentials/i.test(m)) return "Usuario o contraseña incorrectos.";
    if (/banned/i.test(m)) return "Tu usuario está desactivado. Hablá con un admin.";
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "No hay conexión con la base de datos. Revisá internet.";
    if (/row-level security|permission denied/i.test(m)) return "No tenés permiso para hacer esto.";
    if (/JWT expired/i.test(m)) return "La sesión venció. Volvé a ingresar.";
    if (/No suitable key|wrong key type/i.test(m)) return "La base todavía no acepta la cuenta Cindy. Entrá con tu usuario.";
    if (/opciones_unico|duplicate key.*opciones/i.test(m)) return "Esa opción ya existe en la lista.";
    if (/vendedores_unico|duplicate key.*vendedores/i.test(m)) return "Ya hay un vendedor con ese nombre en el local.";
    if (/locales_nombre_key/i.test(m)) return "Ya hay un local con ese nombre.";
    if (/último admin/i.test(m)) return "No se puede quitar el último admin activo.";
    return m;
  }
  function chequear({ data, error }) {
    if (error) throw new Error(mensaje(error));
    return data;
  }
  // Trae todas las filas (Supabase devuelve de a 1000)
  async function todo(consulta) {
    const filas = [], LOTE = 1000;
    for (let desde = 0; ; desde += LOTE) {
      const lote = chequear(await consulta().range(desde, desde + LOTE - 1));
      filas.push(...lote);
      if (lote.length < LOTE) return filas;
    }
  }
  const NUMEROS = ["monto_total", "monto", "unidades", "cantidad"];
  const numeros = filas => filas.map(f => { NUMEROS.forEach(k => { if (f[k] != null) f[k] = Number(f[k]); }); return f; });

  // ---------- Sesión ----------
  const auth = {
    via: () => via,
    // Login propio. usuario: "chimola" o un email completo
    async ingresar(usuario, password) {
      chequear(await sbPropio.auth.signInWithPassword({ email: R.util.aEmail(usuario), password }));
      usar("propio");
    },
    // Cierra la sesión de esta página. La cuenta Cindy se cierra solo si se pide,
    // porque es la misma sesión en todas las apps.
    async salir({ cuentaCindy = false } = {}) {
      await sbPropio.auth.signOut();
      if (cuentaCindy) await window.CuentaCindy.salir();
      usar(null);
    },
    // ¿Hay sesión? Prefiere la cuenta Cindy, salvo que se pida ignorarla.
    async sesion({ ignorarClerk = false } = {}) {
      if (!ignorarClerk && window.CuentaCindy.conSesion()) { usar("clerk"); return true; }
      const { data } = await sbPropio.auth.getSession();
      if (data.session) { usar("propio"); return true; }
      usar(null);
      return false;
    },
    alCambiar(cb) { sbPropio.auth.onAuthStateChange((evento, sesion) => cb(evento, sesion)); },
    // Perfil del programa. Con cuenta Cindy, la primera vez la vincula o la crea (migración cuenta_cindy).
    async miPerfil() {
      if (!via) return null;
      const r = await sb.rpc("mi_perfil");
      // Base todavía sin la migración cuenta_cindy: el login propio sigue como antes
      if (r.error && r.error.code === "PGRST202" && via === "propio") {
        const { data } = await sbPropio.auth.getSession();
        const p = chequear(await sb.from("perfiles").select("id, email, nombre, rol, activo").eq("id", data.session.user.id).maybeSingle());
        return p && { ...p, via: "propio", tiene_login_propio: true };
      }
      const filas = chequear(r);
      return (filas && filas[0]) || null;
    },
  };

  // ---------- Locales, listas y vendedores ----------
  // misLocales: los que puede usar quien está logueado (admin y consulta: todos; carga: los asignados)
  async function catalogo(perfil) {
    const [locales, opciones, vendedores, asignados] = await Promise.all([
      sb.from("locales").select("*").order("id").then(chequear),
      todo(() => sb.from("opciones").select("*").order("orden").order("valor")),
      sb.from("vendedores").select("*").order("nombre").then(chequear),
      sb.from("usuarios_locales").select("local_id").eq("usuario_id", perfil.id).then(chequear),
    ]);
    const ids = new Set(asignados.map(a => a.local_id));
    const misLocales = perfil.rol === "carga" ? locales.filter(l => ids.has(l.id) && l.activo) : locales;
    return { locales, misLocales, opciones, vendedores };
  }

  // ---------- Consultas ----------
  const CAMPOS_VISTA = "*";
  // Consultas hechas o vendidas entre dos días (YYYY-MM-DD), de un local o de todos
  function consultas({ desde, hasta, localId }) {
    return todo(() => {
      let q = sb.from("consultas_vista").select(CAMPOS_VISTA)
        .or(`and(dia_consulta.gte.${desde},dia_consulta.lte.${hasta}),and(dia_venta.gte.${desde},dia_venta.lte.${hasta})`)
        .order("fecha_consulta", { ascending: false }).order("id", { ascending: false });
      if (localId) q = q.eq("local_id", localId);
      return q;
    }).then(numeros);
  }
  // Artículos vendidos entre dos días (sin anuladas)
  function items({ desde, hasta, localId }) {
    return todo(() => {
      let q = sb.from("venta_items_vista").select("*").gte("dia_venta", desde).lte("dia_venta", hasta).order("id");
      if (localId) q = q.eq("local_id", localId);
      return q;
    }).then(numeros);
  }
  // Artículos de algunas consultas (para mostrar el detalle o corregir)
  async function itemsDe(ids) {
    if (!ids.length) return [];
    const filas = [];
    for (let i = 0; i < ids.length; i += 200) {
      filas.push(...chequear(await sb.from("venta_items_vista").select("*").in("consulta_id", ids.slice(i, i + 200)).order("id")));
    }
    return numeros(filas);
  }
  // "Lo piensa" sin cerrar de un local (incluye los vencidos)
  async function abiertos(localId) {
    let q = sb.from("consultas_vista").select(CAMPOS_VISTA).eq("estado", "lo_piensa").eq("anulada", false)
      .order("fecha_consulta", { ascending: true });
    if (localId) q = q.eq("local_id", localId);
    return numeros(chequear(await q));
  }
  // Lo cargado en las últimas horas (las que el local todavía puede corregir)
  async function recientes(localId, horas = 48) {
    const desde = new Date(Date.now() - horas * 3600000).toISOString();
    let q = sb.from("consultas_vista").select(CAMPOS_VISTA).gte("creado_en", desde).order("creado_en", { ascending: false });
    if (localId) q = q.eq("local_id", localId);
    return numeros(chequear(await q));
  }
  // Resumen del día de un local (para el contador de la pantalla de carga)
  async function delDia(localId) {
    const d = R.util.hoy();
    return numeros(chequear(await sb.from("consultas_vista").select("id, estado, anulada, monto_total, dia_consulta, dia_venta")
      .eq("local_id", localId).or(`dia_consulta.eq.${d},dia_venta.eq.${d}`)));
  }

  // ---------- Buscador de productos mientras se escribe (Edge Function buscar-productos) ----------
  // Un resultado por nombre + categoría: [{ clave, nombre, categoria, ruta, categoria_id, cantidad, publicado, imagen }].
  // La clave de la tienda vive en la función; acá solo viaja la sesión. "senal" (AbortController.signal) cancela la
  // consulta anterior cuando se sigue escribiendo.
  const productos = {
    async buscar(q, { limite = 8, senal } = {}) {
      q = String(q || "").trim();
      if (q.length < 2) return [];
      return productos.pedir({ q, limite }, senal);
    },
    // Lo leído con la pistola de código de barras: búsqueda exacta por código de barras o código interno
    async porCodigo(codigo, { senal } = {}) {
      codigo = String(codigo || "").replace(/\s+/g, "");
      if (codigo.length < 3) return [];
      return productos.pedir({ codigo }, senal);
    },
    async pedir(cuerpo, senal) {
      const c = window.CMC_CONFIG, token = await tokenSesion();
      if (!token) throw new Error("La sesión venció. Volvé a ingresar.");
      let r;
      try {
        r = await fetch(c.supabaseUrl.replace(/\/+$/, "") + "/functions/v1/" + (c.funcionBuscarProductos || "buscar-productos"), {
          method: "POST", signal: senal, body: JSON.stringify(cuerpo),
          headers: { Authorization: "Bearer " + token, apikey: c.supabaseKey, "Content-Type": "application/json" },
        });
      } catch (e) {
        if (e.name === "AbortError") throw e;
        throw new Error('No se pudo contactar la función "buscar-productos". ¿Está publicada en Supabase?');
      }
      let j = null;
      try { j = await r.json(); } catch (e) {}
      if (!r.ok) {
        let m = (j && (j.error || j.msg || j.message)) || "La función respondió " + r.status;
        if (/Invalid JWT|UNAUTHORIZED/i.test(m)) m = 'La función rechazó la sesión. En Supabase → Edge Functions → buscar-productos → desactivar "Verify JWT".';
        throw new Error(mensaje({ message: m }));
      }
      return (j && j.resultados) || [];
    },
  };

  const rpc = async (fn, args) => chequear(await sb.rpc(fn, args));
  const guardar = p => rpc("guardar_consulta", { p });
  const cerrar = (id, p) => rpc("cerrar_lo_piensa", { p_id: id, p });
  const anular = (id, motivo) => rpc("anular_consulta", { p_id: id, p_motivo: motivo });

  // ---------- Edge Function admin-usuarios (crear cuentas, contraseñas, habilitar) ----------
  // La clave de servicio vive en la función; acá solo viaja la sesión del admin.
  async function funcionUsuarios(accion, datos = {}) {
    const c = window.CMC_CONFIG, token = await tokenSesion();
    if (!token) throw new Error("La sesión venció. Volvé a ingresar.");
    let r;
    try {
      r = await fetch(c.supabaseUrl.replace(/\/+$/, "") + "/functions/v1/" + (c.funcionUsuarios || "admin-usuarios"), {
        method: "POST", body: JSON.stringify({ accion, ...datos }),
        headers: { Authorization: "Bearer " + token, apikey: c.supabaseKey, "Content-Type": "application/json" },
      });
    } catch (e) {
      throw new Error('No se pudo contactar la función "admin-usuarios". ¿Está publicada en Supabase?');
    }
    let j = null;
    try { j = await r.json(); } catch (e) {}
    if (!r.ok) {
      let m = (j && (j.error || j.msg || j.message)) || "La función respondió " + r.status;
      if (/Invalid JWT|UNAUTHORIZED/i.test(m)) m = 'La función rechazó la sesión. En Supabase → Edge Functions → admin-usuarios → desactivar "Verify JWT".';
      if (r.status === 404) m = 'La función "admin-usuarios" no está publicada en Supabase (ver SUPABASE-SETUP.md).';
      throw new Error(mensaje({ message: m }));
    }
    return j || {};
  }

  // ---------- Administración ----------
  const admin = {
    // usuario: "chimola" o un email; locales: ids (para el rol carga)
    crearUsuario: d => funcionUsuarios("crear", d),
    habilitarUsuario: (id, activo) => funcionUsuarios(activo ? "activar" : "desactivar", { id }),
    cambiarPassword: (id, password) => funcionUsuarios("resetear_password", { id, password }),
    desvincularClerk: id => funcionUsuarios("desvincular_clerk", { id }),
    unirCuentas: (origen, destino) => funcionUsuarios("unir_cuentas", { origen, destino }),
    // { id: último ingreso } (si la función no está publicada, se sigue sin ese dato)
    async ingresos() { try { return (await funcionUsuarios("listar")).ingresos || {}; } catch (e) { return null; } },
    async guardarOpcion(o) {
      const datos = { valor: o.valor, orden: o.orden ?? 0, activo: o.activo ?? true };
      if (o.id) return chequear(await sb.from("opciones").update(datos).eq("id", o.id).select().single());
      return chequear(await sb.from("opciones").insert({ ...datos, local_id: o.local_id, tipo: o.tipo }).select().single());
    },
    async guardarVendedor(v) {
      const datos = { nombre: v.nombre, activo: v.activo ?? true };
      if (v.id) return chequear(await sb.from("vendedores").update(datos).eq("id", v.id).select().single());
      return chequear(await sb.from("vendedores").insert({ ...datos, local_id: v.local_id }).select().single());
    },
    async guardarLocal(l) {
      const datos = { nombre: l.nombre, color: l.color, dias_lo_piensa: l.dias_lo_piensa, horas_edicion: l.horas_edicion,
        dias_carga_atrasada: l.dias_carga_atrasada, activo: l.activo };
      if (l.id) return chequear(await sb.from("locales").update(datos).eq("id", l.id).select().single());
      return chequear(await sb.from("locales").insert(datos).select().single());
    },
    async perfiles() {
      const [perfiles, asignaciones] = await Promise.all([
        sb.from("perfiles").select("*").order("creado_en").then(chequear),
        sb.from("usuarios_locales").select("*").then(chequear),
      ]);
      return perfiles.map(p => ({ ...p, locales: asignaciones.filter(a => a.usuario_id === p.id).map(a => a.local_id) }));
    },
    async actualizarPerfil(id, cambios) {
      return chequear(await sb.from("perfiles").update(cambios).eq("id", id).select().single());
    },
    async asignarLocal(usuarioId, localId, asignar) {
      if (asignar) chequear(await sb.from("usuarios_locales").insert({ usuario_id: usuarioId, local_id: localId }));
      else chequear(await sb.from("usuarios_locales").delete().eq("usuario_id", usuarioId).eq("local_id", localId));
    },
  };

  R.api = { configurado, iniciar, auth, catalogo, consultas, items, itemsDe, abiertos, recientes, delDia, productos, guardar, cerrar, anular, admin };
})(window.CMC);
