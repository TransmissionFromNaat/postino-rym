// ==UserScript==
// @name         Postino
// @namespace    postino-rym
// @version      1.0
// @description  Porta i dati di una release da Discogs o Bandcamp nel modulo "Add Release" di RateYourMusic, seguendo le regole di RYM. Non invia nulla: anteprima e invio restano a te.
// @match        https://www.discogs.com/*
// @match        https://*.bandcamp.com/*
// @match        https://rateyourmusic.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_setClipboard
// @grant        GM_openInTab
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// @connect      api.discogs.com
// @run-at       document-idle
// ==/UserScript==

// Postino 1.0 — Discogs / Bandcamp → RateYourMusic
// Uso: su una release Discogs o un album Bandcamp premi "→ RYM" (in basso a destra);
// poi, sulla pagina "Add release" di RYM, premi "Compila modulo" nel pannello e controlla le voci "Da fare".

(function () {
  'use strict';

  const KEY = 'discogs_rym_data';
  const host = location.hostname;

  // ---------- utilità comuni ----------
  const clean = (s) => (s || '').replace(/\s\(\d+\)$/, '').trim(); // "Artista (2)" -> "Artista"
  const $ = (sel) => document.querySelector(sel);
  const pad2 = (n) => String(n).padStart(2, '0');
  const isVarious = (name) => /^various( artists)?$/i.test(clean(name));

  function css(el, styles) { Object.assign(el.style, styles); return el; }

  function btn(text, onClick, bg = '#2a6fdb') {
    const b = document.createElement('button');
    b.textContent = text;
    b.type = 'button';
    css(b, { background: bg, color: '#fff', border: 'none', borderRadius: '4px', padding: '6px 10px', margin: '3px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' });
    b.addEventListener('click', onClick);
    return b;
  }

  function floatingButton(onClick) {
    const b = btn('→ RYM', onClick, '#c0392b');
    css(b, { position: 'fixed', bottom: '20px', right: '20px', zIndex: 99999, padding: '10px 16px', fontSize: '15px', boxShadow: '0 2px 6px rgba(0,0,0,.4)' });
    document.body.appendChild(b);
    return b;
  }

  // salva i dati e apre RYM sulla ricerca giusta
  // Avviso temporaneo in basso a destra (verde = ok, rosso = errore)
  function toast(msg, ok = true) {
    let t = document.getElementById('drym_toast');
    if (!t) { t = document.createElement('div'); t.id = 'drym_toast'; document.body.appendChild(t); }
    css(t, { position: 'fixed', bottom: '75px', right: '20px', zIndex: 100000, maxWidth: '380px', padding: '10px 14px',
      background: ok ? '#27ae60' : '#c0392b', color: '#fff', borderRadius: '6px', fontSize: '14px', fontWeight: 'bold',
      boxShadow: '0 2px 8px rgba(0,0,0,.4)', transition: 'opacity .4s', opacity: '1' });
    t.textContent = msg;
    clearTimeout(t.hideTimer);
    t.hideTimer = setTimeout(() => { t.style.opacity = '0'; }, ok ? 4000 : 8000);
  }

  // Salva i dati per RYM: il pannello sulla pagina "Add release" già aperta si aggiorna da solo
  function sendToRym(data) {
    data.savedAt = Date.now(); // rende ogni invio diverso dal precedente (serve all'aggiornamento live su RYM)
    GM_setValue(KEY, JSON.stringify(data));
    toast('✔ Dati salvati – ' + data.artist + ' – ' + data.title);
  }

  // secondi -> "m:ss" (o "h:mm:ss" oltre l'ora); 0 o vuoto -> ''
  function secToTime(sec) {
    const s = Math.round(Number(sec) || 0);
    if (s <= 0) return '';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? h + ':' + pad2(m) + ':' + pad2(r) : m + ':' + pad2(r);
  }

  // durata ISO 8601 ("P00H03M45S", "PT3M45S") -> secondi
  function isoToSec(iso) {
    const m = /^P(?:T)?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(iso || '');
    return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
  }

  // =====================================================================
  //  LATO DISCOGS
  // =====================================================================
  if (host.endsWith('discogs.com')) {
    const b = floatingButton(onDiscogsClick);
    b.style.display = 'none';

    // Discogs è una SPA: mostra il pulsante solo sulle pagine release
    setInterval(() => {
      b.style.display = /\/release\/\d+/.test(location.pathname) ? 'block' : 'none';
    }, 800);

    function onDiscogsClick() {
      const m = location.pathname.match(/\/release\/(\d+)/);
      if (!m) return toast('Apri una pagina release di Discogs.', false);
      b.textContent = 'Carico…';
      GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://api.discogs.com/releases/' + m[1],
        headers: { Accept: 'application/json' },
        onload: (r) => {
          b.textContent = '→ RYM';
          if (r.status !== 200) return toast('Errore API Discogs: ' + r.status, false);
          const d = JSON.parse(r.responseText);
          const data = normalizeDiscogs(d);
          if (!d.master_id) return sendToRym(data);
          // master: anno della prima uscita, per riconoscere le ristampe non dichiarate
          GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://api.discogs.com/masters/' + d.master_id,
            headers: { Accept: 'application/json' },
            onload: (m) => {
              try { const mj = JSON.parse(m.responseText); data.masterYear = mj.year || null; data.mainRelease = mj.main_release || null; } catch (e) { /* ignora */ }
              sendToRym(data);
            },
            onerror: () => sendToRym(data)
          });
        },
        onerror: () => { b.textContent = '→ RYM'; toast('Richiesta all\'API Discogs fallita.', false); }
      });
    }

    function normalizeDiscogs(d) {
      // Artista
      let artist = '';
      (d.artists || []).forEach((a) => {
        artist += clean(a.anv || a.name);
        if (a.join) artist += a.join === ',' ? ', ' : ' ' + a.join + ' ';
      });
      artist = artist.trim();

      // Data
      const [y, mo, da] = (d.released || String(d.year || '')).split('-');

      // Formato: salta i contenitori ("Box Set", "All Media") e prende il primo supporto reale
      const media = (d.formats || []).filter((x) => !['Box Set', 'All Media'].includes(x.name));
      const f = media[0] || (d.formats || [])[0] || {};

      // Tracce. Le opere in più movimenti ("index track" di Discogs) diventano, come su RYM,
      // una riga d'intestazione senza numero (il titolo dell'opera) seguita dai movimenti.
      // Anche le intestazioni di sezione ("Registrazioni Live", il nome di un'opera…) diventano righe senza numero;
      // si saltano solo quelle generiche dei lati ("Side A") e dei supporti senza titolo ("CD 1", "DVD").
      const classical = (d.genres || []).includes('Classical');
      const SIDE_HEADING = /^(side|face|lato)\s*[a-z0-9]+\.?$|^[a-z]\d*$|^\d+$/i;
      const PLAIN_MEDIA_HEADING = /^(cd|dvd|blu-?ray|bd|sacd|disc|disk|lp|vinyl|cassette|tape|record|vhs)\s*[-.:#]?\s*\d*\.?$/i;
      const MEDIA_HEADING = /^(cd|dvd|blu-?ray|bd|sacd|disc|disk|vhs)\b/i; // es. 'DVD "Concerto Live"'
      const pipe = (s) => (s || '').replace(/\|/g, '/');
      // artista della traccia (compilation V/A): "Adham Zahran", "A & B", "A feat. B"
      const artistOf = (list) => {
        let a = '';
        (list || []).forEach((x) => { a += clean(x.anv || x.name); if (x.join) a += x.join === ',' ? ', ' : ' ' + x.join + ' '; });
        return pipe(a.trim());
      };
      let n = 0;
      const tracks = [];
      (d.tracklist || []).forEach((t) => {
        if (t.type_ === 'heading') {
          const h = (t.title || '').trim();
          if (!h || SIDE_HEADING.test(h) || PLAIN_MEDIA_HEADING.test(h)) return;
          const row = { pos: '', title: pipe(h), dur: '', header: true };
          if (MEDIA_HEADING.test(h)) row.mediaHeading = true; // sostituita dalla riga "CD"/"DVD" se ci sono più supporti
          tracks.push(row);
          return;
        }
        if (t.type_ === 'index' && Array.isArray(t.sub_tracks) && t.sub_tracks.length) {
          tracks.push({ pos: '', title: pipe(t.title), dur: '', header: true });
          t.sub_tracks.forEach((s, k) => {
            n++;
            // senza posizione: "3a, 3b…" se l'opera ha un numero, altrimenti numerazione progressiva
            const pos = (s.position || '').trim() || ((t.position || '').trim() ? t.position.trim() + String.fromCharCode(97 + k) : String(n));
            tracks.push({ pos, title: pipe(s.title), dur: s.duration || '', artist: artistOf(s.artists || t.artists) });
          });
          return;
        }
        if (t.type_ === 'track' || t.type_ === 'index') {
          n++;
          tracks.push({ pos: (t.position || String(n)).trim(), title: pipe(t.title), dur: t.duration || '', artist: artistOf(t.artists) });
        }
      });

      return {
        source: 'Discogs',
        id: d.id,
        url: 'https://www.discogs.com/release/' + d.id,
        artist,
        artistSearch: clean((d.artists || [])[0]?.name || artist),
        title: d.title || '',
        year: y && y !== '0000' ? y : '',
        month: mo && mo !== '00' ? mo : '',
        day: da && da !== '00' ? da : '',
        labels: (d.labels || []).map((l) => ({ name: clean(l.name), catno: /^none$/i.test(l.catno || '') ? '' : (l.catno || ''), noCat: /^none$/i.test(l.catno || '') })),
        country: d.country || '',
        formatName: f.name || '',
        boxSet: (d.formats || []).some((x) => x.name === 'Box Set'),
        various: (d.artists || []).some((a) => isVarious(a.name)),
        classical,
        descriptions: (d.formats || []).flatMap((x) => x.descriptions || []),
        formatTexts: (d.formats || []).map((x) => x.text || '').filter(Boolean),
        // testo libero dei soli supporti in vinile/shellac (il colore di un CD allegato non conta)
        vinylTexts: (d.formats || []).filter((x) => /vinyl|lathe|flexi|shellac/i.test(x.name || '')).map((x) => x.text || '').filter(Boolean),
        tracks,
        credits: (d.extraartists || []).map((c) => clean(c.anv || c.name) + ' – ' + c.role + (c.tracks ? ' (' + c.tracks + ')' : '')),
        genres: d.genres || [],
        styles: d.styles || [],
        notes: d.notes || '',
        bonusHeading: (d.tracklist || []).some((t) => t.type_ === 'heading' && /bonus/i.test(t.title || '')),
        compiledBy: (d.extraartists || []).some((c) => /compiled by/i.test(c.role || '') && !c.tracks),
        // "feat." da aggiungere come crediti featured su RYM (per traccia o per l'intera release)
        featured: [...new Set([
          ...(d.tracklist || []).flatMap((t) => [t].concat(t.sub_tracks || []))
            .flatMap((t) => (t.extraartists || []).filter((c) => /featuring/i.test(c.role || '')).map((c) => clean(c.anv || c.name) + (t.position ? ' (' + t.position + ')' : ''))),
          ...(d.extraartists || []).filter((c) => /featuring/i.test(c.role || '')).map((c) => clean(c.anv || c.name) + (c.tracks ? ' (' + c.tracks + ')' : ''))
        ])],
        // interpreti (per la classica: il file under su RYM va a loro)
        performers: [...new Set((d.extraartists || [])
          .filter((c) => /conductor|orchestra|ensemble|choir|chorus|soloist|quartet|trio|violin|viola|cello|piano|soprano|tenor|baritone|mezzo|contralto|harpsichord|organ|guitar|flute|oboe|clarinet|bassoon|horn|trumpet|harp/i.test(c.role || ''))
          .map((c) => clean(c.anv || c.name) + ' (' + c.role + ')'))]
      };
    }
    return;
  }

  // =====================================================================
  //  LATO BANDCAMP (nessuna API: legge i dati già presenti nella pagina)
  // =====================================================================
  if (host.endsWith('bandcamp.com')) {
    if (!/^\/(album|track)\//.test(location.pathname)) return;
    const b = floatingButton(() => {
      try {
        sendToRym(normalizeBandcamp());
      } catch (e) {
        toast('Non riesco a leggere i dati di questa pagina Bandcamp. ' + e.message, false);
      }
    });
    b.title = 'Invia questa release al modulo RYM';

    function readJsonLd() {
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const j = JSON.parse(s.textContent);
          const t = [].concat(j['@type'] || []).join(' ');
          if (/MusicAlbum|MusicRecording/.test(t)) return j;
        } catch (e) { /* blocco non valido: ignora */ }
      }
      return null;
    }

    function readTralbum() {
      const el = document.querySelector('[data-tralbum]');
      if (!el) return null;
      try { return JSON.parse(el.getAttribute('data-tralbum')); } catch (e) { return null; }
    }

    function normalizeBandcamp() {
      const ld = readJsonLd();
      const tr = readTralbum();
      if (!ld && !tr) throw new Error('Dati album non trovati.');
      const isTrack = location.pathname.startsWith('/track/');

      const title = (tr?.current?.title || ld?.name || '').trim();
      const artist = (tr?.artist || ld?.byArtist?.name || '').trim();
      if (!title || !artist) throw new Error('Titolo o artista mancanti.');

      // Etichetta: l'account che pubblica, solo se diverso dall'artista (pagine di label)
      const publisher = (ld?.publisher?.name || '').trim();
      const labels = publisher && publisher.toLowerCase() !== artist.toLowerCase() ? [{ name: publisher, catno: '', noCat: false }] : [];

      // Data, es. "15 Mar 2019 00:00:00 GMT"
      let year = '', month = '', day = '', oldDate = '';
      const dt = new Date(tr?.album_release_date || tr?.current?.release_date || ld?.datePublished || '');
      if (!isNaN(dt)) {
        year = String(dt.getUTCFullYear()); month = pad2(dt.getUTCMonth() + 1); day = pad2(dt.getUTCDate());
        // Bandcamp esiste dal 2008: una data precedente è quella dell'uscita originale, non dell'issue digitale.
        // RYM: se non c'è una fonte affidabile per la data digitale, va lasciata vuota.
        if (+year < 2008) { oldDate = [day, month, year].join('/'); year = month = day = ''; }
      }

      // Scaricabile? (RYM: issue Bandcamp = versione scaricabile, formato lossless se disponibile)
      const tinfo = (tr && Array.isArray(tr.trackinfo)) ? tr.trackinfo : [];
      let downloadable = null;
      if (tr && tr.freeDownloadPage) downloadable = true;
      else if (tinfo.some((t) => t.is_downloadable === true)) downloadable = true;
      else if (tinfo.length && tinfo.every((t) => t.is_downloadable === false)) downloadable = false;

      // Tracce: prima dal blocco data-tralbum, altrimenti dallo schema.org
      let tracks = [];
      if (tr && Array.isArray(tr.trackinfo) && tr.trackinfo.length) {
        tracks = tr.trackinfo.map((t, i) => ({ pos: String(t.track_num || i + 1), title: (t.title || '').replace(/\|/g, '/'), dur: secToTime(t.duration) }));
      } else if (ld?.track?.itemListElement) {
        tracks = ld.track.itemListElement.map((e, i) => ({ pos: String(e.position || i + 1), title: (e.item?.name || '').replace(/\|/g, '/'), dur: secToTime(isoToSec(e.item?.duration)) }));
      } else if (isTrack && ld) {
        tracks = [{ pos: '1', title: (ld.name || '').replace(/\|/g, '/'), dur: secToTime(isoToSec(ld.duration)) }];
      }

      return {
        source: 'Bandcamp',
        url: location.origin + location.pathname,
        artist,
        artistSearch: artist,
        title,
        year, month, day,
        labels,
        country: '',
        formatName: 'File',
        boxSet: false,
        various: isVarious(artist),
        descriptions: [],
        formatTexts: [],
        tracks,
        credits: [],
        typeHint: isTrack ? 'i' : '',
        // tag della pagina (servono per riconoscere le colonne sonore) e testi "about"/"credits"
        styles: [...document.querySelectorAll('.tralbum-tags a, a.tag')].map((a) => a.textContent.trim()).filter(Boolean),
        notes: [...document.querySelectorAll('.tralbum-about, .tralbum-credits')].map((e) => e.textContent).join('\n'),
        cc: !!document.querySelector('#license a[href*="creativecommons.org"], a[href*="creativecommons.org/licenses"]'),
        selfReleased: labels.length === 0,
        streaming: true,
        lossless: downloadable !== false,      // i download Bandcamp includono FLAC/ALAC/WAV
        streamingOnly: downloadable === false,
        downloadUnknown: downloadable === null,
        oldDate
      };
    }
    return;
  }

  // =====================================================================
  //  LATO RYM
  // =====================================================================
  if (!host.endsWith('rateyourmusic.com')) return;
  const form = document.getElementById('release_ac');
  if (!form) return; // solo sulla pagina "Add Release"

  const W = unsafeWindow;
  let D = null;          // release attualmente caricata
  let SRC = 'Discogs';
  let rawSeen = null;    // JSON già letto (per capire se è arrivata una release nuova)
  let filledRaw = null;  // JSON usato per l'ultima compilazione
  let capsMode = null;   // capitalizzazione: null = automatica (dalla lingua), true = inglese, false = solo iniziale
  let durVinyl = false;  // vinili: importa il minutaggio (solo se stampato sul disco)
  // quello che lo script ha modificato, per poterlo annullare prima di compilare un'altra release
  const touched = { attribs: new Set(), notesUrl: '', tracks: false };

  // Dati salvati: solo un oggetto con i campi del tipo atteso (scarta dati corrotti o di versioni strane)
  function sanitize(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    const str = (v) => (v == null ? '' : String(v));
    const arr = (v) => (Array.isArray(v) ? v : []);
    ['descriptions', 'formatTexts', 'vinylTexts', 'credits', 'genres', 'styles', 'performers', 'featured'].forEach((k) => { o[k] = arr(o[k]).filter((x) => typeof x === 'string'); });
    o.labels = arr(o.labels).filter((l) => l && typeof l === 'object').map((l) => ({ name: str(l.name), catno: str(l.catno), noCat: !!l.noCat }));
    o.tracks = arr(o.tracks).filter((t) => t && typeof t === 'object').map((t) => Object.assign({}, t, { pos: str(t.pos), title: str(t.title), dur: str(t.dur), artist: str(t.artist) }));
    ['title', 'artist', 'artistSearch', 'year', 'month', 'day', 'country', 'formatName', 'url', 'notes'].forEach((k) => { o[k] = str(o[k]); });
    return o;
  }

  // Legge i dati salvati (o quelli passati dal listener); true se è arrivata una release più recente
  function loadData(rawArg) {
    const raw = rawArg !== undefined ? rawArg : GM_getValue(KEY);
    if (!raw || raw === rawSeen) return false;
    let parsed;
    try { parsed = sanitize(JSON.parse(raw)); } catch (e) { parsed = null; }
    if (!parsed) { GM_deleteValue(KEY); return false; }
    // mai tornare a una release più vecchia di quella già mostrata
    if (D && (parsed.savedAt || 0) < (D.savedAt || 0)) return false;
    rawSeen = raw;
    D = parsed;
    capsMode = null; // nuova release: capitalizzazione di nuovo automatica
    durVinyl = false;
    SRC = D.source || 'Discogs';
    return true;
  }

  // ---- mappature verso i valori del modulo RYM ----
  const FORMAT = {
    'Vinyl': 95, 'Lathe Cut': 95, 'Flexi-disc': 95, 'Shellac': 96, 'CD': 60, 'CDr': 32, 'DVD': 78, 'DVDr': 100,
    'Blu-ray': 88, 'Cassette': 66, 'Reel-To-Reel': 92, '8-Track Cartridge': 21, 'VHS': 40, 'Minidisc': 48,
    'SACD': 76, 'HDCD': 83, 'DualDisc': 54, 'Laserdisc': 89, 'Acetate': 80, 'DAT': 104, 'DCC': 105,
    'Microcassette': 101, 'Betamax': 41, 'Cylinder': 91, 'UMD': 81, 'VCD': 79, 'File': 58
  };
  const DISC_SIZE = { '12"': 88, '10"': 89, '7"': 90, '5"': 91, '3"': 92, '16"': 93, '11"': 94, '9"': 95, '8"': 96, '6"': 97, '4"': 98 };
  // Descrizioni ufficiali Discogs -> attributi RYM (id verificati sul modulo RYM)
  const ATTRIB = {
    'Remastered': 23, 'Limited Edition': 16, 'Numbered': 73, 'Promo': 11, 'Deluxe Edition': 59, 'Mono': 75,
    'Test Pressing': 108, 'White Label': 107, 'Picture Disc': 31, 'Single Sided': 104, 'Etched': 105,
    'Quadraphonic': 103, 'Enhanced': 63, 'Copy Protected': 61, 'Censored': 47, 'Special Edition': 49,
    'SHM-CD': 86, 'Box Set': 12
  };
  // Velocità: Discogs le mette nelle descrizioni ("33 ⅓ RPM", "7 ½ ips"); regex per tollerare varianti
  const SPEEDS = [
    [/^16\s*(⅔|2\/3)?\s*rpm$/i, 40, '16 rpm'], [/^33\s*(⅓|1\/3)?\s*rpm$/i, 19, '33 rpm'], [/^45\s*rpm$/i, 41, '45 rpm'],
    [/^78\s*rpm$/i, 42, '78 rpm'], [/^80\s*rpm$/i, 112, '80 rpm'],
    [/^3\s*(¾|3\/4)\s*ips$|^3\.75\s*ips$/i, 113, '3¾ IPS'], [/^7\s*(½|1\/2)\s*ips$|^7\.5\s*ips$/i, 114, '7½ IPS']
  ];
  // Peso: su Discogs NON è una descrizione, sta nel testo libero del formato ("180g", "180 Gram", "180gr")
  const WEIGHTS = { 120: 43, 140: 115, 150: 116, 160: 117, 180: 44, 200: 118, 220: 119 };
  const WEIGHT_RE = /\b(120|140|150|160|180|200|220)\s*-?\s*(g|gr|grams?|grammes?)\b/i;
  // Indizi dal testo libero del formato (e dal titolo dove serve), per tutte le spunte "Issue attributes" di RYM.
  // [regex, id RYM, nome, formati RYM ammessi (null = tutti), cerca anche nel titolo]
  const VINYL = [95, 96];
  const OPTICAL = [60, 32, 78, 100, 88, 76, 83, 54, 89, 79, 81];
  const DVD = [78, 100];
  const TEXT_ATTRIBS = [
    // Content
    [/abridged/i, 37, 'Abridged', null, false],
    [/bonus\s*cd/i, 50, 'Bonus CD', null, false],
    [/bonus\s*dvd/i, 51, 'Bonus DVD', null, false],
    [/bonus\s*(usb|flash)/i, 82, 'Bonus Flash Drive', null, false],
    [/bonus\s*tracks?/i, 62, 'Bonus Tracks', null, true],
    [/\bcensored\b|\bclean (version|edit)\b/i, 47, 'Censored', null, true],
    [/copy[\s-]?(protected|control)/i, 61, 'Content/Copy Protected', null, false],
    [/duophonic|re-?channell?ed|electronically re-?processed|simulated stereo|fake stereo/i, 102, 'Duophonic', null, false],
    [/\bmono\b/i, 75, 'Mono', null, false],
    [/quadraphonic|\bquad\b/i, 103, 'Quadraphonic', null, false],
    [/remaster/i, 23, 'Remastered', null, false],
    [/re-?recorded|taylor'?s version/i, 29, 'Re-recorded', null, true],
    [/single[\s-]?sided/i, 104, 'Single-sided', null, false],
    // Release type
    [/\banniversary\b/i, 120, 'Anniversary Edition', null, true],
    [/box\s*set/i, 12, 'Box Set', null, false],
    [/collector'?s edition|special edition/i, 49, 'Collector\'s Edition', null, true],
    [/deluxe (edition|version)/i, 59, 'Deluxe Edition', null, true],
    [/\bexclusive\b/i, 72, 'Exclusive', null, false],
    [/fan\s*club/i, 38, 'Fan Club Release', null, false],
    [/limited (edition|to \d)|\bltd\b/i, 16, 'Limited Edition', null, false],
    [/\bnumbered\b/i, 73, 'Numbered Edition', null, false],
    [/\bpromo\b/i, 11, 'Promo', null, false],
    // Package type
    [/amaray|keep\s*case/i, 67, 'Amaray Case', OPTICAL, false],
    [/mini[\s-]?lp|lp[\s-]?replica|replica (sleeve|jacket)/i, 60, 'CD Sized Album Replica', OPTICAL, false],
    [/digibook/i, 109, 'Digibook', null, false],
    [/digi-?pac?k/i, 21, 'Digipak', null, false],
    [/gatefold/i, 30, 'Gatefold', null, false],
    [/hand-?made/i, 33, 'Handmade', null, false],
    [/jewel\s*case/i, 76, 'Jewel Case (DVD only)', DVD, false],
    [/slide-?pac|music-?pac/i, 110, 'MusicPac / SlidePac', OPTICAL, false],
    [/(card(board)?|paper)[\s-]?sleeve|cardsleeve/i, 81, 'Paper/Cardboard Sleeve', OPTICAL, false],
    [/\bslip-?(case|cover)\b|\bo-?card\b/i, 111, 'Slipcase / O-Card', null, false],
    [/\busb\b|flash\s*drive/i, 80, 'USB/Flash Drive', null, false],
    // Vinyl specs
    [/etched/i, 105, 'Etched', VINYL, false],
    [/flexi/i, 66, 'Flexi-disc', VINYL, false],
    [/multi-?groove/i, 106, 'Multi-Groove', VINYL, false],
    [/picture\s*disc/i, 31, 'Picture Disc', VINYL, false],
    [/test\s*pressing/i, 108, 'Test Pressing', VINYL, false],
    [/white\s*label/i, 107, 'White Label', VINYL, false],
    // Manufacturing
    [/\bgold\s*(cd|disc)\b|24\s*k(t|arat)?\b/i, 52, 'Gold Disc', OPTICAL, false],
    [/\bshm\b|shm-?(cd|sacd)/i, 86, 'SHM', OPTICAL, false]
  ];

  // Colored vinyl: qualunque colore nel testo del vinile, tranne il nero e le parti che parlano d'altro (etichette, copertina…)
  const COLOR_WORDS = /\b(red|blue|green|yellow|orange|pink|purple|violet|white|clear|transparent|translucent|gold(en)?|silver|marbled?|marble|splatter(ed)?|swirl(ed)?|smok(e|y)|gr[ae]y|brown|colou?red|multi-?colou?r(ed)?|cream|bone|beige|olive|teal|magenta|turquoise|ruby|amber|tan|maroon|mint|lilac|lavender|aqua|cyan|coral|peach|bronze|copper|rose|crystal|milky|opaque|neon|glow[\s-]in[\s-]the[\s-]dark|galaxy|tri-?colou?r|coke\s*bottle|sea\s*(blue|glass|foam)|oxblood|burgundy|indigo|navy|lime|khaki|sand|ivory|pearl|fluorescent|tie[\s-]dye|cloudy|vortex|haze|bubblegum)\b/i;
  const NOT_VINYL = /\b(labels?|sleeves?|cover|insert|obi|jacket|poster|sticker|printed|print|booklet|inner|outer|spine|lettering|logo|box|case|shell)\b/i;
  function isColored(texts) {
    return texts.join(',').split(/[,;\/+&]|\band\b|\bwith\b/i).some((part) => COLOR_WORDS.test(part) && !NOT_VINYL.test(part));
  }

  // ---- Attributi di performance (wiki "Release attributes" §1) ----
  // Basati sui titoli delle tracce: soglie RYM >50% (o ≥20% ciascuno se insieme superano il 50%).
  const PERF = {
    // "(Live)", "[Live at…]", "Live at/in/from…", "- Live" a fine titolo (non "Band - Live Forever")
    live: /\(live\b|\[live\b|\blive (at|in|from|on|version|recording)\b|\s[-–]\s*live(\s+(at|in|from|on|version|recording)\b|\s*$)/i,
    remix: /\b(remix(ed)?|rmx|re-?mix|rework(ed)?|re-?edit|vip mix|dub mix)\b/i
  };
  // Contenuti da "Additional release" (§1.2.2): [regex, id, nome]
  const ADDITIONAL = [
    [/\binstrumentals?\b/i, 127, 'Instrumental'],
    [/a\s?capp?ella/i, 124, 'A capella'],
    [/\(demo\b|\[demo\b|\bdemo (version|recording|take)\b|\s[-–]\s*demo\b/i, 129, 'Demo recordings'],
    [/karaoke/i, 125, 'Karaoke'],
    [/\bstems\b|\(stem\)|\bstem (mix|version)\b/i, 126, 'Stems'],
    [/\b(peel|bbc|radio|studio|maida vale|kexp|tiny desk|daytrotter|kcrw|live) sessions?\b|\([^)]*\bsession\b[^)]*\)/i, 131, 'Live sessions'],
    [/outtakes?|alternate (take|version|mix)|\balt\.? take\b|\btake \d+\b/i, 128, 'Outtakes'],
    [/interview/i, 14, 'Interview'],
    [/commentary/i, 130, 'Commentary']
  ];

  // ---- Paesi: Discogs -> nomi RYM ----
  // Discogs usa sigle (US, UK) e regioni. RYM accetta i paesi e "Europe"; le altre aree restano vuote (vuoto = mondiale).
  // Elenco ufficiale dei paesi di RYM (dal suggerimento del modulo "Add Release": /sourced/autosuggest.js?pre=country)
  const RYM_COUNTRIES = ['Europe', 'Asia', 'Afghanistan', 'Albania', 'Algeria', 'American Samoa', 'Andorra', 'Angola', 'Anguilla', 'Antarctica', 'Antigua and Barbuda', 'Argentina', 'Armenia', 'Aruba', 'Australia', 'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bermuda', 'Bhutan', 'Bolivia', 'Bonaire, Sint Eustatius, and Saba', 'Bosnia-Herzegovina', 'Botswana', 'Bouvet Island', 'Brazil', 'British Indian Ocean Territory', 'British Virgin Islands', 'Brunei Darussalam', 'Bulgaria', 'Burkina Faso', 'Burma', 'Burundi', 'Cambodia', 'Cameroon', 'Canada', 'Canary Islands', 'Cape Verde', 'Cayman Islands', 'Central African Republic', 'Chad', 'Chile', 'China', 'Christmas Island', 'Cocos Island', 'Colombia', 'Comoros', 'Congo', 'Cook Islands', 'Costa Rica', 'Croatia', 'Cuba', 'Curaçao', 'Cyprus', 'Czechia', 'Czechoslovakia (Former)', 'Democratic Republic of Congo', 'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'East Timor', 'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Falkland Islands', 'Faroe Islands', 'Fiji', 'Finland', 'France', 'French Guiana', 'French Southern Territories', 'FYRO Macedonia', 'Gabon', 'Gambia', 'Georgia', 'Georgia & Sandwich Islands', 'Germany', 'Ghana', 'Gibraltar', 'Greece', 'Greenland', 'Grenada', 'Guadeloupe', 'Guam', 'Guatemala', 'Guernsey', 'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti', 'Heard Island and McDonald Islands', 'Honduras', 'Hong Kong', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Isle of Man', 'Israel', 'Italy', 'Ivory Coast', 'Jamaica', 'Japan', 'Jersey', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 'Kosovo', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Macau', 'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Martinique', 'Mauritania', 'Mauritius', 'Mayotte', 'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Montserrat', 'Morocco', 'Mozambique', 'Myanmar (Former Burma)', 'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'Netherlands Antilles', 'New Caledonia', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'Niue', 'Norfolk Island', 'Northern Marianas', 'North Korea', 'Norway', 'Oman', 'Pakistan', 'Palau', 'Palestine National Authority', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Pitcairn Islands', 'Poland', 'Polynesia', 'Portugal', 'Puerto Rico', 'Qatar', 'Reunion', 'Romania', 'Russian Federation', 'Rwanda', 'Saint Barthélemy', 'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Martin (French)', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Sao Tome', 'Saudi Arabia', 'Senegal', 'Serbia', 'Serbia and Montenegro (obsolete)', 'Seychelles', 'Sierra Leone', 'Singapore', 'Sint Maarten (Dutch part)', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'St. Helena', 'St Pierre And Miquelon', 'Sudan', 'Suriname', 'Svalbard And Jan Mayen', 'Sweden', 'Switzerland', 'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tokelau', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Turks And Caicos Islands', 'Tuvalu', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'US Minor Outlying Islands', 'US-Western Sahara', 'Uzbekistan', 'Vanuatu', 'Vatican City State', 'Venezuela', 'Vietnam', 'Virgin Islands', 'Wallis And Futuna Islands', 'Yemen', 'Zambia', 'Zimbabwe'];
  const RYM_BY_LOW = new Map(RYM_COUNTRIES.map((n) => [n.toLowerCase(), n]));
  // Nomi Discogs diversi da quelli RYM (chiave in minuscolo; più paesi = elenco)
  const COUNTRY_ALIAS = {
    'us': 'United States', 'usa': 'United States', 'u.s.': 'United States', 'u.s.a.': 'United States',
    'uk': 'United Kingdom', 'u.k.': 'United Kingdom', 'england': 'United Kingdom', 'scotland': 'United Kingdom',
    'wales': 'United Kingdom', 'northern ireland': 'United Kingdom', 'great britain': 'United Kingdom',
    'benelux': ['Belgium', 'Netherlands', 'Luxembourg'],
    'russia': 'Russian Federation', 'czech republic': 'Czechia', 'czechoslovakia': 'Czechoslovakia (Former)',
    'bosnia & herzegovina': 'Bosnia-Herzegovina', 'bosnia and herzegovina': 'Bosnia-Herzegovina',
    'antigua & barbuda': 'Antigua and Barbuda', 'trinidad & tobago': 'Trinidad and Tobago',
    'serbia and montenegro': 'Serbia and Montenegro (obsolete)', 'serbia & montenegro': 'Serbia and Montenegro (obsolete)',
    'north macedonia': 'FYRO Macedonia', 'macedonia': 'FYRO Macedonia', 'moldova, republic of': 'Moldova',
    'brunei': 'Brunei Darussalam', 'myanmar': 'Myanmar (Former Burma)', "côte d'ivoire": 'Ivory Coast', "cote d'ivoire": 'Ivory Coast',
    'congo, republic of the': 'Congo', 'republic of the congo': 'Congo', 'congo, democratic republic of the': 'Democratic Republic of Congo',
    'democratic republic of the congo': 'Democratic Republic of Congo', 'zaire': 'Democratic Republic of Congo',
    'swaziland': 'Eswatini', 'macao': 'Macau', 'micronesia, federated states of': 'Micronesia', 'palestine': 'Palestine National Authority',
    'vatican city': 'Vatican City State', 'vatican': 'Vatican City State', 'réunion': 'Reunion', 'sao tome and principe': 'Sao Tome',
    'são tomé and príncipe': 'Sao Tome', 'wallis and futuna': 'Wallis And Futuna Islands', 'saint pierre and miquelon': 'St Pierre And Miquelon',
    'saint helena': 'St. Helena', 'us virgin islands': 'Virgin Islands', 'u.s. virgin islands': 'Virgin Islands',
    'northern mariana islands': 'Northern Marianas', 'french polynesia': 'Polynesia', 'pitcairn': 'Pitcairn Islands',
    'heard and mcdonald islands': 'Heard Island and McDonald Islands', 'south georgia and the south sandwich islands': 'Georgia & Sandwich Islands',
    'cocos (keeling) islands': 'Cocos Island', 'saint martin': 'Saint Martin (French)', 'sint maarten': 'Sint Maarten (Dutch part)',
    'bonaire': 'Bonaire, Sint Eustatius, and Saba', 'caribbean netherlands': 'Bonaire, Sint Eustatius, and Saba',
    'korea, republic of': 'South Korea', 'republic of korea': 'South Korea', 'iran, islamic republic of': 'Iran',
    'syrian arab republic': 'Syria', 'viet nam': 'Vietnam', 'lao pdr': 'Laos', 'türkiye': 'Turkey', 'turkiye': 'Turkey',
    'the netherlands': 'Netherlands', 'holland': 'Netherlands', 'east timor': 'East Timor', 'timor-leste': 'Timor-Leste'
  };
  // Nomi con "&", "and" o virgole da non spezzare (chiavi dell'elenco sopra e nomi RYM composti)
  const COMPOUND = Object.keys(COUNTRY_ALIAS).concat(RYM_COUNTRIES.map((n) => n.toLowerCase()))
    .filter((k) => /,|&|\band\b/i.test(k)).sort((a, b) => b.length - a.length);
  // Aree di Discogs senza corrispondenza su RYM (RYM accetta solo "Europe" e "Asia"): restano vuote (vuoto = mondiale)
  const REGIONS = /^(worldwide|scandinavia|north america|south america|central america|latin america|africa|australasia|oceania|middle east|gulf cooperation council|eastern europe|unknown)$/i;
  function mapCountries(c) {
    const out = [], skipped = [], unknown = [];
    let txt = c || '';
    const kept = [];
    COMPOUND.forEach((k) => {
      const re = new RegExp(escRe(k), 'i');
      if (re.test(txt)) { kept.push(k); txt = txt.replace(re, '§' + (kept.length - 1) + '§'); }
    });
    txt.split(/\s*(?:,|&|\band\b)\s*/i).map((x) => x.trim()).filter(Boolean).forEach((p0) => {
      const p = p0.replace(/§(\d+)§/g, (all, i) => kept[+i]);
      const alias = COUNTRY_ALIAS[p.toLowerCase()];
      if (alias) [].concat(alias).forEach((a) => out.push(a));
      else if (RYM_BY_LOW.has(p.toLowerCase())) out.push(RYM_BY_LOW.get(p.toLowerCase()));
      else if (REGIONS.test(p)) skipped.push(p);
      else unknown.push(p); // es. "USSR", "Yugoslavia": non esistono nell'elenco RYM
    });
    return { value: [...new Set(out)].join(', '), skipped, unknown };
  }

  // ---- regole RYM sui tipi di release (wiki "Release types") ----
  const TYPE_NAME = { s: 'Album', c: 'Compilation', e: 'EP', i: 'Single', m: 'Mixtape', x: 'Additional', j: 'DJ Mix', b: 'Bootleg' };
  // formati a due lati: titolo del singolo = "Brano A / Brano B"
  const TWO_SIDED = ['Vinyl', 'Lathe Cut', 'Flexi-disc', 'Shellac', 'Cassette', 'Microcassette', 'Reel-To-Reel', '8-Track Cartridge', 'Acetate'];
  const ALBUM_MIN = 28 * 60; // RYM: un album dura di solito almeno 28 minuti
  const VERSION_WORDS = /\b(remix(es)?|rmx|mix|edit|dub|version|instrumental|inst|instr|rework|re-?edit|radio|extended|club|a ?capp?ella|vip|bootleg|reprise|mono|stereo|live|demo|acoustic|original|remaster(ed)?|vocal|beats|clean|explicit|dirty|feat|ft|featuring)\b/i;

  // "3:45" / "1:02:05" -> secondi; vuoto -> null
  function durSec(t) {
    if (!t) return null;
    const p = String(t).split(':').map(Number);
    if (p.some(isNaN)) return null;
    return p.reduce((a, v) => a * 60 + v, 0);
  }

  // nome "generico" del brano: senza sottotitoli di versione ("(Radio Edit)", "[Dub Mix]", "- Club Mix")
  function genericTitle(t) {
    let s = (t || '').trim(), prev;
    do {
      prev = s;
      s = s.replace(/\s*[(\[]([^)\]]*)[)\]]\s*$/, (m, inner) => (VERSION_WORDS.test(inner) ? '' : m));
      // "- Club Mix": solo se la parte dopo il trattino FINISCE con una parola di versione
      // (così "Band - Live Forever" non viene tagliato)
      s = s.replace(/\s+[-–]\s+[^-–]*$/, (m) => (/\b(remix|rmx|mix|edit|dub|version|instrumental|rework|re-?edit|vip|a ?capp?ella|vocal|beats|clean|explicit|dirty)\s*$/i.test(m) ? '' : m));
    } while (s !== prev);
    return s.trim();
  }

  // "EP", "E.P.", "E.P", "(EP)", "Mini Album", "Mini-Album"
  const hasEpMarker = (title) => /(^|[\s(\[:\-–])e\.?\s?p\.?(?=$|[\s)\]:,\-–])/i.test(title || '') || /\bmini[\s-]?album\b/i.test(title || '');

  // Restituisce { type, reason, sure }: "sure" = dichiarato dalla fonte, altrimenti stima
  function guessType(fmt, size) {
    const desc = D.descriptions || [];
    const tracks = (D.tracks || []).filter((t) => !t.header); // le intestazioni delle opere non sono tracce
    const n = tracks.length;
    const known = tracks.map((t) => durSec(t.dur)).filter((x) => x != null);
    const sum = known.reduce((a, b) => a + b, 0);
    const complete = n > 0 && known.length === n;
    const long = sum >= ALBUM_MIN; // anche con durate parziali, se già si superano i 28 minuti
    const mins = complete ? Math.round(sum / 60) + ' min' : (sum ? 'oltre ' + Math.round(sum / 60) + ' min' : 'durata ignota');

    if (desc.includes('Unofficial Release')) return { type: 'b', reason: 'non ufficiale su Discogs', sure: true };
    if (desc.includes('Mixed')) return { type: 'j', reason: '"Mixed" su Discogs', sure: true };
    if (desc.includes('Mixtape')) return { type: 'm', reason: '"Mixtape" su Discogs', sure: true };
    if (desc.includes('Compilation')) return { type: 'c', reason: '"Compilation" su Discogs', sure: true };
    if (desc.includes('EP') || desc.includes('Mini-Album')) return { type: 'e', reason: 'EP su Discogs', sure: true };
    if (hasEpMarker(D.title)) return { type: 'e', reason: 'EP nel titolo', sure: true };
    if (desc.includes('Single') || desc.includes('Maxi-Single')) return { type: 'i', reason: 'Single su Discogs', sure: true };
    if (D.typeHint === 'i') return { type: 'i', reason: 'pagina di una singola traccia', sure: true };
    if (desc.includes('Album') || desc.includes('LP')) return { type: 's', reason: 'Album/LP su Discogs', sure: true };

    // --- stima ---
    // Senza tracklist (frequente su Discogs) restano solo gli indizi del formato
    if (!n) {
      if (size === '7"') return { type: 'i', reason: '7" senza tracklist', sure: false };
      if (fmt === 95 && size === '12"') return { type: 'i', reason: '12" senza "LP" né tracklist (tipico 12" club)', sure: false };
      return { type: 's', reason: 'nessuna tracklist', sure: false, unknown: true };
    }
    const bases = new Set(tracks.map((t) => genericTitle(t.title).toLowerCase()));
    if (n >= 2 && bases.size === 1) return { type: 'i', reason: n + ' versioni dello stesso brano', sure: false };
    // vinile 7"/10"/12" che Discogs non indica come LP: fino a 3 tracce singolo; da 4 a 6 EP,
    // salvo durata totale oltre 30 minuti (album). I 12" da club superano spesso i 28 minuti di un album.
    if (fmt === 95 && ['7"', '10"', '12"'].includes(size) && !desc.includes('LP') && n <= 6) {
      if (n <= 3) return { type: 'i', reason: size + ' non LP, ' + n + ' tracce, ' + mins, sure: false };
      if (sum > 30 * 60) return { type: 's', reason: size + ' non LP, ' + n + ' tracce ma ' + mins, sure: false };
      return { type: 'e', reason: size + ' non LP, ' + n + ' tracce, ' + mins, sure: false };
    }
    if (n <= 3) {
      if (long) return { type: 's', reason: n + ' tracce ma ' + mins, sure: false };
      return { type: 'i', reason: n + ' tracce, ' + mins, sure: false };
    }
    if (size === '7"' && n <= 4) return { type: 'e', reason: '7" con ' + n + ' tracce', sure: false };
    if (n <= 7) {
      if (long) return { type: 's', reason: n + ' tracce, ' + mins, sure: false };
      return { type: 'e', reason: n + ' tracce, ' + mins, sure: false };
    }
    return { type: 's', reason: n + ' tracce, ' + mins, sure: false };
  }

  // Titolo standard RYM per i singoli fisici (wiki "Release types" §4.1-4.2)
  function singleTitle(tracks) {
    const list = (tracks || []).filter((t) => !t.header);
    // titolo senza le parentesi finali: "As Long As It's Groovy (Shortly)" -> "As Long As It's Groovy"
    const base = (t) => (t || '').replace(/(\s*[(\[][^)\]]*[)\]])+\s*$/, '').trim();
    const count = {};
    const titleOf = (t) => t.plain || t.title; // nei V/A senza il nome dell'artista
    list.forEach((t) => { const b = base(titleOf(t)).toLowerCase(); count[b] = (count[b] || 0) + 1; });
    const seen = new Map();
    list.forEach((t) => {
      let g = genericTitle(titleOf(t));
      const b = base(titleOf(t));
      if (b && count[b.toLowerCase()] > 1) g = b; // stesso brano in più tracce: un solo nome, senza parentesi
      if (g && !seen.has(g.toLowerCase())) seen.set(g.toLowerCase(), g);
    });
    const names = [...seen.values()];
    if (!names.length) return '';
    return TWO_SIDED.includes(D.formatName) ? names.join(' / ') : names[0];
  }


  // =====================================================================
  //  MAIUSCOLE RYM (wiki "Capitalization" e "Non-English Latin language capitalization")
  // =====================================================================
  // Inglese: maiuscola a ogni parola tranne articoli, congiunzioni coordinanti e preposizioni brevi;
  // sempre maiuscole la prima e l'ultima parola di ogni sezione (dopo : ? ! — ( " e " / ").
  // Altre lingue latine: solo la prima parola e i nomi propri -> non correggibile in automatico.
  const LOWER_WORDS = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'yet', 'so', 'as', 'at', 'by', 'in', 'of', 'on', 'to',
    'vs', 'vs.', 'v.', 'etc', 'etc.', "o'", "'n'", "n'", "'n"]);
  const NEVER_FORCE = new Set(['vs', 'vs.', 'v.', 'etc', 'etc.', "o'", "'n'", "n'", "'n"]); // minuscole anche se ultime ("Time After Time etc.")
  const AMBIGUOUS = new Set(['as', 'by', 'in', 'on', 'to', 'but', 'so']); // possono essere avverbi -> maiuscola
  const ACRONYMS = new Set(['DJ', 'MC', 'TV', 'USA', 'UK', 'NYC', 'NY', 'OK', 'EP', 'LP', 'CD', 'DVD', 'BBC', 'MTV', 'VIP', 'UFO', 'USSR', 'R&B', 'BPM', 'SOS', 'ASAP', 'FM', 'DC', 'AI', 'EU', 'UN']);
  const ROMAN = /^X{0,3}(IX|IV|V?I{0,3})$/;
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function capFirst(p, mode) {
    const s = mode === 'mixed' ? p : p.toLowerCase();
    const i = s.search(/[\p{L}\p{N}]/u);
    if (i < 0 || /\p{N}/u.test(s.charAt(i))) return s; // "1st" resta "1st"
    return s.slice(0, i) + s.charAt(i).toUpperCase() + s.slice(i + 1);
  }

  function capPiece(p, forceFirst, forceLast, mode, flags) {
    if (!/\p{L}/u.test(p)) return p;
    const key = p.replace(/[’‘]/g, "'").toLowerCase();
    if (/^(\p{L}\.){2,}\p{L}?\.?$/u.test(p) && key !== 'a.k.a.') return mode === 'mixed' ? p : p.toUpperCase(); // R.E.M.
    if (mode === 'mixed' && /\p{Lu}/u.test(p.replace(/^['’]+/, '').slice(1))) return p; // camelcase o sigla già scritta (McCartney, DJ, iPad); l'apostrofo iniziale non conta ("'Til")
    if (mode !== 'mixed') {
      const up = p.toUpperCase();
      if (ACRONYMS.has(up)) return up;
      if (mode === 'upper' && up.length >= 2 && ROMAN.test(up)) return up; // numeri romani
    }
    if (key === 'i' || /^i'/.test(key)) return 'I' + p.slice(1).toLowerCase(); // I, I'm, I'll
    const force = forceFirst || (forceLast && !NEVER_FORCE.has(key));
    if (LOWER_WORDS.has(key) && !force) {
      if (AMBIGUOUS.has(key) && (mode !== 'mixed' || /^\p{Lu}/u.test(p))) flags.push(key);
      return p.toLowerCase();
    }
    return capFirst(p, mode);
  }

  function capWord(token, isFirst, isLast, mode, flags) {
    const m = token.match(/^([^\p{L}\p{N}'’]*)(.*?)([^\p{L}\p{N}'’.&]*)$/u);
    const pieces = m[2].split('-'); // composti col trattino: ogni parte come parola a sé ("Will-o'-the-Wisp", "Drive-In")
    const out = pieces.map((p, k) => capPiece(p, isFirst && k === 0, isLast && k === pieces.length - 1, mode, flags));
    return m[1] + out.join('-') + m[3];
  }

  function capSegment(seg, mode, flags) {
    const tokens = seg.split(/(\s+)/);
    const words = tokens.map((t, i) => (/[\p{L}\p{N}]/u.test(t) ? i : -1)).filter((i) => i >= 0);
    const first = words[0], last = words[words.length - 1];
    return tokens.map((t, i) => (words.includes(i) ? capWord(t, i === first, i === last, mode, flags) : t)).join('');
  }

  // Regole inglesi su un titolo. "protect" = nomi d'artista da lasciare come sono ("The Best of The Temptations")
  function capEN(str, protect) {
    const src = str || '';
    const letters = src.replace(/[^\p{L}]/gu, '');
    const mode = !letters ? 'mixed' : letters === letters.toUpperCase() ? 'upper' : letters === letters.toLowerCase() ? 'lower' : 'mixed';
    const flags = [];
    const parts = src.split(/(\s*[:?!—()"“”\[\]]\s*|\s+\/\s+|\s+[-–]\s+)/);
    let text = parts.map((seg, i) => (i % 2 ? seg : capSegment(seg, mode, flags))).join('');
    (protect || []).forEach((name) => {
      if (!name || name.length < 3 || isVarious(name)) return;
      const re = new RegExp('(^|[^\\p{L}])(' + escRe(name) + ')(?=$|[^\\p{L}])', 'giu');
      text = text.replace(re, (all, pre) => pre + name);
    });
    return { text, flags, mode };
  }

  // Titoli non inglesi (wiki "Non-English Latin language capitalization"): maiuscola solo la prima parola
  // del titolo e di ogni sezione (dopo . : ? ! — ( " e " / "), il resto in minuscolo.
  // Restano come sono: sigle (DJ, R.E.M.), camelcase, numeri romani, abbreviazioni (Op., Vol., St.) e il nome dell'artista.
  // I nomi propri non si possono riconoscere: vanno controllati a mano.
  const ACRONYMS_SAFE = new Set(['DJ', 'MC', 'TV', 'USA', 'UK', 'NYC', 'CD', 'DVD', 'LP', 'EP', 'BBC', 'MTV', 'VIP', 'UFO', 'USSR', 'R&B', 'BPM', 'SOS', 'FM']);
  function sentencePiece(p, isFirst, mode) {
    if (!/\p{L}/u.test(p)) return p;
    // articolo eliso: "L'Uomo" -> "L'uomo", "Dell'Amore" -> "Dell'amore"
    const el = p.match(/^(\p{L}{1,4}['’])(\p{L}.*)$/u);
    if (el) return (isFirst ? capFirst(el[1].toLowerCase(), 'lower') : el[1].toLowerCase()) + sentencePiece(el[2], false, mode);
    if (/^(\p{L}\.){2,}\p{L}?\.?$/u.test(p)) return mode === 'mixed' ? p : p.toUpperCase();      // R.E.M.
    if (mode === 'mixed' && /\p{Lu}/u.test(p.replace(/^['’]+/, '').slice(1))) return p;            // DJ, McCartney (non "'Ntussicatu")
    if (mode === 'mixed' && /^\p{Lu}\p{Ll}{0,3}\.$/u.test(p)) return p;                           // Op., Vol., St., Nr.
    if (mode !== 'mixed' && ACRONYMS_SAFE.has(p.toUpperCase())) return p.toUpperCase();
    if (mode === 'upper' && p.length >= 2 && ROMAN.test(p)) return p;                              // II, IV
    const low = p.toLowerCase();
    return isFirst ? capFirst(low, 'lower') : low;
  }
  function capSentence(str, protect) {
    const src = str || '';
    const letters = src.replace(/[^\p{L}]/gu, '');
    const mode = !letters ? 'mixed' : letters === letters.toUpperCase() ? 'upper' : letters === letters.toLowerCase() ? 'lower' : 'mixed';
    const parts = src.split(/(\s*[:?!—()"“”\[\]]\s*|\.\s+|\s+\/\s+|\s+[-–]\s+)/);
    let text = parts.map((seg, i) => {
      if (i % 2) return seg;
      let first = true;
      return seg.split(/(\s+)/).map((tok) => {
        if (!/[\p{L}\p{N}]/u.test(tok)) return tok;
        const m = tok.match(/^([^\p{L}\p{N}'’]*)(.*?)([^\p{L}\p{N}'’.&]*)$/u);
        const out = m[2].split('-').map((p, k) => sentencePiece(p, first && k === 0, mode)).join('-');
        first = false;
        return m[1] + out + m[3];
      }).join('');
    }).join('');
    (protect || []).forEach((name) => {
      if (!name || name.length < 3 || isVarious(name)) return;
      const re = new RegExp('(^|[^\\p{L}])(' + escRe(name) + ')(?=$|[^\\p{L}])', 'giu');
      text = text.replace(re, (all, pre) => pre + name);
    });
    return text;
  }

  // Lingua stimata dall'insieme di titolo + tracce (parole frequenti di ogni lingua)
  const LANG_WORDS = {
    en: 'the and of you your my me i in on to is it its love be all for with this that we are not what when dont cant im night day time from at by an so up out down baby girl heart man world one get go got just like let make never now oh way will been was were have has do yes into over as no he she they our his her but or if off only more how why who there here back again keep eyes long see gonna wanna gotta die everybody everybodys nobody somebody feel need want know say take give tell think look find good new old little big life home light dream lost mind free away high run dance music sky blue black fire',
    it: 'il lo la le gli i di del della dello dei delle degli che e è non per una un uno con ma mi ti si sei sono nel nella al alla ai come cosa quando tu io noi mio mia tuo tua ancora notte cuore vita sempre più perché se questa questo in',
    es: 'el los las del de que y en un una por con para mi tu te no es amor corazón noche vida como pero más sin yo soy eres está la',
    fr: 'le les des du de et est un une pour avec dans sur je tu il nous vous mon ma mes ton ta pas qui que au aux amour nuit cest jai ne la',
    de: 'der die das und ist ich du nicht ein eine mit von zu im auf für dem den wir sie es liebe nacht auch in',
    pt: 'o os as do da dos das que e um uma não em no na com por para meu minha você amor coração eu de',
    nl: 'de het een en van ik je niet op met voor zijn wat jij mijn in is'
  };
  const LANG_SETS = Object.fromEntries(Object.entries(LANG_WORDS).map(([k, v]) => [k, new Set(v.split(' '))]));
  const LANG_NAME = { en: 'inglese', it: 'italiano', es: 'spagnolo', fr: 'francese', de: 'tedesco', pt: 'portoghese', nl: 'olandese', xx: 'non inglese' };

  // Riserva quando non ci sono parole frequenti: nei titoli italiani/spagnoli/portoghesi e nei dialetti
  // (siciliano, napoletano: -u) quasi tutte le parole finiscono in a/i/o/u, in quelli inglesi quasi mai.
  // Le parole inglesi comuni ("you") non contano. Restituisce 'xx' (non inglese), 'en' o 'unknown'.
  function vowelGuess(text, hi, lo) {
    const words = (text || '').toLowerCase().replace(/[’']/g, '').split(/[^\p{L}]+/u).filter((w) => w.length >= 3 && !LANG_SETS.en.has(w));
    if (words.length < 2) return 'unknown';
    const r = words.filter((w) => /[aiouàòìùú]$/.test(w)).length / words.length;
    return r >= hi ? 'xx' : r <= lo ? 'en' : 'unknown';
  }

  function detectLang(text, perTitle) {
    const score = {};
    let hits = 0; // parole riconosciute in almeno una lista
    Object.keys(LANG_SETS).forEach((k) => { score[k] = 0; });
    // via le contrazioni inglesi ("o'", "'n'") che sembrerebbero articoli di altre lingue
    (text || '').toLowerCase().replace(/[’]/g, "'").replace(/(^|\s)(o|n)'(?=\s|$)|'n'/g, ' ').replace(/'/g, '').split(/[^\p{L}]+/u).filter(Boolean).forEach((w) => {
      const langs = Object.keys(LANG_SETS).filter((k) => LANG_SETS[k].has(w));
      if (langs.length) hits++;
      langs.forEach((k) => { score[k] += 1 / langs.length; });
    });
    // in un singolo titolo una sola parola non basta ("Original Sin": "sin" è anche spagnolo)
    if (perTitle && hits < 2) return vowelGuess(text, 0.6, 0.2);
    const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
    const clear = ranked[0][1] >= 1 && !(ranked[1][1] > 0 && ranked[0][1] < 1.5 * ranked[1][1]); // non troppo incerto
    if (clear) return ranked[0][0];
    // indizi deboli ma tutti dalla stessa parte: solo parole di lingue non inglesi ("la", "del") -> non inglese
    const other = Object.keys(score).filter((k) => k !== 'en').reduce((a, k) => a + score[k], 0);
    if (score.en === 0 && other >= 0.5) return 'xx';
    if (other === 0 && score.en >= 0.5) return 'en';
    return perTitle ? vowelGuess(text, 0.6, 0.2) : vowelGuess(text, 0.5, 0.25);
  }

  // Posizioni delle tracce nello standard RYM (solo numeri o lato+numero):
  //  - punto finale e prefisso del supporto: "1." -> "1", "CD.1" -> "1", "DVD 3" -> "3", "CD.7a" -> "7a"
  //  - più dischi: "1-1", "CD2-03", "2.4" -> "1.1", "2.3", "2.4" (un solo disco: "1-5" -> "5")
  //  - supporti diversi (CD + DVD): una riga senza numero "CD" / "DVD" prima delle rispettive tracce,
  //    numerazione a due livelli 1.x / 2.x
  //  - lati: "A01" -> "A1"; lati non standard ("AA", "AA1", "BB") -> A, B, C... in ordine
  //  - un solo brano sul lato: "A1" -> "A"
  //  - numeri: "01" -> "1"
  const MEDIA_LABEL = { cd: 'CD', dvd: 'DVD', bluray: 'Blu-ray', bd: 'Blu-ray', sacd: 'SACD', vhs: 'VHS' };
  function normPositions(rows) {
    const tracks = rows.filter((t) => !t.header);
    const discRe = /^(?:disc|disk)?\s*(\d+)\s*[-–.]\s*0*(\d+)([a-z]?)$/i;
    const sideRe = /^([A-Z])(\1*)\s*0*(\d*)((?:[a-z]|\.\d+|\.[a-z])?)$/; // "A", "AA2", "A01", "A1a"

    // 1) punto finale e prefisso del supporto
    tracks.forEach((t) => {
      let p = (t.pos || '').trim().replace(/\.$/, '');
      const m = p.match(/^(cd|dvd|blu-?ray|bd|sacd|vhs)\s*[.:\-]?\s*(\d.*)$/i);
      if (m) { t.media = MEDIA_LABEL[m[1].toLowerCase().replace('-', '')]; p = m[2]; }
      t.pos = p;
    });

    // 2) numero di disco ("1-3", "2.10")
    tracks.forEach((t) => {
      const m = t.pos.match(discRe);
      if (m) { t.disc = +m[1]; t.pos = m[2] + m[3]; }
    });

    // 3) lati del vinile/cassetta
    const side = new Map(); // traccia -> { s: lato, n: numero, r: resto }
    tracks.forEach((t) => {
      if (t.disc || t.media) return;
      const m = t.pos.match(sideRe);
      if (!m) return;
      side.set(t, { s: (m[1] + m[2]).toUpperCase(), n: m[3], r: m[4] });
    });
    // Lettera ripetuta senza numero ("BB", "BBB") quando il lato esiste già: è la traccia 2, 3… di quel lato
    // (A, B, BB -> A, B1, B2). Eccezione: "A" + "AA" senza lato B è un singolo double A-side, AA è il retro (-> B).
    const singles = new Set([...side.values()].filter((v) => v.s.length === 1).map((v) => v.s));
    side.forEach((v) => {
      const X = v.s[0];
      if (v.s.length > 1 && !v.n && !v.r && singles.has(X) && (X !== 'A' || singles.has('B'))) { v.n = String(v.s.length); v.s = X; }
    });
    const order = [];
    side.forEach((v) => { if (!order.includes(v.s)) order.push(v.s); });
    const remap = order.some((x) => x.length > 1); // "AA" & co. rimasti: rinomina tutti i lati in ordine
    const letter = {};
    order.forEach((x, i) => { letter[x] = remap ? String.fromCharCode(65 + i) : x; });
    const perSide = {};
    side.forEach((v) => { perSide[v.s] = (perSide[v.s] || 0) + 1; });
    // su un lato con più tracce, quella senza numero è la prima ("B" -> "B1")
    side.forEach((v) => { if (perSide[v.s] > 1 && !v.n && !v.r) v.n = '1'; });
    side.forEach((v, t) => {
      const L = letter[v.s];
      t.pos = perSide[v.s] === 1 && !v.r ? L : L + (v.n ? String(+v.n) : '') + v.r;
    });

    // 4) zeri iniziali
    tracks.forEach((t) => { if (!side.has(t) && /^0+\d/.test(t.pos)) t.pos = t.pos.replace(/^0+(?=\d)/, ''); });

    // 5) numerazione finale e righe dei supporti
    let media = [...new Set(tracks.map((t) => t.media).filter(Boolean))];
    // un solo supporto con prefisso ("DVD1") e altre tracce senza: queste sono del supporto principale (es. CD)
    const baseLabel = MEDIA_LABEL[(D.formatName || '').toLowerCase().replace('-', '')];
    if (media.length === 1 && baseLabel && baseLabel !== media[0] && tracks.some((t) => !t.media)) {
      for (const t of tracks) { if (t.media) break; t.media = baseLabel; }
      media = [...new Set(tracks.map((t) => t.media).filter(Boolean))];
    }
    if (media.length >= 2) {
      // tracce senza prefisso: stesso supporto della traccia precedente
      let cur = media[0];
      tracks.forEach((t) => { if (t.media) cur = t.media; else t.media = cur; });
      const discsOf = {};
      tracks.forEach((t) => { (discsOf[t.media] = discsOf[t.media] || new Set()).add(t.disc || 1); });
      const units = [];
      tracks.forEach((t) => { t.unit = t.media + '#' + (t.disc || 1); if (!units.includes(t.unit)) units.push(t.unit); });
      const out = [];
      let curUnit = null, trailingHeads = 0;
      rows.forEach((r) => {
        if (r.header) {
          if (r.mediaHeading) return; // 'DVD "Concerto…"': sostituita dalla riga "DVD"
          out.push(r); trailingHeads++; return;
        }
        if (r.unit !== curUnit) {
          curUnit = r.unit;
          const label = r.media + (discsOf[r.media].size > 1 ? ' ' + (r.disc || 1) : '');
          out.splice(out.length - trailingHeads, 0, { pos: '', title: label, dur: '', header: true, mediaRow: true });
        }
        r.pos = (units.indexOf(r.unit) + 1) + '.' + r.pos;
        out.push(r); trailingHeads = 0;
      });
      return out;
    }
    const discs = new Set(tracks.filter((t) => t.disc).map((t) => t.disc));
    tracks.forEach((t) => { if (t.disc && discs.size > 1) t.pos = t.disc + '.' + t.pos; });
    return rows;
  }

  // Attributi di performance: restituisce { attrs: [[id, nome, motivo]], additional, warn }
  function perfAttrs(T, type) {
    const tracks = T.tracks.filter((t) => !t.header);
    const n = tracks.length;
    const title = D.title || '';
    const styles = (D.styles || []).concat(D.genres || []).map((s) => s.toLowerCase());
    const desc = D.descriptions || [];
    const notes = D.notes || '';
    const out = [], warn = [];
    const share = (re) => (n ? tracks.filter((t) => re.test(t.title)).length / n : 0);
    const pct = (x) => Math.round(x * 100) + '% tracce';
    const focal = n ? tracks[0].title : ''; // singoli: conta il brano principale (il primo)
    const isSingle = type === 'i';

    // Contenuti "Additional release"
    const shares = ADDITIONAL.map(([re, id, name]) => [id, name, isSingle ? (re.test(focal) ? 1 : 0) : share(re)]);
    if (/\binstrumentals\b/i.test(title)) shares.find((s) => s[0] === 127)[2] = 1;      // "The Instrumentals"
    if (styles.includes('interview')) shares.find((s) => s[0] === 14)[2] = 1;
    if (desc.includes('Sampler') && !D.various) shares.push([132, 'Sampler', 1]);    // non per i sampler V/A di etichetta
    const union = isSingle ? (shares.some((s) => s[2] > 0) ? 1 : 0)
      : (n ? tracks.filter((t) => ADDITIONAL.some(([re]) => re.test(t.title))).length / n : 0);
    let addl = shares.filter((s) => s[2] > 0.5);
    if (!addl.length && union > 0.5) addl = shares.filter((s) => s[2] >= 0.2);
    addl.forEach(([id, name, sh]) => out.push([id, name, sh >= 1 ? 'intera release' : pct(sh)]));

    // Live (o Live sessions se già rilevate sopra)
    const liveShare = isSingle ? (PERF.live.test(focal) ? 1 : 0) : share(PERF.live);
    const liveTitle = /\blive (at|in|from|on)\b|\(live\b|\[live\b/i.test(title);
    const liveNotes = /recorded live\b|live recording/i.test(notes) && !/live (in|at) (the )?studio|live in studio/i.test(notes);
    if (!out.some((a) => a[0] === 131) && (liveShare > 0.5 || liveTitle || liveNotes)) {
      out.push([5, 'Live', liveShare > 0.5 ? pct(liveShare) : liveTitle ? 'titolo' : 'note della release']);
      warn.push('Live: per RYM solo se registrato davanti a un pubblico vero; le sessioni in studio/radio vanno in "Live sessions".');
    }

    // Remixes: singoli -> solo se il brano principale è un remix
    const remixShare = isSingle ? (PERF.remix.test(focal) ? 1 : 0) : share(PERF.remix);
    if (remixShare > 0.5) out.push([24, 'Remixes', isSingle ? 'brano principale remix' : pct(remixShare)]);

    // Selector Comp: compilation V/A non mixata, con un compilatore accreditato
    if (D.various && D.compiledBy && !desc.includes('Mixed')) {
      out.push([10, 'Selector Comp', 'compilatore accreditato']);
      warn.push('Selector Comp: aggiungi il compilatore nei crediti (ruolo "compiler").');
    }

    // Archival: registrato almeno 10 anni prima dell'uscita (anno nelle note: "Recorded ... 1972")
    const recYears = [...notes.matchAll(/recorded[^.\n]{0,80}?\b(19\d\d|20\d\d)\b/gi)].map((m) => +m[1]);
    const reissue = desc.includes('Reissue') || desc.includes('Repress') || /originally released/i.test(notes); // ristampa: non è archival
    if (recYears.length && D.year && !reissue && !['c', 'b'].includes(type)) {
      const rec = Math.min(...recYears);
      if (+D.year - rec >= 10) out.push([7, 'Archival', 'registrato nel ' + rec + ', uscito nel ' + D.year]);
    }

    // Creative Commons
    if (D.cc || /creative\s*commons|creativecommons\.org|\bcc[\s-]by\b/i.test(notes)) out.push([78, 'Creative Commons', 'licenza indicata']);

    // Colonne sonore (stili Discogs / tag Bandcamp)
    const st = (s) => styles.some((x) => x === s || (s.length > 4 && x.includes(s))); // "ost" solo esatto (non "post-punk")
    const text = (title + ' ' + notes).toLowerCase();
    if (st('score') || st('film score')) out.push([53, 'Film Score', 'stile "Score"']);
    else if (st('soundtrack') || st('ost') || st('video game music') || st('vgm')) {
      if (st('video game') || st('vgm') || /video\s*game|game soundtrack/.test(text)) out.push([56, 'Video Game Soundtrack', 'colonna sonora di videogioco']);
      else if (/\b(tv|television|series)\b/.test(text)) out.push([55, 'Television Soundtrack', 'colonna sonora TV']);
      else out.push([54, 'Motion Picture Soundtrack', 'stile "Soundtrack"']);
    }
    if (st('musical')) out.push([57, 'Cast Recording', 'stile "Musical"']);
    if (out.some((a) => [53, 54, 55, 56, 57].includes(a[0]))) warn.push('Colonna sonora: verifica il tipo (film, TV, videogioco, cast) e il "file under" (compositori o V/A).');

    const additional = addl.length > 0;
    if (additional) warn.push('Contenuti da "Additional release" (' + addl.map((a) => a[1]).join(', ') + '): per RYM va in quella sezione. Verifica.');
    if (out.length && (desc.includes('Reissue') || desc.includes('Repress'))) warn.push('Gli attributi di performance si impostano solo sulla primary issue.');
    return { attrs: out, additional, warn };
  }

  // Modalità di capitalizzazione per la release corrente (stato della spunta)
  // Lingua della release: voto a maggioranza dei titoli riconoscibili (inglese contro non inglese);
  // con meno di 3 voti o in parità decide l'insieme delle parole.
  function releaseLang() {
    const titles = [D.title].concat((D.tracks || []).map((t) => t.title)).filter(Boolean);
    const votes = {};
    titles.forEach((t) => { const l = detectLang(t, true); if (l !== 'unknown') votes[l] = (votes[l] || 0) + 1; });
    const en = votes.en || 0;
    const nonEn = Object.keys(votes).filter((k) => k !== 'en');
    const nonEnTotal = nonEn.reduce((a, k) => a + votes[k], 0);
    if (en + nonEnTotal < 3) return detectLang(titles.join(' ')); // troppo pochi voti
    if (en > nonEnTotal) return 'en';
    if (nonEnTotal > en) {
      const named = nonEn.filter((k) => k !== 'xx').sort((a, b) => votes[b] - votes[a]);
      return named.length ? named[0] : 'xx';
    }
    return detectLang(titles.join(' '));
  }

  function capsState() {
    const lang = releaseLang();
    if (capsMode !== null) return { english: capsMode, auto: false, lang, hold: null };
    if (D.classical) return { english: false, auto: true, lang, hold: 'classical' };
    return { english: lang === 'en' || lang === 'unknown', auto: true, lang, hold: null };
  }
  // Modalità per un singolo titolo: 'en' (inglese), 'sent' (solo iniziale), 'keep' (non toccare).
  // In automatico decide titolo per titolo (dischi con brani in più lingue); senza indizi vale la lingua della release.
  function capsModeFor(str, C) {
    if (!C.auto) return C.english ? 'en' : 'sent';
    let lt = detectLang(str, true);
    if (lt === 'unknown') lt = C.lang;
    if (lt === 'de') return 'keep'; // tedesco: i sostantivi vanno maiuscoli
    return lt === 'en' || lt === 'unknown' ? 'en' : 'sent';
  }

  // Vinili: RYM vuole il minutaggio solo se è stampato sul disco/copertina. Lo decide chi carica con la spunta
  // "Importa minutaggio" (di base tolta), visibile solo per i vinili.
  const isVinyl = () => /^(vinyl|lathe cut|flexi-disc|shellac|acetate)$/i.test(D.formatName || '');

  // Titolo e tracce pronti per RYM. Le righe senza numero (suite, opere, sezioni, "CD"/"DVD")
  // vanno in grassetto: [b]Titolo[/b].
  function prepare() {
    const res = prepareTexts();
    // tracce senza titolo: "[untitled]" (wiki RYM, "Add release information" §17.1), dopo le maiuscole
    let untitled = 0;
    res.tracks.forEach((t) => {
      if (!t.header && /^[\[(]?\s*untitled\s*[\])]?$/i.test((t.title || '').trim())) { t.title = '[untitled]'; untitled++; }
    });
    if (untitled) res.log.push('Tracce senza titolo scritte come "[untitled]": ' + untitled);
    // Various Artists: "Artista - Titolo" (trattino breve con spazi), dopo le maiuscole così il nome resta com'è
    if (D.various) {
      let withArtist = 0;
      res.tracks.forEach((t) => {
        if (t.header || !t.artist || isVarious(t.artist)) return;
        if (t.title.toLowerCase().startsWith(t.artist.toLowerCase() + ' - ')) return;
        t.plain = t.title; // titolo senza artista: serve per il titolo proposto dei singoli
        t.title = t.artist + ' - ' + t.title; withArtist++;
      });
      if (withArtist) res.log.push('V/A: nome dell\'artista davanti al titolo in ' + withArtist + ' tracce');
    }
    res.tracks.forEach((t) => {
      if (t.header && t.title && !/^\[b\][\s\S]*\[\/b\]$/i.test(t.title)) t.title = '[b]' + t.title + '[/b]';
    });
    return res;
  }

  // Titolo e tracce con posizioni RYM e maiuscole corrette
  function prepareTexts() {
    const tracks = (D.tracks || []).map((t) => Object.assign({}, t));
    const res = { title: D.title || '', tracks, log: [], warn: [] };
    tracks.forEach((t) => { t.orig = t.pos; });
    // RYM non vuole "(Original Mix)", "(Original)", "(Original Version)" nei titoli
    const ORIGINAL = /\s*(?:[(\[]\s*original(?:\s+(?:mix|version))?\s*[)\]]|\s[-–]\s*original(?:\s+(?:mix|version))?)\s*$/i;
    let origCut = 0;
    tracks.forEach((t) => { if (!t.header && ORIGINAL.test(t.title)) { t.title = t.title.replace(ORIGINAL, ''); origCut++; } });
    if (ORIGINAL.test(res.title)) res.title = res.title.replace(ORIGINAL, '');
    if (origCut) res.log.push('Tolto "(Original Mix)" / "(Original)" da ' + origCut + ' tracce');
    res.tracks = normPositions(tracks);
    const changed = res.tracks.find((t) => !t.header && t.pos !== t.orig);
    if (changed) res.log.push('Posizioni tracce adattate a RYM (es. "' + changed.orig + '" → "' + changed.pos + '")');
    if (isVinyl() && !durVinyl && res.tracks.some((t) => t.dur)) {
      res.tracks.forEach((t) => { t.dur = ''; });
      res.log.push('Vinile: minutaggio non importato (spunta "Importa minutaggio" tolta)');
    }
    const mediaRows = res.tracks.filter((t) => t.mediaRow).map((t) => t.title);
    if (mediaRows.length) res.log.push('Righe dei supporti (senza numero): ' + mediaRows.join(', '));
    const C = capsState();
    const protect = [D.artist, D.artistSearch].filter(Boolean);
    const rows = res.tracks.filter((t) => !t.mediaRow); // le righe "CD"/"DVD" restano così
    if (C.hold) {
      res.warn.push('Classica: maiuscole lasciate come su Discogs (le opere seguono regole proprie). Controllale, oppure scegli la modalità con la spunta.');
      return res;
    }
    const before = res.title;
    const flags = new Set();
    const count = { en: 0, sent: 0, keep: 0 };
    const fix = (str) => {
      const m = capsModeFor(str, C);
      let out = str;
      if (m === 'en') { const r = capEN(str, protect); r.flags.forEach((f) => flags.add(f)); out = r.text; }
      else if (m === 'sent') out = capSentence(str, protect);
      if (out !== str) count[m]++;
      if (m === 'keep' && str) count.keep++;
      return out;
    };
    res.title = fix(res.title);
    rows.forEach((t) => { t.title = fix(t.title); });
    if (count.en) res.log.push('Capitalizzazione inglese RYM: ' + count.en + ' titoli');
    if (count.sent) res.log.push('Solo iniziale maiuscola (titoli non inglesi): ' + count.sent + ' titoli');
    if (res.title !== before) res.log.push('Titolo: «' + before + '» → «' + res.title + '»');
    if (C.auto && C.lang !== 'unknown') res.log.push('Lingua stimata: ' + LANG_NAME[C.lang] + ' (cambia la modalità con la spunta)');
    if (flags.size) {
      res.warn.push('Maiuscole: controlla ' + [...flags].map((f) => '«' + f + '»').join(', ') +
        ': minuscolo se preposizione o congiunzione, maiuscolo se avverbio (es. "Keep On Rockin\'", "You Are So Beautiful").');
    }
    if (count.sent || (!C.auto && !C.english)) res.warn.push('Titoli non inglesi: controlla nomi propri, luoghi e nomi di gruppi, che vanno in maiuscolo (es. "Il meglio di Elio e le Storie Tese").');
    if (count.keep) res.warn.push('Titoli in tedesco lasciati come su Discogs (i sostantivi vanno maiuscoli): controllali a mano.');
    return res;
  }

  // ---- helpers DOM ----
  function clearVal(el) {
    if (!el || el.value === '') return;
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function setVal(el, v) {
    if (!el || v === '' || v == null) return false;
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  function setSelect(id, v) {
    const el = document.getElementById(id);
    if (!el || !v || !el.querySelector('option[value="' + v + '"]')) return false;
    return setVal(el, v);
  }
  function clickRadio(name, value) {
    const el = form.querySelector('input[type=radio][name="' + name + '"][value="' + value + '"]');
    if (!el) return false;
    if (!el.checked) el.click();
    return true;
  }
  function check(id) {
    const el = document.getElementById(id);
    if (!el) return false;
    if (!el.checked) { el.click(); touched.attribs.add(id); }
    return true;
  }
  const radioVal = (name) => (form.querySelector('input[type=radio][name="' + name + '"]:checked') || {}).value;
  // stato iniziale dei pulsanti radio, per poterlo ripristinare
  const INITIAL = {};
  ['category', 'type', 'format', 'disc_size'].forEach((n) => { INITIAL[n] = radioVal(n); });

  // Annulla quello che lo script aveva compilato (prima di compilare un'altra release)
  function resetForm() {
    touched.attribs.forEach((id) => { const el = document.getElementById(id); if (el && el.checked) el.click(); });
    touched.attribs.clear();
    Object.keys(INITIAL).forEach((n) => { if (INITIAL[n] != null) clickRadio(n, INITIAL[n]); });
    ['year', 'month', 'day'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.selectedIndex !== 0) { el.selectedIndex = 0; el.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    ['title', 'catalog_no', 'countries'].forEach((id) => clearVal(document.getElementById(id)));
    const notes = $('#notes');
    if (notes && touched.notesUrl) {
      notes.value = notes.value.split('\n').filter((l) => l.trim() !== touched.notesUrl).join('\n');
      touched.notesUrl = '';
    }
    if (touched.tracks) {
      try { W.goAdvanced(); $('#track_advanced').value = ''; W.goSimple(); } catch (e) { /* ignora */ }
      touched.tracks = false;
    }
  }

  // Artisti già impostati nella pagina (1.3a) e confronto con l'artista della release
  const norm = (s) => clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^the\s+/, '').replace(/[^\p{L}\p{N}]/gu, '');
  function pageArtists() {
    return [...document.querySelectorAll('[id^="filed_under_performer_artist_"][id$="_preview"] a')].map((a) => a.textContent.trim()).filter(Boolean);
  }
  function artistMismatch() {
    const names = pageArtists();
    if (!D || D.various || !names.length) return null;
    // per la classica valgono anche gli interpreti (Discogs mette spesso il compositore come artista)
    const want = [D.artistSearch, D.artist].concat((D.performers || []).map((p) => p.replace(/\s*\([^)]*\)$/, ''))).map(norm).filter(Boolean);
    const ok = names.some((n) => want.some((w) => norm(n).includes(w) || w.includes(norm(n))));
    return ok ? null : names.join(', ');
  }

  // ---- logica di compilazione ----
  function fill() {
    if (loadData()) renderPanel(); // usa sempre l'ultima release salvata
    if (!D) return;
    if (filledRaw) resetForm();    // via i dati della compilazione precedente
    const log = [];                // dettagli (sezione chiusa)
    const warn = [];               // dettagli (sezione chiusa)
    const sum = [];                // riga verde: cosa è stato compilato
    const todo = [];               // in vista: solo ciò che richiede un intervento
    const desc = D.descriptions || [];
    const T = prepare();           // titolo e tracce con le maiuscole RYM

    const other = artistMismatch();
    if (other) {
      warn.push('ATTENZIONE: questa pagina è dell\'artista "' + other + '", la release è di "' + D.artist + '". Apri la pagina Add release giusta.');
      todo.push('Pagina di un altro artista ("' + other + '"): apri l\'Add release di "' + D.artist + '"');
    }

    // 1.2 Categoria: classica / Various Artists / 1.3a File under
    if (D.classical) {
      clickRadio('category', 'classical');
      log.push('Categoria: Classical music release');
      sum.push('Classica');
      todo.push('File under agli interpreti, non al compositore' + ((D.performers || []).length ? ': ' + D.performers.map((p) => p.replace(/\s*\([^)]*\)$/, '')).slice(0, 3).join(', ') : ''));
      warn.push('Classica: il "file under" va agli interpreti (direttore, solisti, orchestra), non ai compositori. Collega i brani alle opere ([WorkXXXX]) come da wiki "Classical music".');
      if ((D.performers || []).length) warn.push('Interpreti su Discogs: ' + D.performers.join(', ') + '.');
      if (!form.querySelector('input[id^="filed_under_performer_artist_"]') && (D.performers || []).length) {
        const who = D.performers[0].replace(/\s*\([^)]*\)$/, ''); // cerca il primo interprete, non il compositore
        setVal($('#filed_under_searchterm'), who);
        const fr = $('#filed_underperformerlist');
        if (fr) fr.src = '/go/searchcredits?target=filedunderperformer&label=performer&searchterm=' + encodeURIComponent(who);
      }
    } else if (D.various && (D.tracks || []).filter((t) => !t.header).length <= 4) {
      log.push('V/A con 4 tracce o meno: categoria lasciata standard (probabile split)');
    } else if (D.various) {
      clickRadio('category', 'va');
      log.push('Categoria: Various Artists');
      sum.push('V/A');
      warn.push('V/A: collega gli artisti nella tracklist con "Insert link to artist".');
    } else if (!form.querySelector('input[id^="filed_under_performer_artist_"]')) {
      setVal($('#filed_under_searchterm'), D.artistSearch);
      const fr = $('#filed_underperformerlist'); // stessa URL usata da searchfiled_under() di RYM
      if (fr) fr.src = '/go/searchcredits?target=filedunderperformer&label=performer&searchterm=' + encodeURIComponent(D.artistSearch);
      warn.push('Artista non impostato: scegli "' + D.artistSearch + '" dai risultati a destra (1.3a).');
      todo.push('Scegli l\'artista "' + D.artistSearch + '" a destra (1.3a)');
    }

    // formato e misura servono già per stimare il tipo
    let fmt = FORMAT[D.formatName];
    // RYM: Digital File oppure Lossless Digital, mai entrambi; preferire la qualità più alta
    if (D.formatName === 'File' && (D.lossless || desc.some((x) => /FLAC|WAV|ALAC|AIFF/i.test(x)))) fmt = 59;
    const digital = fmt === 58 || fmt === 59;
    let size = Object.keys(DISC_SIZE).find((k) => desc.includes(k));
    if (!size && fmt === 95 && desc.includes('LP')) size = '12"';

    // 1.5 Tipo release (+ attributi di performance, che possono spostarlo in "Additional releases")
    let G = guessType(fmt, size);
    const P = perfAttrs(T, G.type);
    if (P.additional && G.type !== 'b') G = { type: 'x', reason: 'contenuti ' + P.attrs.filter((a) => ADDITIONAL.some((x) => x[1] === a[1]) || a[0] === 132).map((a) => a[1]).join(', '), sure: false };
    clickRadio('type', G.type);
    log.push('Tipo: ' + TYPE_NAME[G.type] + ' (' + G.reason + ')');
    sum.push(TYPE_NAME[G.type] + (G.sure ? '' : '?'));
    if (G.unknown) { warn.push('Nessuna tracklist né indizi dal formato: tipo NON stimabile, sceglilo tu (1.5).'); todo.push('Scegli il tipo di release (1.5)'); }
    else if (!G.sure) { warn.push('Tipo stimato (' + G.reason + '): verificalo (1.5). Per RYM conta ciò che dichiarano artista o etichetta.'); todo.push('Tipo stimato: ' + TYPE_NAME[G.type] + ' (' + G.reason + ')'); }
    if (!G.sure && !G.unknown && /durata ignota|oltre/.test(G.reason)) warn.push('Durate mancanti o parziali: la stima si basa soprattutto sul numero di tracce.');
    if (G.type === 'c' && D.various) warn.push('Compilation V/A: per RYM è compilation solo se oltre il 50% è già uscito. Se è materiale inedito usa Standard Album.');
    if (G.type === 'j') warn.push('DJ Mix solo se la release è accreditata al DJ che l\'ha mixata.');

    // Titolo standard RYM per i singoli (solo formati fisici: per il digitale vale la pagina "Digital singles")
    let suggested = '';
    if (G.type === 'i' && !digital) {
      suggested = singleTitle(T.tracks);
      if (suggested && suggested.toLowerCase() !== (T.title || '').toLowerCase()) {
        warn.push('Titolo standard RYM per il singolo: "' + suggested + '" (usa il pulsante sotto per applicarlo).');
        todo.push('Titolo RYM per il singolo: "' + suggested + '" (pulsante sotto)');
      } else suggested = '';
    }

    // 1.6 Data
    if (setSelect('year', D.year)) { log.push('Data: ' + [D.year, D.month, D.day].filter(Boolean).join('-')); sum.push([D.year, D.month, D.day].filter(Boolean).join('-')); }
    else { warn.push('Anno non impostato.'); todo.push('Data mancante'); }
    setSelect('month', D.month);
    setSelect('day', D.day);
    if (SRC === 'Bandcamp') warn.push('La data Bandcamp a volte è quella di caricamento: verificala.');

    // 2.1 Titolo (+ esito della correzione maiuscole)
    if (setVal($('#title'), T.title)) log.push('Titolo');
    log.push(...T.log);
    warn.push(...T.warn);

    // 3.1 Formato
    if (fmt && clickRadio('format', fmt)) {
      log.push('Formato: ' + (digital ? 'Digital File' : D.formatName));
      sum.push((digital ? (fmt === 59 ? 'Lossless Digital' : 'Digital File') : D.formatName) + (size ? ' ' + size : ''));
    } else { warn.push('Formato "' + D.formatName + '" non mappato: sceglilo a mano.'); todo.push('Scegli il formato (3.1)'); }

    if (digital) {
      // Bandcamp: di norma sia "Digital file" sia "Streaming"; solo Streaming se non scaricabile
      const dist = [];
      if (!D.streamingOnly && check('attrib122')) dist.push('Digital file');
      if (D.streaming && check('attrib123')) dist.push('Streaming');
      if (dist.length) log.push('Distribuzione: ' + dist.join(' + '));
      if (D.streamingOnly) warn.push('Sembra disponibile solo in streaming: impostati Digital File + solo "Streaming". Verifica.');
      if (D.downloadUnknown) warn.push('Non so se è scaricabile: se è solo in streaming togli "Digital file" e usa Digital File invece di Lossless.');
    }
    if (D.oldDate) {
      warn.push('Bandcamp indica ' + D.oldDate + ': è la data originale, non quella dell\'uscita digitale. RYM la vuole vuota se non c\'è una fonte affidabile. Probabile issue secondaria (1.1).');
      todo.push('Data originale ' + D.oldDate + ' non usata: probabile issue secondaria (1.1)');
    }

    // 3.2 Disc size (obbligatorio per vinile; per i CD solo se non standard)
    if (size) { clickRadio('disc_size', DISC_SIZE[size]); log.push('Disco: ' + size); }
    else if (fmt === 95) { warn.push('Vinile senza misura: imposta Disc size (3.2).'); todo.push('Imposta Disc size (3.2)'); }

    // 3.3 / 3.4 Etichetta e catalogo (wiki "Catalog numbers")
    //  - senza etichetta: label "(No Label)" e catalogo "n/a" (se Discogs non indica un numero)
    //  - fisico con etichetta ma senza numero: "n/a"
    //  - digitale con etichetta ma senza numero: vuoto
    const lab = (D.labels || [])[0];
    const noLabel = (lab && /^not on label/i.test(lab.name)) || (!lab && D.selfReleased);
    const labelSearch = noLabel ? 'No Label' : (lab ? lab.name : '');
    if (labelSearch) {
      setVal($('#searchterm'), labelSearch);
      const lf = $('#labellist'); // stessa URL usata da searchLabels() di RYM
      if (lf) lf.src = '/go/search?searchtype=b&searchterm=' + encodeURIComponent(labelSearch);
    }
    let catno = lab ? lab.catno : '';
    if (noLabel && !catno) catno = 'n/a'; // senza etichetta: "n/a" solo se non c'è un numero di catalogo
    else if (lab && !catno && lab.noCat && !digital) catno = 'n/a';
    if (setVal($('#catalog_no'), catno)) { log.push('Catalogo: ' + catno); sum.push('cat. ' + catno); }
    if (noLabel) warn.push('Senza etichetta' + (SRC === 'Bandcamp' ? ' (probabile autoproduzione)' : '') + ': scegli "(No Label)" nei risultati a destra (3.3).');
    else if (lab) warn.push('Etichetta: clicca "' + lab.name + '" nei risultati a destra (3.3).');

    // Release senza titolo ("Untitled" su Discogs), esclusi i singoli (per loro vale il titolo dai brani):
    // la wiki RYM dice self-titled (nome dell'artista); in alternativa si propone il numero di catalogo.
    const suggestions = suggested ? [suggested] : [];
    if (/^\[?(untitled|s\/t|self[\s-]?titled)\]?$/i.test((D.title || '').trim()) && G.type !== 'i') {
      if (D.artist && !D.various) suggestions.push(D.artist);
      if (catno && catno !== 'n/a') suggestions.push(catno);
      if (suggestions.length) todo.push('Release senza titolo: per la wiki RYM è self-titled (nome dell\'artista); scegli sotto');
    }

    // 3.5 Paesi (vuoto = mondiale; per il digitale RYM non vuole il paese)
    if (D.country && !digital) {
      const C = mapCountries(D.country);
      if (setVal($('#countries'), C.value)) {
        log.push('Paese: ' + C.value);
        sum.push(C.value);
        warn.push('Paese: se RYM non riconosce "' + C.value + '", cancellalo e sceglilo dal suggerimento (3.5).');
      }
      if (C.skipped.length) warn.push('Discogs indica "' + C.skipped.join(', ') + '": è un\'area, non un paese. Lasciato vuoto (vuoto = mondiale).');
      if (C.unknown.length) {
        warn.push('Paese "' + C.unknown.join(', ') + '" non presente nell\'elenco RYM: non inserito.');
        todo.push('Paese "' + C.unknown.join(', ') + '" non esiste su RYM: sceglilo a mano (3.5)');
      }
    }

    // 3.6 Attributi dell'issue (descrizioni Discogs + testo libero del formato)
    const attrs = new Map(); // id -> nome, senza doppioni
    const add = (id, name) => { if (!attrs.has(id) && check('attrib' + id)) attrs.set(id, name); };
    const texts = D.formatTexts || [];
    const all = [...desc, ...texts];
    const freeText = texts.join(' | ');
    const vinyl = fmt === 95 || fmt === 96;
    desc.forEach((x) => { if (ATTRIB[x]) add(ATTRIB[x], x); });
    SPEEDS.forEach(([re, id, name]) => { if (all.some((x) => re.test(x.trim()))) add(id, name); });
    if (vinyl) {
      const w = (desc.join(' | ') + ' | ' + freeText).match(WEIGHT_RE);
      if (w) add(WEIGHTS[w[1]], w[1] + ' gram');
      if (isColored(D.vinylTexts && D.vinylTexts.length ? D.vinylTexts : texts)) add(32, 'Colored Vinyl');
    }
    TEXT_ATTRIBS.forEach(([re, id, name, formats, inTitle]) => {
      if (formats && !formats.includes(fmt)) return;
      if (re.test(freeText) || (inTitle && re.test(D.title || ''))) add(id, name);
    });
    // Bonus tracks: anche da un'intestazione "Bonus" nella tracklist o da "(Bonus Track)" nei titoli
    if (D.bonusHeading || (D.tracks || []).some((t) => /bonus track/i.test(t.title))) add(62, 'Bonus Tracks');
    // Digital download: solo coupon/codice nella confezione (non l'acquisto Bandcamp)
    if (SRC !== 'Bandcamp' && !digital && /download (code|card|coupon|voucher)|includes? (a )?(digital )?download/i.test(freeText + ' ' + (D.notes || ''))) add(101, 'Digital Download');
    if (D.boxSet) add(12, 'Box Set');
    if (D.formatName === 'Flexi-disc') add(66, 'Flexi-disc');
    if (desc.includes('Unofficial Release') && (desc.includes('Mixed') || desc.includes('Mixtape'))) add(100, 'Unauthorized mixtape/DJ mix');
    // regole RYM di esclusione
    const drop = (id) => { if (attrs.has(id)) { const el = document.getElementById('attrib' + id); if (el && el.checked && touched.attribs.has('attrib' + id)) { el.click(); touched.attribs.delete('attrib' + id); } attrs.delete(id); } };
    if (attrs.has(73)) drop(16);                // Numbered: niente Limited
    if (attrs.has(60)) drop(81);                // replica LP: niente Paper/Cardboard Sleeve
    if (attrs.has(110)) drop(81);               // MusicPac: niente Paper/Cardboard Sleeve
    if (['i', 'e', 'c'].includes(G.type)) drop(37); // Abridged: non per singoli, EP e compilation
    if (attrs.size) log.push('Attributi: ' + [...attrs.values()].join(', '));

    // 4.3 Attributi di performance
    const perf = [];
    P.attrs.forEach(([id, name, why]) => { if (!attrs.has(id) && check('attrib' + id)) { attrs.set(id, name); perf.push(name + ' (' + why + ')'); } });
    if (perf.length) log.push('Performance: ' + perf.join(', '));
    warn.push(...P.warn);
    const flagWarn = T.warn.find((w) => w.startsWith('Maiuscole: controlla'));
    if (flagWarn) todo.push('Maiuscole da verificare: ' + flagWarn.replace(/^Maiuscole: controlla (.*?): minuscolo.*$/, '$1'));

    // 3.7 Tracklist (via modalità Advanced, poi ritorno a Simple come richiede RYM)
    if (T.tracks.length) {
      try {
        W.goAdvanced();
        $('#track_advanced').value = T.tracks.map((t) => t.pos + '|' + t.title + '|' + t.dur).join('\n');
        W.goSimple();
        touched.tracks = true;
        const heads = T.tracks.filter((t) => t.header).length;
        log.push('Tracce: ' + (T.tracks.length - heads) + (heads ? ' + ' + heads + ' intestazioni (opere in più movimenti, senza numero)' : ''));
        sum.push((T.tracks.length - heads) + ' tracce' + (heads ? ' + ' + heads + ' intestazioni' : '') + (isVinyl() && !durVinyl && (D.tracks || []).some((t) => t.dur) ? ', senza minutaggio' : ''));
      } catch (e) {
        warn.push('Tracklist non inserita: usa il tasto "Copia tracce" e incollale in modalità Advanced.');
        todo.push('Tracklist non inserita: usa "Copia tracce" e incollala in Advanced');
      }
    }

    // 5.1 Fonti
    const notes = $('#notes');
    if (notes && !notes.value.includes(D.url)) {
      setVal(notes, (notes.value ? notes.value + '\n' : '') + D.url);
      touched.notesUrl = D.url;
    }
    log.push('Fonte: ' + SRC);

    // Avvisi generali
    if (desc.includes('Reissue') || desc.includes('Repress')) { warn.push('È una ristampa: imposta la "Primary issue" (1.1).'); todo.push('Ristampa: imposta la primary issue (1.1)'); }
    else if (D.masterYear && D.year && +D.year > +D.masterYear && D.mainRelease !== D.id) {
      warn.push('Discogs: la prima uscita di questo disco è del ' + D.masterYear + ', questa è del ' + D.year + '. Probabile ristampa: va aggiunta come issue della release esistente (1.1).');
      todo.push('Probabile ristampa (prima uscita ' + D.masterYear + '): aggiungila come issue (1.1)');
    }
    if ((D.featured || []).length) {
      warn.push('Featured su Discogs: ' + D.featured.join(', ') + '.');
      todo.push('Featured da aggiungere nei crediti: ' + D.featured.slice(0, 4).join(', ') + (D.featured.length > 4 ? ' e altri' : ''));
    }
    if (desc.includes('Promo')) { warn.push('Promo: per RYM è un\'issue secondaria della release principale (1.1).'); todo.push('Promo: va come issue secondaria (1.1)'); }
    if ((D.labels || []).length > 1) { warn.push('Più etichette su Discogs: RYM ne accetta una, la più specifica (o la più vicina all\'artista).'); todo.push('Più etichette su Discogs: scegline una'); }

    filledRaw = rawSeen;
    renderPanel();
    report({ sum, spunte: [...attrs.values()], todo, details: log.concat(warn) }, suggestions);
  }

  // ---- pannello ----
  const panel = css(document.createElement('div'), {
    position: 'fixed', top: '70px', right: '15px', width: '320px', maxHeight: '80vh', overflowY: 'auto',
    background: '#1e2433', color: '#eee', border: '2px solid #c0392b', borderRadius: '8px', padding: '10px',
    zIndex: 99999, fontSize: '13px', lineHeight: '1.4', boxShadow: '0 3px 10px rgba(0,0,0,.5)'
  });
  const banner = (text, color) => '<div style="background:' + color + ';color:#fff;border-radius:4px;padding:6px;margin:6px 0">' + esc(text) + '</div>';

  // (Ri)disegna il pannello con la release corrente; lo riapre se era stato chiuso
  function renderPanel() {
    if (!D) return;
    const lab0 = (D.labels || [])[0] || {};
    const when = D.savedAt ? new Date(D.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const other = artistMismatch();
    panel.innerHTML =
      '<div style="font-weight:bold;font-size:15px;margin-bottom:4px">Postino · ' + esc(SRC) + ' → RYM</div>' +
      '<div><b>' + esc(D.artist) + '</b> – ' + esc(D.title) + '</div>' +
      '<div>' + esc([D.year, D.formatName === 'File' ? 'Digitale' : D.formatName, (D.descriptions || []).join(', ')].filter(Boolean).join(' · ')) + '</div>' +
      '<div>' + esc([lab0.name, lab0.catno, D.country].filter(Boolean).join(' · ')) + '</div>' +
      '<div style="opacity:.7">' + (D.tracks || []).filter((t) => !t.header).length + ' tracce' + (when ? ' · inviata alle ' + when : '') + '</div>' +
      (filledRaw && filledRaw !== rawSeen ? banner('Nuova release caricata. Premi "Compila modulo": i dati della precedente verranno sostituiti.', '#2a6fdb') : '') +
      (other ? banner('Questa pagina è dell\'artista "' + other + '", la release è di "' + D.artist + '". Apri la pagina Add release giusta.', '#b03a2e') : '') +
      '<div id="drym_bar"></div><div id="drym_out" style="margin-top:6px"></div>';

    const bar = panel.querySelector('#drym_bar');
    bar.appendChild(btn('Compila modulo', fill, '#27ae60'));
    if (other) bar.appendChild(btn('Cerca "' + D.artistSearch + '" su RYM', () => GM_openInTab('https://rateyourmusic.com/search?searchterm=' + encodeURIComponent(D.artistSearch) + '&searchtype=a', { active: true }), '#b03a2e'));
    bar.appendChild(btn('Copia tracce', () => GM_setClipboard(prepare().tracks.map((t) => t.pos + '|' + t.title + '|' + t.dur).join('\n'))));
    if (D.country) bar.appendChild(btn('Copia paese', () => GM_setClipboard(D.country)));
    if ((D.credits || []).length) bar.appendChild(btn('Copia crediti', () => GM_setClipboard(D.credits.join('\n'))));
    bar.appendChild(btn('Chiudi', () => panel.remove(), '#555'));
    bar.appendChild(btn('Cancella dati', () => { GM_deleteValue(KEY); D = null; panel.remove(); }, '#7f1d1d'));

    const lbl = css(document.createElement('label'), { display: 'block', margin: '4px 3px', cursor: 'pointer' });
    const C = capsState();
    lbl.innerHTML = '<input type="checkbox" id="drym_caps"' + (C.english ? ' checked' : '') + '> Capitalizzazione inglese' +
      '<div style="opacity:.7;font-size:11px;margin-left:18px">senza spunta: solo iniziale maiuscola (titoli non inglesi)' + (C.auto ? ' · ora in automatico, titolo per titolo, secondo la lingua' : '') + '</div>';
    lbl.querySelector('input').addEventListener('change', (e) => { capsMode = e.target.checked; if (filledRaw) fill(); else renderPanel(); });
    bar.appendChild(lbl);

    if (isVinyl() && (D.tracks || []).some((t) => t.dur)) { // solo se Discogs ha il minutaggio
      const dl = css(document.createElement('label'), { display: 'block', margin: '4px 3px', cursor: 'pointer' });
      dl.innerHTML = '<input type="checkbox" id="drym_dur"' + (durVinyl ? ' checked' : '') + '> Importa minutaggio' +
        '<div style="opacity:.7;font-size:11px;margin-left:18px">vinile: su RYM solo se è stampato sul disco o sulla copertina</div>';
      dl.querySelector('input').addEventListener('change', (e) => { durVinyl = e.target.checked; if (filledRaw) fill(); else renderPanel(); });
      bar.appendChild(dl);
    }

    if (!panel.isConnected) document.body.appendChild(panel);
  }

  // ---- aggiornamento senza ricaricare la pagina ----
  // Quando invii un'altra release da Discogs/Bandcamp, il pannello si aggiorna da solo.
  function onNewData(raw) {
    if (loadData(raw)) renderPanel();
  }
  if (typeof GM_addValueChangeListener === 'function') {
    try { GM_addValueChangeListener(KEY, (name, oldValue, newValue) => { if (newValue) onNewData(newValue); }); } catch (e) { /* ignora */ }
  }
  // riserva: ricontrolla quando torni sulla scheda o il browser la riprende dalla cache
  window.addEventListener('focus', () => onNewData());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) onNewData(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) onNewData(); });
  onNewData();

  // Riepilogo: riga verde (cosa è stato compilato), "Da fare" (solo ciò che richiede un intervento),
  // e tutto il resto in "Dettagli", chiusa di base.
  function report(R, suggested) { // suggested = elenco di titoli proposti (pulsanti)
    const out = panel.querySelector('#drym_out');
    out.innerHTML =
      '<div style="color:#7dda8a">✔ ' + esc(R.sum.join(' · ')) + '</div>' +
      (R.spunte.length ? '<div style="color:#7dda8a;opacity:.85;font-size:12px">Spunte: ' + esc(R.spunte.join(', ')) + '</div>' : '') +
      (R.todo.length ? '<div style="color:#f5c26b;margin-top:6px"><b>Da fare</b><br>• ' + R.todo.map(esc).join('<br>• ') + '</div>' : '') +
      '<details style="margin-top:6px;opacity:.8;font-size:12px"><summary style="cursor:pointer">Dettagli</summary>' +
      R.details.map((d) => '<div>' + esc(d) + '</div>').join('') + '</details>';
    (suggested || []).forEach((t) => {
      out.appendChild(btn('Usa titolo: ' + t, (e) => {
        setVal($('#title'), t);
        out.querySelectorAll('button').forEach((b) => { if (b.textContent.startsWith('Titolo applicato')) b.textContent = b.dataset.label; b.disabled = false; });
        e.target.dataset.label = e.target.textContent;
        e.target.textContent = 'Titolo applicato ✔';
        e.target.disabled = true;
      }, '#8e44ad'));
    });
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
})();
