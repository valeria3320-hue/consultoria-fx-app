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
  // ---------------------------------------------------------------------------
  // MODO SIN NUBE (actual): sin contraseñas, sin correos, nunca se pausa ni se
  // borra. Los datos viven en el dispositivo de cada quien.
  //
  // PARA VOLVER A LA NUBE algun dia: crear un proyecto en supabase.com, correr
  // supabase.sql, y pegar aqui abajo la Project URL y la anon key. La app cambia
  // sola de modo. (El proyecto anterior, owvbboityzjezxwlbpaa, fue ELIMINADO por
  // Supabase tras quedar pausado: en el plan gratuito eso pasa si no se usa.)
  // ---------------------------------------------------------------------------
  SUPABASE_URL: '',        // ej. https://abcd1234.supabase.co
  SUPABASE_ANON_KEY: '',   // ej. eyJhbGciOi....  (clave pública, segura de exponer)

  // Quien ve la pestaña "Equipo" (carteras de todos, solo lectura).
  ADMIN_EMAILS: ['valeria'],

  // Registro desde la app. Solo aplica en modo nube; sin nube no hay contraseñas.
  ALLOW_SIGNUP: false,

  // Quien entra a la app. Cada uno elige su nombre y tiene SU propia cartera.
  // El "id" NO es un correo a proposito: este archivo se publica con la app y no
  // queremos exponer correos personales. Solo es la etiqueta de su cartera local.
  DEMO_USERS: [
    { email: 'gori',    nombre: 'Gori' },
    { email: 'valeria', nombre: 'Valeria' },
  ],
};
