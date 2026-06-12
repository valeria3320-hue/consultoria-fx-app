/* ===========================================================================
   CONFIGURACIÓN — Insitum Capital CRM
   ---------------------------------------------------------------------------
   Para activar la NUBE (login real + datos compartidos por agente):
   1. Crea un proyecto gratis en https://supabase.com
   2. Copia "Project URL" y "anon public key" (Settings → API) abajo.
   3. Guarda este archivo. Listo: la app cambia sola de demo a nube.
   Si lo dejas vacío, la app funciona en MODO DEMO local (sin internet).
   =========================================================================== */
window.APP_CONFIG = {
  SUPABASE_URL: '',        // ej. https://abcd1234.supabase.co
  SUPABASE_ANON_KEY: '',   // ej. eyJhbGciOi....  (clave pública, segura de exponer)

  // Correos con rol ADMIN (ven la cartera de TODOS los socios).
  // OJO: el admin es OTRO socio, no el usuario principal. Reemplaza por el correo real.
  ADMIN_EMAILS: ['socio2@insitum.mx'],

  // Los 3 socios. En MODO DEMO se entra eligiéndolos; en la nube se crean en Supabase.
  // Reemplaza nombres y correos por los reales de cada socio.
  DEMO_USERS: [
    { email: 'socio1@insitum.mx', nombre: 'Socio 1 (tú)' },
    { email: 'socio2@insitum.mx', nombre: 'Socio 2 — Administrador' },
    { email: 'socio3@insitum.mx', nombre: 'Socio 3' },
  ],
};
