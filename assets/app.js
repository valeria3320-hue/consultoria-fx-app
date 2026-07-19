/* ===========================================================================
   Insitum Capital — CRM (v3)
   Login multiusuario (3 socios), cartera por agente, admin ve a todos.
   Pipeline, cotizador, citas Outlook, notas de mercado por industria.
   Datos vía capa DB (demo localStorage o nube Supabase). Sin frameworks.
   =========================================================================== */
'use strict';

/* ---------- Catálogos ---------- */
const STAGES = ['Cliente nuevo','Contactado','Reunión','Propuesta','Negociación','Ganado','Cliente recurrente','Perdido'];
const OPEN_STAGES = ['Cliente nuevo','Contactado','Reunión','Propuesta','Negociación'];
const WON_STAGES = ['Ganado','Cliente recurrente'];
const STAGE_COLOR = {'Cliente nuevo':'#4c8dff','Contactado':'#a371f7','Reunión':'#e3b341','Propuesta':'#2dd4bf','Negociación':'#d29922','Ganado':'#3fb950','Cliente recurrente':'#1f9d57','Perdido':'#f85149'};

const MARKET = [
  {k:'usdmxn',label:'USD/MXN',unit:''},{k:'eurusd',label:'EUR/USD',unit:''},{k:'eurmxn',label:'EUR/MXN',unit:''},
  {k:'brent',label:'Brent',unit:'USD'},{k:'wti',label:'WTI',unit:'USD'},{k:'gasnat',label:'Gas natural',unit:'USD'},
  {k:'oro',label:'Oro',unit:'USD/oz'},{k:'cobre',label:'Cobre',unit:'USD/lb'},{k:'aluminio',label:'Aluminio',unit:'USD/t'},
  {k:'maiz',label:'Maíz',unit:'USD/bu'},{k:'trigo',label:'Trigo',unit:'USD/bu'},{k:'soya',label:'Soya',unit:'USD/bu'},
  {k:'cafe',label:'Café',unit:'USD/lb'},{k:'azucar',label:'Azúcar',unit:'USD/lb'},
  {k:'sp500',label:'S&P 500',unit:''},{k:'banxico',label:'Tasa Banxico',unit:'%'},{k:'cetes',label:'Cetes 28d',unit:'%'},{k:'ust10',label:'UST 10a',unit:'%'},
];
const MLAB = Object.fromEntries(MARKET.map(m=>[m.k,m]));
const XLAB = {dow:'Dow Jones',nasdaq:'Nasdaq',ipcmx:'IPC México',nikkei:'Nikkei',dax:'DAX',vix:'VIX',plata:'Plata',dxy:'DXY (índice dólar)'};
function lbl(k){ return MLAB[k]?MLAB[k].label:(XLAB[k]||k); }

const COT_TIPOS = {
  ahorro:{label:'Ahorro en FX / Transferencias',cur:'MXN',fields:[
    {k:'montoUSD',label:'Monto por operación (USD)',ph:'100000'},{k:'opsAnio',label:'Operaciones al año',ph:'12'},
    {k:'tcBanco',label:'Spread del banco (centavos por USD)',ph:'0.20',step:'0.01'},{k:'tcTuyo',label:'Tu spread (centavos por USD)',ph:'0.08',step:'0.01'}]},
  forward:{label:'Cobertura con Forward',cur:'MXN',fields:[
    {k:'montoUSD',label:'Monto a cubrir (USD)',ph:'500000'},{k:'spot',label:'Tipo de cambio spot',ph:'17.15',step:'0.0001'},
    {k:'tasaMXN',label:'Tasa MXN (% anual)',ph:'10.5',step:'0.01'},{k:'tasaUSD',label:'Tasa USD (% anual)',ph:'5.0',step:'0.01'},
    {k:'dias',label:'Plazo (días)',ph:'90'},{k:'adverso',label:'Movimiento adverso a simular (%)',ph:'5'}]},
  commodity:{label:'Cobertura de commodities',cur:'USD',fields:[
    {k:'insumo',label:'Insumo',ph:'Turbosina / Maíz / Cobre',type:'text'},{k:'volumen',label:'Volumen anual (unidades)',ph:'1000000'},
    {k:'precio',label:'Precio actual (USD/unidad)',ph:'2.50',step:'0.01'},{k:'adverso',label:'Alza a simular (%)',ph:'10'}]},
  inversion:{label:'Inversión / Rendimiento',cur:'',fields:[
    {k:'monto',label:'Monto a invertir',ph:'1000000'},{k:'tasa',label:'Tasa anual (%)',ph:'11.0',step:'0.01'},{k:'dias',label:'Plazo (días)',ph:'28'}]},
};

/* ---------- Estado / sesión ---------- */
let state, ME=null, saveTimer=null;
let ui = { view:'midia', search:'', filtroSeg:'', filtroProd:'', filtroEtapa:'', filtroDatos:'', noteFmt:'whatsapp', noteModo:'apertura', noteAlcance:'industria', noteIndustria:'', cotTipo:'ahorro', cotCliente:'', cotText:'', perfCliente:'', perfText:'', perfData:null, propJugada:'fx_importador', propCliente:'', propText:'', propData:null };

function migrate(s){
  if(!s.brand) s.brand='Insitum Capital';
  if(!s.products||!s.products.length) s.products=defaultProducts();
  if(!s.industries||!s.industries.length) s.industries=defaultIndustries();
  if(!s.market) s.market={};
  if(!s.notes) s.notes=[];
  (s.prospects||[]).forEach(p=>{ if(p.etapa==='Prospecto')p.etapa='Cliente nuevo'; if(p.etapa==='Cliente activo')p.etapa='Cliente recurrente'; p.actividades=p.actividades||[]; p.stageHistory=p.stageHistory||[]; });
  return s;
}
let savePending=false, lastPull=0;
function save(){
  if(!ME) return; state.meta={version:3,updated:new Date().toISOString()};
  if(saveTimer)clearTimeout(saveTimer);
  saveTimer=setTimeout(doSave,350);
}
async function doSave(){
  if(!ME||!state) return;
  if(saveTimer){ clearTimeout(saveTimer); saveTimer=null; }
  try{
    await DB.saveState(ME,state);
    if(savePending){ savePending=false; syncBanner(false); toast('Cambios guardados ✓'); }
  }catch(e){
    if(e&&e.code==='CONFLICT'){
      // Otro dispositivo guardó primero: fusionar sin perder nada y reintentar.
      try{
        const cloudState=await DB.loadState(ME);
        if(cloudState) state=migrate(mergeStates(state,cloudState));
        await DB.saveState(ME,state);
        savePending=false; syncBanner(false);
        render(); toast('Se combinaron cambios de otro dispositivo ✓');
        return;
      }catch(e2){ e=e2; }
    }
    savePending=true; syncBanner(true);
    // Si el fallo es de red, averiguar si es internet o el servidor dormido.
    if(DB.cloud && /failed to fetch|networkerror|load failed|network request/i.test((e&&e.message)||'')){
      diagnosticarRed().then(d=>{
        if(d==='servidorDormido' && savePending)
          syncBanner(true,'⚠️ Tus cambios NO se han guardado. '+HTML_SERVIDOR_DORMIDO());
      }).catch(()=>{});
    }
  }
}
function syncBanner(on,html){
  const b=$('#sync-banner'); if(!b) return;
  if(on) b.innerHTML = html || '⚠️ Sin conexión — tus cambios NO se han guardado. Reintentando… no cierres la app.';
  b.classList.toggle('hidden',!on);
}
window.addEventListener('online',()=>{ if(savePending)doSave(); });
setInterval(()=>{ if(savePending)doSave(); },20000);
function flushSave(){ if(ME&&state){ if(saveTimer)clearTimeout(saveTimer); DB.saveState(ME,state).catch(()=>{}); } }

// Fusión de dos versiones de la cartera (este dispositivo vs nube): gana la más
// reciente en campos generales, pero clientes, actividades y notas se UNEN — nada se pierde.
function mergeStates(a,b){
  const newer=(new Date((a.meta&&a.meta.updated)||0)>=new Date((b.meta&&b.meta.updated)||0))?a:b;
  const older=(newer===a)?b:a;
  const out=JSON.parse(JSON.stringify(newer));
  out.prospects=out.prospects||[];
  const byId=new Map(out.prospects.map(p=>[p.id,p]));
  (older.prospects||[]).forEach(p=>{
    const q=byId.get(p.id);
    if(!q){ out.prospects.push(p); return; }
    q.actividades=q.actividades||[]; q.stageHistory=q.stageHistory||[];
    const aid=new Set(q.actividades.map(x=>x.id));
    (p.actividades||[]).forEach(x=>{ if(!aid.has(x.id))q.actividades.push(x); });
    const sh=new Set(q.stageHistory.map(x=>JSON.stringify(x)));
    (p.stageHistory||[]).forEach(x=>{ if(!sh.has(JSON.stringify(x)))q.stageHistory.push(x); });
  });
  out.notes=out.notes||[];
  const nid=new Set(out.notes.map(n=>n.id));
  ((older.notes)||[]).forEach(n=>{ if(!nid.has(n.id))out.notes.push(n); });
  return out;
}

// Al volver a la app (cambio de pestaña / desbloquear el cel), bajar cambios de la nube.
async function pullIfStale(){
  if(!DB.cloud||!ME||!state) return;
  if(saveTimer||savePending) return;                 // hay cambios locales en vuelo
  if(Date.now()-lastPull<30000) return; lastPull=Date.now();
  try{
    const remote=await DB.cloudRev(ME);
    if(DB.isNewer(remote)){
      const cs=await DB.loadState(ME);
      if(cs){ state=migrate(mergeStates(state,cs)); render(); toast('Datos actualizados desde la nube ✓'); }
    }
  }catch(e){}
}
document.addEventListener('visibilitychange',()=>{ if(!document.hidden)pullIfStale(); });
window.addEventListener('focus',pullIfStale);

// Liga al panel del proyecto Supabase (deducida de la URL, sin hardcodear).
function supabaseDashboardUrl(){
  const m=((window.APP_CONFIG||{}).SUPABASE_URL||'').match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m? 'https://supabase.com/dashboard/project/'+m[1] : 'https://supabase.com/dashboard';
}
// Distingue "no hay internet" de "el servidor de datos está dormido".
// Si alcanzamos NUESTRO sitio pero no Supabase, el problema es Supabase (free tier pausado).
async function diagnosticarRed(){
  if(!navigator.onLine) return 'sinInternet';
  try{ await fetch('manifest.json?ping='+Date.now(),{cache:'no-store'}); }
  catch(e){ return 'sinInternet'; }
  return 'servidorDormido';
}
const HTML_SERVIDOR_DORMIDO = ()=>
  `El servidor de datos está <b>dormido</b> (se pausa solo tras varios días sin uso). `
  +`<a href="${supabaseDashboardUrl()}" target="_blank" rel="noopener"><b>Reactivarlo aquí</b></a> `
  +`→ botón <b>Resume project</b>. Tarda 1–2 min; luego recarga esta página y entra.`;

// Errores técnicos -> español claro (para un operador no técnico).
function errMsg(e){
  const m=(e&&e.message)||'';
  if(/invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos';
  if(/email not confirmed/i.test(m)) return 'Falta confirmar tu correo: abre el enlace que te enviamos (revisa spam). La página que abra puede verse con error — no importa, con eso queda confirmado.';
  if(/failed to fetch|networkerror|load failed|network request/i.test(m)) return 'Sin internet. Revisa tu conexión e intenta de nuevo.';
  if(/rate limit|too many/i.test(m)) return 'Demasiados intentos. Espera un minuto y vuelve a probar.';
  if(/at least 6|password should/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres.';
  if(/user not found|usuario no encontrado/i.test(m)) return 'Ese usuario no existe. Revisa el correo.';
  if(/already registered|ya tiene cuenta/i.test(m)) return 'Ese correo ya tiene cuenta. Entra con tu contraseña, o usa "¿Olvidaste tu contraseña?".';
  if(/signups?\s+(are\s+)?not allowed|disabled/i.test(m)) return 'El registro está desactivado. Avísame y lo habilito.';
  if(/invalid.*email|email.*invalid/i.test(m)) return 'Ese correo no es válido. Revísalo.';
  if(/unable to validate email/i.test(m)) return 'No pudimos validar ese correo. Escríbelo completo (ej. nombre@gmail.com).';
  return m||'Algo falló. Intenta de nuevo.';
}
function uid(){ return 'p'+Math.random().toString(36).slice(2,9)+Date.now().toString(36).slice(-3); }

/* ---------- Utilidades ---------- */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => (s==null?'':String(s)).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = (n,d=0)=>Number(n||0).toLocaleString('es-MX',{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtUSD = n => n? '$'+Number(n).toLocaleString('en-US',{maximumFractionDigits:0}) : '$0';
const money = (n,cur)=>'$'+num(Math.round(n))+(cur?' '+cur:'');
const todayISO = () => new Date().toISOString().slice(0,10);
const fechaLarga = () => new Date().toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
function revenueOf(p){ if(!p)return 0; if(p.feeMonto)return Number(p.feeMonto); return Math.round((Number(p.notional)||0)*(Number(p.feeBps)||0)/10000); }
function daysFromToday(iso){ if(!iso)return null; const d=new Date(iso+'T00:00'),t=new Date(todayISO()+'T00:00'); return Math.round((d-t)/86400000); }
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.remove('hidden'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.add('hidden'),2400); }
function copy(text){ navigator.clipboard.writeText(text).then(()=>toast('Copiado ✓')).catch(()=>toast('No se pudo copiar')); }
function segNames(){ return state.industries.map(i=>i.name); }
function prodName(id){ const p=state.products.find(x=>x.id===id); return p?shortName(p.nombre):id; }
function shortName(n){ return n.split(' (')[0].split(' &')[0].split(' –')[0]; }
function brand(){ return (state&&state.brand)||'Insitum Capital'; }
// Nombre para saludo/avatar a partir del correo, sin exponer correos en config.js.
// "valeria3320@gmail.com" -> "Valeria" · "gori_mx@hotmail.com" -> "Gori"
function displayName(email){
  const local=(email||'').split('@')[0]||'';
  const first=(local.split(/[._+-]/)[0]||local).replace(/\d+$/,'');
  return first? first.charAt(0).toUpperCase()+first.slice(1) : (email||'');
}
// El nombre configurado gana; si no hay, se deduce del correo.
function userName(email){ return ((DB.demoUsers().find(u=>u.email===email)||{}).nombre)||displayName(email); }
function isWon(p){ return WON_STAGES.includes(p.etapa); }
function compScore(p){ return (p.contacto?1:0)+(p.telefono?1:0)+(p.email?1:0); }
function compBadge(p){ const c=compScore(p); const lbl=['Sin datos','Parcial','Parcial','Completo'][c]; return `<span class="comp comp-${c}" title="${(p.contacto?'contacto ':'')}${(p.telefono?'tel ':'')}${(p.email?'correo':'')}">${lbl}</span>`; }

/* ---------- PLAN DE CIERRE (meta de ingreso + embudo) ---------- */
// 2=tenía cobertura de derivados, 1=era cliente activo del banco, 0=frío
function operabaScore(p){ const n=p.notas||''; if(/cobertura=Si/i.test(n))return 2; if(/Estatus previo: Cliente activo/i.test(n))return 1; return 0; }
function planCfg(){ state.plan=state.plan||{}; const d={metaMes:60000,ingresoProm:7500,horizonte:2}; for(const k in d) if(!(+state.plan[k]>0)) state.plan[k]=d[k]; return state.plan; }
// Tasas de embudo conservadoras (frío B2B): toque→reunión 8%, reunión→propuesta 50%, propuesta→cierre 30%
const FUNNEL={reunion:.08,propuesta:.50,cierre:.30};
function habilesMTD(){ const t=new Date(); let n=0; for(let d=1;d<=t.getDate();d++){const w=new Date(t.getFullYear(),t.getMonth(),d).getDay(); if(w>0&&w<6)n++;} return Math.max(1,n); }
function planData(){
  const c=planCfg();
  const activos=state.prospects.filter(isWon).length;
  const metaCli=Math.max(1,Math.ceil(c.metaMes/c.ingresoProm));
  const faltan=Math.max(0,metaCli-activos);
  const cierresMes=faltan/Math.max(1,c.horizonte);
  const reuMes=Math.ceil(cierresMes/FUNNEL.cierre/FUNNEL.propuesta);
  const toqMes=Math.ceil(cierresMes/FUNNEL.cierre/FUNNEL.propuesta/FUNNEL.reunion);
  const toqDia=faltan?Math.max(5,Math.ceil(toqMes/20)):5;
  const t=todayISO(), mes=t.slice(0,7);
  const acts=state.prospects.flatMap(p=>p.actividades||[]).filter(a=>a.tipo!=='Nota');
  const toquesHoy=acts.filter(a=>a.fecha===t).length;
  const toquesMTD=acts.filter(a=>(a.fecha||'').slice(0,7)===mes).length;
  const esperadoMTD=toqDia*habilesMTD();
  const ritmo=esperadoMTD?toquesMTD/esperadoMTD:1;
  return {c,activos,metaCli,faltan,reuMes,toqMes,toqDia,toquesHoy,toquesMTD,esperadoMTD,ritmo,recurrente:activos*c.ingresoProm};
}

/* ===========================================================================
   LOGIN / ARRANQUE
   =========================================================================== */
let signupMode=false;
// Pinta la pantalla de login según el modo: iniciar sesión o crear cuenta.
function applyAuthMode(){
  if(!DB.cloud) return;
  $('#login-mode').textContent = signupMode
    ? 'Crea tu cuenta · usa un correo real y una contraseña que recuerdes'
    : 'Modo nube · inicia sesión con tu correo';
  $('#login-submit').textContent = signupMode? 'Crear cuenta' : 'Entrar';
  const su=$('#btn-signup-toggle');
  if(su) su.textContent = signupMode? '← Ya tengo cuenta, quiero entrar' : '¿No tienes cuenta? Créala aquí';
  const fg=$('#btn-forgot'); if(fg) fg.classList.toggle('hidden',signupMode);
  const rs=$('#btn-resend'); if(rs) rs.classList.add('hidden');   // solo aparece tras el error de "no confirmado"
  $('#form-login').password.setAttribute('autocomplete',signupMode?'new-password':'current-password');
}
function showLogin(){
  $('#login-brand-name').textContent='Insitum Capital';
  $('#login-mark').textContent='IC';
  const demo = !DB.cloud;
  $('#login-mode').textContent = demo? 'Elige quién eres y entra' : 'Modo nube · inicia sesión con tu correo';
  $('#lbl-demo-user').classList.toggle('hidden',!demo);
  $('#lbl-email').classList.toggle('hidden',demo);
  $('#lbl-pass').classList.toggle('hidden',demo);
  if(demo){ $('#demo-user-select').innerHTML = DB.demoUsers().map(u=>`<option value="${esc(u.email)}">${esc(u.nombre)}</option>`).join(''); }
  // Nube: pre-llenar el último correo usado (menos teclado para el operador).
  if(!demo){ const last=localStorage.getItem('cfx_last_email'); if(last)$('#form-login').email.value=last; }
  const fg=$('#btn-forgot'); if(fg)fg.classList.toggle('hidden',demo);
  const su=$('#btn-signup-toggle'); if(su)su.classList.toggle('hidden',demo||!DB.allowSignup);
  signupMode=false; applyAuthMode();
  $('#login').classList.remove('hidden'); $('#app').classList.add('hidden');
}
async function afterLogin(user){
  ME=user;
  let loaded=null; try{ loaded=await DB.loadState(user); }catch(e){ toast('Error al cargar: '+errMsg(e)); }
  state = loaded? migrate(loaded) : seedData();
  await DB.saveState(user,state).catch(()=>{});
  startApp();
}
function startApp(){
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  const admin = DB.isAdmin(ME.email);
  { const ne=$('#nav-equipo'); ne.hidden=!admin; ne.style.display=admin?'flex':'none'; }
  const name = userName(ME.email);
  $('#user-name').textContent = name;
  $('#user-role').textContent = admin? 'Administrador · '+DB.mode() : 'Agente · '+DB.mode();
  $('#user-avatar').textContent = (name[0]||'?').toUpperCase();
  $('#privacy-note').textContent = DB.cloud? '☁️ Datos en la nube, sincronizados.' : '🔒 Tus datos viven en este dispositivo. Respalda seguido.';
  render();
  // Base de clientes: ofrecer al inicio, o ACTUALIZAR SOLA si detecta una versión nueva.
  if(window.BASE_CLIENTES && window.BASE_CLIENTES.length){
    const hasImports=state.prospects.some(p=>(p.notas||'').includes('Importado:'));
    if(!hasImports && state.prospects.length<=5 && !state._baseOffered){
      state._baseOffered=true; save();
      setTimeout(()=>{ if(confirm('Tienes una base de '+window.BASE_CLIENTES.length+' clientes lista. ¿Cargarla ahora?')) cargarBase(); }, 400);
    } else if(hasImports && state.baseSig!==baseSig()){
      cargarBase(true); // versión nueva detectada -> se actualiza sola
      setTimeout(()=>toast('Tu base se actualizó a la última versión ✓'),400);
    }
  }
}
async function doLogout(){ flushSave(); await DB.signOut(); ME=null; location.reload(); }

/* ===========================================================================
   RENDER PRINCIPAL
   =========================================================================== */
function render(){
  $('#brand-name').textContent=brand();
  $('#brand-mark').textContent=brand().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
  $$('.view').forEach(v=>v.classList.add('hidden'));
  $('#view-'+ui.view).classList.remove('hidden');
  $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===ui.view));
  const titles={midia:['Mi Día','Tu plan de acción de hoy'],resumen:['Resumen','Salud de tu cartera'],pipeline:['Pipeline','Arrastra clientes por la cadena'],clientes:['Clientes','CRM: ficha completa'],propuestas:['Propuestas','Genera una propuesta de valor en segundos'],cotizador:['Cotizador','Calcula y envía cotizaciones'],perfilador:['Perfilador','Califica prospectos en 2 minutos: exposición, dolor y decisión'],seguimiento:['Seguimiento','Tu agenda de acciones'],notas:['Notas de mercado','Apertura y cierre por industria'],productos:['Productos','Catálogo editable'],equipo:['Equipo','Cartera consolidada de socios'],playbook:['Playbook','Metodología'],ajustes:['Ajustes','Marca, industrias y datos']};
  $('#view-title').textContent=titles[ui.view][0]; $('#view-sub').textContent=titles[ui.view][1];
  ({midia:renderMiDia,resumen:renderResumen,pipeline:renderPipeline,clientes:renderClientes,propuestas:renderPropuestas,cotizador:renderCotizador,perfilador:renderPerfilador,seguimiento:renderSeguimiento,notas:renderNotas,productos:renderProductos,equipo:renderEquipo,playbook:renderPlaybook,ajustes:renderAjustes}[ui.view])();
}

/* ---------- MI DÍA (buenos días + pasos por temporalidad) ---------- */
function lastTouch(p){ const a=(p.actividades||[]).map(x=>x.fecha).filter(Boolean).sort(); return a.length?a[a.length-1]:(p.actualizado||p.creado||todayISO()); }
function nextStep(p){
  if(WON_STAGES.includes(p.etapa)) return {accion:'Cuidar relación · detectar nueva operación',urg:'recurrente'};
  if(p.etapa==='Perdido') return {accion:p.fechaProxima?(p.proximaAccion||'Re-seguimiento'):'Evaluar reactivación',urg:'perdido'};
  if(p.fechaProxima){ const d=daysFromToday(p.fechaProxima); if(d<0)return{accion:p.proximaAccion||'Dar seguimiento',urg:'vencida',dias:d}; if(d===0)return{accion:p.proximaAccion||'Dar seguimiento',urg:'hoy'}; if(d<=7)return{accion:p.proximaAccion||'Dar seguimiento',urg:'semana',dias:d}; return{accion:p.proximaAccion||'Dar seguimiento',urg:'agendada',dias:d}; }
  const map={'Cliente nuevo':'Hacer primer contacto','Contactado':'Llamar y agendar diagnóstico','Reunión':'Enviar cotización','Propuesta':'Dar seguimiento a la propuesta','Negociación':'Empujar el cierre'};
  return {accion:map[p.etapa]||'Dar seguimiento',urg:'pendiente'};
}
function renderMiDia(){
  const hora=new Date().getHours(); const saludo=hora<12?'Buenos días':hora<19?'Buenas tardes':'Buenas noches';
  const nombre=userName(ME.email).split(' ')[0];
  const open=state.prospects.filter(p=>OPEN_STAGES.includes(p.etapa));
  const ws=open.map(p=>({p,s:nextStep(p)}));
  const vencidas=ws.filter(x=>x.s.urg==='vencida').sort((a,b)=>a.s.dias-b.s.dias).map(x=>x.p);
  const hoy=ws.filter(x=>x.s.urg==='hoy').map(x=>x.p);
  const superPend=open.filter(p=>p.potencial==='alto'&&!p.fechaProxima&&!(p.actividades||[]).length);
  const nuevos=state.prospects.filter(p=>p.etapa==='Cliente nuevo'&&!p.fechaProxima&&!(p.actividades||[]).length).sort((a,b)=>((b.potencial==='alto')-(a.potencial==='alto'))||(compScore(b)-compScore(a)));
  const perdidosReact=state.prospects.filter(p=>p.etapa==='Perdido'&&p.fechaProxima);
  const reactivar=state.prospects.filter(p=>p.etapa==='Cliente nuevo'&&!(p.actividades||[]).length&&operabaScore(p)>0).sort((a,b)=>(operabaScore(b)-operabaScore(a))||(compScore(b)-compScore(a)));
  const PD=planData();
  const semColor=PD.ritmo>=.9?'var(--green)':PD.ritmo>=.6?'var(--amber)':'var(--red)';
  const semTxt=PD.faltan===0?'🏆 Meta de clientes cubierta — cuida la recurrencia':PD.ritmo>=.9?'✅ A este ritmo llegas a la meta':PD.ritmo>=.6?'⚠️ Vas abajo del ritmo — sube los toques de hoy':'🔴 Muy abajo del ritmo — hoy es día de llamadas';
  const item=(p,extra)=>`<div class="list-item" data-client="${p.id}" style="cursor:pointer"><div><strong>${p.potencial==='alto'?'⭐ ':''}${esc(p.empresa)}</strong><div class="meta">${esc(p.contacto||'—')}${p.telefono?' · '+esc(p.telefono):''}</div></div><div style="text-align:right"><div class="midia-step">${esc(nextStep(p).accion)}</div><div class="meta">${extra||''}</div></div></div>`;
  const sec=(icon,title,arr,extraFn)=>`<div class="panel"><h3>${icon} ${title} <span class="muted">${arr.length}</span></h3><div class="list">${arr.length?arr.slice(0,12).map(p=>item(p,extraFn?extraFn(p):'')).join(''):empty('Nada por ahora.')}</div>${arr.length>12?`<div class="muted" style="margin-top:8px;font-size:12px">+${arr.length-12} más · velos en Clientes/Pipeline</div>`:''}</div>`;
  $('#view-midia').innerHTML=`
    <div class="midia-hero"><div><h2>${saludo}, ${esc(nombre)} 👋</h2><p class="muted">${fechaLarga()}</p></div>
      <div class="midia-kpis"><div class="${vencidas.length?'mk-red':''}"><b>${vencidas.length}</b><span>vencidas</span></div><div class="${hoy.length?'mk-amber':''}"><b>${hoy.length}</b><span>para hoy</span></div><div class="mk-gold"><b>${superPend.length}</b><span>⭐ por contactar</span></div></div></div>
    <div class="panel plan-panel"><h3>🎯 Plan de cierre <span class="muted">la meta de la casa, viva</span></h3>
      <div class="plan-grid">
        <div class="plan-card"><span class="label">Meta mensual</span><b>$${num(PD.c.metaMes)} <small>MXN</small></b><span class="meta">≈ ${PD.metaCli} clientes recurrentes</span></div>
        <div class="plan-card"><span class="label">Recurrente ya cerrado</span><b style="color:${PD.recurrente>=PD.c.metaMes?'var(--green)':'inherit'}">$${num(PD.recurrente)} <small>MXN</small></b><span class="meta">${PD.activos} cliente${PD.activos===1?'':'s'} × $${num(PD.c.ingresoProm)}</span></div>
        <div class="plan-card"><span class="label">Faltan</span><b>${PD.faltan} <small>clientes</small></b><span class="meta">en ${PD.c.horizonte} ${PD.c.horizonte==1?'mes':'meses'}</span></div>
        <div class="plan-card"><span class="label">Cuota de hoy</span><b>${PD.toquesHoy}<small>/${PD.toqDia} toques</small></b>
          <div class="plan-bar"><div style="width:${Math.min(100,Math.round(PD.toquesHoy/PD.toqDia*100))}%;background:${PD.toquesHoy>=PD.toqDia?'var(--green)':'var(--accent)'}"></div></div></div>
      </div>
      <div class="plan-funnel muted">Embudo: <b>${PD.toqMes}</b> toques/mes → <b>${PD.reuMes}</b> reuniones → <b>${Math.ceil(PD.faltan/Math.max(1,PD.c.horizonte))}</b> cierres/mes · llevas <b>${PD.toquesMTD}</b> toque${PD.toquesMTD===1?'':'s'} de ${PD.esperadoMTD} esperados al día de hoy</div>
      <div class="plan-sem" style="border-left:3px solid ${semColor}">${semTxt}</div>
      <details class="plan-cfg"><summary class="muted">⚙ Ajustar meta</summary>
        <div class="plan-cfg-row">
          <label>Meta del mes (MXN)<input type="number" id="plan-meta" value="${PD.c.metaMes}" min="1000" step="1000"></label>
          <label>Ingreso prom. por cliente (MXN/mes)<input type="number" id="plan-prom" value="${PD.c.ingresoProm}" min="500" step="500"></label>
          <label>Horizonte (meses)<input type="number" id="plan-hor" value="${PD.c.horizonte}" min="1" max="12"></label>
        </div>
      </details>
    </div>
    <div class="panel midia-news"><h3>📰 Tus noticias del día <span class="muted">tu "buenos días"</span></h3>
      <p class="muted" style="margin-top:-6px">Un botón trae el mercado y arma tus mensajes por industria, listos para WhatsApp.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="primary-btn big-btn" id="md-noticias">📰 Generar mis noticias de hoy</button>
        <button class="ghost-btn big-btn" id="md-reporte">📤 Mandar mi reporte del día</button>
      </div>
      <div id="md-noticias-out"></div>
    </div>
    <div class="panel"><h3>☀️ Rutina de la mañana</h3><div class="list">
      <div class="list-item"><span>1. Genera y envía la <b>nota de apertura</b> por industria <span class="muted">(Notas de mercado → 🔄 En vivo)</span></span></div>
      <div class="list-item"><span>2. Resuelve <b>vencidas y de hoy</b> (abajo) 📞</span></div>
      <div class="list-item"><span>3. Haz <b>${PD.toqDia} toques</b> nuevos (empieza por 🔥 los que ya operaban, luego ⭐)</span></div>
      <div class="list-item"><span>4. Agenda la <b>próxima acción</b> de cada cliente que toques</span></div>
    </div></div>
    ${sec('🔴','Vencidas — actúa ya',vencidas,p=>{const d=daysFromToday(p.fechaProxima);return `vencida ${-d}d`;})}
    ${sec('📅','Para hoy',hoy)}
    ${sec('🔥','Reactivación — ya operaban (tu mejor tiro)',reactivar,p=>operabaScore(p)===2?'🔥 tenía cobertura':'cliente activo previo')}
    ${sec('⭐','Super potenciales por contactar',superPend,p=>esc(p.segmento||''))}
    ${sec('🆕','Primeros contactos sugeridos',nuevos,p=>p.potencial==='alto'?'⭐ prioridad':esc(p.segmento||''))}
    ${perdidosReact.length?sec('♻️','Perdidos a reactivar',perdidosReact):''}`;
  bindRowClicks();
  $('#md-noticias').onclick=generarNoticiasDia;
  $('#md-reporte').onclick=mandarReporte;
  [['plan-meta','metaMes'],['plan-prom','ingresoProm'],['plan-hor','horizonte']].forEach(([id,k])=>{
    $('#'+id).onchange=e=>{ const v=+e.target.value; if(v>0){ planCfg()[k]=v; save(); const open=$('#view-midia .plan-cfg').open; render(); const dt=$('#view-midia .plan-cfg'); if(dt)dt.open=open; } };
  });
}
async function generarNoticiasDia(){
  const btn=$('#md-noticias'), out=$('#md-noticias-out');
  if(btn){btn.textContent='Trayendo mercado y noticias…';btn.disabled=true;}
  if(out)out.innerHTML='<div class="muted" style="margin:12px 0">⏳ Trayendo indicadores de apertura y titulares…</div>';
  await Promise.all([fetchMarketData(), fetchNews()]);
  const mk=state.market||{};
  const brief=buildAperturaBrief(mk,state.news);
  const conCli=state.industries.filter(i=>state.prospects.some(p=>p.segmento===i.name));
  const inds=conCli.length?conCli:state.industries;
  const list=inds.map(ind=>({name:ind.name,txt:buildIndustryNote(ind,'apertura','whatsapp',mk),n:state.prospects.filter(p=>p.segmento===ind.name&&p.telefono).length}));
  window.__news=[brief,...list.map(x=>x.txt)];
  const card=(name,sub,txt,i,full)=>`<div class="news-card${full?' news-card-full':''}"><div class="news-head"><b>${esc(name)}</b><span class="muted">${esc(sub)}</span></div><div class="news-note">${esc(txt)}</div><div class="news-actions"><button class="btn-sm" data-copynews="${i}">📋 Copiar</button><a class="btn-sm" target="_blank" href="https://wa.me/?text=${encodeURIComponent(txt)}">▶ WhatsApp</a></div></div>`;
  const noNews=!(state.news&&((state.news.intl||[]).length||(state.news.local||[]).length));
  out.innerHTML=`<div class="muted" style="margin:12px 0 8px">✅ Listo: apertura de mercados${noNews?' (titulares no disponibles ahora)':' + titulares'} + ${list.length} mensajes por industria. Toca <b>▶ WhatsApp</b>.</div>
    ${card('🗞️ Apertura de Mercados','indicadores + noticias',brief,0,true)}
    <div class="news-grid">${list.map((x,i)=>card(x.name,x.n+' con WhatsApp',x.txt,i+1)).join('')}</div>`;
  $$('[data-copynews]').forEach(b=>b.onclick=()=>copy(window.__news[+b.dataset.copynews]));
  if(btn){btn.textContent='📰 Generar mis noticias de hoy';btn.disabled=false;}
  toast('Apertura y noticias listas ✓');
}
function mandarReporte(){
  const t=todayISO();
  const acts=state.prospects.flatMap(p=>(p.actividades||[]).filter(a=>a.fecha===t).map(a=>({tipo:a.tipo,emp:p.empresa})));
  const reuniones=acts.filter(a=>a.tipo==='Reunión').length;
  const ganados=state.prospects.filter(p=>(p.ganadoFecha||'')===t||(p.operacion&&p.operacion.fecha===t));
  const ganancia=ganados.reduce((s,p)=>s+(p.operacion?(p.operacion.ganancia||0):revenueOf(p)),0);
  const pend=pendingActivities().filter(a=>a.dias<=0).length;
  const nombre=userName(ME.email).split(' ')[0];
  const txt=[`📊 *Reporte de ${nombre}*`,`🗓️ ${fechaLarga()}`,``,
    `✅ Clientes trabajados: ${new Set(acts.map(a=>a.emp)).size}`,
    `📞 Actividades del día: ${acts.length}`,
    `🤝 Reuniones agendadas: ${reuniones}`,
    `💰 Operaciones ganadas: ${ganados.length}${ganados.length?` · ganancia ${fmtUSD(ganancia)}`:''}`,
    `⏰ Pendientes para mañana: ${pend}`,``,`— ${brand()}`].join('\n');
  const ph=(state.reportarA||'').replace(/[^\d]/g,'');
  window.open('https://wa.me/'+ph+'?text='+encodeURIComponent(txt),'_blank');
  toast(ph?'Abriendo WhatsApp con tu reporte ✓':'Elige el contacto en WhatsApp (pon el número fijo en Ajustes)');
}

/* ---------- RESUMEN ---------- */
function renderResumen(){
  const open=state.prospects.filter(p=>OPEN_STAGES.includes(p.etapa));
  const pipeline=open.reduce((s,p)=>s+revenueOf(p),0);
  const ponderado=open.reduce((s,p)=>s+revenueOf(p)*(Number(p.probabilidad)||0)/100,0);
  const won=state.prospects.filter(isWon), lost=state.prospects.filter(p=>p.etapa==='Perdido');
  const mes=new Date().toISOString().slice(0,7);
  const wonMes=won.filter(p=>(p.ganadoFecha||'').slice(0,7)===mes).reduce((s,p)=>s+revenueOf(p),0);
  const wonTotal=won.reduce((s,p)=>s+revenueOf(p),0);
  const conv=(won.length+lost.length)?Math.round(won.length/(won.length+lost.length)*100):0;
  const acts=pendingActivities(); const overdue=acts.filter(a=>a.dias<0).length,hoy=acts.filter(a=>a.dias===0).length,semana=acts.filter(a=>a.dias>0&&a.dias<=7).length;
  const etapaSeg=STAGES.map(s=>({label:s,value:state.prospects.filter(p=>p.etapa===s).length,color:STAGE_COLOR[s]})).filter(x=>x.value>0);
  const totalCli=state.prospects.length;
  const indCounts={}; state.prospects.forEach(p=>{const k=p.segmento||'—';indCounts[k]=(indCounts[k]||0)+1;});
  const indTop=Object.entries(indCounts).sort((a,b)=>b[1]-a[1]).slice(0,8); const indMax=Math.max(1,...indTop.map(x=>x[1]));
  $('#view-resumen').innerHTML=`
    <div class="kpi-grid">
      <div class="kpi gold"><div class="kpi-ic">◳</div><div class="label">Pipeline abierto</div><div class="value">${fmtUSD(pipeline)}</div><div class="delta muted">${open.length} oportunidades activas</div></div>
      <div class="kpi"><div class="kpi-ic">∿</div><div class="label">Pipeline ponderado</div><div class="value">${fmtUSD(ponderado)}</div><div class="delta muted">ajustado por probabilidad</div></div>
      <div class="kpi good"><div class="kpi-ic">✓</div><div class="label">Ganado este mes</div><div class="value">${fmtUSD(wonMes)}</div><div class="delta muted">acumulado: ${fmtUSD(wonTotal)}</div></div>
      <div class="kpi ${overdue?'warn':''}"><div class="kpi-ic">◷</div><div class="label">Acciones pendientes</div><div class="value">${acts.length}</div><div class="delta muted">${overdue} vencidas · ${hoy} hoy · ${semana} semana</div></div>
    </div>
    <div class="cols2">
      <div class="panel"><h3>Clientes por etapa <span class="muted">${totalCli} total</span></h3>
        <div class="donut-wrap">${donut(etapaSeg)}<div class="donut-legend">${etapaSeg.map(s=>`<div class="leg"><span class="dot" style="background:${s.color}"></span><span class="leg-l">${s.label}</span><b>${s.value}</b></div>`).join('')}</div></div></div>
      <div class="panel"><h3>Clientes por industria <span class="muted">top 8</span></h3>
        <div class="ibars">${indTop.map(([k,v])=>`<div class="ibar-row"><span class="ibar-lbl" title="${esc(k)}">${esc(k)}</span><div class="ibar-track"><div class="ibar-fill" style="width:${Math.max(4,Math.round(v/indMax*100))}%"></div></div><span class="ibar-val">${v}</span></div>`).join('')||empty('Sin datos')}</div></div>
    </div>
    <div class="cols2">
      <div class="panel"><h3>Embudo de conversión <span class="muted">cierre ${conv}%</span></h3><div class="funnel">${funnelRows()}</div></div>
      <div class="panel"><h3>Próximas acciones <span class="muted">${acts.length}</span></h3><div class="list">${acts.slice(0,6).map(actItem).join('')||empty('Sin acciones pendientes.')}</div></div>
    </div>
    <div class="panel"><h3>Top oportunidades por valor ponderado</h3><div class="list">${topOps()}</div></div>`;
  bindRowClicks();
}
function donut(segments,size=168,thick=24){
  const total=segments.reduce((s,x)=>s+x.value,0)||1, c=size/2, r=(size-thick)/2, circ=2*Math.PI*r; let off=0;
  const arcs=segments.filter(s=>s.value>0).map(s=>{const len=s.value/total*circ; const el=`<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${thick}" stroke-dasharray="${len.toFixed(2)} ${(circ-len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>`; off+=len; return el;}).join('');
  return `<svg class="donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#e8edf3" stroke-width="${thick}"/>${arcs}<text x="${c}" y="${c-2}" text-anchor="middle" fill="#1b2430" font-size="30" font-weight="800">${total}</text><text x="${c}" y="${c+19}" text-anchor="middle" fill="#64748b" font-size="11.5">clientes</text></svg>`;
}
function funnelRows(){
  const max=Math.max(1,...STAGES.map(s=>state.prospects.filter(p=>p.etapa===s).length));
  return STAGES.map(s=>{const arr=state.prospects.filter(p=>p.etapa===s),val=arr.reduce((a,p)=>a+revenueOf(p),0),w=Math.max(3,arr.length/max*100);
    return `<div class="funnel-row"><span>${s}</span><div class="funnel-bar" style="width:${w}%;background:linear-gradient(90deg,${STAGE_COLOR[s]}99,${STAGE_COLOR[s]})">${arr.length||''}</div><span class="muted" style="text-align:right">${fmtUSD(val)}</span></div>`;}).join('');
}
function topOps(){
  const open=state.prospects.filter(p=>OPEN_STAGES.includes(p.etapa)).map(p=>({p,w:revenueOf(p)*(Number(p.probabilidad)||0)/100})).sort((a,b)=>b.w-a.w).slice(0,6);
  if(!open.length)return empty('Aún no hay oportunidades abiertas.');
  return open.map(({p,w})=>`<div class="list-item" data-client="${p.id}" style="cursor:pointer"><div><strong>${esc(p.empresa)}</strong> <span class="tag">${esc(p.etapa)}</span><div class="meta">${esc(p.contacto||'—')} · ${esc(p.segmento||'')}</div></div><div style="text-align:right"><div style="color:var(--gold);font-weight:700">${fmtUSD(w)}</div><div class="meta">${p.probabilidad}% · ${fmtUSD(revenueOf(p))} pot.</div></div></div>`).join('');
}

/* ---------- PIPELINE ---------- */
const KANBAN_CAP=60;
function renderPipeline(){
  const cols=STAGES.map(s=>{const arr=filtered().filter(p=>p.etapa===s).sort((a,b)=>((b.potencial==='alto')-(a.potencial==='alto'))||(compScore(b)-compScore(a))),sum=arr.reduce((a,p)=>a+revenueOf(p),0);
    const shown=arr.slice(0,KANBAN_CAP);
    const moreNote=arr.length>KANBAN_CAP?`<div class="muted" style="padding:10px;font-size:11px;text-align:center;border-top:1px solid var(--line)">+${arr.length-KANBAN_CAP} más · velos en <b>Clientes</b></div>`:'';
    return `<div class="kcol" data-stage="${s}"><div class="kcol-head"><span style="color:${STAGE_COLOR[s]}">${s}</span><span class="cnt">${arr.length}</span></div><div class="kcol-sum">${fmtUSD(sum)}</div><div class="kcol-body">${shown.map(card).join('')}${moreNote}</div></div>`;}).join('');
  const legend=`<div class="pipe-legend"><span class="muted">Actividad:</span><span><i class="ld ok"></i> agendada</span><span><i class="ld today"></i> hoy</span><span><i class="ld overdue"></i> vencida</span><span><i class="ld none"></i> sin actividad</span></div>`;
  $('#view-pipeline').innerHTML=legend+`<div class="kanban">${cols}</div>`; bindKanban();
}
function actStatus(p){ if(!OPEN_STAGES.includes(p.etapa))return 'none'; const d=daysFromToday(p.fechaProxima); if(d==null)return 'none'; if(d<0)return 'overdue'; if(d===0)return 'today'; return 'ok'; }
function card(p){
  const cls=isWon(p)?'won':p.etapa==='Perdido'?'lost':'';
  const st=actStatus(p); const ico={ok:'✓',today:'!',overdue:'!',none:'·'}[st];
  const nextTxt=p.fechaProxima?p.fechaProxima:'Sin actividad';
  return `<div class="card ${cls} act-${st}" draggable="true" data-id="${p.id}">
    <div class="card-strip" style="background:${STAGE_COLOR[p.etapa]}"></div>
    <div class="card-body">
      <h4>${p.potencial==='alto'?'⭐ ':''}${esc(p.empresa)}</h4>
      <div class="c-contact">${esc(p.contacto||'—')}${p.puesto?' · '+esc(p.puesto):''}</div>
      <div class="c-row"><span class="c-rev">${fmtUSD(revenueOf(p))}</span><span class="c-dot act-${st}" title="${esc(nextTxt)}">${ico}</span></div>
      <div class="c-foot"><span class="seg-tag">${esc(p.segmento||'—')}</span><span class="c-next">${esc(nextTxt)}</span></div>
    </div>
  </div>`;
}
function bindKanban(){
  let dragId=null, dragged=false;
  $$('.card').forEach(c=>{
    c.addEventListener('dragstart',e=>{dragId=c.dataset.id;dragged=true;e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain',dragId);}catch(_){}c.classList.add('dragging');});
    c.addEventListener('dragend',()=>{c.classList.remove('dragging');$$('.kcol').forEach(k=>k.classList.remove('dragover'));setTimeout(()=>{dragged=false;},60);});
    c.addEventListener('click',()=>{ if(dragged)return; openClient(c.dataset.id); });
  });
  $$('.kcol').forEach(col=>{
    col.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='move';col.classList.add('dragover');});
    col.addEventListener('dragleave',e=>{ if(!col.contains(e.relatedTarget)) col.classList.remove('dragover'); });
    col.addEventListener('drop',e=>{e.preventDefault();col.classList.remove('dragover');const p=state.prospects.find(x=>x.id===dragId);if(!p)return;const ns=col.dataset.stage;if(p.etapa!==ns){openMove(dragId,ns);}});
  });
}
function moveStage(p,ns){ p.stageHistory=p.stageHistory||[]; p.stageHistory.push({de:p.etapa,a:ns,fecha:todayISO()}); p.etapa=ns; if(WON_STAGES.includes(ns)&&!p.ganadoFecha)p.ganadoFecha=todayISO(); p.actualizado=todayISO(); save(); }

/* ---------- CLIENTES ---------- */
function renderClientes(){
  const segs=segNames().map(s=>({s,n:state.prospects.filter(p=>p.segmento===s).length})).filter(x=>x.n);
  const conDatos=state.prospects.filter(p=>compScore(p)>0).length, sinDatos=state.prospects.length-conDatos;
  const superN=state.prospects.filter(p=>p.potencial==='alto').length;
  const arr=filtered().slice().sort((a,b)=>(ui.filtroDatos==='operaba'?(operabaScore(b)-operabaScore(a)):0)||((b.potencial==='alto')-(a.potencial==='alto'))||(compScore(b)-compScore(a)));
  const rows=arr.map(p=>`<tr data-client="${p.id}" style="cursor:pointer">
    <td><strong>${p.potencial==='alto'?'⭐ ':''}${esc(p.empresa)}</strong><div class="meta">${esc(p.contacto||'—')}${p.puesto?' · '+esc(p.puesto):''}</div></td>
    <td>${compBadge(p)}</td>
    <td><span class="tag">${esc(p.segmento||'—')}</span></td>
    <td><span class="badge" style="background:${STAGE_COLOR[p.etapa]}22;color:${STAGE_COLOR[p.etapa]}">${esc(p.etapa)}</span></td>
    <td>${p.telefono?'📞':''}${p.email?'✉️':''}${!p.telefono&&!p.email?'<span class="muted">—</span>':''}</td>
    <td style="text-align:right">${fmtUSD(revenueOf(p))}</td>
    <td><div class="row-actions"><button class="icon-btn" data-client="${p.id}" title="Ficha">👁</button><button class="icon-btn" data-sched="${p.id}" title="Agendar cita">📅</button></div></td></tr>`).join('');
  $('#view-clientes').innerHTML=`
    <div class="filters">
      <select id="f-datos"><option value="">Todos (datos)</option><option value="potencial" ${ui.filtroDatos==='potencial'?'selected':''}>⭐ Super potenciales</option><option value="operaba" ${ui.filtroDatos==='operaba'?'selected':''}>🔥 Ya operaban (reactivar)</option><option value="con" ${ui.filtroDatos==='con'?'selected':''}>Con datos de contacto</option><option value="email" ${ui.filtroDatos==='email'?'selected':''}>Con correo</option><option value="tel" ${ui.filtroDatos==='tel'?'selected':''}>Con teléfono</option><option value="sin" ${ui.filtroDatos==='sin'?'selected':''}>Solo nombre</option></select>
      <select id="f-seg"><option value="">Todas las industrias</option>${segNames().map(s=>`<option ${ui.filtroSeg===s?'selected':''}>${s}</option>`).join('')}</select>
      <select id="f-etapa"><option value="">Todas las etapas</option>${STAGES.map(s=>`<option ${ui.filtroEtapa===s?'selected':''}>${s}</option>`).join('')}</select>
      <span class="muted">${arr.length} de ${state.prospects.length} · ⭐ ${superN} super · ${conDatos} con datos · ${sinDatos} solo nombre</span>
    </div>
    <div class="panel" style="padding:14px 16px"><h3 style="margin-bottom:10px">Segmentación por industria</h3><div class="funnel">${segs.length?segs.map(({s,n})=>{const max=Math.max(...segs.map(x=>x.n));return `<div class="funnel-row"><span>${s}</span><div class="funnel-bar" style="width:${Math.max(5,n/max*100)}%">${n}</div><span class="muted" style="text-align:right">${n}</span></div>`}).join(''):empty('Sin datos')}</div></div>
    <div class="table-wrap"><table><thead><tr><th>Empresa / Contacto</th><th>Datos</th><th>Industria</th><th>Etapa</th><th>Medios</th><th style="text-align:right">Ingreso est.</th><th></th></tr></thead><tbody>${rows||`<tr><td colspan="7">${empty('Sin clientes que coincidan.')}</td></tr>`}</tbody></table></div>`;
  $('#f-datos').onchange=e=>{ui.filtroDatos=e.target.value;render();};
  $('#f-seg').onchange=e=>{ui.filtroSeg=e.target.value;render();};
  $('#f-etapa').onchange=e=>{ui.filtroEtapa=e.target.value;render();};
  bindRowClicks();
}

/* ---------- DRAWER ficha ---------- */
function openClient(id){
  const p=state.prospects.find(x=>x.id===id); if(!p)return;
  const acts=(p.actividades||[]).slice().sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||''));
  const hist=(p.stageHistory||[]).slice().reverse();
  const waPhone=(p.telefono||'').replace(/[^\d]/g,'');
  $('#drawer-client').innerHTML=`
    <div class="drawer-head"><div><h2>${esc(p.empresa)}</h2><div class="muted">${esc(p.contacto||'—')}${p.puesto?' · '+esc(p.puesto):''}</div></div><button class="icon-btn" id="drawer-close">✕</button></div>
    <div class="drawer-body">
      <div class="drawer-stages">${STAGES.map(s=>`<button class="stage-pill ${p.etapa===s?'on':''}" data-setstage="${s}" style="${p.etapa===s?`background:${STAGE_COLOR[s]};border-color:${STAGE_COLOR[s]};color:#03211e`:''}">${s}</button>`).join('')}</div>
      <div class="drawer-kpis"><div><span class="muted">Ingreso estimado</span><strong style="color:var(--gold)">${fmtUSD(revenueOf(p))}</strong></div><div><span class="muted">Volumen</span><strong>${fmtUSD(p.notional)}</strong></div><div><span class="muted">Probabilidad</span><strong>${p.probabilidad||0}%</strong></div></div>
      <div class="drawer-row"><span class="muted">Industria</span><span>${esc(p.segmento||'—')}</span></div>
      <div class="drawer-row"><span class="muted">Teléfono</span><span>${esc(p.telefono||'—')}</span></div>
      ${waPhone?`<div class="drawer-contact"><a class="contact-btn" href="tel:${waPhone}">📞 Llamar</a><a class="contact-btn wa" href="https://wa.me/${waPhone}" target="_blank">💬 WhatsApp</a>${p.email?`<a class="contact-btn" href="mailto:${esc(p.email)}">✉️ Correo</a>`:''}</div>`:''}
      <div class="drawer-row"><span class="muted">Email</span><span>${p.email?`<a class="mini-link" href="mailto:${esc(p.email)}">${esc(p.email)}</a>`:'—'}</span></div>
      <div class="drawer-row"><span class="muted">Productos</span><span>${(p.productos||[]).map(pr=>`<span class="tag">${esc(prodName(pr))}</span>`).join(' ')||'—'}</span></div>
      <div class="drawer-row"><span class="muted">Próxima acción</span><span>${esc(p.proximaAccion||'—')} ${p.fechaProxima?`<span class="tag">${p.fechaProxima}</span>`:''}</span></div>
      ${p.operacion?`<div class="drawer-note" style="border-color:#86e0a5;background:#e7f6ec;color:var(--text)"><b>💰 Operación ganada</b><br>${esc(p.operacion.producto||'Operación')} · Vol ${fmtUSD(p.operacion.volumen)} · Nivel ${esc(p.operacion.nivel||'—')} · <b style="color:var(--green)">Ganancia ${fmtUSD(p.operacion.ganancia)}</b> · ${esc(p.operacion.fecha||'')}</div>`:''}
      ${p.notas?`<div class="drawer-note">${esc(p.notas)}</div>`:''}
      <div class="drawer-actions"><button class="primary-btn" id="drawer-act">+ Actividad</button><button class="ghost-btn" id="drawer-sched">📅 Agendar</button><button class="ghost-btn" id="drawer-cot">≣ Cotizar</button><button class="ghost-btn" id="drawer-edit">✎ Editar</button><button class="ghost-btn danger" id="drawer-del">🗑</button></div>
      <h3 class="drawer-h3">Línea de tiempo</h3>
      <div class="timeline">${acts.length?acts.map(a=>`<div class="tl-item"><div class="tl-dot"></div><div><strong>${esc(a.tipo)}</strong> <span class="muted">${a.fecha||''}</span><div>${esc(a.nota||'')}</div></div></div>`).join(''):'<div class="muted" style="padding:8px">Sin actividades aún.</div>'}${hist.map(h=>`<div class="tl-item"><div class="tl-dot alt"></div><div><span class="muted">${h.fecha}</span> movido a <strong>${esc(h.a)}</strong></div></div>`).join('')}</div>
    </div>`;
  $('#drawer-client').classList.remove('hidden'); $('#drawer-overlay').classList.remove('hidden');
  $('#drawer-close').onclick=closeDrawer;
  $('#drawer-act').onclick=()=>openActivity(id);
  $('#drawer-sched').onclick=()=>openSchedule(id);
  $('#drawer-cot').onclick=()=>{closeDrawer();ui.view='cotizador';ui.cotCliente=id;render();};
  $('#drawer-edit').onclick=()=>{closeDrawer();openProspect(id);};
  $('#drawer-del').onclick=()=>{ if(confirm('¿Eliminar este cliente? No se puede deshacer.')){ state.prospects=state.prospects.filter(x=>x.id!==id); save(); closeDrawer(); render(); toast('Cliente eliminado'); } };
  $$('#drawer-client [data-setstage]').forEach(b=>b.onclick=()=>{ if(b.dataset.setstage!==p.etapa){ closeDrawer(); openMove(id,b.dataset.setstage); } });
}
function closeDrawer(){ $('#drawer-client').classList.add('hidden'); $('#drawer-overlay').classList.add('hidden'); }

/* ---------- PERFILADOR (calificación de prospectos) ---------- */
const PERF_Q = [
  {sec:'1 · Exposición'},
  {k:'expTipo',label:'¿Cómo le pega el tipo de cambio / commodity?',opts:[['importa','Importa — paga en USD'],['exporta','Exporta — cobra en USD'],['ambos','Importa y exporta'],['deuda','Tiene deuda en USD'],['commodity','Su riesgo es el insumo (commodity)'],['sin','Sin exposición clara']]},
  {k:'volumen',label:'Volumen anual expuesto (USD)',type:'number',ph:'5000000'},
  {k:'pctExp',label:'% de costos o ingresos en moneda extranjera',opts:[['lt10','Menos de 10%'],['p1030','10–30%'],['p3060','30–60%'],['gt60','Más de 60%']]},
  {k:'commodity',label:'Insumo commodity relevante',opts:[['ninguno','Ninguno'],['metales','Metales (aluminio, cobre, acero)'],['agro','Granos / agro'],['energia','Energéticos'],['varios','Varios']]},
  {sec:'2 · Prácticas actuales'},
  {k:'cubre',label:'¿Cubre actualmente?',opts:[['nunca','No, nunca ha cubierto'],['aveces','Lo ha hecho a veces'],['banco','Sí, con su banco'],['broker','Sí, con otro broker']]},
  {k:'instrumentos',label:'Forwards / opciones',opts:[['no','No los conoce'],['conoce','Los conoce'],['usa','Los usa activamente']]},
  {k:'linea',label:'¿Línea de derivados con su banco?',opts:[['si','Sí'],['no','No'],['nosabe','No sabe']]},
  {sec:'3 · Dolor'},
  {k:'golpe',label:'¿El TC o el insumo le pegó en los últimos 12 meses?',opts:[['fuerte','Sí, fuerte (el margen sufrió)'],['algo','Algo'],['no','No'],['nosabe','No sabe / no lo mide']]},
  {k:'presupuesto',label:'¿Arma presupuesto con TC fijo?',opts:[['si','Sí'],['no','No']]},
  {sec:'4 · Decisión'},
  {k:'decisor',label:'¿Quién decide?',opts:[['solo','El contacto decide solo'],['socios','Decide con socios / dirección'],['recomienda','Solo recomienda (tesorería/finanzas)'],['noclaro','No está claro']]},
  {k:'horizonte',label:'¿Cuándo quiere resolverlo?',opts:[['mes','Este mes'],['trimestre','Este trimestre'],['explora','Solo está explorando']]},
];
const PERF_GRADES = {A:['Prioridad máxima','#16a34a'],B:['Prospecto fuerte','#0d9488'],C:['Cultivar','#d97706'],D:['Baja prioridad','#dc2626']};
const PERF_NEXT = {A:'Llamar HOY y agendar diagnóstico de exposición (30 min).',B:'Agendar reunión esta semana; enviar nota de mercado de su industria.',C:'Meter a goteo: nota de mercado semanal y retomar en 30 días.',D:'Dejar en base; reevaluar si cambia su exposición.'};
function perfLabel(k,v){ const q=PERF_Q.find(x=>x.k===k); if(!q||!q.opts)return v||'—'; const o=q.opts.find(x=>x[0]===v); return o?o[1]:'—'; }
function perfScore(d){
  const vol=Number(d.volumen)||0;
  let sExp = vol>=20e6?30: vol>=5e6?26: vol>=1e6?20: vol>=250e3?12: vol>0?5:0;
  sExp += ({lt10:2,p1030:5,p3060:8,gt60:10}[d.pctExp]||0);
  sExp += d.expTipo==='ambos'||d.expTipo==='deuda'?5: d.expTipo==='sin'?0: d.expTipo?4:0;
  sExp = Math.min(45,sExp);
  const sDol = ({fuerte:15,algo:9,nosabe:5,no:2}[d.golpe]||0) + (d.presupuesto==='si'?5:d.presupuesto==='no'?2:0);
  const sAcc = ({banco:8,aveces:7,nunca:5,broker:3}[d.cubre]||0) + ({usa:4,conoce:3,no:1}[d.instrumentos]||0) + ({si:3,nosabe:1,no:1}[d.linea]||0);
  const sDec = ({solo:10,socios:7,recomienda:4,noclaro:1}[d.decisor]||0) + ({mes:10,trimestre:6,explora:2}[d.horizonte]||0);
  const total = sExp+sDol+sAcc+sDec;
  const grade = total>=70?'A': total>=50?'B': total>=30?'C':'D';
  return {total,grade,dims:[['Exposición',sExp,45],['Dolor',sDol,20],['Accesibilidad',sAcc,15],['Decisión',sDec,20]]};
}
function perfProducts(d){
  const out=[];
  if(d.expTipo==='importa') out.push('Forward de compra USD/MXN — programa escalonado');
  if(d.expTipo==='exporta') out.push('Forward de venta USD/MXN o collar costo cero');
  if(d.expTipo==='ambos') out.push('Neteo natural + cobertura del descalce neto');
  if(d.expTipo==='deuda') out.push('Cobertura de servicio de deuda (forwards / swap)');
  if(d.commodity==='metales') out.push('Cobertura de metales (LME vía Marex)');
  if(d.commodity==='agro') out.push('Cobertura agro (CME vía StoneX / ADM)');
  if(d.commodity==='energia') out.push('Cobertura de energéticos');
  if(d.commodity==='varios') out.push('Programa multi-commodity');
  if(d.cubre==='banco') out.push('Benchmark de spreads vs su banco (ahorro en FX)');
  if(d.instrumentos==='no') out.push('Arrancar con forward simple + sesión educativa');
  if(!out.length) out.push('Diagnóstico de exposición — definir instrumento');
  return out;
}
function buildPerfFicha(d,sc,emp,contacto){
  const fee=Math.round((Number(d.volumen)||0)*25/10000);
  return [
    `◎ *PERFIL DE PROSPECTO — ${emp||'(sin nombre)'}*`,
    `🗓️ ${fechaLarga()}`,
    contacto?`Contacto: ${contacto}`:null,
    ``,
    `*EXPOSICIÓN*`,
    `· Tipo: ${perfLabel('expTipo',d.expTipo)}`,
    `· Volumen anual: ${fmtUSD(d.volumen)} USD · ${perfLabel('pctExp',d.pctExp)} en divisa`,
    `· Commodity: ${perfLabel('commodity',d.commodity)}`,
    `*PRÁCTICAS*`,
    `· Cobertura actual: ${perfLabel('cubre',d.cubre)} · Instrumentos: ${perfLabel('instrumentos',d.instrumentos)} · Línea derivados: ${perfLabel('linea',d.linea)}`,
    `*DOLOR*`,
    `· Golpe últimos 12m: ${perfLabel('golpe',d.golpe)} · Presupuesto TC fijo: ${perfLabel('presupuesto',d.presupuesto)}`,
    `*DECISIÓN*`,
    `· ${perfLabel('decisor',d.decisor)} · Horizonte: ${perfLabel('horizonte',d.horizonte)}`,
    ``,
    `*CALIFICACIÓN: ${sc.total}/100 → GRADO ${sc.grade}* (${PERF_GRADES[sc.grade][0]})`,
    `Comisión potencial (25 bps): ${fmtUSD(fee)} USD/año`,
    ``,
    `*RECOMENDACIÓN*`,
    ...perfProducts(d).map(p=>`• ${p}`),
    `Siguiente paso: ${PERF_NEXT[sc.grade]}`,
    ``,
    `— ${brand()}`
  ].filter(x=>x!==null).join('\n');
}
function renderPerfilador(){
  const fields=PERF_Q.map(q=>{
    if(q.sec) return `<div class="perf-sec full">${q.sec}</div>`;
    if(q.type==='number') return `<label>${q.label}<input data-perf="${q.k}" type="number" min="0" step="1000" placeholder="${q.ph||''}" /></label>`;
    return `<label>${q.label}<select data-perf="${q.k}"><option value="">—</option>${q.opts.map(o=>`<option value="${o[0]}">${o[1]}</option>`).join('')}</select></label>`;
  }).join('');
  $('#view-perfilador').innerHTML=`
    <div class="notes-layout">
      <div class="panel">
        <h3>Perfilar prospecto</h3>
        <p class="muted" style="margin-top:-4px;font-size:12px">11 preguntas, 2 minutos. Úsalo en la llamada o después. El score decide el siguiente paso — no tu intuición.</p>
        <label>Cliente<select id="perf-cliente"><option value="">— Prospecto nuevo —</option>${state.prospects.map(p=>`<option value="${p.id}" ${ui.perfCliente===p.id?'selected':''}>${esc(p.empresa)}</option>`).join('')}</select></label>
        <div id="perf-newfields" class="grid2" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <label>Empresa<input id="perf-empresa" placeholder="Ej. Aceros del Norte SA" /></label>
          <label>Contacto<input id="perf-contacto" placeholder="Nombre y puesto" /></label>
          <label>Teléfono<input id="perf-telefono" placeholder="+52 ..." /></label>
          <label>Industria<select id="perf-segmento">${segNames().map(s=>`<option>${esc(s)}</option>`).join('')}</select></label>
        </div>
        <div class="grid2" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:4px">${fields}</div>
        <button class="primary-btn" id="perf-calc" style="margin-top:14px;width:100%">◎ Calificar prospecto</button>
      </div>
      <div class="panel">
        <h3>Resultado <button class="copy-mini" id="perf-copy">Copiar</button></h3>
        <div id="perf-result"><div class="empty">Contesta el cuestionario y presiona <strong>Calificar</strong>. Obtienes score, grado A–D, productos sugeridos y el siguiente paso.</div></div>
        <div class="note-send">
          <a class="ghost-btn" id="perf-wa" target="_blank">▶ WhatsApp</a>
          <button class="ghost-btn" id="perf-save">💾 Guardar en cliente / pipeline</button>
        </div>
      </div>
    </div>`;
  const paintResult=()=>{
    const r=ui.perfData; if(!r) return;
    const [glabel,gcolor]=PERF_GRADES[r.sc.grade];
    $('#perf-result').innerHTML=`
      <div class="perf-head">
        <div class="perf-score" style="border-color:${gcolor}"><b>${r.sc.total}</b><span>de 100</span></div>
        <div><span class="perf-grade" style="color:${gcolor};border-color:${gcolor}">GRADO ${r.sc.grade} · ${glabel}</span>
        <div class="muted" style="margin-top:8px;font-size:12px">${PERF_NEXT[r.sc.grade]}</div></div>
      </div>
      <div class="perf-bars">${r.sc.dims.map(d=>`<div class="perf-bar"><span>${d[0]}</span><div class="pb-track"><div class="pb-fill" style="width:${Math.round(d[1]/d[2]*100)}%;background:${gcolor}"></div></div><span class="muted">${d[1]}/${d[2]}</span></div>`).join('')}</div>
      <div class="note-output" style="max-height:340px;overflow:auto">${esc(ui.perfText)}</div>`;
    $('#perf-wa').href='https://wa.me/?text='+encodeURIComponent(ui.perfText);
  };
  $('#perf-cliente').onchange=e=>{
    ui.perfCliente=e.target.value;
    $('#perf-newfields').style.display=ui.perfCliente?'none':'grid';
    const p=state.prospects.find(x=>x.id===ui.perfCliente);
    if(p&&p.notional) $('[data-perf="volumen"]').value=p.notional;
  };
  $('#perf-calc').onclick=()=>{
    const d={}; $$('[data-perf]').forEach(i=>d[i.dataset.perf]=i.value);
    const faltan=PERF_Q.filter(q=>q.k&&!d[q.k]).length;
    const p=state.prospects.find(x=>x.id===ui.perfCliente);
    const emp=p?p.empresa:($('#perf-empresa').value||'').trim();
    if(!emp){ toast('Pon la empresa o elige un cliente'); return; }
    const sc=perfScore(d);
    ui.perfText=buildPerfFicha(d,sc,emp,p?(p.contacto||''):$('#perf-contacto').value);
    ui.perfData={d,sc,emp};
    paintResult();
    if(faltan) toast(faltan+' pregunta(s) sin contestar — el score puede subestimar');
  };
  $('#perf-copy').onclick=()=>{ if(ui.perfText)copy(ui.perfText); else toast('Primero califica'); };
  $('#perf-save').onclick=()=>{
    const r=ui.perfData; if(!r){ toast('Primero califica'); return; }
    const vol=Number(r.d.volumen)||0, alto=r.sc.grade==='A'||r.sc.grade==='B';
    let p=state.prospects.find(x=>x.id===ui.perfCliente);
    if(!p){
      p={id:uid(),empresa:r.emp,contacto:$('#perf-contacto').value||'',telefono:$('#perf-telefono').value||'',email:'',fuente:'Otro',segmento:$('#perf-segmento').value||'',etapa:'Cliente nuevo',productos:[],notional:vol,feeBps:25,probabilidad:alto?50:25,proximaAccion:PERF_NEXT[r.sc.grade],fechaProxima:'',notas:'',creado:todayISO(),actualizado:todayISO(),actividades:[],stageHistory:[]};
      state.prospects.unshift(p);
    } else {
      if(vol&&!p.notional)p.notional=vol;
      if(!p.proximaAccion)p.proximaAccion=PERF_NEXT[r.sc.grade];
    }
    if(alto)p.potencial='alto';
    p.perfil={score:r.sc.total,grade:r.sc.grade,fecha:todayISO()};
    p.actividades=p.actividades||[];
    p.actividades.push({id:uid(),fecha:todayISO(),tipo:'Nota',nota:'◎ Perfilador: '+r.sc.total+'/100 grado '+r.sc.grade+'\n'+ui.perfText});
    p.actualizado=todayISO();
    save(); toast('Perfil guardado en '+p.empresa+' ✓');
    ui.perfCliente=p.id;
    openClient(p.id);
  };
  if(ui.perfData) paintResult();
}

/* ---------- COTIZADOR ---------- */
function renderCotizador(){
  const tipo=ui.cotTipo, def=COT_TIPOS[tipo];
  const fields=def.fields.map(f=>`<label>${f.label}<input data-cot="${f.k}" type="${f.type||'number'}" ${f.step?`step="${f.step}"`:''} placeholder="${f.ph||''}" /></label>`).join('');
  $('#view-cotizador').innerHTML=`
    <div class="notes-layout">
      <div class="panel">
        <h3>Nueva cotización</h3>
        <label>Cliente (opcional)<select id="cot-cliente"><option value="">— Sin asignar —</option>${state.prospects.map(p=>`<option value="${p.id}" ${ui.cotCliente===p.id?'selected':''}>${esc(p.empresa)}</option>`).join('')}</select></label>
        <label>Tipo de cálculo<select id="cot-tipo">${Object.keys(COT_TIPOS).map(k=>`<option value="${k}" ${tipo===k?'selected':''}>${COT_TIPOS[k].label}</option>`).join('')}</select></label>
        <div class="grid2" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:4px">${fields}</div>
        <button class="primary-btn" id="cot-calc" style="margin-top:14px;width:100%">Calcular cotización</button>
      </div>
      <div class="panel">
        <h3>Cotización <button class="copy-mini" id="cot-copy">Copiar</button></h3>
        <div class="note-output" id="cot-output">Llena los datos y presiona <strong>Calcular</strong>.</div>
        <div class="note-send">
          <a class="ghost-btn" id="cot-wa" target="_blank">▶ WhatsApp</a>
          <a class="ghost-btn" id="cot-mail">✉ Correo</a>
          <button class="ghost-btn" id="cot-save">Guardar en cliente</button>
        </div>
      </div>
    </div>`;
  $('#cot-tipo').onchange=e=>{ui.cotTipo=e.target.value;ui.cotText='';renderCotizador();};
  $('#cot-cliente').onchange=e=>{ui.cotCliente=e.target.value;};
  const calc=()=>{ const d={}; $$('[data-cot]').forEach(i=>d[i.dataset.cot]=i.value); const cli=state.prospects.find(p=>p.id===ui.cotCliente); ui.cotText=buildQuote(tipo,d,cli?cli.empresa:''); $('#cot-output').textContent=ui.cotText; updateCotLinks(); };
  const updateCotLinks=()=>{ const wa=$('#cot-wa'),ml=$('#cot-mail'); wa.href='https://wa.me/?text='+encodeURIComponent(ui.cotText); ml.href='mailto:?subject='+encodeURIComponent(`${brand()} — Cotización`)+'&body='+encodeURIComponent(ui.cotText); };
  $('#cot-calc').onclick=calc;
  $('#cot-copy').onclick=()=>{ if(!ui.cotText)calc(); copy(ui.cotText); };
  $('#cot-save').onclick=()=>{ if(!ui.cotText){calc();} const p=state.prospects.find(x=>x.id===ui.cotCliente); if(!p){toast('Elige un cliente para guardar');return;} p.actividades=p.actividades||[]; p.actividades.push({id:uid(),fecha:todayISO(),tipo:'Cotización',nota:def.label+' — enviada'}); save(); toast('Cotización guardada en '+p.empresa+' ✓'); };
  if(ui.cotText){ $('#cot-output').textContent=ui.cotText; updateCotLinks(); }
}
function buildQuote(tipo,d,cliente){
  const head=`📄 *${brand()}* — Cotización\n${cliente?`Cliente: ${cliente}\n`:''}🗓️ ${fechaLarga()}\n`;
  const foot='\n_Cotización indicativa, sujeta a condiciones de mercado al momento de operar. No constituye recomendación de inversión._';
  let body='';
  if(tipo==='ahorro'){
    const m=+d.montoUSD||0,ops=+d.opsAnio||0,banco=+d.tcBanco||0,tuyo=+d.tcTuyo||0;
    const ahorroOp=m*(banco-tuyo)/100, anual=ahorroOp*ops; // centavos/USD -> MXN
    body=`*Ahorro en tipo de cambio / transferencias*\n• Monto por operación: USD ${num(m)}\n• Operaciones al año: ${num(ops)}\n• Spread banco: ${num(banco,2)} ¢/USD  vs  tu spread: ${num(tuyo,2)} ¢/USD\n\n💰 *Ahorro por operación: ${money(ahorroOp,'MXN')}*\n💰 *Ahorro anual estimado: ${money(anual,'MXN')}*`;
  } else if(tipo==='forward'){
    const m=+d.montoUSD||0,spot=+d.spot||0,tm=+d.tasaMXN||0,tu=+d.tasaUSD||0,dias=+d.dias||0,adv=+d.adverso||0;
    const fwd=spot*(1+tm/100*dias/360)/(1+tu/100*dias/360), pts=fwd-spot;
    const perdida=m*spot*adv/100;
    body=`*Cobertura con Forward*\n• Monto a cubrir: USD ${num(m)}\n• Spot: ${num(spot,4)}  ·  Plazo: ${num(dias)} días\n\n🔒 *Tipo de cambio forward: ${num(fwd,4)}*  (${pts>=0?'+':''}${num(pts,4)} pts)\n📉 Si el USD sube ${num(adv,1)}% sin cobertura, el costo extra sería ~${money(perdida,'MXN')}.\n✅ Con el forward fijas tu costo y eliminas ese riesgo.`;
  } else if(tipo==='commodity'){
    const ins=d.insumo||'insumo',vol=+d.volumen||0,pr=+d.precio||0,adv=+d.adverso||0;
    const costo=vol*pr, evitado=costo*adv/100;
    body=`*Cobertura de commodities — ${ins}*\n• Volumen anual: ${num(vol)} unidades\n• Precio actual: USD ${num(pr,2)}/u  ·  Costo anual: ${money(costo,'USD')}\n\n⚠️ Si ${ins} sube ${num(adv,1)}%, tu costo aumentaría ~${money(evitado,'USD')}.\n✅ La cobertura fija tu precio y protege ese margen.`;
  } else {
    const m=+d.monto||0,t=+d.tasa||0,dias=+d.dias||0;
    const rend=m*t/100*dias/360, fin=m+rend;
    body=`*Inversión / Rendimiento*\n• Monto: ${money(m,'')}\n• Tasa anual: ${num(t,2)}%  ·  Plazo: ${num(dias)} días\n\n📈 *Rendimiento estimado: ${money(rend,'')}*\n💼 Monto final: ${money(fin,'')}`;
  }
  return head+'\n'+body+'\n\nQuedo a tus órdenes para operarlo.\n— Mesa de '+brand()+foot;
}

/* ===========================================================================
   GENERADOR DE PROPUESTAS — biblioteca de "jugadas" por tipo de exposicion.
   Con poca informacion (2-4 datos) arma un diagnostico + 2 formas de cubrir +
   por que ahora + economia + comision. Salidas: ficha WhatsApp y 1-pager PDF.
   Reusa el motor existente (mercado en vivo, productos, industrias).
   =========================================================================== */
const JUGADAS = {
  fx_importador:{
    label:'FX · Importador (paga en dólares)', icon:'💵',
    segmentos:['Importador/Exportador','Manufactura/Automotriz','Retail/Comercio','Construcción/Inmobiliaria','Energía/Combustibles','Fintech/Remesas'],
    inputs:[
      {k:'vol',label:'Pagos/compras en USD al año',ph:'2000000'},
      {k:'spot',label:'USD/MXN de referencia',ph:'18.50',step:'0.0001',mkt:'usdmxn'},
      {k:'adverso',label:'Alza del dólar a simular (%)',ph:'8'},
      {k:'cubrir',label:'% que quieres cubrir',ph:'70'},
    ],
    build(d,mk){
      const vol=+d.vol||0, spot=+d.spot||+mk.usdmxn||0, adv=+d.adverso||8, cub=+d.cubrir||70;
      const expMXN=vol*spot, riesgo=vol*spot*adv/100, volCub=vol*cub/100, fee=vol*25/10000;
      return {
        titulo:'Cobertura cambiaria — pagos en dólares',
        situacion:`La empresa paga cerca de ${fmtUSD(vol)} al año en dólares. Cada movimiento del tipo de cambio le pega directo al costo y al margen.`,
        exposicion:[['Pagos en USD / año',fmtUSD(vol)],['Exposición en pesos',money(expMXN,'MXN')],[`Sobrecosto si el USD sube ${num(adv,0)}%`,money(riesgo,'MXN')+' / año'],['A cubrir en esta propuesta',`${fmtUSD(volCub)} (${num(cub,0)}%)`]],
        formas:[
          {n:'Forward escalonado',como:'Fija hoy el tipo de cambio de tus pagos futuros, repartido por vencimientos.',da:'Elimina por completo la incertidumbre del monto cubierto.',costo:'Sin prima; el costo va en los puntos forward (diferencial de tasas MXN–USD).'},
          {n:'Collar a costo cero',como:'Pones un techo a tu tipo de cambio y, a cambio, cedes si baja de un piso.',da:'Te protege de las alzas sin pagar prima.',costo:'Costo cero de prima.'},
        ],
        porque: mk.usdmxn?`El USD/MXN está en ${num(spot,4)}. A estos niveles, fijar o poner techo protege el presupuesto del año.`:`Una sola alza fuerte del dólar borra el margen del año. Conviene fijar o poner techo antes del próximo movimiento.`,
        eco:`Comisión estimada (25 pb sobre nocional): ${fmtUSD(fee)} / año`,
      };
    }},
  fx_exportador:{
    label:'FX · Exportador (cobra en dólares)', icon:'💱',
    segmentos:['Importador/Exportador','Agroindustria','Minería/Metales','Fintech/Remesas','Manufactura/Automotriz'],
    inputs:[
      {k:'vol',label:'Cobros en USD al año',ph:'3000000'},
      {k:'spot',label:'USD/MXN de referencia',ph:'18.50',step:'0.0001',mkt:'usdmxn'},
      {k:'adverso',label:'Baja del dólar a simular (%)',ph:'8'},
      {k:'cubrir',label:'% que quieres cubrir',ph:'60'},
    ],
    build(d,mk){
      const vol=+d.vol||0, spot=+d.spot||+mk.usdmxn||0, adv=+d.adverso||8, cub=+d.cubrir||60;
      const expMXN=vol*spot, riesgo=vol*spot*adv/100, volCub=vol*cub/100, fee=vol*25/10000;
      return {
        titulo:'Cobertura cambiaria — ingresos en dólares',
        situacion:`La empresa factura cerca de ${fmtUSD(vol)} al año en dólares pero sus costos son en pesos. Si el dólar baja, su ingreso en pesos se contrae.`,
        exposicion:[['Cobros en USD / año',fmtUSD(vol)],['Ingreso en pesos',money(expMXN,'MXN')],[`Menor ingreso si el USD baja ${num(adv,0)}%`,money(riesgo,'MXN')+' / año'],['A cubrir en esta propuesta',`${fmtUSD(volCub)} (${num(cub,0)}%)`]],
        formas:[
          {n:'Forward de venta',como:'Fija hoy el tipo de cambio al que venderás tus dólares futuros.',da:'Asegura tu ingreso en pesos del monto cubierto.',costo:'Sin prima; se opera en los puntos forward.'},
          {n:'Collar a costo cero',como:'Aseguras un piso de tipo de cambio cediendo por arriba de un techo.',da:'Protege tu ingreso mínimo sin pagar prima.',costo:'Costo cero de prima.'},
        ],
        porque: mk.usdmxn?`El USD/MXN está en ${num(spot,4)}. Es un buen nivel para asegurar el ingreso en pesos del año.`:`Un peso más fuerte reduce tu ingreso sin que vendas menos. Asegurar un piso protege el presupuesto.`,
        eco:`Comisión estimada (25 pb sobre nocional): ${fmtUSD(fee)} / año`,
      };
    }},
  combustible:{
    label:'Combustible (jet fuel / diésel)', icon:'✈️',
    segmentos:['Aerolínea/Transporte','Energía/Combustibles'],
    inputs:[
      {k:'consumo',label:'Consumo al año (galones o barriles)',ph:'5000000'},
      {k:'precio',label:'Precio de referencia (USD/unidad)',ph:'2.60',step:'0.01'},
      {k:'adverso',label:'Alza del energético a simular (%)',ph:'15'},
      {k:'cubrir',label:'% a cubrir',ph:'50'},
    ],
    build(d,mk){
      const con=+d.consumo||0, pr=+d.precio||0, adv=+d.adverso||15, cub=+d.cubrir||50;
      const costo=con*pr, riesgo=costo*adv/100, costoCub=costo*cub/100, fee=costo*25/10000;
      return {
        titulo:'Cobertura de combustible',
        situacion:`El combustible es una de las mayores partidas de costo (~${fmtUSD(costo)} al año). Un alza del crudo golpea el resultado operativo de inmediato.`,
        exposicion:[['Consumo anual',`${num(con)} unidades`],['Costo anual de combustible',fmtUSD(costo)],[`Sobrecosto si sube ${num(adv,0)}%`,fmtUSD(riesgo)+' / año'],['A cubrir en esta propuesta',`${fmtUSD(costoCub)} (${num(cub,0)}%)`]],
        formas:[
          {n:'Call spread (techo con prima acotada)',como:'Compras un call y financias parte vendiendo otro más arriba: fijas un techo de precio pagando una prima reducida.',da:'Te protege de alzas fuertes con desembolso controlado; sigues beneficiándote si el precio baja.',costo:'Prima neta reducida (la venta del call superior abarata la compra).'},
          {n:'Collar / piso-techo a costo cero',como:'Pones un techo al precio y cedes si el crudo baja de un piso.',da:'Protección total de alzas sin pagar prima.',costo:'Costo cero de prima.'},
        ],
        porque: (mk.brent||mk.wti)?`Referencia hoy: ${mk.brent?('Brent '+num(mk.brent,2)):('WTI '+num(mk.wti,2))} USD. Fijar un techo a estos niveles acota el riesgo del presupuesto de vuelo/ruta.`:`El crudo es de los precios más volátiles; un techo protege el costo por vuelo/ruta sin renunciar del todo a las bajas.`,
        eco:`Comisión estimada (25 pb sobre nocional): ${fmtUSD(fee)} / año`,
      };
    }},
  metales:{
    label:'Metales (cobre, aluminio)', icon:'🔩',
    segmentos:['Manufactura/Automotriz','Minería/Metales','Construcción/Inmobiliaria'],
    inputs:[
      {k:'metal',label:'Metal',ph:'Cobre / Aluminio',type:'text'},
      {k:'volumen',label:'Volumen anual (unidades)',ph:'500'},
      {k:'precio',label:'Precio (USD/unidad)',ph:'8500',step:'0.01'},
      {k:'adverso',label:'Alza a simular (%)',ph:'12'},
    ],
    build(d,mk){
      const met=d.metal||'metal', vol=+d.volumen||0, pr=+d.precio||0, adv=+d.adverso||12;
      const costo=vol*pr, riesgo=costo*adv/100, fee=costo*25/10000;
      return {
        titulo:`Cobertura de ${met.toLowerCase()}`,
        situacion:`El ${met.toLowerCase()} representa un insumo clave (~${fmtUSD(costo)} al año). Su precio en el mercado internacional se traslada directo al costo.`,
        exposicion:[['Volumen anual',`${num(vol)} unidades`],['Costo anual del insumo',fmtUSD(costo)],[`Sobrecosto si sube ${num(adv,0)}%`,fmtUSD(riesgo)+' / año']],
        formas:[
          {n:'Swap / forward LME',como:'Fijas hoy el precio de tu insumo a los plazos que compras (vía Marex).',da:'Elimina la incertidumbre de precio del volumen cubierto.',costo:'Sin prima; se opera contra la curva del mercado.'},
          {n:'Collar de precio',como:'Techo al precio a cambio de ceder si el metal baja de un piso.',da:'Protege el costo máximo sin pagar prima.',costo:'Costo cero de prima.'},
        ],
        porque: (met.toLowerCase().includes('cobre')&&mk.cobre)?`El cobre está en ${num(mk.cobre,2)} USD/lb. Fijar o poner techo a estos niveles protege el margen.`:(met.toLowerCase().includes('alumin')&&mk.aluminio)?`El aluminio está en ${num(mk.aluminio,0)} USD/t. Buen momento para acotar el costo del insumo.`:`Los metales industriales se mueven con el ciclo global; fijar el precio da certeza al costeo del año.`,
        eco:`Comisión estimada (25 pb sobre nocional): ${fmtUSD(fee)} / año`,
      };
    }},
  agro:{
    label:'Agrícolas (granos, café, azúcar)', icon:'🌾',
    segmentos:['Agroindustria','Retail/Comercio'],
    inputs:[
      {k:'grano',label:'Producto',ph:'Maíz / Trigo / Café',type:'text'},
      {k:'volumen',label:'Volumen anual (unidades)',ph:'100000'},
      {k:'precio',label:'Precio (USD/unidad)',ph:'5.20',step:'0.01'},
      {k:'adverso',label:'Movimiento adverso a simular (%)',ph:'15'},
    ],
    build(d,mk){
      const g=d.grano||'grano', vol=+d.volumen||0, pr=+d.precio||0, adv=+d.adverso||15;
      const valor=vol*pr, riesgo=valor*adv/100, fee=valor*25/10000;
      return {
        titulo:`Cobertura de ${g.toLowerCase()}`,
        situacion:`El precio del ${g.toLowerCase()} define directamente el margen (valor anual ~${fmtUSD(valor)}). Un movimiento adverso en el mercado internacional lo comprime.`,
        exposicion:[['Volumen anual',`${num(vol)} unidades`],['Valor anual',fmtUSD(valor)],[`Impacto si se mueve ${num(adv,0)}%`,fmtUSD(riesgo)+' / año']],
        formas:[
          {n:'Futuros CME',como:'Fijas hoy el precio de compra/venta a plazo (vía StoneX / ADM).',da:'Certeza total de precio para el volumen cubierto.',costo:'Sin prima; margen de garantía en cámara.'},
          {n:'Opciones (piso o techo)',como:'Productor: piso de venta. Comprador: techo de compra. Pagas una prima por el seguro.',da:'Proteges tu peor escenario conservando el lado favorable.',costo:'Prima de la opción (definida al cotizar).'},
        ],
        porque:`Los granos y blandos son estacionales y muy volátiles; fijar precio o poner un piso/techo asegura el margen de la cosecha/insumo.`,
        eco:`Comisión estimada (25 pb sobre nocional): ${fmtUSD(fee)} / año`,
      };
    }},
  tasa:{
    label:'Tasa de interés (deuda variable)', icon:'📈',
    segmentos:['Construcción/Inmobiliaria','Manufactura/Automotriz','Family Office/Patrimonio','Energía/Combustibles'],
    inputs:[
      {k:'deuda',label:'Deuda a tasa variable',ph:'50000000'},
      {k:'tasa',label:'Tasa de referencia actual (%)',ph:'11.25',step:'0.01',mkt:'banxico'},
      {k:'alza',label:'Alza de tasa a simular (pb)',ph:'150'},
    ],
    build(d,mk){
      const deuda=+d.deuda||0, tasa=+d.tasa||+mk.banxico||0, alza=+d.alza||150;
      const costoExtra=deuda*alza/10000, fee=deuda*10/10000;
      return {
        titulo:'Cobertura de tasa de interés',
        situacion:`La empresa tiene ${money(deuda,'')} de deuda a tasa variable. Cada alza de tasa encarece el servicio de forma inmediata.`,
        exposicion:[['Deuda a tasa variable',money(deuda,'')],['Tasa de referencia',num(tasa,2)+'%'],[`Costo extra si sube ${num(alza,0)} pb`,money(costoExtra,'')+' / año']],
        formas:[
          {n:'IRS (swap de tasa)',como:'Cambias tu tasa variable por una fija durante la vida de la deuda (vía Marex).',da:'Vuelve predecible el costo financiero; elimina el riesgo de alzas.',costo:'Sin prima; se opera en la tasa fija de mercado.'},
          {n:'Cap de tasa (techo)',como:'Pones un techo a tu tasa pagando una prima; si sube más, te compensan.',da:'Protege de alzas fuertes conservando el beneficio si la tasa baja.',costo:'Prima del cap (definida al cotizar).'},
        ],
        porque: mk.banxico?`Con la tasa de referencia en ${num(tasa,2)}%, fijar o poner techo da certeza al costo financiero del año.`:`Fijar la tasa vuelve predecible el costo de tu deuda y protege el flujo ante alzas.`,
        eco:`Comisión estimada (10 pb sobre nocional): ${money(fee,'')} / año`,
      };
    }},
  excedentes:{
    label:'Excedentes de caja (mesa de dinero)', icon:'🏦',
    segmentos:['Family Office/Patrimonio','Fintech/Remesas','Retail/Comercio','Importador/Exportador'],
    inputs:[
      {k:'monto',label:'Excedente de caja a invertir',ph:'20000000'},
      {k:'tasa',label:'Tasa esperada (%)',ph:'10.50',step:'0.01',mkt:'cetes'},
      {k:'dias',label:'Plazo (días)',ph:'90'},
    ],
    build(d,mk){
      const monto=+d.monto||0, tasa=+d.tasa||+mk.cetes||0, dias=+d.dias||90;
      const rend=monto*tasa/100*dias/360;
      return {
        titulo:'Rendimiento sobre excedentes de caja',
        situacion:`La empresa mantiene ${money(monto,'')} de caja ociosa. Bien colocada, ese dinero trabaja sin sacrificar liquidez.`,
        exposicion:[['Excedente a invertir',money(monto,'')],['Tasa esperada',num(tasa,2)+'%'],['Plazo',num(dias,0)+' días'],['Rendimiento estimado',money(rend,'')]],
        formas:[
          {n:'Mesa de dinero (Cetes / bonos)',como:'Colocas la caja en instrumentos gubernamentales a tu plazo (vía Bursamétrica).',da:'Rendimiento competitivo con liquidez y bajo riesgo.',costo:'Sin comisión explícita; el rendimiento es neto de mercado.'},
          {n:'Reporto gubernamental',como:'Inviertes contra papel gubernamental con recompra pactada.',da:'Máxima seguridad y liquidez a muy corto plazo.',costo:'Diferencial de mercado.'},
        ],
        porque: mk.cetes?`Con Cetes en ${num(tasa,2)}%, la caja ociosa puede rendir de inmediato sin comprometer liquidez.`:`Cada día de caja sin invertir es rendimiento que se deja sobre la mesa.`,
        eco:`Rendimiento estimado del periodo: ${money(rend,'')}`,
      };
    }},
};
function jugadasSugeridas(seg){ return Object.keys(JUGADAS).filter(k=>JUGADAS[k].segmentos.includes(seg)); }
function buildPropuestaFicha(o,emp,contacto){
  const L=['⚡ *PROPUESTA — '+(emp||'(prospecto)')+'*','🗓️ '+fechaLarga()];
  if(contacto) L.push('Para: '+contacto);
  L.push('_'+o.titulo+'_','',o.situacion,'','*EXPOSICIÓN*');
  o.exposicion.forEach(([k,v])=>L.push('· '+k+': '+v));
  L.push('','*2 FORMAS DE CUBRIRLO*');
  o.formas.forEach((f,i)=>{ L.push(`${i+1}) *${f.n}*`,'   ↳ '+f.como,'   ✓ '+f.da,'   💲 '+f.costo); });
  L.push('','*POR QUÉ AHORA*',o.porque,'',o.eco,'','Quedo a tus órdenes para cotizarlo en firme.','— '+brand());
  L.push('','_Cifras indicativas, sujetas a condiciones de mercado al momento de operar. No constituye recomendación de inversión._');
  return L.join('\n');
}
function propuesta1PagerHTML(o,emp,contacto){
  const mark=brand().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
  const row=([k,v])=>`<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`;
  const forma=(f,i)=>`<div class="forma"><div class="fn"><span class="fnum">${i+1}</span>${esc(f.n)}</div><p><b>Cómo:</b> ${esc(f.como)}</p><p><b>Te da:</b> ${esc(f.da)}</p><p class="fc"><b>Costo:</b> ${esc(f.costo)}</p></div>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Propuesta — ${esc(emp||'')} — ${esc(brand())}</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#1b2430;background:#eef2f7;padding:28px 16px;line-height:1.5}
.sheet{max-width:820px;margin:0 auto;background:#fff;border:1px solid #e4e9f0;border-radius:14px;overflow:hidden;box-shadow:0 8px 28px rgba(30,41,59,.12)}
.hd{background:linear-gradient(135deg,#0d9488,#0f766e);color:#fff;padding:22px 28px;display:flex;align-items:center;gap:14px}
.mk{width:46px;height:46px;border-radius:11px;background:rgba(255,255,255,.18);display:grid;place-items:center;font-weight:800;font-size:16px;letter-spacing:.5px}
.hd h1{font-size:19px;font-weight:800}.hd .sub{font-size:12.5px;opacity:.9}
.meta{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:16px 28px;border-bottom:1px solid #e4e9f0;font-size:12.5px;color:#64748b}
.meta b{color:#1b2430}
.bd{padding:20px 28px}
.tt{font-size:16px;font-weight:800;color:#0f766e;margin-bottom:6px}
.sit{font-size:13.5px;margin-bottom:18px}
.sec{font-size:11px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:#0f766e;border-bottom:1px solid #e4e9f0;padding-bottom:5px;margin:18px 0 10px}
table{width:100%;border-collapse:collapse;font-size:13px}
td{padding:7px 0;border-bottom:1px solid #eef2f7;vertical-align:top}
td.k{color:#64748b}td.v{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
.formas{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.forma{border:1px solid #e4e9f0;border-radius:11px;padding:14px;background:#f8fafc}
.fn{font-weight:800;font-size:13.5px;color:#0f766e;display:flex;align-items:center;gap:8px;margin-bottom:8px}
.fnum{width:20px;height:20px;border-radius:50%;background:#0f766e;color:#fff;display:grid;place-items:center;font-size:12px;flex:none}
.forma p{font-size:12px;margin:4px 0}.forma .fc{color:#334155}
.pq{background:#e3f6f4;border-left:3px solid #0f766e;border-radius:8px;padding:12px 14px;font-size:13px;margin-top:6px}
.eco{margin-top:14px;font-size:14px;font-weight:800;color:#0f766e}
.ft{padding:14px 28px;border-top:1px solid #e4e9f0;font-size:10.5px;color:#94a3b8}
.cta{margin:16px 28px 0;text-align:center}
.pbtn{background:#0f766e;color:#fff;border:0;border-radius:9px;padding:11px 20px;font-size:14px;font-weight:700;cursor:pointer}
@media print{body{background:#fff;padding:0}.sheet{border:0;box-shadow:none;border-radius:0;max-width:none}.cta,.pbtn{display:none!important}}
@media(max-width:600px){.formas{grid-template-columns:1fr}}
</style></head><body>
<div class="sheet">
  <div class="hd"><div class="mk">${esc(mark)}</div><div><h1>${esc(brand())}</h1><div class="sub">Propuesta de cobertura</div></div></div>
  <div class="meta"><span>Cliente: <b>${esc(emp||'—')}</b>${contacto?(' · '+esc(contacto)):''}</span><span>${esc(fechaLarga())}</span></div>
  <div class="bd">
    <div class="tt">${esc(o.titulo)}</div>
    <p class="sit">${esc(o.situacion)}</p>
    <div class="sec">Exposición</div>
    <table>${o.exposicion.map(row).join('')}</table>
    <div class="sec">Dos formas de cubrirlo</div>
    <div class="formas">${o.formas.map(forma).join('')}</div>
    <div class="sec">Por qué ahora</div>
    <div class="pq">${esc(o.porque)}</div>
    <div class="eco">${esc(o.eco)}</div>
  </div>
  <div class="cta"><button class="pbtn" onclick="window.print()">🖨 Imprimir / Guardar como PDF</button></div>
  <div class="ft">Cifras indicativas, sujetas a condiciones de mercado al momento de operar. No constituye recomendación de inversión. Elaborado por ${esc(brand())}.</div>
</div>
<script>setTimeout(function(){try{window.print()}catch(e){}},350)</script>
</body></html>`;
}
function abrirPropuesta1Pager(){
  if(!ui.propData){ toast('Primero genera la propuesta'); return; }
  const {o,emp,contacto}=ui.propData;
  const w=window.open('','_blank');
  if(!w){ toast('Permite ventanas emergentes para el PDF'); return; }
  w.document.write(propuesta1PagerHTML(o,emp,contacto)); w.document.close();
}
function renderPropuestas(){
  const jid=ui.propJugada||'fx_importador', j=JUGADAS[jid];
  const cli=state.prospects.find(p=>p.id===ui.propCliente);
  const sug=cli&&cli.segmento?jugadasSugeridas(cli.segmento):[];
  const m=state.market||{};
  const fields=j.inputs.map(f=>{
    const val=(f.mkt&&m[f.mkt])?esc(m[f.mkt]):'';
    return `<label>${f.label}<input data-prop="${f.k}" type="${f.type||'number'}" ${f.step?`step="${f.step}"`:''} value="${val}" placeholder="${f.ph||''}" /></label>`;
  }).join('');
  $('#view-propuestas').innerHTML=`
    <div class="notes-layout">
      <div class="panel">
        <h3>Generar propuesta</h3>
        <p class="muted" style="margin-top:-4px;font-size:12px">Elige la jugada, pon 2–4 datos y obtienes una propuesta lista: diagnóstico, 2 formas de cubrir, por qué ahora y tu comisión. Los niveles de mercado se rellenan solos desde <b>Notas de mercado</b>.</p>
        <label>Cliente (opcional)<select id="prop-cliente"><option value="">— Sin asignar —</option>${state.prospects.map(p=>`<option value="${p.id}" ${ui.propCliente===p.id?'selected':''}>${esc(p.empresa)}</option>`).join('')}</select></label>
        ${sug.length?`<p class="muted" style="font-size:11.5px;margin:2px 0 0">Sugerido para <b>${esc(cli.segmento)}</b>: ${sug.map(k=>JUGADAS[k].label.split(' · ')[0].split(' (')[0]).join(', ')}</p>`:''}
        <label>Jugada (tipo de exposición)<select id="prop-jugada">${Object.keys(JUGADAS).map(k=>`<option value="${k}" ${jid===k?'selected':''}>${JUGADAS[k].icon} ${JUGADAS[k].label}${sug.includes(k)?'  ★':''}</option>`).join('')}</select></label>
        <div class="grid2" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:4px">${fields}</div>
        <button class="primary-btn" id="prop-gen" style="margin-top:14px;width:100%">⚡ Generar propuesta</button>
      </div>
      <div class="panel">
        <h3>Propuesta <button class="copy-mini" id="prop-copy">Copiar</button></h3>
        <div class="note-output" id="prop-output" style="max-height:420px;overflow:auto">Elige la jugada, llena los datos y presiona <strong>Generar propuesta</strong>.</div>
        <div class="note-send">
          <a class="ghost-btn" id="prop-wa" target="_blank">▶ WhatsApp</a>
          <a class="ghost-btn" id="prop-mail">✉ Correo</a>
          <button class="ghost-btn" id="prop-pdf">🖨 1-pager (PDF)</button>
          <button class="ghost-btn" id="prop-save">💾 Guardar en cliente</button>
        </div>
      </div>
    </div>`;
  $('#prop-cliente').onchange=e=>{
    ui.propCliente=e.target.value;
    const p=state.prospects.find(x=>x.id===ui.propCliente);
    if(p&&p.segmento){ const s=jugadasSugeridas(p.segmento); if(s.length)ui.propJugada=s[0]; }
    renderPropuestas();
    if(p&&p.notional){ const vi=$('[data-prop="vol"]')||$('[data-prop="consumo"]')||$('[data-prop="deuda"]')||$('[data-prop="monto"]'); if(vi&&!vi.value)vi.value=p.notional; }
  };
  $('#prop-jugada').onchange=e=>{ ui.propJugada=e.target.value; ui.propText=''; ui.propData=null; renderPropuestas(); };
  const gen=()=>{
    const d={}; $$('[data-prop]').forEach(i=>d[i.dataset.prop]=i.value);
    const emp=cli?cli.empresa:''; const contacto=cli?(cli.contacto||''):'';
    const o=JUGADAS[jid].build(d,m);
    ui.propText=buildPropuestaFicha(o,emp,contacto);
    ui.propData={o,emp,contacto,jid,d};
    $('#prop-output').textContent=ui.propText;
    $('#prop-wa').href='https://wa.me/?text='+encodeURIComponent(ui.propText);
    $('#prop-mail').href='mailto:?subject='+encodeURIComponent(brand()+' — Propuesta de cobertura'+(emp?(' · '+emp):''))+'&body='+encodeURIComponent(ui.propText);
  };
  $('#prop-gen').onclick=gen;
  $('#prop-copy').onclick=()=>{ if(!ui.propText)gen(); copy(ui.propText); };
  $('#prop-pdf').onclick=()=>{ if(!ui.propData)gen(); abrirPropuesta1Pager(); };
  $('#prop-save').onclick=()=>{
    if(!ui.propData)gen();
    const p=state.prospects.find(x=>x.id===ui.propCliente);
    if(!p){ toast('Elige un cliente para guardar'); return; }
    p.actividades=p.actividades||[];
    p.actividades.push({id:uid(),fecha:todayISO(),tipo:'Propuesta',nota:'⚡ Propuesta ('+JUGADAS[ui.propData.jid].label+')\n'+ui.propText});
    p.actualizado=todayISO();
    save(); toast('Propuesta guardada en '+p.empresa+' ✓');
  };
  if(ui.propData&&ui.propData.jid===jid){
    $('#prop-output').textContent=ui.propText;
    $('#prop-wa').href='https://wa.me/?text='+encodeURIComponent(ui.propText);
    $('#prop-mail').href='mailto:?body='+encodeURIComponent(ui.propText);
  }
}

/* ---------- CITAS (Outlook / Google) ---------- */
function openSchedule(id){
  const p=id?state.prospects.find(x=>x.id===id):null;
  const f=$('#form-schedule'); f.reset(); f.elements.prospectId.value=id||'';
  f.elements.fecha.value=todayISO();
  f.elements.asunto.value=p?`Reunión con ${p.empresa} — diagnóstico de exposición`:'';
  updateScheduleLinks();
  $('#modal-schedule').classList.remove('hidden');
}
function schedData(){ const f=$('#form-schedule'); const d=Object.fromEntries(new FormData(f).entries());
  const start=new Date(`${d.fecha}T${d.hora||'10:00'}`); const end=new Date(start.getTime()+(+d.dur||60)*60000);
  return {...d,start,end};
}
function pad(n){return String(n).padStart(2,'0');}
function icsStamp(dt){ return dt.getUTCFullYear()+pad(dt.getUTCMonth()+1)+pad(dt.getUTCDate())+'T'+pad(dt.getUTCHours())+pad(dt.getUTCMinutes())+'00Z'; }
function updateScheduleLinks(){
  let d; try{ d=schedData(); }catch(e){ return; }
  if(isNaN(d.start)) return;
  const s=icsStamp(d.start),e=icsStamp(d.end);
  const ol='https://outlook.office.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent'
    +'&subject='+encodeURIComponent(d.asunto||'')+'&body='+encodeURIComponent(d.notas||'')+'&location='+encodeURIComponent(d.lugar||'')
    +'&startdt='+d.start.toISOString()+'&enddt='+d.end.toISOString();
  const gc='https://calendar.google.com/calendar/render?action=TEMPLATE&text='+encodeURIComponent(d.asunto||'')
    +'&dates='+s+'/'+e+'&details='+encodeURIComponent(d.notas||'')+'&location='+encodeURIComponent(d.lugar||'');
  $('#sch-outlook').href=ol; $('#sch-google').href=gc;
}
function makeICS(o){ return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Insitum Capital CRM//ES','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',
  'UID:'+uid()+'@insitum','DTSTAMP:'+icsStamp(new Date()),'DTSTART:'+icsStamp(o.start),'DTEND:'+icsStamp(o.end),
  'SUMMARY:'+(o.asunto||'Cita'),'LOCATION:'+(o.lugar||''),'DESCRIPTION:'+((o.notas||'').replace(/\n/g,'\\n')),'END:VEVENT','END:VCALENDAR'].join('\r\n'); }
function dlICS(ics,name){ const blob=new Blob([ics],{type:'text/calendar'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=(name||'cita')+'.ics'; a.click(); }
function outlookLink(o){ return 'https://outlook.office.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject='+encodeURIComponent(o.asunto||'')+'&body='+encodeURIComponent(o.notas||'')+'&location='+encodeURIComponent(o.lugar||'')+'&startdt='+o.start.toISOString()+'&enddt='+o.end.toISOString(); }
function downloadICS(){
  const d=schedData(); if(isNaN(d.start)){toast('Falta la fecha');return;}
  dlICS(makeICS({asunto:d.asunto,start:d.start,end:d.end,lugar:d.lugar,notas:d.notas}));
  if(d.prospectId){ const p=state.prospects.find(x=>x.id===d.prospectId); if(p){ p.actividades=p.actividades||[]; p.actividades.push({id:uid(),fecha:d.fecha,tipo:'Reunión',nota:'Cita agendada: '+(d.asunto||'')}); p.proximaAccion=d.asunto; p.fechaProxima=d.fecha; save(); } }
  closeModals(); render(); toast('Cita descargada (.ics) y registrada ✓');
}
/* ---------- MOVER ETAPA (seguimiento real) ---------- */
function openMove(id,newStage){
  const p=state.prospects.find(x=>x.id===id); if(!p)return;
  const f=$('#form-move'); f.reset();
  f.elements.prospectId.value=id; f.elements.etapa.value=newStage;
  $('#move-title').textContent=`${p.empresa}  →  ${newStage}`;
  const won=WON_STAGES.includes(newStage);
  $('#move-won-fields').classList.toggle('hidden',!won);
  $('#move-reunion-fields').classList.add('hidden'); $('#move-reunion').checked=false;
  f.elements.rfecha.value=todayISO(); f.elements.wfecha.value=todayISO();
  const sug=nextStep(Object.assign({},p,{etapa:newStage,fechaProxima:''}));
  f.elements.proximaAccion.value = won?'Dar mantenimiento y detectar nueva operación':sug.accion;
  $('#move-hint').textContent = won?'Registra la ganancia para tus reportes':'Se guarda como actividad y avanza la etapa';
  $('#modal-move').classList.remove('hidden');
}
function submitMove(e){
  e.preventDefault(); const d=Object.fromEntries(new FormData(e.target).entries());
  const p=state.prospects.find(x=>x.id===d.prospectId); if(!p)return;
  p.actividades=p.actividades||[];
  p.actividades.push({id:uid(),fecha:todayISO(),tipo:d.canal||'Nota',nota:d.quehiciste||''});
  // ¿generó reunión? -> calendario
  if(d.genreunion==='on' && d.rfecha){
    const start=new Date(`${d.rfecha}T${d.rhora||'10:00'}`); const end=new Date(start.getTime()+60*60000);
    const asunto=`Reunión: ${p.empresa} — ${brand()}`;
    dlICS(makeICS({asunto,start,end,lugar:d.rlugar,notas:d.quehiciste}),'reunion');
    try{ window.open(outlookLink({asunto,start,end,lugar:d.rlugar,notas:d.quehiciste}),'_blank'); }catch(_){}
    p.actividades.push({id:uid(),fecha:d.rfecha,tipo:'Reunión',nota:'Cita agendada'+(d.rlugar?(' · '+d.rlugar):'')});
    p.proximaAccion='Reunión'+(d.rlugar?(' · '+d.rlugar):''); p.fechaProxima=d.rfecha;
  }
  // ganado -> info operativa + ganancia
  if(WON_STAGES.includes(d.etapa)){
    p.notional=Number(d.wvolumen)||p.notional||0;
    if(d.wganancia)p.feeMonto=Number(d.wganancia);
    p.probabilidad=100;
    p.operacion={producto:d.wproducto||'',volumen:Number(d.wvolumen)||0,nivel:d.wnivel||'',ganancia:Number(d.wganancia)||0,fecha:d.wfecha||todayISO()};
    p.actividades.push({id:uid(),fecha:d.wfecha||todayISO(),tipo:'Operación',nota:`GANADO: ${d.wproducto||'operación'} · vol ${fmtUSD(Number(d.wvolumen)||0)} · ganancia ${fmtUSD(Number(d.wganancia)||0)}`});
  }
  if(d.proximaAccion)p.proximaAccion=d.proximaAccion;
  if(d.fechaProxima)p.fechaProxima=d.fechaProxima;
  moveStage(p,d.etapa);
  closeModals(); render();
  if(!$('#drawer-client').classList.contains('hidden'))openClient(p.id);
  toast(`${p.empresa} → ${d.etapa} ✓`+(d.genreunion==='on'?' · cita .ics':''));
}

/* ---------- SEGUIMIENTO ---------- */
function pendingActivities(){ return state.prospects.filter(p=>p.fechaProxima).map(p=>({p,fecha:p.fechaProxima,accion:p.proximaAccion||'Dar seguimiento',dias:daysFromToday(p.fechaProxima),etapa:p.etapa})).sort((a,b)=>a.dias-b.dias); }
function badgeFor(d){ if(d<0)return`<span class="badge overdue">Vencida ${-d}d</span>`; if(d===0)return`<span class="badge today">Hoy</span>`; if(d<=7)return`<span class="badge soon">En ${d}d</span>`; return`<span class="tag">En ${d}d</span>`; }
function actItem(a){ return `<div class="list-item" data-client="${a.p.id}" style="cursor:pointer"><div><strong>${esc(a.accion)}</strong><div class="meta">${esc(a.p.empresa)} · ${esc(a.p.contacto||'')}</div></div><div style="text-align:right">${badgeFor(a.dias)}<div class="meta">${a.fecha}</div></div></div>`; }
function renderSeguimiento(){
  const acts=pendingActivities();
  const groups=[['Vencidas',acts.filter(a=>a.dias<0)],['Hoy',acts.filter(a=>a.dias===0)],['Próximos 7 días',acts.filter(a=>a.dias>0&&a.dias<=7)],['Más adelante',acts.filter(a=>a.dias>7)]];
  $('#view-seguimiento').innerHTML=`
    <div class="panel"><h3>Cadencia recomendada</h3><div class="list">
      <div class="list-item"><span><strong>Día 0</strong> — Primer contacto + alta en CRM</span></div>
      <div class="list-item"><span><strong>Día 2</strong> — Nota de mercado de su industria</span></div>
      <div class="list-item"><span><strong>Día 5</strong> — Llamada + agendar cita de diagnóstico</span></div>
      <div class="list-item"><span><strong>Día 10</strong> — Cotización con escenario concreto</span></div>
      <div class="list-item"><span><strong>Día 15+</strong> — Seguimiento semanal hasta cierre</span></div>
    </div></div>
    ${groups.map(([t,arr])=>`<div class="panel"><h3>${t} <span class="muted">${arr.length}</span></h3><div class="list">${arr.map(actItem).join('')||empty('Nada aquí.')}</div></div>`).join('')}`;
  bindRowClicks();
}

/* ---------- NOTAS DE MERCADO ---------- */
function renderNotas(){
  const m=state.market||{};
  const marketInputs=MARKET.map(f=>`<label class="mkt"><span>${f.label}${f.unit?` <small>(${f.unit})</small>`:''}</span><input data-mkt="${f.k}" type="text" value="${esc(m[f.k]||'')}" placeholder="—" /></label>`).join('');
  const hist=(state.notes||[]).slice().reverse();
  $('#view-notas').innerHTML=`
    <div class="notes-layout">
      <div class="panel"><h3>Datos de mercado <span style="float:right;display:flex;gap:6px"><button class="copy-mini" id="mkt-live">🔄 En vivo</button><button class="copy-mini" id="mkt-save">Guardar</button></span></h3>
        <p class="muted" style="margin-top:-6px;font-size:12px">Pulsa <b>🔄 En vivo</b> para traer los datos solos, o captúralos a mano. Se reutilizan en todas las notas. <span style="opacity:.7">Fuente FX: BCE · commodities: Yahoo (indicativo).</span></p>
        <div class="mkt-grid">${marketInputs}</div>
        <label style="margin-top:10px">Agenda / eventos del día<textarea id="nt-eventos" rows="2" placeholder="Ej. 7:30 CPI EE.UU.; subasta de Cetes">${esc(m._eventos||'')}</textarea></label>
        <label>Comentario táctico general<textarea id="nt-coment" rows="2" placeholder="Lectura del día / oportunidad de cobertura">${esc(m._coment||'')}</textarea></label>
      </div>
      <div class="panel"><h3>Generar nota</h3>
        <div class="note-controls">
          <div class="seg-toggle"><button data-modo="apertura" class="${ui.noteModo==='apertura'?'on':''}">☀️ Apertura</button><button data-modo="cierre" class="${ui.noteModo==='cierre'?'on':''}">🌙 Cierre</button></div>
          <div class="seg-toggle"><button data-alc="industria" class="${ui.noteAlcance==='industria'?'on':''}">Por industria</button><button data-alc="consolidada" class="${ui.noteAlcance==='consolidada'?'on':''}">Consolidada</button><button data-alc="general" class="${ui.noteAlcance==='general'?'on':''}">General</button></div>
          <select id="nt-industria" class="${ui.noteAlcance==='industria'?'':'hidden'}">${state.industries.map(i=>`<option ${ui.noteIndustria===i.name?'selected':''}>${esc(i.name)}</option>`).join('')}</select>
          <div class="seg-toggle"><button data-fmt="whatsapp" class="${ui.noteFmt==='whatsapp'?'on':''}">WhatsApp</button><button data-fmt="email" class="${ui.noteFmt==='email'?'on':''}">Correo</button></div>
        </div>
        <div class="note-output" id="note-output">Captura los datos y presiona <strong>Generar</strong>.</div>
        <div class="note-send"><button class="primary-btn" id="nt-generate">Generar</button><button class="ghost-btn" id="nt-copy">Copiar</button><a class="ghost-btn" id="nt-wa" target="_blank">▶ WhatsApp</a><a class="ghost-btn" id="nt-mail">✉ Correo</a><button class="ghost-btn" id="nt-save">Guardar</button></div>
        ${ui.noteAlcance==='industria'?'<button class="btn-sm" id="nt-all" style="margin-top:8px">Generar todas las industrias</button>':''}
      </div>
    </div>
    <div class="panel hidden" id="nt-clientes-panel"></div>
    <div class="panel"><h3>Historial <span class="muted">${hist.length}</span></h3><div class="list">${hist.map(n=>`<div class="list-item"><div><strong>${esc(n.titulo)}</strong><div class="meta">${n.fecha} · ${esc(n.modo)} · ${esc(n.alcance)} · ${n.fmt}</div></div><div><button class="btn-sm" data-copynote="${n.id}">Copiar</button> <button class="btn-sm" data-delnote="${n.id}">🗑</button></div></div>`).join('')||empty('Aún no guardas notas.')}</div></div>`;
  const readMarket=()=>{const o={};$$('[data-mkt]').forEach(i=>{if(i.value.trim())o[i.dataset.mkt]=i.value.trim();});o._eventos=$('#nt-eventos').value;o._coment=$('#nt-coment').value;return o;};
  let lastTxt='';
  const gen=()=>{const mk=readMarket();state.market=mk;
    if(ui.noteAlcance==='industria'){const ind=state.industries.find(i=>i.name===(ui.noteIndustria||state.industries[0].name))||state.industries[0];ui.noteIndustria=ind.name;lastTxt=buildIndustryNote(ind,ui.noteModo,ui.noteFmt,mk);}
    else if(ui.noteAlcance==='consolidada')lastTxt=buildConsolidated(ui.noteModo,ui.noteFmt,mk);
    else lastTxt=buildGeneral(ui.noteModo,ui.noteFmt,mk);
    $('#note-output').textContent=lastTxt;links(lastTxt);renderNoteClients(lastTxt);return lastTxt;};
  const links=(txt)=>{const wa=$('#nt-wa'),ml=$('#nt-mail');if(wa)wa.href='https://wa.me/?text='+encodeURIComponent(txt);if(ml)ml.href='mailto:?subject='+encodeURIComponent(`${brand()} — ${ui.noteModo==='apertura'?'Apertura':'Cierre'} de mercado`)+'&body='+encodeURIComponent(txt);};
  $('#mkt-save').onclick=()=>{state.market=readMarket();save();toast('Datos guardados ✓');};
  $('#mkt-live').onclick=fetchMarketLive;
  $('#nt-generate').onclick=gen; $('#nt-copy').onclick=()=>copy(lastTxt||gen());
  $('#nt-save').onclick=()=>{const txt=lastTxt||gen();state.notes=state.notes||[];state.notes.push({id:uid(),fecha:todayISO(),titulo:`${ui.noteModo==='apertura'?'Apertura':'Cierre'} — ${ui.noteAlcance==='industria'?ui.noteIndustria:ui.noteAlcance}`,modo:ui.noteModo,alcance:ui.noteAlcance,fmt:ui.noteFmt,text:txt});save();render();toast('Nota guardada ✓');};
  $$('.note-controls [data-modo]').forEach(b=>b.onclick=()=>{ui.noteModo=b.dataset.modo;renderNotas();});
  $$('.note-controls [data-alc]').forEach(b=>b.onclick=()=>{ui.noteAlcance=b.dataset.alc;renderNotas();});
  $$('.note-controls [data-fmt]').forEach(b=>b.onclick=()=>{ui.noteFmt=b.dataset.fmt;renderNotas();});
  const si=$('#nt-industria'); if(si)si.onchange=e=>{ui.noteIndustria=e.target.value;gen();};
  const ab=$('#nt-all'); if(ab)ab.onclick=()=>{const mk=readMarket();const all=state.industries.map(i=>buildIndustryNote(i,ui.noteModo,ui.noteFmt,mk)).join('\n\n──────────\n\n');$('#note-output').textContent=all;lastTxt=all;links(all);toast('Generadas '+state.industries.length+' notas');};
  $$('[data-copynote]').forEach(b=>b.onclick=()=>{const n=state.notes.find(x=>x.id===b.dataset.copynote);if(n)copy(n.text);});
  $$('[data-delnote]').forEach(b=>b.onclick=()=>{state.notes=state.notes.filter(x=>x.id!==b.dataset.delnote);save();render();});
  gen();
}
/* Trae datos de mercado en vivo desde APIs gratuitas (sin claves) */
// Trae datos de mercado a state.market (sin depender del DOM) — usable desde cualquier vista
async function fetchMarketData(){
  state.market=state.market||{}; const ok=[];
  const sym={usdmxn:'MXN=X',eurusd:'EURUSD=X',eurmxn:'EURMXN=X',dxy:'DX-Y.NYB',brent:'BZ=F',wti:'CL=F',gasnat:'NG=F',oro:'GC=F',plata:'SI=F',cobre:'HG=F',maiz:'ZC=F',trigo:'ZW=F',soya:'ZS=F',cafe:'KC=F',azucar:'SB=F',sp500:'^GSPC',dow:'^DJI',nasdaq:'^IXIC',ipcmx:'^MXX',nikkei:'^N225',dax:'^GDAXI',vix:'^VIX',ust10:'^TNX'};
  const dec=k=>(['usdmxn','eurusd','eurmxn'].includes(k)?4:['sp500','dow','nasdaq','nikkei','dax','ipcmx'].includes(k)?0:2);
  const proxies=[u=>'https://api.allorigins.win/raw?url='+encodeURIComponent(u), u=>'https://corsproxy.io/?url='+encodeURIComponent(u)];
  const one=async(k,s)=>{ const yu='https://query1.finance.yahoo.com/v8/finance/chart/'+s+'?interval=1d&range=1d';
    for(const px of proxies){ try{
      const ctl=new AbortController(); const to=setTimeout(()=>ctl.abort(),8000);
      const t=await (await fetch(px(yu),{signal:ctl.signal})).text(); clearTimeout(to);
      const p=JSON.parse(t)?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if(p){ state.market[k]= dec(k)===0?String(Math.round(p)):(+p).toFixed(dec(k)); ok.push(MLAB[k].label); return; }
    }catch(e){} } };
  await Promise.allSettled(Object.entries(sym).map(([k,s])=>one(k,s)));
  save(); return ok;
}
// Noticias reales (titulares) vía Google News RSS + proxy CORS
async function fetchNews(){
  const proxies=[u=>'https://api.allorigins.win/raw?url='+encodeURIComponent(u), u=>'https://corsproxy.io/?url='+encodeURIComponent(u)];
  const get=async(q)=>{ const rss='https://news.google.com/rss/search?q='+encodeURIComponent(q+' when:2d')+'&hl=es-419&gl=MX&ceid=MX:es-419';
    for(const px of proxies){ try{
      const ctl=new AbortController(); const to=setTimeout(()=>ctl.abort(),9000);
      const t=await (await fetch(px(rss),{signal:ctl.signal})).text(); clearTimeout(to);
      const items=[...t.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m=>{
        const tt=(m[1].match(/<title>([\s\S]*?)<\/title>/)||[])[1]||'';
        const pd=new Date((m[1].match(/<pubDate>([\s\S]*?)<\/pubDate>/)||[])[1]||0);
        return {t: tt.replace(/<!\[CDATA\[|\]\]>/g,'').trim(), d: pd};
      }).filter(x=>x.t);
      if(items.length){
        const frescas=items.filter(x=>!isNaN(x.d) && (Date.now()-x.d.getTime())<48*3600*1000).sort((a,b)=>b.d-a.d);
        return (frescas.length>=2?frescas:items).slice(0,5).map(x=>x.t);
      }
    }catch(e){} } return [];
  };
  const [intl,local]=await Promise.all([
    get('mercados financieros dólar tasas Fed bolsas'),
    get('economía México peso Banxico mercados')]);
  state.news={intl,local,fecha:todayISO()}; save(); return state.news;
}
function briefLines(mk,keys){ return keys.map(k=>mk[k]?`• ${lbl(k)}: ${mk[k]}`:null).filter(Boolean); }
function buildAperturaBrief(mk,news){
  mk=mk||{}; news=news||{};
  const out=[`📊 *${brand()}*`,`*Apertura de Mercados* ☀️`,`🗓️ ${fechaLarga()}`];
  const div=briefLines(mk,['usdmxn','eurusd','dxy']); if(div.length){out.push('','*💱 Divisas*',...div);}
  const idx=briefLines(mk,['sp500','dow','nasdaq','ipcmx','nikkei','dax']); if(idx.length){out.push('','*📈 Índices*',...idx);}
  const com=briefLines(mk,['brent','wti','oro','plata','cobre']); if(com.length){out.push('','*🛢️ Commodities*',...com);}
  const tas=briefLines(mk,['ust10','banxico','vix']); if(tas.length){out.push('','*📉 Tasas / Riesgo*',...tas);}
  if(mk._eventos){out.push('','*📌 Agenda:* '+mk._eventos);}
  if(news.intl&&news.intl.length){out.push('','*🌎 Internacional*',...news.intl.slice(0,4).map(h=>`• ${h}`));}
  if(news.local&&news.local.length){out.push('','*🇲🇽 México*',...news.local.slice(0,4).map(h=>`• ${h}`));}
  out.push('','_Indicativo, no constituye recomendación de inversión._');
  return out.join('\n');
}
async function fetchMarketLive(){ // botón en Notas
  const btn=document.getElementById('mkt-live'); if(btn){btn.textContent='Actualizando…';btn.disabled=true;}
  const ev=document.getElementById('nt-eventos'), cm=document.getElementById('nt-coment');
  state.market=state.market||{}; if(ev)state.market._eventos=ev.value; if(cm)state.market._coment=cm.value;
  const ok=await fetchMarketData();
  document.querySelectorAll('[data-mkt]').forEach(i=>{ const v=state.market[i.dataset.mkt]; if(v!=null)i.value=v; });
  if(btn){btn.textContent='🔄 En vivo';btn.disabled=false;}
  const g=document.getElementById('nt-generate'); if(g)g.click();
  toast(ok.length?('Actualizado: '+ok.slice(0,7).join(', ')+(ok.length>7?'…':'')):'No se pudo actualizar (revisa tu internet)');
}
function renderNoteClients(txt){
  const panel=$('#nt-clientes-panel'); if(!panel)return;
  if(ui.noteAlcance!=='industria'){ panel.classList.add('hidden'); return; }
  const ind=ui.noteIndustria||(state.industries[0]&&state.industries[0].name);
  const clientes=state.prospects.filter(p=>p.segmento===ind);
  const conWa=clientes.filter(p=>p.telefono).sort((a,b)=>((b.potencial==='alto')-(a.potencial==='alto')));
  const subj=encodeURIComponent(brand()+' — '+(ui.noteModo==='apertura'?'Apertura':'Cierre')+' de mercado');
  panel.classList.remove('hidden');
  panel.innerHTML=`<h3>👋 Enviar buenos días a clientes de ${esc(ind)} <span class="muted">${conWa.length} con WhatsApp · ${clientes.length} en la industria</span></h3>
    <p class="muted" style="margin-top:-6px;font-size:12px">Cada botón abre WhatsApp con la nota ya escrita; solo confirmas el envío.</p>
    ${conWa.length?`<div class="list">${conWa.slice(0,40).map(p=>{const ph=(p.telefono||'').replace(/[^\d]/g,'');return `<div class="list-item"><div data-client="${p.id}" style="cursor:pointer"><strong>${p.potencial==='alto'?'⭐ ':''}${esc(p.empresa)}</strong><div class="meta">${esc(p.contacto||'—')} · ${esc(p.telefono)}</div></div><div style="display:flex;gap:6px">${ph?`<a class="btn-sm" target="_blank" href="https://wa.me/${ph}?text=${encodeURIComponent(txt)}">▶ WhatsApp</a>`:''}${p.email?`<a class="btn-sm" href="mailto:${esc(p.email)}?subject=${subj}&body=${encodeURIComponent(txt)}">✉</a>`:''}</div></div>`;}).join('')}</div>${conWa.length>40?`<div class="muted" style="margin-top:8px;font-size:12px">+${conWa.length-40} más</div>`:''}`:empty('Esta industria aún no tiene clientes con teléfono. Usa el botón ▶ WhatsApp general de arriba y elige el contacto.')}`;
  bindRowClicks();
}
function mktLine(mk,keys){ return keys.map(k=>{const v=mk[k];if(!v)return null;return `${MLAB[k].label}: ${v}`;}).filter(Boolean); }
function buildIndustryNote(ind,modo,fmt,mk){
  const titulo=`${modo==='apertura'?'Apertura':'Cierre'} de Mercado — ${ind.name}`, lines=mktLine(mk,ind.vars&&ind.vars.length?ind.vars:['usdmxn']), disc='Informativo, no constituye recomendación de inversión.';
  if(fmt==='whatsapp')return [`📊 *${brand()}*`,`*${titulo}*`,`🗓️ ${fechaLarga()}`,``,...lines.map(l=>`• ${l}`),ind.tip?`\n🎯 ${ind.tip}`:'',mk._eventos?`\n📌 Agenda: ${mk._eventos}`:'',mk._coment?`\n💬 ${mk._coment}`:'',`\n_${disc}_`].filter(Boolean).join('\n');
  return [`${brand()}`,`${titulo}`,`${fechaLarga()}`,``,...lines.map(l=>`• ${l}`),``,ind.tip?`Enfoque: ${ind.tip}`:'',mk._eventos?`Agenda del día: ${mk._eventos}`:'',mk._coment?`Comentario: ${mk._coment}`:'',``,`Quedamos a sus órdenes para revisar su exposición.`,`— Mesa de ${brand()}`,``,`—`,disc].filter(x=>x!=='').join('\n');
}
function buildConsolidated(modo,fmt,mk){
  const head=fmt==='whatsapp'?[`📊 *${brand()}*`,`*${modo==='apertura'?'Apertura':'Cierre'} de Mercado*`,`🗓️ ${fechaLarga()}`,'']:[`${brand()}`,`${modo==='apertura'?'Apertura':'Cierre'} de Mercado`,`${fechaLarga()}`,''];
  const secs=state.industries.map(ind=>{const lines=mktLine(mk,ind.vars&&ind.vars.length?ind.vars:['usdmxn']);if(!lines.length&&!ind.tip)return null;return (fmt==='whatsapp'?`*▸ ${ind.name}*\n`:`▸ ${ind.name}\n`)+lines.map(l=>`   ${l}`).join('\n')+(ind.tip?`\n   🎯 ${ind.tip}`:'');}).filter(Boolean);
  const foot=mk._coment?['',fmt==='whatsapp'?`💬 ${mk._coment}`:`Comentario: ${mk._coment}`]:[];
  return [...head,...secs.join('\n\n').split('\n'),...foot,'',fmt==='whatsapp'?'_Informativo, no es recomendación._':'Informativo, no constituye recomendación de inversión.'].join('\n');
}
function buildGeneral(modo,fmt,mk){
  const lines=mktLine(mk,['usdmxn','eurusd','brent','wti','oro','sp500','banxico','ust10']);
  if(fmt==='whatsapp')return [`📊 *${brand()}*`,`*${modo==='apertura'?'Apertura':'Cierre'} de Mercado*`,`🗓️ ${fechaLarga()}`,'',...lines.map(l=>`• ${l}`),mk._eventos?`\n📌 ${mk._eventos}`:'',mk._coment?`\n💬 ${mk._coment}`:'','\n_Informativo, no es recomendación._'].filter(Boolean).join('\n');
  return [`${brand()}`,`${modo==='apertura'?'Apertura':'Cierre'} de Mercado`,`${fechaLarga()}`,'',...lines.map(l=>`• ${l}`),'',mk._eventos?`Agenda: ${mk._eventos}`:'',mk._coment?`Comentario: ${mk._coment}`:'','','— Mesa de '+brand(),'','—','Informativo, no constituye recomendación de inversión.'].filter(x=>x!=='').join('\n');
}

/* ---------- PRODUCTOS ---------- */
function renderProductos(){
  const scripts=[
    {t:'Apertura en frío',s:`Hola [Nombre], habla [Tu nombre] de ${brand()}. Ayudamos a empresas como [Empresa] a proteger su margen del tipo de cambio y sus insumos, con casas como Marex y StoneX. ¿Hoy cómo manejan su exposición: con la banca, spot, o ya con coberturas?`},
    {t:'Gancho de ahorro',s:'Muchos clientes pagaban a su banco 15 a 30 centavos por dólar de spread. Nosotros operamos a niveles institucionales. Compárteme tu volumen anual en USD y te calculo el ahorro al año, sin compromiso.'},
    {t:'Gancho de cobertura',s:'Si el peso (o tu insumo) se mueve 5%, ¿qué pasa con tu margen? Fijamos hoy tu precio con un forward: dejas de adivinar. Te armo un escenario con tus números.'},
    {t:'Cierre a reunión',s:'Te propongo 15 minutos: diagnóstico de exposición sin costo y 2-3 estructuras concretas. ¿Jueves 10 o viernes?'},
  ];
  const byCat={}; state.products.forEach(p=>{(byCat[p.categoria||'Otro']=byCat[p.categoria||'Otro']||[]).push(p);});
  $('#view-productos').innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><span class="muted">${state.products.length} productos · clic para editar</span><button class="primary-btn" id="btn-new-product">+ Nuevo producto</button></div>
    ${Object.keys(byCat).map(cat=>`<h3 style="margin:18px 0 8px;color:var(--accent)">${esc(cat)}</h3><div class="prod-grid">${byCat[cat].map(p=>`<div class="prod" data-prod-edit="${p.id}"><button class="copy-mini" data-prod-del="${p.id}">🗑</button><h4>${esc(p.nombre)}</h4>${p.prov?`<div class="prov">vía ${esc(p.prov)}</div>`:''}<p>${esc(p.desc||'')}</p>${p.ideal?`<div class="ideal">🎯 ${esc(p.ideal)}</div>`:''}</div>`).join('')}</div>`).join('')}
    <div class="panel" style="margin-top:22px"><h3>Guiones de prospección <span class="muted">clic para copiar</span></h3>${scripts.map(x=>`<div class="script-box"><button class="copy-mini" data-copyscript="${esc(x.s)}">Copiar</button><strong>${x.t}</strong><br>${esc(x.s)}</div>`).join('')}</div>`;
  $('#btn-new-product').onclick=()=>openProduct(null);
  $$('[data-prod-edit]').forEach(el=>el.onclick=e=>{if(e.target.closest('[data-prod-del]'))return;openProduct(el.dataset.prodEdit);});
  $$('[data-prod-del]').forEach(b=>b.onclick=e=>{e.stopPropagation();if(confirm('¿Eliminar este producto?')){state.products=state.products.filter(x=>x.id!==b.dataset.prodDel);save();render();}});
  $$('[data-copyscript]').forEach(b=>b.onclick=()=>copy(b.dataset.copyscript));
}
function openProduct(id){const f=$('#form-product');f.reset();const p=id?state.products.find(x=>x.id===id):null;$('#modal-product-title').textContent=p?'Editar producto':'Nuevo producto';if(p)for(const k of ['id','nombre','categoria','prov','desc','ideal'])if(f.elements[k])f.elements[k].value=p[k]||'';$('#modal-product').classList.remove('hidden');}
function submitProduct(e){e.preventDefault();const d=Object.fromEntries(new FormData(e.target).entries());let p=d.id?state.products.find(x=>x.id===d.id):null;if(!p){p={id:uid()};state.products.push(p);}Object.assign(p,{nombre:d.nombre,categoria:d.categoria,prov:d.prov,desc:d.desc,ideal:d.ideal});save();closeModals();render();toast('Producto guardado ✓');}

/* ---------- EQUIPO (admin) ---------- */
function renderEquipo(){
  const v=$('#view-equipo');
  if(!DB.isAdmin(ME.email)){ v.innerHTML=empty('Solo el administrador puede ver la cartera del equipo.'); return; }
  v.innerHTML=`<div class="empty">Cargando cartera del equipo…</div>`;
  DB.loadAll().then(rows=>{
    let totPipe=0,totWon=0,totCli=0;
    const cards=rows.map(r=>{ const ps=(r.data&&r.data.prospects)||[]; const open=ps.filter(p=>OPEN_STAGES.includes(p.etapa));
      const pipe=open.reduce((s,p)=>s+revenueOf(p),0); const won=ps.filter(p=>WON_STAGES.includes(p.etapa)).reduce((s,p)=>s+revenueOf(p),0);
      totPipe+=pipe;totWon+=won;totCli+=ps.length;
      const nombre=userName(r.email);
      return {nombre,email:r.email,n:ps.length,open:open.length,pipe,won};
    }).sort((a,b)=>b.pipe-a.pipe);
    v.innerHTML=`
      <div class="kpi-grid"><div class="kpi gold"><div class="label">Pipeline del equipo</div><div class="value">${fmtUSD(totPipe)}</div><div class="delta muted">${rows.length} socios</div></div>
      <div class="kpi good"><div class="label">Ganado del equipo</div><div class="value">${fmtUSD(totWon)}</div></div>
      <div class="kpi"><div class="label">Clientes totales</div><div class="value">${totCli}</div></div>
      <div class="kpi"><div class="label">Promedio por socio</div><div class="value">${fmtUSD(rows.length?Math.round(totPipe/rows.length):0)}</div></div></div>
      <div class="table-wrap"><table><thead><tr><th>Socio</th><th>Clientes</th><th>Abiertos</th><th style="text-align:right">Pipeline</th><th style="text-align:right">Ganado</th></tr></thead>
      <tbody>${cards.map(c=>`<tr><td><strong>${esc(c.nombre)}</strong><div class="meta">${esc(c.email)}</div></td><td>${c.n}</td><td>${c.open}</td><td style="text-align:right;color:var(--gold)">${fmtUSD(c.pipe)}</td><td style="text-align:right;color:var(--green)">${fmtUSD(c.won)}</td></tr>`).join('')||`<tr><td colspan="5">${empty('Sin datos de socios todavía.')}</td></tr>`}</tbody></table></div>
      <p class="muted" style="margin-top:12px">Vista de solo lectura. ${DB.cloud?'Datos en vivo de la nube.':'En modo demo se muestran las carteras guardadas en este navegador.'}</p>`;
  }).catch(e=>{ v.innerHTML=empty('Error al cargar: '+e.message); });
}

/* ---------- PLAYBOOK ---------- */
function renderPlaybook(){
  $('#view-playbook').innerHTML=`<div class="prose">
    <h2>1. Modelo de negocio</h2><p><strong>${brand()}</strong> opera como consultoría / introducing broker: detectas la necesidad del cliente (FX, commodities, inversiones, transferencias) y la canalizas a la mesa institucional (Marex, StoneX, ADM, Bursamétrica). Cobras vía spread o comisión sobre el volumen. Este CRM es tu fábrica de ingresos.</p>
    <h2>2. Dinero rápido (prioridad)</h2><ul><li><strong>Transferencias / FX spot</strong> — ciclo corto, ahorro inmediato. Empieza aquí.</li><li><strong>Coberturas cambiarias</strong> — ticket medio.</li><li><strong>Commodities</strong> — ticket grande (aerolíneas, agro, energía).</li><li><strong>Inversiones</strong> — recurrencia.</li></ul>
    <h2>3. La cadena virtuosa</h2><ul><li><strong>Cliente nuevo</strong> → lista construida.</li><li><strong>Contactado</strong> → gancho + nota de su industria.</li><li><strong>Reunión</strong> → diagnóstico (agenda la cita a Outlook).</li><li><strong>Propuesta</strong> → cotización con sus números.</li><li><strong>Negociación</strong> → ajuste.</li><li><strong>Ganado → Cliente activo</strong> → primera operación y recurrencia.</li></ul>
    <h2>4. Disciplina diaria</h2><ul><li>☀️ <strong>8:00</strong> — Manda la <b>apertura</b> por industria.</li><li>📞 <strong>9:00–13:00</strong> — 10 toques + revisar vencidas/hoy.</li><li>🤝 <strong>Tarde</strong> — Reuniones y cotizaciones.</li><li>🌙 <strong>Cierre</strong> — Manda el <b>cierre</b> y agenda la próxima acción de cada cliente.</li></ul>
    <p class="muted" style="margin-top:24px">Nota legal: la intermediación y operación de derivados está regulada. Verifica que la colocación se realice a través de las entidades autorizadas y bajo los contratos y avisos correspondientes. Herramienta de gestión comercial, no de asesoría regulada.</p></div>`;
}

/* ---------- AJUSTES ---------- */
function normName(s){ return (s||'').toString().trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^A-Z0-9]+/g,' ').trim(); }
function baseSig(){ const b=window.BASE_CLIENTES; return b&&b.length?(b.length+'|'+(b[0]?b[0].empresa:'')):''; }
function cargarBase(silent){
  const base=window.BASE_CLIENTES; if(!base||!base.length){ if(!silent)toast('No hay base para cargar'); return; }
  if(!silent && !confirm('Se cargarán/actualizarán '+base.length+' contactos en TU cartera como "Cliente nuevo" para prospectar. Tus clientes creados a mano se conservan. ¿Continuar?')) return;
  // refrescar: quitar importaciones previas (se reemplazan por la base actual)
  state.prospects = state.prospects.filter(p=> !((p.notas||'').includes('Importado:')) );
  const ex=new Set(state.prospects.map(p=>normName(p.empresa))); let added=0;
  base.forEach(c=>{ const k=normName(c.empresa); if(!k||ex.has(k))return; ex.add(k);
    state.prospects.push(Object.assign({},c,{id:uid(),actividades:[],stageHistory:[]})); added++; });
  state.baseSig=baseSig(); save(); render(); if(!silent)toast('Base cargada: '+added+' clientes para prospectar ✓');
}
function renderAjustes(){
  const baseN = (window.BASE_CLIENTES&&window.BASE_CLIENTES.length)||0;
  const basePanel = baseN? `<div class="panel" style="border-color:var(--accent2)"><h3>📥 Tu base de datos de clientes <span class="muted">${baseN} contactos listos</span></h3>
    <p class="muted" style="margin-top:-4px">Tus 17 archivos consolidados en una sola base, todos como <b>"Cliente nuevo"</b> para prospectar desde el inicio del pipeline. El estatus histórico queda en las notas (los que ya operaban van primero). Vuelve a pulsar cuando quieras para actualizar.</p>
    <button class="primary-btn" id="set-cargar-base">📥 Cargar / actualizar mi base (${baseN} clientes)</button></div>`:'';
  $('#view-ajustes').innerHTML=basePanel+`
    <div class="panel"><h3>Marca y reportes</h3>
      <label style="max-width:380px">Nombre visible en el dashboard y las notas<input id="set-brand" value="${esc(brand())}" /></label>
      <label style="max-width:380px;margin-top:10px">📤 Reportar mi día a (WhatsApp, con lada) <input id="set-reportar" value="${esc(state.reportarA||'')}" placeholder="52 55 1234 5678" /></label>
      <p class="muted" style="font-size:11.5px;margin:4px 0 0">Cuando pulses "Mandar mi reporte del día", se enviará a este número con 1 clic.</p>
      <button class="primary-btn" id="set-brand-save" style="margin-top:10px">Guardar</button></div>
    <div class="panel"><h3>Industrias / Segmentos <button class="primary-btn" id="btn-new-industry" style="float:right">+ Nueva industria</button></h3><p class="muted" style="margin-top:-4px">Cada industria define qué variables y enfoque aparecen en sus notas.</p>
      <div class="list">${state.industries.map(i=>`<div class="list-item"><div><strong>${esc(i.name)}</strong><div class="meta">${(i.vars||[]).map(v=>MLAB[v]?MLAB[v].label:v).join(' · ')||'—'}</div></div><div class="row-actions"><button class="icon-btn" data-ind-edit="${esc(i.name)}">✎</button><button class="icon-btn" data-ind-del="${esc(i.name)}">🗑</button></div></div>`).join('')}</div></div>
    <div class="panel"><h3>Datos y sesión</h3><div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="ghost-btn" id="set-export">⤓ Respaldar (JSON)</button><button class="ghost-btn" id="set-import">⤒ Restaurar</button>
      <button class="ghost-btn" id="set-csv">⇩ Exportar clientes CSV</button><button class="ghost-btn danger" id="set-reset">⟲ Vaciar y empezar de cero</button>
      <button class="ghost-btn" id="set-logout">⎋ Cerrar sesión</button>
    </div><p class="muted" style="margin-top:10px">Sesión: <strong>${esc(ME.email)}</strong> · Modo <strong>${DB.mode()}</strong>. ${DB.cloud?'Tus datos se sincronizan en la nube.':'Modo demo: respalda seguido.'}</p></div>`;
  $('#set-brand-save').onclick=()=>{state.brand=$('#set-brand').value.trim()||'Insitum Capital';state.reportarA=$('#set-reportar').value.trim();save();render();toast('Guardado ✓');};
  $('#btn-new-industry').onclick=()=>openIndustry(null);
  $$('[data-ind-edit]').forEach(b=>b.onclick=()=>openIndustry(b.dataset.indEdit));
  $$('[data-ind-del]').forEach(b=>b.onclick=()=>{if(confirm('¿Eliminar "'+b.dataset.indDel+'"?')){state.industries=state.industries.filter(i=>i.name!==b.dataset.indDel);save();render();}});
  $('#set-export').onclick=exportJSON; $('#set-import').onclick=()=>$('#file-import').click(); $('#set-csv').onclick=exportCSV;
  $('#set-logout').onclick=doLogout;
  { const cb=$('#set-cargar-base'); if(cb) cb.onclick=cargarBase; }
  $('#set-reset').onclick=()=>{
    const n=state.prospects.length;
    if(confirm(`Esto BORRA tus ${n} cliente(s) y todas sus actividades, y deja el CRM en cero.\n\nNo se puede deshacer. Respalda antes con "Respaldar (JSON)".\n\n¿Continuar?`)){
      state=seedData(); state._baseOffered=false; save(); render(); toast('CRM vacío. Todo en cero ✓');
    }
  };
}
function openIndustry(name){
  const f=$('#form-industry');f.reset();const ind=name?state.industries.find(i=>i.name===name):null;
  $('#modal-industry-title').textContent=ind?'Editar industria':'Nueva industria';
  f.elements.orig.value=ind?ind.name:'';f.elements.name.value=ind?ind.name:'';f.elements.tip.value=ind?ind.tip||'':'';
  $('#chips-vars').innerHTML=MARKET.map(m=>`<span class="chip ${ind&&(ind.vars||[]).includes(m.k)?'on':''}" data-var="${m.k}">${m.label}</span>`).join('');
  $$('#chips-vars .chip').forEach(c=>c.onclick=()=>c.classList.toggle('on'));
  $('#modal-industry').classList.remove('hidden');
}
function submitIndustry(e){e.preventDefault();const d=Object.fromEntries(new FormData(e.target).entries());const vars=$$('#chips-vars .chip.on').map(c=>c.dataset.var);if(d.orig){const ind=state.industries.find(i=>i.name===d.orig);if(ind){ind.name=d.name;ind.vars=vars;ind.tip=d.tip;}}else state.industries.push({name:d.name,vars:vars.length?vars:['usdmxn'],tip:d.tip});save();closeModals();render();toast('Industria guardada ✓');}

/* ---------- MODAL PROSPECTO / ACTIVIDAD ---------- */
function fillSelect(sel,items,val){sel.innerHTML=items.map(i=>`<option ${i===val?'selected':''}>${esc(i)}</option>`).join('');}
function openProspect(id){
  const f=$('#form-prospect');f.reset();fillSelect($('#sel-segmento'),segNames());fillSelect($('#sel-etapa'),STAGES);
  const p=id?state.prospects.find(x=>x.id===id):null;
  $('#modal-prospect-title').textContent=p?'Editar cliente':'Nuevo cliente';
  $('#chips-productos').innerHTML=state.products.map(pr=>`<span class="chip ${p&&(p.productos||[]).includes(pr.id)?'on':''}" data-prod="${pr.id}">${esc(shortName(pr.nombre))}</span>`).join('');
  $$('#chips-productos .chip').forEach(c=>c.onclick=()=>c.classList.toggle('on'));
  if(p){for(const k in p)if(f.elements[k]&&typeof p[k]!=='object')f.elements[k].value=p[k]??'';}else f.elements.fechaProxima.value=todayISO();
  updateRevenuePreview();$('#modal-prospect').classList.remove('hidden');
}
function updateRevenuePreview(){const f=$('#form-prospect');const n=Number(f.elements.notional.value)||0,b=Number(f.elements.feeBps.value)||0;$('#revenue-preview').textContent=n&&b?`Ingreso estimado: ${fmtUSD(Math.round(n*b/10000))} (${b} bps sobre ${fmtUSD(n)})`:'Ingreso estimado: —';}
function submitProspect(e){
  e.preventDefault();const f=e.target;const d=Object.fromEntries(new FormData(f).entries());const prods=$$('#chips-productos .chip.on').map(c=>c.dataset.prod);
  let p=d.id?state.prospects.find(x=>x.id===d.id):null;if(!p){p={id:uid(),creado:todayISO(),actividades:[],stageHistory:[]};state.prospects.push(p);}
  Object.assign(p,{empresa:d.empresa,contacto:d.contacto,puesto:d.puesto,telefono:d.telefono,email:d.email,fuente:d.fuente,segmento:d.segmento,etapa:d.etapa,productos:prods,notional:Number(d.notional)||0,feeBps:Number(d.feeBps)||0,probabilidad:Number(d.probabilidad)||0,proximaAccion:d.proximaAccion,fechaProxima:d.fechaProxima,notas:d.notas,actualizado:todayISO()});
  if(WON_STAGES.includes(d.etapa)&&!p.ganadoFecha)p.ganadoFecha=todayISO();
  save();closeModals();render();toast('Cliente guardado ✓');
}
function openActivity(id){const f=$('#form-activity');f.reset();f.elements.prospectId.value=id;f.elements.fecha.value=todayISO();$('#modal-activity').classList.remove('hidden');}
function submitActivity(e){e.preventDefault();const d=Object.fromEntries(new FormData(e.target).entries());const p=state.prospects.find(x=>x.id===d.prospectId);if(!p)return;p.actividades=p.actividades||[];p.actividades.push({id:uid(),fecha:d.fecha,tipo:d.tipo,nota:d.nota});if(d.proximaAccion)p.proximaAccion=d.proximaAccion;if(d.fechaProxima)p.fechaProxima=d.fechaProxima;p.actualizado=todayISO();save();closeModals();if(!$('#drawer-client').classList.contains('hidden'))openClient(p.id);render();toast('Actividad registrada ✓');}
function closeModals(){$$('.modal-overlay').forEach(m=>m.classList.add('hidden'));}

/* ---------- FILTROS / GLOBAL / DATOS ---------- */
function filtered(){let arr=state.prospects;const q=ui.search.toLowerCase().trim();if(q)arr=arr.filter(p=>(p.empresa+' '+(p.contacto||'')+' '+(p.email||'')).toLowerCase().includes(q));if(ui.filtroSeg)arr=arr.filter(p=>p.segmento===ui.filtroSeg);if(ui.filtroProd)arr=arr.filter(p=>(p.productos||[]).includes(ui.filtroProd));if(ui.filtroEtapa)arr=arr.filter(p=>p.etapa===ui.filtroEtapa);
  if(ui.filtroDatos==='con')arr=arr.filter(p=>compScore(p)>0);else if(ui.filtroDatos==='sin')arr=arr.filter(p=>compScore(p)===0);else if(ui.filtroDatos==='email')arr=arr.filter(p=>p.email);else if(ui.filtroDatos==='tel')arr=arr.filter(p=>p.telefono);else if(ui.filtroDatos==='potencial')arr=arr.filter(p=>p.potencial==='alto');else if(ui.filtroDatos==='operaba')arr=arr.filter(p=>operabaScore(p)>0).sort((a,b)=>operabaScore(b)-operabaScore(a));
  return arr;}
function empty(msg){return `<div class="empty">${msg}</div>`;}
function bindRowClicks(){$$('[data-client]').forEach(el=>el.onclick=e=>{if(e.target.closest('[data-sched]'))return;openClient(el.dataset.client);});}

function bindGlobal(){
  $$('.nav-btn').forEach(b=>b.onclick=()=>{ui.view=b.dataset.view;render();});
  $('#btn-new-prospect').onclick=()=>openProspect(null);
  $('#global-search').oninput=e=>{ui.search=e.target.value;if(['clientes','pipeline'].includes(ui.view))render();};
  $('#form-prospect').onsubmit=submitProspect; $('#form-prospect').addEventListener('input',updateRevenuePreview);
  $('#form-activity').onsubmit=submitActivity; $('#form-product').onsubmit=submitProduct; $('#form-industry').onsubmit=submitIndustry;
  $('#form-move').onsubmit=submitMove; { const mr=$('#move-reunion'); if(mr)mr.onchange=()=>$('#move-reunion-fields').classList.toggle('hidden',!mr.checked); }
  $('#form-schedule').addEventListener('input',updateScheduleLinks);
  $('#sch-ics').onclick=downloadICS;
  $('#btn-logout').onclick=doLogout;
  $$('[data-close-modal]').forEach(b=>b.onclick=closeModals);
  $$('.modal-overlay').forEach(m=>m.onclick=e=>{if(e.target===m)closeModals();});
  $('#drawer-overlay').onclick=closeDrawer;
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModals();closeDrawer();}});
  document.body.addEventListener('click',e=>{const ac=e.target.closest('[data-act]');const sc=e.target.closest('[data-sched]');if(ac){e.stopPropagation();openActivity(ac.dataset.act);}if(sc){e.stopPropagation();openSchedule(sc.dataset.sched);}});
  $('#btn-export').onclick=exportJSON; $('#btn-import').onclick=()=>$('#file-import').click(); $('#file-import').onchange=importJSON;
  window.addEventListener('beforeunload',flushSave);
}
function exportJSON(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`insitum-crm-${ME.email}-${todayISO()}.json`;a.click();toast('Respaldo descargado ✓');}
function importJSON(e){const file=e.target.files[0];if(!file)return;const r=new FileReader();r.onload=()=>{try{const s=JSON.parse(r.result);if(!s.prospects)throw 0;state=migrate(s);save();render();toast('Datos restaurados ✓');}catch(err){toast('Archivo inválido');}};r.readAsText(file);e.target.value='';}
function exportCSV(){const cols=['empresa','contacto','puesto','telefono','email','segmento','etapa','productos','notional','feeBps','ingresoEst','probabilidad','proximaAccion','fechaProxima'];const rows=state.prospects.map(p=>cols.map(c=>{let v=c==='ingresoEst'?revenueOf(p):c==='productos'?(p.productos||[]).map(prodName).join('; '):p[c];v=(v==null?'':String(v)).replace(/"/g,'""');return `"${v}"`;}).join(','));const csv='﻿'+cols.join(',')+'\n'+rows.join('\n');const blob=new Blob([csv],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`clientes-${todayISO()}.csv`;a.click();toast('CSV exportado ✓');}

/* ---------- DATOS POR DEFECTO ---------- */
function defaultIndustries(){return [
  {name:'Importador/Exportador',vars:['usdmxn','eurusd','banxico'],tip:'Revisar niveles de cobertura de pagos/cobros en USD.'},
  {name:'Manufactura/Automotriz',vars:['usdmxn','cobre','aluminio','brent'],tip:'Insumos importados y metálicos; vigilar costo y tipo de cambio.'},
  {name:'Aerolínea/Transporte',vars:['brent','wti','usdmxn'],tip:'Exposición a turbosina/diésel; evaluar cobertura de energéticos.'},
  {name:'Agroindustria',vars:['maiz','trigo','soya','cafe','azucar','usdmxn'],tip:'Granos y blandos; fijar precios de insumos/cosecha.'},
  {name:'Energía/Combustibles',vars:['brent','wti','gasnat','usdmxn'],tip:'Vigilar crudo y gas para márgenes y coberturas.'},
  {name:'Minería/Metales',vars:['oro','cobre','aluminio','usdmxn'],tip:'Metales preciosos e industriales; cobertura de producción.'},
  {name:'Retail/Comercio',vars:['usdmxn','eurusd','banxico'],tip:'Importaciones y costo de capital de trabajo.'},
  {name:'Fintech/Remesas',vars:['usdmxn','eurusd'],tip:'Volumen FX recurrente; optimizar spread.'},
  {name:'Family Office/Patrimonio',vars:['banxico','cetes','ust10','sp500','oro'],tip:'Renta fija, money market y refugio.'},
  {name:'Construcción/Inmobiliaria',vars:['usdmxn','cobre','banxico'],tip:'Insumos, tasas y financiamiento.'},
];}
function defaultProducts(){return [
  {id:uid(),nombre:'Coberturas cambiarias (Forwards FX)',categoria:'Divisas (FX)',prov:'Marex · StoneX',desc:'Fija el tipo de cambio futuro de tus pagos/cobros.',ideal:'Importadores/exportadores con exposición > USD 1M/año.'},
  {id:uid(),nombre:'Opciones de tipo de cambio (Calls/Puts/Collars)',categoria:'Divisas (FX)',prov:'Marex · StoneX',desc:'Piso/techo a tu tipo de cambio, o collar a costo cero.',ideal:'Tesorerías que quieren protección con flexibilidad.'},
  {id:uid(),nombre:'Swaps de divisas (Cross-currency)',categoria:'Divisas (FX)',prov:'Marex',desc:'Calza activos y pasivos por divisa.',ideal:'Empresas con deuda o ingresos en moneda extranjera.'},
  {id:uid(),nombre:'FX Spot / Compra-venta de divisas',categoria:'Pagos & Transferencias',prov:'StoneX',desc:'Mejor tipo de cambio que la banca tradicional.',ideal:'Cualquier empresa que mueva divisas.'},
  {id:uid(),nombre:'Transferencias y pagos internacionales',categoria:'Pagos & Transferencias',prov:'StoneX Global Payments',desc:'Envíos a 140+ países a niveles competitivos.',ideal:'Pagos a proveedores, nómina y remesas.'},
  {id:uid(),nombre:'Coberturas de commodities — Energía',categoria:'Commodities',prov:'StoneX · Marex',desc:'Petróleo, gas, jet fuel y diésel.',ideal:'Aerolíneas, transporte, energía.'},
  {id:uid(),nombre:'Coberturas de commodities — Metales',categoria:'Commodities',prov:'Marex',desc:'Oro, cobre, aluminio.',ideal:'Manufactura, minería, construcción.'},
  {id:uid(),nombre:'Coberturas de commodities — Agrícolas',categoria:'Commodities',prov:'ADM · StoneX',desc:'Maíz, trigo, soya, café, azúcar.',ideal:'Agroindustria, alimentos.'},
  {id:uid(),nombre:'Futuros y opciones listados (CME/ICE)',categoria:'Commodities',prov:'ADM · Marex',desc:'Mercados listados con clearing institucional.',ideal:'Clientes que operan futuros.'},
  {id:uid(),nombre:'Inversiones / Mesa de dinero',categoria:'Inversiones / Renta fija',prov:'Bursamétrica',desc:'Cetes, bonos, reportos.',ideal:'Tesorerías con excedentes y family offices.'},
  {id:uid(),nombre:'Money market / Excedentes',categoria:'Inversiones / Renta fija',prov:'Bursamétrica',desc:'Rendimiento sobre caja con liquidez.',ideal:'Empresas con caja ociosa.'},
  {id:uid(),nombre:'Coberturas de tasa de interés (IRS)',categoria:'Derivados de tasa',prov:'Marex',desc:'Fija el costo de tu deuda a tasa variable.',ideal:'Empresas apalancadas a tasa flotante.'},
  {id:uid(),nombre:'Estructurados / Derivados a la medida',categoria:'Estructurados',prov:'Marex',desc:'Forwards participativos, knock-in/out.',ideal:'Tesorerías sofisticadas.'},
];}
// Estado inicial de una cuenta NUEVA: en cero absoluto.
// Sin clientes de ejemplo: las metricas (pipeline, cerrado, vencidas) deben reflejar
// la realidad desde el primer dia, nunca datos inventados.
function seedData(){
  return {brand:'Insitum Capital',products:defaultProducts(),industries:defaultIndustries(),market:{},notes:[],
    prospects:[],
    meta:{version:3,updated:new Date().toISOString()}};
}

/* ---------- Arranque ---------- */
function init(){
  bindGlobal();
  $('#form-login').onsubmit=async e=>{
    e.preventDefault(); const f=e.target; const d=Object.fromEntries(new FormData(f).entries());
    const email = DB.cloud ? d.email : d.demoUser;
    const errEl=$('#login-error'); errEl.classList.add('hidden');
    try{
      if(signupMode){
        const r=await DB.signUp(email,d.password);
        localStorage.setItem('cfx_last_email',email||'');
        if(!r.confirmar){ await afterLogin(r.user); return; }   // sin confirmación: entra directo
        // Con confirmación: el correo llega; la página del enlace puede verse rota, pero confirma igual.
        signupMode=false; applyAuthMode();
        $('#login-mode').innerHTML=`Te mandamos un correo a <b>${esc(email)}</b>. Ábrelo y da clic en el enlace. `
          +`<b>Aunque esa página se vea con error, tu cuenta ya quedó confirmada</b> — regresa aquí y entra con tu correo y contraseña.`;
        toast('Cuenta creada ✓ Revisa tu correo');
        return;
      }
      const user=await DB.signIn(email,d.password);
      localStorage.setItem('cfx_last_email',email||'');
      await afterLogin(user);
    }
    catch(err){
      const m=(err&&err.message)||'';
      // Fallo de red: distinguir "sin internet" de "Supabase dormido" antes de acusar al wifi.
      if(/failed to fetch|networkerror|load failed|network request/i.test(m) && DB.cloud){
        errEl.textContent='Revisando…'; errEl.classList.remove('hidden');
        if(await diagnosticarRed()==='servidorDormido'){
          errEl.innerHTML=HTML_SERVIDOR_DORMIDO(); errEl.classList.remove('hidden');
          $('#btn-resend').classList.add('hidden');
          return;
        }
      }
      errEl.textContent=errMsg(err); errEl.classList.remove('hidden');
      // Si el correo no está confirmado, ofrecer reenviar la liga.
      const noConf=/not confirmed|no está confirmado/i.test(m);
      const rs=$('#btn-resend'); if(rs)rs.classList.toggle('hidden',!(noConf&&DB.cloud));
    }
  };
  // Reenviar el correo de confirmación (por si se perdió o cayó en spam).
  const rs=$('#btn-resend'); if(rs)rs.onclick=async()=>{
    const email=($('#form-login').email.value||'').trim();
    if(!email){ toast('Primero escribe tu correo arriba'); $('#form-login').email.focus(); return; }
    try{
      await DB.resendConfirm(email);
      toast('Correo de confirmación reenviado ✓ Revisa también la carpeta de spam');
      $('#login-mode').innerHTML=`Te reenviamos el correo a <b>${esc(email)}</b>. Dale clic al enlace. `
        +`<b>Aunque la página se vea con error, la cuenta ya queda confirmada</b> — luego regresa aquí y entra.`;
    }
    catch(e){ toast('No se pudo: '+errMsg(e)); }
  };
  // Alternar entre "Entrar" y "Crear cuenta".
  const su=$('#btn-signup-toggle'); if(su)su.onclick=()=>{
    signupMode=!signupMode; applyAuthMode();
    $('#login-error').classList.add('hidden');
    $('#form-login').email.focus();
  };
  // Ojito: ver/ocultar la contraseña mientras se escribe.
  const eye=$('#btn-eye'); if(eye)eye.onclick=()=>{ const i=$('#form-login').password; i.type=(i.type==='password')?'text':'password'; eye.textContent=(i.type==='password')?'👁':'🙈'; i.focus(); };
  // ¿Olvidó la contraseña? Se manda un correo con la liga para ponerla de nuevo.
  const fg=$('#btn-forgot'); if(fg)fg.onclick=async()=>{
    const email=($('#form-login').email.value||'').trim();
    if(!email){ toast('Primero escribe tu correo arriba'); $('#form-login').email.focus(); return; }
    try{ await DB.resetPassword(email); toast('Listo: te mandamos un correo para restablecerla ✓'); }
    catch(e){ toast('No se pudo: '+errMsg(e)); }
  };
  DB.currentUser().then(user=>{ if(user) afterLogin(user); else showLogin(); }).catch(()=>showLogin());
}
init();
