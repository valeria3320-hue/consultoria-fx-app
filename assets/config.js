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
  // MODO NUBE: login por correo + datos sincronizados entre dispositivos.
  // Para trabajar SIN nube (sin contraseñas, todo local), deja estos dos vacios:
  // la app cambia sola de modo.
  //
  // OJO plan gratuito: si el proyecto pasa ~7 dias sin uso, Supabase lo PAUSA
  // (su direccion deja de existir y la app avisa con la liga para reactivarlo).
  // Se restaura desde el panel; los datos quedan a salvo ~90 dias.
  // ---------------------------------------------------------------------------
  SUPABASE_URL: 'https://owvbboityzjezxwlbpaa.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93dmJib2l0eXpqZXp4d2xicGFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNTU1OTEsImV4cCI6MjA5NTgzMTU5MX0.TXSVONHD-GxLFvWnHVX_X_ULoma6MI6RS6d6vk-GjeI',

  // Quien ve la pestaña "Equipo". Se deja VACIO a proposito: en modo nube el rol
  // lo determina el servidor (la politica admin_select_all de supabase.sql), asi
  // no hay que publicar correos personales en este archivo, que es publico.
  ADMIN_EMAILS: [],

  // Registro desde la app ("Crear cuenta"). CERRADO: los socios ya estan dentro,
  // asi nadie con el link puede crear cuentas. Ponlo en true si hay que dar de
  // alta a alguien mas (y vuelvelo a cerrar despues).
  ALLOW_SIGNUP: false,

  // Quien entra a la app. Cada uno elige su nombre y tiene SU propia cartera.
  // El "id" NO es un correo a proposito: este archivo se publica con la app y no
  // queremos exponer correos personales. Solo es la etiqueta de su cartera local.
  DEMO_USERS: [
    { email: 'gori',    nombre: 'Gori' },
    { email: 'valeria', nombre: 'Valeria' },
  ],
};
