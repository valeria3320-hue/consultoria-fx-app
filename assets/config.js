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
  SUPABASE_URL: 'https://owvbboityzjezxwlbpaa.supabase.co',        // ej. https://abcd1234.supabase.co
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93dmJib2l0eXpqZXp4d2xicGFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNTU1OTEsImV4cCI6MjA5NTgzMTU5MX0.TXSVONHD-GxLFvWnHVX_X_ULoma6MI6RS6d6vk-GjeI',   // ej. eyJhbGciOi....  (clave pública, segura de exponer)

  // Correos con rol ADMIN (ven la cartera de TODOS los socios).
  // OJO: el admin es OTRO socio, no el usuario principal. Reemplaza por el correo real.
  ADMIN_EMAILS: ['valeria3320@gmail.com'],

  // Registro desde la app ("Crear cuenta" en el login).
  // Dejalo en true SOLO mientras dan de alta a los socios; luego ponlo en false
  // para que nadie mas pueda crear cuentas en el sitio publico.
  ALLOW_SIGNUP: true,

  // Usuarios del MODO DEMO (sin nube). En modo nube NO se usan: el nombre para el
  // saludo se deduce del propio correo, para no publicar correos personales aqui
  // (este archivo se sirve publico junto con la app).
  DEMO_USERS: [
    { email: 'socio1@insitum.mx', nombre: 'Socio 1' },
    { email: 'socio2@insitum.mx', nombre: 'Socio 2' },
  ],
};
