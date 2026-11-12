/**
 * ============================================================================
 * MUSIC-API — Capa de datos del buscador
 * ============================================================================
 * Fuentes reales (en orden de preferencia):
 *   1. SPOTIFY  → vía Netlify Function (/.netlify/functions/spotify)
 *                 Requiere SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET en Netlify.
 *   2. APPLE MUSIC (iTunes Search/Lookup) → sin clave, CORS abierto.
 *   3. WIKIPEDIA (REST) → biografía e imagen reales del artista.
 *   4. MUSICBRAINZ → país y años de actividad.
 *   5. DATOS LOCALES → solo si no hay conexión (modo sin conexión).
 *
 * Nunca inventa datos: si no hay resultados, devuelve null y la UI lo muestra.
 * ============================================================================
 */
window.MusicAPI = (function () {
  'use strict';

  const SPOTIFY_PROXY = '/.netlify/functions/spotify';

  // 'desconocido' → todavía no probamos | 'ok' → funciona | 'no' → usar fallback
  let spotifyEstado = 'desconocido';

  /* ==========================================================================
     UTILIDADES
     ========================================================================== */

  function normalizar(texto) {
    return String(texto || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /** 0 = nada que ver, 1 = mismo nombre */
  function similitud(a, b) {
    const na = normalizar(a);
    const nb = normalizar(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    if (na.includes(nb) || nb.includes(na)) return 0.9;
    const ta = na.split(' ');
    const tb = nb.split(' ');
    const comunes = ta.filter((t) => tb.includes(t)).length;
    return comunes / Math.min(ta.length, tb.length);
  }

  /** Devuelve el nombre más parecido al query, o null si no supera el umbral. */
  function mejorCoincidencia(query, nombres) {
    let mejor = null;
    let puntaje = 0;
    (nombres || []).forEach((n) => {
      const s = similitud(query, n);
      if (s > puntaje) {
        puntaje = s;
        mejor = n;
      }
    });
    return puntaje >= 0.55 ? mejor : null;
  }

  function fetchJSON(url, ms) {
    const limite = ms || 9000;
    const ctrl = new AbortController();
    const reloj = setTimeout(() => ctrl.abort(), limite);
    return fetch(url, { signal: ctrl.signal })
      .then((r) => {
        clearTimeout(reloj);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .catch((e) => {
        clearTimeout(reloj);
        throw e;
      });
  }

  /* ==========================================================================
     BASE LOCAL: sinónimos (para entender apodos) + datos sin conexión
     ========================================================================== */

  const ARTISTAS_LOCALES = [
    {
      nombre: 'Duki',
      alias: ['duki', 'mauro', 'mauro lombardo', 'goteo'],
      subtitulo: 'Referente del Trap Argentino',
      genero: 'Trap / Rap / Urbano',
      imagen: 'imgs/artist_duki.svg',
      origen: 'Almagro, Buenos Aires (1996)',
      trayectoria:
        'Surgido de las batallas de freestyle de "El Quinto Escalón" en el Parque Rivadavia. Pionero en profesionalizar el trap en el país con éxitos como "No Vendo Trap", "She Don\'t Give a FO" y "Goteo".',
    },
    {
      nombre: 'Charly García',
      alias: ['charly', 'charly garcia', 'garcia', 'sui generis', 'seru giran'],
      subtitulo: 'Padre y genio del Rock Nacional',
      genero: 'Rock Nacional / Pop Rock',
      imagen: 'imgs/charly_garcia.svg',
      origen: 'Caballito, Buenos Aires (1951)',
      trayectoria:
        'Fundador de Sui Generis, La Máquina de Hacer Pájaros y Serú Girán. Su carrera solista de los años 80 y 90 ("Yendo de la cama al living", "Clics modernos", "Piano bar") definió la poesía y la actitud de la música popular en habla hispana.',
    },
    {
      nombre: 'Mercedes Sosa',
      alias: ['mercedes', 'mercedes sosa', 'la negra', 'sosa'],
      subtitulo: 'La Voz de América Latina',
      genero: 'Folklore Argentino / Nueva Canción',
      imagen: 'imgs/mercedes_sosa.svg',
      origen: 'San Miguel de Tucumán (1935 - 2009)',
      trayectoria:
        'Máxima exponente del folklore argentino e insoslayable del Movimiento del Nuevo Cancionero. Intérprete de zambas, chacareras y poesía social de Yupanqui y Tejada Gómez. Cantó en el Lincoln Center, el Carnegie Hall y el Coliseo de Roma.',
    },
    {
      nombre: 'Carlos Gardel',
      alias: ['carlos gardel', 'gardel', 'el zorzal', 'el mago'],
      subtitulo: 'El Zorzal Criollo',
      genero: 'Tango / Canción Rioplatense',
      imagen: 'imgs/carlos_gardel.svg',
      origen: 'Toulouse (1890) - Abasto, Buenos Aires',
      trayectoria:
        'Creador del tango canción con "Mi noche triste" (1917). Cantor, compositor y estrella de cine junto al letrista Alfredo Le Pera. Símbolo de la identidad porteña y declarado Patrimonio Cultural de la Humanidad por la UNESCO.',
    },
    {
      nombre: 'Bizarrap',
      alias: ['bizarrap', 'bzrp', 'gonzalo conde', 'biza'],
      subtitulo: 'Productor global y fenómeno de sesiones',
      genero: 'Trap / Electrónica / Productor',
      imagen: 'imgs/artist_bizarrap.svg',
      origen: 'Ramos Mejía, Buenos Aires (1998)',
      trayectoria:
        'Comenzó remezclando batallas de freestyle y produjo sesiones que batieron récords en YouTube y Spotify (con Shakira, Quevedo, Duki y Nathy Peluso). Transformó la visibilidad del productor musical en la industria.',
    },
    {
      nombre: 'Milo J',
      alias: ['milo', 'milo j', 'camilo', 'camilo joaquin'],
      subtitulo: 'La revelación joven del Conurbano',
      genero: 'Rap / Bolero / Folklore Urbano',
      imagen: 'imgs/artist_miloj.svg',
      origen: 'Morón, Gran Buenos Aires (2006)',
      trayectoria:
        'Se dio a conocer con "Rara Vez" y el EP "En Dormir Sin Madrid" junto a Bizarrap. Su propuesta rescata instrumentos autóctonos y armonías rioplatenses dentro del rap actual.',
    },
    {
      nombre: 'La Joaqui',
      alias: ['la joaqui', 'joaqui', 'joaquinha'],
      subtitulo: 'Reina del RKT y empoderamiento urbano',
      genero: 'RKT / Cumbia 420 / Trap',
      imagen: 'imgs/artist_lajoaqui.svg',
      origen: 'Mar del Plata, Buenos Aires (1994)',
      trayectoria:
        'Primera mujer en clasificar a las semifinales de la Batalla de los Gallos de Red Bull Argentina. Impulsó el sonido RKT con éxitos como "Butakera" y "Dos Besitos".',
    },
    {
      nombre: 'MHTRESUNO',
      alias: ['mhtresuno', 'mh', 'tresuno'],
      subtitulo: 'El nuevo camino del RKT y Mombow',
      genero: 'Trap / RKT / Mombow',
      imagen: 'imgs/artist_mhtresuno.svg',
      origen: 'Buenos Aires (2004)',
      trayectoria:
        'Joven promesa de la escena con un estilo que fusiona cadencias de mombow con letras crudas de la realidad urbana de los barrios.',
    },
    {
      nombre: 'Patricio Rey y sus Redonditos de Ricota',
      alias: ['redondos', 'los redondos', 'patricio rey', 'indio solari', 'skay'],
      subtitulo: 'El mito y la autogestión independiente',
      genero: 'Rock Nacional / Punk Rock',
      imagen: 'imgs/rendondos.png',
      origen: 'La Plata, Buenos Aires (1976 - 2001)',
      trayectoria:
        'Liderados por Indio Solari y Skay Beilinson, mantuvieron un modelo 100% independiente sin discográficas multinacionales. "Gulp!", "Oktubre", "¡Bang! ¡Bang!" y "Luzbelito" marcaron un hito social sin precedentes.',
    },
    {
      nombre: 'LautaroRL',
      alias: ['lautaro', 'lautarorl', 'lautaro r'],
      subtitulo: 'Sonidos callejeros del conurbano',
      genero: 'RKT / Cumbia',
      imagen: 'imgs/artist_lautaro.svg',
      origen: 'Argentina',
      trayectoria:
        'Nueva generación de la escena urbana: fusiona cumbia de barrio con beats electrónicos y cadencias de RKT.',
    },
    {
      nombre: 'Ramma',
      alias: ['ramma'],
      subtitulo: 'Nueva ola del trap argentino',
      genero: 'Trap',
      imagen: 'imgs/artist_ramma.svg',
      origen: 'Argentina',
      trayectoria:
        'Líricas crudas de la nueva ola con melodías oscuras y flow característico.',
    },
  ];

  /** Traduce apodos y sinónimos al nombre real (ej. "indio solari" → los Redondos). */
  function porAlias(query) {
    const n = normalizar(query);
    if (n.length < 2) return null;
    const hit = ARTISTAS_LOCALES.find((a) =>
      a.alias.some((al) => {
        const x = normalizar(al);
        if (x === n) return true;
        // "camilo j" → "camilo" (muy parecido, se acepta)
        if (x.startsWith(n)) return true;
        // "goteo remix" no debería convertirse en "Duki": solo se aceptan
        // consultas cortas que empiezan por el alias ("goteo" → Duki)
        return n.startsWith(x) && n.length - x.length <= 3;
      })
    );
    return hit ? hit.nombre : null;
  }

  /** Sugerencias instantáneas (sin red) para el autocompletado. */
  function sugerencias(query) {
    const n = normalizar(query);
    if (n.length < 2) return [];

    const conPuntaje = [];
    ARTISTAS_LOCALES.forEach((a) => {
      const nombreNorm = normalizar(a.nombre);
      const tokensNombre = nombreNorm.split(' ');
      const aliasNorm = a.alias.map(normalizar);

      let puntaje = 0;
      if (nombreNorm.startsWith(n) || tokensNombre.some((t) => t.startsWith(n))) {
        puntaje = 3; // coincide con el nombre del artista
      } else if (aliasNorm.some((al) => al.split(' ')[0].startsWith(n))) {
        puntaje = 2; // coincide con el inicio de un apodo
      } else if (aliasNorm.some((al) => al.includes(n)) || nombreNorm.includes(n)) {
        puntaje = 1; // aparece en algún apodo (por ejemplo "joa" → "camilo joaquin")
      }

      if (puntaje > 0) {
        conPuntaje.push({ nombre: a.nombre, genero: a.genero, puntaje: puntaje });
      }
    });

    return conPuntaje
      .sort((x, y) => y.puntaje - x.puntaje)
      .slice(0, 4)
      .map((s) => ({ nombre: s.nombre, genero: s.genero }));
  }

  /* ==========================================================================
     PROVEEDOR 1 — SPOTIFY (vía Netlify Function)
     ========================================================================== */

  async function llamarSpotify(params) {
    if (spotifyEstado === 'no') return null;
    // Al abrir el archivo con doble clic no hay servidor: ni intentamos.
    if (window.location.protocol === 'file:') {
      spotifyEstado = 'no';
      return null;
    }

    const ctrl = new AbortController();
    const reloj = setTimeout(() => ctrl.abort(), 10000);
    try {
      const url =
        SPOTIFY_PROXY + '?' + new URLSearchParams(params).toString();
      const res = await fetch(url, { signal: ctrl.signal });

      // 400/404/5xx = función ausente o sin credenciales → fallback permanente
      if ([400, 404, 500, 502, 503].includes(res.status)) {
        spotifyEstado = 'no';
        return null;
      }
      if (!res.ok) return null;

      spotifyEstado = 'ok';
      return await res.json();
    } catch (e) {
      spotifyEstado = 'no';
      return null;
    } finally {
      clearTimeout(reloj);
    }
  }

  async function buscarEnSpotify(nombre) {
    const busqueda = await llamarSpotify({ endpoint: 'search', q: nombre });
    if (!busqueda || !busqueda.artists || !busqueda.artists.items) return null;

    const items = busqueda.artists.items;
    const elegido = mejorCoincidencia(
      nombre,
      items.map((a) => a.name)
    );
    if (!elegido) return null;

    const artista = items.find((a) => a.name === elegido) || items[0];

    const [detalle, top, albums, relacionados] = await Promise.all([
      llamarSpotify({ endpoint: 'artist', id: artista.id }),
      llamarSpotify({ endpoint: 'top', id: artista.id }),
      llamarSpotify({ endpoint: 'albums', id: artista.id }),
      llamarSpotify({ endpoint: 'related', id: artista.id }),
    ]);

    if (!detalle) return null;

    const generos = Array.isArray(detalle.genres) ? detalle.genres : [];
    const imagenSpotify =
      detalle.images && detalle.images[0] ? detalle.images[0].url : '';

    const canciones =
      top && Array.isArray(top.tracks)
        ? top.tracks.slice(0, 6).map((t) => ({
            titulo: t.name,
            album: t.album && t.album.name ? t.album.name : '',
            caratula:
              t.album && t.album.images && t.album.images[2]
                ? t.album.images[2].url
                : t.album && t.album.images && t.album.images[0]
                ? t.album.images[0].url
                : '',
            preview: t.preview_url || '',
            url: t.external_urls ? t.external_urls.spotify : '',
          }))
        : [];

    const lanzamientos =
      albums && Array.isArray(albums.items)
        ? albums.items
            .filter((a) => a.release_date)
            .sort((a, b) => (a.release_date < b.release_date ? 1 : -1))
            .slice(0, 6)
            .map((a) => ({
              titulo: a.name,
              fecha: a.release_date,
              tipo: a.album_type === 'single' ? 'SINGLE' : 'ÁLBUM',
              caratula: a.images && a.images[0] ? a.images[0].url : '',
              url: a.external_urls ? a.external_urls.spotify : '',
            }))
        : [];

    const relacionadosNombres =
      relacionados && Array.isArray(relacionados.artists)
        ? relacionados.artists.slice(0, 6).map((a) => a.name)
        : [];

    return {
      nombre: detalle.name,
      genero: generos.length
        ? generos
            .slice(0, 2)
            .map((g) => g.toUpperCase())
            .join(' / ')
        : '',
      imagen: imagenSpotify,
      seguidores: detalle.followers ? detalle.followers.total : null,
      popularidad:
        typeof detalle.popularity === 'number' ? detalle.popularity : null,
      bio: '',
      origen: '',
      activoDesde: '',
      activoHasta: '',
      topTemas: canciones,
      lanzamientos: lanzamientos,
      relacionados: relacionadosNombres,
      enlaces: {
        spotify: detalle.external_urls ? detalle.external_urls.spotify : '',
        apple: '',
        wikipedia: '',
      },
      fuente: 'Spotify',
      offline: false,
    };
  }

  /* ==========================================================================
     PROVEEDOR 2 — APPLE MUSIC (iTunes, sin clave)
     ========================================================================== */

  async function buscarEnApple(nombre) {
    const busqueda = await fetchJSON(
      'https://itunes.apple.com/search?term=' +
        encodeURIComponent(nombre) +
        '&entity=musicArtist&limit=10&country=ar'
    );

    const resultados = (busqueda && busqueda.results) || [];
    const elegido = mejorCoincidencia(
      nombre,
      resultados.map((r) => r.artistName)
    );
    if (!elegido) return null;

    const artista = resultados.find((r) => r.artistName === elegido);
    if (!artista) return null;

    const [cancionesRes, albumsRes] = await Promise.all([
      fetchJSON(
        'https://itunes.apple.com/lookup?id=' +
          artista.artistId +
          '&entity=song&limit=30&country=ar'
      ).catch(() => null),
      fetchJSON(
        'https://itunes.apple.com/lookup?id=' +
          artista.artistId +
          '&entity=album&limit=50&country=ar'
      ).catch(() => null),
    ]);

    const nombreNorm = normalizar(artista.artistName);

    // Temas: se queda con los que son del artista (solo o como colaborador)
    const canciones = ((cancionesRes && cancionesRes.results) || [])
      .filter(
        (t) =>
          t.wrapperType === 'track' &&
          (t.artistId === artista.artistId ||
            normalizar(t.artistName).includes(nombreNorm))
      )
      .slice(0, 6)
      .map((t) => ({
        titulo: t.trackName || '',
        album: t.collectionName || '',
        caratula: t.artworkUrl100
          ? t.artworkUrl100.replace('100x100bb', '60x60bb')
          : '',
        preview: t.previewUrl || '',
        url: t.trackViewUrl || '',
      }));

    // Lanzamientos: álbumes propios ordenados por fecha (más recientes primero)
    let albums = ((albumsRes && albumsRes.results) || []).filter(
      (a) => a.wrapperType === 'collection' && a.releaseDate
    );
    const propios = albums.filter((a) => a.artistId === artista.artistId);
    if (propios.length >= 3) albums = propios;

    const lanzamientos = albums
      .sort((a, b) => (a.releaseDate < b.releaseDate ? 1 : -1))
      .slice(0, 6)
      .map((a) => ({
        titulo: a.collectionName || '',
        fecha: a.releaseDate,
        tipo: (a.collectionType || 'ÁLBUM').toUpperCase(),
        caratula: a.artworkUrl100
          ? a.artworkUrl100.replace('100x100bb', '200x200bb')
          : '',
        url: a.collectionViewUrl || '',
      }));

    return {
      nombre: artista.artistName,
      genero: (artista.primaryGenreName || '').toUpperCase(),
      imagen: '',
      seguidores: null,
      popularidad: null,
      bio: '',
      origen: '',
      activoDesde: '',
      activoHasta: '',
      topTemas: canciones,
      lanzamientos: lanzamientos,
      relacionados: [],
      enlaces: {
        spotify: '',
        apple: artista.artistLinkUrl || '',
        wikipedia: '',
      },
      fuente: 'Apple Music',
      offline: false,
    };
  }

  /** Género de respaldo desde iTunes (para cuando Spotify no trae genres). */
  async function generoDesdeApple(nombre) {
    const busqueda = await fetchJSON(
      'https://itunes.apple.com/search?term=' +
        encodeURIComponent(nombre) +
        '&entity=musicArtist&limit=5&country=ar'
    );
    const resultados = (busqueda && busqueda.results) || [];
    const elegido = mejorCoincidencia(
      nombre,
      resultados.map((r) => r.artistName)
    );
    const artista = resultados.find((r) => r.artistName === elegido);
    return artista && artista.primaryGenreName
      ? artista.primaryGenreName
      : null;
  }

  /* ==========================================================================
     COMPLEMENTOS — WIKIPEDIA (bio + foto) y MUSICBRAINZ (país + años)
     ========================================================================== */

  async function buscarEnWikipedia(nombre) {
    const busqueda = await fetchJSON(
      'https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=' +
        encodeURIComponent(nombre) +
        '&format=json&origin=*&srlimit=5'
    );
    const items = (busqueda && busqueda.query && busqueda.query.search) || [];
    const titulo = items.find((i) => similitud(nombre, i.title) >= 0.6);
    if (!titulo) return null;

    const resumen = await fetchJSON(
      'https://es.wikipedia.org/api/rest_v1/page/summary/' +
        encodeURIComponent(titulo.title)
    );
    if (!resumen || !resumen.extract) return null;

    return {
      bio: resumen.extract,
      imagen: resumen.thumbnail ? resumen.thumbnail.source : '',
      url:
        resumen.content_urls && resumen.content_urls.desktop
          ? resumen.content_urls.desktop.page
          : '',
    };
  }

  async function buscarEnMusicBrainz(nombre) {
    const datos = await fetchJSON(
      'https://musicbrainz.org/ws/2/artist?query=' +
        encodeURIComponent('artist:"' + nombre + '"') +
        '&fmt=json&limit=5',
      7000
    );
    const items = (datos && datos.artists) || [];
    const artista = items.find((a) => similitud(nombre, a.name) >= 0.6);
    if (!artista) return null;

    const span = artista['life-span'] || {};
    return {
      pais: artista.area ? artista.area.name : '',
      desde: span.start || '',
      hasta: span.end || '',
      url: artista.url ? artista.url.resource : '',
    };
  }

  /* ==========================================================================
     MODO SIN CONEXIÓN — datos guardados localmente (sin noticias inventadas)
     ========================================================================== */

  function buscarLocal(query) {
    const n = normalizar(query);
    if (!n) return null;

    const artista = ARTISTAS_LOCALES.find(
      (a) =>
        similitud(query, a.nombre) >= 0.6 ||
        a.alias.some((al) => normalizar(al) === n)
    );
    if (!artista) return null;

    return {
      nombre: artista.nombre,
      genero: artista.genero.toUpperCase(),
      imagen: artista.imagen,
      seguidores: null,
      popularidad: null,
      bio: artista.trayectoria,
      origen: artista.origen,
      activoDesde: '',
      activoHasta: '',
      topTemas: [],
      lanzamientos: [],
      relacionados: [],
      enlaces: {},
      fuente: 'Datos locales',
      offline: true,
      subtitulo: artista.subtitulo,
    };
  }

  /* ==========================================================================
     ORQUESTADOR
     ========================================================================== */

  /**
   * Busca un artista y devuelve una ficha normalizada:
   * { nombre, genero, imagen, bio, origen, activoDesde, seguidores, popularidad,
   *   topTemas[], lanzamientos[], relacionados[], enlaces{}, fuente, offline }
   * Devuelve null si no se encontró nada (no se inventa información).
   */
  async function buscar(query) {
    const q = String(query || '').trim();
    if (!q) return null;

    // Los apodos se traducen a su nombre real antes de consultar
    const nombre = porAlias(q) || q;

    let ficha = null;
    let huboRed = false;

    // 1) Spotify
    try {
      ficha = await buscarEnSpotify(nombre);
      if (ficha) huboRed = true;
    } catch (e) {
      ficha = null;
    }

    // 2) Apple Music
    if (!ficha) {
      try {
        ficha = await buscarEnApple(nombre);
        if (ficha) huboRed = true;
      } catch (e) {
        ficha = null;
      }
    }

    // 3) Sin resultados con datos en vivo → red disponible, responder "no existe"
    if (!ficha) {
      if (huboRed) return null;
      return buscarLocal(q); // caemos a datos locales solo si la red falló
    }

    // 4) Complementos: biografía, foto, país y años (cada uno es opcional)
    const [wikiRes, mbRes] = await Promise.allSettled([
      buscarEnWikipedia(nombre),
      buscarEnMusicBrainz(nombre),
    ]);

    if (wikiRes.status === 'fulfilled' && wikiRes.value) {
      if (!ficha.bio) ficha.bio = wikiRes.value.bio;
      if (!ficha.imagen) ficha.imagen = wikiRes.value.imagen;
      if (wikiRes.value.url) ficha.enlaces.wikipedia = wikiRes.value.url;
    }

    if (mbRes.status === 'fulfilled' && mbRes.value) {
      if (!ficha.origen) {
        ficha.origen = mbRes.value.pais || '';
      }
      ficha.activoDesde = mbRes.value.desde || '';
      ficha.activoHasta = mbRes.value.hasta || '';
    } else if (ficha.origen && /\(\d{4}\)$/.test(ficha.origen)) {
      // si Spotify/Apple no dio origen y falló MusicBrainz, no hay nada que hacer
      ficha.origen = ficha.origen;
    }

    // 5) Género de respaldo si vino vacío
    if (!ficha.genero) {
      try {
        const genero = await generoDesdeApple(nombre);
        if (genero) ficha.genero = genero.toUpperCase();
      } catch (e) {
        /* sin género: se muestra igual */
      }
    }
    if (!ficha.genero) ficha.genero = 'MÚSICA ARGENTINA';

    // 6) Imagen de último recurso: carátula de su primer tema
    if (!ficha.imagen && ficha.topTemas.length && ficha.topTemas[0].caratula) {
      ficha.imagen = ficha.topTemas[0].caratula;
    }

    ficha.consultadoEn = new Date();
    return ficha;
  }

  return {
    buscar: buscar,
    sugerencias: sugerencias,
    porAlias: porAlias,
    // Exponer estado por si la UI quiere mostrar "Spotify activo"
    estadoSpotify: function () {
      return spotifyEstado;
    },
  };
})();
