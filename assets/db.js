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

  const lc = s => (s||'').toString().trim().toLowerCase();
  const isAdmin = email => (cfg.ADMIN_EMAILS||[]).map(lc).includes(lc(email));
  const demoUsers = () => cfg.DEMO_USERS || [];
  const KEY = email => 'cfx_state_v3_' + lc(email);

  return {
    cloud, isAdmin, demoUsers,
    mode(){ return cloud ? 'nube' : 'demo'; },

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

    async signOut(){
      if (cloud) await sb.auth.signOut();
      else localStorage.removeItem('cfx_demo_user');
    },

    async loadState(user){
      if (cloud){
        const { data, error } = await sb.from('crm_states').select('data').eq('user_id', user.id).maybeSingle();
        if (error) throw new Error(error.message);
        return data ? data.data : null;
      }
      const raw = localStorage.getItem(KEY(user.email));
      return raw ? JSON.parse(raw) : null;
    },

    async saveState(user, state){
      if (cloud){
        const { error } = await sb.from('crm_states').upsert(
          { user_id:user.id, email:user.email, data:state, updated_at:new Date().toISOString() },
          { onConflict:'user_id' });
        if (error) throw new Error(error.message);
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
