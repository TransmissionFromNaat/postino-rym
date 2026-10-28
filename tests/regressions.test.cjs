const assert = require('node:assert/strict');
const { test } = require('node:test');
const { variants, release, discogsRelease, session, bandcampHtml } = require('./helpers.cjs');

for (const variant of variants) {
  const check = (name, run) => test(`${variant.file}: ${name}`, run);
  check('ordinary CD import fills the form', t => {
    const s = session(t, variant, release);
    const page = s.rym(); page.click(variant.fill);
    assert.equal(page.value('title'), 'The Test Album');
    assert.equal(page.value('catalog_no'), 'TEST001');
    assert.equal(page.value('track_advanced'), '1|First Song|3:00');
    assert.equal(page.radio('type'), 's');
  });
  check('capitalization settings preserve manual corrections until Fill form', t => {
    const s = session(t, variant, release);
    const page = s.rym(); page.click(variant.fill);
    page.set('catalog_no', 'CORRECTED001'); page.set('year', '2025'); page.set('title', 'Manual Title');
    page.set('track_advanced', '1|Corrected Song|3:01');
    page.toggle('drym_caps');
    assert.equal(page.value('catalog_no'), 'CORRECTED001');
    assert.equal(page.value('year'), '2025');
    assert.equal(page.value('title'), 'Manual Title');
    assert.equal(page.value('track_advanced'), '1|Corrected Song|3:01');
  });
  check('track-time settings preserve manual corrections until Fill form', t => {
    const s = session(t, variant, { ...release, formatName: 'Vinyl', descriptions: ['LP'] });
    const page = s.rym(); page.click(variant.fill); page.set('catalog_no', 'CORRECTED001');
    page.toggle('drym_dur');
    assert.equal(page.value('catalog_no'), 'CORRECTED001');
    page.click(variant.copy);
    assert.equal(s.clipboard(), '1|First Song|3:00');
  });
  check('settings do not insert a newly loaded release before Fill form', t => {
    const s = session(t, variant, release);
    const page = s.rym(); page.click(variant.fill);
    s.load({ ...release, title: 'The Next Album', savedAt: 2 });
    page.toggle('drym_caps');
    assert.equal(page.value('title'), 'The Test Album');
    page.click(variant.fill);
    assert.notEqual(page.value('title'), 'The Test Album');
  });
  check('Bandcamp imports the explicit digital record label', t => {
    const s = session(t, variant);
    s.page('https://floatingpoints.bandcamp.com/album/cascade', bandcampHtml()).click('→ RYM');
    assert.equal(s.saved().labels[0]?.name, 'Ninja Tune');
    assert.equal(s.saved().selfReleased, false);
    const page = s.rym(); page.click(variant.fill);
    assert.equal(page.value('searchterm'), 'Ninja Tune');
    assert.equal(page.value('catalog_no'), '');
  });
  check('an explicit Bandcamp label takes priority over a different publisher', t => {
    const s = session(t, variant);
    s.page('https://floatingpoints.bandcamp.com/album/cascade', bandcampHtml({ publisher:'Another Publisher' })).click('→ RYM');
    assert.equal(s.saved().labels[0].name, 'Ninja Tune');
  });
  check('Bandcamp numbers a single track from one', t => {
    const s = session(t, variant);
    s.page('https://floatingpoints.bandcamp.com/track/key103', bandcampHtml({ track: true })).click('→ RYM');
    assert.equal(s.saved().tracks[0].pos, '1');
    const page = s.rym(); page.click(variant.fill);
    assert.equal(page.value('track_advanced'), '1|Key103|8:00');
  });
  check('one live bonus track cannot mark a studio album Live', t => {
    const tracks = Array.from({ length: 10 }, (_,i) => ({ pos: String(i+1), title: i===9 ? 'Final Song (Live)' : 'Studio Song '+i, dur: '3:00' }));
    const s = session(t, variant, { ...release, tracks, notes: 'Track 10 recorded live at the venue. Tracks 1-9 recorded in the studio.' });
    const page = s.rym(); page.click(variant.fill);
    assert.equal(page.checked('attrib5'), false);
  });
  for (const [count, expected] of [[5, false], [6, true]]) {
    check(`${count} of 10 live tracks respects the majority threshold`, t => {
      const tracks = Array.from({ length:10 }, (_,i) => ({ pos:String(i+1), title:i<count?'Song '+i+' (Live)':'Studio Song '+i }));
      const s = session(t, variant, { ...release, tracks });
      const page = s.rym(); page.click(variant.fill);
      assert.equal(page.checked('attrib5'), expected);
    });
  }
  check('CD and DVD headings survive numbered-disc import', t => {
    const s = session(t, variant); const source = s.discogs(); source.click('→ RYM');
    s.respond(0, { ...discogsRelease, formats: [{ name:'CD',qty:'1',descriptions:['Album'] }, { name:'DVD',qty:'1' }],
      tracklist: [{ type_:'heading',title:'CD' }, { type_:'track',position:'1-1',title:'First Song' },
        { type_:'heading',title:'DVD' }, { type_:'track',position:'2-1',title:'Second Song' }] });
    const page = s.rym(); page.click(variant.fill);
    assert.equal(page.value('track_advanced'), '|[b]CD[/b]|\n1.1|First Song|\n|[b]DVD[/b]|\n2.1|Second Song|');
  });
  check('sub-track positions do not collide with following tracks', t => {
    const s = session(t, variant); s.discogs().click('→ RYM');
    s.respond(0, { ...discogsRelease, tracklist: [
      { type_:'index',position:'1',title:'Suite',sub_tracks:[{ position:'1.1',title:'First Movement' }, { position:'1.2',title:'Second Movement' }] },
      { type_:'track',position:'2',title:'Final Song' }] });
    const page = s.rym(); page.click(variant.fill);
    assert.equal(page.value('track_advanced'), '|[b]Suite[/b]|\n1a|First Movement|\n1b|Second Movement|\n2|Final Song|');
  });
  check('sub-track suffixes remain unique after 26 movements', t => {
    const s = session(t, variant); s.discogs().click('→ RYM');
    s.respond(0, { ...discogsRelease, tracklist: [
      { type_:'index',position:'1',title:'Suite',sub_tracks:Array.from({ length:27 }, (_,i) => ({ position:'1.'+(i+1),title:'Movement '+(i+1) })) },
      { type_:'track',position:'2',title:'Final Song' }] });
    const page = s.rym(); page.click(variant.fill);
    const rows = page.value('track_advanced').split('\n');
    assert.ok(rows.includes('1aa|Movement 27|'));
    assert.equal(new Set(rows.filter(r=>!r.startsWith('|')).map(r=>r.split('|')[0])).size, 28);
  });
  check('a positionless index preserves a shared dotted sub-track parent', t => {
    const s = session(t, variant); s.discogs().click('→ RYM');
    s.respond(0, { ...discogsRelease, tracklist:[
      { type_:'index',position:'',title:'Suite',sub_tracks:[{ position:'1.1',title:'First Movement' }, { position:'1.2',title:'Second Movement' }] },
      { type_:'track',position:'2',title:'Final Song' }] });
    const page = s.rym(); page.click(variant.fill);
    assert.equal(page.value('track_advanced'), '|[b]Suite[/b]|\n1a|First Movement|\n1b|Second Movement|\n2|Final Song|');
  });
  check('an LP heading clears CD metadata before vinyl-side normalization', t => {
    const s = session(t, variant); s.discogs().click('→ RYM');
    s.respond(0, { ...discogsRelease, formats:[{ name:'CD',qty:'1',descriptions:['Album'] }, { name:'Vinyl',qty:'1',descriptions:['LP'] }],
      tracklist:[{ type_:'heading',title:'CD' }, { type_:'track',position:'1',title:'First Song' },
        { type_:'heading',title:'LP' }, { type_:'track',position:'A1',title:'Side One' }, { type_:'track',position:'B1',title:'Side Two' }] });
    const page = s.rym(); page.click(variant.fill);
    assert.equal(page.value('track_advanced'), '1|First Song|\nA|Side One|\nB|Side Two|');
  });
  check('invalid main-medium metadata falls back to the existing descriptions', t => {
    const s = session(t, variant, { ...release, mainDescriptions:{ invalid:true } });
    const page = s.rym(); page.click(variant.fill);
    assert.equal(page.radio('type'), 's');
  });
  check('a bonus single cannot change the main CD album type or size', t => {
    const s = session(t, variant); s.discogs().click('→ RYM');
    s.respond(0, { ...discogsRelease, formats: [{ name:'CD',qty:'1',descriptions:['Album'] }, { name:'Vinyl',qty:'1',descriptions:['7"','Single','45 RPM'] }] });
    const page = s.rym(); page.click(variant.fill);
    assert.equal(page.radio('type'), 's');
    assert.equal(page.radio('format'), '60');
    assert.notEqual(page.radio('disc_size'), '90');
  });
  check('a bonus sampler cannot move the main album to Additional releases', t => {
    const s = session(t, variant); s.discogs().click('→ RYM');
    s.respond(0, { ...discogsRelease, formats:[{ name:'CD',qty:'1',descriptions:['Album'] }, { name:'Vinyl',qty:'1',descriptions:['7"','Sampler'] }] });
    const page = s.rym(); page.click(variant.fill);
    assert.equal(page.radio('type'), 's');
    assert.equal(page.checked('attrib132'), false);
  });
  check('a late release response cannot replace a newer selection', t => {
    const s = session(t, variant); const page = s.discogs(); page.click('→ RYM');
    page.dom.reconfigure({ url:'https://www.discogs.com/release/2' }); page.document.querySelector('button').click();
    s.respond(1, { ...discogsRelease, id:2, title:'Newer Selection' });
    s.respond(0, { ...discogsRelease, id:1, title:'Older Selection' });
    assert.equal(s.saved().id, 2);
  });
  check('a late master response cannot replace a newer selection', t => {
    const s = session(t, variant); const page = s.discogs(); page.click('→ RYM');
    s.respond(0, { ...discogsRelease, master_id:10 });
    page.dom.reconfigure({ url:'https://www.discogs.com/release/2' }); page.click('→ RYM');
    s.respond(2, { ...discogsRelease, id:2, title:'Newer Selection' });
    s.respond(1, { year:2020, main_release:1 });
    assert.equal(s.saved().id, 2);
  });
}
