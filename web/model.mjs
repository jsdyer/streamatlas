export const STORAGE_KEY = 'coolcode:streamatlas:favourites:v1';
export const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function webURL(value, secureOnly = false) {
  try {
    const u = new URL(String(value));
    if (!(secureOnly ? ['https:'] : ['https:', 'http:']).includes(u.protocol) || u.username || u.password) return '';
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost') || !host.includes('.') || /^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(host) || host.startsWith('[')) return '';
    return u.href;
  } catch { return ''; }
}
export function normalizeStation(raw) {
  if (!raw || !UUID.test(raw.stationuuid || '') || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  const stream = webURL(raw.url_resolved) || webURL(raw.url);
  if (!stream) return null;
  const text = (v, n = 240) => typeof v === 'string' ? v.trim().slice(0, n) : '';
  const countrycode = /^[A-Z]{2}$/.test(String(raw.countrycode).toUpperCase()) ? String(raw.countrycode).toUpperCase() : '';
  const date = raw.lastchecktime_iso8601;
  return {
    stationuuid: raw.stationuuid.toLowerCase(), name: text(raw.name), url_resolved: stream,
    homepage: webURL(raw.homepage), countrycode, state: text(raw.state), language: text(raw.language),
    tags: text(raw.tags, 1400), codec: text(raw.codec, 24).toUpperCase(),
    bitrate: Number.isFinite(Number(raw.bitrate)) && Number(raw.bitrate) >= 0 ? Math.min(1000000, Number(raw.bitrate)) : 0,
    hls: Number(raw.hls) === 1 ? 1 : 0, lastcheckok: raw.lastcheckok === 1 || raw.lastcheckok === '1' ? 1 : 0,
    lastchecktime_iso8601: typeof date === 'string' && Number.isFinite(Date.parse(date)) ? date : null,
  };
}
export function normalizeStations(rows, max = 500) {
  if (!Array.isArray(rows)) throw new Error('The directory returned an unexpected format.');
  const unique = new Map();
  for (const raw of rows.slice(0, max)) {
    const station = normalizeStation(raw);
    if (station) unique.set(station.stationuuid, station);
  }
  return [...unique.values()];
}
export function countryLabel(code) {
  try { return new Intl.DisplayNames(['en'], {type:'region'}).of(code) || code; } catch { return code || 'Country unlisted'; }
}
export function searchParams(input, limit = 24, offset = 0) {
  const out = new URLSearchParams({limit:String(Math.min(100, Math.max(1, Number(limit) || 24))), offset:String(Math.max(0, Number(offset) || 0)), order:'clickcount', reverse:'true'});
  for (const key of ['name','language','tag','state','codec']) {
    const value = String(input[key] || '').trim();
    if (value.length > 120) throw new Error(`${key} must be 120 characters or fewer.`);
    if (value) out.set(key, value);
  }
  const country = String(input.countrycode || '').trim().toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) throw new Error('Use a two-letter country code, such as CA, JP or BR. Leave it blank for worldwide.');
  if (country) out.set('countrycode', country);
  const bitrate = Number(input.bitrateMin || 0);
  if (!Number.isInteger(bitrate) || bitrate < 0 || bitrate > 1000000) throw new Error('Minimum bitrate must be a whole number from 0 to 1,000,000.');
  if (bitrate) out.set('bitrateMin', String(bitrate));
  if (input.hidebroken !== false) out.set('hidebroken','true');
  return out;
}
export function filterStations(rows, input = {}) {
  const query = key => String(input[key] || '').trim().toLowerCase();
  return rows.filter(s => ['name','language','tag','state','codec'].every(key => !query(key) || String(s[key === 'tag' ? 'tags' : key]).toLowerCase().includes(query(key)))
    && (!query('countrycode') || s.countrycode.toLowerCase() === query('countrycode'))
    && s.bitrate >= Number(input.bitrateMin || 0)
    && (!input.hidebroken || s.lastcheckok === 1)
    && (!input.httpsOnly || s.url_resolved.startsWith('https:')));
}
export function serverOrigin(value) {
  try {
    const u = new URL(value.includes('://') ? value : `https://${value}`);
    return u.protocol === 'https:' && /^[a-z0-9-]+\.api\.radio-browser\.info$/.test(u.hostname) && !u.username && !u.password && !u.port ? u.origin : '';
  } catch { return ''; }
}
export function serverList(rows) {
  if (!Array.isArray(rows)) throw new Error('The directory server list is not readable.');
  return [...new Set(rows.map(r => serverOrigin(r.name || '')).filter(Boolean))];
}
export function shuffled(values, random = Math.random) {
  const output = [...values];
  for (let i = output.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [output[i], output[j]] = [output[j], output[i]]; }
  return output;
}
export function exportCollection(stations, now = new Date()) {
  return JSON.stringify({format:'coolcode-streamatlas-v1', exportedAt:now.toISOString(), source:'https://www.radio-browser.info/', stations:normalizeStations(stations)}, null, 2);
}
export function importCollection(text) {
  if (text.length > 2_000_000) throw new Error('Choose a station file smaller than 2 MB.');
  let data; try { data = JSON.parse(text); } catch { throw new Error('This file is not valid JSON.'); }
  if (data.format !== 'coolcode-streamatlas-v1' || !Array.isArray(data.stations) || data.stations.length > 500) throw new Error('Use a Stream Atlas JSON export with up to 500 stations.');
  const stations = normalizeStations(data.stations);
  if (stations.length !== data.stations.length) throw new Error('The file contains duplicate or invalid station records. Nothing was imported.');
  return stations;
}
export function csvCollection(stations) {
  const fields = ['name','countrycode','state','language','codec','bitrate','url_resolved','homepage','stationuuid','lastchecktime_iso8601'];
  const cell = value => '"' + String(value ?? '').replace(/^[=+@\-]/, "'$&").replaceAll('"','""') + '"';
  return [fields.join(','), ...stations.map(s => fields.map(f => cell(s[f])).join(','))].join('\r\n');
}
