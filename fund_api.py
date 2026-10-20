#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
基金估值 API 服务
直接调用天天基金网接口
"""

import logging
import json
import math
import re
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone

import requests
from flask import Flask, jsonify, request
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from werkzeug.exceptions import HTTPException

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# CORS 配置 - 生产域名 + 任意本地端口（本地调试时静态服务端口不固定）
ALLOWED_ORIGINS = {'https://guzhi.itect.me'}
LOCAL_ORIGIN_RE = re.compile(r'^http://(localhost|127\.0\.0\.1)(:\d+)?$')

def _origin_allowed(origin):
    return bool(origin) and (origin in ALLOWED_ORIGINS or LOCAL_ORIGIN_RE.match(origin))

@app.after_request
def add_cors_headers(response):
    origin = request.headers.get('Origin')
    if _origin_allowed(origin):
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    # 禁用缓存，确保每次获取最新数据
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

# 配置为生产环境，不显示详细错误信息
app.config['DEBUG'] = False

# 常量定义
API_TIMEOUT = 10  # 请求超时时间（秒）
# 天天基金净值接口
TARGET_URL = 'https://api.fund.eastmoney.com/f10/lsjz?callback=jQuery&fundCode={code}&pageIndex=1&pageSize=1'
# 基金搜索接口（获取基金名称）
SEARCH_URL = 'https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?callback=jQuery&m=1&key={code}'
# 天天基金批量估值接口
FAST_URL = (
    'https://fundcomapi.tiantianfunds.com/mm/newCore/FundValuationLast'
    '?FCODES={codes}&FIELDS=FCODE,SHORTNAME,GSZZL,GZTIME,GSZ,NAV,PDATE,NAVCHGRT'
)
MAX_BATCH_SIZE = 20
FAST_BATCH_SIZE = 50

META_CACHE_TTL = 6 * 60 * 60
FAST_CACHE_TTL = 60
NAV_CACHE_TTL = 5 * 60
DETAIL_CACHE_TTL = 5 * 60

SHANGHAI_TZ = timezone(timedelta(hours=8), 'Asia/Shanghai')

DEFAULT_HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ),
    'Referer': 'https://fund.eastmoney.com/',
}

# A 股休市日（国务院节假日安排；跨年时需补充下一年度）
HOLIDAYS = {
    # 2025
    date(2025, 1, 1),
    date(2025, 1, 28), date(2025, 1, 29), date(2025, 1, 30),
    date(2025, 1, 31), date(2025, 2, 1), date(2025, 2, 2), date(2025, 2, 3),
    date(2025, 4, 4), date(2025, 4, 5), date(2025, 4, 6),
    date(2025, 5, 1), date(2025, 5, 2), date(2025, 5, 3), date(2025, 5, 4), date(2025, 5, 5),
    date(2025, 5, 31), date(2025, 6, 1), date(2025, 6, 2),
    date(2025, 10, 1), date(2025, 10, 2), date(2025, 10, 3), date(2025, 10, 4),
    date(2025, 10, 5), date(2025, 10, 6), date(2025, 10, 7),
    # 2026
    date(2026, 1, 1), date(2026, 1, 2), date(2026, 1, 3),
    date(2026, 2, 17), date(2026, 2, 18), date(2026, 2, 19), date(2026, 2, 20),
    date(2026, 2, 21), date(2026, 2, 22), date(2026, 2, 23),
    date(2026, 4, 5), date(2026, 4, 6), date(2026, 4, 7),
    date(2026, 5, 1), date(2026, 5, 2), date(2026, 5, 3),
    date(2026, 6, 19), date(2026, 6, 20), date(2026, 6, 21),
    date(2026, 9, 25), date(2026, 9, 26), date(2026, 9, 27),
    date(2026, 10, 1), date(2026, 10, 2), date(2026, 10, 3), date(2026, 10, 4),
    date(2026, 10, 5), date(2026, 10, 6), date(2026, 10, 7),
}

STATUS_TEXT = {
    'pre_open': '待开盘',
    'trading': '交易中',
    'lunch_break': '午间休市',
    'closed_today': '今日休市',
    'weekend': '周末休市',
    'holiday': '节假日休市',
}


class FundNotFoundError(LookupError):
    """基金不存在或已停止披露净值。"""


class UpstreamError(RuntimeError):
    """上游数据源不可用或返回异常。"""


class TTLCache:
    """带过期时间和容量上限的线程安全缓存。"""

    def __init__(self, ttl=60, clock=time.monotonic, max_size=512):
        self.ttl = ttl
        self._clock = clock
        self._max_size = max_size
        self._data = {}
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            item = self._data.get(key)
            if item is None:
                return None
            expires_at, value = item
            if self._clock() >= expires_at:
                self._data.pop(key, None)
                return None
            return value

    def set(self, key, value, ttl=None):
        lifetime = self.ttl if ttl is None else ttl
        with self._lock:
            if len(self._data) >= self._max_size:
                now = self._clock()
                for expired in [k for k, (exp, _) in self._data.items() if exp <= now]:
                    self._data.pop(expired, None)
                if len(self._data) >= self._max_size:
                    oldest = min(self._data, key=lambda k: self._data[k][0])
                    self._data.pop(oldest, None)
            self._data[key] = (self._clock() + lifetime, value)

    def clear(self):
        with self._lock:
            self._data.clear()


META_CACHE = TTLCache(ttl=META_CACHE_TTL)
FAST_CACHE = TTLCache(ttl=FAST_CACHE_TTL)
NAV_CACHE = TTLCache(ttl=NAV_CACHE_TTL)
DETAIL_CACHE = TTLCache(ttl=DETAIL_CACHE_TTL)

_thread_local = threading.local()


def _get_session():
    session = getattr(_thread_local, 'session', None)
    if session is None:
        session = requests.Session()
        retry = Retry(
            total=2,
            connect=2,
            read=2,
            backoff_factor=0.3,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset(['GET']),
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry, pool_connections=10, pool_maxsize=10)
        session.mount('https://', adapter)
        session.mount('http://', adapter)
        _thread_local.session = session
    return session


def http_get(url, **kwargs):
    kwargs.setdefault('timeout', API_TIMEOUT)
    kwargs.setdefault('headers', DEFAULT_HEADERS)
    return _get_session().get(url, **kwargs)


def _validate_code(code):
    if not isinstance(code, str) or len(code) != 6 or not code.isdigit():
        raise ValueError('无效的基金代码，请输入 6 位数字')
    return code


def _to_float(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        if isinstance(value, str):
            text = value.strip().replace(',', '').replace('%', '')
            if not text or text == '--':
                return None
            number = float(text)
        else:
            number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _fmt_nav(value):
    number = _to_float(value)
    return f'{number:.4f}' if number is not None else '--'


def _fmt_num(value):
    number = _to_float(value)
    return f'{number:.2f}' if number is not None else '--'


def _extract_json(text):
    if not text:
        return None
    start = text.find('{')
    end = text.rfind('}') + 1
    if start < 0 or end <= start:
        return None
    try:
        return json.loads(text[start:end])
    except (TypeError, ValueError):
        return None


def _next_trading_day(start):
    day = start
    while day.weekday() >= 5 or day in HOLIDAYS:
        day += timedelta(days=1)
    return day


def _market_status(now=None):
    """返回上海时区下的 A 股交易状态。"""
    if now is None:
        now = datetime.now(SHANGHAI_TZ)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=SHANGHAI_TZ)
    else:
        now = now.astimezone(SHANGHAI_TZ)

    current_date = now.date()
    is_weekend = current_date.weekday() >= 5
    is_holiday = current_date in HOLIDAYS
    is_trading_day = not is_weekend and not is_holiday
    minutes = now.hour * 60 + now.minute

    if not is_trading_day:
        status = 'weekend' if is_weekend else 'holiday'
        is_trading = False
        next_open = f'{_next_trading_day(current_date + timedelta(days=1))} 09:30'
    elif minutes < 9 * 60 + 30:
        status = 'pre_open'
        is_trading = False
        next_open = f'{current_date} 09:30'
    elif minutes <= 11 * 60 + 30:
        status = 'trading'
        is_trading = True
        next_open = None
    elif minutes < 13 * 60:
        status = 'lunch_break'
        is_trading = False
        next_open = f'{current_date} 13:00'
    elif minutes < 15 * 60:
        status = 'trading'
        is_trading = True
        next_open = None
    else:
        status = 'closed_today'
        is_trading = False
        next_open = f'{_next_trading_day(current_date + timedelta(days=1))} 09:30'

    return {
        'status': status,
        'status_text': STATUS_TEXT[status],
        'is_trading': is_trading,
        'is_trading_day': is_trading_day,
        'is_holiday': is_holiday,
        'is_weekend': is_weekend,
        'current_time': now.strftime('%Y-%m-%d %H:%M:%S'),
        'next_open': next_open,
        'suggested_refresh_interval': 60000 if is_trading else 300000,
    }


def _api_error(message, status):
    return jsonify({'success': False, 'error': message}), status


@app.errorhandler(FundNotFoundError)
def handle_fund_not_found(e):
    return _api_error(str(e) or '未找到基金', 404)


@app.errorhandler(UpstreamError)
def handle_upstream_error(e):
    logger.warning(f"上游数据源异常：{e}")
    return _api_error(str(e) or '数据源暂时不可用', 502)


@app.errorhandler(HTTPException)
def handle_http_exception(e):
    return _api_error(e.description or e.name, e.code or 500)


@app.errorhandler(Exception)
def handle_exception(e):
    """兜底异常处理，避免把堆栈或内部细节返回给前端。"""
    logger.error(f"未处理的异常：{str(e)}\n{traceback.format_exc()}")
    return _api_error('服务器内部错误，请稍后重试', 500)


def _get_etf_realtime_change(fund_name, headers):
    """
    从 ETF联接基金名称推导对应 ETF 或跟踪指数，获取实时涨跌幅

    Args:
        fund_name (str): 基金名称，如 "易方达中证红利ETF联接发起式A"
        headers (dict): HTTP 请求头

    Returns:
        float or None: ETF/指数 实时涨跌幅，失败返回 None
    """
    try:
        # 去掉"联接"及其后缀
        base = re.split(r'联接', fund_name)[0]
        # 去掉末尾的"ETF"
        base = base.replace('ETF', '').strip()

        # 提取公司名
        company_match = re.match(
            r'^(易方达|南方|华夏|嘉实|广发|富国|博时|汇添富|招商|工银|建信|中银|鹏华|'
            r'国泰|华安|大成|景顺|银华|诺安|天弘|中欧|兴全|交银|海富通|华宝|平安|万家|'
            r'泰康|恒生|路博迈|富达|联博|范达|施罗德|瑞银|安联|贝莱德)',
            base
        )
        if not company_match:
            return None

        company = company_match.group(1)
        index_part = base[len(company):]

        # 去掉常见指数前缀，提取核心指数名
        core_index = re.sub(r'^(中证|深证|上证|恒生|纳斯达克|标普)', '', index_part)
        core_index = re.sub(r'^全指', '', core_index)
        core_index = core_index.strip()

        if not core_index:
            return None

        # 生成多个搜索关键词，尝试找到对应 ETF
        index_variants = [core_index]
        if len(core_index) > 2:
            shortened = re.sub(r'(公司|指数|股份)$', '', core_index)
            if shortened and shortened != core_index:
                index_variants.append(shortened)

        search_keywords = []
        for idx in index_variants:
            search_keywords.extend([
                f'{idx}ETF{company}',
                f'{company}{idx}ETF',
                f'{idx}ETF',
            ])

        etf_code = None
        for keyword in search_keywords:
            search_url = f'https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?callback=jQuery&m=1&key={keyword}'
            search_resp = requests.get(search_url, headers=headers, timeout=API_TIMEOUT)
            search_body = search_resp.text

            search_start = search_body.find('{')
            search_end = search_body.rfind('}') + 1
            if search_start == -1 or search_end <= search_start:
                continue

            search_data = json.loads(search_body[search_start:search_end])
            if not search_data.get('Datas'):
                continue

            # 查找同公司 ETF
            for item in search_data['Datas']:
                item_code = item.get('CODE', '')
                item_name = item.get('NAME', '')
                if (item_code.isdigit() and len(item_code) == 6
                        and (item_code.startswith('1') or item_code.startswith('5'))
                        and 'ETF' in item_name
                        and company in item_name):
                    etf_code = item_code
                    break

            if etf_code:
                break

        # 获取 ETF 实时行情
        if etf_code:
            if etf_code.startswith('5') or etf_code.startswith('6'):
                market_code = f'sh{etf_code}'
            else:
                market_code = f'sz{etf_code}'

            stock_url = f'https://qt.gtimg.cn/q={market_code}'
            stock_resp = requests.get(stock_url, headers=headers, timeout=API_TIMEOUT)

            for line in stock_resp.text.split('\n'):
                if 'v_' in line and '=' in line:
                    value = line.split('=')[1].strip().strip('"').strip(';')
                    if value and '~' in value:
                        fields = value.split('~')
                        if len(fields) > 32 and fields[32] and fields[32] != '0.00':
                            return float(fields[32])

        # ETF 没有数据或找不到 ETF，尝试获取跟踪指数的数据（QDII 基金）
        index_code = _get_tracking_index_code(fund_name, core_index)
        if index_code:
            index_url = f'https://qt.gtimg.cn/q={index_code}'
            index_resp = requests.get(index_url, headers=headers, timeout=API_TIMEOUT)

            for line in index_resp.text.split('\n'):
                if 'v_' in line and '=' in line:
                    value = line.split('=')[1].strip().strip('"').strip(';')
                    if value and '~' in value:
                        fields = value.split('~')
                        # 港股指数涨跌幅在不同位置
                        if len(fields) > 32 and fields[32] and fields[32] != '0.00':
                            return float(fields[32])

    except Exception as e:
        logger.warning(f"获取 ETF/指数 实时涨跌幅失败: {e}")

    return None


def _get_tracking_index_code(fund_name, core_index):
    """
    根据基金名称和核心指数名，获取跟踪指数的腾讯财经代码

    Args:
        fund_name (str): 基金名称
        core_index (str): 核心指数名（如 "恒生科技"）

    Returns:
        str or None: 腾讯财经指数代码，失败返回 None
    """
    # 常见指数映射表
    index_mapping = {
        '恒生科技': 'hkHSTECH',
        '恒生': 'hkHSI',
        '纳斯达克': 'usNDX',
        '纳斯达克100': 'usNDX',
        '标普500': 'usSPX',
        '道琼斯': 'usDJI',
        '日经225': 'jpiN225',
        '德国DAX': 'fx_sgerman30',
        '富时100': 'fx_suk100',
        '原油': 'hf_CL',
        '黄金': 'hf_GC',
    }

    # 直接匹配
    for key, code in index_mapping.items():
        if key in core_index or key in fund_name:
            return code

    # 模糊匹配
    if '恒生' in fund_name and '科技' in fund_name:
        return 'hkHSTECH'
    if '纳斯达克' in fund_name or '纳指' in fund_name:
        return 'usNDX'
    if '标普' in fund_name or 'S&P' in fund_name:
        return 'usSPX'

    return None


def get_fund_stock_estimate(code):
    """
    通过重仓股计算基金估算涨跌幅，并获取基金详细信息

    Args:
        code (str): 6 位基金代码

    Returns:
        dict: 包含估算涨跌幅、重仓股信息和基金详情
    """
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://fund.eastmoney.com/'
    }

    result = {
        'estimated_change': None,
        'stock_ratio': 0,
        'stocks': [],
        'sectors': [],
        'fund_detail': {},
        'performance': {},
        'managers': [],
        'nav_trend': None,
        'asset_allocation': None
    }

    try:
        # 获取基金详情页
        url = f'https://fund.eastmoney.com/pingzhongdata/{code}.js'
        resp = requests.get(url, headers=headers, timeout=API_TIMEOUT)
        body = resp.text

        # 提取基金基本信息
        name_match = re.search(r'fS_name\s*=\s*"(.*?)"', body)
        if name_match:
            result['fund_detail']['name'] = name_match.group(1)

        code_match = re.search(r'fS_code\s*=\s*"(.*?)"', body)
        if code_match:
            result['fund_detail']['code'] = code_match.group(1)

        # 提取收益率数据
        syl_1n_match = re.search(r'syl_1n\s*=\s*"(.*?)"', body)
        syl_6y_match = re.search(r'syl_6y\s*=\s*"(.*?)"', body)
        syl_3y_match = re.search(r'syl_3y\s*=\s*"(.*?)"', body)
        syl_1y_match = re.search(r'syl_1y\s*=\s*"(.*?)"', body)

        result['performance'] = {
            'year': float(syl_1n_match.group(1)) if syl_1n_match else 0,
            'half_year': float(syl_6y_match.group(1)) if syl_6y_match else 0,
            'quarter': float(syl_3y_match.group(1)) if syl_3y_match else 0,
            'month': float(syl_1y_match.group(1)) if syl_1y_match else 0
        }

        # 提取净值走势数据（近60个交易日）
        try:
            nav_trend_match = re.search(r'Data_netWorthTrend\s*=\s*(\[.*?\])\s*;', body, re.DOTALL)
            if nav_trend_match:
                nav_data = json.loads(nav_trend_match.group(1))
                recent = nav_data[-60:] if len(nav_data) > 60 else nav_data
                # x 是毫秒时间戳，y 是净值
                result['nav_trend'] = {
                    'dates': [item.get('x', 0) for item in recent],
                    'values': [item.get('y', 0) for item in recent]
                }
        except Exception:
            pass

        # 提取基金经理信息
        try:
            manager_match = re.search(r'Data_currentFundManager\s*=\s*(\[.*?\])\s*;', body, re.DOTALL)
            if manager_match:
                managers_data = json.loads(manager_match.group(1))
                result['managers'] = [
                    {
                        'name': m.get('name', ''),
                        'start_date': m.get('startDate', ''),
                        'total_assets': m.get('totalAssets', 0)
                    }
                    for m in managers_data[:3]  # 最多3位经理
                ]
        except Exception:
            pass

        # 提取资产配置详情
        try:
            alloc_match = re.search(r'Data_assetAllocation\s*=\s*(\{.*?\})\s*;', body, re.DOTALL)
            if alloc_match:
                alloc_data = json.loads(alloc_match.group(1))
                series = alloc_data.get('series', [])
                asset = {'stock': 0, 'bond': 0, 'cash': 0}
                for s in series:
                    name = s.get('name', '')
                    data = s.get('data', [])
                    value = data[-1] if data else 0
                    if '股票' in name:
                        asset['stock'] = float(value)
                    elif '债券' in name:
                        asset['bond'] = float(value)
                    elif '现金' in name:
                        asset['cash'] = float(value)
                result['asset_allocation'] = asset
        except Exception:
            pass

        # 提取股票占净比
        stock_ratio_match = re.search(r'Data_assetAllocation\s*=\s*\{.*?"股票占净比".*?"data":\s*\[([\d.,]+)\]', body, re.DOTALL)
        if stock_ratio_match:
            ratios = stock_ratio_match.group(1).split(',')
            result['stock_ratio'] = float(ratios[-1]) / 100

        # 检测 ETF联接基金：股票占净比 < 10% 且名称包含"联接"
        fund_name = result['fund_detail'].get('name', '')
        is_feeder_fund = result['stock_ratio'] < 0.1 and '联接' in fund_name

        if is_feeder_fund:
            # ETF联接基金：尝试获取对应 ETF 的实时涨跌幅
            etf_change = _get_etf_realtime_change(fund_name, headers)
            if etf_change is not None:
                result['estimated_change'] = round(etf_change, 2)
                result['etf_mode'] = True

        # 提取重仓股代码
        stock_pattern = r'stockCodes\s*=\s*\[(.*?)\]'
        stock_match = re.search(stock_pattern, body)

        stock_codes = []
        if stock_match:
            stock_str = stock_match.group(1)
            raw_codes = re.findall(r'"(\d+)"', stock_str)
            stock_codes = [c[:6] for c in raw_codes[:10]]

            # 分析重仓股所属板块
            sectors = set()
            for sc in stock_codes:
                if sc.startswith('688'):
                    sectors.add('科创板')
                elif sc.startswith('300'):
                    sectors.add('创业板')
                elif sc.startswith('6'):
                    sectors.add('上交所')
                else:
                    sectors.add('深交所')
            result['stock_sectors'] = list(sectors)

            # 获取重仓股实时行情
            if stock_codes:
                stock_list = []
                for sc in stock_codes:
                    if sc.startswith('6'):
                        stock_list.append(f'sh{sc}')
                    else:
                        stock_list.append(f'sz{sc}')

                stock_str = ','.join(stock_list)
                stock_url = f'https://qt.gtimg.cn/q={stock_str}'
                stock_resp = requests.get(stock_url, headers=headers, timeout=API_TIMEOUT)

                stocks_data = []
                for line in stock_resp.text.split('\n'):
                    if 'v_' in line and '=' in line:
                        value = line.split('=')[1].strip().strip('"').strip(';')
                        if value and '~' in value:
                            fields = value.split('~')
                            if len(fields) > 30:
                                stock_info = {
                                    'code': fields[2],
                                    'name': fields[1],
                                    'change_pct': float(fields[32]) if fields[32] else 0,
                                }
                                stocks_data.append(stock_info)

                result['stocks'] = stocks_data

                # 获取重仓股持仓比例
                try:
                    holdings_url = f'https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code={code}&topline=10&year=&month=&rt=0.{code}'
                    holdings_resp = requests.get(holdings_url, headers=headers, timeout=API_TIMEOUT)
                    rows = re.findall(r'<tr[^>]*>(.*?)</tr>', holdings_resp.text, re.DOTALL)
                    pct_map = {}
                    for row in rows:
                        cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
                        if len(cells) >= 7:
                            code_match = re.search(r'>(\d{6})<', cells[1])
                            pct_match = re.search(r'([\d.]+)%', cells[6])
                            if code_match and pct_match:
                                pct_map[code_match.group(1)] = float(pct_match.group(1))
                    # 合并持仓比例到股票数据
                    for stock in stocks_data:
                        stock['weight'] = pct_map.get(stock['code'], 0)
                except Exception:
                    pass

                # 计算加权涨幅（ETF联接基金已通过 ETF 获取，跳过）
                if stocks_data and not result.get('etf_mode'):
                    # 优先使用真实持仓比例，否则用默认权重
                    has_real_weights = any(s.get('weight', 0) > 0 for s in stocks_data[:10])
                    if has_real_weights:
                        total_change = 0
                        weight_sum = 0
                        for s in stocks_data[:10]:
                            w = s.get('weight', 0) / 100
                            if w > 0:
                                total_change += s['change_pct'] * w
                                weight_sum += w
                        if weight_sum > 0:
                            estimated = (total_change / weight_sum) * result['stock_ratio']
                            result['estimated_change'] = round(estimated, 2)
                    else:
                        weights = [0.15, 0.12, 0.10, 0.08, 0.07, 0.06, 0.05, 0.05, 0.04, 0.04]
                        total_change = 0
                        weight_sum = 0
                        for i, s in enumerate(stocks_data[:10]):
                            weight = weights[i] if i < len(weights) else 0.04
                            total_change += s['change_pct'] * weight
                            weight_sum += weight
                        if weight_sum > 0:
                            estimated = (total_change / weight_sum) * result['stock_ratio']
                            result['estimated_change'] = round(estimated, 2)

        # 获取关联板块涨跌幅
        try:
            # 获取基金关联板块名称
            search_url = f'https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?callback=jQuery&m=1&key={code}'
            search_resp = requests.get(search_url, headers=headers, timeout=API_TIMEOUT)
            search_body = search_resp.text

            search_start = search_body.find('{')
            search_end = search_body.rfind('}') + 1
            if search_start != -1 and search_end > search_start:
                search_json = search_body[search_start:search_end]
                search_data = json.loads(search_json)

                if search_data.get('Datas') and len(search_data['Datas']) > 0:
                    fund_data = search_data['Datas'][0]
                    sector_names = [s.get('TTYPENAME') for s in fund_data.get('ZTJJInfo', []) if s.get('TTYPENAME')]

                    if sector_names:
                        # 优先使用东方财富接口
                        sector_fetched = False
                        try:
                            sector_url = 'https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=100&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=m:90+t:2&fields=f1,f2,f3,f4,f12,f14'
                            sector_resp = requests.get(sector_url, headers=headers, timeout=5)
                            sector_data = sector_resp.json()

                            if sector_data.get('data', {}).get('diff'):
                                for item in sector_data['data']['diff']:
                                    name = item.get('f14', '')
                                    for sector_name in sector_names:
                                        if sector_name in name or name in sector_name:
                                            sector_info = {
                                                'code': item.get('f12'),
                                                'name': name,
                                                'change_pct': item.get('f3'),
                                            }
                                            result['sectors'].append(sector_info)
                                            break
                                sector_fetched = True
                        except Exception:
                            pass

                        # 东方财富接口失败，使用新浪财经接口
                        if not sector_fetched:
                            try:
                                sina_url = 'https://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php'
                                sina_resp = requests.get(sina_url, headers=headers, timeout=API_TIMEOUT)
                                sina_match = re.search(r'=\s*(\{.*\})', sina_resp.text, re.DOTALL)
                                if sina_match:
                                    sina_data = json.loads(sina_match.group(1))

                                    # 板块名称映射表
                                    sector_mapping = {
                                        '电子': ['电子器件', '电子信息'],
                                        'TMT': ['电子信息', '电子器件', '传媒娱乐'],
                                        '医药': ['生物制药', '医疗器械'],
                                        '金融': ['金融行业'],
                                        '消费': ['食品行业', '商业百货', '酿酒行业'],
                                        '科技': ['电子信息', '电子器件', '仪器仪表'],
                                        '新能源': ['电力行业', '电器行业'],
                                        '军工': ['飞机制造', '船舶制造'],
                                        '地产': ['房地产'],
                                        '证券': ['金融行业'],
                                        '银行': ['金融行业'],
                                        '保险': ['金融行业'],
                                    }

                                    matched_sectors = set()
                                    for key, value in sina_data.items():
                                        fields = value.split(',')
                                        if len(fields) >= 6:
                                            name = fields[1]
                                            change_pct = float(fields[5]) if fields[5] else 0

                                            for sector_name in sector_names:
                                                # 直接匹配
                                                if sector_name in name or name in sector_name:
                                                    if name not in matched_sectors:
                                                        result['sectors'].append({
                                                            'code': fields[0],
                                                            'name': name,
                                                            'change_pct': change_pct,
                                                        })
                                                        matched_sectors.add(name)
                                                    break

                                                # 通过映射表匹配
                                                if sector_name in sector_mapping:
                                                    for alias in sector_mapping[sector_name]:
                                                        if alias in name or name in alias:
                                                            if name not in matched_sectors:
                                                                result['sectors'].append({
                                                                    'code': fields[0],
                                                                    'name': name,
                                                                    'change_pct': change_pct,
                                                                })
                                                                matched_sectors.add(name)
                                                            break
                            except Exception as e:
                                logger.warning(f"获取板块数据失败: {e}")
        except Exception as e:
            logger.warning(f"获取关联板块数据失败: {e}")

    except Exception as e:
        logger.warning(f"获取基金估算数据失败: {e}")

    return result


def get_fund_meta(code):
    """获取基金名称与类型，结果缓存 6 小时。"""
    cached = META_CACHE.get(code)
    if cached is not None:
        return cached

    meta = {}
    try:
        response = http_get(SEARCH_URL.format(code=code))
        if response.status_code == 200:
            data = _extract_json(response.text)
            items = (data or {}).get('Datas') or []
            for item in items:
                # 搜索接口会混入股票/债券，只接受代码精确匹配且有基金基础信息的条目
                code_match = str(item.get('CODE') or '') == code or str(item.get('BACKCODE') or '') == code
                base = item.get('FundBaseInfo')
                if not code_match or not isinstance(base, dict) or not base:
                    continue
                meta = {
                    'name': item.get('NAME', ''),
                    'type': base.get('FTYPE', ''),
                }
                break
    except requests.RequestException as exc:
        logger.warning(f"获取基金 {code} 基础信息失败：{exc}")

    META_CACHE.set(code, meta, META_CACHE_TTL if meta.get('name') else 60)
    return meta


def get_fund_nav(code):
    """获取最新披露净值，结果缓存 5 分钟。"""
    cached = NAV_CACHE.get(code)
    if cached is not None:
        return cached

    try:
        response = http_get(TARGET_URL.format(code=code))
    except requests.RequestException as exc:
        raise UpstreamError('数据源连接失败，请稍后重试') from exc

    if response.status_code == 404:
        raise FundNotFoundError(f'未找到基金 {code}，请检查代码是否正确')
    if response.status_code >= 500:
        raise UpstreamError('数据源服务异常，请稍后重试')
    if response.status_code != 200:
        raise UpstreamError('数据源返回异常状态')

    data = _extract_json(response.text)
    if data is None:
        raise UpstreamError('数据解析失败，请稍后重试')
    if data.get('ErrCode') not in (0, '0'):
        raise FundNotFoundError(f'未找到基金 {code}，请检查代码是否正确')

    nav_items = (data.get('Data') or {}).get('LSJZList') or []
    if not nav_items:
        raise FundNotFoundError(f'基金 {code} 暂无净值数据')

    NAV_CACHE.set(code, nav_items[0], NAV_CACHE_TTL)
    return nav_items[0]


def _parse_fast_record(item):
    estimated_nav = _to_float(item.get('GSZ'))
    estimated_change = _to_float(item.get('GSZZL'))
    has_estimate = estimated_nav is not None and estimated_change is not None
    return {
        'code': item.get('FCODE', ''),
        'name': item.get('SHORTNAME', ''),
        'nav': _to_float(item.get('NAV')),
        'nav_date': item.get('PDATE') or '--',
        'nav_change': _to_float(item.get('NAVCHGRT')),
        'estimated_nav': estimated_nav,
        'estimated_change': estimated_change,
        'estimate_time': item.get('GZTIME') or '--',
        'has_estimate': has_estimate,
        'has_realtime': has_estimate,
    }


def get_fast_valuations(codes):
    """批量获取盘中估值，60 秒缓存。上游失败时返回空字典，由调用方降级。"""
    unique_codes = list(dict.fromkeys(c for c in codes if c))
    if not unique_codes:
        return {}

    cache_key = ','.join(sorted(unique_codes))
    cached = FAST_CACHE.get(cache_key)
    if cached is not None:
        return cached

    records = {}
    try:
        response = http_get(FAST_URL.format(codes=cache_key))
        payload = response.json()
        if isinstance(payload, dict) and payload.get('success'):
            for item in payload.get('data') or []:
                record = _parse_fast_record(item)
                if record['code']:
                    records[record['code']] = record
    except (requests.RequestException, ValueError, TypeError) as exc:
        logger.warning(f"批量估值获取失败：{exc}")
        FAST_CACHE.set(cache_key, {}, 15)
        return {}

    FAST_CACHE.set(cache_key, records, FAST_CACHE_TTL)
    return records


def get_fast_valuation(code):
    return get_fast_valuations([code]).get(code)


def _valuation_payload(record):
    """把内部估值记录转换为前端使用的基础字段。"""
    return {
        'code': record.get('code', ''),
        'name': record.get('name', ''),
        'gsz': _fmt_nav(record.get('estimated_nav')),
        'gszzl': _fmt_num(record.get('estimated_change')),
        'jzzzl': _fmt_num(record.get('nav_change')),
        'dwjz': _fmt_nav(record.get('nav')),
        'gztime': record.get('estimate_time') or '--',
        'jzrq': record.get('nav_date') or '--',
        'source': 'tiantian',
        'has_estimate': bool(record.get('has_estimate')),
        'has_realtime': bool(record.get('has_realtime')),
        'estimated_change': record.get('estimated_change'),
    }


def _build_basic_payload(code, meta, fast, nav):
    """合并搜索信息、盘中估值与最新净值。

    gsz 始终表示“当前参考净值”：有估值时为估算净值，否则为最新披露净值。
    """
    meta = meta or {}
    nav = nav or {}
    name = meta.get('name') or (fast or {}).get('name') or ''

    if fast and fast.get('has_estimate'):
        return {
            'code': code,
            'name': name,
            'type': meta.get('type') or '',
            'gsz': _fmt_nav(fast.get('estimated_nav')),
            'gszzl': _fmt_num(fast.get('estimated_change')),
            'jzzzl': _fmt_num(fast.get('nav_change')),
            'gztime': fast.get('estimate_time') or '--',
            'dwjz': _fmt_nav(fast.get('nav')),
            'ljjz': _fmt_nav(nav.get('LJJZ')),
            'jzrq': fast.get('nav_date') or nav.get('FSRQ') or '--',
            'sgzt': nav.get('SGZT') or '--',
            'shzt': nav.get('SHZT') or '--',
            'source': 'tiantian',
            'update_time': fast.get('estimate_time') or '--',
            'has_estimate': True,
            'has_realtime': bool(fast.get('has_realtime', True)),
            'estimated_change': fast.get('estimated_change'),
        }

    return {
        'code': code,
        'name': name,
        'type': meta.get('type') or '',
        'gsz': _fmt_nav(nav.get('DWJZ')),
        'gszzl': _fmt_num(nav.get('JZZZL')),
        'jzzzl': _fmt_num(nav.get('JZZZL')),
        'gztime': nav.get('FSRQ') or '--',
        'dwjz': _fmt_nav(nav.get('DWJZ')),
        'ljjz': _fmt_nav(nav.get('LJJZ')),
        'jzrq': nav.get('FSRQ') or '--',
        'sgzt': nav.get('SGZT') or '--',
        'shzt': nav.get('SHZT') or '--',
        'source': 'eastmoney',
        'update_time': nav.get('FSRQ') or '--',
        'has_estimate': False,
        'has_realtime': False,
        'estimated_change': None,
    }


def get_fund_data(code):
    """获取基金基础数据（不做重仓股等重型抓取）。"""
    _validate_code(code)

    try:
        meta = get_fund_meta(code)
    except Exception as exc:
        logger.warning(f"获取基金 {code} 基础信息异常：{exc}")
        meta = {}

    fast = get_fast_valuation(code)

    nav = None
    nav_error = None
    try:
        nav = get_fund_nav(code)
    except (FundNotFoundError, UpstreamError) as exc:
        nav_error = exc

    # 净值缺失时，只有盘中估值可以独立支撑一条有效记录；否则如实报错，
    # 避免把搜索接口命中的股票当成基金返回全空数据。
    if not nav and not (fast and fast.get('has_estimate')):
        if nav_error is not None:
            raise nav_error
        raise FundNotFoundError(f'未找到基金 {code}，请检查代码是否正确')

    return _build_basic_payload(code, meta, fast, nav)


def get_fund_detail(code):
    """获取基金详情（重仓股、板块、阶段收益等），结果缓存 5 分钟。"""
    cached = DETAIL_CACHE.get(code)
    if cached is not None:
        return cached

    payload = get_fund_data(code)

    try:
        estimate = get_fund_stock_estimate(code)
    except Exception as exc:
        logger.warning(f"获取基金 {code} 详情失败：{exc}")
        estimate = {}

    payload.update({
        'stock_ratio': estimate.get('stock_ratio', 0),
        'top_stocks': (estimate.get('stocks') or [])[:10],
        'sectors': (estimate.get('sectors') or [])[:6],
        'performance': estimate.get('performance') or {},
        'nav_trend': estimate.get('nav_trend'),
        'fund_managers': estimate.get('managers') or [],
        'asset_allocation': estimate.get('asset_allocation'),
    })

    if not payload.get('has_estimate'):
        change = estimate.get('estimated_change')
        latest_nav = _to_float(payload.get('dwjz'))
        if change is not None and latest_nav:
            payload['gsz'] = _fmt_nav(latest_nav * (1 + change / 100))
            payload['gszzl'] = _fmt_num(change)
            payload['estimated_change'] = change
            payload['has_estimate'] = True
            payload['source'] = 'eastmoney_estimate'
            payload['update_time'] = datetime.now(SHANGHAI_TZ).strftime('%Y-%m-%d %H:%M')
            payload['gztime'] = payload['update_time']

    DETAIL_CACHE.set(code, payload, DETAIL_CACHE_TTL)
    return payload


def _run_fund_route(code, loader):
    if not isinstance(code, str) or len(code) != 6 or not code.isdigit():
        return _api_error('无效的基金代码，请输入 6 位数字', 400)
    try:
        return jsonify({'success': True, 'data': loader(code)})
    except ValueError as exc:
        return _api_error(str(exc), 400)
    except FundNotFoundError as exc:
        return _api_error(str(exc), 404)
    except UpstreamError as exc:
        logger.warning(f"上游数据源异常：{exc}")
        return _api_error(str(exc), 502)
    except Exception as exc:
        logger.error(f"获取基金 {code} 数据异常：{str(exc)}\n{traceback.format_exc()}")
        return _api_error('获取数据失败，请稍后重试', 500)


@app.route('/api/fund/<code>', methods=['GET'])
@app.route('/guzhi/api/fund/<code>', methods=['GET'])
def get_single_fund(code):
    """获取基金基础数据（净值与盘中估值）。"""
    return _run_fund_route(code, get_fund_data)


@app.route('/api/fund/<code>/detail', methods=['GET'])
@app.route('/guzhi/api/fund/<code>/detail', methods=['GET'])
def get_fund_detail_route(code):
    """获取基金详情（重仓股、板块、阶段收益、净值走势）。"""
    return _run_fund_route(code, get_fund_detail)


@app.route('/api/funds/batch', methods=['POST', 'OPTIONS'])
@app.route('/guzhi/api/funds/batch', methods=['POST', 'OPTIONS'])
def get_batch_funds():
    """
    批量获取基金数据

    Request Body:
        {
            "codes": ["000001", "000002", ...]
        }

    Returns:
        JSON: 基金数据列表
    """
    # 处理 OPTIONS 预检请求
    if request.method == 'OPTIONS':
        return '', 204

    try:
        data = request.get_json(silent=True) or {}
        codes = data.get('codes', [])

        if not codes or not isinstance(codes, list):
            return jsonify({
                'success': False,
                'error': '请提供基金代码列表'
            }), 400

        # 限制批量请求数量
        if len(codes) > MAX_BATCH_SIZE:
            return jsonify({
                'success': False,
                'error': f'单次最多查询 {MAX_BATCH_SIZE} 只基金'
            }), 400

        # 验证所有基金代码格式
        invalid_codes = [c for c in codes if not isinstance(c, str) or len(c) != 6 or not c.isdigit()]
        if invalid_codes:
            return _api_error(f'以下基金代码格式不正确：{", ".join(map(str, invalid_codes))}', 400)

        codes = list(dict.fromkeys(codes))
        logger.info(f"批量获取 {len(codes)} 只基金的数据...")
        
        # 使用线程池并发请求，提高性能
        results = []
        failed_codes = []
        
        # 设置最大并发数为 5，避免被目标网站限制
        max_workers = min(5, len(codes))
        
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # 提交所有请求
            future_to_code = {executor.submit(get_fund_data, code): code for code in codes}
            
            # 收集结果
            for future in as_completed(future_to_code):
                code = future_to_code[future]
                try:
                    fund_data = future.result()
                    if fund_data:
                        results.append(fund_data)
                    else:
                        failed_codes.append(code)
                except Exception as e:
                    logger.warning(f"获取基金 {code} 失败：{str(e)}")
                    failed_codes.append(code)
        
        logger.info(f"批量获取完成，成功：{len(results)}, 失败：{len(failed_codes)}")
        
        return jsonify({
            'success': len(results) > 0,
            'data': results,
            'failed_codes': failed_codes if failed_codes else None,
            'message': f'成功获取 {len(results)} 只基金数据' + (f'，{len(failed_codes)} 只失败' if failed_codes else '')
        })
        
    except Exception as e:
        logger.error(f"批量获取基金数据异常：{str(e)}\n{traceback.format_exc()}")
        return jsonify({
            'success': False,
            'error': '批量获取数据失败，请稍后重试'
        }), 500


@app.route('/api/funds/fast', methods=['POST', 'OPTIONS'])
@app.route('/guzhi/api/funds/fast', methods=['POST', 'OPTIONS'])
def get_fast_batch_funds():
    """批量获取盘中估值（最多 50 只）。"""
    if request.method == 'OPTIONS':
        return '', 204

    data = request.get_json(silent=True) or {}
    codes = data.get('codes', [])

    if not codes or not isinstance(codes, list):
        return _api_error('请提供基金代码列表', 400)
    if len(codes) > FAST_BATCH_SIZE:
        return _api_error(f'单次最多查询 {FAST_BATCH_SIZE} 只基金', 400)

    invalid_codes = [c for c in codes if not isinstance(c, str) or len(c) != 6 or not c.isdigit()]
    if invalid_codes:
        return _api_error(f'以下基金代码格式不正确：{", ".join(map(str, invalid_codes))}', 400)

    unique_codes = list(dict.fromkeys(codes))
    records = get_fast_valuations(unique_codes)
    results = [_valuation_payload(records[c]) for c in unique_codes if c in records]
    missing = [c for c in unique_codes if c not in records]

    return jsonify({
        'success': bool(results),
        'data': results,
        'failed_codes': missing or None,
        'message': f'成功获取 {len(results)} 只基金数据',
    })


@app.route('/api/trading-status', methods=['GET'])
@app.route('/guzhi/api/trading-status', methods=['GET'])
def get_trading_status():
    """获取上海时区下的 A 股交易状态。"""
    try:
        status = _market_status()
        return jsonify({'success': True, **status})
    except Exception as exc:
        logger.error(f"获取交易状态失败：{exc}\n{traceback.format_exc()}")
        return jsonify({
            'success': False,
            'error': '无法获取交易状态',
            'status': 'unknown',
            'status_text': '无法获取交易状态',
            'is_trading': False,
            'next_open': None,
        }), 500


@app.route('/api/health', methods=['GET'])
@app.route('/guzhi/api/health', methods=['GET'])
def health_check():
    """
    健康检查接口

    Returns:
        JSON: 服务状态
    """
    return jsonify({
        'status': 'ok',
        'message': '基金估值 API 服务运行正常',
        'timestamp': datetime.now(SHANGHAI_TZ).isoformat(),
    })


@app.route('/', methods=['GET'])
@app.route('/guzhi/', methods=['GET'])
def index():
    """
    根路径欢迎信息
    """
    return jsonify({
        'message': '欢迎使用基金估值 API 服务',
        'endpoints': {
            'GET /api/fund/<code>': '基金基础数据',
            'GET /api/fund/<code>/detail': '基金详情',
            'POST /api/funds/fast': '批量盘中估值',
            'POST /api/funds/batch': '批量基金基础数据',
            'GET /api/trading-status': '交易状态',
            'GET /api/health': '健康检查',
        }
    })


if __name__ == '__main__':
    print("=" * 60)
    print("    Fund Valuation API")
    print("=" * 60)
    print("Server : http://localhost:5000")
    print("Health : http://localhost:5000/api/health")
    print("Example: http://localhost:5000/api/fund/000001")
    print("=" * 60)

    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
