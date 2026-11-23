import {serverList, serverOrigin, shuffled, normalizeStations, UUID} from './model.mjs';
export class DirectoryError extends Error {
  constructor(message, stop = false) { super(message); this.stop = stop; }
}
export async function requestJSON(url, {fetcher = fetch, timeout = 12000} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetcher(url, {signal:controller.signal, credentials:'omit', headers:{Accept:'application/json'}, referrerPolicy:'strict-origin-when-cross-origin'});
    if (response.status === 401 || response.status === 403 || response.headers.get('cf-mitigated') === 'challenge') throw new DirectoryError('The directory blocked this request. No other server was tried. Open Radio Browser directly or use the retained collection.', true);
    if (response.status === 429) throw new DirectoryError('The directory is limiting requests. Please wait before searching again. Your results are unchanged.', true);
    if (!response.ok) throw new DirectoryError(`Directory response ${response.status}.`);
    if (!response.headers.get('content-type')?.includes('json')) throw new DirectoryError('The directory returned a page instead of data. No other server was tried.', true);
    return await response.json();
  } finally { clearTimeout(timer); }
}
export class Directory {
  constructor(config, fetcher = fetch) { this.config = config; this.fetcher = fetcher; this.servers = []; this.lastServer = ''; }
  async read(path, hosts) {
    let last;
    for (const host of hosts.slice(0, this.config.maxServerAttempts || 3)) {
      try { const data = await requestJSON(host + path, {fetcher:this.fetcher, timeout:this.config.requestTimeoutMs}); this.lastServer = host; return data; }
      catch (error) { if (error.stop) throw error; last = error; }
    }
    throw new DirectoryError(`Radio Browser could not be reached. Your previous results are unchanged. Open its directory, try again later, or browse the retained collection.${last?.name === 'AbortError' ? ' The request timed out.' : ''}`);
  }
  async discover() {
    if (this.servers.length) return;
    const seeds = shuffled(this.config.bootstrapServers.map(serverOrigin).filter(Boolean));
    const rows = await this.read('/json/servers', seeds);
    this.servers = shuffled(serverList(rows));
    if (!this.servers.length) throw new DirectoryError('No usable HTTPS directory servers were advertised.');
  }
  async search(params) {
    await this.discover();
    const raw = await this.read('/json/stations/search?' + params, this.servers);
    return {stations:normalizeStations(raw), rawCount:raw.length, server:this.lastServer};
  }
  async click(uuid) {
    if (!UUID.test(uuid)) throw new DirectoryError('Invalid station identifier.', true);
    await this.discover();
    // A click records listening intent. Only called by a deliberate Play/open-stream action.
    return this.read('/json/url/' + uuid, this.servers);
  }
}
