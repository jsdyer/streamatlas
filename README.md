# Stream Atlas

Internet radio discovery for CoolCode. Search any station name, two-letter country code, state/province, language, genre, codec or minimum bitrate. Keep a listening collection and move it between devices with JSON. The app is static, keyless and works at `/streamatlas/`.

<!-- coolcode:guide -->
Search beyond the starting shelf by station name, country, language or genre; the presets are shortcuts, not a fixed list. Playing connects directly to a station, while saved stations remain in the current tab unless you opt into device storage or export a copy.
<!-- /coolcode:guide -->

## Using it

- The **retained shelf** opens immediately with genuine Radio Browser metadata and an explicit capture time. It is not a live availability test.
- **Search directory** sends your chosen fields to Radio Browser and replaces the search view only after success. Pagination fetches additional records. The directory’s click counts determine ordering; they do not measure audio quality.
- **Filter this view** and **HTTPS streams only** filter the displayed collection locally.
- **Play** starts one HTTPS stream after an explicit click. The native player supports pause and volume; **Stop** disconnects it. Formats, regional restrictions and station outages can still prevent playback. HLS depends on native browser support. Use the station’s website if playback fails. HTTP streams open externally because this HTTPS page does not embed them.
- **My stations** saves favourites for this tab. Choose **Remember my stations on this device** only if you want localStorage persistence. JSON export/import transfers up to 500 stations; CSV exports metadata for a spreadsheet. Imports never leave the browser. Clear collection removes this app’s stored collection, not other CoolCode data.

## Sources, usage and registration

**No account, API key or GitHub secret is needed.**

- [Radio Browser API documentation](https://api.radio-browser.info/) permits use in free and non-free software and documents mirror discovery, randomization and listening-click reporting.
- [Provider reference](https://de1.api.radio-browser.info/) documents advanced station search, stream fields and check timestamps.
- [Radio Browser](https://www.radio-browser.info/) dedicates its accumulated directory metadata to the public domain. Stream audio and station websites remain the property of their respective owners. This application stores metadata and links only; it does not download, record or proxy audio.

On 2026-11-23 the official HTTPS `/json/servers` and `/json/stations/search` endpoints returned HTTP 200 and `Access-Control-Allow-Origin: *` for a CoolCode Origin. `web/data/stations.json` includes each actual collection request, its returned count and a UTC capture time. `lastchecktime_iso8601` is the provider’s earlier check time, not the collection time. Language, tags, locations, stream URLs and bitrate are community metadata and may be incomplete or stale.

The official [browser discovery example](https://api.radio-browser.info/examples/serverlist-browser.js) explains why HTTPS browser clients bootstrap with a known server, then request `/json/servers`. This app follows that approach, deduplicates server hostnames and shuffles the advertised list. It tries another advertised mirror only for ordinary network/server failures. HTTP 401/403/429, reported challenges and non-JSON responses stop retries; the app keeps the previous results. It does not solve or bypass bot challenges.

A `/json/url/{stationuuid}` request reports each deliberate playback start (or HTTP external-stream click), as requested by the provider. The directory deduplicates same-station clicks from the same IP per day. The Python collector sends a descriptive `User-Agent`. Browsers control their own `User-Agent`; the static app keeps the browser’s normal agent and sends its normal origin instead of pretending a custom agent is reliably set. No special key or proxy is required for these documented public endpoints.

## Expand or customize

Edit **`web/config.json`**, not application code:

| Setting | What it controls |
| --- | --- |
| `defaultCountry` | Initial search country, or an empty string for worldwide. |
| `countrySuggestions` | Helpful datalist suggestions. Any valid two-letter code is accepted even if absent. |
| `presets` | Quick searches. Add a `label` and any `name`, `countrycode`, `state`, `language`, `tag`, `codec` or `bitrateMin` values. |
| `pageSize` | Directory page size (the application bounds requests to 1–100). |
| `retainedQueries` | Searches used to refresh the starting shelf; add any query with `limit` from 1–100. |
| `bootstrapServers` | Official HTTPS Radio Browser bootstrap hosts. Use currently advertised provider servers, not third-party proxies. |
| `requestTimeoutMs`, `maxServerAttempts` | Per-request timeout and bounded mirror attempts. |

For example, add `{"label":"New Zealand experimental","countrycode":"NZ","tag":"experimental"}` to `presets`. Add `{"countrycode":"NZ","tag":"experimental","limit":12}` to `retainedQueries` if that search should also appear in the retained shelf.

Refresh and publish:

```sh
python3 scripts/refresh.py
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -v
python3 scripts/build.py
```

Review `web/data/stations.json`, then commit the config/source/data changes and push `main`. The Pages workflow tests, builds and publishes. Changes to presets are visible after deployment; changes to `retainedQueries` require running the refresh command as well. The normal build is offline and **does not silently refresh station data**. There is no background polling, periodic playback or scheduled collector. The refresh script validates every response before atomically replacing the shelf; a failed refresh leaves the last good file intact. Git history preserves previous committed shelves.

## Privacy

Directory searches reveal the submitted search fields and your IP to Radio Browser. The station receives your IP when you play or follow its links. A playback-click request goes to Radio Browser. No third-party station icons load in the results, and streams use `preload="none"`. Search and listening state are not persisted. Only explicit **Remember** consent stores `coolcode:streamatlas:favourites:v1` on this device; paths on CoolCode share an origin, so the storage key is namespaced. Downloads are local and opt-in. The shared CoolCode visit-counter script may collect aggregate page visits; this app does not send it search queries or station collections.

## Development checks

No runtime package dependencies. Node tests cover arbitrary queries, URL handling, import validation, CSV injection defence, mirror discovery, access-block handling, retry rules and capture provenance. Python tests cover build isolation, atomic refresh, failures and configuration expansion. CI additionally runs `tests/browser_smoke.py` in Chromium with directory and media responses mocked; it checks search, retained data, no autoplay, opt-in persistence, filtering, safe DOM text and a 390px viewport. CI screenshots are artifacts, and real streaming is not part of automated tests.
