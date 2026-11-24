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
  {k:'brent',label:'Brent',unit:'USD/bbl'},{k:'wti',label:'WTI',unit:'USD/bbl'},{k:'gasnat',label:'Gas natural',unit:'USD/MMBtu'},
  {k:'oro',label:'Oro',unit:'USD/oz'},{k:'cobre',label:'Cobre',unit:'USD/lb'},{k:'aluminio',label:'Aluminio',unit:'USD/t'},
  {k:'maiz',label:'Maíz',unit:'USD/bu'},{k:'trigo',label:'Trigo',unit:'USD/bu'},{k:'soya',label:'Soya',unit:'USD/bu'},
  {k:'cafe',label:'Café',unit:'USD/lb'},{k:'azucar',label:'Azúcar',unit:'USD/lb'},
  {k:'sp500',label:'S&P 500',unit:''},{k:'banxico',label:'Tasa Banxico',unit:'%'},{k:'cetes',label:'Cetes 28d',unit:'%'},{k:'ust10',label:'UST 10a',unit:'%'},
];
const MLAB = Object.fromEntries(MARKET.map(m=>[m.k,m]));
/* CENTAVOS -> DOLARES. CME e ICE cotizan granos y blandos en centavos: Yahoo
   devuelve 430 para el maiz, que son 4.30 USD/bu. Sin esto la nota sale con un
   error de 100x y quien sabe de agro lo caza en el primer renglon.
   OJO: este catalogo esta duplicado en netlify/lib/nota.js porque el repo no
   tiene paso de compilacion. Si cambia aqui, cambia alla. */
const ESCALA = { maiz:0.01, trigo:0.01, soya:0.01, cafe:0.01, azucar:0.01 };
/* Banda de sanidad: no adivina el mercado, caza errores de unidad y respuestas
   corruptas. Si un valor cae fuera, se omite en vez de publicarlo. */
const BANDA = {
  usdmxn:[10,40], eurusd:[0.5,2], eurmxn:[10,60], dxy:[70,130],
  brent:[20,250], wti:[10,250], gasnat:[0.5,30],
  oro:[500,10000], plata:[5,200], cobre:[1,15], aluminio:[800,6000],
  maiz:[2,20], trigo:[2,25], soya:[5,40], cafe:[0.5,10], azucar:[0.05,1.5],
  sp500:[1000,20000], dow:[5000,100000], nasdaq:[1000,50000],
  ipcmx:[20000,200000], nikkei:[5000,100000], dax:[5000,50000], vix:[5,100],
  banxico:[0,30], cetes:[0,30], ust10:[0,15],
};
function plausibleMkt(k,v){ const b=BANDA[k]; if(!b||!isFinite(v)) return isFinite(v); return v>=b[0]&&v<=b[1]; }
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

/* ---------- LÍNEAS DE COBERTURA Y RANGO DE ACCIÓN --------------------------
   La mesa no vende dólares baratos: vende cobertura. El spread es la puerta de
   entrada (es lo unico que el cliente ya sabe medir y comparar), pero el
   negocio esta en el programa: nocional recurrente, comision sobre nocional y
   una relacion que se renueva en cada vencimiento en vez de morir en la
   operacion. Un ahorro de spread se agradece una vez; una politica de
   cobertura se revisa cada trimestre.

   Tres lineas, que son justo las que la mesa puede operar con sus proveedores:
     · Tipo de cambio  — forwards, collares, swaps        (Marex · StoneX)
     · Tasas           — IRS y caps sobre deuda variable  (Marex)
     · Commodities     — energia, metales y agro          (StoneX · ADM · Marex)

   El RANGO DE ACCION es lo que se puede poner sobre la mesa en la PRIMERA
   llamada, segun el tamaño de la exposicion. Sirve para dos cosas:
     1. Que quien llama sepa a que le tira ANTES de marcar. No es lo mismo
        abrir pidiendo "quince minutos para dimensionar" que llegar con una
        politica de cobertura para el comite: el mismo guion en el prospecto
        equivocado quema la llamada.
     2. Que ese alcance quede escrito en la ficha al entregar la lista y se vea
        en el pipeline. La tarjeta deja de decir solo un nombre y dice linea,
        rango y nocional, asi que el tablero pasa de "quien" a "cuanto y de que".
---------------------------------------------------------------------------- */
const LINEAS = {
  fx:     {icon:'💵',  label:'Tipo de cambio', corto:'FX',          bps:25, prov:'Marex · StoneX'},
  tasas:  {icon:'📈',  label:'Tasas',          corto:'Tasas',       bps:10, prov:'Marex'},
  commod: {icon:'🛢️', label:'Commodities',    corto:'Commodities', bps:25, prov:'StoneX · ADM · Marex'},
};

/* Industria -> lineas aplicables, la primera es la que abre la conversacion.
   Sale del mismo criterio que ya usaban las jugadas del generador de propuestas:
   no es una taxonomia nueva, es la misma vista desde la llamada. */
const LINEA_POR_SEG = {
  'Importador/Exportador':     ['fx','tasas'],
  'Manufactura/Automotriz':    ['fx','commod','tasas'],
  'Aerolínea/Transporte':      ['commod','fx'],
  'Agroindustria':             ['commod','fx'],
  'Energía/Combustibles':      ['commod','fx','tasas'],
  'Minería/Metales':           ['commod','fx'],
  'Retail/Comercio':           ['fx','tasas'],
  'Fintech/Remesas':           ['fx'],
  'Servicios/Tecnología':      ['fx'],
  'Salud/Farma':               ['fx'],
  'Family Office/Patrimonio':  ['tasas'],
  'Construcción/Inmobiliaria': ['tasas','commod','fx'],
};

/* Lo que diga la ficha gana sobre la industria: si en las notas del .xls viejo
   dice "turbosina" o "deuda variable", eso es informacion de primera mano y la
   industria es apenas un promedio. */
const PISTAS_LINEA = [
  {l:'commod', re:/combustible|turbosina|jet ?fuel|di[eé]sel|crudo|brent|gas nat|cobre|alumini|acero|metal|ma[ií]z|trigo|soya|caf[eé]|az[uú]car|grano|commodit/i},
  {l:'tasas',  re:/tasa variable|tasa fija|deuda|cr[eé]dito|apalanc|\birs\b|\btiie\b|banxico|financiamiento|arrendamiento/i},
  {l:'fx',     re:/d[oó]lar|divisa|tipo de cambio|forward|\busd\b|\bfx\b|importa|exporta|cobertura=si/i},
];

function lineasDe(p){
  if(!p) return ['fx'];
  const txt=[p.notas,p.proximaAccion,(p.productos||[]).map(prodName).join(' ')].filter(Boolean).join(' ');
  const porTexto=PISTAS_LINEA.filter(x=>x.re.test(txt)).map(x=>x.l);
  // Las industrias son editables desde Ajustes: si la ficha de la industria ya
  // trae su linea, esa manda sobre el mapa fijo de abajo.
  const ind=((state&&state.industries)||[]).find(i=>i.name===p.segmento);
  const porSeg=(ind&&LINEAS[ind.linea]?[ind.linea]:[]).concat(LINEA_POR_SEG[p.segmento]||[]);
  const out=[...new Set([...porTexto,...porSeg])];
  return out.length?out:['fx'];
}
function lineaDe(p){ return lineasDe(p)[0]; }

/* Los cortes son de exposicion ANUAL en USD (o el equivalente del insumo).
   No son arbitrarios: debajo de 250 mil al año una cobertura formal cuesta mas
   en tiempo del que deja, y arriba de 5 millones la decision ya no la toma una
   persona sino un comite — y eso cambia a quien hay que pedirle la cita. */
const RANGOS = [
  {k:'A', min:5e6,   label:'Programa',       color:'#16a34a', etapa:'Reunión',    cubrir:70,
   alcance:'Política de cobertura por escrito y programa a 12 meses',
   objetivo:'Diagnóstico de exposición con dirección o comité (60 min)'},
  {k:'B', min:1e6,   label:'Estructurada',   color:'#0d9488', etapa:'Reunión',    cubrir:60,
   alcance:'Cobertura estructurada sobre el descalce neto',
   objetivo:'Reunión de 30 min con sus propios números'},
  {k:'C', min:250e3, label:'Primer forward', color:'#d97706', etapa:'Propuesta',  cubrir:50,
   alcance:'Un primer forward o collar sobre la operación más próxima',
   objetivo:'Cotizar en firme la siguiente operación'},
  {k:'D', min:0,     label:'Diagnóstico',    color:'#64748b', etapa:'Contactado', cubrir:0,
   alcance:'Medir la exposición: todavía no hay cifra que cubrir',
   objetivo:'15 min para dimensionar cuánto mueven al año'},
];

const INSTRUMENTO = {
  fx: {A:'Programa de forwards escalonados + collar sobre el neto',
       B:'Forward escalonado a 6 meses',
       C:'Forward simple sobre la próxima operación',
       D:'Medir la exposición antes de proponer instrumento'},
  tasas: {A:'IRS sobre el grueso de la deuda + cap sobre el remanente',
       B:'IRS al plazo de la deuda',
       C:'Cap de tasa (techo con prima acotada)',
       D:'Levantar saldo y perfil de vencimientos'},
  commod: {A:'Programa por trimestre + collar a costo cero',
       B:'Swap o forward del insumo a 6 meses',
       C:'Collar o call spread sobre el próximo embarque',
       D:'Cuantificar el consumo anual del insumo'},
};

function rangoPorNocional(n){ return RANGOS.find(x=>(Number(n)||0)>=x.min)||RANGOS[RANGOS.length-1]; }

/* La accion SUGERIDA por los datos de la ficha. */
function accionDe(p){
  const linea=lineaDe(p), L=LINEAS[linea];
  const nocional=Number(p&&p.notional)||0;
  const r=rangoPorNocional(nocional);
  return {linea, L, rango:r.k, r, instrumento:INSTRUMENTO[linea][r.k], nocional,
          fee:nocional?Math.round(nocional*L.bps/10000):0, etapaMeta:r.etapa, asignado:false};
}
/* La accion COMPROMETIDA: la que quedo escrita en la ficha al entregar la lista.
   Es la que manda en el pipeline — lo sugerido es una hipotesis, lo entregado
   es lo que alguien de verdad va a ir a proponer. */
function accionVigente(p){
  const a=p&&p.accion;
  if(!a||!LINEAS[a.linea]) return accionDe(p);
  const L=LINEAS[a.linea], r=RANGOS.find(x=>x.k===a.rango)||RANGOS[RANGOS.length-1];
  const nocional=Number(a.nocional)||0;
  return {linea:a.linea, L, rango:r.k, r, instrumento:a.instrumento||INSTRUMENTO[a.linea][r.k],
          nocional, fee:nocional?Math.round(nocional*L.bps/10000):0, etapaMeta:r.etapa, asignado:true};
}
function chipAccion(p,{corto=false}={}){
  const a=accionVigente(p);
  const t=corto?`${a.L.icon} ${a.L.corto} ${a.rango}`:`${a.L.icon} ${a.L.corto} · Rango ${a.rango}`;
  return `<span class="acc-chip${a.asignado?' asignado':''}" style="--acc:${a.r.color}"
    title="${esc(a.instrumento)} — ${esc(a.r.alcance)}${a.asignado?' · asignado al entregar la lista':' · sugerido'}">${t}</span>`;
}

/* ---------- Estado / sesión ---------- */
let state, ME=null, saveTimer=null;
let ui = { view:'midia', search:'', filtroSeg:'', filtroProd:'', filtroEtapa:'', filtroDatos:'', noteFmt:'whatsapp', noteModo:'apertura', noteAlcance:'industria', noteIndustria:'', cotTipo:'ahorro', cotCliente:'', cotText:'', perfCliente:'', perfText:'', perfData:null, tjVista:'lista', propJugada:'fx_importador', propCliente:'', propText:'', propData:null,
  mancN:10, mancLinea:'', mancTarjetas:false, mancText:'', mancUndo:null, leads:[], leadsErr:null, filtroLinea:'', filtroRango:'' };

function migrate(s){
  if(!s.brand) s.brand='Insitum Capital';
  // TARJETAS: viven en la MISMA lista que los clientes pero marcadas con
  // esTarjeta=true. Asi heredan ficha, actividades, etapas y pipeline; y se
  // muestran en su propia seccion, sin mezclarse con la cartera.
  s.prospects=s.prospects||[];
  // Rescate de la bandeja separada anterior -> se integran marcadas.
  if(s.tarjetas&&s.tarjetas.length){
    s.tarjetas.forEach(c=>s.prospects.unshift(Object.assign({
      id:uid(),empresa:'',contacto:'',puesto:'',telefono:'',email:'',fuente:'Tarjeta',
      segmento:'',etapa:'Cliente nuevo',productos:[],notional:0,feeBps:25,probabilidad:10,
      proximaAccion:'Primer contacto',fechaProxima:'',notas:'',creado:todayISO(),
      actividades:[],stageHistory:[]
    },c,{esTarjeta:true})));
  }
  s.tarjetas=[];
  // Lo escaneado antes de existir la seccion quedo con fuente 'Tarjeta'.
  (s.prospects||[]).forEach(p=>{ if(p.fuente==='Tarjeta'&&p.esTarjeta===undefined)p.esTarjeta=true; });
  // Alta unica de Servicios/Tecnologia en catalogos ya existentes (muchas
  // tarjetas caian sin clasificar por no tener esta industria). El flag evita
  // que reaparezca si la usuaria decide borrarla.
  if(!s._indServicios){
    s._indServicios=true;
    s.industries=s.industries||[];
    if(!s.industries.some(i=>i&&i.name==='Servicios/Tecnología'))
      s.industries.push({name:'Servicios/Tecnología',vars:['usdmxn','eurusd','banxico'],tip:'Licencias, nube y equipo en USD; honorarios y contratos en divisa.'});
  }
  // Igual para Salud/Farma: sin ella, las tarjetas de equipo medico y farmaceutica
  // caian en "Manufactura/Automotriz" o se quedaban en blanco.
  if(!s._indSalud){
    s._indSalud=true;
    s.industries=s.industries||[];
    if(!s.industries.some(i=>i&&i.name==='Salud/Farma'))
      s.industries.push({name:'Salud/Farma',vars:['usdmxn','eurusd','banxico'],tip:'Insumos, equipo médico y principios activos importados en USD/EUR.'});
  }
  if(!s.products||!s.products.length) s.products=defaultProducts();
  if(!s.industries||!s.industries.length) s.industries=defaultIndustries();
  // Las industrias guardadas antes del cambio de estrategia no traen `linea`.
  // Sin esto todo seguiria funcionando (LINEA_POR_SEG cubre las 12 por nombre),
  // pero una industria que la usuaria haya renombrado o creado a mano se
  // quedaria sin linea para siempre. Se rellena una sola vez con el catalogo
  // por omision, respetando lo que ya este puesto.
  if(!s._indLinea){
    s._indLinea=true;
    const def=Object.fromEntries(defaultIndustries().map(i=>[i.name,i.linea]));
    (s.industries||[]).forEach(i=>{ if(i&&!i.linea&&def[i.name]) i.linea=def[i.name]; });
  }
  if(!s.market) s.market={};
  if(!s.notes) s.notes=[];
  (s.prospects||[]).forEach(p=>{ if(!p.id)p.id=uid(); if(p.etapa==='Prospecto')p.etapa='Cliente nuevo'; if(p.etapa==='Cliente activo')p.etapa='Cliente recurrente'; p.actividades=p.actividades||[]; p.stageHistory=p.stageHistory||[]; });
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
  // TUMBAS: ids borrados a proposito. Sin esto la fusion RESUCITA lo borrado,
  // porque unir por id solo sabe agregar: lo que esta en la copia vieja y no en
  // la nueva se vuelve a meter. Paso de verdad — se depuraron 31 tarjetas
  // repetidas y una re-sincronizacion a media clasificacion las regreso todas.
  const tumbas=Object.assign({},(older.borrados||{}),(newer.borrados||{}));
  const byId=new Map(out.prospects.map(p=>[p.id,p]));
  (older.prospects||[]).forEach(p=>{
    if(tumbas[p.id]) return;                       // borrado a proposito: no revive
    const q=byId.get(p.id);
    if(!q){ out.prospects.push(p); return; }
    q.actividades=q.actividades||[]; q.stageHistory=q.stageHistory||[];
    const aid=new Set(q.actividades.map(x=>x.id));
    (p.actividades||[]).forEach(x=>{ if(!aid.has(x.id))q.actividades.push(x); });
    const sh=new Set(q.stageHistory.map(x=>JSON.stringify(x)));
    (p.stageHistory||[]).forEach(x=>{ if(!sh.has(JSON.stringify(x)))q.stageHistory.push(x); });
  });
  // Y lo que el OTRO dispositivo borro tambien se va de este lado.
  out.prospects=out.prospects.filter(p=>!tumbas[p.id]);
  // Las tumbas se guardan 90 dias: tiempo de sobra para que todos los
  // dispositivos se enteren, sin que la lista crezca para siempre.
  const corte=Date.now()-90*24*3600*1000;
  out.borrados={};
  Object.keys(tumbas).forEach(id=>{
    const f=tumbas[id];
    if(new Date(f).getTime()>corte) out.borrados[id]=f;
  });
  out.notes=out.notes||[];
  const nid=new Set(out.notes.map(n=>n.id));
  ((older.notes)||[]).forEach(n=>{ if(!nid.has(n.id))out.notes.push(n); });
  return out;
}
// Unico camino para borrar registros: deja tumba para que la fusion los respete.
function borrarProspects(ids){
  const set=new Set(ids); if(!set.size) return 0;
  const antes=(state.prospects||[]).length;
  state.prospects=(state.prospects||[]).filter(p=>!set.has(p.id));
  state.borrados=state.borrados||{};
  const hoy=new Date().toISOString();
  set.forEach(id=>{ state.borrados[id]=hoy; });
  return antes-(state.prospects||[]).length;
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
/* CARTERA vs TARJETAS: una sola lista con marca esTarjeta. La cartera (clientes
   de verdad) alimenta pipeline, Mi Dia y metricas; las tarjetas viven aparte. */
function cartera(){ return (state.prospects||[]).filter(p=>!p.esTarjeta); }
function bandeja(){ return (state.prospects||[]).filter(p=>p.esTarjeta); }
// Lista sobre la que trabajan tabla/kanban/filtros segun la seccion abierta.
function scopeList(){ return ui.view==='tarjetas' ? bandeja() : cartera(); }
// Orden alfabetico en espanol: ignora acentos y mayusculas ("Ávila" junto a "Avila")
// y trata los numeros como numeros ("Grupo 2" antes que "Grupo 10").
const porNombre=(a,b)=>(a.empresa||'').localeCompare((b.empresa||''),'es',{sensitivity:'base',numeric:true});
/* Opciones del selector de cliente en Cotizador / Perfilador / Propuestas.
   Incluye la cartera Y las tarjetas escaneadas, en grupos separados: las tarjetas
   se trabajan desde su propia seccion, asi que hay que poder cotizarlas y
   perfilarlas sin tener que pasarlas antes a Clientes. El id es el mismo prospect,
   asi que todo lo de abajo (guardar cotizacion, actividad, propuesta) ya funciona. */
function opcionesCliente(sel){
  const opt=p=>`<option value="${p.id}" ${sel===p.id?'selected':''}>${esc(p.empresa)}</option>`;
  const c=cartera().slice().sort(porNombre), t=bandeja().slice().sort(porNombre);
  if(!t.length) return c.map(opt).join('');
  return (c.length?`<optgroup label="Clientes">${c.map(opt).join('')}</optgroup>`:'')
    +`<optgroup label="📇 Tarjetas">${t.map(opt).join('')}</optgroup>`;
}
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
  const activos=cartera().filter(isWon).length;
  const metaCli=Math.max(1,Math.ceil(c.metaMes/c.ingresoProm));
  const faltan=Math.max(0,metaCli-activos);
  const cierresMes=faltan/Math.max(1,c.horizonte);
  const reuMes=Math.ceil(cierresMes/FUNNEL.cierre/FUNNEL.propuesta);
  const toqMes=Math.ceil(cierresMes/FUNNEL.cierre/FUNNEL.propuesta/FUNNEL.reunion);
  const toqDia=faltan?Math.max(5,Math.ceil(toqMes/20)):5;
  const t=todayISO(), mes=t.slice(0,7);
  const acts=cartera().flatMap(p=>p.actividades||[]).filter(a=>a.tipo!=='Nota');
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
  // Con el registro cerrado, quien no tiene cuenta se queda mirando un formulario
  // sin ninguna salida: no hay boton de alta y nada le dice por que. Desde fuera
  // eso no se lee como "me falta cuenta", se lee como "esto no sirve / no lo
  // encuentro". Se le dice en una linea a quien pedirsela.
  const sa=$('#login-sinalta'); if(sa)sa.classList.toggle('hidden',demo||DB.allowSignup);
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
// Admin = lo dice el servidor (la politica RLS en Supabase), no un correo en el
// archivo publico. Asi no hay que publicar correos personales en config.js.
function isAdminUser(){ return !!(ME && (ME.isAdmin || DB.isAdmin(ME.email))); }
function pintarRolAdmin(admin){
  const ne=$('#nav-equipo'); if(ne){ ne.hidden=!admin; ne.style.display=admin?'flex':'none'; }
  $('#user-role').textContent = admin? 'Administrador · '+DB.mode() : 'Agente · '+DB.mode();
}
function startApp(){
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  const admin = isAdminUser();
  pintarRolAdmin(admin);
  const name = userName(ME.email);
  $('#user-name').textContent = name;
  // En nube, confirmar contra el servidor: si podemos leer carteras ajenas, somos admin.
  if(DB.cloud && !admin) DB.loadAll().then(rows=>{
    const mio=(ME.email||'').toLowerCase();
    if((rows||[]).some(r=>(r.email||'').toLowerCase()!==mio)){ ME.isAdmin=true; pintarRolAdmin(true); }
  }).catch(()=>{});
  $('#user-avatar').textContent = (name[0]||'?').toUpperCase();
  $('#privacy-note').textContent = DB.cloud? '☁️ Datos en la nube, sincronizados.' : '🔒 Tus datos viven en este dispositivo. Respalda seguido.';
  render();
  // Leads de la pagina publica: se traen en segundo plano para que el contador
  // del menu aparezca solo, sin que haya que entrar a la seccion a buscarlos.
  cargarLeads(true).then(()=>{ if(leadsPend()||ui.view==='leads') render(); });
  // Semaforo de lo que corre solo: si la nota diaria no salio, se ve AQUI, en la
  // primera pantalla, el mismo dia. Antes solo se sabia entrando a Netlify.
  cargarCorridas().then(()=>{ if(ui.view==='midia') render(); });
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
  const titles={midia:['Mi Día','Tu plan de acción de hoy'],mancuerna:['Mancuerna','La lista de llamadas de hoy, lista para mandar por WhatsApp'],leads:['Leads','Los que llegaron solos por la página pública'],resumen:['Resumen','Salud de tu cartera'],pipeline:['Pipeline','Arrastra clientes por la cadena'],clientes:['Clientes','CRM: ficha completa'],tarjetas:['Tarjetas','Escaneadas, aparte de tu cartera — revísalas y pásalas a Clientes'],propuestas:['Propuestas','Genera una propuesta de valor en segundos'],cotizador:['Cotizador','Calcula y envía cotizaciones'],perfilador:['Perfilador','Califica prospectos en 2 minutos: exposición, dolor y decisión'],seguimiento:['Seguimiento','Tu agenda de acciones'],notas:['Notas de mercado','Apertura y cierre por industria'],productos:['Productos','Catálogo editable'],equipo:['Equipo','Cartera consolidada de socios'],playbook:['Playbook','Metodología'],ajustes:['Ajustes','Marca, industrias y datos']};
  $('#view-title').textContent=titles[ui.view][0]; $('#view-sub').textContent=titles[ui.view][1];
  // Contador de la bandeja en el menu
  { const b=$('#nav-tarjetas-n'), n=bandeja().length; if(b){ b.textContent=n; b.classList.toggle('hidden',!n); } }
  // Leads sin atender: es lo unico del menu que pide accion el MISMO dia.
  { const b=$('#nav-leads-n'), n=leadsPend(); if(b){ b.textContent=n; b.classList.toggle('hidden',!n); } }
  ({midia:renderMiDia,mancuerna:renderMancuerna,leads:renderLeads,resumen:renderResumen,pipeline:renderPipeline,clientes:renderClientes,tarjetas:renderTarjetas,propuestas:renderPropuestas,cotizador:renderCotizador,perfilador:renderPerfilador,seguimiento:renderSeguimiento,notas:renderNotas,productos:renderProductos,equipo:renderEquipo,playbook:renderPlaybook,ajustes:renderAjustes}[ui.view])();
}

/* ---------------------------------------------------------------------------
   LO QUE CORRE SOLO — semaforo de la automatizacion dentro del CRM
   ---------------------------------------------------------------------------
   La nota diaria sale de un servidor, no de esta app. El riesgo real de eso no
   es que falle: es que falle CALLADA y nadie se entere en semanas. Cada corrida
   deja una fila en `corridas` (netlify/lib/bitacora.js) y aqui se lee para
   decir, en la primera pantalla del dia, si salio o no y que hacer.

   Los textos son gemelos de los de netlify/lib/bitacora.js (EXPLICA). Estan
   duplicados por lo mismo que lib/lineas.js: no hay paso de compilacion, asi
   que el navegador y las funciones no pueden compartir un modulo. Si se agrega
   un resultado nuevo, va en los DOS lados.
--------------------------------------------------------------------------- */
const CORRIDA_EXPLICA = {
  enviada:            'La nota salió.',
  nadie_pendiente:    'No había a quién mandarle: todos ya la recibieron hoy, o no hay correos válidos en la base.',
  sin_dominio_propio: 'Falta el dominio propio del correo. Es el único paso que la detiene.',
  mercado_sin_datos:  'No hubo datos de mercado. Sin números no se manda nada, a propósito.',
  sin_usdmxn:         'No llegó el USD/MXN, que es el dato central. Se omitió el envío.',
  destinatarios:      'No se pudo leer la base. Suele ser Supabase dormido.',
  resend_fallos:      'Resend rechazó el envío. Revisa resend.com → Logs.',
  excepcion:          'La función falló por algo no previsto.',
};
function explicaCorrida(r){
  if(CORRIDA_EXPLICA[r]) return CORRIDA_EXPLICA[r];
  if(/^falta /i.test(r||'')) return 'Faltan llaves en Netlify: '+r+'.';
  return 'Resultado: '+(r||'desconocido')+'.';
}
async function cargarCorridas(){
  if(!DB.cloud){ ui.corridas=null; return; }
  try{ ui.corridas = await DB.corridas(10); }catch(e){ ui.corridas=null; }
}
// Dias habiles transcurridos desde una fecha ISO (sabado y domingo no cuentan:
// la nota solo corre L-V, asi que un lunes la ultima corrida es del viernes y
// eso NO es un hueco).
function habilesDesde(iso){
  const d=new Date(iso+'T12:00'), hoy=new Date(todayISO()+'T12:00');
  let n=0; while(d<hoy){ d.setDate(d.getDate()+1); const w=d.getDay(); if(w!==0&&w!==6) n++; }
  return n;
}
function panelAutomatizacion(){
  if(!DB.cloud) return '';                       // en demo no hay nada que correr
  const cs=ui.corridas;
  const marco=(color,titulo,cuerpo)=>`<div class="panel auto-panel" style="border-left:3px solid ${color}">
    <h3>🤖 Lo que corre solo <span class="muted">nota diaria de mercado</span></h3>
    <div class="auto-linea"><b>${titulo}</b></div>${cuerpo}</div>`;

  if(cs===null||cs===undefined)
    return marco('var(--muted)','Todavía sin noticias de la nota diaria.',
      `<p class="muted" style="margin:6px 0 0">Si acabas de entrar, dale un momento. Si nunca aparece, falta correr el SQL actualizado en Supabase (tabla <code>corridas</code>).</p>`);

  const notas=cs.filter(c=>c.tipo==='nota-diaria');
  if(!notas.length)
    return marco('var(--amber)','La nota diaria aún no ha corrido ni una vez.',
      `<p class="muted" style="margin:6px 0 0">Se dispara sola de lunes a viernes a las 7:30am. Si ya publicaste el sitio y aun así no aparece nada el siguiente día hábil, ábrelo con la liga de <b>estado</b> (está en SETUP-AUTOMATIZACION.md) y te dice qué falta.</p>`);

  const u=notas[0];
  const hueco=habilesDesde(u.fecha);
  const fFecha=new Date(u.fecha+'T12:00').toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long'});
  const rachaMala=notas.slice(0,5).filter(c=>!c.ok).length;

  if(u.ok && u.enviados>0 && hueco<=1)
    return marco('var(--green)',`✅ Salió: ${num(u.enviados)} correo${u.enviados===1?'':'s'} el ${fFecha}.`,
      `<p class="muted" style="margin:6px 0 0">De ${num(u.elegibles)} elegibles${u.elegibles>u.enviados?` (${num(u.elegibles-u.enviados)} quedan para mañana por el tope diario)`:''}. Tú no tienes que hacer nada.</p>`);

  if(u.ok && hueco>1)
    return marco('var(--amber)',`⚠️ La última nota es del ${fFecha} — hace ${hueco} días hábiles.`,
      `<p class="muted" style="margin:6px 0 0">Salió bien, pero después no volvió a correr. Casi siempre es que el sitio se republicó sin la sección programada de <code>netlify.toml</code>, o que Netlify pausó las funciones. Abre la liga de <b>estado</b> para confirmarlo.</p>`);

  if(u.ok)   // corrio y no habia a quien
    return marco('var(--amber)',`La nota corrió el ${fFecha}, pero no le tocó a nadie.`,
      `<p class="muted" style="margin:6px 0 0">${esc(explicaCorrida(u.resultado))} Si tu base tiene correos, revisa la liga de <b>estado</b>: ahí se ve el conteo real.</p>`);

  return marco('var(--red)',`🔴 La nota NO salió el ${fFecha}.`,
    `<p style="margin:6px 0 0">${esc(explicaCorrida(u.resultado))}</p>
     ${rachaMala>1?`<p class="muted" style="margin:6px 0 0">Van ${rachaMala} corridas seguidas fallando.</p>`:''}
     <p class="muted" style="margin:6px 0 0">Debió llegarte un correo con el detalle y el paso a seguir. Si no llegó, es señal de que el correo saliente es justo lo que está roto.</p>`);
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
  const open=cartera().filter(p=>OPEN_STAGES.includes(p.etapa));
  const ws=open.map(p=>({p,s:nextStep(p)}));
  const vencidas=ws.filter(x=>x.s.urg==='vencida').sort((a,b)=>a.s.dias-b.s.dias).map(x=>x.p);
  const hoy=ws.filter(x=>x.s.urg==='hoy').map(x=>x.p);
  const superPend=open.filter(p=>p.potencial==='alto'&&!p.fechaProxima&&!(p.actividades||[]).length);
  const nuevos=cartera().filter(p=>p.etapa==='Cliente nuevo'&&!p.fechaProxima&&!(p.actividades||[]).length).sort((a,b)=>((b.potencial==='alto')-(a.potencial==='alto'))||(compScore(b)-compScore(a)));
  const perdidosReact=cartera().filter(p=>p.etapa==='Perdido'&&p.fechaProxima);
  const reactivar=cartera().filter(p=>p.etapa==='Cliente nuevo'&&!(p.actividades||[]).length&&operabaScore(p)>0).sort((a,b)=>(operabaScore(b)-operabaScore(a))||(compScore(b)-compScore(a)));
  const PD=planData();
  const semColor=PD.ritmo>=.9?'var(--green)':PD.ritmo>=.6?'var(--amber)':'var(--red)';
  const semTxt=PD.faltan===0?'🏆 Meta de clientes cubierta — cuida la recurrencia':PD.ritmo>=.9?'✅ A este ritmo llegas a la meta':PD.ritmo>=.6?'⚠️ Vas abajo del ritmo — sube los toques de hoy':'🔴 Muy abajo del ritmo — hoy es día de llamadas';
  const item=(p,extra)=>`<div class="list-item" data-client="${p.id}" style="cursor:pointer"><div><strong>${p.potencial==='alto'?'⭐ ':''}${esc(p.empresa)}</strong><div class="meta">${esc(p.contacto||'—')}${p.telefono?' · '+esc(p.telefono):''}</div></div><div style="text-align:right"><div class="midia-step">${esc(nextStep(p).accion)}</div><div class="meta">${extra||''}</div></div></div>`;
  const sec=(icon,title,arr,extraFn)=>`<div class="panel"><h3>${icon} ${title} <span class="muted">${arr.length}</span></h3><div class="list">${arr.length?arr.slice(0,12).map(p=>item(p,extraFn?extraFn(p):'')).join(''):empty('Nada por ahora.')}</div>${arr.length>12?`<div class="muted" style="margin-top:8px;font-size:12px">+${arr.length-12} más · velos en Clientes/Pipeline</div>`:''}</div>`;
  // Si la base trae contactos heredados del banco, se dice AQUI, que es la
  // primera pantalla. Un dato malo en la lista de llamadas quema la llamada, y
  // ella no tiene por que ir a buscarlo a Ajustes.
  const _her=contactosHeredados();
  const _herN=_her.reduce((a,[,arr])=>a+arr.length,0);
  const avisoHeredados=_herN?`<div class="panel alerta-datos">
    <h3>⚠️ Hay ${_herN} fichas con el contacto equivocado</h3>
    <p style="margin:-6px 0 12px">${_her.length} nombre(s) aparecen en ${HEREDADO_MIN} o más empresas distintas
      —por ejemplo <b>${esc(_her[0][0])}</b>, en ${_her[0][1].length}—. Nadie es el contacto de tantas empresas sin
      relación: son <b>ejecutivos del banco</b> que la importación vieja pegó como si fueran del cliente.
      Llamar diciendo ese nombre mata la llamada en tres segundos.</p>
    <button class="primary-btn" id="fix-heredados">🧹 Limpiar los ${_herN} contactos equivocados</button>
    <span class="muted" style="margin-left:10px;font-size:12px">Solo vacía el contacto. No toca empresa, teléfono, etapa ni actividades.</span>
  </div>`:'';
  $('#view-midia').innerHTML=avisoHeredados+panelAutomatizacion()+`
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
        <button class="ghost-btn big-btn" id="md-mancuerna">📞 Armar la lista de llamadas de hoy</button>
        <button class="ghost-btn big-btn" id="md-reporte">📤 Mandar mi reporte del día</button>
      </div>
      <div id="md-noticias-out"></div>
    </div>
    <div class="panel"><h3>☀️ Rutina de la mañana</h3><div class="list">
      <div class="list-item"><span>1. Genera y envía la <b>nota de apertura</b> por industria <span class="muted">(Notas de mercado → 🔄 En vivo)</span></span></div>
      <div class="list-item"><span>2. Resuelve <b>vencidas y de hoy</b> (abajo) 📞</span></div>
      <div class="list-item"><span>3. Manda la <b>lista de llamadas</b> de hoy <span class="muted">(Mancuerna → ${PD.toqDia} mejores, ya ordenadas)</span></span></div>
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
  // La cuota del plan manda: la lista del dia sale del mismo numero de toques.
  $('#md-mancuerna').onclick=()=>{ ui.mancN=PD.toqDia; ui.view='mancuerna'; render(); };
  [['plan-meta','metaMes'],['plan-prom','ingresoProm'],['plan-hor','horizonte']].forEach(([id,k])=>{
    void 0;
    $('#'+id).onchange=e=>{ const v=+e.target.value; if(v>0){ planCfg()[k]=v; save(); const open=$('#view-midia .plan-cfg').open; render(); const dt=$('#view-midia .plan-cfg'); if(dt)dt.open=open; } };
  });
  { const fb=$('#fix-heredados'); if(fb) fb.onclick=limpiarHeredados; }
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
  const list=inds.map(ind=>({name:ind.name,txt:buildIndustryNote(ind,'apertura','whatsapp',mk),n:cartera().filter(p=>p.segmento===ind.name&&p.telefono).length}));
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
  const acts=cartera().flatMap(p=>(p.actividades||[]).filter(a=>a.fecha===t).map(a=>({tipo:a.tipo,emp:p.empresa})));
  const reuniones=acts.filter(a=>a.tipo==='Reunión').length;
  const ganados=cartera().filter(p=>(p.ganadoFecha||'')===t||(p.operacion&&p.operacion.fecha===t));
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
  const open=cartera().filter(p=>OPEN_STAGES.includes(p.etapa));
  const pipeline=open.reduce((s,p)=>s+revenueOf(p),0);
  const ponderado=open.reduce((s,p)=>s+revenueOf(p)*(Number(p.probabilidad)||0)/100,0);
  const won=cartera().filter(isWon), lost=cartera().filter(p=>p.etapa==='Perdido');
  const mes=new Date().toISOString().slice(0,7);
  const wonMes=won.filter(p=>(p.ganadoFecha||'').slice(0,7)===mes).reduce((s,p)=>s+revenueOf(p),0);
  const wonTotal=won.reduce((s,p)=>s+revenueOf(p),0);
  const conv=(won.length+lost.length)?Math.round(won.length/(won.length+lost.length)*100):0;
  const acts=pendingActivities(); const overdue=acts.filter(a=>a.dias<0).length,hoy=acts.filter(a=>a.dias===0).length,semana=acts.filter(a=>a.dias>0&&a.dias<=7).length;
  const etapaSeg=STAGES.map(s=>({label:s,value:cartera().filter(p=>p.etapa===s).length,color:STAGE_COLOR[s]})).filter(x=>x.value>0);
  const totalCli=cartera().length;
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
  const max=Math.max(1,...STAGES.map(s=>cartera().filter(p=>p.etapa===s).length));
  return STAGES.map(s=>{const arr=cartera().filter(p=>p.etapa===s),val=arr.reduce((a,p)=>a+revenueOf(p),0),w=Math.max(3,arr.length/max*100);
    return `<div class="funnel-row"><span>${s}</span><div class="funnel-bar" style="width:${w}%;background:linear-gradient(90deg,${STAGE_COLOR[s]}99,${STAGE_COLOR[s]})">${arr.length||''}</div><span class="muted" style="text-align:right">${fmtUSD(val)}</span></div>`;}).join('');
}
function topOps(){
  const open=cartera().filter(p=>OPEN_STAGES.includes(p.etapa)).map(p=>({p,w:revenueOf(p)*(Number(p.probabilidad)||0)/100})).sort((a,b)=>b.w-a.w).slice(0,6);
  if(!open.length)return empty('Aún no hay oportunidades abiertas.');
  return open.map(({p,w})=>`<div class="list-item" data-client="${p.id}" style="cursor:pointer"><div><strong>${esc(p.empresa)}</strong> <span class="tag">${esc(p.etapa)}</span><div class="meta">${esc(p.contacto||'—')} · ${esc(p.segmento||'')}</div></div><div style="text-align:right"><div style="color:var(--gold);font-weight:700">${fmtUSD(w)}</div><div class="meta">${p.probabilidad}% · ${fmtUSD(revenueOf(p))} pot.</div></div></div>`).join('');
}

/* ---------- PIPELINE ---------- */
const KANBAN_CAP=60;
function renderPipeline(target){
  // En el kanban la columna se corta en KANBAN_CAP, asi que arriba van los mejores;
  // el nombre entra como ultimo criterio para que el orden sea estable y buscable.
  const cols=STAGES.map(s=>{const arr=filtered().filter(p=>p.etapa===s).sort((a,b)=>((b.potencial==='alto')-(a.potencial==='alto'))||(compScore(b)-compScore(a))||porNombre(a,b)),sum=arr.reduce((a,p)=>a+revenueOf(p),0);
    const shown=arr.slice(0,KANBAN_CAP);
    const moreNote=arr.length>KANBAN_CAP?`<div class="muted" style="padding:10px;font-size:11px;text-align:center;border-top:1px solid var(--line)">+${arr.length-KANBAN_CAP} más · velos en <b>Clientes</b></div>`:'';
    return `<div class="kcol" data-stage="${s}"><div class="kcol-head"><span style="color:${STAGE_COLOR[s]}">${s}</span><span class="cnt">${arr.length}</span></div><div class="kcol-sum">${fmtUSD(sum)}</div><div class="kcol-body">${shown.map(card).join('')}${moreNote}</div></div>`;}).join('');
  // Barra de lineas: el mismo rango de accion que se entrego en la lista de
  // llamadas, ahora como corte del tablero. Cada linea muestra su nocional
  // abierto, que es la pregunta que de verdad importa: cuanto hay vivo de FX,
  // cuanto de tasas y cuanto de commodities.
  const abiertos=scopeList().filter(p=>OPEN_STAGES.includes(p.etapa));
  const barra=`<div class="pipe-lineas">
    <button class="lin-pill ${ui.filtroLinea?'':'on'}" data-linea="">Todas <b>${abiertos.length}</b></button>
    ${Object.keys(LINEAS).map(k=>{
      const arr=abiertos.filter(p=>accionVigente(p).linea===k);
      const noc=arr.reduce((s,p)=>s+accionVigente(p).nocional,0);
      return `<button class="lin-pill ${ui.filtroLinea===k?'on':''}" data-linea="${k}" title="Nocional abierto en ${esc(LINEAS[k].label)}">
        ${LINEAS[k].icon} ${LINEAS[k].corto} <b>${arr.length}</b><span>${fmtUSD(noc)}</span></button>`;
    }).join('')}
  </div>`;
  const legend=barra+`<div class="pipe-legend"><span class="muted">Actividad:</span><span><i class="ld ok"></i> agendada</span><span><i class="ld today"></i> hoy</span><span><i class="ld overdue"></i> vencida</span><span><i class="ld none"></i> sin actividad</span><span class="muted" style="margin-left:auto">Chip = línea · rango entregado en la lista de llamadas</span></div>`;
  // Se enlaza SOLO dentro del contenedor: Clientes y Tarjetas tienen cada quien su
  // kanban, y un enlace global le pega otro listener a las tarjetas de la vista
  // oculta en cada render (un arrastre acabaria abriendo el dialogo varias veces).
  const cont=$(target||'#view-pipeline');
  cont.innerHTML=legend+`<div class="kanban">${cols}</div>`;
  Array.from(cont.querySelectorAll('[data-linea]')).forEach(b=>b.onclick=()=>{
    ui.filtroLinea=b.dataset.linea; render();
  });
  bindKanban(cont);
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
      <div class="c-accion">${chipAccion(p,{corto:true})}</div>
      <div class="c-foot"><span class="seg-tag">${esc(p.segmento||'—')}</span><span class="c-next">${esc(nextTxt)}</span></div>
    </div>
  </div>`;
}
function bindKanban(root){
  const R=root||document;
  let dragId=null, dragged=false;
  Array.from(R.querySelectorAll('.card')).forEach(c=>{
    c.addEventListener('dragstart',e=>{dragId=c.dataset.id;dragged=true;e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain',dragId);}catch(_){}c.classList.add('dragging');});
    c.addEventListener('dragend',()=>{c.classList.remove('dragging');$$('.kcol').forEach(k=>k.classList.remove('dragover'));setTimeout(()=>{dragged=false;},60);});
    c.addEventListener('click',()=>{ if(dragged)return; openClient(c.dataset.id); });
  });
  Array.from(R.querySelectorAll('.kcol')).forEach(col=>{
    col.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='move';col.classList.add('dragover');});
    col.addEventListener('dragleave',e=>{ if(!col.contains(e.relatedTarget)) col.classList.remove('dragover'); });
    col.addEventListener('drop',e=>{e.preventDefault();col.classList.remove('dragover');const p=state.prospects.find(x=>x.id===dragId);if(!p)return;const ns=col.dataset.stage;if(p.etapa!==ns){openMove(dragId,ns);}});
  });
}
function moveStage(p,ns){ p.stageHistory=p.stageHistory||[]; p.stageHistory.push({de:p.etapa,a:ns,fecha:todayISO()}); p.etapa=ns; if(WON_STAGES.includes(ns)&&!p.ganadoFecha)p.ganadoFecha=todayISO(); p.actualizado=todayISO(); save(); }

/* ---------- CLIENTES ----------------------------------------------------
   Misma tabla para la cartera y para Tarjetas: cambia solo el contenedor y
   la lista de origen (scopeList()), asi Tarjetas hereda filtros y ficha. */
function renderClientes(target){
  const base=scopeList();
  const segs=segNames().map(s=>({s,n:base.filter(p=>p.segmento===s).length})).filter(x=>x.n);
  const conDatos=base.filter(p=>compScore(p)>0).length, sinDatos=base.length-conDatos;
  const superN=base.filter(p=>p.potencial==='alto').length;
  // Orden ALFABETICO por defecto: con 330 tarjetas y 2,144 clientes lo que se
  // necesita es encontrar a alguien por nombre. Las dos colas donde el orden ES
  // el mensaje (a quien llamar primero) ya vienen rankeadas desde filtered() y
  // NO se re-ordenan — antes este sort las pisaba y deshacia la cola.
  const rankeado=['operaba','porverif','score'].includes(ui.filtroDatos);
  const arr=rankeado?filtered():filtered().slice().sort(porNombre);
  const rows=arr.map(p=>`<tr data-client="${p.id}" style="cursor:pointer">
    <td><strong>${p.potencial==='alto'?'⭐ ':''}${esc(p.empresa)}</strong><div class="meta">${esc(p.contacto||'—')}${p.puesto?' · '+esc(p.puesto):''}</div></td>
    <td>${compBadge(p)}${(()=>{const sc=scoreCierre(p);return sc?` <span class="score-pill" style="color:${scoreColor(sc)};border-color:${scoreColor(sc)}" title="Probabilidad de cierre: ${razonesCierre(p).join(' · ')}">${sc}</span>`:'';})()}</td>
    <td>${chipAccion(p,{corto:true})}</td>
    <td><span class="tag">${esc(p.segmento||'—')}</span></td>
    <td><span class="badge" style="background:${STAGE_COLOR[p.etapa]}22;color:${STAGE_COLOR[p.etapa]}">${esc(p.etapa)}</span></td>
    <td>${p.telefono?'📞':''}${p.email?'✉️':''}${!p.telefono&&!p.email?'<span class="muted">—</span>':''}</td>
    <td style="text-align:right">${fmtUSD(revenueOf(p))}</td>
    <td><div class="row-actions"><button class="icon-btn" data-client="${p.id}" title="Ficha">👁</button><button class="icon-btn" data-sched="${p.id}" title="Agendar cita">📅</button></div></td></tr>`).join('');
  // OJO: los <select> de filtro tienen el mismo id en Clientes y en Tarjetas. Hay que
  // enlazarlos DENTRO del contenedor: un $('#f-datos') global agarra el de la otra
  // vista (sigue en el DOM aunque este oculta) y los filtros dejan de responder.
  const cont=$(target||'#view-clientes');
  cont.innerHTML=`
    <div class="filters">
      <select id="f-datos"><option value="">Todos (datos)</option><option value="score" ${ui.filtroDatos==='score'?'selected':''}>🎯 Mejor probabilidad de cierre</option><option value="potencial" ${ui.filtroDatos==='potencial'?'selected':''}>⭐ Super potenciales</option><option value="operaba" ${ui.filtroDatos==='operaba'?'selected':''}>🔥 Ya operaban (reactivar)</option><option value="porverif" ${ui.filtroDatos==='porverif'?'selected':''}>📞 Por verificar (cola de llamadas)</option><option value="verificados" ${ui.filtroDatos==='verificados'?'selected':''}>✓ Ya verificados</option><option value="con" ${ui.filtroDatos==='con'?'selected':''}>Con datos de contacto</option><option value="email" ${ui.filtroDatos==='email'?'selected':''}>Con correo</option><option value="tel" ${ui.filtroDatos==='tel'?'selected':''}>Con teléfono</option><option value="sin" ${ui.filtroDatos==='sin'?'selected':''}>Solo nombre</option></select>
      <select id="f-seg"><option value="">Todas las industrias</option>${segNames().map(s=>`<option ${ui.filtroSeg===s?'selected':''}>${s}</option>`).join('')}</select>
      <select id="f-etapa"><option value="">Todas las etapas</option>${STAGES.map(s=>`<option ${ui.filtroEtapa===s?'selected':''}>${s}</option>`).join('')}</select>
      <select id="f-linea"><option value="">Todas las líneas</option>${Object.keys(LINEAS).map(k=>`<option value="${k}" ${ui.filtroLinea===k?'selected':''}>${LINEAS[k].icon} ${LINEAS[k].label} (${base.filter(p=>accionVigente(p).linea===k).length})</option>`).join('')}</select>
      <select id="f-rango"><option value="">Todos los rangos</option>${RANGOS.map(r=>`<option value="${r.k}" ${ui.filtroRango===r.k?'selected':''}>Rango ${r.k} · ${r.label} (${base.filter(p=>accionVigente(p).rango===r.k).length})</option>`).join('')}</select>
      <span class="muted">${arr.length} de ${base.length} · ⭐ ${superN} super · ${conDatos} con datos · ${sinDatos} solo nombre</span>
    </div>
    ${avisoBusqueda()}
    <div class="panel" style="padding:14px 16px"><h3 style="margin-bottom:10px">Segmentación por industria</h3><div class="funnel">${segs.length?segs.map(({s,n})=>{const max=Math.max(...segs.map(x=>x.n));return `<div class="funnel-row"><span>${s}</span><div class="funnel-bar" style="width:${Math.max(5,n/max*100)}%">${n}</div><span class="muted" style="text-align:right">${n}</span></div>`}).join(''):empty('Sin datos')}</div></div>
    <div class="table-wrap"><table><thead><tr><th>Empresa / Contacto</th><th>Datos</th><th>Cobertura</th><th>Industria</th><th>Etapa</th><th>Medios</th><th style="text-align:right">Ingreso est.</th><th></th></tr></thead><tbody>${rows||`<tr><td colspan="8">${empty('Sin clientes que coincidan.')}</td></tr>`}</tbody></table></div>`;
  cont.querySelector('#f-datos').onchange=e=>{ui.filtroDatos=e.target.value;render();};
  cont.querySelector('#f-seg').onchange=e=>{ui.filtroSeg=e.target.value;render();};
  cont.querySelector('#f-etapa').onchange=e=>{ui.filtroEtapa=e.target.value;render();};
  bindLimpiarBusqueda();
  cont.querySelector('#f-linea').onchange=e=>{ui.filtroLinea=e.target.value;render();};
  cont.querySelector('#f-rango').onchange=e=>{ui.filtroRango=e.target.value;render();};
  bindRowClicks();
}

/* ---------- DRAWER ficha ---------- */
/* ---------- VERIFICACION DE CONTACTO ----------------------------------------
   El dato de contacto viene del libro 2008-2020: mucha gente ya cambio de
   empleo. La UNICA verificacion confiable es la llamada. Esto convierte el
   resultado de esa llamada en dato, en 2 clics.
   p.verif = {estado:'ok'|'cambio'|'nolocal', fecha:'YYYY-MM-DD'}
---------------------------------------------------------------------------- */
const VERIF_MESES = 12;   // tras un año, se vuelve a considerar "por verificar"
function verifEstado(p){
  const v=p.verif;
  if(!v||!v.estado) return 'pendiente';
  if(v.estado==='nolocal') return 'nolocal';
  const d=daysFromToday(v.fecha);
  if(d!==null && -d > VERIF_MESES*30) return 'caduco';   // verificado hace mucho
  return v.estado;                                        // 'ok' | 'cambio'
}
const VERIF_BADGE={
  ok:      ['✓ Contacto verificado','#16a34a'],
  cambio:  ['↻ Contacto actualizado','#0d9488'],
  nolocal: ['✗ No localizable','#dc2626'],
  caduco:  ['⚠ Verificación vencida','#d97706'],
  pendiente:['— Sin verificar','#64748b'],
};
// Registra el resultado de la llamada y lo deja en la linea de tiempo.
function marcarVerif(id,estado,nuevoContacto){
  const p=state.prospects.find(x=>x.id===id); if(!p)return;
  p.verif={estado,fecha:todayISO()};
  let nota;
  if(estado==='ok') nota='✓ Verificado: '+(p.contacto||'el contacto')+' sigue en la empresa.';
  else if(estado==='cambio'){
    const antes=p.contacto||'(sin contacto)';
    if(nuevoContacto&&nuevoContacto.nombre) p.contacto=nuevoContacto.nombre;
    if(nuevoContacto&&nuevoContacto.puesto) p.puesto=nuevoContacto.puesto;
    if(nuevoContacto&&nuevoContacto.telefono) p.telefono=nuevoContacto.telefono;
    nota='↻ Contacto actualizado: antes '+antes+' → ahora '+(p.contacto||'—')+(p.puesto?(' ('+p.puesto+')'):'');
  } else nota='✗ No se pudo localizar a nadie en esta empresa.';
  p.actividades=p.actividades||[];
  p.actividades.push({id:uid(),fecha:todayISO(),tipo:'Llamada',nota});
  p.actualizado=todayISO();
  save(); render();
  if(!$('#drawer-client').classList.contains('hidden')) openClient(id);
  toast(estado==='ok'?'Contacto verificado ✓':estado==='cambio'?'Contacto actualizado ✓':'Marcado como no localizable');
}
function bloqueVerif(p){
  const st=verifEstado(p), [txt,color]=VERIF_BADGE[st];
  const fecha=(p.verif&&p.verif.fecha)?` <span class="muted">· ${p.verif.fecha}</span>`:'';
  return `<div class="verif-box">
    <div class="verif-head"><span class="verif-badge" style="color:${color};border-color:${color}">${txt}</span>${fecha}</div>
    <div class="verif-q">${lecturaDudosa(p)
      ? `⚠️ El nombre <b>no se leyó bien</b> de la tarjeta. <b>No preguntes por él</b>: di «¿con quién me comunico para el tema de tipo de cambio?» y captura el nombre real aquí.`
      : `Al llamar, pregunta por <b>${esc(p.contacto||'quien lleva tesorería')}</b>. ¿Qué te dijeron?`}</div>
    <div class="verif-btns">
      <button class="verif-b ok"     data-verif="ok">✓ Sigue ahí</button>
      <button class="verif-b cambio" data-verif="cambio">↻ Es otra persona</button>
      <button class="verif-b no"     data-verif="nolocal">✗ No localizable</button>
    </div>
  </div>`;
}
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
      ${bloqueVerif(p)}
      <div class="drawer-row"><span class="muted">Email</span><span>${p.email?`<a class="mini-link" href="mailto:${esc(p.email)}">${esc(p.email)}</a>`:'—'}</span></div>
      <div class="drawer-row"><span class="muted">Productos</span><span>${(p.productos||[]).map(pr=>`<span class="tag">${esc(prodName(pr))}</span>`).join(' ')||'—'}</span></div>
      <div class="drawer-row"><span class="muted">Próxima acción</span><span>${esc(p.proximaAccion||'—')} ${p.fechaProxima?`<span class="tag">${p.fechaProxima}</span>`:''}</span></div>
      ${p.operacion?`<div class="drawer-note" style="border-color:#86e0a5;background:#e7f6ec;color:var(--text)"><b>💰 Operación ganada</b><br>${esc(p.operacion.producto||'Operación')} · Vol ${fmtUSD(p.operacion.volumen)} · Nivel ${esc(p.operacion.nivel||'—')} · <b style="color:var(--green)">Ganancia ${fmtUSD(p.operacion.ganancia)}</b> · ${esc(p.operacion.fecha||'')}</div>`:''}
      ${p.notas?`<div class="drawer-note">${esc(p.notas)}</div>`:''}
      ${lecturaDudosa(p)?`<div class="drawer-note" style="border-color:var(--gold);background:#fffbeb;color:#78350f">
      <b>⚠️ El nombre no se pudo leer bien</b><br>Al escanear esta tarjeta el nombre quedó tapado o ilegible, así que
      <b>lo que dice arriba no es de fiar</b>. Por eso esta ficha no entra a la lista de llamadas.
      Corrige el nombre con ✎ Editar y vuelve a entrar sola.</div>`:''}
    ${p.esTarjeta?`<div class="drawer-note" style="border-color:var(--accent);background:var(--accent-soft);color:var(--text)"><b>📇 Está en Tarjetas</b><br>Aún no cuenta en tu pipeline ni en tus métricas. <button class="btn-sm" id="drawer-pass" style="margin-top:8px">✓ Pasar a Clientes</button></div>`:''}
      <div class="drawer-actions"><button class="primary-btn" id="drawer-act">+ Actividad</button><button class="ghost-btn" id="drawer-sched">📅 Agendar</button><button class="ghost-btn" id="drawer-cot">≣ Cotizar</button><button class="ghost-btn" id="drawer-edit">✎ Editar</button><button class="ghost-btn danger" id="drawer-del">🗑</button></div>
      <h3 class="drawer-h3">Línea de tiempo</h3>
      <div class="timeline">${acts.length?acts.map(a=>`<div class="tl-item"><div class="tl-dot"></div><div><strong>${esc(a.tipo)}</strong> <span class="muted">${a.fecha||''}</span><div>${esc(a.nota||'')}</div></div></div>`).join(''):'<div class="muted" style="padding:8px">Sin actividades aún.</div>'}${hist.map(h=>`<div class="tl-item"><div class="tl-dot alt"></div><div><span class="muted">${h.fecha}</span> movido a <strong>${esc(h.a)}</strong></div></div>`).join('')}</div>
    </div>`;
  $('#drawer-client').classList.remove('hidden'); $('#drawer-overlay').classList.remove('hidden');
  $('#drawer-close').onclick=closeDrawer;
  $('#drawer-act').onclick=()=>openActivity(id);
  { const dp=$('#drawer-pass'); if(dp)dp.onclick=()=>{ pasarTarjetas([id]); closeDrawer(); }; }
  $('#drawer-sched').onclick=()=>openSchedule(id);
  $('#drawer-cot').onclick=()=>{closeDrawer();ui.view='cotizador';ui.cotCliente=id;render();};
  $('#drawer-edit').onclick=()=>{closeDrawer();openProspect(id);};
  $('#drawer-del').onclick=()=>{ if(confirm('¿Eliminar este cliente? No se puede deshacer.')){ borrarProspects([id]); save(); closeDrawer(); render(); toast('Cliente eliminado'); } };
  $$('#drawer-client [data-setstage]').forEach(b=>b.onclick=()=>{ if(b.dataset.setstage!==p.etapa){ closeDrawer(); openMove(id,b.dataset.setstage); } });
  // Verificación de contacto: registra el resultado de la llamada.
  $$('#drawer-client [data-verif]').forEach(b=>b.onclick=()=>{
    const est=b.dataset.verif;
    if(est!=='cambio') return marcarVerif(id,est);
    const nombre=prompt('¿Con quién hay que hablar ahora?\n(nombre de la persona, o "Tesorería" si no te lo dieron)', '');
    if(nombre===null) return;                       // canceló
    const puesto=prompt('¿Qué puesto tiene? (opcional)','')||'';
    const tel=prompt('¿Te dieron teléfono o extensión? (opcional)','')||'';
    marcarVerif(id,'cambio',{nombre:nombre.trim(),puesto:puesto.trim(),telefono:tel.trim()||p.telefono});
  });
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
        <label>Cliente<select id="perf-cliente"><option value="">— Prospecto nuevo —</option>${opcionesCliente(ui.perfCliente)}</select></label>
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
        <label>Cliente (opcional)<select id="cot-cliente"><option value="">— Sin asignar —</option>${opcionesCliente(ui.cotCliente)}</select></label>
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
        <label>Cliente (opcional)<select id="prop-cliente"><option value="">— Sin asignar —</option>${opcionesCliente(ui.propCliente)}</select></label>
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

/* ---------- LEADS: los que llegaron solos ----------------------------------
   Vienen de calculadora.html, la pagina publica. Es la unica entrada que NO
   requiere que nadie levante el telefono, asi que son los contactos mas
   valiosos que hay: ya saben cuanto estan pagando de mas y aun asi pidieron
   que los buscaran.

   Viven en su propia tabla de Supabase (no en la cartera de nadie) hasta que
   alguien los pasa a Clientes. Solo existen en modo nube; en demo la seccion
   avisa en vez de fallar.
---------------------------------------------------------------------------- */
async function cargarLeads(silencioso){
  if (!DB.cloud) { ui.leads=[]; ui.leadsErr='demo'; return; }
  try { ui.leads = await DB.leads(); ui.leadsErr=null; }
  catch(e){ ui.leadsErr = errMsg(e); if(!silencioso) toast('No se pudieron traer los leads'); }
}
function leadsPend(){ return (ui.leads||[]).filter(l=>!l.atendido).length; }

/* El lead ya viene clasificado por la calculadora o por el bot: linea de
   cobertura y rango de accion vienen en la fila. Si no (leads viejos, de antes
   del cambio), se reconstruye con lo que haya. */
function accionLead(l){
  const linea=LINEAS[l.linea]?l.linea:'fx';
  const anual=Number(l.exposicion_anual)||(Number(l.monto_usd)||0)*12;
  const r=RANGOS.find(x=>x.k===l.rango)||rangoPorNocional(anual);
  return {linea, L:LINEAS[linea], rango:r.k, r, instrumento:INSTRUMENTO[linea][r.k],
          nocional:anual, fee:Math.round(anual*LINEAS[linea].bps/10000)};
}
// Se abre con SU cifra — pero la cifra que importa ya no es el ahorro de
// spread, sino lo que tiene expuesto. El spread queda como prueba de que
// nadie esta viendo el tema.
function ganchoLead(l){
  const a=accionLead(l), ah=Number(l.ahorro_anual)||0;
  const base=a.nocional
    ? `${a.L.icon} ${a.L.label} · Rango ${a.rango} — ${fmtUSD(a.nocional)} expuestos al año.`
    : `${a.L.icon} ${a.L.label} — llegó solo, falta dimensionar.`;
  return ah?`${base} Además calculó ${money(ah,'MXN')} al año perdidos en spread.`:base;
}
function textoLead(l){
  const nom=(l.contacto||'').split(' ')[0], a=accionLead(l);
  const ah=Number(l.ahorro_anual)||0;
  return [
    `Buen día${nom?', '+nom:''}. Le escribe ${userName(ME.email).split(' ')[0]}, de ${brand()}.`,
    `Vi que usó nuestra calculadora${l.empresa?' para '+l.empresa:''}.`,
    ah?`El ahorro de spread le salió en ${money(ah,'MXN')} al año, y eso ya es dinero. Pero normalmente lo grande está en otro lado: si su exposición se mueve en contra, el golpe es de otro tamaño.`:'',
    ``,
    a.nocional
      ? `Con lo que capturó, lo que trae sentido revisar es ${a.instrumento.toLowerCase()}.`
      : `Lo primero sería dimensionar cuánto mueven al año.`,
    ``,
    `¿Le parece si lo vemos 15 minutos y le doy el número de su caso? Sin costo y sin compromiso.`,
  ].filter(Boolean).join('\n');
}

function renderLeads(){
  const cont=$('#view-leads');
  if(ui.leadsErr==='demo'){
    cont.innerHTML=`<div class="panel">${empty('Los leads de la página pública llegan por la nube. Esta sesión está en modo local (demo), así que no hay nada que mostrar aquí.')}</div>`;
    return;
  }
  const q=(ui.search||'').toLowerCase().trim();
  const arr=(ui.leads||[]).filter(l=>coincideBusqueda(l,q));
  const pend=arr.filter(l=>!l.atendido), hechos=arr.filter(l=>l.atendido);

  const ficha=l=>{
    const tel=(l.telefono||'').replace(/\D/g,'');
    const wa=tel?(tel.length===10?'52'+tel:tel):'';
    const cuando=(l.creado||'').slice(0,16).replace('T',' ');
    const monto=Number(l.monto_usd)||0, al=accionLead(l);
    return `<div class="lead-card${l.atendido?' lead-done':''}">
      <div class="lead-top">
        <div>
          <strong>${esc(l.empresa||l.contacto||l.email||'Sin nombre')}</strong>
          <div class="meta">${esc(l.contacto||'—')}${l.email?' · '+esc(l.email):''}${l.telefono?' · '+esc(l.telefono):''}</div>
        </div>
        <span class="meta" style="white-space:nowrap">${esc(cuando)}</span>
      </div>
      <div class="lead-nums">
        <span class="acc-chip asignado" style="--acc:${al.r.color}" title="${esc(al.instrumento)}">${al.L.icon} ${al.L.corto} · Rango ${al.rango}</span>
        ${al.nocional?`<span><b>${fmtUSD(al.nocional)}</b> expuestos al año</span>`:''}
        ${monto?`<span><b>${fmtUSD(monto)}</b> al mes</span>`:''}
        ${l.spread_banco?`<span>paga <b>${esc(l.spread_banco)}¢</b> de spread</span>`:''}
        ${al.fee?`<span class="lead-hot"><b>${fmtUSD(al.fee)}</b> de comisión al año</span>`:''}
      </div>
      <div class="lead-why">${esc(ganchoLead(l))}</div>
      <div class="lead-acts">
        ${tel?`<a class="btn-sm" href="tel:${tel}">📞 Llamar</a>`:''}
        ${wa?`<a class="btn-sm" target="_blank" href="https://wa.me/${wa}?text=${encodeURIComponent(textoLead(l))}">💬 WhatsApp</a>`:''}
        ${l.email?`<a class="btn-sm" href="mailto:${esc(l.email)}?subject=${encodeURIComponent(brand()+' — su cálculo de tipo de cambio')}&body=${encodeURIComponent(textoLead(l))}">✉ Correo</a>`:''}
        <button class="btn-sm" data-lead-alta="${l.id}">➕ Pasar a Clientes</button>
        <button class="btn-sm" data-lead-ok="${l.id}" data-val="${l.atendido?'0':'1'}">${l.atendido?'↩ Reabrir':'✓ Atendido'}</button>
      </div>
    </div>`;
  };

  cont.innerHTML=`
    <div class="panel">
      <h3>⚡ Sin atender <span class="muted">${pend.length}</span></h3>
      ${avisoBusqueda()}
      <p class="muted" style="margin:-8px 0 14px">Llegaron solos por la página pública. Llámales el mismo día: el interés se enfría en horas, no en semanas.</p>
      ${ui.leadsErr&&ui.leadsErr!=='demo'?`<div class="msg-err">No se pudieron traer: ${esc(ui.leadsErr)}</div>`:''}
      <div class="lead-list">${pend.length?pend.map(ficha).join(''):empty('Nadie nuevo por ahora. Comparte la liga de la calculadora para que empiecen a caer.')}</div>
      <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="ghost-btn" id="leads-recargar">🔄 Actualizar</button>
        <button class="ghost-btn" id="leads-liga">🔗 Copiar la liga de la calculadora</button>
      </div>
    </div>
    ${hechos.length?`<div class="panel"><h3>✓ Ya atendidos <span class="muted">${hechos.length}</span></h3>
      <div class="lead-list">${hechos.slice(0,30).map(ficha).join('')}</div></div>`:''}`;

  bindLimpiarBusqueda();
  $('#leads-recargar').onclick=async()=>{ await cargarLeads(); render(); toast('Actualizado ✓'); };
  $('#leads-liga').onclick=()=>copy(location.origin+location.pathname.replace(/[^/]*$/,'')+'calculadora.html');
  $$('[data-lead-ok]').forEach(b=>b.onclick=async()=>{
    b.disabled=true;
    try{ await DB.marcarLead(b.dataset.leadOk, b.dataset.val==='1'); await cargarLeads(true); render(); }
    catch(e){ b.disabled=false; toast('No se pudo guardar'); }
  });
  $$('[data-lead-alta]').forEach(b=>b.onclick=()=>altaDesdeLead(b.dataset.leadAlta));
}

// Pasa el lead a la cartera con lo que ya sabemos de el: etapa "Contactado"
// porque el primer movimiento lo hizo la persona, no nosotros.
function altaDesdeLead(id){
  const l=(ui.leads||[]).find(x=>String(x.id)===String(id)); if(!l) return;
  const monto=Number(l.monto_usd)||0, a=accionLead(l);
  const p={
    id:uid(), empresa:l.empresa||l.contacto||l.email||'Lead', contacto:l.contacto||'',
    puesto:'', telefono:l.telefono||'', email:l.email||'',
    fuente:'Inbound (web)', segmento:(state.industries[0]||{}).name||'', etapa:'Contactado',
    productos:[], notional:a.nocional, feeBps:a.L.bps, probabilidad:25,
    // Llega ya clasificado: el lead trae su linea y su rango desde la
    // calculadora o el bot, asi que aparece en el pipeline con el mismo chip
    // que los que salen de la lista de llamadas.
    accion:{linea:a.linea, rango:a.rango, instrumento:a.instrumento, objetivo:a.r.objetivo,
            nocional:a.nocional, etapaMeta:a.r.etapa, fecha:todayISO()},
    proximaAccion:a.r.objetivo, fechaProxima:todayISO(),
    notas:[`Origen: ${l.origen||'calculadora'} (${(l.creado||'').slice(0,10)})`,
           `Línea: ${a.L.label} · Rango ${a.rango} — ${a.instrumento}`,
           a.nocional?`Exposición anual: ${fmtUSD(a.nocional)}`:'',
           monto?`Declaró USD ${num(monto)} al mes`:'',
           l.spread_banco?`Dijo pagar ${l.spread_banco} centavos de spread`:'',
           l.ahorro_anual?`Ahorro de spread estimado: ${money(Number(l.ahorro_anual),'MXN')}`:'',
           l.notas||''].filter(Boolean).join('\n'),
    creado:todayISO(), actualizado:todayISO(),
    actividades:[{id:uid(),fecha:todayISO(),tipo:'Inbound',nota:'Llenó la calculadora del sitio y pidió que lo contactaran.'}],
    stageHistory:[],
  };
  state.prospects.unshift(p);
  save();
  DB.marcarLead(l.id,true).then(()=>cargarLeads(true)).catch(()=>{});
  l.atendido=true;
  render(); toast('Agregado a Clientes ✓');
  openClient(p.id);
}

/* ---------- MANCUERNA: trabajo listo para quien NO abre el CRM --------------
   Realidad de esta mesa: quien tiene la relacion, la licencia y el telefono de
   los 2,144 no usa la herramienta y no la va a usar. Entonces la herramienta no
   puede pedirle NADA: tiene que escupirle trabajo terminado.

   El flujo es de dos personas (por eso "mancuerna", como el .xls de 2008):
     1. Aqui se arma la lista de llamadas del dia, ordenada por probabilidad
        real de cierre — no alfabetica, no por fecha.
     2. Sale por WhatsApp como UN solo mensaje: numero tapeable, por que a ese
        y la frase exacta de apertura. El operador solo marca.
     3. El resultado vuelve por voz ("de los 10, tres siguen") y se captura
        aqui en un boton, con el mismo flujo de verificacion que ya existia.

   Nada de esto requiere que el operador instale, entre o aprenda algo.
---------------------------------------------------------------------------- */

/* Score 0-100: probabilidad de que ESTA ficha se convierta en dinero.
   Los pesos no son opinion — son el orden que el propio PLAN_DE_CIERRE ya
   habia identificado: cobertura previa >> cliente activo previo >> datos
   completos. Lo unico que agrega el score es poder mezclar las señales y
   ordenar las 2,144 de un jalon en vez de filtrarlas de una en una. */
const SCORE_PESOS = [
  {pts:34, test:p=>operabaScore(p)===2,                          txt:'🔥 Ya tenía cobertura'},
  {pts:20, test:p=>operabaScore(p)===1,                          txt:'Fue cliente activo'},
  // El tamaño de la exposicion es lo que separa un programa de una operacion
  // suelta, asi que pesa casi tanto como haber sido cliente. Antes no entraba
  // en el score y por eso la lista mezclaba corporativos con changarros.
  {pts:26, test:p=>accionDe(p).rango==='A',                      txt:'💰 Exposición de programa'},
  {pts:18, test:p=>accionDe(p).rango==='B',                      txt:'Exposición estructurable'},
  {pts:8,  test:p=>accionDe(p).rango==='C',                      txt:'Da para un primer forward'},
  {pts:16, test:p=>!!p.telefono,                                 txt:'Con teléfono'},
  {pts:10, test:p=>['ok','cambio'].includes(verifEstado(p)),     txt:'✓ Contacto verificado'},
  {pts:8,  test:p=>!!p.contacto,                                 txt:'Contacto con nombre'},
  {pts:6,  test:p=>p.potencial==='alto',                         txt:'⭐ Super potencial'},
  {pts:4,  test:p=>!!p.email,                                    txt:'Con correo'},
];
// 34+26+16+10+8+6+4: dentro de cada grupo los pesos son excluyentes (los dos
// primeros salen de operabaScore; los tres de rango, del nocional).
const SCORE_MAX = 104;
function scoreCierre(p){
  if(!p || verifEstado(p)==='nolocal') return 0;   // ya se comprobo que no hay a quien llamar
  let raw=0; for(const f of SCORE_PESOS) if(f.test(p)) raw+=f.pts;
  return Math.min(100, Math.round(raw/SCORE_MAX*100));
}
function razonesCierre(p){
  if(verifEstado(p)==='nolocal') return ['✗ No localizable'];
  return SCORE_PESOS.filter(f=>f.test(p)).map(f=>f.txt);
}
function scoreIcono(sc){ return sc>=70?'🔥':sc>=45?'⭐':'•'; }
function scoreColor(sc){ return sc>=70?'var(--green)':sc>=45?'var(--accent)':'var(--muted)'; }

/* Telefono: 10 digitos para mostrar, +52 para que WhatsApp lo vuelva tapeable. */
function telDigits(p){ const r=telA10(p&&p.telefono); return (r.tel||'').replace(/\D/g,''); }
// Mexico tiene lada de 2 digitos SOLO en CDMX (55/56), Guadalajara (33) y
// Monterrey (81); el resto del pais es de 3. Partirlo siempre en 2 deja
// "+52 99 8123 4567" para un numero de Cancun, que se lee mal al marcar.
const LADA2 = ['55','56','33','81'];
function telBonito(p){
  const d=telDigits(p); if(!d) return '';
  if(d.length!==10) return '+'+d;
  return LADA2.includes(d.slice(0,2))
    ? `+52 ${d.slice(0,2)} ${d.slice(2,6)} ${d.slice(6)}`      // 55 1234 5678
    : `+52 ${d.slice(0,3)} ${d.slice(3,6)} ${d.slice(6)}`;     // 998 123 4567
}

/* Elegibilidad para la lista del dia. La regla que mas importa es la ultima:
   nadie entra dos veces en 14 dias. Sin eso la lista repite a los mismos
   "mejores" cada mañana y el operador deja de confiar en ella. */
const MANC_REPESCA = 14;
function diasDesde(iso){ const d=daysFromToday(iso); return d==null?null:-d; }
function elegibleMancuerna(p){
  if(lecturaDudosa(p)) return false;      // el nombre no es de fiar: no se marca
  if(!telDigits(p)) return false;                                  // sin telefono no hay llamada
  if(verifEstado(p)==='nolocal') return false;
  if(WON_STAGES.includes(p.etapa) || p.etapa==='Perdido') return false;
  const ent=p.mancuerna&&p.mancuerna.fecha;
  if(ent && diasDesde(ent) < MANC_REPESCA) return false;           // ya se mando hace poco
  const ult=(p.actividades||[]).map(a=>a.fecha).filter(Boolean).sort().pop();
  if(ult && diasDesde(ult) < MANC_REPESCA) return false;           // ya se toco hace poco
  return true;
}
/* La cola sale de la cartera. Las TARJETAS escaneadas viven aparte a proposito
   (son datos sin revisar, leidos por la IA de una foto) y por eso no entran
   solas — pero son gente que SI se conocio en persona, o sea mas caliente que
   cualquiera de la base de 2008. Dejarlas fuera para siempre era desperdiciar
   lo mejor que hay. Por eso se pueden incluir, pero como decision explicita:
   el interruptor esta apagado por omision. */
function colaMancuerna(){
  const q=(ui.search||'').toLowerCase().trim();
  const base = (ui.mancTarjetas ? cartera().concat(bandeja()) : cartera()).filter(p=>coincideBusqueda(p,q));
  return base.filter(elegibleMancuerna).map(p=>({p,sc:scoreCierre(p)}))
    .filter(x=>x.sc>0).sort((a,b)=>(b.sc-a.sc)||porNombre(a.p,b.p));
}
function tarjetasLlamables(){ return bandeja().filter(elegibleMancuerna).filter(p=>scoreCierre(p)>0).length; }
/* Entregado pero sin resultado: la verificacion es anterior al envio (o no hay). */
function sinResultado(p){
  const f=p.mancuerna&&p.mancuerna.fecha; if(!f) return false;
  if(diasDesde(f)>21) return false;                     // ya es historia, no pendiente
  const v=p.verif&&p.verif.fecha;
  return !v || v < f;
}
function pendientesMancuerna(){
  const q=(ui.search||'').toLowerCase().trim();
  return cartera().filter(p=>coincideBusqueda(p,q)).filter(sinResultado)
    .sort((a,b)=>(a.mancuerna.fecha<b.mancuerna.fecha?1:-1)||(scoreCierre(b)-scoreCierre(a)));
}

/* ---- El discurso, por linea de cobertura ---------------------------------
   Esto es lo que cambio de raiz: antes todo abria por el spread ("le cobran 25
   centavos por dolar"). Ese gancho funciona para que contesten, pero encuadra
   la conversacion como una compra-venta y ahi el cliente compara precio y se
   va con quien le de un centavo menos. Abrir por la EXPOSICION encuadra un
   problema de margen, que es lo que la mesa sabe resolver y lo que deja
   nocional recurrente. El spread se sigue usando — pero como prueba de que
   hay dinero mal puesto, no como la oferta.
-------------------------------------------------------------------------- */
const DISCURSO = {
  fx: {
    quien:'Quién ve el tipo de cambio',
    dolor:'si el dólar se mueve, se les mueve el margen',
    pregunta:'¿ya saben cuánto le pega a su margen un movimiento de ocho por ciento, o se enteran cuando cierran el mes?',
    numero:'Con 200 mil dólares al mes de exposición, un movimiento de ocho por ciento son alrededor de $3.5 millones de pesos de margen. Eso no se arregla negociando centavos: se arregla fijando el tipo de cambio.',
    prueba:'De paso: casi todas las empresas pagan entre 20 y 30 centavos de spread sin negociarlo. Ese es el síntoma de que nadie está viendo el tema.',
    objDeja:'"No le pido que deje su banco. El banco le sigue dando su línea. Lo que le propongo es que la cobertura la arme quien la ve todos los días."',
  },
  tasas: {
    quien:'Quién ve la deuda',
    dolor:'cada movimiento de Banxico les cambia el costo financiero del año',
    pregunta:'¿su deuda está a tasa fija o siguen expuestos a la variable?',
    numero:'Sobre 50 millones de pesos a tasa variable, 150 puntos base son $750 mil pesos al año de costo extra. Un IRS lo vuelve un número fijo que se puede presupuestar.',
    prueba:'La mayoría trae la deuda a TIIE porque así se la dieron, no porque lo hayan decidido.',
    objDeja:'"No es refinanciar ni mover el crédito. El crédito se queda igual; encima se pone el swap que fija la tasa."',
  },
  commod: {
    quien:'Quién compra el insumo',
    dolor:'su mayor costo variable se mueve todos los días y nadie lo fija',
    pregunta:'¿lo compran a precio spot o ya tienen precio cerrado a plazo?',
    numero:'Si el insumo pesa 5 millones de dólares al año, un alza de doce por ciento son 600 mil dólares que salen del margen. Con un collar a costo cero se le pone techo sin pagar prima.',
    prueba:'Casi todos presupuestan el insumo al precio del día que armaron el presupuesto, y luego lo absorben.',
    objDeja:'"No cambia a su proveedor ni su logística. El físico sigue igual; el precio se fija aparte, en papel."',
  },
};

/* Por que a este, en una linea (lo que el operador necesita saber antes de marcar) */
function ganchoDe(p){
  const a=accionVigente(p), s=operabaScore(p), l=a.L.label.toLowerCase();
  if(p.esTarjeta) return `📇 Se conocieron en persona — te dio su tarjeta`;
  if(s===2) return `Ya tenía cobertura — continuidad en ${l}`;
  if(s===1) return `Fue cliente activo — reactivar por ${l}`;
  if(a.rango==='A') return `Exposición de programa en ${l} — esto va a comité`;
  if(p.potencial==='alto') return `Corporativo grande — sembrar por ${l}`;
  if(a.rango==='D') return `Frío y sin cifra — la llamada es para dimensionar`;
  return `Frío — abrir por su exposición a ${l}`;
}
/* La frase textual de apertura. Va entre comillas a proposito: se lee tal cual. */
function aperturaDe(p){
  const emp=p.empresa||'su empresa', s=operabaScore(p), a=accionVigente(p), D=DISCURSO[a.linea];
  // Con una tarjeta en la mano no se abre en frío: ya hubo un cara a cara, y
  // recordárselo es el mejor permiso que existe para la llamada.
  if(p.esTarjeta) return `Nos dio su tarjeta hace poco. Le hablo para darle seguimiento: ${D.pregunta}`;
  if(s===2) return `${emp} operaba coberturas con nuestra mesa. Hoy la llevo de forma independiente, con los mismos proveedores. ¿Siguen cubriendo su exposición o quedaron descubiertos?`;
  if(s===1) return `${emp} era cliente de la mesa. Hoy la llevo independiente y lo que trabajo es cobertura, no sólo la operación. ¿Hoy cómo manejan su riesgo de ${a.L.label.toLowerCase()}?`;
  if(a.rango==='A') return `¿Con quién veo el riesgo de ${a.L.label.toLowerCase()} en ${emp}? Por el tamaño que manejan, lo que trae sentido es una política de cobertura, no una operación suelta. ¿Ya tienen una por escrito?`;
  return `¿${D.quien} en ${emp}? Le llamo por una sola cosa: ${D.pregunta}`;
}

/* Secuencia de 3 toques. El problema no es tener el telefono, es que contesten:
   un solo intento por WhatsApp muere; tres toques distintos en canales distintos
   es lo que mueve la tasa de respuesta. */
function secuenciaDe(p){
  const yo=userName(ME.email).split(' ')[0], marca=brand();
  const quien=p.contacto||'quien lleve tesorería', emp=p.empresa||'su empresa';
  const react=operabaScore(p)>0, tarjeta=!!p.esTarjeta;
  const a=accionVigente(p), D=DISCURSO[a.linea], L=a.L;
  // Lo que se pide en la cita depende del rango: al de rango A se le pide el
  // comite, al de rango D solo dimensionar. Pedir de mas cierra la puerta;
  // pedir de menos deja la reunion sin quien decida.
  const pedir = a.rango==='A' ? 'una hora con quien decide, para revisar su exposición completa y dejar una política por escrito'
              : a.rango==='B' ? '30 minutos para revisar su exposición con sus propios números'
              : a.rango==='C' ? '15 minutos para cotizarle en firme su próxima operación'
              : '15 minutos para dimensionar cuánto mueven al año y ver si hay algo que cubrir';

  const wa=[
    `Buen día${p.contacto?', '+p.contacto:''}. Le escribe ${yo}, de ${marca}.`,
    tarjeta
      ? `Nos dio su tarjeta hace poco y le quedé de buscar. Trabajo el riesgo de ${L.label.toLowerCase()} de empresas como ${emp}.`
      : react
      ? `Le busco porque ${emp} operaba con nuestra mesa. Hoy la llevo de forma independiente, con los mismos proveedores institucionales, y lo que trabajo es cobertura: ${L.label.toLowerCase()}.`
      : `Le busco porque trabajo el riesgo de ${L.label.toLowerCase()} de empresas como ${emp}. El problema de fondo no es el precio del día: es que ${D.dolor}.`,
    ``,
    `${D.pregunta.charAt(0).toUpperCase()+D.pregunta.slice(1)}`,
    ``,
    `Si me regala ${pedir}, le muestro con sus propios números cuánto vale ese riesgo al año y dos formas concretas de acotarlo.`,
    ``,
    `Si prefiere, le marco. ¿Qué hora le funciona?`,
  ].join('\n');

  const llamada=[
    `📞 GUION — ${L.icon} ${L.label.toUpperCase()} · Rango ${a.rango}`,
    `Alcance de esta llamada: ${a.r.alcance}`,
    `Lo que se propone: ${a.instrumento}`,
    ``,
    `1) "Buenas, ¿me comunica con ${quien}, de tesorería?"`,
    `2) "${p.contacto?p.contacto:'Qué tal'}, soy ${yo}, de ${marca}."`,
    `3) GANCHO — ${tarjeta
        ? `"Nos dio su tarjeta hace poco y le quedé de buscar."`
        : react
        ? `"${emp} operaba con nuestra mesa hace tiempo. Hoy la llevo independiente y trabajo cobertura de ${L.label.toLowerCase()}."`
        : `"Trabajo el riesgo de ${L.label.toLowerCase()} de empresas de su sector."`}`,
    `4) LA PREGUNTA — "${D.pregunta.charAt(0).toUpperCase()+D.pregunta.slice(1)}"`,
    `5) EL NÚMERO — "${D.numero}"`,
    `6) CIERRE — "¿Le parece si nos damos ${pedir}?"`,
    ``,
    `SI DICE "NO TENEMOS ESE RIESGO":`,
    `   "${D.prueba} ¿Me deja hacerle dos preguntas para descartarlo en un minuto?"`,
    `SI DICE "YA LO VEMOS CON EL BANCO":`,
    `   ${D.objDeja}`,
    `SI DICE "MÁNDEME INFORMACIÓN":`,
    `   "Con gusto, ¿a qué correo? Le mando el diagnóstico de su industria y le marco el jueves, ¿le parece?"`,
    `SI DICE "NO ME INTERESA":`,
    `   "Entendido. ¿Le puedo mandar la nota diaria de mercado? Es gratis y así me tiene a la mano el día que su riesgo se mueva."`,
    ``,
    `⚠️ NO prometer un nivel, una prima ni una tasa. El número en firme se cotiza con la mesa.`,
  ].join('\n');

  const asunto=tarjeta
    ? `Seguimiento — ${emp} y su riesgo de ${L.label.toLowerCase()}`
    : react
    ? `${emp} — su cobertura de ${L.label.toLowerCase()}, ahora de forma independiente`
    : `${emp} — cuánto vale al año su riesgo de ${L.label.toLowerCase()}`;

  const correo=[
    `${p.contacto?p.contacto+',':'Buen día,'}`,
    ``,
    tarjeta
      ? `Le escribo dando seguimiento a su tarjeta. En ${marca} trabajamos el riesgo de ${L.label.toLowerCase()} con proveedores institucionales (${L.prov}).`
      : react
      ? `Le escribo porque ${emp} operaba con nuestra mesa. Hoy llevo esa misma mesa de forma independiente, en ${marca}, con acceso a los mismos proveedores institucionales (${L.prov}).`
      : `Le escribo porque en ${marca} trabajamos el riesgo de ${L.label.toLowerCase()} de empresas como ${emp}, con proveedores institucionales (${L.prov}).`,
    ``,
    `El punto concreto: ${D.dolor}. ${D.numero}`,
    ``,
    `Lo que propongo para su caso: ${a.instrumento.toLowerCase()}. ${a.r.alcance}.`,
    ``,
    `${D.prueba}`,
    ``,
    `No le pido que cambie de banco ni de proveedor. Le pido ${pedir}. Si al ver el número no le hace sentido, no hay nada que hacer.`,
    ``,
    `¿Le funciona esta semana?`,
    ``,
    `${yo}`,
    `${marca}`,
    ``,
    `Información con fines informativos; no constituye recomendación de inversión. La operación se realiza a través de las entidades autorizadas.`,
  ].join('\n');
  return {wa,llamada,correo,asunto};
}

/* EL ENTREGABLE: un solo mensaje de WhatsApp con la jornada completa.
   Formato pensado para leerse en un celular mientras se marca: numero visible
   con +52 para que WhatsApp lo vuelva liga tapeable, y la frase de apertura en
   cursiva para poder leerla en voz alta sin editar nada. */
function textoListaHoy(items){
  // Resumen por linea arriba del todo: quien llama entra sabiendo de que van
  // las diez llamadas antes de leer la primera. Si la lista trae tres temas
  // distintos, conviene agrupar mentalmente y no ir saltando.
  const porLinea={};
  items.forEach(({p})=>{ const k=accionVigente(p).linea; porLinea[k]=(porLinea[k]||0)+1; });
  const resumen=Object.keys(porLinea).map(k=>`${LINEAS[k].icon} ${porLinea[k]} de ${LINEAS[k].label.toLowerCase()}`).join(' · ');

  const L=[`📞 *LLAMADAS DE HOY — ${items.length}*`,`🗓️ ${fechaLarga()}`,``,
    resumen, ``,
    `Van de mayor a menor probabilidad de cierre. Tapea el número para marcar.`,
    `El *rango* dice hasta dónde llega esta llamada: A = programa completo, D = sólo dimensionar.`,``];
  items.forEach(({p,sc},i)=>{
    const a=accionVigente(p);
    L.push(`*${i+1}. ${p.esTarjeta?'📇 ':''}${p.empresa}*`);
    const q=[p.contacto||'Preguntar por tesorería',p.puesto].filter(Boolean).join(' · ');
    L.push(q);
    L.push(telBonito(p));
    L.push(`${scoreIcono(sc)} ${ganchoDe(p)}`);
    L.push(`${a.L.icon} *${a.L.label} · Rango ${a.rango}* — ${a.instrumento}`);
    L.push(`🎯 ${a.r.objetivo}`);
    if(a.nocional) L.push(`💰 Exposición en ficha: ${fmtUSD(a.nocional)} · comisión estimada ${fmtUSD(a.fee)}/año`);
    L.push(`_"${aperturaDe(p)}"_`);
    L.push(``);
  });
  L.push(`— ${brand()} · dime cómo te fue con cada uno y yo lo registro.`);
  return L.join('\n');
}

/* Marca la lista como entregada para que mañana salgan OTROS, y — esto es lo
   nuevo — ESCRIBE el rango de accion en la ficha. Ese sello es lo que hace que
   el pipeline muestre linea, rango y nocional sin que nadie capture nada: lo
   que se prometio en la llamada queda en el tablero. */
function entregarLista(items){
  const hoy=todayISO();
  items.forEach(({p})=>{
    const a=accionVigente(p);
    p.mancuerna={fecha:hoy};
    p.accion={linea:a.linea, rango:a.rango, instrumento:a.instrumento,
              objetivo:a.r.objetivo, nocional:a.nocional, etapaMeta:a.etapaMeta, fecha:hoy};
    // La comision de la ficha sigue la linea: tasas se cobra a 10 pb, no a 25.
    if(!p.feeMonto) p.feeBps=a.L.bps;
    if(!p.proximaAccion) p.proximaAccion=a.r.objetivo;
    p.actualizado=hoy;
  });
  ui.mancUndo=items.map(x=>x.p.id);
  save();
}
function deshacerEntrega(){
  (ui.mancUndo||[]).forEach(id=>{ const p=state.prospects.find(x=>x.id===id); if(p){ delete p.mancuerna; delete p.accion; } });
  ui.mancUndo=null; save(); render(); toast('Entrega deshecha — vuelven a la cola');
}

function renderMancuerna(){
  const todaCola=colaMancuerna();
  // Filtrar por linea sirve para hacer bloques de llamadas del mismo tema: se
  // encadenan mucho mejor diez llamadas de tasas seguidas que diez saltando
  // entre dolar, deuda e insumos.
  const cola=ui.mancLinea?todaCola.filter(x=>accionVigente(x.p).linea===ui.mancLinea):todaCola;
  const n=Math.min(ui.mancN, cola.length);
  const hoy=cola.slice(0,n);
  const pend=pendientesMancuerna();
  const tel=(state.mancuernaTel||state.reportarA||'').replace(/\D/g,'');
  const txt=hoy.length?textoListaHoy(hoy):'';
  ui.mancText=txt;

  const tjLlamables=tarjetasLlamables();
  const cuentaLinea=k=>todaCola.filter(x=>accionVigente(x.p).linea===k).length;
  const cuentaRango=k=>cola.filter(x=>accionVigente(x.p).rango===k).length;
  // Lo que vale la cola si se cierra: comision sobre el nocional de cada ficha.
  const potencial=cola.reduce((s,x)=>s+accionVigente(x.p).fee,0);

  const fila=({p,sc})=>{
    const a=accionVigente(p);
    return `<div class="manc-row">
    <div class="manc-sc" style="color:${scoreColor(sc)};border-color:${scoreColor(sc)}">${sc}</div>
    <div class="manc-main">
      <strong data-client="${p.id}" style="cursor:pointer">${p.esTarjeta?'📇 ':''}${p.potencial==='alto'?'⭐ ':''}${esc(p.empresa)}</strong>
      <div class="meta">${esc(p.contacto||'Preguntar por tesorería')}${p.puesto?' · '+esc(p.puesto):''} · ${esc(telBonito(p))}</div>
      <div class="manc-accion">${chipAccion(p)}<span class="manc-instr">${esc(a.instrumento)}</span>${a.fee?`<span class="manc-fee">${fmtUSD(a.fee)}/año</span>`:''}</div>
      <div class="manc-why">${razonesCierre(p).map(r=>`<span class="manc-chip">${esc(r)}</span>`).join('')}</div>
    </div>
    <div class="manc-acts">
      <a class="btn-sm" href="tel:${telDigits(p)}">📞</a>
      <button class="btn-sm" data-seq="${p.id}">📝 Guiones</button>
    </div>
  </div>`;};

  const filaPend=p=>`<div class="manc-row">
    <div class="manc-main">
      <strong data-client="${p.id}" style="cursor:pointer">${esc(p.empresa)}</strong>
      <div class="meta">${esc(p.contacto||'—')} · entregada ${p.mancuerna.fecha}</div>
    </div>
    <div class="verif-btns" style="flex:1 1 260px">
      <button class="verif-b ok"     data-mverif="ok"     data-id="${p.id}">✓ Sigue ahí</button>
      <button class="verif-b cambio" data-mverif="cambio" data-id="${p.id}">↻ Es otra persona</button>
      <button class="verif-b no"     data-mverif="nolocal" data-id="${p.id}">✗ No localizable</button>
    </div>
  </div>`;

  $('#view-mancuerna').innerHTML=`
    <div class="panel manc-hero">
      <h3>📤 La lista de hoy <span class="muted">para quien hace las llamadas</span></h3>
      <p class="muted" style="margin:-8px 0 14px">Un solo mensaje de WhatsApp con los números ya tapeables y la frase de apertura de cada uno. No hay que instalar ni abrir nada del otro lado.</p>
      <div class="manc-cfg">
        <label>Cuántas llamadas<select id="manc-n">${
          // La cuota del plan (Mi Día → 🎯) puede no ser un valor redondo: se
          // agrega a las opciones para que el select nunca muestre otra cosa.
          [...new Set([5,10,15,20,30,ui.mancN])].sort((a,b)=>a-b)
            .map(v=>`<option ${ui.mancN===v?'selected':''}>${v}</option>`).join('')
        }</select></label>
        <label>Línea de cobertura<select id="manc-linea">
          <option value="">Todas (${todaCola.length})</option>
          ${Object.keys(LINEAS).map(k=>`<option value="${k}" ${ui.mancLinea===k?'selected':''}>${LINEAS[k].icon} ${LINEAS[k].label} (${cuentaLinea(k)})</option>`).join('')}
        </select></label>
        <label>Mandar a (WhatsApp, con lada)<input id="manc-tel" value="${esc(state.mancuernaTel||state.reportarA||'')}" placeholder="52 55 1234 5678" /></label>
      </div>
      ${tjLlamables?`<label class="manc-tj"><input type="checkbox" id="manc-tj" ${ui.mancTarjetas?'checked':''} />
        <span>📇 Incluir las <b>${tjLlamables}</b> tarjetas escaneadas con teléfono — es gente que sí se conoció en persona, así que abre mejor que la base fría. Sus datos los leyó la IA de una foto: <b>revisa el nombre antes de mandar</b>.</span></label>`:''}
      ${avisoBusqueda()}
      <div class="manc-stats">
        <div><b>${cola.length}</b><span>en la cola</span></div>
        <div><b>${fmtUSD(potencial)}</b><span>comisión si cierra la cola</span></div>
        <div><b>${hoy.length?hoy[hoy.length-1].sc:0}–${hoy.length?hoy[0].sc:0}</b><span>score de hoy</span></div>
      </div>
      <div class="manc-rangos">
        ${RANGOS.map(r=>`<span class="rg-pill" style="--acc:${r.color}"><b>${r.k}</b> ${r.label} · ${cuentaRango(r.k)}</span>`).join('')}
      </div>
      ${/* El aviso de "entregadas" va FUERA del bloque de abajo a proposito: al
            entregar, esos contactos salen de la cola, y si la cola se vacia el
            bloque no se pinta. Antes eso escondia el boton de Deshacer justo en
            el caso en que mas hace falta — cuando se entrego de mas. */''}
      ${ui.mancUndo&&ui.mancUndo.length?`<div class="manc-undo">✅ ${ui.mancUndo.length} marcadas como entregadas — mañana salen otras. <button class="btn-sm" id="manc-undo">Deshacer</button></div>`:''}
      ${hoy.length?`<div class="manc-btns">
        <a class="primary-btn big-btn" id="manc-send" target="_blank" href="https://wa.me/${tel}?text=${encodeURIComponent(txt)}">📤 Mandar las ${hoy.length} llamadas por WhatsApp</a>
        <button class="ghost-btn big-btn" id="manc-copy">📋 Copiar la lista</button>
      </div>
      <details class="manc-prev"><summary class="muted">Ver el mensaje tal cual le va a llegar</summary><div class="news-note">${esc(txt)}</div></details>`
      :empty(todaCola.length&&ui.mancLinea?'Nadie en esta línea hoy — prueba con "Todas".'
            :cola.length?'Sube el número de llamadas.'
            :'No hay nadie elegible: se necesita teléfono, y nadie repite antes de '+MANC_REPESCA+' días. Verifica resultados o carga más base.')}
    </div>

    ${pend.length?`<div class="panel"><h3>🎧 Resultados pendientes <span class="muted">${pend.length}</span></h3>
      <p class="muted" style="margin:-8px 0 12px">Ya se entregaron y todavía no sabemos qué pasó. Pregúntale cómo le fue y captúralo aquí — esto alimenta la cuota de toques y saca del camino a los que ya no existen.</p>
      <div class="list">${pend.slice(0,25).map(filaPend).join('')}</div>
      ${pend.length>25?`<div class="muted" style="margin-top:8px;font-size:12px">+${pend.length-25} más</div>`:''}</div>`:''}

    <div class="panel"><h3>🎯 La cola completa <span class="muted">${cola.length} ordenadas por probabilidad</span></h3>
      <p class="muted" style="margin:-8px 0 12px">El score pesa cobertura previa, tamaño de la exposición, si fue cliente activo, y si hay con quién hablar. Cada ficha dice por qué está donde está y hasta dónde llega la llamada.</p>
      <div class="list">${cola.slice(0,60).map(fila).join('')||empty('Cola vacía.')}</div>
      ${cola.length>60?`<div class="muted" style="margin-top:8px;font-size:12px">+${cola.length-60} más · el resto sale en las listas de los próximos días</div>`:''}</div>

    <div class="modal-overlay hidden" id="manc-seq"></div>`;

  $('#manc-n').onchange=e=>{ ui.mancN=+e.target.value; render(); };
  $('#manc-linea').onchange=e=>{ ui.mancLinea=e.target.value; render(); };
  bindLimpiarBusqueda();
  { const tj=$('#manc-tj'); if(tj) tj.onchange=e=>{ ui.mancTarjetas=e.target.checked; render(); }; }
  $('#manc-tel').onchange=e=>{ state.mancuernaTel=e.target.value.trim(); save(); toast('Número guardado ✓'); };
  const send=$('#manc-send');
  if(send) send.onclick=()=>{ entregarLista(hoy); setTimeout(render,400); };
  const cp=$('#manc-copy');
  if(cp) cp.onclick=()=>{ copy(ui.mancText); entregarLista(hoy); render(); };
  const un=$('#manc-undo'); if(un) un.onclick=deshacerEntrega;
  $$('[data-seq]').forEach(b=>b.onclick=()=>abrirSecuencia(b.dataset.seq));
  $$('[data-mverif]').forEach(b=>b.onclick=()=>{
    const id=b.dataset.id, est=b.dataset.mverif;
    if(est!=='cambio') return marcarVerif(id,est);
    openClient(id);                       // el cambio de contacto se captura en la ficha
    toast('Captura ahí quién es el nuevo contacto');
  });
  bindRowClicks();
}

function abrirSecuencia(id){
  const p=state.prospects.find(x=>x.id===id); if(!p) return;
  const s=secuenciaDe(p), d=telDigits(p);
  const box=$('#manc-seq');
  box.innerHTML=`<div class="modal">
    <div class="modal-head"><h2>📝 ${esc(p.empresa)}</h2><button class="icon-btn" data-close-seq>✕</button></div>
    <div class="modal-body">
      <p class="muted" style="margin-top:0">Tres toques en tres canales, en este orden. Un solo intento casi nunca contesta.</p>
      <div class="seq-step"><div class="seq-head"><b>Toque 1 · WhatsApp</b><span class="muted">hoy</span></div>
        <div class="news-note">${esc(s.wa)}</div>
        <div class="news-actions"><button class="btn-sm" data-cs="wa">📋 Copiar</button>${d?`<a class="btn-sm" target="_blank" href="https://wa.me/52${d}?text=${encodeURIComponent(s.wa)}">▶ Enviar</a>`:''}</div></div>
      <div class="seq-step"><div class="seq-head"><b>Toque 2 · Llamada</b><span class="muted">al día siguiente</span></div>
        <div class="news-note">${esc(s.llamada)}</div>
        <div class="news-actions"><button class="btn-sm" data-cs="ll">📋 Copiar</button>${d?`<a class="btn-sm" href="tel:${d}">📞 Marcar</a>`:''}</div></div>
      <div class="seq-step"><div class="seq-head"><b>Toque 3 · Correo</b><span class="muted">3 días después</span></div>
        <div class="meta" style="margin-bottom:6px">Asunto: <b>${esc(s.asunto)}</b></div>
        <div class="news-note">${esc(s.correo)}</div>
        <div class="news-actions"><button class="btn-sm" data-cs="co">📋 Copiar</button>${p.email?`<a class="btn-sm" href="mailto:${esc(p.email)}?subject=${encodeURIComponent(s.asunto)}&body=${encodeURIComponent(s.correo)}">✉ Enviar</a>`:'<span class="muted" style="font-size:11.5px">sin correo en la ficha</span>'}</div></div>
    </div></div>`;
  box.classList.remove('hidden');
  box.querySelector('[data-close-seq]').onclick=()=>box.classList.add('hidden');
  box.onclick=e=>{ if(e.target===box) box.classList.add('hidden'); };
  box.querySelectorAll('[data-cs]').forEach(b=>b.onclick=()=>copy({wa:s.wa,ll:s.llamada,co:s.correo}[b.dataset.cs]));
}

/* ---------- SEGUIMIENTO ---------- */
function pendingActivities(){ return cartera().filter(p=>p.fechaProxima).map(p=>({p,fecha:p.fechaProxima,accion:p.proximaAccion||'Dar seguimiento',dias:daysFromToday(p.fechaProxima),etapa:p.etapa})).sort((a,b)=>a.dias-b.dias); }
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
  const sym={usdmxn:'MXN=X',eurusd:'EURUSD=X',eurmxn:'EURMXN=X',dxy:'DX-Y.NYB',brent:'BZ=F',wti:'CL=F',gasnat:'NG=F',oro:'GC=F',plata:'SI=F',cobre:'HG=F',aluminio:'ALI=F',maiz:'ZC=F',trigo:'ZW=F',soya:'ZS=F',cafe:'KC=F',azucar:'SB=F',sp500:'^GSPC',dow:'^DJI',nasdaq:'^IXIC',ipcmx:'^MXX',nikkei:'^N225',dax:'^GDAXI',vix:'^VIX',ust10:'^TNX'};
  const dec=k=>(['usdmxn','eurusd','eurmxn'].includes(k)?4:['sp500','dow','nasdaq','nikkei','dax','ipcmx'].includes(k)?0:k==='azucar'?4:2);
  const proxies=[u=>'https://api.allorigins.win/raw?url='+encodeURIComponent(u), u=>'https://corsproxy.io/?url='+encodeURIComponent(u)];
  const one=async(k,s)=>{ const yu='https://query1.finance.yahoo.com/v8/finance/chart/'+s+'?interval=1d&range=1d';
    for(const px of proxies){ try{
      const ctl=new AbortController(); const to=setTimeout(()=>ctl.abort(),8000);
      const t=await (await fetch(px(yu),{signal:ctl.signal})).text(); clearTimeout(to);
      const p=JSON.parse(t)?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if(p){
        const v=(+p)*(ESCALA[k]||1);
        if(!plausibleMkt(k,v)) return;                    // dato raro: mejor omitirlo
        state.market[k]= dec(k)===0?String(Math.round(v)):v.toFixed(dec(k)); ok.push(MLAB[k].label); return;
      }
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
  const clientes=cartera().filter(p=>p.segmento===ind);
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
  // Los guiones abren por EXPOSICION, no por precio. El spread aparece al
  // final y como sintoma: sirve para probar que nadie esta viendo el tema, no
  // como la oferta. Vender centavos invita a que comparen centavos.
  const scripts=[
    {t:'Apertura en frío',s:`Hola [Nombre], habla [Tu nombre] de ${brand()}. Trabajamos el riesgo de mercado de empresas como [Empresa]: tipo de cambio, tasa de la deuda y precio de insumos, con casas como Marex y StoneX. ¿Cuál de los tres les pega más hoy?`},
    {t:'Gancho · tipo de cambio',s:'Si el dólar se mueve 8% en el año, ¿ya saben cuánto le pega a su margen, o se enteran cuando cierran el mes? Con su volumen le pongo el número exacto y dos formas de acotarlo.'},
    {t:'Gancho · tasas',s:'¿Su deuda está a tasa fija o siguen expuestos a la variable? Sobre 50 millones a tasa flotante, 150 puntos base son $750 mil pesos al año. Un swap lo vuelve un número que se puede presupuestar.'},
    {t:'Gancho · commodities',s:'Su insumo es el mayor costo variable y se mueve todos los días. ¿Lo compran a precio spot o ya tienen precio cerrado a plazo? Con un collar a costo cero se le pone techo sin pagar prima.'},
    {t:'Gancho de spread (secundario)',s:'De paso: la mayoría paga a su banco entre 20 y 30 centavos por dólar sin negociarlo. Ese es el síntoma de que nadie está viendo el tema — el dinero grande está en la exposición, no en el spread.'},
    {t:'Objeción "ya lo vemos con el banco"',s:'Claro, y no le pido que deje su banco: la línea se queda donde está. Le propongo que la cobertura la arme quien la ve todos los días y le cotice contra varios proveedores, no contra uno.'},
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
  if(!isAdminUser()){ v.innerHTML=empty('Solo el administrador puede ver la cartera del equipo.'); return; }
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
/* CARGAR / ACTUALIZAR LA BASE — sin tirar el trabajo hecho.
   Antes esto BORRABA todas las fichas importadas y las volvia a crear. Se
   llevaba de corbata etapas, actividades, verificaciones y rangos entregados:
   volver a cargar la base costaba semanas de trabajo. Ahora empareja por nombre
   de empresa y ACTUALIZA en su lugar.

   Que gana y que pierde cada campo:
     · empresa, notas .... siempre de la base (ahi vive el estatus historico)
     · contacto, telefono, email ... de la base SOLO si la ficha no se ha
       verificado a mano. Si alguien ya hablo con esa empresa y confirmo quien
       es, esa verificacion humana le gana a una hoja de calculo de 2008.
     · etapa, actividades, stageHistory, accion, notional, verif ... intactos.  */
function cargarBase(silent, fuente){
  const base=fuente||window.BASE_CLIENTES;
  if(!base||!base.length){ if(!silent)toast('No hay base para cargar'); return; }
  const idx=new Map();
  (state.prospects||[]).forEach(p=>{ const k=normName(p.empresa); if(k && !idx.has(k)) idx.set(k,p); });
  let nuevos=0, actualizados=0, protegidos=0;
  base.forEach(c=>{
    const k=normName(c.empresa); if(!k) return;
    const p=idx.get(k);
    if(!p){
      const n=Object.assign({},c,{id:uid(),actividades:[],stageHistory:[],creado:todayISO()});
      state.prospects.push(n); idx.set(k,n); nuevos++; return;
    }
    // Verificado a mano = alguien ya hablo y confirmo. No se le pisa el contacto.
    const verificado = p.verif && ['ok','cambio'].includes(p.verif.estado);
    if(verificado) protegidos++;
    if(!verificado){
      if(c.contacto) p.contacto=c.contacto;
      else if((p.notas||'').includes('Importado:')) p.contacto='';   // limpia el heredado malo
      if(c.telefono) p.telefono=c.telefono;
      if(c.email)    p.email=c.email;
    }
    if(c.notas) p.notas=c.notas;
    if(c.empresa && c.empresa.length>(p.empresa||'').length) p.empresa=c.empresa;
    p.actualizado=todayISO();
    actualizados++;
  });
  state.baseSig=baseSig(); save(); render();
  if(!silent) toast(`Base actualizada ✓ ${nuevos} nuevos · ${actualizados} actualizados`
    + (protegidos?` · ${protegidos} verificados sin tocar`:''));
  return {nuevos, actualizados, protegidos};
}

/* Cargar la base desde un ARCHIVO. Hace falta porque assets/base-datos.js esta
   en .gitignore (son datos reales de clientes) y por lo tanto no viaja con el
   sitio publicado: sin esto habria que trabajar desde una copia local. */
function cargarBaseArchivo(e){
  const file=e.target.files[0]; e.target.value=''; if(!file) return;
  const r=new FileReader();
  r.onload=()=>{
    let arr=null;
    try{
      const t=String(r.result);
      // Acepta un JSON pelon o el propio base-datos.js (window.BASE_CLIENTES = [...])
      const m=/BASE_CLIENTES\s*=\s*(\[[\s\S]*\])\s*;?\s*$/.exec(t);
      arr=JSON.parse(m?m[1]:t);
      if(!Array.isArray(arr)) arr=arr.prospects||arr.clientes;
    }catch(err){ arr=null; }
    if(!Array.isArray(arr)||!arr.length){ toast('Archivo inválido: se esperaba una lista de contactos'); return; }
    const conCont=arr.filter(x=>x&&x.contacto).length;
    if(!confirm(`El archivo trae ${arr.length} empresas (${conCont} con contacto).\n\n`
      +`Se van a ACTUALIZAR las que ya tengas, emparejando por nombre de empresa, y a agregar las que falten.\n\n`
      +`NO se pierde nada de tu trabajo: etapas, actividades, citas y rangos entregados se quedan igual. `
      +`Las fichas que ya verificaste por teléfono tampoco se tocan.\n\n¿Continuar?`)) return;
    const r2=cargarBase(true, arr);
    toast(`Listo ✓ ${r2.nuevos} nuevos · ${r2.actualizados} actualizados`
      + (r2.protegidos?` · ${r2.protegidos} verificados sin tocar`:''));
  };
  r.readAsText(file);
}
/* ---------- CALIDAD DE DATOS -----------------------------------------------
   La base viene de 17 hojas de calculo de 2008-2020, consolidadas por fuera.
   Esas hojas traian DOS columnas de persona ("Ejecutivo", que es el ejecutivo
   del banco, y "Contacto", que es el del cliente) y DOS de telefono ("Tel.
   Oficina" y "telefono"). Si al consolidar se tomo la columna equivocada, el
   sintoma es exactamente este: el mismo nombre o el mismo numero repetido en
   decenas de empresas distintas.

   Esto no lo adivina: lo mide sobre la base real. Un nombre que aparece en 15
   empresas no es un contacto, es un ejecutivo de banco o un error de arrastre.
   Y llamar diciendo el nombre equivocado mata la llamada en tres segundos.
---------------------------------------------------------------------------- */
const REPETIDO_MIN = 3;          // a partir de cuantas empresas ya es sospechoso
/* Contactos HEREDADOS: los que aparecen en muchas empresas distintas. Con 5 o
   mas ya no hay duda razonable — nadie es el contacto de cinco empresas sin
   relacion. Son ejecutivos del banco que la importacion vieja pego como si
   fueran del cliente. Se detectan solos, sin necesidad de ningun archivo. */
const HEREDADO_MIN = 5;
/* LECTURAS DUDOSAS DE TARJETA. El escaner lee de una foto, y a veces el nombre
   queda tapado por una firma, un reflejo o un doblez. Cuando eso pasa lo anota.
   Una ficha asi NO puede entrar a una lista de llamadas: preguntar por un nombre
   que no existe termina la llamada en el primer segundo. Vale mas llegar sin
   nombre y preguntar "¿con quién me comunico?". */
const DUDOSA_RE = /REVISAR:|no legible|ileg[ií]ble|parcialmente legible|no se alcanza|se alcanza a leer|dudos|borros|cortad[oa]|tapad[oa]|sobrepuest|firma encima/i;
function lecturaDudosa(p){ return !!(p && p.esTarjeta && DUDOSA_RE.test(p.notas||'')); }
function contactosHeredados(){
  return repetidos('contacto').filter(([,arr])=>arr.length>=HEREDADO_MIN);
}
function limpiarHeredados(){
  const grupos=contactosHeredados();
  const total=grupos.reduce((a,[,arr])=>a+arr.length,0);
  if(!total) return 0;
  const nombres=grupos.slice(0,6).map(([v,arr])=>`  · ${v} — en ${arr.length} empresas`).join('\n');
  if(!confirm(`Se encontraron ${grupos.length} nombre(s) repetidos en ${total} fichas:\n\n${nombres}`
    +(grupos.length>6?`\n  … y ${grupos.length-6} más`:'')
    +`\n\nNadie es el contacto de ${HEREDADO_MIN}+ empresas sin relación: son ejecutivos del banco que la importación vieja pegó como si fueran del cliente.\n\n`
    +`Se va a VACIAR el contacto en esas ${total} fichas. El nombre queda anotado en las notas por si sirve de contexto.\n\n`
    +`No se toca nada más: empresa, teléfono, etapa, actividades y notas se quedan igual.\n\n¿Limpiarlos?`)) return 0;
  let n=0;
  grupos.forEach(([nombre,arr])=>arr.forEach(p=>{
    if(!p.contacto) return;
    p.contacto='';
    const marca=`Contacto heredado de la importación (era "${nombre}", ejecutivo del banco): se quitó por aparecer en ${arr.length} empresas. Preguntar al llamar.`;
    if(!(p.notas||'').includes('Contacto heredado')) p.notas=((p.notas||'').trim()+'\n'+marca).trim();
    p.actualizado=todayISO(); n++;
  }));
  save(); render();
  toast(`${n} contactos heredados limpiados ✓`);
  return n;
}
function repetidos(campo, norm){
  const m = new Map();
  (state.prospects||[]).forEach(p=>{
    const v = norm ? norm(p[campo]) : String(p[campo]||'').trim();
    if(!v) return;
    if(!m.has(v)) m.set(v,[]);
    m.get(v).push(p);
  });
  return [...m.entries()]
    .filter(([,arr])=>arr.length>=REPETIDO_MIN)
    .sort((a,b)=>b[1].length-a[1].length);
}
// Ojo: ya existe otro normTel mas abajo (deduplicado de tarjetas). Este usa
// telA10 para que '045 55 ...' y '+52 55 ...' cuenten como el MISMO numero.
const telParaComparar = t => { const d=(telA10(t).tel||'').replace(/\D/g,''); return d; };
// Para agrupar repetidos solo cuentan los que de verdad son un numero marcable.
const telAgrupable = t => { const d=telParaComparar(t); return d.length===10 ? d : ''; };
function diagnostico(){
  const todos = state.prospects||[];
  // "Raro" = TIENE telefono pero telA10 no logra sacar 10 digitos. Los formatos
  // viejos (045, 01, +52, 52) SI se normalizan bien, asi que no son un problema
  // y marcarlos seria una falsa alarma — y un panel de calidad que grita de mas
  // deja de leerse a la semana.
  const telMal = todos.filter(p=>String(p.telefono||'').trim() && telParaComparar(p.telefono).length!==10);
  const mailMal = todos.filter(p=>p.email && !/^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(String(p.email).trim()));
  return {
    total: todos.length,
    contactosRep: repetidos('contacto'),
    telefonosRep: repetidos('telefono', telAgrupable),
    sinContacto: todos.filter(p=>!String(p.contacto||'').trim()).length,
    sinTelefono: todos.filter(p=>telParaComparar(p.telefono).length!==10).length,
    telMal, mailMal,
  };
}
/* Borra un valor repetido de TODAS las fichas donde aparece. Es lo que salva
   horas si la importacion tomo la columna equivocada: mejor sin dato que con
   el dato de otra persona — un contacto vacio se pregunta al llamar; uno
   equivocado hace que cuelguen. */
function limpiarCampoEn(ids, campo){
  let n=0;
  (state.prospects||[]).forEach(p=>{ if(ids.includes(p.id) && p[campo]){ p[campo]=''; p.actualizado=todayISO(); n++; } });
  if(n){ save(); render(); toast(`Se vació el ${campo} en ${n} ficha(s) ✓`); }
}

function renderAjustes(){
  const baseN = (window.BASE_CLIENTES&&window.BASE_CLIENTES.length)||0;
  const basePanel = baseN? `<div class="panel" style="border-color:var(--accent2)"><h3>📥 Tu base de datos de clientes <span class="muted">${baseN} contactos listos</span></h3>
    <p class="muted" style="margin-top:-4px">Tus 17 archivos consolidados en una sola base, todos como <b>"Cliente nuevo"</b> para prospectar desde el inicio del pipeline. El estatus histórico queda en las notas (los que ya operaban van primero). Vuelve a pulsar cuando quieras para actualizar.</p>
    <button class="primary-btn" id="set-cargar-base">📥 Cargar / actualizar mi base (${baseN} clientes)</button></div>`:'';
  const dg = diagnostico();
  const bloqueRep = (titulo, arr, campo, pista) => {
    if(!arr.length) return `<p class="muted" style="margin:6px 0 0">✓ ${titulo}: nada repetido de forma sospechosa.</p>`;
    const afectadas = arr.reduce((a,[,x])=>a+x.length,0);
    return `<div class="dq-grupo">
      <div class="dq-head"><b>${titulo}</b><span class="dq-alerta">${arr.length} valor(es) · ${afectadas} fichas</span></div>
      <p class="muted" style="margin:2px 0 8px;font-size:11.5px">${pista}</p>
      ${arr.slice(0,8).map(([v,ps])=>`<div class="dq-row">
        <div><b>${esc(v)}</b><div class="meta">${ps.slice(0,4).map(p=>esc(p.empresa||'(sin nombre)')).join(' · ')}${ps.length>4?` y ${ps.length-4} más`:''}</div></div>
        <div class="dq-acts">
          <span class="dq-n">${ps.length}</span>
          <button class="btn-sm" data-dq-ver="${esc(v)}" data-dq-campo="${campo}">Ver</button>
          <button class="btn-sm" data-dq-limpiar="${ps.map(p=>p.id).join(',')}" data-dq-campo="${campo}" data-dq-val="${esc(v)}">Vaciar en ${ps.length}</button>
        </div></div>`).join('')}
      ${arr.length>8?`<div class="muted" style="font-size:11.5px;margin-top:6px">+${arr.length-8} más</div>`:''}
    </div>`;
  };
  const dqPanel = dg.total ? `<div class="panel" style="border-color:var(--gold)">
    <h3>🔍 Calidad de datos <span class="muted">${dg.total} fichas</span></h3>
    <p class="muted" style="margin-top:-4px">La base salió de 17 hojas de cálculo que traían <b>dos</b> columnas de persona (<i>Ejecutivo</i> del banco e <i>Contacto</i> del cliente) y <b>dos</b> de teléfono. Si al consolidar se tomó la equivocada, el síntoma es un mismo nombre o número repetido en muchas empresas. Aquí se mide sobre tu base real.</p>
    <div class="dq-stats">
      <div><b>${dg.sinContacto}</b><span>sin contacto</span></div>
      <div><b>${dg.sinTelefono}</b><span>sin teléfono</span></div>
      <div><b>${dg.telMal.length}</b><span>teléfono con largo raro</span></div>
      <div><b>${dg.mailMal.length}</b><span>correo inválido</span></div>
    </div>
    ${bloqueRep('Contactos repetidos', dg.contactosRep, 'contacto', 'Una persona que aparece en varias empresas distintas casi nunca es el contacto: suele ser el ejecutivo que las atendía. Vaciarlo es mejor que llamar diciendo el nombre equivocado.')}
    ${bloqueRep('Teléfonos repetidos', dg.telefonosRep, 'telefono', 'Un mismo número en varias empresas suele ser el conmutador de la sucursal, no el del cliente.')}
  </div>` : '';
  $('#view-ajustes').innerHTML=basePanel+dqPanel+`
    <div class="panel"><h3>Marca y reportes</h3>
      <label style="max-width:380px">Nombre visible en el dashboard y las notas<input id="set-brand" value="${esc(brand())}" /></label>
      <label style="max-width:380px;margin-top:10px">📤 Reportar mi día a (WhatsApp, con lada) <input id="set-reportar" value="${esc(state.reportarA||'')}" placeholder="52 55 1234 5678" /></label>
      <p class="muted" style="font-size:11.5px;margin:4px 0 0">Cuando pulses "Mandar mi reporte del día", se enviará a este número con 1 clic.</p>
      <button class="primary-btn" id="set-brand-save" style="margin-top:10px">Guardar</button></div>
    <div class="panel"><h3>Industrias / Segmentos <button class="primary-btn" id="btn-new-industry" style="float:right">+ Nueva industria</button></h3><p class="muted" style="margin-top:-4px">Cada industria define qué variables y enfoque aparecen en sus notas.</p>
      <div class="list">${state.industries.map(i=>`<div class="list-item"><div><strong>${esc(i.name)}</strong><div class="meta">${(i.vars||[]).map(v=>MLAB[v]?MLAB[v].label:v).join(' · ')||'—'}</div></div><div class="row-actions"><button class="icon-btn" data-ind-edit="${esc(i.name)}">✎</button><button class="icon-btn" data-ind-del="${esc(i.name)}">🗑</button></div></div>`).join('')}</div></div>
    <div class="panel"><h3>Datos y sesión</h3><div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="ghost-btn" id="set-export">⤓ Respaldar (JSON)</button><button class="ghost-btn" id="set-import">⤒ Restaurar</button>
      <button class="ghost-btn" id="set-base-file">📥 Cargar base de contactos (archivo)</button>
      <button class="ghost-btn" id="set-csv">⇩ Exportar clientes CSV</button><button class="ghost-btn" id="set-tel">📞 Teléfonos a 10 dígitos</button><button class="ghost-btn danger" id="set-reset">⟲ Vaciar y empezar de cero</button>
      <button class="ghost-btn" id="set-logout">⎋ Cerrar sesión</button>
    </div><p class="muted" style="margin-top:10px">Sesión: <strong>${esc(ME.email)}</strong> · Modo <strong>${DB.mode()}</strong>. ${DB.cloud?'Tus datos se sincronizan en la nube.':'Modo demo: respalda seguido.'}</p></div>`;
  $$('[data-dq-ver]').forEach(b=>b.onclick=()=>{
    // Reusa el buscador global: la lista queda filtrada y visible en Clientes.
    ui.search=b.dataset.dqVer; const c=$('#global-search'); if(c)c.value=ui.search;
    ui.view='clientes'; render();
  });
  $$('[data-dq-limpiar]').forEach(b=>b.onclick=()=>{
    const ids=b.dataset.dqLimpiar.split(','), campo=b.dataset.dqCampo, val=b.dataset.dqVal;
    if(confirm(`¿Vaciar el ${campo} "${val}" en ${ids.length} ficha(s)?\n\nNo se borra nada más: la empresa, el correo y las notas se quedan igual. Mejor sin dato que con el de otra persona.`))
      limpiarCampoEn(ids, campo);
  });
  $('#set-brand-save').onclick=()=>{state.brand=$('#set-brand').value.trim()||'Insitum Capital';state.reportarA=$('#set-reportar').value.trim();save();render();toast('Guardado ✓');};
  $('#btn-new-industry').onclick=()=>openIndustry(null);
  $$('[data-ind-edit]').forEach(b=>b.onclick=()=>openIndustry(b.dataset.indEdit));
  $$('[data-ind-del]').forEach(b=>b.onclick=()=>{if(confirm('¿Eliminar "'+b.dataset.indDel+'"?')){state.industries=state.industries.filter(i=>i.name!==b.dataset.indDel);save();render();}});
  $('#set-export').onclick=exportJSON; $('#set-import').onclick=()=>$('#file-import').click(); $('#set-csv').onclick=exportCSV;
  { const b=$('#set-base-file'); if(b) b.onclick=()=>$('#file-base').click(); }
  $('#set-tel').onclick=normalizarTelefonos;
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
function openProspect(id,prefill){
  const f=$('#form-prospect');f.reset();fillSelect($('#sel-segmento'),segNames());fillSelect($('#sel-etapa'),STAGES);
  const p=id?state.prospects.find(x=>x.id===id):null;
  $('#modal-prospect-title').textContent=p?'Editar cliente':'Nuevo cliente';
  $('#chips-productos').innerHTML=state.products.map(pr=>`<span class="chip ${p&&(p.productos||[]).includes(pr.id)?'on':''}" data-prod="${pr.id}">${esc(shortName(pr.nombre))}</span>`).join('');
  $$('#chips-productos .chip').forEach(c=>c.onclick=()=>c.classList.toggle('on'));
  if(p){for(const k in p)if(f.elements[k]&&typeof p[k]!=='object')f.elements[k].value=p[k]??'';}else f.elements.fechaProxima.value=todayISO();
  // Prellenado desde el escaner de tarjetas (solo cliente nuevo): rellena lo que venga, respeta lo que ya haya.
  if(prefill){ for(const k in prefill){ if(f.elements[k]&&prefill[k]!=null&&prefill[k]!=='') f.elements[k].value=prefill[k]; } }
  updateRevenuePreview();$('#modal-prospect').classList.remove('hidden');
}

/* ---------- ESCANER DE TARJETAS (camara + IA) -------------------------------
   La foto va a NUESTRA funcion serverless (que guarda la llave de la IA en
   secreto), la IA lee la tarjeta y devuelve los campos. La foto no se guarda.
   Solo funciona en el sitio publicado (Netlify), no en localhost. --------- */
// Reduce la imagen antes de subirla: mas rapido y mas barato en tokens.
function fileToScaledBase64(file,maxPx){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file), img=new Image();
    img.onload=()=>{
      URL.revokeObjectURL(url);
      let w=img.naturalWidth||img.width, h=img.naturalHeight||img.height;
      const s=Math.min(1,maxPx/Math.max(w,h)); w=Math.round(w*s); h=Math.round(h*s);
      const c=document.createElement('canvas'); c.width=w; c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      const durl=c.toDataURL('image/jpeg',0.85);
      resolve({b64:durl.split(',')[1],mime:'image/jpeg'});
    };
    img.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error('imagen invalida')); };
    img.src=url;
  });
}
// Escanea UNA imagen; devuelve arreglo de tarjetas (0, 1 o varias) o lanza {code}.
async function scanOneImage(file){
  // 2576px = maximo de alta resolucion que aprovechan los modelos actuales.
  // Clave cuando hay VARIAS tarjetas en una foto: cada una conserva letra legible.
  const payload=await fileToScaledBase64(file,2576);
  const r=await fetch('/.netlify/functions/scan-card',{
    method:'POST',headers:{'content-type':'application/json'},
    // Se mandan las industrias del CRM para que la IA clasifique con esa lista.
    body:JSON.stringify({image:payload.b64,media_type:payload.mime,industrias:segNames()}),
  });
  if(r.status===404){ const e=new Error('404'); e.code='404'; throw e; }
  const data=await r.json().catch(()=>({error:'respuesta invalida'}));
  if(!r.ok||data.error){ const e=new Error(data.detail||data.error||('error '+r.status)); e.code=data.error; throw e; }
  return data.cards||[];
}
// Escanea 1 o varias fotos (cada una con 1 o varias tarjetas). Junta todo y enruta.
async function scanCards(files){
  files=Array.from(files||[]); if(!files.length) return;
  const all=[]; let errs=0;
  for(let i=0;i<files.length;i++){
    toast(files.length>1?`📸 Leyendo… foto ${i+1} de ${files.length}`:'📸 Leyendo la tarjeta…');
    try{ (await scanOneImage(files[i])).forEach(c=>all.push(c)); }
    catch(e){
      if(e.code==='404'){ toast('El escaner aun no esta publicado (o corres en localhost). Abre el sitio de Netlify.'); return; }
      if(e.code==='no_key'){ toast('Falta configurar la llave de la IA en Netlify (te paso los pasos).'); return; }
      errs++;
    }
  }
  if(!all.length){ toast(errs?('No se pudo leer ('+errs+' foto(s) con error)'):'No se detectaron tarjetas en las fotos'); return; }
  if(all.length===1){ openProspect(null,all[0]); toast('Tarjeta leida ✓ Revisa y guarda'+(errs?` · ${errs} con error`:'')); return; }
  openCardsReview(all,errs);
}
/* ---------- CAMARA EN VIVO (webcam de PC o camara del celular) --------------
   Requiere HTTPS (Netlify) o localhost. Permite tomar varias fotos seguidas
   sin salir de la app y luego escanearlas todas de un jalon. ---------------- */
let camStream=null, camShots=[];
async function openCamera(){
  camShots=[]; renderShots();
  $('#cam-error').classList.add('hidden');
  $('#modal-cam').classList.remove('hidden');
  try{
    // 'environment' pide la camara trasera en celular; en PC toma la webcam.
    camStream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});
    const v=$('#cam-video'); v.srcObject=camStream; try{ await v.play(); }catch(_){}
    $('#cam-live').classList.remove('hidden'); $('#cam-shoot').disabled=false;
  }catch(e){
    $('#cam-live').classList.add('hidden'); $('#cam-shoot').disabled=true;
    const m = e.name==='NotAllowedError' ? 'No diste permiso para usar la cámara. Dale permiso en el candado 🔒 de la barra de direcciones, o usa "📁 Subir fotos".'
            : e.name==='NotFoundError'   ? 'No se detectó ninguna cámara en este equipo. Usa "📁 Subir fotos".'
            : (location.protocol!=='https:'&&location.hostname!=='localhost') ? 'La cámara solo funciona en el sitio publicado (https). Usa "📁 Subir fotos".'
            : 'No se pudo abrir la cámara: '+(e.message||e.name);
    $('#cam-error').textContent=m; $('#cam-error').classList.remove('hidden');
  }
}
function stopCamera(){
  if(camStream){ camStream.getTracks().forEach(t=>t.stop()); camStream=null; }
  const v=$('#cam-video'); if(v)v.srcObject=null;
}
function shootCard(){
  const v=$('#cam-video');
  if(!v||!v.videoWidth){ toast('La cámara aún no está lista, espera un segundo'); return; }
  const c=document.createElement('canvas'); c.width=v.videoWidth; c.height=v.videoHeight;
  c.getContext('2d').drawImage(v,0,0,c.width,c.height);
  c.toBlob(b=>{ if(!b){ toast('No se pudo capturar'); return; } camShots.push(b); renderShots(); toast('Foto '+camShots.length+' tomada ✓'); },'image/jpeg',0.9);
}
function renderShots(){
  const w=$('#cam-shots'); if(!w) return;
  w.querySelectorAll('img').forEach(im=>{ try{ URL.revokeObjectURL(im.src); }catch(_){} });
  w.innerHTML=camShots.map((b,i)=>`<div class="shot"><img src="${URL.createObjectURL(b)}" alt="foto ${i+1}"><button class="shot-del" data-shot="${i}" title="Quitar">✕</button></div>`).join('');
  w.querySelectorAll('[data-shot]').forEach(b=>b.onclick=()=>{ camShots.splice(+b.dataset.shot,1); renderShots(); });
  const cc=$('#cam-count'); if(cc)cc.textContent=camShots.length?(camShots.length+' foto(s) lista(s)'):'Sin fotos aún';
  const cs=$('#cam-scan'); if(cs)cs.disabled=!camShots.length;
}
function scanShots(){
  if(!camShots.length){ toast('Toma al menos una foto'); return; }
  const shots=camShots.slice();
  stopCamera(); $('#modal-cam').classList.add('hidden');
  scanCards(shots);
}

// Lista de revision editable para carga masiva.
let cardsBatch=[];
function openCardsReview(cards,errs){
  cardsBatch=cards.map(c=>({empresa:c.empresa||'',contacto:c.contacto||'',puesto:c.puesto||'',telefono:c.telefono||'',email:c.email||'',segmento:c.segmento||'',notas:c.notas||''}));
  renderCardsReview();
  $('#cards-sub').textContent='Revisa y corrige lo que haga falta. Quita las que no quieras con 🗑. Luego "Guardar todas".'+(errs?` (${errs} foto(s) no se pudieron leer)`:'');
  $('#modal-cards').classList.remove('hidden');
}
function renderCardsReview(){
  const list=$('#cards-list');
  list.innerHTML=cardsBatch.length?cardsBatch.map((c,i)=>`
    <div class="card-row" data-i="${i}">
      <div class="card-row-head"><span class="card-row-n">${i+1}</span><button class="card-row-del" data-del="${i}" title="Quitar">🗑</button></div>
      <input data-f="empresa" placeholder="Empresa" value="${esc(c.empresa)}" />
      <input data-f="contacto" placeholder="Contacto" value="${esc(c.contacto)}" />
      <input data-f="telefono" placeholder="Teléfono" value="${esc(c.telefono)}" />
    </div>`).join(''):'<div class="empty">No quedan tarjetas.</div>';
  $('#cards-count').textContent=cardsBatch.length+' tarjeta(s)';
  list.querySelectorAll('.card-row').forEach(row=>{
    const i=+row.dataset.i;
    row.querySelectorAll('input[data-f]').forEach(inp=>{ inp.oninput=()=>{ cardsBatch[i][inp.dataset.f]=inp.value; }; });
  });
  list.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{ cardsBatch.splice(+b.dataset.del,1); renderCardsReview(); });
}
// Las tarjetas escaneadas NO entran a la cartera: van a la bandeja "Tarjetas".
// De ahi se revisan y se pasan a Clientes una por una (o todas).
function saveCardsBatch(){
  const valid=cardsBatch.filter(c=>c.empresa||c.contacto||c.telefono);
  if(!valid.length){ toast('No hay tarjetas para guardar'); return; }
  // La industria la decide la IA al leer la tarjeta. Si no la pudo deducir se
  // deja VACIA a proposito: mejor sin clasificar que mal clasificada.
  valid.forEach(c=>{ state.prospects.unshift({
    id:uid(), esTarjeta:true, empresa:c.empresa||c.contacto||'(sin nombre)', contacto:c.contacto||'',
    // El telefono entra ya a 10 digitos: las tarjetas viejas traen 044 impreso.
    puesto:c.puesto||'', telefono:telA10(c.telefono).tel, email:c.email||'', fuente:'Tarjeta', segmento:c.segmento||'',
    etapa:'Cliente nuevo', productos:[], notional:0, feeBps:25, probabilidad:10,
    proximaAccion:'Primer contacto', fechaProxima:'', notas:c.notas||'',
    creado:todayISO(), actualizado:todayISO(), actividades:[], stageHistory:[]
  }); });
  save(); closeModals(); ui.view='tarjetas'; render();
  toast(valid.length+' tarjeta(s) guardada(s) en Tarjetas ✓');
}

/* ---------- TARJETAS: misma tabla y mismo pipeline que Clientes ----------
   Reusa renderClientes/renderPipeline apuntando a su contenedor; scopeList()
   se encarga de que solo vean las marcadas con esTarjeta. */
function renderTarjetas(){
  const t=bandeja();
  const lista=ui.tjVista!=='pipeline';
  // Cuantas sobran por repetidas, para avisar en el propio boton.
  const dups=gruposDuplicados(t.filter(p=>p&&p.empresa)).reduce((a,g)=>a+g.length-1,0);
  $('#view-tarjetas').innerHTML=`
    <div class="tj-bar">
      <div class="seg-toggle">
        <button data-tjv="lista" class="${lista?'on':''}">☷ Lista</button>
        <button data-tjv="pipeline" class="${lista?'':'on'}">▤ Pipeline</button>
      </div>
      <div class="tj-bar-acts">
        <span class="muted">${t.length} tarjeta(s) · aparte de tu cartera</span>
        ${t.length?`<button class="ghost-btn btn-sm" id="tj-seg">🏷️ Clasificar industrias</button>`:''}
        ${t.length?`<button class="ghost-btn btn-sm" id="tj-dup">🔀 Depurar repetidas${dups?` (${dups})`:''}</button>`:''}
        ${t.length?`<button class="primary-btn btn-sm" id="tj-all">✓ Pasar todas a Clientes</button>`:''}
      </div>
    </div>
    <div id="tj-body"></div>`;
  $$('#view-tarjetas [data-tjv]').forEach(b=>b.onclick=()=>{ ui.tjVista=b.dataset.tjv; render(); });
  { const a=$('#tj-all'); if(a)a.onclick=()=>{ if(confirm(`¿Pasar las ${t.length} tarjetas a Clientes?\n\nDejarán la sección Tarjetas y entrarán a tu cartera (pipeline, Mi Día y métricas).`)) pasarTarjetas(t.map(p=>p.id)); }; }
  { const s=$('#tj-seg'); if(s)s.onclick=()=>clasificarIndustrias(t); }
  { const d=$('#tj-dup'); if(d)d.onclick=()=>depurarDuplicados(t); }
  if(!t.length){ $('#tj-body').innerHTML=`<div class="panel">${empty('Aún no hay tarjetas escaneadas. Usa 📸 Escanear tarjeta, arriba.')}</div>`; return; }
  if(lista) renderClientes('#view-tarjetas #tj-body'); else renderPipeline('#view-tarjetas #tj-body');
}
// Corrige la industria de tarjetas ya guardadas: manda nombre + notas a la IA
// y aplica lo que devuelva. No toca ningun otro dato.
const normEmp=s=>(s||'').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');
async function clasificarIndustrias(lista){
  const items=(lista||[]).filter(p=>p&&p.empresa);
  if(!items.length){ toast('No hay tarjetas que clasificar'); return; }
  const validas=segNames();
  // Empresas UNICAS (varias tarjetas de la misma empresa comparten industria)
  const unicas=[...new Map(items.map(p=>[normEmp(p.empresa),{empresa:p.empresa,notas:(p.notas||'').slice(0,140)}])).values()];
  // Va por tandas. NO es todo-o-nada: una tanda que truene se cuenta y se sigue
  // con las demas. (Antes cualquier fallo hacia return y tiraba lo ya clasificado;
  // con 274 empresas son 19 tandas, asi que un solo tropiezo borraba todo el
  // trabajo y parecia que el boton no hacia nada.)
  const TANDA=15, mapa=new Map();
  let fallidas=0, seguidos=0, corte='';
  for(let i=0;i<unicas.length;i+=TANDA){
    const lote=unicas.slice(i,i+TANDA);
    toast(`🏷️ Clasificando… ${Math.min(i+TANDA,unicas.length)} de ${unicas.length}`);
    try{
      const r=await fetch('/.netlify/functions/scan-card',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({clasificar:lote,industrias:validas}),
      });
      if(r.status===404){ corte='Esto solo funciona en el sitio publicado, no en localhost.'; break; }
      const d=await r.json().catch(()=>({error:'json'}));
      if(!r.ok||d.error){
        if(d.error==='no_key'){ corte='Falta la llave de la IA en Netlify.'; break; }
        fallidas+=lote.length;
        // Si truena 3 veces seguidas es un problema de fondo (sin saldo, API caida):
        // no tiene caso quemar las tandas restantes una por una.
        if(++seguidos>=3){ corte='Se detuvo: '+(d.detail||d.error); break; }
        continue;
      }
      seguidos=0;
      // Emparejar por NOMBRE, no por posicion: si el modelo omite alguna,
      // las demas no se descuadran (ese era el bug).
      (d.items||[]).forEach(it=>{ if(it&&validas.includes(it.segmento)) mapa.set(normEmp(it.empresa),it.segmento); });
    }
    catch(e){ fallidas+=lote.length; if(++seguidos>=3){ corte='Se detuvo: '+e.message; break; } }
  }
  let n=0, sin=0;
  items.forEach(p=>{ const s=mapa.get(normEmp(p.empresa));
    if(s){ if(s!==p.segmento){ p.segmento=s; p.actualizado=todayISO(); n++; } } else sin++; });
  if(n) save();
  render();
  // Se reporta TODO: lo aplicado, lo que la IA dejo en blanco a proposito
  // (no pudo deducir el giro) y lo que ni se pudo consultar.
  const partes=[];
  if(n) partes.push(`${n} industria(s) corregida(s) ✓`);
  if(sin) partes.push(`${sin} sin clasificar`);
  if(fallidas) partes.push(`${fallidas} no se pudieron consultar`);
  toast(corte ? corte+(n?` · aun asi se aplicaron ${n}`:'')
              : (partes.join(' · ')||'No hubo cambios que aplicar'));
}

// Pasa tarjetas a la cartera: solo les quita la marca (conservan ficha,
// actividades, etapa e historial — no se recrea nada).
function pasarTarjetas(ids){
  const set=new Set(ids); let n=0;
  (state.prospects||[]).forEach(p=>{ if(set.has(p.id)&&p.esTarjeta){ delete p.esTarjeta; p.actualizado=todayISO(); n++; } });
  if(!n) return;
  save(); render();
  toast(n+' pasada(s) a Clientes ✓');
}
/* ---------- Tarjetas repetidas ----------
   Escanear dos veces la misma tarjeta (o dos fotos donde sale la misma) deja
   registros duplicados. Se agrupan por empresa+contacto normalizados y tambien
   por telefono o correo iguales — asi cae la misma persona aunque el OCR haya
   leido el nombre distinto. OJO: empresa igual con contacto DISTINTO no es
   duplicado (son dos personas de la misma empresa).
   No se borra a ciegas: se funde el grupo en el registro mas completo. */
const normTel=s=>(s||'').toString().replace(/\D/g,'').slice(-10);

/* ---------- Telefonos a 10 digitos ----------
   Desde agosto de 2019 en Mexico se marca a 10 digitos: los prefijos 044 (celular
   local), 045 (celular larga distancia) y 01 (larga distancia) YA NO EXISTEN — un
   numero guardado con 044 sencillamente no marca. Tambien sobran el +52 y el "1"
   de movil que iba despues del 52 (52 1 55 …).
   Dos cosas que NO se tocan: los numeros de otro pais (escritos con + y lada
   distinta de 52) y los que no se pueden interpretar; mejor dejarlos como estan
   que inventarles una lada. La extension se conserva aparte. */
const RE_EXT=/\s*(?:ext|extension|extensión|x)\.?\s*:?\s*(\d{1,6})\s*$/i;
function telA10(valor, asumirCDMX){
  const s=(valor||'').toString().trim();
  if(!s) return {tel:'', estado:'vacío'};
  let ext='';
  const base=s.replace(RE_EXT,(m,g)=>{ ext=g; return ''; }).trim();
  let d=base.replace(/\D/g,'');
  // De otro pais solo si trae + Y no empieza con lada 52 ni con un prefijo viejo
  // mexicano: en la base hay un "+(044) 55 …" que es de aqui, mal escrito.
  if(/^\+/.test(base) && !d.startsWith('52') && !/^(044|045|01)/.test(d))
    return {tel:s, estado:'otro país'};
  if(d.startsWith('00')) d=d.slice(2);
  let mx=false;
  if(d.length>10 && d.startsWith('52')){ d=d.slice(2); mx=true; }
  if(mx && d.length===11 && d.startsWith('1')) d=d.slice(1);
  while(d.length>10){
    if(d.startsWith('044')||d.startsWith('045')) d=d.slice(3);
    else if(d.length===12 && d.startsWith('01')) d=d.slice(2);
    else break;
  }
  // Numeros de 8 digitos: formato viejo del DF, cuando se marcaba sin lada.
  // Solo se completan si quien llama lo pide explicitamente — no todos son CDMX.
  if(asumirCDMX && d.length===8) d='55'+d;
  if(d.length!==10) return {tel:s, estado:'revisar'};
  // Presentacion mexicana: lada de 2 digitos (55/33/81) va 2-4-4; las demas 3-3-4.
  const dos=/^(55|33|81)/.test(d);
  const fmt=dos ? d.slice(0,2)+' '+d.slice(2,6)+' '+d.slice(6)
                : d.slice(0,3)+' '+d.slice(3,6)+' '+d.slice(6);
  const out=fmt+(ext?' Ext. '+ext:'');
  return {tel:out, estado: out===s ? 'ya estaba' : 'corregido'};
}
// Pasa TODOS los contactos (cartera y tarjetas) a 10 digitos.
function normalizarTelefonos(){
  const todos=(state.prospects||[]);
  const cuenta={corregido:0,'ya estaba':0,'otro país':0,'revisar':0};
  const dudosos=[];
  todos.forEach(p=>{
    if(!(p.telefono||'').toString().trim()) return;
    const r=telA10(p.telefono);
    cuenta[r.estado]=(cuenta[r.estado]||0)+1;
    if(r.estado==='revisar') dudosos.push(p.empresa+': '+p.telefono);
  });
  if(!cuenta.corregido){ toast('Todos los teléfonos ya están a 10 dígitos ✓'); return; }
  const muestra=dudosos.slice(0,8).map(x=>'• '+x).join('\n');
  if(!confirm(`Se van a dejar a 10 dígitos ${cuenta.corregido} teléfono(s), quitando 044, 045, 01 y +52.\n\n`
    +`Ya estaban bien: ${cuenta['ya estaba']}\n`
    +`De otro país (no se tocan): ${cuenta['otro país']}\n`
    +`No se pudieron interpretar (se dejan igual): ${cuenta.revisar}`
    +(dudosos.length?`\n\n${muestra}${dudosos.length>8?'\n… y '+(dudosos.length-8)+' más':''}`:'')
    +`\n\n¿Aplicar?`)) return;
  let n=0;
  todos.forEach(p=>{
    const t=(p.telefono||'').toString().trim(); if(!t) return;
    const r=telA10(t);
    if(r.estado==='corregido'){ p.telefono=r.tel; p.actualizado=todayISO(); n++; }
  });
  // Segunda pasada, aparte y solo si ella lo autoriza: los de 8 digitos son del
  // formato viejo del DF. Casi todos son CDMX, pero un 8 digitos de Guadalajara
  // o Monterrey se veria igual — por eso NO se asume, se pregunta.
  const ocho=todos.filter(p=>((p.telefono||'').toString().replace(/\D/g,'').length===8));
  if(ocho.length){
    const ej=ocho.slice(0,6).map(p=>'• '+(p.empresa||'?')+': '+p.telefono).join('\n');
    if(confirm(`Quedan ${ocho.length} teléfono(s) de 8 dígitos, del formato viejo del DF `
      +`(antes se marcaba sin lada).\n\n${ej}${ocho.length>6?'\n… y '+(ocho.length-6)+' más':''}\n\n`
      +`¿Les pongo la lada 55 de CDMX?\n`
      +`OJO: si alguno es de Guadalajara o Monterrey quedaría mal y habría que corregirlo a mano.`)){
      ocho.forEach(p=>{ const r=telA10(p.telefono,true);
        if(r.estado==='corregido'){ p.telefono=r.tel; p.actualizado=todayISO(); n++; } });
    }
  }
  save(); render();
  toast(n+' teléfono(s) a 10 dígitos ✓');
}
const normMail=s=>(s||'').toString().trim().toLowerCase();
// Que tan lleno esta un registro; decide cual sobrevive a la fusion.
function completitud(p){
  let n=0;
  ['empresa','contacto','puesto','telefono','email','segmento','notas']
    .forEach(k=>{ if((p[k]||'').toString().trim()) n++; });
  return n+Math.min(5,(p.actividades||[]).length);
}
function gruposDuplicados(lista){
  const padre=new Map();
  lista.forEach(p=>padre.set(p.id,p.id));
  const raiz=x=>{ while(padre.get(x)!==x) x=padre.get(x); return x; };
  const une=(a,b)=>{ const ra=raiz(a), rb=raiz(b); if(ra!==rb) padre.set(ra,rb); };
  const vistas=new Map();
  // Solo se marca con claves NO vacias: si no, todas las tarjetas sin telefono
  // acabarian unidas entre si.
  const marca=(k,id)=>{ if(vistas.has(k)) une(vistas.get(k),id); else vistas.set(k,id); };
  /* EL TELEFONO Y EL CORREO SOLO UNEN DENTRO DE LA MISMA EMPRESA.
     Antes bastaba con compartir telefono para fusionar dos fichas, aunque
     fueran empresas distintas. Con una base que arrastra conmutadores y
     telefonos de ejecutivos repetidos en decenas de empresas, eso encadenaba
     compañias que no tienen nada que ver: sobrevivia una y ABSORBIA el nombre
     del contacto de las otras. El sintoma es ver a una persona asignada a una
     empresa que no es la suya.

     Dos empresas distintas con el mismo conmutador son dos empresas distintas.
     Una fusion de mas borra datos y no se deshace; una fusion de menos solo
     deja una ficha repetida, que no le hace dano a nadie. Ante la duda, no se
     fusiona. */
  lista.forEach(p=>{
    const emp=normEmp(p.empresa);
    if(!emp) return;                                   // sin empresa no se agrupa
    marca('n:'+emp+'|'+normEmp(p.contacto), p.id);
    // 10 digitos exactos: un fragmento de 8 es ambiguo y agrupaba de mas.
    const tel=normTel(p.telefono); if(tel.length===10) marca('t:'+emp+'|'+tel, p.id);
    const mail=normMail(p.email);  if(mail)            marca('m:'+emp+'|'+mail, p.id);
  });
  const g=new Map();
  lista.forEach(p=>{ const r=raiz(p.id); if(!g.has(r))g.set(r,[]); g.get(r).push(p); });
  return [...g.values()].filter(x=>x.length>1);
}
// Funde un grupo en su registro mas completo y devuelve los ids a eliminar.
function fusionarGrupo(grupo){
  const orden=grupo.slice().sort((a,b)=>completitud(b)-completitud(a));
  const queda=orden[0];
  /* Cinturon de seguridad: si por lo que sea llegara aqui un grupo con dos
     nombres de empresa distintos, NO se fusiona. Perder el nombre de un
     contacto para pegarselo a otra compañia es el peor dano posible en esta
     base, y es irreversible. */
  const emps=new Set(grupo.map(p=>normEmp(p.empresa)).filter(Boolean));
  if(emps.size>1) return [];
  const ETIQ={telefono:'Tel',email:'Correo',puesto:'Puesto'};
  orden.slice(1).forEach(o=>{
    const extras=[];
    ['empresa','contacto','puesto','telefono','email','segmento'].forEach(k=>{
      const v=(o[k]||'').toString().trim(), hay=(queda[k]||'').toString().trim();
      if(!hay && v) queda[k]=v;
      // Si AMBAS traen dato y son distintos, el de la copia no se tira: se anota.
      // Pasa seguido con un segundo telefono o una extension (misma persona,
      // dos tarjetas) y perderlo seria justo el dato que sirve para llamar.
      else if(v && hay && v!==hay && ETIQ[k]) extras.push(ETIQ[k]+' alt.: '+v);
    });
    if(extras.length) queda.notas=((queda.notas||'').trim()+'\n'+extras.join(' · ')).trim();
    const nn=(o.notas||'').trim();
    if(nn && !(queda.notas||'').includes(nn)) queda.notas=((queda.notas||'').trim()+'\n'+nn).trim();
    queda.actividades=queda.actividades||[];
    (o.actividades||[]).forEach(a=>{ if(!queda.actividades.some(x=>x.id===a.id)) queda.actividades.push(a); });
    if(o.perfil&&!queda.perfil) queda.perfil=o.perfil;
    if(o.verif &&!queda.verif ) queda.verif =o.verif;
    if((Number(o.notional)||0)>(Number(queda.notional)||0)) queda.notional=o.notional;
    if(o.potencial==='alto') queda.potencial='alto';
  });
  queda.actualizado=todayISO();
  return orden.slice(1).map(p=>p.id);
}
function depurarDuplicados(lista){
  const grupos=gruposDuplicados((lista||[]).filter(p=>p&&p.empresa));
  if(!grupos.length){ toast('No hay tarjetas repetidas ✓'); return; }
  const sobran=grupos.reduce((a,g)=>a+g.length-1,0);
  const muestra=grupos.slice(0,12)
    .map(g=>'• '+g.map(p=>p.empresa+(p.contacto?' / '+p.contacto:'')).join('  ⟷  ')).join('\n');
  if(!confirm(`${grupos.length} grupo(s) repetido(s) · se quitarían ${sobran} tarjeta(s):\n\n${muestra}`
    +`${grupos.length>12?'\n… y '+(grupos.length-12)+' más':''}`
    +`\n\nSe queda la más completa de cada grupo y se le copian los datos, notas y actividades de las otras. ¿Depurar?`)) return;
  const quitar=new Set();
  grupos.forEach(g=>fusionarGrupo(g).forEach(id=>quitar.add(id)));
  const n=borrarProspects([...quitar]);
  save(); render();
  toast(`${n} repetida(s) fusionada(s) ✓`);
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
function closeModals(){stopCamera();$$('.modal-overlay').forEach(m=>m.classList.add('hidden'));}

/* ---------- FILTROS / GLOBAL / DATOS ---------- */
/* Misma coincidencia que usa la tabla: empresa, contacto y correo. Se saca
   aparte para que Mancuerna y Leads busquen EXACTAMENTE igual que Clientes. */
function coincideBusqueda(p,q){
  if(!q) return true;
  return (String(p.empresa||'')+' '+String(p.contacto||'')+' '+String(p.email||'')+' '+String(p.telefono||''))
    .toLowerCase().includes(q);
}
/* Un filtro que no se ve es un filtro que confunde: se busca en una vista, se
   cambia a otra y los numeros salen "mal" sin motivo aparente. Este aviso lo
   hace visible y lo deja quitar de un clic. */
function avisoBusqueda(){
  const q=(ui.search||'').trim();
  if(!q) return '';
  return `<div class="busq-aviso">🔎 Filtrando por <b>${esc(q)}</b>
    <button class="btn-sm" data-limpiar-busq>✕ Quitar</button></div>`;
}
function bindLimpiarBusqueda(){
  $$('[data-limpiar-busq]').forEach(b=>b.onclick=()=>{
    ui.search=''; const c=$('#global-search'); if(c)c.value=''; render();
  });
}
function filtered(){let arr=scopeList();const q=(ui.search||'').toLowerCase().trim();if(q)arr=arr.filter(p=>coincideBusqueda(p,q));if(ui.filtroSeg)arr=arr.filter(p=>p.segmento===ui.filtroSeg);if(ui.filtroProd)arr=arr.filter(p=>(p.productos||[]).includes(ui.filtroProd));if(ui.filtroEtapa)arr=arr.filter(p=>p.etapa===ui.filtroEtapa);if(ui.filtroLinea)arr=arr.filter(p=>accionVigente(p).linea===ui.filtroLinea);if(ui.filtroRango)arr=arr.filter(p=>accionVigente(p).rango===ui.filtroRango);
  if(ui.filtroDatos==='con')arr=arr.filter(p=>compScore(p)>0);else if(ui.filtroDatos==='sin')arr=arr.filter(p=>compScore(p)===0);else if(ui.filtroDatos==='email')arr=arr.filter(p=>p.email);else if(ui.filtroDatos==='tel')arr=arr.filter(p=>p.telefono);else if(ui.filtroDatos==='potencial')arr=arr.filter(p=>p.potencial==='alto');
  else if(ui.filtroDatos==='score')arr=arr.filter(p=>scoreCierre(p)>0).sort((a,b)=>(scoreCierre(b)-scoreCierre(a))||porNombre(a,b));
  else if(ui.filtroDatos==='operaba')arr=arr.filter(p=>operabaScore(p)>0).sort((a,b)=>operabaScore(b)-operabaScore(a));
  // Cola de llamadas: los que faltan por verificar, con teléfono primero y los
  // mejores (ya operaron coberturas) arriba.
  else if(ui.filtroDatos==='porverif')arr=arr.filter(p=>{const e=verifEstado(p);return e==='pendiente'||e==='caduco';})
    .sort((a,b)=>(operabaScore(b)-operabaScore(a))||((b.telefono?1:0)-(a.telefono?1:0))||((b.potencial==='alto')-(a.potencial==='alto')));
  else if(ui.filtroDatos==='verificados')arr=arr.filter(p=>['ok','cambio'].includes(verifEstado(p)));
  return arr;}
function empty(msg){return `<div class="empty">${msg}</div>`;}
function bindRowClicks(){$$('[data-client]').forEach(el=>el.onclick=e=>{if(e.target.closest('[data-sched]'))return;openClient(el.dataset.client);});}

function bindGlobal(){
  $$('.nav-btn').forEach(b=>b.onclick=()=>{ui.view=b.dataset.view;render();});
  $('#btn-new-prospect').onclick=()=>openProspect(null);
  // Escaner: el boton abre la CAMARA en vivo; dentro hay opcion de subir fotos.
  { const sc=$('#btn-scan-card'), cf=$('#card-file'); if(sc&&cf){
      sc.onclick=openCamera;
      cf.onchange=e=>{ const files=Array.from(e.target.files); e.target.value=''; stopCamera(); closeModals(); scanCards(files); };
  } }
  { const b=$('#cam-shoot');  if(b)b.onclick=shootCard; }
  { const b=$('#cam-scan');   if(b)b.onclick=scanShots; }
  { const b=$('#cam-upload'); if(b)b.onclick=()=>$('#card-file').click(); }
  { const cs=$('#cards-save'); if(cs)cs.onclick=saveCardsBatch; }
  /* BUSCADOR GLOBAL. Antes solo repintaba en Clientes y Pipeline: en Mancuerna,
     Tarjetas o Leads se escribia y no pasaba NADA, o sea que se veia averiado.
     Peor: el texto si se guardaba, asi que al cambiar de vista aparecia todo
     filtrado por algo que ya se te habia olvidado que escribiste.
     Ahora busca en todas las vistas que muestran gente, y se repinta con un
     respiro de 160 ms para que teclear sobre 2,144 fichas no se sienta pesado. */
  {
    const conBusqueda=['clientes','pipeline','tarjetas','mancuerna','leads'];
    let t=null;
    $('#global-search').oninput=e=>{
      ui.search=e.target.value;
      clearTimeout(t);
      t=setTimeout(()=>{
        /* Si la vista de enfrente no muestra gente —Mi Día, que es donde se
           aterriza, pero también Resumen, Cotizador, Productos…— el buscador
           tiene que LLEVAR a los resultados. Quedarse callado se siente
           exactamente igual que un campo deshabilitado, que fue justo lo que
           se reporto: "el buscador sigue inhabilitado". Un buscador global que
           no responde desde la pantalla de inicio no sirve de nada. */
        if(ui.search.trim() && !conBusqueda.includes(ui.view)) ui.view='clientes';
        render();
        // render() no toca la barra de arriba, asi que el cursor se queda donde
        // estaba; esto es solo por si algo mas robo el foco.
        const c=$('#global-search'); if(c&&document.activeElement!==c) c.focus();
      },160);
    };
  }
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
  { const fb=$('#file-base'); if(fb) fb.onchange=cargarBaseArchivo; }
  window.addEventListener('beforeunload',flushSave);
}
function exportJSON(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`insitum-crm-${ME.email}-${todayISO()}.json`;a.click();toast('Respaldo descargado ✓');}
function importJSON(e){const file=e.target.files[0];if(!file)return;const r=new FileReader();r.onload=()=>{try{const s=JSON.parse(r.result);if(!s.prospects)throw 0;state=migrate(s);save();render();toast('Datos restaurados ✓');}catch(err){toast('Archivo inválido');}};r.readAsText(file);e.target.value='';}
function exportCSV(){const cols=['empresa','contacto','puesto','telefono','email','segmento','linea','rango','instrumento','esTarjeta','etapa','productos','notional','feeBps','ingresoEst','probabilidad','proximaAccion','fechaProxima'];const rows=state.prospects.map(p=>cols.map(c=>{const a=accionVigente(p);let v=c==='ingresoEst'?revenueOf(p):c==='productos'?(p.productos||[]).map(prodName).join('; '):c==='linea'?a.L.label:c==='rango'?a.rango:c==='instrumento'?a.instrumento:c==='esTarjeta'?(p.esTarjeta?'sí':'no'):p[c];v=(v==null?'':String(v)).replace(/"/g,'""');return `"${v}"`;}).join(','));const csv='﻿'+cols.join(',')+'\n'+rows.join('\n');const blob=new Blob([csv],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`clientes-${todayISO()}.csv`;a.click();toast('CSV exportado ✓');}

/* ---------- DATOS POR DEFECTO ---------- */
function defaultIndustries(){return [
  {name:'Importador/Exportador',linea:'fx',vars:['usdmxn','eurusd','banxico'],tip:'Descalce entre pagos y cobros en divisa: cubrir el neto, no cada operación.'},
  {name:'Manufactura/Automotriz',linea:'fx',vars:['usdmxn','cobre','aluminio','brent'],tip:'Doble exposición: insumos metálicos y tipo de cambio. Conviene cubrirlas juntas.'},
  {name:'Aerolínea/Transporte',linea:'commod',vars:['brent','wti','usdmxn'],tip:'La turbosina y el diésel definen el costo por vuelo o por ruta: es la partida a fijar.'},
  {name:'Agroindustria',linea:'commod',vars:['maiz','trigo','soya','cafe','azucar','usdmxn'],tip:'Granos y blandos son estacionales: fijar precio de cosecha o de insumo asegura el margen.'},
  {name:'Energía/Combustibles',linea:'commod',vars:['brent','wti','gasnat','usdmxn'],tip:'Margen de refinación y comercialización: techo al crudo y piso al producto.'},
  {name:'Minería/Metales',linea:'commod',vars:['oro','cobre','aluminio','usdmxn'],tip:'Cobertura de producción: asegurar el precio de venta del volumen ya comprometido.'},
  {name:'Retail/Comercio',linea:'fx',vars:['usdmxn','eurusd','banxico'],tip:'Importaciones de temporada: cubrir el pedido cuando se pone la orden, no cuando se paga.'},
  {name:'Fintech/Remesas',linea:'fx',vars:['usdmxn','eurusd'],tip:'Volumen FX recurrente y descalce intradía: cobertura rodante del libro.'},
  {name:'Servicios/Tecnología',linea:'fx',vars:['usdmxn','eurusd','banxico'],tip:'Licencias y nube en USD contra ingresos en pesos: contratos anuales, cobertura anual.'},
  {name:'Salud/Farma',linea:'fx',vars:['usdmxn','eurusd','banxico'],tip:'Insumos y equipo importado con precios de lista en divisa: fijar el costo del ejercicio.'},
  {name:'Family Office/Patrimonio',linea:'tasas',vars:['banxico','cetes','ust10','sp500','oro'],tip:'Duración y reinversión: qué pasa con el portafolio cuando la tasa baja.'},
  {name:'Construcción/Inmobiliaria',linea:'tasas',vars:['usdmxn','cobre','banxico'],tip:'Deuda a tasa variable durante la obra: fijarla vuelve predecible el costo del proyecto.'},
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

/* ---------- Aviso de version nueva ----------
   Cuando publicamos una actualizacion, una pestana que YA estaba abierta (o la app
   instalada en el celular) sigue corriendo el codigo viejo hasta que se recarga.
   Sintoma tipico: "le doy clic al boton nuevo y no pasa nada".
   Aqui se compara el sello (ETag) del app.js publicado contra el que se cargo;
   si cambio, sale una barra abajo para actualizar de un clic. */
let selloCargado=null;
async function selloPublicado(){
  try{
    const r=await fetch('assets/app.js',{method:'HEAD',cache:'no-store'});
    return r.headers.get('etag')||r.headers.get('last-modified')||null;
  }catch(e){ return null; }        // sin internet: no molestar
}
async function revisarVersion(){
  const s=await selloPublicado();
  if(!s) return;
  if(!selloCargado){ selloCargado=s; return; }   // primera lectura = referencia
  if(s!==selloCargado) avisoVersion();
}
function avisoVersion(){
  if($('#aviso-version')) return;
  const d=document.createElement('div');
  d.id='aviso-version';
  d.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#1b1f3d;color:#fff;'
    +'padding:12px 16px;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;'
    +'font-size:14px;box-shadow:0 -6px 20px rgba(0,0,0,.18)';
  d.innerHTML='<span>Hay una versión nueva de la app.</span>'
    +'<button id="av-si" style="background:#ea0073;color:#fff;border:0;border-radius:8px;padding:8px 16px;font-weight:600;cursor:pointer">Actualizar</button>'
    +'<button id="av-no" style="background:transparent;color:#cbd5e1;border:0;padding:8px;cursor:pointer">Ahora no</button>';
  document.body.appendChild(d);
  $('#av-si').onclick=()=>location.reload();
  // "Ahora no": se borra la referencia para no insistir con este mismo cambio;
  // la siguiente lectura la vuelve a fijar y solo avisa cuando haya OTRA version.
  $('#av-no').onclick=()=>{ selloCargado=null; d.remove(); };
}

/* ---------- Arranque ---------- */
function init(){
  bindGlobal();
  revisarVersion();
  setInterval(revisarVersion,10*60*1000);
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) revisarVersion(); });
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
