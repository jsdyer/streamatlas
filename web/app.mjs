import {STORAGE_KEY, normalizeStations, normalizeStation, countryLabel, searchParams, filterStations, exportCollection, importCollection, csvCollection, webURL} from './model.mjs';
import {Directory} from './api.mjs';
const $ = id => document.getElementById(id);
const fields = ['name','countrycode','language','tag','state','codec','bitrateMin'];
let config, directory, retained = [], capture, live = [], saved = [], view = 'shelf', active = null;
let liveInput = null, nextOffset = 0, hasMore = false, busy = false, fetchedAt = '', liveServer = '';
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const link = (text, href) => { const node = el('a', text); node.href = href; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node; };
const date = value => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-CA', {dateStyle:'medium', timeStyle:'short', timeZone:'UTC'}).format(new Date(value)) + ' UTC' : 'date not supplied';
function status(text = '', error = false) { $('status').textContent = text; $('status').className = error ? 'error' : ''; }
function input() { return {...Object.fromEntries(fields.map(k => [k, $(k).value])), hidebroken:$('hidebroken').checked}; }
function applyPreset(preset) { for (const name of fields) $(name).value = preset[name] || (name === 'bitrateMin' ? '0' : ''); }
function persist() {
  try {
    if ($('remember').checked) localStorage.setItem(STORAGE_KEY, exportCollection(saved));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { $('remember').checked = false; status('Browser storage is unavailable. Your collection remains in this tab; export JSON to keep a copy.', true); }
}
function restore() {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (text) { saved = importCollection(text); $('remember').checked = true; }
  } catch { status('A saved collection could not be read. You can import a previously exported JSON file.', true); }
}
function saveStation(station) {
  const exists = saved.some(s => s.stationuuid === station.stationuuid);
  if (exists) saved = saved.filter(s => s.stationuuid !== station.stationuuid);
  else {
    if (saved.length >= 500) { status('This collection holds up to 500 stations. Export it before starting another.', true); return; }
    saved.push(station);
  }
  persist(); render();
  status(exists ? `${station.name} removed from your collection.` : `${station.name} added to your collection${$('remember').checked ? ' on this device' : ' for this tab'}.`);
}
function recordClick(station) {
  directory.click(station.stationuuid).catch(error => { status(`Playback and directory availability are separate. The listening click could not be recorded: ${error.message}`, true); });
}
function stop() {
  $('audio').pause(); $('audio').removeAttribute('src'); $('audio').load(); active = null;
  $('playing-title').textContent = 'Choose a station to tune in'; $('playing-status').textContent = 'Stopped. Audio starts only after you press Play.';
  $('player-label').textContent = 'READY WHEN YOU ARE'; $('stop').disabled = true; $('player-home').hidden = true;
}
function play(station) {
  const url = webURL(station.url_resolved, true);
  if (!url) { status('This stream uses HTTP. Use its external stream or station website link; it cannot play inside this HTTPS page.', true); return; }
  $('audio').pause(); active = station;
  $('playing-title').textContent = station.name;
  $('playing-status').textContent = 'Connecting directly to the station…'; $('player-label').textContent = 'TUNING IN';
  $('stop').disabled = false; $('player-home').hidden = !station.homepage;
  if (station.homepage) $('player-home').href = station.homepage;
  $('audio').src = url;
  try {
    const promise = $('audio').play();
    promise?.catch(() => {
      if (active?.stationuuid !== station.stationuuid) return;
      $('playing-status').textContent = 'Playback could not start. Press Play again to retry, or open the station website. Format or region restrictions may apply.';
      $('player-label').textContent = 'UNABLE TO PLAY';
    });
  } catch { $('playing-status').textContent = 'Playback could not start. Try the station website.'; }
}
$('audio').addEventListener('play', () => { if (active) recordClick(active); });
$('audio').addEventListener('playing', () => { $('player-label').textContent = 'NOW LISTENING'; $('playing-status').textContent = 'Live audio from the station. No recording is made here.'; });
$('audio').addEventListener('waiting', () => { if (active) $('playing-status').textContent = 'Buffering… Stream availability and connection speeds vary.'; });
$('audio').addEventListener('pause', () => { if (active) { $('player-label').textContent = 'PAUSED'; $('playing-status').textContent = 'Press the player’s Play button to resume, or Stop to disconnect.'; } });
$('audio').addEventListener('error', () => { if (active) { $('player-label').textContent = 'STREAM UNAVAILABLE'; $('playing-status').textContent = 'The stream failed. Press its Play button to retry, or open the station website. The stream may be offline, region-restricted or unsupported by this browser.'; } });
$('stop').addEventListener('click', stop);
function card(station, index) {
  const node = el('article', undefined, 'station');
  const top = el('div', undefined, 'station-top');
  top.append(el('span', String(index + 1).padStart(2,'0') + ' / AIRWAVES', 'station-number'), el('span', countryLabel(station.countrycode), 'station-place'));
  node.append(top, el('h3', station.name), el('p', [station.state,station.language || 'Language unlisted'].filter(Boolean).join(' · '), 'station-language'));
  const tags = el('div', undefined, 'station-tags');
  const values = station.tags.split(',').map(t => t.trim()).filter(Boolean);
  for (const value of values.slice(0,4)) tags.append(el('span', value));
  if (!values.length) tags.append(el('span', 'Genre unlisted'));
  node.append(tags);
  const secure = !!webURL(station.url_resolved, true);
  if (!secure) node.append(el('p','HTTP stream · opens outside this page', 'http-note'));
  else if (station.hls) node.append(el('p', 'HLS stream · browser support varies', 'http-note'));
  const foot = el('div', undefined, 'station-foot');
  foot.append(el('span', [station.codec || 'Unknown codec', station.bitrate ? `${station.bitrate} kbps` : 'Bitrate unlisted'].join(' / '), 'stream-tech'));
  if (secure) {
    const button = el('button', '▶  Play', 'play'); button.setAttribute('aria-label', `Play ${station.name}`); button.addEventListener('click', () => play(station)); foot.append(button);
  } else {
    const external = link('Open stream ↗', station.url_resolved); external.addEventListener('click', () => recordClick(station)); foot.append(external);
  }
  node.append(foot);
  const actions = el('div', undefined, 'station-actions');
  const isSaved = saved.some(s => s.stationuuid === station.stationuuid);
  const save = el('button', isSaved ? '✓ In my stations' : '+ Add to my stations', 'save');
  save.setAttribute('aria-pressed', String(isSaved)); save.setAttribute('aria-label', `${isSaved ? 'Remove' : 'Save'} ${station.name}`);
  save.addEventListener('click', () => saveStation(station)); actions.append(save);
  if (station.homepage) actions.append(link('Station website ↗', station.homepage));
  node.append(actions);
  const details = el('details'); details.append(el('summary', 'Directory evidence'));
  details.append(el('p', `Last provider check: ${date(station.lastchecktime_iso8601)}. ${station.lastcheckok ? 'Passed at that time.' : 'Not marked as passed.'} This is not a live check.`));
  details.append(el('p', 'Station ID: ' + station.stationuuid));
  details.append(link('View Radio Browser record ↗', `https://www.radio-browser.info/history/${station.stationuuid}`));
  const stream = el('p', 'Reported stream: ' + station.url_resolved); details.append(stream); node.append(details);
  return node;
}
function sourceRows() { return view === 'shelf' ? retained : view === 'saved' ? saved : live; }
function visibleRows() {
  const needle = $('local-filter').value.trim().toLowerCase();
  return filterStations(sourceRows(), {httpsOnly:$('httpsOnly').checked}).filter(s => !needle || [s.name,s.state,s.tags,s.language,countryLabel(s.countrycode)].join(' ').toLowerCase().includes(needle));
}
function render() {
  const rows = visibleRows();
  $('saved-count').textContent = saved.length;
  $('result-count').textContent = rows.length;
  for (const [id, tab] of [['show-shelf','shelf'],['show-live','live'],['show-saved','saved']]) {
    $(id).classList.toggle('active', view === tab); $(id).setAttribute('aria-pressed', String(view === tab));
  }
  $('collection-tools').hidden = view !== 'saved';
  $('results-heading').textContent = view === 'shelf' ? 'A place to start' : view === 'saved' ? 'Your listening collection' : 'Beyond the familiar';
  $('capture-note').textContent = view === 'shelf' ? `Retained metadata captured ${date(capture?.capturedAt)}. Availability may have changed.` : view === 'saved' ? `${saved.length} saved station${saved.length === 1 ? '' : 's'}. ${$('remember').checked ? 'Remembered on this device.' : 'Kept in this tab only.'}` : fetchedAt ? `Directory metadata fetched ${date(fetchedAt)} from ${new URL(liveServer).hostname}. Sorted by directory clicks.` : 'Search for any station, country, language or tag above.';
  $('stations').replaceChildren(...rows.map(card));
  $('empty').hidden = rows.length !== 0;
  $('empty-copy').textContent = view === 'saved' && !saved.length ? 'Add stations from a search or the retained shelf. Import a Stream Atlas JSON export to bring a collection with you.' : view === 'live' && !fetchedAt ? 'Use the search above to explore Radio Browser’s wider directory.' : 'Try fewer filters, or search the directory for a different place or sound.';
  $('load-more').hidden = view !== 'live' || !hasMore;
  $('export-json').disabled = saved.length === 0; $('export-csv').disabled = saved.length === 0;
  $('clear-saved').disabled = saved.length === 0;
}
async function search(more = false) {
  if (busy) return;
  let nextInput, params;
  try { nextInput = more ? liveInput : input(); params = searchParams(nextInput, config.pageSize, more ? nextOffset : 0); }
  catch(error) { status(error.message, true); return; }
  busy = true; $('search-button').disabled = true; $('load-more').disabled = true;
  status('Finding stations in Radio Browser…');
  try {
    const result = await directory.search(params);
    live = more ? normalizeStations([...live,...result.stations], 1000) : result.stations;
    liveInput = nextInput; nextOffset = (more ? nextOffset : 0) + result.rawCount; hasMore = result.rawCount === Number(params.get('limit')) && live.length < 1000;
    fetchedAt = new Date().toISOString(); liveServer = result.server; view = 'live'; $('local-filter').value = ''; render();
    status(`${result.stations.length} usable station records returned${result.rawCount !== result.stations.length ? ` from ${result.rawCount} directory records` : ''}. No audio has started.`);
  } catch(error) { status(error.message, true); }
  finally { busy = false; $('search-button').disabled = false; $('load-more').disabled = false; }
}
function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], {type})); const a = el('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('search').addEventListener('submit', event => { event.preventDefault(); search(); });
$('load-more').addEventListener('click', () => search(true));
for (const [id, tab] of [['show-shelf','shelf'],['show-live','live'],['show-saved','saved']]) $(id).addEventListener('click', () => { view = tab; $('local-filter').value = ''; render(); status(); });
$('httpsOnly').addEventListener('change', render); $('local-filter').addEventListener('input', render);
$('remember').addEventListener('change', () => { persist(); render(); });
$('export-json').addEventListener('click', () => download(exportCollection(saved), 'streamatlas-stations.json', 'application/json'));
$('export-csv').addEventListener('click', () => download(csvCollection(saved), 'streamatlas-stations.csv', 'text/csv;charset=utf-8'));
$('clear-saved').addEventListener('click', () => { saved = []; $('remember').checked = false; persist(); render(); status('Collection cleared from this tab and this device. Downloaded copies are unchanged.'); });
$('import-json').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('Choose a station file smaller than 2 MB.');
    const imported = importCollection(await file.text());
    const merged = normalizeStations([...saved,...imported], 1000);
    if (merged.length > 500) throw new Error('The combined collection would exceed 500 stations. Export and clear it before importing another.');
    saved = merged; persist(); render(); status(`${imported.length} station records imported. Existing stations were matched by their directory ID.`);
  } catch(error) { status(error.message, true); }
  finally { event.target.value = ''; }
});
async function start() {
  try {
    const responses = await Promise.all([fetch('./config.json'),fetch('./data/stations.json')]);
    if (responses.some(r => !r.ok)) throw new Error('Local station files could not be loaded. Please refresh the page.');
    [config,capture] = await Promise.all(responses.map(r => r.json()));
    directory = new Directory(config); retained = normalizeStations(capture.stations);
    $('countrycode').value = config.defaultCountry || '';
    for (const code of config.countrySuggestions) { const option = el('option', countryLabel(code)); option.value = code; $('countries').append(option); }
    for (const preset of config.presets) { const button = el('button', preset.label); button.addEventListener('click', () => { applyPreset(preset); search(); }); $('presets').append(button); }
    restore(); render();
  } catch(error) { status(error.message, true); $('search-button').disabled = true; $('capture-note').textContent = 'The local starting collection is unavailable. You can still open Radio Browser directly.'; }
}
start();
