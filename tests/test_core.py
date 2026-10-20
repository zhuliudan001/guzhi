import json
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import fund_api


class FakeResponse:
    def __init__(self, text='', payload=None, status_code=200):
        self.text = text
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            import requests
            raise requests.HTTPError(f'HTTP {self.status_code}', response=self)

    def json(self):
        return self._payload


class CacheTests(unittest.TestCase):
    def test_cache_expires(self):
        clock = [100.0]
        cache = fund_api.TTLCache(clock=lambda: clock[0])
        cache.set('a', 1, 10)
        self.assertEqual(cache.get('a'), 1)
        clock[0] = 111.0
        self.assertIsNone(cache.get('a'))

    def test_cache_clear(self):
        cache = fund_api.TTLCache()
        cache.set('a', 1, 10)
        cache.clear()
        self.assertIsNone(cache.get('a'))


class CorsTests(unittest.TestCase):
    def test_local_origins_any_port_allowed(self):
        for origin in ('http://localhost:8090', 'http://127.0.0.1:8090',
                       'http://localhost:8080', 'http://localhost'):
            self.assertTrue(fund_api._origin_allowed(origin), origin)

    def test_production_origin_allowed(self):
        self.assertTrue(fund_api._origin_allowed('https://guzhi.itect.me'))

    def test_unknown_origins_rejected(self):
        for origin in (None, '', 'http://evil.com', 'http://localhost.evil.com',
                       'https://localhost:8090', 'http://192.168.1.5:8090'):
            self.assertFalse(fund_api._origin_allowed(origin), origin)


class HelperTests(unittest.TestCase):
    def test_to_float(self):
        self.assertEqual(fund_api._to_float('1.25'), 1.25)
        self.assertEqual(fund_api._to_float(2), 2.0)
        for value in (None, '', '--', 'nan', 'inf', 'abc'):
            self.assertIsNone(fund_api._to_float(value), value)

    def test_format_values(self):
        self.assertEqual(fund_api._fmt_nav(1), '1.0000')
        self.assertEqual(fund_api._fmt_nav(None), '--')
        self.assertEqual(fund_api._fmt_num(1.2), '1.20')
        self.assertEqual(fund_api._fmt_num(None), '--')

    def test_extract_json(self):
        self.assertEqual(fund_api._extract_json('jQuery({"a": 1})'), {'a': 1})
        self.assertEqual(fund_api._extract_json('cb({"a": 2});'), {'a': 2})
        self.assertIsNone(fund_api._extract_json('not json'))
        self.assertIsNone(fund_api._extract_json(''))


class MarketStatusTests(unittest.TestCase):
    def at(self, year, month, day, hour, minute=0, tz=fund_api.SHANGHAI_TZ):
        return datetime(year, month, day, hour, minute, tzinfo=tz)

    def test_pre_open(self):
        result = fund_api._market_status(self.at(2026, 10, 20, 9))
        self.assertEqual(result['status'], 'pre_open')
        self.assertFalse(result['is_trading'])
        self.assertEqual(result['next_open'], '2026-10-20 09:30')

    def test_trading(self):
        result = fund_api._market_status(self.at(2026, 10, 20, 10))
        self.assertEqual(result['status'], 'trading')
        self.assertTrue(result['is_trading'])
        self.assertIsNone(result['next_open'])

    def test_lunch_break(self):
        result = fund_api._market_status(self.at(2026, 10, 20, 12))
        self.assertEqual(result['status'], 'lunch_break')
        self.assertFalse(result['is_trading'])
        self.assertEqual(result['next_open'], '2026-10-20 13:00')

    def test_after_close(self):
        result = fund_api._market_status(self.at(2026, 10, 20, 16))
        self.assertEqual(result['status'], 'closed_today')
        self.assertFalse(result['is_trading'])
        self.assertEqual(result['next_open'], '2026-10-21 09:30')

    def test_weekend(self):
        result = fund_api._market_status(self.at(2026, 10, 24, 10))
        self.assertEqual(result['status'], 'weekend')
        self.assertEqual(result['next_open'], '2026-10-26 09:30')

    def test_holiday(self):
        result = fund_api._market_status(self.at(2026, 10, 5, 10))
        self.assertEqual(result['status'], 'holiday')
        self.assertEqual(result['next_open'], '2026-10-08 09:30')

    def test_utc_input_is_converted_to_shanghai(self):
        result = fund_api._market_status(
            self.at(2026, 10, 20, 2, tz=timezone.utc)
        )
        self.assertEqual(result['status'], 'trading')
        self.assertEqual(result['current_time'], '2026-10-20 10:00:00')


class PayloadTests(unittest.TestCase):
    def setUp(self):
        self.nav = {
            'DWJZ': '1.0000',
            'FSRQ': '2026-10-17',
            'JZZZL': '0.50',
            'LJJZ': '2.0000',
            'SGZT': '开放申购',
            'SHZT': '开放赎回',
        }
        self.meta = {'name': '测试基金', 'type': '混合型'}
        self.fast = {
            'code': '000001',
            'name': '测试基金',
            'nav': 1.0,
            'nav_date': '2026-10-17',
            'nav_change': 0.5,
            'estimated_nav': 1.01,
            'estimated_change': 1.0,
            'estimate_time': '2026-10-20 14:00',
            'has_estimate': True,
            'has_realtime': True,
        }

    def test_basic_payload_prefers_fast_estimate(self):
        payload = fund_api._build_basic_payload('000001', self.meta, self.fast, self.nav)
        self.assertEqual(payload['name'], '测试基金')
        self.assertEqual(payload['type'], '混合型')
        self.assertEqual(payload['gsz'], '1.0100')
        self.assertEqual(payload['gszzl'], '1.00')
        self.assertEqual(payload['jzzzl'], '0.50')
        self.assertEqual(payload['dwjz'], '1.0000')
        self.assertEqual(payload['ljjz'], '2.0000')
        self.assertEqual(payload['jzrq'], '2026-10-17')
        self.assertEqual(payload['source'], 'tiantian')
        self.assertTrue(payload['has_estimate'])
        self.assertTrue(payload['has_realtime'])
        self.assertEqual(payload['estimated_change'], 1.0)

    def test_basic_payload_falls_back_to_nav(self):
        payload = fund_api._build_basic_payload('000001', self.meta, None, self.nav)
        self.assertEqual(payload['gsz'], '1.0000')
        self.assertEqual(payload['gszzl'], '0.50')
        self.assertEqual(payload['source'], 'eastmoney')
        self.assertFalse(payload['has_estimate'])
        self.assertFalse(payload['has_realtime'])

    def test_valuation_payload_maps_fast_record(self):
        payload = fund_api._valuation_payload(self.fast)
        self.assertEqual(payload['code'], '000001')
        self.assertEqual(payload['gsz'], '1.0100')
        self.assertEqual(payload['gszzl'], '1.00')
        self.assertEqual(payload['jzzzl'], '0.50')
        self.assertEqual(payload['gztime'], '2026-10-20 14:00')
        self.assertEqual(payload['source'], 'tiantian')


class FetchTests(unittest.TestCase):
    def setUp(self):
        fund_api.META_CACHE.clear()
        fund_api.FAST_CACHE.clear()
        fund_api.DETAIL_CACHE.clear()

    def test_fund_meta_is_cached(self):
        body = 'jQuery({"Datas":[{"CODE":"000001","NAME":"测试基金","FundBaseInfo":{"FTYPE":"混合型"}}]})'
        with patch.object(fund_api, 'http_get', return_value=FakeResponse(text=body)) as mocked:
            first = fund_api.get_fund_meta('000001')
            second = fund_api.get_fund_meta('000001')
        self.assertEqual(first, {'name': '测试基金', 'type': '混合型'})
        self.assertEqual(second, first)
        self.assertEqual(mocked.call_count, 1)

    def test_fund_meta_ignores_non_fund_suggestions(self):
        body = 'jQuery({"Datas":[{"CODE":"09999","NAME":"网易","FundBaseInfo":null}]})'
        with patch.object(fund_api, 'http_get', return_value=FakeResponse(text=body)):
            meta = fund_api.get_fund_meta('999999')
        self.assertEqual(meta, {})

    def test_fast_valuations_are_cached(self):
        payload = {
            'success': True,
            'data': [{
                'FCODE': '000001',
                'SHORTNAME': '测试基金',
                'GSZZL': '1.0',
                'GZTIME': '2026-10-20 14:00',
                'GSZ': '1.0100',
                'NAV': '1.0000',
                'PDATE': '2026-10-17',
                'NAVCHGRT': '0.5',
            }],
        }
        with patch.object(fund_api, 'http_get', return_value=FakeResponse(payload=payload)) as mocked:
            first = fund_api.get_fast_valuations(['000001'])
            second = fund_api.get_fast_valuations(['000001'])
        self.assertEqual(first['000001']['estimated_change'], 1.0)
        self.assertEqual(second['000001']['estimated_nav'], 1.01)
        self.assertEqual(mocked.call_count, 1)

    def test_fund_data_composes_basic_fields(self):
        meta = {'name': '测试基金', 'type': '混合型'}
        nav = {'DWJZ': '1.0000', 'FSRQ': '2026-10-17', 'JZZZL': '0.50', 'LJJZ': '2.0000'}
        fast = {
            'code': '000001', 'name': '测试基金', 'nav': 1.0,
            'nav_date': '2026-10-17', 'nav_change': 0.5,
            'estimated_nav': 1.01, 'estimated_change': 1.0,
            'estimate_time': '2026-10-20 14:00',
            'has_estimate': True, 'has_realtime': True,
        }
        with patch.object(fund_api, 'get_fund_meta', return_value=meta), \
                patch.object(fund_api, 'get_fast_valuation', return_value=fast), \
                patch.object(fund_api, 'get_fund_nav', return_value=nav):
            payload = fund_api.get_fund_data('000001')
        self.assertEqual(payload['gsz'], '1.0100')
        self.assertEqual(payload['gszzl'], '1.00')
        self.assertTrue(payload['has_estimate'])

    def test_fund_data_propagates_not_found(self):
        with patch.object(fund_api, 'get_fund_meta', return_value={}), \
                patch.object(fund_api, 'get_fast_valuation', return_value=None), \
                patch.object(fund_api, 'get_fund_nav', side_effect=fund_api.FundNotFoundError('未找到')):
            with self.assertRaises(fund_api.FundNotFoundError):
                fund_api.get_fund_data('999999')

    def test_fund_data_rejects_stock_meta_without_nav(self):
        with patch.object(fund_api, 'get_fund_meta', return_value={'name': '网易'}), \
                patch.object(fund_api, 'get_fast_valuation', return_value=None), \
                patch.object(fund_api, 'get_fund_nav', side_effect=fund_api.FundNotFoundError('未找到')):
            with self.assertRaises(fund_api.FundNotFoundError):
                fund_api.get_fund_data('999999')

    def test_detail_derived_estimate_aligns_gztime(self):
        base = {
            'code': '000001', 'name': '测试基金', 'dwjz': '1.0000',
            'gsz': '1.0000', 'gszzl': '0.00', 'gztime': '2026-10-17',
            'has_estimate': False, 'source': 'eastmoney',
        }
        estimate = {'estimated_change': -0.5, 'stock_ratio': 0.9}
        fund_api.DETAIL_CACHE.clear()
        with patch.object(fund_api, 'get_fund_data', return_value=base), \
                patch.object(fund_api, 'get_fund_stock_estimate', return_value=estimate):
            payload = fund_api.get_fund_detail('000001')
        self.assertTrue(payload['has_estimate'])
        self.assertEqual(payload['gsz'], '0.9950')
        self.assertEqual(payload['gszzl'], '-0.50')
        self.assertEqual(payload['gztime'], payload['update_time'])
        self.assertTrue(payload['update_time'].startswith('20'))

    def test_fund_data_keeps_fast_estimate_without_nav(self):
        fast = {
            'code': '000001', 'name': '测试基金', 'nav': 1.0,
            'nav_date': '2026-10-17', 'nav_change': 0.5,
            'estimated_nav': 1.01, 'estimated_change': 1.0,
            'estimate_time': '2026-10-20 14:00',
            'has_estimate': True, 'has_realtime': True,
        }
        with patch.object(fund_api, 'get_fund_meta', return_value={}), \
                patch.object(fund_api, 'get_fast_valuation', return_value=fast), \
                patch.object(fund_api, 'get_fund_nav', side_effect=fund_api.FundNotFoundError('未找到')):
            payload = fund_api.get_fund_data('000001')
        self.assertTrue(payload['has_estimate'])
        self.assertEqual(payload['gsz'], '1.0100')


class RouteTests(unittest.TestCase):
    def setUp(self):
        fund_api.app.testing = True
        self.client = fund_api.app.test_client()

    def test_invalid_code(self):
        response = self.client.get('/api/fund/abc123')
        self.assertEqual(response.status_code, 400)

    def test_fund_not_found_maps_to_404(self):
        with patch.object(fund_api, 'get_fund_data', side_effect=fund_api.FundNotFoundError('未找到基金')):
            response = self.client.get('/api/fund/999999')
        self.assertEqual(response.status_code, 404)
        self.assertFalse(response.get_json()['success'])

    def test_upstream_error_maps_to_502(self):
        with patch.object(fund_api, 'get_fund_data', side_effect=fund_api.UpstreamError('数据源暂时不可用')):
            response = self.client.get('/api/fund/000001')
        self.assertEqual(response.status_code, 502)

    def test_unexpected_error_does_not_leak_details(self):
        with patch.object(fund_api, 'get_fund_data', side_effect=RuntimeError('boom secret')):
            response = self.client.get('/api/fund/000001')
        self.assertEqual(response.status_code, 500)
        self.assertNotIn('secret', json.dumps(response.get_json(), ensure_ascii=False))

    def test_successful_fund_response(self):
        payload = {'code': '000001', 'name': '测试基金'}
        with patch.object(fund_api, 'get_fund_data', return_value=payload):
            response = self.client.get('/api/fund/000001')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()['success'])

    def test_detail_route(self):
        payload = {'code': '000001', 'top_stocks': []}
        with patch.object(fund_api, 'get_fund_detail', return_value=payload):
            response = self.client.get('/api/fund/000001/detail')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()['success'])

    def test_batch_limit(self):
        response = self.client.post('/api/funds/batch', json={'codes': ['000001'] * 21})
        self.assertEqual(response.status_code, 400)

    def test_fast_batch_limit(self):
        response = self.client.post('/api/funds/fast', json={'codes': ['000001'] * 51})
        self.assertEqual(response.status_code, 400)

    def test_fast_batch_success(self):
        record = {
            'code': '000001', 'name': '测试基金', 'nav': 1.0,
            'nav_date': '2026-10-17', 'nav_change': 0.5,
            'estimated_nav': 1.01, 'estimated_change': 1.0,
            'estimate_time': '2026-10-20 14:00',
            'has_estimate': True, 'has_realtime': True,
        }
        with patch.object(fund_api, 'get_fast_valuations', return_value={'000001': record}):
            response = self.client.post('/api/funds/fast', json={'codes': ['000001']})
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data['success'])
        self.assertEqual(data['data'][0]['gsz'], '1.0100')

    def test_trading_status(self):
        response = self.client.get('/api/trading-status')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()['success'])


if __name__ == '__main__':
    unittest.main()
