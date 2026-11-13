// =====================================================================
//  Vista: pantallas de acceso (falta configurar / login / cargando) y
//  barra del usuario logueado.
// =====================================================================
(function (R) {
  const { $ } = R.util;
  const PANTALLAS = ["pantalla-config", "pantalla-carga", "pantalla-login", "app"];
  const ROLES = { admin: "Admin", carga: "Local", consulta: "Consulta" };

  function mostrar(id) { PANTALLAS.forEach(p => { $(p).hidden = p !== id; }); }

  // rol: el rol con el que se ve la página (el del perfil, o el de prueba si el admin eligió "Ver como")
  function mostrarUsuario(perfil, rol = perfil.rol) {
    const esAdmin = rol === "admin";
    $("usuario-nombre").textContent = perfil.nombre || R.util.aUsuario(perfil.email);
    $("usuario-rol").textContent = (ROLES[rol] || rol) + (rol !== perfil.rol ? " (prueba)" : "");
    $("usuario-rol").classList.toggle("admin", esAdmin);
    document.querySelectorAll("[data-solo-admin]").forEach(el => { el.hidden = !esAdmin; });
  }

  function errorLogin(mensaje) { $("login-error").textContent = mensaje || ""; }

  function iniciar({ alIngresar, alSalir }) {
    $("form-login").addEventListener("submit", async e => {
      e.preventDefault();
      errorLogin("");
      $("login-btn").disabled = true;
      try {
        await R.api.auth.ingresar($("login-email").value, $("login-password").value);
        $("login-password").value = "";
        await alIngresar();
      } catch (err) {
        errorLogin(err.message);
      } finally { $("login-btn").disabled = false; }
    });
    $("salir").addEventListener("click", async () => {
      await R.api.auth.salir();
      alSalir();
      mostrar("pantalla-login");
    });
  }

  R.vistaAcceso = { iniciar, mostrar, mostrarUsuario, errorLogin };
})(window.CMC);
