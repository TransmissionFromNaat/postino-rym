const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const variants = [
  { file: 'postino.en.user.js', fill: 'Fill form', copy: 'Copy tracks', clear: 'Clear data', close: 'Close' },
  { file: 'postino.it.user.js', fill: 'Compila modulo', copy: 'Copia tracce', clear: 'Cancella dati', close: 'Chiudi' }
];
const release = {
  source: 'Discogs', id: 1, savedAt: 1,
  artist: 'Test Artist', artistSearch: 'Test Artist', title: 'The Test Album',
  formatName: 'CD', descriptions: ['Album'],
  year: '2024', month: '09', day: '13', country: 'UK',
  labels: [{ name: 'Test Label', catno: 'TEST001' }],
  tracks: [{ pos: '1', title: 'First Song', dur: '3:00' }],
  url: 'https://www.discogs.com/release/1'
};
const discogsRelease = {
  id: 1, title: 'The Test Album', artists: [{ name: 'Test Artist' }],
  released: '2024-09-13', country: 'UK',
  formats: [{ name: 'CD', qty: '1', descriptions: ['Album'] }],
  labels: [{ name: 'Test Label', catno: 'TEST001' }],
  tracklist: [{ type_: 'track', position: '1', title: 'First Song', duration: '3:00' }]
};

function session(t, variant, initial) {
  let raw = initial === undefined ? undefined : JSON.stringify(initial);
  let clipboard = '';
  const listeners = [];
  const requests = [];
  const opened = [];
  function page(url, html) {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    const errors = [];
    dom.window.addEventListener('error', event => { errors.push(event.error); event.preventDefault(); });
    Object.assign(dom.window, {
      GM_getValue: () => raw,
      GM_setValue: (key, value) => { raw = value; listeners.forEach(fn => fn(key, undefined, value, true)); },
      GM_deleteValue: key => { raw = undefined; listeners.forEach(fn => fn(key, undefined, undefined, true)); },
      GM_addValueChangeListener: (key, fn) => listeners.push(fn),
      GM_xmlhttpRequest: request => requests.push(request),
      GM_setClipboard: text => { clipboard = text; },
      GM_openInTab: url => opened.push(url),
      unsafeWindow: dom.window,
      goAdvanced: () => {}, goSimple: () => {}
    });
    const filename = path.resolve(variant.file);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), dom.getInternalVMContext(), { filename });
    const document = dom.window.document;
    return {
      dom, document,
      click(text) {
        const button = [...document.querySelectorAll('button')].find(b => b.textContent === text);
        assert.ok(button, `Missing button: ${text}`);
        button.click();
        assert.deepEqual(errors, [], 'The userscript must not throw');
      },
      value: id => document.getElementById(id).value,
      checked: id => document.getElementById(id).checked,
      radio: name => document.querySelector(`input[name="${name}"]:checked`)?.value,
      text: () => document.body.textContent,
      set: (id, value) => { document.getElementById(id).value = value; },
      toggle(id) {
        document.getElementById(id).click();
        assert.deepEqual(errors, [], 'The userscript must not throw');
      }
    };
  }
  return {
    page, requests, opened,
    saved: () => raw ? JSON.parse(raw) : null,
    clipboard: () => clipboard,
    load(data) {
      raw = typeof data === 'string' ? data : JSON.stringify(data);
      listeners.forEach(fn => fn('', undefined, raw, true));
    },
    discogs: () => page('https://www.discogs.com/release/1', '<body></body>'),
    rym: () => page('https://rateyourmusic.com/releases/ac', formHtml()),
    respond(index, data, status = 200) {
      assert.ok(requests[index], `Missing API request ${index}`);
      requests[index].onload({ status, responseText: JSON.stringify(data) });
    }
  };
}

function formHtml() {
  const radios = {
    category: ['standard', 'classical', 'va'], type: ['s','c','e','i','m','x','j','b'],
    format: ['60','95','96','58','59','78','32','88'], disc_size: ['88','89','90','91','92']
  };
  const options = values => '<option value="">Unknown</option>' + values.map(v => `<option value="${v}">${v}</option>`).join('');
  return '<form id="release_ac">' + Object.entries(radios).map(([name, values]) =>
    values.map((value, i) => `<input type="radio" name="${name}" value="${value}" ${i === 0 ? 'checked' : ''}>`).join('')).join('') +
    ['title','catalog_no','countries','searchterm','filed_under_searchterm'].map(id => `<input id="${id}">`).join('') +
    '<input id="filed_under_performer_artist_1"><div id="filed_under_performer_artist_1_preview"><a>Test Artist</a></div>' +
    '<iframe id="labellist"></iframe><iframe id="filed_underperformerlist"></iframe>' +
    '<select id="year">' + options(['1970','1980','1990','2000','2024','2025','2026']) + '</select>' +
    '<select id="month">' + options(['01','09','10']) + '</select><select id="day">' + options(['01','13','14']) + '</select>' +
    Array.from({ length: 140 }, (_,i) => `<input type="checkbox" id="attrib${i}">`).join('') +
    '<textarea id="notes"></textarea><textarea id="track_advanced"></textarea></form>';
}

function bandcampHtml({ track = false, label = 'Ninja Tune', publisher = 'Floating Points' } = {}) {
  const ld = {
    '@type': track ? 'MusicRecording' : 'MusicAlbum', name: track ? 'Key103' : 'Cascade',
    byArtist: { name: 'Floating Points' }, publisher: { name: publisher },
    albumRelease: [{ musicReleaseFormat: 'DigitalFormat', recordLabel: { name: label } }],
    inAlbum: { name: 'Cascade' }
  };
  const tr = {
    artist: 'Floating Points', current: { title: ld.name }, album_release_date: '13 Sep 2024 00:00:00 GMT',
    trackinfo: [{ track_num: 2, title: 'Key103', duration: 480, is_downloadable: true }]
  };
  const escape = text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<script type="application/ld+json">${JSON.stringify(ld)}</script><div data-tralbum="${escape(JSON.stringify(tr))}"></div>`;
}

module.exports = { variants, release, discogsRelease, session, bandcampHtml };
