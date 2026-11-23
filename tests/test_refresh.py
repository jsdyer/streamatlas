import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from refresh import validate_station, save_capture, read_servers, server_origin, collect

ROW = {'stationuuid':'01234567-89ab-cdef-0123-456789abcdef','name':'Sample test station','url_resolved':'https://radio.example.org/live'}

class RefreshTests(unittest.TestCase):
    def test_rejects_invalid_records_before_replacing_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'stations.json'
            path.write_text('previous capture')
            with self.assertRaises(ValueError):
                save_capture({'capturedAt':'2026-11-23T00:00:00Z','stations':[{'name':'invalid'}]},path)
            self.assertEqual(path.read_text(),'previous capture')
            save_capture({'capturedAt':'2026-11-23T00:00:00Z','stations':[ROW]},path)
            self.assertEqual(json.loads(path.read_text())['stations'][0]['name'],ROW['name'])

    def test_blocks_stop_mirror_retry(self):
        for code in [401,403,429]:
            with self.subTest(code=code), patch('refresh.read_json',side_effect=HTTPError('https://example.org',code,'blocked',{},None)) as reader:
                with self.assertRaises(HTTPError):
                    read_servers('/json/servers',['https://de1.api.radio-browser.info','https://nl1.api.radio-browser.info'])
                self.assertEqual(reader.call_count,1)

    def test_normal_network_failure_can_try_an_advertised_mirror(self):
        with patch('refresh.read_json',side_effect=[URLError('offline'),[ROW]]) as reader:
            data,url=read_servers('/json/stations/search',['https://de1.api.radio-browser.info','https://nl1.api.radio-browser.info'])
            self.assertEqual(data,[ROW]); self.assertIn('nl1.',url)
            self.assertEqual(reader.call_count,2)

    def test_new_query_from_config_is_collected_and_provenance_retained(self):
        config={'bootstrapServers':['https://de1.api.radio-browser.info'], 'retainedQueries':[{'countrycode':'NZ','tag':'experimental','limit':9}]}
        with patch('refresh.read_servers',side_effect=[([{'name':'de1.api.radio-browser.info'}],'https://de1.api.radio-browser.info/json/servers'),([ROW],'https://de1.api.radio-browser.info/json/stations/search?countrycode=NZ')]), patch('refresh.time.sleep'):
            result=collect(config)
            self.assertEqual(result['queries'][0]['query']['countrycode'],'NZ')
            self.assertEqual(result['stations'][0]['name'],ROW['name'])
            self.assertTrue(result['capturedAt'].endswith('Z'))

    def test_stream_urls_are_only_web_addresses(self):
        for value in ['javascript:alert(1)','data:text/plain,bad','https://user:pass@example.org/']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_station({**ROW,'url_resolved':value})
        self.assertEqual(server_origin('de1.api.radio-browser.info'),'https://de1.api.radio-browser.info')
        with self.assertRaises(ValueError): server_origin('https://api.radio-browser.info.bad.example')

if __name__ == '__main__': unittest.main()
