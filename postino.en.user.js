// ==UserScript==
// @name         Postino
// @namespace    postino-rym-en
// @version      1.0
// @description  Brings the data of a Discogs or Bandcamp release into the RateYourMusic "Add Release" form, following the RYM rules. It never submits anything: preview and submit stay with you.
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
// How to use: on a Discogs release or a Bandcamp album press "→ RYM" (bottom right);
// then, on the RYM "Add release" page, press "Fill form" in the panel and check the "To do" items.

(function () {
  'use strict';

  const KEY = 'discogs_rym_data_en';
  const host = location.hostname;

  // ---------- shared utilities ----------
  const clean = (s) => (s || '').replace(/\s\(\d+\)$/, '').trim(); // "Artist (2)" -> "Artist"
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

  // save the data and open RYM on the right search
  // Temporary notice at the bottom right (green = ok, red = error)
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

  // Saves the data for RYM: the panel on the already open "Add release" page updates by itself
  function sendToRym(data) {
    data.savedAt = Date.now(); // makes every send different from the previous one (needed for the live update on RYM)
    GM_setValue(KEY, JSON.stringify(data));
    toast('✔ Data saved – ' + data.artist + ' – ' + data.title);
  }

  // seconds -> "m:ss" (or "h:mm:ss" past one hour); 0 or empty -> ''
  function secToTime(sec) {
    const s = Math.round(Number(sec) || 0);
    if (s <= 0) return '';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? h + ':' + pad2(m) + ':' + pad2(r) : m + ':' + pad2(r);
  }

  // ISO 8601 duration ("P00H03M45S", "PT3M45S") -> seconds
  function isoToSec(iso) {
    const m = /^P(?:T)?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(iso || '');
    return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
  }

  // =====================================================================
  //  DISCOGS SIDE
  // =====================================================================
  if (host.endsWith('discogs.com')) {
    const b = floatingButton(onDiscogsClick);
    b.style.display = 'none';

    // Discogs is a SPA: show the button only on release pages
    setInterval(() => {
      b.style.display = /\/release\/\d+/.test(location.pathname) ? 'block' : 'none';
    }, 800);

    function onDiscogsClick() {
      const m = location.pathname.match(/\/release\/(\d+)/);
      if (!m) return toast('Open a Discogs release page.', false);
      b.textContent = 'Loading…';
      GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://api.discogs.com/releases/' + m[1],
        headers: { Accept: 'application/json' },
        onload: (r) => {
          b.textContent = '→ RYM';
          if (r.status !== 200) return toast('Discogs API error: ' + r.status, false);
          const d = JSON.parse(r.responseText);
          const data = normalizeDiscogs(d);
          if (!d.master_id) return sendToRym(data);
          // master: year of the first release, to spot undeclared reissues
          GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://api.discogs.com/masters/' + d.master_id,
            headers: { Accept: 'application/json' },
            onload: (m) => {
              try { const mj = JSON.parse(m.responseText); data.masterYear = mj.year || null; data.mainRelease = mj.main_release || null; } catch (e) { /* ignore */ }
              sendToRym(data);
            },
            onerror: () => sendToRym(data)
          });
        },
        onerror: () => { b.textContent = '→ RYM'; toast('Discogs API request failed.', false); }
      });
    }

    function normalizeDiscogs(d) {
      // Artist
      let artist = '';
      (d.artists || []).forEach((a) => {
        artist += clean(a.anv || a.name);
        if (a.join) artist += a.join === ',' ? ', ' : ' ' + a.join + ' ';
      });
      artist = artist.trim();

      // Date
      const [y, mo, da] = (d.released || String(d.year || '')).split('-');

      // Format: skip containers ("Box Set", "All Media") and take the first real medium
      const media = (d.formats || []).filter((x) => !['Box Set', 'All Media'].includes(x.name));
      const f = media[0] || (d.formats || [])[0] || {};

      // Tracks. Works in several movements (Discogs "index tracks") become, as on RYM,
      // a header line without a number (the title of the work) followed by the movements.
      // Section headings ("Live Recordings", the name of a work…) also become lines without a number;
      // only generic side headings ("Side A") and untitled media headings ("CD 1", "DVD") are skipped.
      const classical = (d.genres || []).includes('Classical');
      const SIDE_HEADING = /^(side|face|lato)\s*[a-z0-9]+\.?$|^[a-z]\d*$|^\d+$/i;
      const PLAIN_MEDIA_HEADING = /^(cd|dvd|blu-?ray|bd|sacd|disc|disk|lp|vinyl|cassette|tape|record|vhs)\s*[-.:#]?\s*\d*\.?$/i;
      const MEDIA_HEADING = /^(cd|dvd|blu-?ray|bd|sacd|disc|disk|vhs)\b/i; // e.g. 'DVD "Concerto Live"'
      const pipe = (s) => (s || '').replace(/\|/g, '/');
      // track artist (V/A compilations): "Adham Zahran", "A & B", "A feat. B"
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
          if (MEDIA_HEADING.test(h)) row.mediaHeading = true; // replaced by the "CD"/"DVD" line when there are several media
          tracks.push(row);
          return;
        }
        if (t.type_ === 'index' && Array.isArray(t.sub_tracks) && t.sub_tracks.length) {
          tracks.push({ pos: '', title: pipe(t.title), dur: '', header: true });
          t.sub_tracks.forEach((s, k) => {
            n++;
            // no position: "3a, 3b…" if the work has a number, otherwise running numbers
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
        // free text of the vinyl/shellac media only (the colour of an included CD does not count)
        vinylTexts: (d.formats || []).filter((x) => /vinyl|lathe|flexi|shellac/i.test(x.name || '')).map((x) => x.text || '').filter(Boolean),
        tracks,
        credits: (d.extraartists || []).map((c) => clean(c.anv || c.name) + ' – ' + c.role + (c.tracks ? ' (' + c.tracks + ')' : '')),
        genres: d.genres || [],
        styles: d.styles || [],
        notes: d.notes || '',
        bonusHeading: (d.tracklist || []).some((t) => t.type_ === 'heading' && /bonus/i.test(t.title || '')),
        compiledBy: (d.extraartists || []).some((c) => /compiled by/i.test(c.role || '') && !c.tracks),
        // "feat." to add as featured credits on RYM (per track or for the whole release)
        featured: [...new Set([
          ...(d.tracklist || []).flatMap((t) => [t].concat(t.sub_tracks || []))
            .flatMap((t) => (t.extraartists || []).filter((c) => /featuring/i.test(c.role || '')).map((c) => clean(c.anv || c.name) + (t.position ? ' (' + t.position + ')' : ''))),
          ...(d.extraartists || []).filter((c) => /featuring/i.test(c.role || '')).map((c) => clean(c.anv || c.name) + (c.tracks ? ' (' + c.tracks + ')' : ''))
        ])],
        // performers (for classical music the RYM file under goes to them)
        performers: [...new Set((d.extraartists || [])
          .filter((c) => /conductor|orchestra|ensemble|choir|chorus|soloist|quartet|trio|violin|viola|cello|piano|soprano|tenor|baritone|mezzo|contralto|harpsichord|organ|guitar|flute|oboe|clarinet|bassoon|horn|trumpet|harp/i.test(c.role || ''))
          .map((c) => clean(c.anv || c.name) + ' (' + c.role + ')'))]
      };
    }
    return;
  }

  // =====================================================================
  //  BANDCAMP SIDE (no API: reads the data already in the page)
  // =====================================================================
  if (host.endsWith('bandcamp.com')) {
    if (!/^\/(album|track)\//.test(location.pathname)) return;
    const b = floatingButton(() => {
      try {
        sendToRym(normalizeBandcamp());
      } catch (e) {
        toast('Can\'t read the data on this Bandcamp page. ' + e.message, false);
      }
    });
    b.title = 'Send this release to the RYM form';

    function readJsonLd() {
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const j = JSON.parse(s.textContent);
          const t = [].concat(j['@type'] || []).join(' ');
          if (/MusicAlbum|MusicRecording/.test(t)) return j;
        } catch (e) { /* invalid block: ignore */ }
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
      if (!ld && !tr) throw new Error('Album data not found.');
      const isTrack = location.pathname.startsWith('/track/');

      const title = (tr?.current?.title || ld?.name || '').trim();
      const artist = (tr?.artist || ld?.byArtist?.name || '').trim();
      if (!title || !artist) throw new Error('Missing title or artist.');

      // Label: the publishing account, only if different from the artist (label pages)
      const publisher = (ld?.publisher?.name || '').trim();
      const labels = publisher && publisher.toLowerCase() !== artist.toLowerCase() ? [{ name: publisher, catno: '', noCat: false }] : [];

      // Date, e.g. "15 Mar 2019 00:00:00 GMT"
      let year = '', month = '', day = '', oldDate = '';
      const dt = new Date(tr?.album_release_date || tr?.current?.release_date || ld?.datePublished || '');
      if (!isNaN(dt)) {
        year = String(dt.getUTCFullYear()); month = pad2(dt.getUTCMonth() + 1); day = pad2(dt.getUTCDate());
        // Bandcamp exists since 2008: an earlier date is the original release date, not the digital issue's.
        // RYM: without a reliable source for the digital date, leave it blank.
        if (+year < 2008) { oldDate = [year, month, day].join('-'); year = month = day = ''; }
      }

      // Downloadable? (RYM: the Bandcamp issue is the downloadable version, lossless if available)
      const tinfo = (tr && Array.isArray(tr.trackinfo)) ? tr.trackinfo : [];
      let downloadable = null;
      if (tr && tr.freeDownloadPage) downloadable = true;
      else if (tinfo.some((t) => t.is_downloadable === true)) downloadable = true;
      else if (tinfo.length && tinfo.every((t) => t.is_downloadable === false)) downloadable = false;

      // Tracks: from the data-tralbum block first, otherwise from schema.org
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
        // page tags (used to spot soundtracks) and "about"/"credits" texts
        styles: [...document.querySelectorAll('.tralbum-tags a, a.tag')].map((a) => a.textContent.trim()).filter(Boolean),
        notes: [...document.querySelectorAll('.tralbum-about, .tralbum-credits')].map((e) => e.textContent).join('\n'),
        cc: !!document.querySelector('#license a[href*="creativecommons.org"], a[href*="creativecommons.org/licenses"]'),
        selfReleased: labels.length === 0,
        streaming: true,
        lossless: downloadable !== false,      // Bandcamp downloads include FLAC/ALAC/WAV
        streamingOnly: downloadable === false,
        downloadUnknown: downloadable === null,
        oldDate
      };
    }
    return;
  }

  // =====================================================================
  //  RYM SIDE
  // =====================================================================
  if (!host.endsWith('rateyourmusic.com')) return;
  const form = document.getElementById('release_ac');
  if (!form) return; // only on the "Add Release" page

  const W = unsafeWindow;
  let D = null;          // release currently loaded
  let SRC = 'Discogs';
  let rawSeen = null;    // JSON already read (to tell when a new release arrives)
  let filledRaw = null;  // JSON used for the last fill
  let capsMode = null;   // capitalization: null = automatic (from the language), true = English, false = first letter only
  let durVinyl = false;  // vinyl: import track times (only if printed on the record)
  // what the script changed, so it can be undone before filling another release
  const touched = { attribs: new Set(), notesUrl: '', tracks: false };

  // Saved data: only an object with fields of the expected type (drops corrupted or odd data)
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

  // Reads the saved data (or the data passed by the listener); true if a newer release arrived
  function loadData(rawArg) {
    const raw = rawArg !== undefined ? rawArg : GM_getValue(KEY);
    if (!raw || raw === rawSeen) return false;
    let parsed;
    try { parsed = sanitize(JSON.parse(raw)); } catch (e) { parsed = null; }
    if (!parsed) { GM_deleteValue(KEY); return false; }
    // never go back to a release older than the one already shown
    if (D && (parsed.savedAt || 0) < (D.savedAt || 0)) return false;
    rawSeen = raw;
    D = parsed;
    capsMode = null; // new release: capitalization back to automatic
    durVinyl = false;
    SRC = D.source || 'Discogs';
    return true;
  }

  // ---- mappings to the RYM form values ----
  const FORMAT = {
    'Vinyl': 95, 'Lathe Cut': 95, 'Flexi-disc': 95, 'Shellac': 96, 'CD': 60, 'CDr': 32, 'DVD': 78, 'DVDr': 100,
    'Blu-ray': 88, 'Cassette': 66, 'Reel-To-Reel': 92, '8-Track Cartridge': 21, 'VHS': 40, 'Minidisc': 48,
    'SACD': 76, 'HDCD': 83, 'DualDisc': 54, 'Laserdisc': 89, 'Acetate': 80, 'DAT': 104, 'DCC': 105,
    'Microcassette': 101, 'Betamax': 41, 'Cylinder': 91, 'UMD': 81, 'VCD': 79, 'File': 58
  };
  const DISC_SIZE = { '12"': 88, '10"': 89, '7"': 90, '5"': 91, '3"': 92, '16"': 93, '11"': 94, '9"': 95, '8"': 96, '6"': 97, '4"': 98 };
  // Official Discogs descriptions -> RYM attributes (ids checked against the RYM form)
  const ATTRIB = {
    'Remastered': 23, 'Limited Edition': 16, 'Numbered': 73, 'Promo': 11, 'Deluxe Edition': 59, 'Mono': 75,
    'Test Pressing': 108, 'White Label': 107, 'Picture Disc': 31, 'Single Sided': 104, 'Etched': 105,
    'Quadraphonic': 103, 'Enhanced': 63, 'Copy Protected': 61, 'Censored': 47, 'Special Edition': 49,
    'SHM-CD': 86, 'Box Set': 12
  };
  // Speed: Discogs puts it in the descriptions ("33 ⅓ RPM", "7 ½ ips"); regexes tolerate variants
  const SPEEDS = [
    [/^16\s*(⅔|2\/3)?\s*rpm$/i, 40, '16 rpm'], [/^33\s*(⅓|1\/3)?\s*rpm$/i, 19, '33 rpm'], [/^45\s*rpm$/i, 41, '45 rpm'],
    [/^78\s*rpm$/i, 42, '78 rpm'], [/^80\s*rpm$/i, 112, '80 rpm'],
    [/^3\s*(¾|3\/4)\s*ips$|^3\.75\s*ips$/i, 113, '3¾ IPS'], [/^7\s*(½|1\/2)\s*ips$|^7\.5\s*ips$/i, 114, '7½ IPS']
  ];
  // Weight: NOT a Discogs description, it lives in the format free text ("180g", "180 Gram", "180gr")
  const WEIGHTS = { 120: 43, 140: 115, 150: 116, 160: 117, 180: 44, 200: 118, 220: 119 };
  const WEIGHT_RE = /\b(120|140|150|160|180|200|220)\s*-?\s*(g|gr|grams?|grammes?)\b/i;
  // Hints from the format free text (and the title where useful), for every RYM "Issue attributes" checkbox.
  // [regex, RYM id, name, allowed RYM formats (null = all), also search the title]
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

  // Colored vinyl: any colour in the vinyl text, except black and parts about something else (labels, sleeve…)
  const COLOR_WORDS = /\b(red|blue|green|yellow|orange|pink|purple|violet|white|clear|transparent|translucent|gold(en)?|silver|marbled?|marble|splatter(ed)?|swirl(ed)?|smok(e|y)|gr[ae]y|brown|colou?red|multi-?colou?r(ed)?|cream|bone|beige|olive|teal|magenta|turquoise|ruby|amber|tan|maroon|mint|lilac|lavender|aqua|cyan|coral|peach|bronze|copper|rose|crystal|milky|opaque|neon|glow[\s-]in[\s-]the[\s-]dark|galaxy|tri-?colou?r|coke\s*bottle|sea\s*(blue|glass|foam)|oxblood|burgundy|indigo|navy|lime|khaki|sand|ivory|pearl|fluorescent|tie[\s-]dye|cloudy|vortex|haze|bubblegum)\b/i;
  const NOT_VINYL = /\b(labels?|sleeves?|cover|insert|obi|jacket|poster|sticker|printed|print|booklet|inner|outer|spine|lettering|logo|box|case|shell)\b/i;
  function isColored(texts) {
    return texts.join(',').split(/[,;\/+&]|\band\b|\bwith\b/i).some((part) => COLOR_WORDS.test(part) && !NOT_VINYL.test(part));
  }

  // ---- Performance attributes (wiki "Release attributes" §1) ----
  // Based on track titles: RYM thresholds >50% (or ≥20% each if together they exceed 50%).
  const PERF = {
    // "(Live)", "[Live at…]", "Live at/in/from…", "- Live" at the end of the title (not "Band - Live Forever")
    live: /\(live\b|\[live\b|\blive (at|in|from|on|version|recording)\b|\s[-–]\s*live(\s+(at|in|from|on|version|recording)\b|\s*$)/i,
    remix: /\b(remix(ed)?|rmx|re-?mix|rework(ed)?|re-?edit|vip mix|dub mix)\b/i
  };
  // "Additional release" content (§1.2.2): [regex, id, name]
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

  // ---- Countries: Discogs -> RYM names ----
  // Discogs usa sigle (US, UK) e regioni. RYM accetta i paesi e "Europe"; le altre aree restano vuote (vuoto = mondiale).
  // Official RYM country list (from the "Add Release" form suggestions: /sourced/autosuggest.js?pre=country)
  const RYM_COUNTRIES = ['Europe', 'Asia', 'Afghanistan', 'Albania', 'Algeria', 'American Samoa', 'Andorra', 'Angola', 'Anguilla', 'Antarctica', 'Antigua and Barbuda', 'Argentina', 'Armenia', 'Aruba', 'Australia', 'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bermuda', 'Bhutan', 'Bolivia', 'Bonaire, Sint Eustatius, and Saba', 'Bosnia-Herzegovina', 'Botswana', 'Bouvet Island', 'Brazil', 'British Indian Ocean Territory', 'British Virgin Islands', 'Brunei Darussalam', 'Bulgaria', 'Burkina Faso', 'Burma', 'Burundi', 'Cambodia', 'Cameroon', 'Canada', 'Canary Islands', 'Cape Verde', 'Cayman Islands', 'Central African Republic', 'Chad', 'Chile', 'China', 'Christmas Island', 'Cocos Island', 'Colombia', 'Comoros', 'Congo', 'Cook Islands', 'Costa Rica', 'Croatia', 'Cuba', 'Curaçao', 'Cyprus', 'Czechia', 'Czechoslovakia (Former)', 'Democratic Republic of Congo', 'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'East Timor', 'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Falkland Islands', 'Faroe Islands', 'Fiji', 'Finland', 'France', 'French Guiana', 'French Southern Territories', 'FYRO Macedonia', 'Gabon', 'Gambia', 'Georgia', 'Georgia & Sandwich Islands', 'Germany', 'Ghana', 'Gibraltar', 'Greece', 'Greenland', 'Grenada', 'Guadeloupe', 'Guam', 'Guatemala', 'Guernsey', 'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti', 'Heard Island and McDonald Islands', 'Honduras', 'Hong Kong', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Isle of Man', 'Israel', 'Italy', 'Ivory Coast', 'Jamaica', 'Japan', 'Jersey', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 'Kosovo', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Macau', 'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Martinique', 'Mauritania', 'Mauritius', 'Mayotte', 'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Montserrat', 'Morocco', 'Mozambique', 'Myanmar (Former Burma)', 'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'Netherlands Antilles', 'New Caledonia', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'Niue', 'Norfolk Island', 'Northern Marianas', 'North Korea', 'Norway', 'Oman', 'Pakistan', 'Palau', 'Palestine National Authority', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Pitcairn Islands', 'Poland', 'Polynesia', 'Portugal', 'Puerto Rico', 'Qatar', 'Reunion', 'Romania', 'Russian Federation', 'Rwanda', 'Saint Barthélemy', 'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Martin (French)', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Sao Tome', 'Saudi Arabia', 'Senegal', 'Serbia', 'Serbia and Montenegro (obsolete)', 'Seychelles', 'Sierra Leone', 'Singapore', 'Sint Maarten (Dutch part)', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'St. Helena', 'St Pierre And Miquelon', 'Sudan', 'Suriname', 'Svalbard And Jan Mayen', 'Sweden', 'Switzerland', 'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tokelau', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Turks And Caicos Islands', 'Tuvalu', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'US Minor Outlying Islands', 'US-Western Sahara', 'Uzbekistan', 'Vanuatu', 'Vatican City State', 'Venezuela', 'Vietnam', 'Virgin Islands', 'Wallis And Futuna Islands', 'Yemen', 'Zambia', 'Zimbabwe'];
  const RYM_BY_LOW = new Map(RYM_COUNTRIES.map((n) => [n.toLowerCase(), n]));
  // Discogs names that differ from RYM (lowercase key; several countries = list)
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
  // Names with "&", "and" or commas that must not be split (keys above and compound RYM names)
  const COMPOUND = Object.keys(COUNTRY_ALIAS).concat(RYM_COUNTRIES.map((n) => n.toLowerCase()))
    .filter((k) => /,|&|\band\b/i.test(k)).sort((a, b) => b.length - a.length);
  // Discogs regions with no RYM match (RYM only accepts "Europe" and "Asia"): left blank (blank = worldwide)
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
      else unknown.push(p); // e.g. "USSR", "Yugoslavia": not in the RYM list
    });
    return { value: [...new Set(out)].join(', '), skipped, unknown };
  }

  // ---- RYM release type rules (wiki "Release types") ----
  const TYPE_NAME = { s: 'Album', c: 'Compilation', e: 'EP', i: 'Single', m: 'Mixtape', x: 'Additional', j: 'DJ Mix', b: 'Bootleg' };
  // two-sided formats: single title = "Track A / Track B"
  const TWO_SIDED = ['Vinyl', 'Lathe Cut', 'Flexi-disc', 'Shellac', 'Cassette', 'Microcassette', 'Reel-To-Reel', '8-Track Cartridge', 'Acetate'];
  const ALBUM_MIN = 28 * 60; // RYM: an album usually runs at least 28 minutes
  const VERSION_WORDS = /\b(remix(es)?|rmx|mix|edit|dub|version|instrumental|inst|instr|rework|re-?edit|radio|extended|club|a ?capp?ella|vip|bootleg|reprise|mono|stereo|live|demo|acoustic|original|remaster(ed)?|vocal|beats|clean|explicit|dirty|feat|ft|featuring)\b/i;

  // "3:45" / "1:02:05" -> seconds; empty -> null
  function durSec(t) {
    if (!t) return null;
    const p = String(t).split(':').map(Number);
    if (p.some(isNaN)) return null;
    return p.reduce((a, v) => a * 60 + v, 0);
  }

  // "generic" track name: without version subtitles ("(Radio Edit)", "[Dub Mix]", "- Club Mix")
  function genericTitle(t) {
    let s = (t || '').trim(), prev;
    do {
      prev = s;
      s = s.replace(/\s*[(\[]([^)\]]*)[)\]]\s*$/, (m, inner) => (VERSION_WORDS.test(inner) ? '' : m));
      // "- Club Mix": only if the part after the dash ENDS with a version word
      // (so "Band - Live Forever" is not cut)
      s = s.replace(/\s+[-–]\s+[^-–]*$/, (m) => (/\b(remix|rmx|mix|edit|dub|version|instrumental|rework|re-?edit|vip|a ?capp?ella|vocal|beats|clean|explicit|dirty)\s*$/i.test(m) ? '' : m));
    } while (s !== prev);
    return s.trim();
  }

  // "EP", "E.P.", "E.P", "(EP)", "Mini Album", "Mini-Album"
  const hasEpMarker = (title) => /(^|[\s(\[:\-–])e\.?\s?p\.?(?=$|[\s)\]:,\-–])/i.test(title || '') || /\bmini[\s-]?album\b/i.test(title || '');

  // Returns { type, reason, sure }: "sure" = declared by the source, otherwise an estimate
  function guessType(fmt, size) {
    const desc = D.descriptions || [];
    const tracks = (D.tracks || []).filter((t) => !t.header); // work headers are not tracks
    const n = tracks.length;
    const known = tracks.map((t) => durSec(t.dur)).filter((x) => x != null);
    const sum = known.reduce((a, b) => a + b, 0);
    const complete = n > 0 && known.length === n;
    const long = sum >= ALBUM_MIN; // even with partial durations, if they already exceed 28 minutes
    const mins = complete ? Math.round(sum / 60) + ' min' : (sum ? 'over ' + Math.round(sum / 60) + ' min' : 'unknown duration');

    if (desc.includes('Unofficial Release')) return { type: 'b', reason: 'unofficial on Discogs', sure: true };
    if (desc.includes('Mixed')) return { type: 'j', reason: '"Mixed" on Discogs', sure: true };
    if (desc.includes('Mixtape')) return { type: 'm', reason: '"Mixtape" on Discogs', sure: true };
    if (desc.includes('Compilation')) return { type: 'c', reason: '"Compilation" on Discogs', sure: true };
    if (desc.includes('EP') || desc.includes('Mini-Album')) return { type: 'e', reason: 'EP on Discogs', sure: true };
    if (hasEpMarker(D.title)) return { type: 'e', reason: 'EP in the title', sure: true };
    if (desc.includes('Single') || desc.includes('Maxi-Single')) return { type: 'i', reason: 'Single on Discogs', sure: true };
    if (D.typeHint === 'i') return { type: 'i', reason: 'single-track page', sure: true };
    if (desc.includes('Album') || desc.includes('LP')) return { type: 's', reason: 'Album/LP on Discogs', sure: true };

    // --- estimate ---
    // Without a tracklist (common on Discogs) only format hints are left
    if (!n) {
      if (size === '7"') return { type: 'i', reason: '7" without tracklist', sure: false };
      if (fmt === 95 && size === '12"') return { type: 'i', reason: '12" without "LP" or tracklist (typical club 12")', sure: false };
      return { type: 's', reason: 'no tracklist', sure: false, unknown: true };
    }
    const bases = new Set(tracks.map((t) => genericTitle(t.title).toLowerCase()));
    if (n >= 2 && bases.size === 1) return { type: 'i', reason: n + ' versions of the same track', sure: false };
    // 7"/10"/12" vinyl that Discogs does not mark as LP: up to 3 tracks single; 4 to 6 EP,
    // unless the total length is over 30 minutes (album). Club 12"s often run over the 28 minutes of an album.
    if (fmt === 95 && ['7"', '10"', '12"'].includes(size) && !desc.includes('LP') && n <= 6) {
      if (n <= 3) return { type: 'i', reason: size + ' non-LP, ' + n + ' tracks, ' + mins, sure: false };
      if (sum > 30 * 60) return { type: 's', reason: size + ' non-LP, ' + n + ' tracks but ' + mins, sure: false };
      return { type: 'e', reason: size + ' non-LP, ' + n + ' tracks, ' + mins, sure: false };
    }
    if (n <= 3) {
      if (long) return { type: 's', reason: n + ' tracks but ' + mins, sure: false };
      return { type: 'i', reason: n + ' tracks, ' + mins, sure: false };
    }
    if (size === '7"' && n <= 4) return { type: 'e', reason: '7" with ' + n + ' tracks', sure: false };
    if (n <= 7) {
      if (long) return { type: 's', reason: n + ' tracks, ' + mins, sure: false };
      return { type: 'e', reason: n + ' tracks, ' + mins, sure: false };
    }
    return { type: 's', reason: n + ' tracks, ' + mins, sure: false };
  }

  // RYM standard title for physical singles (wiki "Release types" §4.1-4.2)
  function singleTitle(tracks) {
    const list = (tracks || []).filter((t) => !t.header);
    // title without the trailing brackets: "As Long As It's Groovy (Shortly)" -> "As Long As It's Groovy"
    const base = (t) => (t || '').replace(/(\s*[(\[][^)\]]*[)\]])+\s*$/, '').trim();
    const count = {};
    const titleOf = (t) => t.plain || t.title; // in V/A releases, without the artist name
    list.forEach((t) => { const b = base(titleOf(t)).toLowerCase(); count[b] = (count[b] || 0) + 1; });
    const seen = new Map();
    list.forEach((t) => {
      let g = genericTitle(titleOf(t));
      const b = base(titleOf(t));
      if (b && count[b.toLowerCase()] > 1) g = b; // same song on several tracks: one name only, without brackets
      if (g && !seen.has(g.toLowerCase())) seen.set(g.toLowerCase(), g);
    });
    const names = [...seen.values()];
    if (!names.length) return '';
    return TWO_SIDED.includes(D.formatName) ? names.join(' / ') : names[0];
  }


  // =====================================================================
  //  RYM CAPITALIZATION (wiki "Capitalization" and "Non-English Latin language capitalization")
  // =====================================================================
  // English: capitalize every word except articles, coordinating conjunctions and short prepositions;
  // always capitalize the first and last word of each section (after : ? ! — ( " and " / ").
  // Other Latin languages: only the first word and proper names -> cannot be fixed automatically.
  const LOWER_WORDS = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'yet', 'so', 'as', 'at', 'by', 'in', 'of', 'on', 'to',
    'vs', 'vs.', 'v.', 'etc', 'etc.', "o'", "'n'", "n'", "'n"]);
  const NEVER_FORCE = new Set(['vs', 'vs.', 'v.', 'etc', 'etc.', "o'", "'n'", "n'", "'n"]); // lowercase even when last ("Time After Time etc.")
  const AMBIGUOUS = new Set(['as', 'by', 'in', 'on', 'to', 'but', 'so']); // can be adverbs -> capitalized
  const ACRONYMS = new Set(['DJ', 'MC', 'TV', 'USA', 'UK', 'NYC', 'NY', 'OK', 'EP', 'LP', 'CD', 'DVD', 'BBC', 'MTV', 'VIP', 'UFO', 'USSR', 'R&B', 'BPM', 'SOS', 'ASAP', 'FM', 'DC', 'AI', 'EU', 'UN']);
  const ROMAN = /^X{0,3}(IX|IV|V?I{0,3})$/;
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function capFirst(p, mode) {
    const s = mode === 'mixed' ? p : p.toLowerCase();
    const i = s.search(/[\p{L}\p{N}]/u);
    if (i < 0 || /\p{N}/u.test(s.charAt(i))) return s; // "1st" stays "1st"
    return s.slice(0, i) + s.charAt(i).toUpperCase() + s.slice(i + 1);
  }

  function capPiece(p, forceFirst, forceLast, mode, flags) {
    if (!/\p{L}/u.test(p)) return p;
    const key = p.replace(/[’‘]/g, "'").toLowerCase();
    if (/^(\p{L}\.){2,}\p{L}?\.?$/u.test(p) && key !== 'a.k.a.') return mode === 'mixed' ? p : p.toUpperCase(); // R.E.M.
    if (mode === 'mixed' && /\p{Lu}/u.test(p.replace(/^['’]+/, '').slice(1))) return p; // camelcase or acronym already written (McCartney, DJ, iPad); a leading apostrophe does not count ("'Til")
    if (mode !== 'mixed') {
      const up = p.toUpperCase();
      if (ACRONYMS.has(up)) return up;
      if (mode === 'upper' && up.length >= 2 && ROMAN.test(up)) return up; // roman numerals
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
    const pieces = m[2].split('-'); // hyphenated compounds: each part as a separate word ("Will-o'-the-Wisp", "Drive-In")
    const out = pieces.map((p, k) => capPiece(p, isFirst && k === 0, isLast && k === pieces.length - 1, mode, flags));
    return m[1] + out.join('-') + m[3];
  }

  function capSegment(seg, mode, flags) {
    const tokens = seg.split(/(\s+)/);
    const words = tokens.map((t, i) => (/[\p{L}\p{N}]/u.test(t) ? i : -1)).filter((i) => i >= 0);
    const first = words[0], last = words[words.length - 1];
    return tokens.map((t, i) => (words.includes(i) ? capWord(t, i === first, i === last, mode, flags) : t)).join('');
  }

  // English rules on one title. "protect" = artist names to keep as they are ("The Best of The Temptations")
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

  // Non-English titles (wiki "Non-English Latin language capitalization"): capitalize only the first word
  // of the title and of each section (after . : ? ! — ( " and " / "), the rest lowercase.
  // Kept as they are: acronyms (DJ, R.E.M.), camelcase, roman numerals, abbreviations (Op., Vol., St.) and the artist name.
  // Proper names cannot be recognised: they must be checked by hand.
  const ACRONYMS_SAFE = new Set(['DJ', 'MC', 'TV', 'USA', 'UK', 'NYC', 'CD', 'DVD', 'LP', 'EP', 'BBC', 'MTV', 'VIP', 'UFO', 'USSR', 'R&B', 'BPM', 'SOS', 'FM']);
  function sentencePiece(p, isFirst, mode) {
    if (!/\p{L}/u.test(p)) return p;
    // elided article: "L'Uomo" -> "L'uomo", "Dell'Amore" -> "Dell'amore"
    const el = p.match(/^(\p{L}{1,4}['’])(\p{L}.*)$/u);
    if (el) return (isFirst ? capFirst(el[1].toLowerCase(), 'lower') : el[1].toLowerCase()) + sentencePiece(el[2], false, mode);
    if (/^(\p{L}\.){2,}\p{L}?\.?$/u.test(p)) return mode === 'mixed' ? p : p.toUpperCase();      // R.E.M.
    if (mode === 'mixed' && /\p{Lu}/u.test(p.replace(/^['’]+/, '').slice(1))) return p;            // DJ, McCartney (not "'Ntussicatu")
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

  // Language estimated from title + tracks together (common words of each language)
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
  const LANG_NAME = { en: 'English', it: 'Italian', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', nl: 'Dutch', xx: 'non-English' };

  // Fallback when there are no common words: in Italian/Spanish/Portuguese titles and in dialects
  // (Sicilian, Neapolitan: -u) almost every word ends in a/i/o/u, in English ones almost never.
  // Common English words ("you") do not count. Returns 'xx' (non-English), 'en' or 'unknown'.
  function vowelGuess(text, hi, lo) {
    const words = (text || '').toLowerCase().replace(/[’']/g, '').split(/[^\p{L}]+/u).filter((w) => w.length >= 3 && !LANG_SETS.en.has(w));
    if (words.length < 2) return 'unknown';
    const r = words.filter((w) => /[aiouàòìùú]$/.test(w)).length / words.length;
    return r >= hi ? 'xx' : r <= lo ? 'en' : 'unknown';
  }

  function detectLang(text, perTitle) {
    const score = {};
    let hits = 0; // words found in at least one list
    Object.keys(LANG_SETS).forEach((k) => { score[k] = 0; });
    // drop English contractions ("o'", "'n'") that would look like articles of other languages
    (text || '').toLowerCase().replace(/[’]/g, "'").replace(/(^|\s)(o|n)'(?=\s|$)|'n'/g, ' ').replace(/'/g, '').split(/[^\p{L}]+/u).filter(Boolean).forEach((w) => {
      const langs = Object.keys(LANG_SETS).filter((k) => LANG_SETS[k].has(w));
      if (langs.length) hits++;
      langs.forEach((k) => { score[k] += 1 / langs.length; });
    });
    // in a single title one word is not enough ("Original Sin": "sin" is also Spanish)
    if (perTitle && hits < 2) return vowelGuess(text, 0.6, 0.2);
    const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
    const clear = ranked[0][1] >= 1 && !(ranked[1][1] > 0 && ranked[0][1] < 1.5 * ranked[1][1]); // not too uncertain
    if (clear) return ranked[0][0];
    // weak hints all on the same side: only words of non-English languages ("la", "del") -> non-English
    const other = Object.keys(score).filter((k) => k !== 'en').reduce((a, k) => a + score[k], 0);
    if (score.en === 0 && other >= 0.5) return 'xx';
    if (other === 0 && score.en >= 0.5) return 'en';
    return perTitle ? vowelGuess(text, 0.6, 0.2) : vowelGuess(text, 0.5, 0.25);
  }

  // Track positions in the RYM standard (numbers or side+number only):
  //  - trailing dot and media prefix: "1." -> "1", "CD.1" -> "1", "DVD 3" -> "3", "CD.7a" -> "7a"
  //  - several discs: "1-1", "CD2-03", "2.4" -> "1.1", "2.3", "2.4" (one disc only: "1-5" -> "5")
  //  - different media (CD + DVD): a line without number "CD" / "DVD" before their tracks,
  //    two-level numbering 1.x / 2.x
  //  - sides: "A01" -> "A1"; non-standard sides ("AA", "AA1", "BB") -> A, B, C... in order
  //  - only one track on the side: "A1" -> "A"
  //  - numbers: "01" -> "1"
  const MEDIA_LABEL = { cd: 'CD', dvd: 'DVD', bluray: 'Blu-ray', bd: 'Blu-ray', sacd: 'SACD', vhs: 'VHS' };
  function normPositions(rows) {
    const tracks = rows.filter((t) => !t.header);
    const discRe = /^(?:disc|disk)?\s*(\d+)\s*[-–.]\s*0*(\d+)([a-z]?)$/i;
    const sideRe = /^([A-Z])(\1*)\s*0*(\d*)((?:[a-z]|\.\d+|\.[a-z])?)$/; // "A", "AA2", "A01", "A1a"

    // 1) trailing dot and media prefix
    tracks.forEach((t) => {
      let p = (t.pos || '').trim().replace(/\.$/, '');
      const m = p.match(/^(cd|dvd|blu-?ray|bd|sacd|vhs)\s*[.:\-]?\s*(\d.*)$/i);
      if (m) { t.media = MEDIA_LABEL[m[1].toLowerCase().replace('-', '')]; p = m[2]; }
      t.pos = p;
    });

    // 2) disc number ("1-3", "2.10")
    tracks.forEach((t) => {
      const m = t.pos.match(discRe);
      if (m) { t.disc = +m[1]; t.pos = m[2] + m[3]; }
    });

    // 3) vinyl/cassette sides
    const side = new Map(); // track -> { s: side, n: number, r: rest }
    tracks.forEach((t) => {
      if (t.disc || t.media) return;
      const m = t.pos.match(sideRe);
      if (!m) return;
      side.set(t, { s: (m[1] + m[2]).toUpperCase(), n: m[3], r: m[4] });
    });
    // Repeated letter without a number ("BB", "BBB") when the side already exists: it is track 2, 3… of that side
    // (A, B, BB -> A, B1, B2). Exception: "A" + "AA" with no B side is a double A-side single, AA is the flip side (-> B).
    const singles = new Set([...side.values()].filter((v) => v.s.length === 1).map((v) => v.s));
    side.forEach((v) => {
      const X = v.s[0];
      if (v.s.length > 1 && !v.n && !v.r && singles.has(X) && (X !== 'A' || singles.has('B'))) { v.n = String(v.s.length); v.s = X; }
    });
    const order = [];
    side.forEach((v) => { if (!order.includes(v.s)) order.push(v.s); });
    const remap = order.some((x) => x.length > 1); // remaining "AA" & co.: rename all sides in order
    const letter = {};
    order.forEach((x, i) => { letter[x] = remap ? String.fromCharCode(65 + i) : x; });
    const perSide = {};
    side.forEach((v) => { perSide[v.s] = (perSide[v.s] || 0) + 1; });
    // on a side with several tracks, the one without a number is the first ("B" -> "B1")
    side.forEach((v) => { if (perSide[v.s] > 1 && !v.n && !v.r) v.n = '1'; });
    side.forEach((v, t) => {
      const L = letter[v.s];
      t.pos = perSide[v.s] === 1 && !v.r ? L : L + (v.n ? String(+v.n) : '') + v.r;
    });

    // 4) leading zeros
    tracks.forEach((t) => { if (!side.has(t) && /^0+\d/.test(t.pos)) t.pos = t.pos.replace(/^0+(?=\d)/, ''); });

    // 5) final numbering and media lines
    let media = [...new Set(tracks.map((t) => t.media).filter(Boolean))];
    // one prefixed medium ("DVD1") and other tracks without prefix: those belong to the main medium (e.g. CD)
    const baseLabel = MEDIA_LABEL[(D.formatName || '').toLowerCase().replace('-', '')];
    if (media.length === 1 && baseLabel && baseLabel !== media[0] && tracks.some((t) => !t.media)) {
      for (const t of tracks) { if (t.media) break; t.media = baseLabel; }
      media = [...new Set(tracks.map((t) => t.media).filter(Boolean))];
    }
    if (media.length >= 2) {
      // tracks without prefix: same medium as the previous track
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
          if (r.mediaHeading) return; // 'DVD "Concerto…"': replaced by the "DVD" line
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

  // Performance attributes: returns { attrs: [[id, name, reason]], additional, warn }
  function perfAttrs(T, type) {
    const tracks = T.tracks.filter((t) => !t.header);
    const n = tracks.length;
    const title = D.title || '';
    const styles = (D.styles || []).concat(D.genres || []).map((s) => s.toLowerCase());
    const desc = D.descriptions || [];
    const notes = D.notes || '';
    const out = [], warn = [];
    const share = (re) => (n ? tracks.filter((t) => re.test(t.title)).length / n : 0);
    const pct = (x) => Math.round(x * 100) + '% of tracks';
    const focal = n ? tracks[0].title : ''; // singles: the focal track (the first one) is what counts
    const isSingle = type === 'i';

    // "Additional release" content
    const shares = ADDITIONAL.map(([re, id, name]) => [id, name, isSingle ? (re.test(focal) ? 1 : 0) : share(re)]);
    if (/\binstrumentals\b/i.test(title)) shares.find((s) => s[0] === 127)[2] = 1;      // "The Instrumentals"
    if (styles.includes('interview')) shares.find((s) => s[0] === 14)[2] = 1;
    if (desc.includes('Sampler') && !D.various) shares.push([132, 'Sampler', 1]);    // not for V/A label samplers
    const union = isSingle ? (shares.some((s) => s[2] > 0) ? 1 : 0)
      : (n ? tracks.filter((t) => ADDITIONAL.some(([re]) => re.test(t.title))).length / n : 0);
    let addl = shares.filter((s) => s[2] > 0.5);
    if (!addl.length && union > 0.5) addl = shares.filter((s) => s[2] >= 0.2);
    addl.forEach(([id, name, sh]) => out.push([id, name, sh >= 1 ? 'whole release' : pct(sh)]));

    // Live (or Live sessions if already found above)
    const liveShare = isSingle ? (PERF.live.test(focal) ? 1 : 0) : share(PERF.live);
    const liveTitle = /\blive (at|in|from|on)\b|\(live\b|\[live\b/i.test(title);
    const liveNotes = /recorded live\b|live recording/i.test(notes) && !/live (in|at) (the )?studio|live in studio/i.test(notes);
    if (!out.some((a) => a[0] === 131) && (liveShare > 0.5 || liveTitle || liveNotes)) {
      out.push([5, 'Live', liveShare > 0.5 ? pct(liveShare) : liveTitle ? 'title' : 'release notes']);
      warn.push('Live: for RYM only if recorded in front of a real audience; studio/radio sessions go under "Live sessions".');
    }

    // Remixes: singles -> only if the focal track is a remix
    const remixShare = isSingle ? (PERF.remix.test(focal) ? 1 : 0) : share(PERF.remix);
    if (remixShare > 0.5) out.push([24, 'Remixes', isSingle ? 'focal track is a remix' : pct(remixShare)]);

    // Selector Comp: unmixed V/A compilation with a credited compiler
    if (D.various && D.compiledBy && !desc.includes('Mixed')) {
      out.push([10, 'Selector Comp', 'credited compiler']);
      warn.push('Selector Comp: add the compiler in the credits (role "compiler").');
    }

    // Archival: recorded at least 10 years before release (year in the notes: "Recorded ... 1972")
    const recYears = [...notes.matchAll(/recorded[^.\n]{0,80}?\b(19\d\d|20\d\d)\b/gi)].map((m) => +m[1]);
    const reissue = desc.includes('Reissue') || desc.includes('Repress') || /originally released/i.test(notes); // reissue: not archival
    if (recYears.length && D.year && !reissue && !['c', 'b'].includes(type)) {
      const rec = Math.min(...recYears);
      if (+D.year - rec >= 10) out.push([7, 'Archival', 'recorded in ' + rec + ', released in ' + D.year]);
    }

    // Creative Commons
    if (D.cc || /creative\s*commons|creativecommons\.org|\bcc[\s-]by\b/i.test(notes)) out.push([78, 'Creative Commons', 'license stated']);

    // Soundtracks (Discogs styles / Bandcamp tags)
    const st = (s) => styles.some((x) => x === s || (s.length > 4 && x.includes(s))); // "ost" exact only (not "post-punk")
    const text = (title + ' ' + notes).toLowerCase();
    if (st('score') || st('film score')) out.push([53, 'Film Score', 'style "Score"']);
    else if (st('soundtrack') || st('ost') || st('video game music') || st('vgm')) {
      if (st('video game') || st('vgm') || /video\s*game|game soundtrack/.test(text)) out.push([56, 'Video Game Soundtrack', 'video game soundtrack']);
      else if (/\b(tv|television|series)\b/.test(text)) out.push([55, 'Television Soundtrack', 'TV soundtrack']);
      else out.push([54, 'Motion Picture Soundtrack', 'style "Soundtrack"']);
    }
    if (st('musical')) out.push([57, 'Cast Recording', 'style "Musical"']);
    if (out.some((a) => [53, 54, 55, 56, 57].includes(a[0]))) warn.push('Soundtrack: check the kind (film, TV, video game, cast) and the "file under" (composers or V/A).');

    const additional = addl.length > 0;
    if (additional) warn.push('"Additional release" content (' + addl.map((a) => a[1]).join(', ') + '): for RYM it belongs in that section. Check it.');
    if (out.length && (desc.includes('Reissue') || desc.includes('Repress'))) warn.push('Performance attributes can only be set on the primary issue.');
    return { attrs: out, additional, warn };
  }

  // Capitalization mode for the current release (checkbox state)
  // Release language: majority vote of the recognisable titles (English vs non-English);
  // with fewer than 3 votes or a tie, all the words together decide.
  function releaseLang() {
    const titles = [D.title].concat((D.tracks || []).map((t) => t.title)).filter(Boolean);
    const votes = {};
    titles.forEach((t) => { const l = detectLang(t, true); if (l !== 'unknown') votes[l] = (votes[l] || 0) + 1; });
    const en = votes.en || 0;
    const nonEn = Object.keys(votes).filter((k) => k !== 'en');
    const nonEnTotal = nonEn.reduce((a, k) => a + votes[k], 0);
    if (en + nonEnTotal < 3) return detectLang(titles.join(' ')); // too few votes
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
  // Mode for a single title: 'en' (English), 'sent' (first letter only), 'keep' (leave as is).
  // In automatic mode it decides title by title (records with songs in several languages); without hints the release language applies.
  function capsModeFor(str, C) {
    if (!C.auto) return C.english ? 'en' : 'sent';
    let lt = detectLang(str, true);
    if (lt === 'unknown') lt = C.lang;
    if (lt === 'de') return 'keep'; // German: nouns are capitalized
    return lt === 'en' || lt === 'unknown' ? 'en' : 'sent';
  }

  // Vinyl: RYM wants track times only if they are printed on the record/sleeve. The uploader decides with the
  // "Import track times" checkbox (unticked by default), shown only for vinyl.
  const isVinyl = () => /^(vinyl|lathe cut|flexi-disc|shellac|acetate)$/i.test(D.formatName || '');

  // Title and tracks ready for RYM. Lines without a number (suites, works, sections, "CD"/"DVD")
  // go in bold: [b]Title[/b].
  function prepare() {
    const res = prepareTexts();
    // untitled tracks: "[untitled]" (RYM wiki, "Add release information" §17.1), after capitalization
    let untitled = 0;
    res.tracks.forEach((t) => {
      if (!t.header && /^[\[(]?\s*untitled\s*[\])]?$/i.test((t.title || '').trim())) { t.title = '[untitled]'; untitled++; }
    });
    if (untitled) res.log.push('Untitled tracks written as "[untitled]": ' + untitled);
    // Various Artists: "Artist - Title" (short dash with spaces), after capitalization so the name stays as it is
    if (D.various) {
      let withArtist = 0;
      res.tracks.forEach((t) => {
        if (t.header || !t.artist || isVarious(t.artist)) return;
        if (t.title.toLowerCase().startsWith(t.artist.toLowerCase() + ' - ')) return;
        t.plain = t.title; // title without the artist: used for the proposed single title
        t.title = t.artist + ' - ' + t.title; withArtist++;
      });
      if (withArtist) res.log.push('V/A: artist name added before the title in ' + withArtist + ' tracks');
    }
    res.tracks.forEach((t) => {
      if (t.header && t.title && !/^\[b\][\s\S]*\[\/b\]$/i.test(t.title)) t.title = '[b]' + t.title + '[/b]';
    });
    return res;
  }

  // Title and tracks with RYM positions and fixed capitalization
  function prepareTexts() {
    const tracks = (D.tracks || []).map((t) => Object.assign({}, t));
    const res = { title: D.title || '', tracks, log: [], warn: [] };
    tracks.forEach((t) => { t.orig = t.pos; });
    // RYM does not want "(Original Mix)", "(Original)", "(Original Version)" in titles
    const ORIGINAL = /\s*(?:[(\[]\s*original(?:\s+(?:mix|version))?\s*[)\]]|\s[-–]\s*original(?:\s+(?:mix|version))?)\s*$/i;
    let origCut = 0;
    tracks.forEach((t) => { if (!t.header && ORIGINAL.test(t.title)) { t.title = t.title.replace(ORIGINAL, ''); origCut++; } });
    if (ORIGINAL.test(res.title)) res.title = res.title.replace(ORIGINAL, '');
    if (origCut) res.log.push('Removed "(Original Mix)" / "(Original)" from ' + origCut + ' tracks');
    res.tracks = normPositions(tracks);
    const changed = res.tracks.find((t) => !t.header && t.pos !== t.orig);
    if (changed) res.log.push('Track positions adapted to RYM (e.g. "' + changed.orig + '" → "' + changed.pos + '")');
    if (isVinyl() && !durVinyl && res.tracks.some((t) => t.dur)) {
      res.tracks.forEach((t) => { t.dur = ''; });
      res.log.push('Vinyl: track times not imported ("Import track times" unticked)');
    }
    const mediaRows = res.tracks.filter((t) => t.mediaRow).map((t) => t.title);
    if (mediaRows.length) res.log.push('Media lines (no number): ' + mediaRows.join(', '));
    const C = capsState();
    const protect = [D.artist, D.artistSearch].filter(Boolean);
    const rows = res.tracks.filter((t) => !t.mediaRow); // the "CD"/"DVD" lines stay as they are
    if (C.hold) {
      res.warn.push('Classical: capitalization left as on Discogs (works follow their own rules). Check it, or pick the mode with the checkbox.');
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
    if (count.en) res.log.push('RYM English capitalization: ' + count.en + ' titles');
    if (count.sent) res.log.push('First letter only (non-English titles): ' + count.sent + ' titles');
    if (res.title !== before) res.log.push('Title: «' + before + '» → «' + res.title + '»');
    if (C.auto && C.lang !== 'unknown') res.log.push('Estimated language: ' + LANG_NAME[C.lang] + ' (change the mode with the checkbox)');
    if (flags.size) {
      res.warn.push('Capitalization: check ' + [...flags].map((f) => '«' + f + '»').join(', ') +
        ': lowercase if preposition or conjunction, capitalized if adverb (e.g. "Keep On Rockin\'", "You Are So Beautiful").');
    }
    if (count.sent || (!C.auto && !C.english)) res.warn.push('Non-English titles: check proper names, places and band names, which must be capitalized (e.g. "Il meglio di Elio e le Storie Tese").');
    if (count.keep) res.warn.push('German titles left as on Discogs (nouns are capitalized): check them by hand.');
    return res;
  }

  // ---- DOM helpers ----
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
  // initial state of the radio buttons, so it can be restored
  const INITIAL = {};
  ['category', 'type', 'format', 'disc_size'].forEach((n) => { INITIAL[n] = radioVal(n); });

  // Undo what the script filled in (before filling another release)
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
      try { W.goAdvanced(); $('#track_advanced').value = ''; W.goSimple(); } catch (e) { /* ignore */ }
      touched.tracks = false;
    }
  }

  // Artists already set on the page (1.3a), compared with the release artist
  const norm = (s) => clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^the\s+/, '').replace(/[^\p{L}\p{N}]/gu, '');
  function pageArtists() {
    return [...document.querySelectorAll('[id^="filed_under_performer_artist_"][id$="_preview"] a')].map((a) => a.textContent.trim()).filter(Boolean);
  }
  function artistMismatch() {
    const names = pageArtists();
    if (!D || D.various || !names.length) return null;
    // for classical music the performers count too (Discogs often lists the composer as the artist)
    const want = [D.artistSearch, D.artist].concat((D.performers || []).map((p) => p.replace(/\s*\([^)]*\)$/, ''))).map(norm).filter(Boolean);
    const ok = names.some((n) => want.some((w) => norm(n).includes(w) || w.includes(norm(n))));
    return ok ? null : names.join(', ');
  }

  // ---- form filling logic ----
  function fill() {
    if (loadData()) renderPanel(); // always use the latest saved release
    if (!D) return;
    if (filledRaw) resetForm();    // clear the data of the previous fill
    const log = [];                // details (collapsed section)
    const warn = [];               // details (collapsed section)
    const sum = [];                // green line: what was filled in
    const todo = [];               // shown: only what needs action
    const desc = D.descriptions || [];
    const T = prepare();           // title and tracks with RYM capitalization

    const other = artistMismatch();
    if (other) {
      warn.push('WARNING: this page belongs to the artist "' + other + '", the release is by "' + D.artist + '". Open the right Add release page.');
      todo.push('Page of another artist ("' + other + '"): open the Add release page of "' + D.artist + '"');
    }

    // 1.2 Category: classical / Various Artists / 1.3a File under
    if (D.classical) {
      clickRadio('category', 'classical');
      log.push('Category: Classical music release');
      sum.push('Classical');
      todo.push('File under the performers, not the composer' + ((D.performers || []).length ? ': ' + D.performers.map((p) => p.replace(/\s*\([^)]*\)$/, '')).slice(0, 3).join(', ') : ''));
      warn.push('Classical: "file under" goes to the performers (conductor, soloists, orchestra), not the composers. Link the tracks to the works ([WorkXXXX]) as per the "Classical music" wiki.');
      if ((D.performers || []).length) warn.push('Performers on Discogs: ' + D.performers.join(', ') + '.');
      if (!form.querySelector('input[id^="filed_under_performer_artist_"]') && (D.performers || []).length) {
        const who = D.performers[0].replace(/\s*\([^)]*\)$/, ''); // search the first performer, not the composer
        setVal($('#filed_under_searchterm'), who);
        const fr = $('#filed_underperformerlist');
        if (fr) fr.src = '/go/searchcredits?target=filedunderperformer&label=performer&searchterm=' + encodeURIComponent(who);
      }
    } else if (D.various && (D.tracks || []).filter((t) => !t.header).length <= 4) {
      log.push('V/A with 4 tracks or fewer: category left as standard (probably a split)');
    } else if (D.various) {
      clickRadio('category', 'va');
      log.push('Category: Various Artists');
      sum.push('V/A');
      warn.push('V/A: link the artists in the tracklist with "Insert link to artist".');
    } else if (!form.querySelector('input[id^="filed_under_performer_artist_"]')) {
      setVal($('#filed_under_searchterm'), D.artistSearch);
      const fr = $('#filed_underperformerlist'); // same URL as RYM's own searchfiled_under()
      if (fr) fr.src = '/go/searchcredits?target=filedunderperformer&label=performer&searchterm=' + encodeURIComponent(D.artistSearch);
      warn.push('Artist not set: pick "' + D.artistSearch + '" from the results on the right (1.3a).');
      todo.push('Pick the artist "' + D.artistSearch + '" on the right (1.3a)');
    }

    // format and size are needed to estimate the type
    let fmt = FORMAT[D.formatName];
    // RYM: Digital File or Lossless Digital, never both; prefer the higher quality
    if (D.formatName === 'File' && (D.lossless || desc.some((x) => /FLAC|WAV|ALAC|AIFF/i.test(x)))) fmt = 59;
    const digital = fmt === 58 || fmt === 59;
    let size = Object.keys(DISC_SIZE).find((k) => desc.includes(k));
    if (!size && fmt === 95 && desc.includes('LP')) size = '12"';

    // 1.5 Release type (+ performance attributes, which can move it to "Additional releases")
    let G = guessType(fmt, size);
    const P = perfAttrs(T, G.type);
    if (P.additional && G.type !== 'b') G = { type: 'x', reason: 'content: ' + P.attrs.filter((a) => ADDITIONAL.some((x) => x[1] === a[1]) || a[0] === 132).map((a) => a[1]).join(', '), sure: false };
    clickRadio('type', G.type);
    log.push('Type: ' + TYPE_NAME[G.type] + ' (' + G.reason + ')');
    sum.push(TYPE_NAME[G.type] + (G.sure ? '' : '?'));
    if (G.unknown) { warn.push('No tracklist and no format hints: the type CANNOT be estimated, pick it yourself (1.5).'); todo.push('Pick the release type (1.5)'); }
    else if (!G.sure) { warn.push('Estimated type (' + G.reason + '): check it (1.5). For RYM, what the artist or label declares is what counts.'); todo.push('Estimated type: ' + TYPE_NAME[G.type] + ' (' + G.reason + ')'); }
    if (!G.sure && !G.unknown && /unknown duration|over/.test(G.reason)) warn.push('Missing durations: the estimate relies mostly on the number of tracks.');
    if (G.type === 'c' && D.various) warn.push('V/A compilation: for RYM it is a compilation only if more than 50% was previously released. If it is new material, use Standard Album.');
    if (G.type === 'j') warn.push('DJ Mix only if the release is credited to the DJ who mixed it.');

    // RYM standard title for singles (physical formats only: digital singles keep the retailer title)
    let suggested = '';
    if (G.type === 'i' && !digital) {
      suggested = singleTitle(T.tracks);
      if (suggested && suggested.toLowerCase() !== (T.title || '').toLowerCase()) {
        warn.push('RYM standard single title: "' + suggested + '" (use the button below to apply it).');
        todo.push('RYM single title: "' + suggested + '" (button below)');
      } else suggested = '';
    }

    // 1.6 Date
    if (setSelect('year', D.year)) { log.push('Date: ' + [D.year, D.month, D.day].filter(Boolean).join('-')); sum.push([D.year, D.month, D.day].filter(Boolean).join('-')); }
    else { warn.push('Year not set.'); todo.push('Date missing'); }
    setSelect('month', D.month);
    setSelect('day', D.day);
    if (SRC === 'Bandcamp') warn.push('The Bandcamp date is sometimes the upload date: check it.');

    // 2.1 Title (+ result of the capitalization fix)
    if (setVal($('#title'), T.title)) log.push('Title');
    log.push(...T.log);
    warn.push(...T.warn);

    // 3.1 Format
    if (fmt && clickRadio('format', fmt)) {
      log.push('Format: ' + (digital ? 'Digital File' : D.formatName));
      sum.push((digital ? (fmt === 59 ? 'Lossless Digital' : 'Digital File') : D.formatName) + (size ? ' ' + size : ''));
    } else { warn.push('Format "' + D.formatName + '" not mapped: pick it by hand.'); todo.push('Pick the format (3.1)'); }

    if (digital) {
      // Bandcamp: usually both "Digital file" and "Streaming"; Streaming only if not downloadable
      const dist = [];
      if (!D.streamingOnly && check('attrib122')) dist.push('Digital file');
      if (D.streaming && check('attrib123')) dist.push('Streaming');
      if (dist.length) log.push('Distribution: ' + dist.join(' + '));
      if (D.streamingOnly) warn.push('Looks streaming-only: set Digital File + "Streaming" only. Check it.');
      if (D.downloadUnknown) warn.push('Can\'t tell if it is downloadable: if it is streaming-only, untick "Digital file" and use Digital File instead of Lossless.');
    }
    if (D.oldDate) {
      warn.push('Bandcamp shows ' + D.oldDate + ': that is the original release date, not the digital one. RYM wants it blank without a reliable source. Probably a secondary issue (1.1).');
      todo.push('Original date ' + D.oldDate + ' not used: probably a secondary issue (1.1)');
    }

    // 3.2 Disc size (mandatory for vinyl; for CDs only if non-standard)
    if (size) { clickRadio('disc_size', DISC_SIZE[size]); log.push('Disc: ' + size); }
    else if (fmt === 95) { warn.push('Vinyl without size: set Disc size (3.2).'); todo.push('Set Disc size (3.2)'); }

    // 3.3 / 3.4 Label and catalog number (wiki "Catalog numbers")
    //  - no label: label "(No Label)" and catalog "n/a" (if Discogs gives no number)
    //  - physical, on a label, no number: "n/a"
    //  - digital, on a label, no number: blank
    const lab = (D.labels || [])[0];
    const noLabel = (lab && /^not on label/i.test(lab.name)) || (!lab && D.selfReleased);
    const labelSearch = noLabel ? 'No Label' : (lab ? lab.name : '');
    if (labelSearch) {
      setVal($('#searchterm'), labelSearch);
      const lf = $('#labellist'); // same URL as RYM's own searchLabels()
      if (lf) lf.src = '/go/search?searchtype=b&searchterm=' + encodeURIComponent(labelSearch);
    }
    let catno = lab ? lab.catno : '';
    if (noLabel && !catno) catno = 'n/a'; // no label: "n/a" only if there is no catalog number
    else if (lab && !catno && lab.noCat && !digital) catno = 'n/a';
    if (setVal($('#catalog_no'), catno)) { log.push('Catalog #: ' + catno); sum.push('cat. ' + catno); }
    if (noLabel) warn.push('No label' + (SRC === 'Bandcamp' ? ' (probably self-released)' : '') + ': pick "(No Label)" from the results on the right (3.3).');
    else if (lab) warn.push('Label: click "' + lab.name + '" in the results on the right (3.3).');

    // Untitled releases ("Untitled" on Discogs), except singles (for them the title comes from the tracks):
    // the RYM wiki says self-titled (artist name); the catalog number is offered as an alternative.
    const suggestions = suggested ? [suggested] : [];
    if (/^\[?(untitled|s\/t|self[\s-]?titled)\]?$/i.test((D.title || '').trim()) && G.type !== 'i') {
      if (D.artist && !D.various) suggestions.push(D.artist);
      if (catno && catno !== 'n/a') suggestions.push(catno);
      if (suggestions.length) todo.push('Untitled release: per the RYM wiki it is self-titled (artist name); pick below');
    }

    // 3.5 Countries (blank = worldwide; RYM wants no country for digital)
    if (D.country && !digital) {
      const C = mapCountries(D.country);
      if (setVal($('#countries'), C.value)) {
        log.push('Country: ' + C.value);
        sum.push(C.value);
        warn.push('Country: if RYM does not recognise "' + C.value + '", delete it and pick it from the suggestions (3.5).');
      }
      if (C.skipped.length) warn.push('Discogs says "' + C.skipped.join(', ') + '": that is a region, not a country. Left blank (blank = worldwide).');
      if (C.unknown.length) {
        warn.push('Country "' + C.unknown.join(', ') + '" is not in the RYM list: not inserted.');
        todo.push('Country "' + C.unknown.join(', ') + '" does not exist on RYM: pick it by hand (3.5)');
      }
    }

    // 3.6 Issue attributes (Discogs descriptions + format free text)
    const attrs = new Map(); // id -> name, no duplicates
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
    // Bonus tracks: also from a "Bonus" heading in the tracklist or "(Bonus Track)" in titles
    if (D.bonusHeading || (D.tracks || []).some((t) => /bonus track/i.test(t.title))) add(62, 'Bonus Tracks');
    // Digital download: only a coupon/code in the package (not a Bandcamp purchase)
    if (SRC !== 'Bandcamp' && !digital && /download (code|card|coupon|voucher)|includes? (a )?(digital )?download/i.test(freeText + ' ' + (D.notes || ''))) add(101, 'Digital Download');
    if (D.boxSet) add(12, 'Box Set');
    if (D.formatName === 'Flexi-disc') add(66, 'Flexi-disc');
    if (desc.includes('Unofficial Release') && (desc.includes('Mixed') || desc.includes('Mixtape'))) add(100, 'Unauthorized mixtape/DJ mix');
    // RYM exclusion rules
    const drop = (id) => { if (attrs.has(id)) { const el = document.getElementById('attrib' + id); if (el && el.checked && touched.attribs.has('attrib' + id)) { el.click(); touched.attribs.delete('attrib' + id); } attrs.delete(id); } };
    if (attrs.has(73)) drop(16);                // Numbered: no Limited
    if (attrs.has(60)) drop(81);                // LP replica: no Paper/Cardboard Sleeve
    if (attrs.has(110)) drop(81);               // MusicPac: no Paper/Cardboard Sleeve
    if (['i', 'e', 'c'].includes(G.type)) drop(37); // Abridged: not for singles, EPs and compilations
    if (attrs.size) log.push('Attributes: ' + [...attrs.values()].join(', '));

    // 4.3 Performance attributes
    const perf = [];
    P.attrs.forEach(([id, name, why]) => { if (!attrs.has(id) && check('attrib' + id)) { attrs.set(id, name); perf.push(name + ' (' + why + ')'); } });
    if (perf.length) log.push('Performance: ' + perf.join(', '));
    warn.push(...P.warn);
    const flagWarn = T.warn.find((w) => w.startsWith('Capitalization: check'));
    if (flagWarn) todo.push('Capitalization to check: ' + flagWarn.replace(/^Capitalization: check (.*?): lowercase.*$/, '$1'));

    // 3.7 Tracklist (via Advanced mode, then back to Simple as RYM requires)
    if (T.tracks.length) {
      try {
        W.goAdvanced();
        $('#track_advanced').value = T.tracks.map((t) => t.pos + '|' + t.title + '|' + t.dur).join('\n');
        W.goSimple();
        touched.tracks = true;
        const heads = T.tracks.filter((t) => t.header).length;
        log.push('Tracks: ' + (T.tracks.length - heads) + (heads ? ' + ' + heads + ' headers (works in several movements, no number)' : ''));
        sum.push((T.tracks.length - heads) + ' tracks' + (heads ? ' + ' + heads + ' headers' : '') + (isVinyl() && !durVinyl && (D.tracks || []).some((t) => t.dur) ? ', no track times' : ''));
      } catch (e) {
        warn.push('Tracklist not inserted: use the "Copy tracks" button and paste them in Advanced mode.');
        todo.push('Tracklist not inserted: use "Copy tracks" and paste it in Advanced');
      }
    }

    // 5.1 Sources
    const notes = $('#notes');
    if (notes && !notes.value.includes(D.url)) {
      setVal(notes, (notes.value ? notes.value + '\n' : '') + D.url);
      touched.notesUrl = D.url;
    }
    log.push('Source: ' + SRC);

    // General warnings
    if (desc.includes('Reissue') || desc.includes('Repress')) { warn.push('It is a reissue: set the "Primary issue" (1.1).'); todo.push('Reissue: set the primary issue (1.1)'); }
    else if (D.masterYear && D.year && +D.year > +D.masterYear && D.mainRelease !== D.id) {
      warn.push('Discogs: this record was first released in ' + D.masterYear + ', this one is from ' + D.year + '. Probably a reissue: add it as an issue of the existing release (1.1).');
      todo.push('Probably a reissue (first released ' + D.masterYear + '): add it as an issue (1.1)');
    }
    if ((D.featured || []).length) {
      warn.push('Featured on Discogs: ' + D.featured.join(', ') + '.');
      todo.push('Featured to add in the credits: ' + D.featured.slice(0, 4).join(', ') + (D.featured.length > 4 ? ' and more' : ''));
    }
    if (desc.includes('Promo')) { warn.push('Promo: for RYM it is a secondary issue of the main release (1.1).'); todo.push('Promo: add it as a secondary issue (1.1)'); }
    if ((D.labels || []).length > 1) { warn.push('Several labels on Discogs: RYM takes one, the most specific (or the one closest to the artist).'); todo.push('Several labels on Discogs: pick one'); }

    filledRaw = rawSeen;
    renderPanel();
    report({ sum, spunte: [...attrs.values()], todo, details: log.concat(warn) }, suggestions);
  }

  // ---- panel ----
  const panel = css(document.createElement('div'), {
    position: 'fixed', top: '70px', right: '15px', width: '320px', maxHeight: '80vh', overflowY: 'auto',
    background: '#1e2433', color: '#eee', border: '2px solid #c0392b', borderRadius: '8px', padding: '10px',
    zIndex: 99999, fontSize: '13px', lineHeight: '1.4', boxShadow: '0 3px 10px rgba(0,0,0,.5)'
  });
  const banner = (text, color) => '<div style="background:' + color + ';color:#fff;border-radius:4px;padding:6px;margin:6px 0">' + esc(text) + '</div>';

  // (Re)draws the panel with the current release; reopens it if it was closed
  function renderPanel() {
    if (!D) return;
    const lab0 = (D.labels || [])[0] || {};
    const when = D.savedAt ? new Date(D.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const other = artistMismatch();
    panel.innerHTML =
      '<div style="font-weight:bold;font-size:15px;margin-bottom:4px">Postino · ' + esc(SRC) + ' → RYM</div>' +
      '<div><b>' + esc(D.artist) + '</b> – ' + esc(D.title) + '</div>' +
      '<div>' + esc([D.year, D.formatName === 'File' ? 'Digital' : D.formatName, (D.descriptions || []).join(', ')].filter(Boolean).join(' · ')) + '</div>' +
      '<div>' + esc([lab0.name, lab0.catno, D.country].filter(Boolean).join(' · ')) + '</div>' +
      '<div style="opacity:.7">' + (D.tracks || []).filter((t) => !t.header).length + ' tracks' + (when ? ' · sent at ' + when : '') + '</div>' +
      (filledRaw && filledRaw !== rawSeen ? banner('New release loaded. Press "Fill form" to replace the data of the previous one.', '#2a6fdb') : '') +
      (other ? banner('This page belongs to the artist "' + other + '", the release is by "' + D.artist + '". Open the right Add release page.', '#b03a2e') : '') +
      '<div id="drym_bar"></div><div id="drym_out" style="margin-top:6px"></div>';

    const bar = panel.querySelector('#drym_bar');
    bar.appendChild(btn('Fill form', fill, '#27ae60'));
    if (other) bar.appendChild(btn('Search "' + D.artistSearch + '" on RYM', () => GM_openInTab('https://rateyourmusic.com/search?searchterm=' + encodeURIComponent(D.artistSearch) + '&searchtype=a', { active: true }), '#b03a2e'));
    bar.appendChild(btn('Copy tracks', () => GM_setClipboard(prepare().tracks.map((t) => t.pos + '|' + t.title + '|' + t.dur).join('\n'))));
    if (D.country) bar.appendChild(btn('Copy country', () => GM_setClipboard(D.country)));
    if ((D.credits || []).length) bar.appendChild(btn('Copy credits', () => GM_setClipboard(D.credits.join('\n'))));
    bar.appendChild(btn('Close', () => panel.remove(), '#555'));
    bar.appendChild(btn('Clear data', () => { GM_deleteValue(KEY); D = null; panel.remove(); }, '#7f1d1d'));

    const lbl = css(document.createElement('label'), { display: 'block', margin: '4px 3px', cursor: 'pointer' });
    const C = capsState();
    lbl.innerHTML = '<input type="checkbox" id="drym_caps"' + (C.english ? ' checked' : '') + '> English capitalization' +
      '<div style="opacity:.7;font-size:11px;margin-left:18px">unticked: first letter only (non-English titles)' + (C.auto ? ' · now automatic, title by title, by language' : '') + '</div>';
    lbl.querySelector('input').addEventListener('change', (e) => { capsMode = e.target.checked; if (filledRaw) fill(); else renderPanel(); });
    bar.appendChild(lbl);

    if (isVinyl() && (D.tracks || []).some((t) => t.dur)) { // only if Discogs has track times
      const dl = css(document.createElement('label'), { display: 'block', margin: '4px 3px', cursor: 'pointer' });
      dl.innerHTML = '<input type="checkbox" id="drym_dur"' + (durVinyl ? ' checked' : '') + '> Import track times' +
        '<div style="opacity:.7;font-size:11px;margin-left:18px">vinyl: on RYM only if printed on the record or the sleeve</div>';
      dl.querySelector('input').addEventListener('change', (e) => { durVinyl = e.target.checked; if (filledRaw) fill(); else renderPanel(); });
      bar.appendChild(dl);
    }

    if (!panel.isConnected) document.body.appendChild(panel);
  }

  // ---- update without reloading the page ----
  // When you send another release from Discogs/Bandcamp, the panel updates by itself.
  function onNewData(raw) {
    if (loadData(raw)) renderPanel();
  }
  if (typeof GM_addValueChangeListener === 'function') {
    try { GM_addValueChangeListener(KEY, (name, oldValue, newValue) => { if (newValue) onNewData(newValue); }); } catch (e) { /* ignore */ }
  }
  // fallback: check again when you come back to the tab or the browser restores it from cache
  window.addEventListener('focus', () => onNewData());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) onNewData(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) onNewData(); });
  onNewData();

  // Summary: green line (what was filled in), "To do" (only what needs action),
  // and everything else in "Details", collapsed by default.
  function report(R, suggested) { // suggested = list of proposed titles (buttons)
    const out = panel.querySelector('#drym_out');
    out.innerHTML =
      '<div style="color:#7dda8a">✔ ' + esc(R.sum.join(' · ')) + '</div>' +
      (R.spunte.length ? '<div style="color:#7dda8a;opacity:.85;font-size:12px">Checkboxes: ' + esc(R.spunte.join(', ')) + '</div>' : '') +
      (R.todo.length ? '<div style="color:#f5c26b;margin-top:6px"><b>To do</b><br>• ' + R.todo.map(esc).join('<br>• ') + '</div>' : '') +
      '<details style="margin-top:6px;opacity:.8;font-size:12px"><summary style="cursor:pointer">Details</summary>' +
      R.details.map((d) => '<div>' + esc(d) + '</div>').join('') + '</details>';
    (suggested || []).forEach((t) => {
      out.appendChild(btn('Use title: ' + t, (e) => {
        setVal($('#title'), t);
        out.querySelectorAll('button').forEach((b) => { if (b.textContent.startsWith('Title applied')) b.textContent = b.dataset.label; b.disabled = false; });
        e.target.dataset.label = e.target.textContent;
        e.target.textContent = 'Title applied ✔';
        e.target.disabled = true;
      }, '#8e44ad'));
    });
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
})();
