import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeStation, normalizeStations, searchParams, filterStations, webURL, serverList, serverOrigin, importCollection, exportCollection, csvCollection} from '../web/model.mjs';
import {Directory, requestJSON} from '../web/api.mjs';
const row = {stationuuid:'01234567-89ab-cdef-0123-456789abcdef',name:'Test radio',countrycode:'CA',url_resolved:'https://radio.example.org/live',homepage:'https://example.org/',tags:'jazz,talk',language:'english',state:'Nova Scotia',codec:'MP3',bitrate:128,lastcheckok:1,lastchecktime_iso8601:'2026-11-23T00:00:00Z'};
const response = (data, status=200, headers={}) => new Response(JSON.stringify(data), {status,headers:{'Content-Type':'application/json',...headers}});

test('arbitrary countries, phrases and states are encoded without changing API parameters', () => {
  const p = searchParams({countrycode:'nz', name:'A&B = jazz',state:'Wellington',language:'Māori',tag:'experimental'}, 17, 34);
  assert.equal(p.get('name'),'A&B = jazz'); assert.equal(p.get('countrycode'),'NZ'); assert.equal(p.get('state'),'Wellington');
  assert.equal(p.get('limit'),'17'); assert.equal(p.get('offset'),'34'); assert.equal(p.get('language'),'Māori');
  assert.throws(()=>searchParams({countrycode:'Canada'}),/two-letter/); assert.throws(()=>searchParams({bitrateMin:-1}),/bitrate/);
});
test('unsafe stream schemes, credentials and local network targets never become playable links', () => {
  for (const value of ['javascript:alert(1)','data:text/html,hi','https://user:pass@example.org','http://127.0.0.1/','https://192.168.1.5/','https://localhost/','https://private.local/','https://[::1]/']) assert.equal(webURL(value),'');
  assert.equal(webURL('http://stream.example.org'), 'http://stream.example.org/'); assert.equal(webURL('http://stream.example.org', true),'');
  assert.equal(normalizeStation({...row,url_resolved:'javascript:alert(1)'}),null);
});
test('normalization keeps real IDs, safe text, check dates and deduplicates independently of display name',()=>{
  const result = normalizeStation({...row,name:'<img src=x onerror=alert(1)>',bitrate:'192'});
  assert.equal(result.name,'<img src=x onerror=alert(1)>'); assert.equal(result.bitrate,192);
  assert.equal(normalizeStations([row,row,{...row,stationuuid:'wrong'}]).length,1);
  assert.equal(normalizeStation({...row,lastchecktime_iso8601:'bad'}).lastchecktime_iso8601,null);
});
test('filter works beyond initial presets and does not invent bitrate or geography',()=>{
  const rows = normalizeStations([row,{...row,stationuuid:'11234567-89ab-cdef-0123-456789abcdef',countrycode:'NZ',tags:'experimental',bitrate:0,url_resolved:'http://radio.example.org/live'}]);
  assert.equal(filterStations(rows,{countrycode:'NZ',tag:'experimental'}).length,1);
  assert.equal(filterStations(rows,{countrycode:'NZ',httpsOnly:true}).length,0);
  assert.equal(filterStations(rows,{bitrateMin:64}).length,1);
});
test('server discovery accepts only documented HTTPS provider hostnames and deduplicates IPv4/IPv6 entries',()=>{
  assert.deepEqual(serverList([{name:'de1.api.radio-browser.info'},{name:'de1.api.radio-browser.info'},{name:'api.radio-browser.info.evil.test'},{name:'https://fr1.api.radio-browser.info'}]),['https://de1.api.radio-browser.info','https://fr1.api.radio-browser.info']);
  assert.equal(serverOrigin('http://de1.api.radio-browser.info'),'');
  assert.equal(serverOrigin('https://de1.api.radio-browser.info:9999'),'');
});
test('collection roundtrip preserves normalized metadata and rejects partial invalid imports atomically',()=>{
  const stations = normalizeStations([row]);
  assert.deepEqual(importCollection(exportCollection(stations)),stations);
  assert.throws(()=>importCollection(JSON.stringify({format:'coolcode-streamatlas-v1',stations:[row,{...row,stationuuid:'bad'}]})),/Nothing was imported/);
  assert.throws(()=>importCollection(JSON.stringify({format:'coolcode-streamatlas-v1',stations:[row,row]})),/duplicate/);
  assert.throws(()=>importCollection('not JSON'),/valid JSON/);
});
test('CSV neutralizes spreadsheet formulas while quoting commas and newlines',()=>{
  const csv=csvCollection([{...row,name:'=cmd(),"danger"\nline'}]);
  assert.ok(csv.includes('"\'=cmd(),""danger""\nline"'));
});
test('request does not leak cookies or proceed through confirmed access blocks or rate limiting',async()=>{
  for (const code of [401,403,429]) {
    let calls=0; const api=new Directory({maxServerAttempts:3}, async(url, options)=>{calls++; assert.equal(options.credentials,'omit'); return response({},code);});
    api.servers=['https://de1.api.radio-browser.info','https://nl1.api.radio-browser.info'];
    await assert.rejects(api.search(new URLSearchParams()), error=>error.stop===true); assert.equal(calls,1);
  }
  await assert.rejects(requestJSON('https://example.org',{fetcher:async()=>new Response('<html>challenge</html>',{status:200,headers:{'content-type':'text/html'}})}), error=>error.stop===true);
});
test('ordinary unavailable mirror can fail over, search and click endpoints remain separate',async()=>{
  const calls=[]; const api=new Directory({maxServerAttempts:3},async(url)=>{calls.push(url); if(url.startsWith('https://de1.')) return response({},503); return response([row]);});
  api.servers=['https://de1.api.radio-browser.info','https://nl1.api.radio-browser.info'];
  const result=await api.search(searchParams({countrycode:'CA'}));
  assert.equal(result.stations[0].name,row.name); assert.equal(calls.length,2); assert.ok(calls.every(u=>!u.includes('/json/url/')));
  await assert.rejects(api.click('not-an-id'),/Invalid station/);
});
test('retained capture has real provenance, UUIDs and multiple distinct editable queries',async()=>{
  const config=JSON.parse(await readFile(new URL('../web/config.json',import.meta.url)));
  const capture=JSON.parse(await readFile(new URL('../web/data/stations.json',import.meta.url)));
  assert.ok(Date.parse(capture.capturedAt)); assert.ok(capture.stations.length>0);
  assert.equal(normalizeStations(capture.stations).length,capture.stations.length);
  assert.equal(capture.queries.length,config.retainedQueries.length);
  assert.ok(capture.queries.every(q=>q.url.startsWith('https://') && q.url.includes('/json/stations/search?')));
  assert.ok(capture.stations.some(s=>s.countrycode==='CA'));
});
