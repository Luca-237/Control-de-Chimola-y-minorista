// =====================================================================
//  Arranque: sesión, local elegido y navegación entre secciones.
//  Cada rol ve solo lo suyo:
//    carga     -> Cargar, Lo piensan, Recientes (pantallas simples del local)
//    consulta  -> Tablero, Planilla, Lo piensan
//    admin     -> todo, más Configuración de listas y Usuarios
//  El admin puede "ver como" operador o consulta para probar cómo se siente
//  la página: cambia lo que ve, y lo que cargue en ese modo NO se guarda
//  (R.estado.verComo; las escrituras se frenan en envolverEscrituras).
// =====================================================================
(function (R) {
  const { $, esc, pref } = R.util;
  const VISTAS = {
    tablero: { v: () => R.vistaTablero, roles: ["admin", "consulta"] },
    planilla: { v: () => R.vistaPlanilla, roles: ["admin", "consulta"] },
    cargar: { v: () => R.vistaCargar, roles: ["admin", "carga"] },
    abiertos: { v: () => R.vistaAbiertos, roles: ["admin", "carga", "consulta"] },
    recientes: { v: () => R.vistaRecientes, roles: ["admin", "carga"] },
    configuracion: { v: () => R.vistaConfiguracion, roles: ["admin", "carga", "consulta"] },
    usuarios: { v: () => R.vistaUsuarios, roles: ["admin"] },
  };
  let vistaActual = null;

  // El rol con el que se ve la página (el real, o el de prueba si el admin eligió "Ver como")
  const rolReal = () => (R.estado.perfil ? R.estado.perfil.rol : null);
  const rol = () => R.estado.verComo || rolReal();
  const ROL_TEXTO = { carga: "el operador de un local", consulta: "un usuario de consulta" };
  const app = {
    esAdmin: () => rol() === "admin",
    enPrueba: () => !!R.estado.verComo,
    puedeCargar: () => ["admin", "carga"].includes(rol()),
    inicio: () => (rol() === "carga" ? "cargar" : "tablero"),
    refrescar() { if (vistaActual) VISTAS[vistaActual].v().mostrar(); },

    // Selector de local de la barra. Admin y consulta pueden ver "Todos los locales".
    pintarLocales() {
      const { misLocales } = R.estado.catalogo;
      const todos = rol() !== "carga";
      const guardado = pref.leer("local", todos ? 0 : (misLocales[0] || {}).id);
      const elegido = misLocales.find(l => l.id === guardado) || (todos ? null : misLocales[0]) || null;
      R.estado.local = elegido;
      const caja = $("local-actual");
      caja.hidden = !misLocales.length;
      caja.style.setProperty("--c", elegido ? elegido.color : "var(--negro)");
      if ($("banner-prueba") && !$("banner-prueba").hidden) setTimeout(() => app.pintarBanner(), 0);
      const sel = $("local-selector");
      if (misLocales.length === 1 && !todos) {
        sel.hidden = true;
        $("local-nombre").hidden = false;
        $("local-nombre").textContent = elegido ? elegido.nombre : "";
      } else {
        sel.hidden = false;
        $("local-nombre").hidden = true;
        sel.innerHTML = (todos ? `<option value="0">Todos los locales</option>` : "")
          + misLocales.map(l => `<option value="${l.id}">${esc(l.nombre)}${l.activo ? "" : " (inactivo)"}</option>`).join("");
        sel.value = String(elegido ? elegido.id : 0);
      }
    },

    // Menú, rol mostrado y cajas solo para admin, según el rol con el que se ve la página
    aplicarMenu() {
      document.querySelectorAll(".lateral a[data-vista]").forEach(a => { a.hidden = !VISTAS[a.dataset.vista].roles.includes(rol()); });
      R.vistaAcceso.mostrarUsuario(R.estado.perfil, rol());
    },

    // El aviso amarillo de arriba mientras el admin prueba como otro rol
    pintarBanner() {
      const caja = $("banner-prueba");
      caja.hidden = !R.estado.verComo;
      $("lateral-volver").hidden = !R.estado.verComo;
      $("ver-como-caja").classList.toggle("activo", !!R.estado.verComo);
      if (!R.estado.verComo) return;
      const l = R.estado.local;
      $("banner-prueba-texto").innerHTML = `Estás viendo la página como la ve <strong>${ROL_TEXTO[R.estado.verComo]}</strong>${R.estado.verComo === "carga" && l ? ` (${esc(l.nombre)})` : ""}. `
        + `Probala con confianza: lo que cargues o cambies <strong>no se guarda</strong>.`;
    },

    // Elegir "Ver como": "" = administrador (la vista normal), "carga" = operador, "consulta" = consulta
    verComo(valor) {
      if (rolReal() !== "admin") return;
      R.estado.verComo = valor || null;
      $("ver-como").value = valor || "";
      app.aplicarMenu();
      app.pintarLocales();
      app.pintarBanner();
      R.vistaTablero.olvidar();
      app.contadores();
      const destino = location.hash.replace("#", "");
      if (!VISTAS[destino] || !VISTAS[destino].roles.includes(rol())) location.hash = "#" + app.inicio();
      else ir();
    },

    // Cantidad de "Lo piensa" abiertos en el menú, y la campanita con los que pasan las 48 horas
    // (soloAvisos: el repaso periódico, que no tiene por qué borrar lo que el tablero ya calculó)
    async contadores({ soloAvisos = false } = {}) {
      try {
        const filas = await R.api.abiertos(R.estado.local ? R.estado.local.id : null);
        const abiertos = filas.filter(c => c.estado_efectivo === "lo_piensa").length;
        const el = $("contador-abiertos");
        el.textContent = abiertos;
        el.hidden = !abiertos;
        R.avisos.pintar(filas);
      } catch (e) { /* el contador es un extra: si falla no se avisa */ }
      if (!soloAvisos) R.vistaTablero.olvidar();
    },
  };
  R.app = app;

  function ir() {
    let nombre = location.hash.replace("#", "") || app.inicio();
    if (!VISTAS[nombre] || !VISTAS[nombre].roles.includes(rol())) nombre = app.inicio();
    vistaActual = nombre;
    document.querySelectorAll("[data-seccion]").forEach(s => { s.hidden = s.id !== "vista-" + nombre; });
    document.querySelectorAll(".lateral a").forEach(a => a.classList.toggle("activo", a.dataset.vista === nombre));
    $("lateral").classList.remove("abierto");
    VISTAS[nombre].v().mostrar();
  }

  // Si la base o la cuenta Cindy no contestan, no se queda la pantalla de carga para siempre
  const ESPERA_INGRESO_MS = 20000;
  const conLimite = (promesa, mensaje) => Promise.race([promesa,
    new Promise((_, mal) => setTimeout(() => mal(new Error(mensaje)), ESPERA_INGRESO_MS))]);
  // Vuelve al login con el error a la vista
  function alLogin(mensaje) {
    R.estado.perfil = null;
    R.vistaAcceso.mostrarCindy();
    R.vistaAcceso.mostrar("pantalla-login");
    R.vistaAcceso.errorLogin(mensaje);
  }

  // Un solo ingreso a la vez (el login, la cuenta Cindy y el aviso de Clerk pueden pedirlo juntos)
  let entrando = null;
  function entrar() {
    if (!entrando) entrando = entrarAhora().catch(e => alLogin(e.message)).finally(() => { entrando = null; });
    return entrando;
  }

  async function entrarAhora() {
    R.vistaAcceso.mostrar("pantalla-carga");
    const cindy = R.api.auth.via && R.api.auth.via() === "clerk";
    const sinRespuesta = cindy
      ? "La cuenta Cindy no respondió a tiempo. Probá de nuevo, o entrá con tu usuario de siempre."
      : "La base de datos no respondió a tiempo. Revisá internet y probá de nuevo.";
    let perfil;
    try { perfil = await conLimite(R.api.auth.miPerfil(), sinRespuesta); }
    catch (e) { return alLogin(e.message); }
    if (!perfil || !perfil.activo) {
      // Cuenta Cindy sin habilitar acá pero con sesión del login propio: usar esa
      if (cindy && await R.api.auth.sesion({ ignorarClerk: true })) return entrarAhora();
      // La cuenta Cindy no se cierra: le sirve en las otras apps
      if (!cindy) await R.api.auth.salir();
      R.vistaAcceso.mostrarCindy();
      R.vistaAcceso.mostrar("pantalla-login");
      return R.vistaAcceso.errorLogin(cindy
        ? "Tu cuenta Cindy todavía no está habilitada acá. Pedile a un admin que la habilite, o entrá con tu usuario de siempre."
        : "Tu usuario no está habilitado. Hablá con un admin.");
    }
    R.estado.perfil = perfil;
    try { R.estado.catalogo = await conLimite(R.api.catalogo(perfil), sinRespuesta); }
    catch (e) { return alLogin(e.message); }
    if (perfil.rol === "carga" && !R.estado.catalogo.misLocales.length) {
      if (!cindy) await R.api.auth.salir();
      return alLogin("Tu usuario no tiene ningún local asignado. Hablá con un admin.");
    }
    R.estado.verComo = null;
    $("ver-como").value = "";
    $("ver-como-caja").hidden = perfil.rol !== "admin";
    app.aplicarMenu();
    app.pintarBanner();
    app.pintarLocales();
    R.vistaAcceso.mostrar("app");
    ir();
    app.contadores();
  }

  async function entrarConCindy() {
    if (await R.api.auth.sesion()) await entrar();
    else alLogin("No se pudo abrir la cuenta Cindy. Probá de nuevo, o entrá con tu usuario de siempre.");
  }

  function salir() {
    R.estado = { perfil: null, catalogo: null, local: null };
    vistaActual = null;
    R.avisos.pintar([]);
  }

  // Mientras el admin prueba como otro rol, guardar, cerrar y anular no llegan a la base: responden como si hubieran
  // funcionado (y los avisos lo aclaran). Así se puede probar el recorrido completo sin ensuciar los datos.
  function envolverEscrituras() {
    for (const k of ["guardar", "cerrar", "anular"]) {
      const original = R.api[k];
      R.api[k] = (...a) => (R.estado.verComo
        ? new Promise(ok => setTimeout(() => ok(k === "anular" ? undefined : -1), 350))
        : original(...a));
    }
    const toast = R.util.toast;
    R.util.toast = (texto, tipo, ms, accion) => toast(
      R.estado.verComo && tipo !== "error" && /guardad|anulad|deshizo|cerrada/i.test(texto) ? texto.replace(/\.$/, "") + " (prueba: no se guardó nada)." : texto, tipo, ms, accion);
  }

  async function arrancar() {
    R.estado = { perfil: null, catalogo: null, local: null };
    R.util.iniciarTema();
    if (!R.api.configurado()) return R.vistaAcceso.mostrar("pantalla-config");
    try { R.api.iniciar(); }
    catch (e) { R.vistaAcceso.mostrar("pantalla-login"); return R.vistaAcceso.errorLogin(e.message); }

    envolverEscrituras();
    R.util.iniciarDialogos();
    R.util.iniciarAyudas();
    R.vistaAcceso.iniciar({ alIngresar: entrar, alIngresarCindy: entrarConCindy, alSalir: salir });
    // El texto de cada opción del menú va en su propio <span> para que, con el menú recogido, queden solo los iconos
    document.querySelectorAll(".lateral a").forEach(l => {
      const texto = [...l.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
      if (!texto.length || l.querySelector(".lateral-txt")) return;
      const s = document.createElement("span");
      s.className = "lateral-txt";
      s.textContent = texto.map(n => n.textContent.trim()).join(" ");
      l.title = s.textContent;
      texto.forEach(n => n.remove());
      const svg = l.querySelector("svg");
      (svg ? svg.after(s) : l.prepend(s));
    });
    Object.values(VISTAS).forEach(x => x.v().iniciar());
    R.avisos.iniciar();
    // Con la página abierta todo el día, la campanita se repasa cada 5 minutos (y al volver a la pestaña)
    setInterval(() => { if (R.estado.perfil && !document.hidden) app.contadores({ soloAvisos: true }); }, 5 * 60000);
    document.addEventListener("visibilitychange", () => { if (R.estado.perfil && !document.hidden) app.contadores({ soloAvisos: true }); });

    $("local-selector").addEventListener("change", e => {
      pref.guardar("local", Number(e.target.value));
      app.pintarLocales();
      app.contadores();
      app.refrescar();
    });
    $("ver-como").addEventListener("change", e => app.verComo(e.target.value));
    $("banner-prueba-volver").addEventListener("click", () => app.verComo(""));
    // También desde el menú (queda a mano en el celular, con el aviso fuera de la vista)
    $("lateral-volver").addEventListener("click", e => { e.preventDefault(); $("lateral").classList.remove("abierto"); app.verComo(""); location.hash = "#tablero"; });
    $("btn-actualizar").addEventListener("click", async () => {
      try { R.estado.catalogo = await R.api.catalogo(R.estado.perfil); app.pintarLocales(); } catch (e) {}
      R.vistaTablero.olvidar();
      app.refrescar();
      app.contadores();
      R.util.toast("Datos actualizados.");
    });
    window.addEventListener("hashchange", () => { if (R.estado.perfil) ir(); });
    try { if (localStorage.getItem("cmc-lateral") === "oculto") $("app").classList.add("sin-lateral"); } catch (e) {}
    $("btn-menu").addEventListener("click", () => {
      if (window.matchMedia("(max-width: 900px)").matches) return $("lateral").classList.toggle("abierto");
      const oculto = $("app").classList.toggle("sin-lateral");
      try { localStorage.setItem("cmc-lateral", oculto ? "oculto" : "visible"); } catch (e) {}
    });
    // Tocar fuera del menú en el celular lo cierra
    document.addEventListener("click", e => {
      if ($("lateral").classList.contains("abierto") && !e.target.closest("#lateral, #btn-menu")) $("lateral").classList.remove("abierto");
    });

    // Cuenta Cindy: si no está configurada o no carga, sigue solo el login propio
    if (window.CuentaCindy) await window.CuentaCindy.cargar((window.CMC_CONFIG || {}).clerkPublishableKey);
    R.vistaAcceso.mostrarCindy();

    R.api.auth.alCambiar(evento => {
      if (evento === "SIGNED_OUT" && (!R.api.auth.via || R.api.auth.via() !== "clerk")) { salir(); R.vistaAcceso.mostrar("pantalla-login"); }
    });
    // Al terminar de entrar en el cuadro de Clerk se entra acá también. No se espera a que Clerk recargue la
    // página: con un "#" en la dirección (#cargar, #tablero…) no recarga y la pantalla quedaba quieta, sin error.
    // Se intenta una vez por sesión de Clerk (Clerk avisa de nuevo cada vez que renueva el token).
    let sesionCindyVista = null;
    if (window.CuentaCindy) window.CuentaCindy.alCambiar(({ session }) => {
      R.vistaAcceso.mostrarCindy();
      if (session && session.id !== sesionCindyVista && !R.estado.perfil && !$("pantalla-login").hidden) {
        sesionCindyVista = session.id;
        R.vistaAcceso.errorLogin("");
        entrarConCindy();
      }
      if (R.api.auth.via && R.api.auth.via() === "clerk" && !session && R.estado.perfil) { // se cerró desde otra app
        salir();
        R.vistaAcceso.mostrar("pantalla-login");
      }
    });

    if (await R.api.auth.sesion()) await entrar();
    else R.vistaAcceso.mostrar("pantalla-login");
  }

  // Modo de prueba sin base de datos: solo en la PC (abrir con ?demo=admin | carga | consulta)
  const local = location.protocol === "file:" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  function cargarDemo() {
    return new Promise((ok, mal) => {
      const s = document.createElement("script");
      s.src = "pruebas/api-falsa.js?v=" + Date.now();
      s.onload = ok; s.onerror = () => mal(new Error("No se encontró pruebas/api-falsa.js"));
      document.head.appendChild(s);
    });
  }

  (document.fonts ? document.fonts.ready : Promise.resolve())
    .then(() => (local && /[?&]demo\b/.test(location.search) ? cargarDemo() : null))
    .then(arrancar)
    .catch(e => { R.vistaAcceso.mostrar("pantalla-login"); R.vistaAcceso.errorLogin(e.message); });
})(window.CMC);
