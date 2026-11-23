#!/usr/bin/env python3
"""Refresh the retained metadata shelf. Never fetch or save any audio."""
from datetime import datetime, timezone
import json
from pathlib import Path
import random
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
AGENT = 'CoolCode StreamAtlas/1.0 (+https://coolcode.ca/streamatlas/; https://github.com/jsdyer/streamatlas)'
FIELDS = ['stationuuid', 'name', 'url_resolved', 'url', 'homepage', 'countrycode', 'state', 'language', 'tags', 'codec', 'bitrate', 'hls', 'lastcheckok', 'lastchecktime_iso8601']
UUID = re.compile(r'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$', re.I)


def server_origin(value):
    parsed = urlsplit(value if '://' in value else 'https://' + value)
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port or not re.fullmatch(r'[a-z0-9-]+\.api\.radio-browser\.info', parsed.hostname or ''):
        raise ValueError('Invalid Radio Browser HTTPS server')
    return 'https://' + parsed.hostname


def validate_station(row):
    if not isinstance(row, dict) or not UUID.fullmatch(row.get('stationuuid', '')) or not isinstance(row.get('name'), str) or not row['name'].strip():
        raise ValueError('Invalid station record')
    parsed = urlsplit(row.get('url_resolved') or row.get('url') or '')
    if parsed.scheme not in ['http', 'https'] or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Invalid station stream URL')
    return {field: row.get(field) for field in FIELDS}


def read_json(url):
    request = Request(url, headers={'User-Agent': AGENT, 'Accept': 'application/json'})
    with urlopen(request, timeout=25) as response:
        if response.headers.get('cf-mitigated') == 'challenge' or 'json' not in response.headers.get('Content-Type', ''):
            raise ValueError('Provider returned a challenge or non-JSON page; stopping without trying another server')
        return json.load(response)


def read_servers(path, servers):
    error = None
    for server in servers[:3]:
        try:
            url = server + path
            return read_json(url), url
        except HTTPError as exc:
            if exc.code in [401, 403, 429]:
                raise
            error = exc
        except (URLError, TimeoutError) as exc:
            error = exc
    raise RuntimeError('Directory temporarily unavailable; last good shelf kept') from error


def collect(config):
    seeds = [server_origin(s) for s in config['bootstrapServers']]
    random.shuffle(seeds)
    rows, discovery_url = read_servers('/json/servers', seeds)
    servers = list(dict.fromkeys(server_origin(s['name']) for s in rows))
    random.shuffle(servers)
    if not servers:
        raise ValueError('No directory servers advertised')
    stations, sources = {}, []
    for query in config['retainedQueries']:
        if not 1 <= int(query.get('limit', 8)) <= 100:
            raise ValueError('Retained query limit must be from 1 to 100')
        params = {'hidebroken': 'true', 'order': 'clickcount', 'reverse': 'true', **query}
        data, source = read_servers('/json/stations/search?' + urlencode(params), servers)
        if not isinstance(data, list):
            raise ValueError('Unexpected provider data')
        for raw in data:
            row = validate_station(raw)
            stations[row['stationuuid']] = row
        sources.append({'url': source, 'returned': len(data), 'query': query})
        time.sleep(1)
    if not stations:
        raise ValueError('No station records returned; last good shelf kept')
    return {'source': 'https://www.radio-browser.info/', 'discoveryURL': discovery_url, 'capturedAt': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z'), 'note': 'Retained directory metadata, not a live availability guarantee. No audio captured.', 'queries': sources, 'stations': list(stations.values())}


def save_capture(capture, path):
    if not capture.get('stations') or not capture.get('capturedAt'):
        raise ValueError('Empty or undated capture')
    for row in capture['stations']:
        validate_station(row)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(capture, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


if __name__ == '__main__':
    config = json.loads((ROOT / 'web/config.json').read_text())
    capture = collect(config)
    save_capture(capture, ROOT / 'web/data/stations.json')
    print(f"Retained {len(capture['stations'])} real station records at {capture['capturedAt']}")
    for query in capture['queries']:
        print(query['returned'], query['url'])
