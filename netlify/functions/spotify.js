/**
 * ============================================================================
 * NETLIFY FUNCTION — PROXY DE LA SPOTIFY WEB API
 * ============================================================================
 * Qué hace:
 *   Guarda la clave secreta de Spotify en el servidor (nunca llega al navegador)
 *   y expone solo unos pocos endpoints permitidos de la API de Spotify.
 *
 * Cómo activarla (una sola vez, en Netlify):
 *   1. Creá una app en https://developer.spotify.com/dashboard
 *   2. En "Redirect URIs" poné el dominio de tu sitio (no hace falta para
 *      este flujo, pero Spotify lo pide: ej. https://tu-sitio.netlify.app)
 *   3. Copiá el Client ID y el Client Secret
 *   4. En Netlify → Site configuration → Environment variables:
 *        SPOTIFY_CLIENT_ID     = ...
 *        SPOTIFY_CLIENT_SECRET = ...
 *   5. ¡Listo! El buscador detecta la función y usa Spotify automáticamente.
 *
 * Si las variables no están, la función responde 503 y el buscador usa el
 * fallback gratuito (iTunes + Wikipedia + MusicBrainz) sin romperse.
 *
 * Flujo: client_credentials (no requiere que el usuario inicie sesión).
 * ============================================================================
 */

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1/';

// Token en memoria: Spotify lo vence a los 60 minutos.
let cacheToken = { valor: null, vence: 0 };

/** Obtiene (y cachea) el access token de Spotify. */
async function obtenerToken() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) return null;
  if (cacheToken.valor && Date.now() < cacheToken.vence) return cacheToken.valor;

  const respuesta = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:
        'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });

  if (!respuesta.ok) return null;

  const datos = await respuesta.json();
  cacheToken = {
    valor: datos.access_token,
    vence: Date.now() + (datos.expires_in - 60) * 1000, // margen de seguridad
  };
  return cacheToken.valor;
}

function cabecerasCors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}

/**
 * Convierte los parámetros de la petición en una URL de Spotify.
 * Whitelist: solo se permiten estos endpoints (evita usar el proxy para
 * llamar a cualquier cosa).
 */
function armarUrl(params) {
  const endpoint = String(params.endpoint || '');
  const id = String(params.id || '');
  const q = String(params.q || '');
  const mercado = 'AR';

  if (endpoint === 'search') {
    if (!q) return null;
    return `${API_BASE}search?type=artist&limit=6&market=${mercado}&q=${encodeURIComponent(q)}`;
  }

  // IDs de Spotify: 22 caracteres base62
  if (!/^[A-Za-z0-9]{22}$/.test(id)) return null;

  switch (endpoint) {
    case 'artist':
      return `${API_BASE}artists/${id}`;
    case 'top':
      return `${API_BASE}artists/${id}/top-tracks?market=${mercado}`;
    case 'albums':
      return `${API_BASE}artists/${id}/albums?include_groups=album,single&limit=30&market=${mercado}`;
    case 'related':
      return `${API_BASE}artists/${id}/related-artists?limit=8`;
    default:
      return null;
  }
}

exports.handler = async (event) => {
  const cabeceras = cabecerasCors();

  // Preflight del navegador
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cabeceras, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { ...cabeceras, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'method_not_allowed' }),
    };
  }

  const token = await obtenerToken();
  if (!token) {
    // Sin credenciales configuradas → el frontend usa el fallback abierto.
    return {
      statusCode: 503,
      headers: { ...cabeceras, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'spotify_not_configured' }),
    };
  }

  const url = armarUrl(event.queryStringParameters || {});
  if (!url) {
    return {
      statusCode: 400,
      headers: { ...cabeceras, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'bad_endpoint' }),
    };
  }

  try {
    const upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cuerpo = await upstream.text();

    return {
      statusCode: upstream.status,
      headers: {
        ...cabeceras,
        'Content-Type': 'application/json',
        // Cache corto en el CDN: aguanta el rate limit de Spotify
        'Cache-Control': 'public, max-age=300',
      },
      body: cuerpo,
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: { ...cabeceras, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'upstream_error' }),
    };
  }
};
