/**
 * ============================================================================
 * BUSCADOR REAL — HISTORIA DE LA MÚSICA ARGENTINA
 * ============================================================================
 * Muestra información real y actualizada del artista buscado:
 *   · Top temas con carátula y preview de audio (30 s)
 *   · Últimos lanzamientos con fecha real
 *   · Biografía, país y años de actividad
 *   · Seguidores y popularidad (cuando la fuente es Spotify)
 *   · Artistas relacionados
 *
 * Fuentes: Spotify (si Netlify Function está configurada) → Apple Music →
 * Wikipedia → MusicBrainz → datos locales sin conexión.
 * Ver js/music-api.js y netlify/functions/spotify.js
 * ============================================================================
 */
(function () {
  'use strict';

  /* ==========================================================================
     UTILIDADES
     ========================================================================== */

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHTML(valor) {
    return String(valor == null ? '' : valor).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  }

  function fechaCorta(iso) {
    if (!iso) return '';
    const partes = String(iso).split('-');
    if (partes.length < 2) return String(iso).slice(0, 4);
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const anio = partes[0];
    const mes = meses[parseInt(partes[1], 10) - 1] || '';
    return partes[2] ? `${parseInt(partes[2], 10)} ${mes} ${anio}` : `${mes} ${anio}`;
  }

  function anioDe(iso) {
    return iso ? String(iso).split('-')[0] : '';
  }

  function numeroCompacto(n) {
    try {
      return new Intl.NumberFormat('es-AR', { notation: 'compact' }).format(n);
    } catch (e) {
      return String(n);
    }
  }

  function debounce(fn, espera) {
    let reloj;
    return function () {
      const args = arguments;
      const ctx = this;
      clearTimeout(reloj);
      reloj = setTimeout(() => fn.apply(ctx, args), espera);
    };
  }

  /* ==========================================================================
     REPRODUCTOR DE PREVIEWS (30 segundos de iTunes/Spotify)
     ========================================================================== */

  const audio = new Audio();
  let botonActivo = null;

  function marcarBoton(boton, reproduciendo) {
    if (!boton) return;
    boton.classList.toggle('playing', reproduciendo);
    const icono = boton.querySelector('i');
    if (icono) icono.className = reproduciendo ? 'bi bi-pause-fill' : 'bi bi-play-fill';
  }

  function alternarPreview(boton, url) {
    if (!url) return;

    if (botonActivo === boton && !audio.paused) {
      audio.pause();
      marcarBoton(boton, false);
      return;
    }

    if (botonActivo) marcarBoton(botonActivo, false);
    audio.src = url;
    audio
      .play()
      .then(() => {
        botonActivo = boton;
        marcarBoton(boton, true);
      })
      .catch(() => {
        /* reproducción bloqueada por el navegador: no se rompe nada */
      });
  }

  audio.addEventListener('ended', () => {
    marcarBoton(botonActivo, false);
    botonActivo = null;
  });

  function detenerPreview() {
    audio.pause();
    audio.removeAttribute('src');
    marcarBoton(botonActivo, false);
    botonActivo = null;
  }

  /* ==========================================================================
     MODAL + AUTOCOMPLETADO
     ========================================================================== */

  function crearComponentesUI() {
    if ($('search-results-modal')) return;

    const modalHTML = `
      <div class="modal fade" id="search-results-modal" tabindex="-1"
           aria-labelledby="search-modal-title" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
          <div class="modal-content search-modal-content">

            <!-- Encabezado -->
            <div class="modal-header search-modal-header">
              <div class="d-flex align-items-center gap-2 flex-wrap">
                <span class="search-badge-pill" id="search-modal-title">RESULTADOS DE BÚSQUEDA</span>
                <span class="text-white-50 small" id="search-modal-query-label"></span>
              </div>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Cerrar"></button>
            </div>

            <!-- Cuerpo -->
            <div class="modal-body search-modal-body">

              <!-- Refinar la búsqueda sin cerrar el modal -->
              <div class="search-refine-row">
                <input type="search" class="search-refine-input" id="modal-search-input"
                       placeholder="BUSCAR OTRO ARTISTA" aria-label="Buscar otro artista"
                       autocomplete="off">
                <button type="button" class="search-refine-btn" id="modal-search-go" aria-label="Buscar">
                  <i class="bi bi-search"></i>
                </button>
              </div>

              <div id="search-modal-status" aria-live="polite"></div>
              <div id="search-modal-result" hidden></div>

            </div>

            <!-- Pie -->
            <div class="modal-footer search-modal-footer">
              <span class="text-white-50 small me-auto" id="search-source-note"></span>
              <button type="button" class="btn btn-outline-light btn-sm px-3" data-bs-dismiss="modal">Cerrar</button>
            </div>

          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    const modalEl = $('search-results-modal');
    modalEl.addEventListener('hidden.bs.modal', detenerPreview);

    // Botón del modal (y Enter) para buscar otro artista
    const inputModal = $('modal-search-input');
    const btnModal = $('modal-search-go');
    if (btnModal) btnModal.addEventListener('click', () => ejecutarBusqueda(inputModal.value));
    if (inputModal) {
      inputModal.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          ejecutarBusqueda(inputModal.value);
        }
      });
    }
  }

  /* ---------- Estados del modal ---------- */

  function abrirModal() {
    crearComponentesUI();
    const el = $('search-results-modal');
    if (window.bootstrap && window.bootstrap.Modal) {
      const inst = bootstrap.Modal.getOrCreateInstance(el);
      inst.show();
    } else {
      el.classList.add('show');
      el.style.display = 'block';
      el.removeAttribute('aria-hidden');
    }
  }

  function mostrarCargando(query) {
    const status = $('search-modal-status');
    const result = $('search-modal-result');
    if (!status) return;
    if (result) result.hidden = true;
    status.innerHTML = `
      <div class="search-state">
        <div class="search-spinner" aria-hidden="true"></div>
        <div class="search-state-title">BUSCANDO "${escapeHTML(query)}"</div>
        <div class="search-state-sub">Consultando Spotify, Apple Music y Wikipedia…</div>
      </div>`;
  }

  function mostrarSinResultados(query, error) {
    const status = $('search-modal-status');
    const result = $('search-modal-result');
    if (result) result.hidden = true;

    const alternativas = (window.MusicAPI ? MusicAPI.sugerencias(query) : [])
      .map((s) => `<button type="button" class="related-chip" data-buscar="${escapeHTML(s.nombre)}">${escapeHTML(s.nombre)}</button>`)
      .join('');

    status.innerHTML = `
      <div class="search-state">
        <i class="bi bi-emoji-frown" aria-hidden="true"></i>
        <div class="search-state-title">${error ? 'NO PUDIMOS BUSCAR AHORA' : 'SIN RESULTADOS'}</div>
        <div class="search-state-sub">
          ${
            error
              ? 'Revisá tu conexión a internet y volvé a intentar.'
              : `No encontramos a nadie llamado "<strong>${escapeHTML(query)}</strong>" en las bases de datos consultadas.`
          }
        </div>
        ${alternativas ? `<div class="related-chips search-state-chips">${alternativas}</div>` : ''}
      </div>`;
    vincularChips(status);
  }

  /* ---------- Render de la ficha ---------- */

  function filaTema(tema, indice) {
    const numero = String(indice + 1).padStart(2, '0');
    const play = tema.preview
      ? `<button type="button" class="track-play" data-preview="${escapeHTML(tema.preview)}" aria-label="Escuchar vista previa de ${escapeHTML(tema.titulo)}"><i class="bi bi-play-fill"></i></button>`
      : `<span class="track-index">${numero}</span>`;
    const caratula = tema.caratula
      ? `<img class="track-cover" src="${escapeHTML(tema.caratula)}" alt="" loading="lazy">`
      : `<span class="track-cover track-cover-empty"><i class="bi bi-music-note"></i></span>`;
    const contenido = `
      ${play}
      ${caratula}
      <span class="track-meta">
        <span class="track-title">${escapeHTML(tema.titulo)}</span>
        <span class="track-album">${escapeHTML(tema.album)}</span>
      </span>`;
    return tema.url
      ? `<li class="track-row"><a class="track-link" href="${escapeHTML(tema.url)}" target="_blank" rel="noopener">${contenido}</a></li>`
      : `<li class="track-row">${contenido}</li>`;
  }

  function tarjetaLanzamiento(item) {
    const fecha = anioDe(item.fecha);
    const imagen = item.caratula
      ? `<img src="${escapeHTML(item.caratula)}" alt="Carátula de ${escapeHTML(item.titulo)}" loading="lazy">`
      : `<span class="release-cover-empty"><i class="bi bi-vinyl"></i></span>`;
    const etiqueta = `<span class="release-title">${escapeHTML(item.titulo)}</span>
      <span class="release-year">${escapeHTML(item.tipo || '')} · ${escapeHTML(fecha || fechaCorta(item.fecha))}</span>`;
    return item.url
      ? `<a class="release-card" href="${escapeHTML(item.url)}" target="_blank" rel="noopener">${imagen}${etiqueta}</a>`
      : `<div class="release-card">${imagen}${etiqueta}</div>`;
  }

  function renderResultado(ficha, query) {
    const status = $('search-modal-status');
    const result = $('search-modal-result');
    if (!result) return;
    if (status) status.innerHTML = '';
    result.hidden = false;

    /* --- subtítulo con datos reales --- */
    const datos = [];
    if (ficha.seguidores != null) datos.push(`${numeroCompacto(ficha.seguidores)} seguidores`);
    if (ficha.origen) datos.push(escapeHTML(ficha.origen));
    if (ficha.activoDesde) {
      datos.push(
        ficha.activoHasta
          ? `Activo ${escapeHTML(ficha.activoDesde)} – ${escapeHTML(ficha.activoHasta)}`
          : `Desde ${escapeHTML(ficha.activoDesde)}`
      );
    }
    if (ficha.subtitulo && !datos.length) datos.push(escapeHTML(ficha.subtitulo));

    const popularidad =
      ficha.popularidad != null
        ? `<div class="popularity-wrap">
             <div class="popularity-label">
               <span>POPULARIDAD</span><span>${ficha.popularidad}/100</span>
             </div>
             <div class="popularity-bar"><span style="width:${ficha.popularidad}%"></span></div>
           </div>`
        : '';

    const hero = `
      <div class="search-artist-hero">
        <div class="search-artist-avatar">
          ${
            ficha.imagen
              ? `<img src="${escapeHTML(ficha.imagen)}" alt="Retrato de ${escapeHTML(ficha.nombre)}">`
              : `<i class="bi bi-person" aria-hidden="true"></i>`
          }
        </div>
        <div class="search-artist-meta">
          <span class="search-genre-tag">${escapeHTML(ficha.genero || 'MÚSICA')}</span>
          <h2 class="search-artist-name">${escapeHTML(ficha.nombre)}</h2>
          <p class="search-artist-sub">${datos.join(' · ') || 'Ficha del artista'}</p>
          ${popularidad}
        </div>
      </div>`;

    /* --- bloque: top temas --- */
    const bloqueTemas = ficha.topTemas.length
      ? `<div class="search-info-card">
           <div class="search-card-header">
             <i class="bi bi-music-note-beamed" aria-hidden="true"></i>
             <h3>TOP TEMAS</h3>
           </div>
           <ul class="track-list">
             ${ficha.topTemas.map(filaTema).join('')}
           </ul>
         </div>`
      : '';

    /* --- bloque: últimos lanzamientos --- */
    const bloqueLanzamientos = ficha.lanzamientos.length
      ? `<div class="search-info-card">
           <div class="search-card-header">
             <i class="bi bi-vinyl" aria-hidden="true"></i>
             <h3>ÚLTIMOS LANZAMIENTOS</h3>
           </div>
           <div class="releases-grid">
             ${ficha.lanzamientos.map(tarjetaLanzamiento).join('')}
           </div>
         </div>`
      : '';

    /* --- bloque: información específica --- */
    const bloqueInfo = `
      <div class="search-info-card full-width">
        <div class="search-card-header">
          <i class="bi bi-info-circle-fill" aria-hidden="true"></i>
          <h3>INFORMACIÓN ESPECÍFICA</h3>
        </div>
        <div class="info-grid">
          <div><span class="info-label">ORIGEN</span><span class="info-value">${escapeHTML(ficha.origen || '—')}</span></div>
          <div><span class="info-label">GÉNERO</span><span class="info-value">${escapeHTML(ficha.genero || '—')}</span></div>
          <div><span class="info-label">AÑOS ACTIVO</span><span class="info-value">${escapeHTML(
            ficha.activoDesde
              ? ficha.activoHasta
                ? `${ficha.activoDesde} – ${ficha.activoHasta}`
                : `desde ${ficha.activoDesde}`
              : '—'
          )}</span></div>
        </div>
        <p class="artist-bio-full">${escapeHTML(ficha.bio || 'Sin biografía disponible para este artista.')}</p>
      </div>`;

    /* --- bloque: relacionados --- */
    const bloqueRelacionados = ficha.relacionados.length
      ? `<div class="search-info-card full-width">
           <div class="search-card-header">
             <i class="bi bi-diagram-3" aria-hidden="true"></i>
             <h3>TAMBIÉN TE PUEDE GUSTAR</h3>
           </div>
           <div class="related-chips">
             ${ficha.relacionados
               .map((n) => `<button type="button" class="related-chip" data-buscar="${escapeHTML(n)}">${escapeHTML(n)}</button>`)
               .join('')}
           </div>
         </div>`
      : '';

    /* --- enlaces a las plataformas --- */
    const enlaces = [];
    if (ficha.enlaces.spotify) {
      enlaces.push(
        `<a class="artist-link-btn" href="${escapeHTML(ficha.enlaces.spotify)}" target="_blank" rel="noopener"><i class="bi bi-spotify"></i> Ver en Spotify</a>`
      );
    }
    if (ficha.enlaces.apple) {
      enlaces.push(
        `<a class="artist-link-btn" href="${escapeHTML(ficha.enlaces.apple)}" target="_blank" rel="noopener"><i class="bi bi-apple"></i> Ver en Apple Music</a>`
      );
    }
    if (ficha.enlaces.wikipedia) {
      enlaces.push(
        `<a class="artist-link-btn" href="${escapeHTML(ficha.enlaces.wikipedia)}" target="_blank" rel="noopener"><i class="bi bi-book"></i> Leer en Wikipedia</a>`
      );
    }

    const grid =
      bloqueTemas || bloqueLanzamientos
        ? `<div class="search-blocks-grid">${bloqueTemas}${bloqueLanzamientos}</div>`
        : '';

    result.innerHTML = `
      ${hero}
      ${grid}
      ${bloqueInfo}
      ${bloqueRelacionados}
      ${enlaces.length ? `<div class="artist-links">${enlaces.join('')}</div>` : ''}
    `;

    /* --- pie: fuente y fecha de la consulta --- */
    const nota = $('search-source-note');
    if (nota) {
      nota.innerHTML = ficha.offline
        ? '<i class="bi bi-wifi-off"></i> Sin conexión · datos guardados localmente'
        : `<i class="bi bi-lightning-charge"></i> Fuente: ${escapeHTML(ficha.fuente)} · consulta ${new Date().toLocaleDateString('es-AR')}`;
    }

    /* --- eventos de la ficha --- */
    result.querySelectorAll('.track-play').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        alternarPreview(btn, btn.getAttribute('data-preview'));
      });
    });

    vincularChips(result);
  }

  /** Chips "buscá de nuevo por X" (relacionados / alternativas). */
  function vincularChips(contenedor) {
    contenedor.querySelectorAll('[data-buscar]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const valor = chip.getAttribute('data-buscar');
        const inputHeader = document.querySelector('.header-search-input');
        const inputModal = $('modal-search-input');
        if (inputHeader) inputHeader.value = valor;
        if (inputModal) inputModal.value = valor;
        ejecutarBusqueda(valor);
      });
    });
  }

  /* ==========================================================================
     FLUJO DE BÚSQUEDA
     ========================================================================== */

  async function ejecutarBusqueda(query) {
    const q = String(query || '').trim();
    if (!q) return;

    ocultarTodasLasSugerencias();
    abrirModal();

    const label = $('search-modal-query-label');
    if (label) label.textContent = `Término: "${q}"`;

    const inputModal = $('modal-search-input');
    if (inputModal && inputModal.value.trim() !== q) inputModal.value = q;
    const inputHeader = document.querySelector('.header-search-input');
    if (inputHeader) inputHeader.value = q;

    const nota = $('search-source-note');
    if (nota) nota.textContent = '';

    mostrarCargando(q);

    if (!window.MusicAPI) {
      mostrarSinResultados(q, true);
      return;
    }

    try {
      const ficha = await MusicAPI.buscar(q);
      if (ficha) renderResultado(ficha, q);
      else mostrarSinResultados(q, false);
    } catch (e) {
      mostrarSinResultados(q, true);
    }
  }

  /* ==========================================================================
     AUTOCOMPLETADO (teclado + accesibilidad)
     ========================================================================== */

  function ocultarTodasLasSugerencias() {
    document.querySelectorAll('.search-autocomplete-list').forEach((l) => {
      l.style.display = 'none';
      l.innerHTML = '';
    });
    document.querySelectorAll('.header-search-input, .search-refine-input').forEach((i) => {
      i.setAttribute('aria-expanded', 'false');
    });
  }

  function montarAutocompletado(input) {
    const wrap = input.parentElement;
    if (!wrap || input.dataset.buscaMontado) return;
    input.dataset.buscaMontado = '1';
    wrap.style.position = wrap.style.position || 'relative';

    const listaId = input.id + '-sugerencias';
    const lista = document.createElement('div');
    lista.className = 'search-autocomplete-list';
    lista.id = listaId;
    lista.setAttribute('role', 'listbox');
    wrap.appendChild(lista);

    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', listaId);
    input.setAttribute('aria-expanded', 'false');

    let indiceActivo = -1;

    function pintar(items) {
      lista.innerHTML = items
        .map(
          (item, i) => `
          <div class="search-suggest-item${item.vacio ? ' empty' : ''}${i === indiceActivo ? ' active' : ''}"
               role="option" id="${listaId}-op-${i}"
               aria-selected="${i === indiceActivo}"
               data-nombre="${escapeHTML(item.nombre)}">
            <span class="suggest-name">${escapeHTML(item.texto || item.nombre)}</span>
            <span class="suggest-badge">${escapeHTML(item.badge)}</span>
          </div>`
        )
        .join('');

      lista.querySelectorAll('.search-suggest-item').forEach((el) => {
        el.addEventListener('click', () => {
          const valor = el.getAttribute('data-nombre');
          input.value = valor;
          lista.style.display = 'none';
          input.setAttribute('aria-expanded', 'false');
          ejecutarBusqueda(valor);
        });
      });

      lista.style.display = items.length ? 'block' : 'none';
      input.setAttribute('aria-expanded', items.length ? 'true' : 'false');
    }

    const actualizarSugerencias = debounce(() => {
      const valor = input.value.trim();
      indiceActivo = -1;

      if (valor.length < 2) {
        lista.style.display = 'none';
        lista.innerHTML = '';
        input.setAttribute('aria-expanded', 'false');
        return;
      }

      const propias = (window.MusicAPI ? MusicAPI.sugerencias(valor) : []).map((s) => ({
        nombre: s.nombre,
        texto: s.nombre,
        badge: (s.genero || '').split('/')[0].trim().toUpperCase(),
      }));

      if (propias.length) {
        pintar(propias);
      } else {
        pintar([
          {
            nombre: valor,
            texto: `Buscar "${valor}"`,
            badge: 'EXPLORAR',
            vacio: true,
          },
        ]);
      }
    }, 180);

    input.addEventListener('input', actualizarSugerencias);

    input.addEventListener('keydown', (e) => {
      const opciones = Array.from(lista.querySelectorAll('.search-suggest-item'));

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!opciones.length) return;
        e.preventDefault();
        indiceActivo =
          e.key === 'ArrowDown'
            ? (indiceActivo + 1) % opciones.length
            : (indiceActivo - 1 + opciones.length) % opciones.length;
        opciones.forEach((op, i) => {
          op.classList.toggle('active', i === indiceActivo);
          op.setAttribute('aria-selected', i === indiceActivo);
        });
        input.setAttribute('aria-activedescendant', `${listaId}-op-${indiceActivo}`);
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        const elegida = opciones[indiceActivo];
        const valor = elegida ? elegida.getAttribute('data-nombre') : input.value;
        input.value = valor;
        lista.style.display = 'none';
        input.setAttribute('aria-expanded', 'false');
        ejecutarBusqueda(valor);
        return;
      }

      if (e.key === 'Escape') {
        lista.style.display = 'none';
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
      }
    });

    // Cerrar al hacer clic afuera
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) {
        lista.style.display = 'none';
        input.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ==========================================================================
     ARRANQUE
     ========================================================================== */

  function iniciarBuscador() {
    crearComponentesUI();

    document
      .querySelectorAll('.header-search-input, .search-refine-input')
      .forEach(montarAutocompletado);

    // Botón "Buscar" de la barra de navegación móvil
    const btnMovil = document.getElementById('mob-search');
    if (btnMovil && !btnMovil.dataset.buscaMontado) {
      btnMovil.dataset.buscaMontado = '1';
      btnMovil.addEventListener('click', (e) => {
        e.preventDefault();
        abrirModal();
        setTimeout(() => {
          const input = $('modal-search-input');
          if (input) input.focus();
        }, 350);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciarBuscador);
  } else {
    iniciarBuscador();
  }

  // API por si otras páginas quieren abrir una búsqueda
  window.simularBusquedaArtista = ejecutarBusqueda;
  window.buscarArtista = ejecutarBusqueda;
})();
