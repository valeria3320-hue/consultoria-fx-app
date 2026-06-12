# Activar la NUBE (login real + 3 socios + datos sincronizados)

La app ya funciona en **modo demo** (local). Para que los 3 socios entren con contraseña
desde cualquier computadora y el administrador vea la cartera de todos, sigue estos pasos
**una sola vez**. No necesitas saber programar: es copiar y pegar.

> Mientras no hagas esto, la app sigue funcionando en demo (local) sin problema.

---

## 1. Crear la base de datos gratis (Supabase) — 5 min
1. Entra a **https://supabase.com** → *Start your project* → regístrate (puedes usar tu GitHub).
2. *New project*: ponle nombre (ej. `insitum-crm`), elige una contraseña de base de datos y la región más cercana (US East). *Create*.
3. Espera ~2 min a que diga **Active**.

## 2. Crear las tablas — 1 min
1. En el menú lateral: **SQL Editor** → *New query*.
2. Abre el archivo **`supabase.sql`** de este proyecto, copia TODO y pégalo.
3. **Cambia el correo** `socio2@insitum.mx` por el correo real del socio administrador.
4. Presiona **Run**. Debe decir *Success*.

## 3. Conectar la app — 1 min
1. En Supabase: **Project Settings → API**.
2. Copia **Project URL** y la llave **anon public**.
3. Abre **`assets/config.js`** y pégalas:
   ```js
   SUPABASE_URL: 'https://TU-PROYECTO.supabase.co',
   SUPABASE_ANON_KEY: 'eyJhbGciOi....',
   ADMIN_EMAILS: ['correo-del-socio-admin@...'],   // el mismo del paso 2.3
   ```
4. Guarda el archivo. La app cambia sola a **modo nube**.

## 4. Crear los 3 usuarios — 2 min
1. En Supabase: **Authentication → Users → Add user**.
2. Crea uno por socio con su **correo** y una **contraseña** (compártela con cada quien).
   - Marca *Auto Confirm User* para que entren sin verificar correo.
3. El que pusiste en `ADMIN_EMAILS` será el administrador (verá la cartera de todos).

## 5. Publicar la app en línea (para que entren desde cualquier lado)
Como la app necesita una dirección web, la opción más simple:
- **Netlify Drop:** entra a **https://app.netlify.com/drop** y arrastra la carpeta del proyecto. Te da una URL al instante. (Gratis.)
- **O GitHub Pages:** requiere el repositorio **público** (Settings → Pages). El código es público pero **los datos NO**: viven en Supabase, protegidos por contraseña y por permisos (cada socio solo ve lo suyo). La llave `anon` está diseñada para ser pública.

> ¿Prefieres que yo te guíe en vivo en cualquiera de estos pasos? Avísame y lo hacemos juntos.

---

### ¿Es seguro tener el código público?
Sí. El código es solo la **interfaz**. El acceso a los datos está protegido por:
- **Login con contraseña** (Supabase Auth).
- **Permisos por fila (RLS):** cada socio solo puede leer/escribir su propia cartera; el admin solo lee. Nadie ve datos sin iniciar sesión.
