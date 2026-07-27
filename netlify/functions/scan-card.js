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

const CARD = {
  type: 'object',
  properties: {
    empresa:  { type: 'string' },
    contacto: { type: 'string' },
    puesto:   { type: 'string' },
    telefono: { type: 'string' },
    email:    { type: 'string' },
    notas:    { type: 'string' },
  },
  required: ['empresa', 'contacto', 'puesto', 'telefono', 'email', 'notas'],
  additionalProperties: false,
};
const SCHEMA = {
  type: 'object',
  properties: { cards: { type: 'array', items: CARD } },
  required: ['cards'],
  additionalProperties: false,
};

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
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: media, data: image } },
            { type: 'text', text: PROMPT },
          ],
        }],
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
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
      notas:    c.notas    || '',
    })).filter(c => c.empresa || c.contacto || c.telefono || c.email);

    return reply(200, { cards });
  } catch (e) {
    return reply(502, { error: 'fetch', detail: String((e && e.message) || e) });
  }
};
