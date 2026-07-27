// Escaner de tarjetas de presentacion — lee una foto con Claude y devuelve los campos.
// La llave de la IA vive SOLO aqui (variable de entorno ANTHROPIC_API_KEY en Netlify),
// nunca en el navegador. La imagen se procesa y se descarta; no se almacena.
//
// Modelo: claude-opus-4-8 (mejor OCR, sobre todo con varias tarjetas por foto,
// letra chica, angulos y reflejos). ~4 centavos de dolar por foto.
// Para abaratar a ~2 centavos con algo menos de precision: 'claude-sonnet-5'.

const MODEL = 'claude-opus-4-8';

const PROMPT = [
  'Esta imagen contiene UNA O VARIAS tarjetas de presentacion, posiblemente sobre una mesa.',
  'Examina la imagen COMPLETA con cuidado, de arriba a abajo y de izquierda a derecha.',
  'Las tarjetas pueden estar giradas, en angulo, ligeramente encimadas, con reflejos o sombras,',
  'y la letra puede ser pequena. Lee cada una aunque este inclinada o mal iluminada.',
  'Detecta TODAS las tarjetas visibles y extrae los datos de cada una por separado.',
  'Por cada tarjeta devuelve: empresa (razon social o nombre comercial), contacto (nombre completo de la persona),',
  'puesto (cargo), telefono (el principal con lada; si hay varios prefiere el movil),',
  'email, y notas (datos extra utiles: sitio web, direccion, segundo telefono, anotaciones a mano, etc.).',
  'Si un dato no aparece, dejalo como cadena vacia "". No inventes informacion.',
  'Es mejor devolver una tarjeta con datos parciales que omitirla.',
  'Solo devuelve una lista vacia si de plano no hay ninguna tarjeta en la imagen.',
].join(' ');

// El esquema se arma con las industrias reales del CRM para que el modelo
// elija de esa lista (o deje vacio si no puede saberlo con la tarjeta).
function cardSchema(industrias) {
  const seg = industrias && industrias.length
    ? { type: 'string', enum: industrias.concat(['']) }
    : { type: 'string' };
  return {
    type: 'object',
    properties: {
      empresa:  { type: 'string' },
      contacto: { type: 'string' },
      puesto:   { type: 'string' },
      telefono: { type: 'string' },
      email:    { type: 'string' },
      segmento: seg,
      notas:    { type: 'string' },
    },
    required: ['empresa', 'contacto', 'puesto', 'telefono', 'email', 'segmento', 'notas'],
    additionalProperties: false,
  };
}
const SCHEMA = (industrias) => ({
  type: 'object',
  properties: { cards: { type: 'array', items: cardSchema(industrias) } },
  required: ['cards'],
  additionalProperties: false,
});

// Instruccion de clasificacion, compartida por el escaneo y la reclasificacion.
function segRule(industrias) {
  return [
    'Ademas, clasifica cada empresa en UNA de estas industrias:',
    industrias.join(' | ') + '.',
    'Usa el giro real del negocio segun el nombre, el lema, el logo o los datos de la tarjeta',
    '(ej. una avicola o alimentos = Agroindustria; una financiera o casa de bolsa = Family Office/Patrimonio;',
    'una armadora o autopartes = Manufactura/Automotriz; una naviera o transportista = Aerolinea/Transporte).',
    'NO clasifiques todo como Importador/Exportador: usalo solo si la empresa se dedica claramente al comercio exterior.',
    'Si de verdad no puedes deducir el giro, deja segmento como cadena vacia "" — es preferible a adivinar mal.',
  ].join(' ');
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status, obj) => ({
  statusCode: status,
  headers: { ...CORS, 'content-type': 'application/json' },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'method' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return reply(200, { error: 'no_key' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return reply(400, { error: 'bad_json' }); }

  const industrias = Array.isArray(body.industrias) ? body.industrias.filter(Boolean) : [];

  // MODO 2 — reclasificar: llega una lista de empresas (texto), no una imagen.
  // Sirve para corregir industrias de tarjetas ya guardadas.
  if (Array.isArray(body.clasificar)) {
    if (!industrias.length) return reply(400, { error: 'no_industrias' });
    const lista = body.clasificar.slice(0, 60);
    const prompt = [
      'Para cada empresa de la lista, determina a que industria pertenece.',
      segRule(industrias),
      'Responde en el MISMO orden y con la MISMA cantidad de elementos que la lista.',
      '',
      'Lista:',
      lista.map((e, i) => `${i + 1}. ${e.empresa}${e.notas ? ' — ' + e.notas : ''}`).join('\n'),
    ].join('\n');
    const esquema = {
      type: 'object',
      properties: { segmentos: { type: 'array', items: { type: 'string', enum: industrias.concat(['']) } } },
      required: ['segmentos'], additionalProperties: false,
    };
    try {
      const rc = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL, max_tokens: 1500,
          messages: [{ role: 'user', content: prompt }],
          output_config: { format: { type: 'json_schema', schema: esquema } } }),
      });
      const dc = await rc.json();
      if (!rc.ok) return reply(502, { error: 'api', detail: (dc.error && dc.error.message) || ('http ' + rc.status) });
      let tc = (dc.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
      tc = tc.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
      const pc = JSON.parse(tc);
      return reply(200, { segmentos: pc.segmentos || [] });
    } catch (e) {
      return reply(502, { error: 'clasificar', detail: String((e && e.message) || e) });
    }
  }

  const image = body.image;
  const media = body.media_type || 'image/jpeg';
  if (!image) return reply(400, { error: 'no_image' });

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 900,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: media, data: image } },
            { type: 'text', text: PROMPT + (industrias.length ? ' ' + segRule(industrias) : '') },
          ],
        }],
        output_config: { format: { type: 'json_schema', schema: SCHEMA(industrias) } },
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      const detail = (data && data.error && data.error.message) || ('http ' + resp.status);
      return reply(502, { error: 'api', detail });
    }

    let txt = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    txt = txt.replace(/^```(?:json)?\s*/i, '').replace(/```$/,'').trim();
    let parsed;
    try { parsed = JSON.parse(txt); }
    catch (e) { return reply(502, { error: 'parse' }); }

    const cards = (parsed.cards || []).map(c => ({
      empresa:  c.empresa  || '',
      contacto: c.contacto || '',
      puesto:   c.puesto   || '',
      telefono: c.telefono || '',
      email:    c.email    || '',
      segmento: industrias.includes(c.segmento) ? c.segmento : '',
      notas:    c.notas    || '',
    })).filter(c => c.empresa || c.contacto || c.telefono || c.email);

    return reply(200, { cards });
  } catch (e) {
    return reply(502, { error: 'fetch', detail: String((e && e.message) || e) });
  }
};
