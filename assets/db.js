/* ===========================================================================
   CAPA DE DATOS + LOGIN — Insitum Capital CRM
   Funciona en DEMO (localStorage, sin internet) o NUBE (Supabase), según config.
   El resto de la app no sabe en cuál está: usa siempre estas funciones.
   =========================================================================== */
window.DB = (function(){
  const cfg = window.APP_CONFIG || {};
  const cloud = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  let sb = null;
  if (cloud) sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // Candado multi-dispositivo: marca de tiempo de la última lectura de la nube.
  // Si otro dispositivo guardó después, saveState avisa (CONFLICT) en vez de pisar.
  let rev = null;

  // Recuperación de contraseña: al entrar por la liga del correo, pedir la nueva.
  if (cloud) sb.auth.onAuthStateChange((ev)=>{
    if (ev === 'PASSWORD_RECOVERY'){
      const np = window.prompt('Escribe tu NUEVA contraseña (mínimo 6 letras o números):');
      if (np) sb.auth.updateUser({ password: np }).then(({ error })=>{
        window.alert(error ? 'No se pudo cambiar: ' + error.message : 'Contraseña cambiada ✓ Ya puedes usarla la próxima vez.');
      });
    }
  });

  const lc = s => (s||'').toString().trim().toLowerCase();
  const isAdmin = email => (cfg.ADMIN_EMAILS||[]).map(lc).includes(lc(email));
  const demoUsers = () => cfg.DEMO_USERS || [];
  const KEY = email => 'cfx_state_v3_' + lc(email);

  async function cloudRev(user){
    if (!cloud) return null;
    const { data, error } = await sb.from('crm_states').select('updated_at').eq('user_id', user.id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? data.updated_at : null;
  }

  return {
    cloud, isAdmin, demoUsers, cloudRev,
    // ¿Se puede crear cuenta desde la app? Solo en nube y si el config lo permite.
    allowSignup: cloud && cfg.ALLOW_SIGNUP !== false,
    mode(){ return cloud ? 'nube' : 'demo'; },
    // ¿La nube tiene una versión más nueva que la última que leímos aquí?
    isNewer(remote){ return !!(cloud && remote && remote !== rev); },

    async currentUser(){
      if (cloud){
        const { data } = await sb.auth.getUser();
        return data.user ? { email:data.user.email, id:data.user.id } : null;
      }
      const e = localStorage.getItem('cfx_demo_user');
      return e ? { email:e, id:e } : null;
    },

    async signIn(email, password){
      if (cloud){
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message);
        return { email:data.user.email, id:data.user.id };
      }
      // DEMO: acepta cualquiera de los socios; la contraseña se ignora.
      if (!demoUsers().some(u => lc(u.email)===lc(email))) throw new Error('Usuario no encontrado');
      localStorage.setItem('cfx_demo_user', email);
      return { email, id:email };
    },

    // Alta de cuenta desde la app. La contraseña la teclea la persona; nunca se guarda aquí.
    // Devuelve {user,confirmar}: si el proyecto pide confirmar correo, no hay sesión todavía.
    async signUp(email, password){
      if (!cloud) throw new Error('Disponible solo en modo nube');
      const { data, error } = await sb.auth.signUp({
        email, password,
        options:{ emailRedirectTo: location.origin + location.pathname }
      });
      if (error) throw new Error(error.message);
      const u = data.user;
      // Supabase devuelve identities=[] cuando el correo YA existe (no revela el usuario).
      if (u && Array.isArray(u.identities) && u.identities.length === 0){
        const e = new Error('Ese correo ya tiene cuenta'); e.code = 'EXISTS'; throw e;
      }
      if (data.session && u) return { user:{ email:u.email, id:u.id }, confirmar:false };
      return { user:null, confirmar:true };
    },

    async signOut(){
      if (cloud) await sb.auth.signOut();
      else localStorage.removeItem('cfx_demo_user');
    },

    async resetPassword(email){
      if (!cloud) throw new Error('Disponible solo en modo nube');
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if (error) throw new Error(error.message);
    },

    async loadState(user){
      if (cloud){
        const { data, error } = await sb.from('crm_states').select('data,updated_at').eq('user_id', user.id).maybeSingle();
        if (error) throw new Error(error.message);
        rev = data ? data.updated_at : null;
        return data ? data.data : null;
      }
      const raw = localStorage.getItem(KEY(user.email));
      return raw ? JSON.parse(raw) : null;
    },

    async saveState(user, state){
      if (cloud){
        // Candado: si la nube cambió desde nuestra última lectura, NO pisar (la app fusiona).
        const remote = await cloudRev(user);
        if (remote && remote !== rev){ const e = new Error('La nube tiene cambios más recientes'); e.code = 'CONFLICT'; throw e; }
        const stamp = new Date().toISOString();
        const { error } = await sb.from('crm_states').upsert(
          { user_id:user.id, email:user.email, data:state, updated_at:stamp },
          { onConflict:'user_id' });
        if (error) throw new Error(error.message);
        rev = stamp;
      } else {
        localStorage.setItem(KEY(user.email), JSON.stringify(state));
      }
    },

    // ADMIN: cartera de todos los socios (solo lectura agregada).
    async loadAll(){
      if (cloud){
        const { data } = await sb.from('crm_states').select('email,data');
        return data || [];
      }
      const out = [];
      for (let i=0;i<localStorage.length;i++){
        const k = localStorage.key(i);
        if (k.startsWith('cfx_state_v3_')){
          try{ out.push({ email:k.slice('cfx_state_v3_'.length), data:JSON.parse(localStorage.getItem(k)) }); }catch(e){}
        }
      }
      return out;
    },
  };
})();
