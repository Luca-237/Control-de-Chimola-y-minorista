// =====================================================================
//  Conexión con Supabase. Estos dos valores son PÚBLICOS (van en el
//  navegador de todos modos): lo que protege los datos son los permisos
//  de la base (RLS). La clave "secret" NUNCA va acá.
//  Paso a paso en SUPABASE-SETUP.md.
// =====================================================================
window.CMC_CONFIG = {
  supabaseUrl: "https://judtduhuqbzynrpgtysi.supabase.co",   // proyecto "minorista y chimola" (sa-east-1, São Paulo)
  supabaseKey: "sb_publishable_0WjKCQfNPhDt7gdkL5ibrg_kPsPaGVt",   // clave "publishable"
  // "chimola" -> "chimola@minorista.cindymayorista.com.ar" (no hace falta que el email exista)
  dominioUsuarios: "minorista.cindymayorista.com.ar",
  // Cuántos meses hacia atrás se pueden consultar en el tablero (para no traer años de datos de una vez)
  mesesMaximos: 24,
  // Cuenta Cindy (Clerk). Clave publicable (pk_live_... o pk_test_...), no es secreta.
  // Vacía = solo el login propio.
  clerkPublishableKey: "pk_test_bmljZS1hcmFjaG5pZC04ODY0LmNsZXJrLmFjY291bnRzLmRldiQ",
};
