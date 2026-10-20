#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
基金估值 API 服务
直接调用天天基金网接口
"""

import logging
import json
import re
import traceback
from flask import Flask, jsonify, request
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, date, timedelta

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# CORS 配置 - 支持多环境
ALLOWED_ORIGINS = ['https://guzhi.itect.me', 'http://localhost:8080', 'http://localhost:5000']

@app.after_request
def add_cors_headers(response):
    origin = request.headers.get('Origin')
    if origin in ALLOWED_ORIGINS:
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
# 天天基金净值接口（替代已废弃的 fundgz 接口）
TARGET_URL = 'https://api.fund.eastmoney.com/f10/lsjz?callback=jQuery&fundCode={code}&pageIndex=1&pageSize=1'
# 基金搜索接口（获取基金名称）
SEARCH_URL = 'https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?callback=jQuery&m=1&key={code}'
MAX_BATCH_SIZE = 20  # 批量请求最大数量


@app.errorhandler(Exception)
def handle_exception(e):
    """
    全局异常处理器，捕获所有未处理的异常
    确保不暴露任何技术细节
    """
    logger.error(f"未处理的异常：{str(e)}\n{traceback.format_exc()}")

    # 检查错误信息是否包含敏感内容
    error_msg = str(e)
    sensitive_keywords = ['fundgz', '1234567.com', 'api.fund.eastmoney']

    if any(keyword in error_msg.lower() for keyword in sensitive_keywords):
        # 包含敏感信息，返回通用错误
        return jsonify({
            'success': False,
            'error': '服务器内部错误，请稍后重试'
        }), 500

    # 不包含敏感信息，返回原始消息
    return jsonify({
        'success': False,
        'error': error_msg if error_msg else '服务器内部错误，请稍后重试'
    }), 500


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


def get_fund_data(code):
    """
    获取基金数据

    Args:
        code (str): 6 位基金代码

    Returns:
        dict: 基金数据

    Raises:
        Exception: 当数据获取失败时抛出友好的错误信息
    """
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Referer': 'https://fund.eastmoney.com/'
        }

        # 第一步：获取基金名称
        fund_name = ''
        fund_type = ''
        search_url = SEARCH_URL.format(code=code)
        try:
            search_resp = requests.get(search_url, headers=headers, timeout=API_TIMEOUT)
            if search_resp.status_code == 200:
                search_body = search_resp.text
                # 解析 JSONP
                start = search_body.find('{')
                end = search_body.rfind('}') + 1
                if start != -1 and end > start:
                    search_json = search_body[start:end]
                    search_data = json.loads(search_json)
                    if search_data.get('Datas') and len(search_data['Datas']) > 0:
                        fund_info = search_data['Datas'][0]
                        fund_name = fund_info.get('NAME', '')
                        base_info = fund_info.get('FundBaseInfo', {})
                        if base_info:
                            fund_type = base_info.get('FTYPE', '')
        except Exception:
            pass

        # 第二步：获取基金净值数据
        url = TARGET_URL.format(code=code)
        response = requests.get(url, headers=headers, timeout=API_TIMEOUT)

        if response.status_code == 404:
            return None
        elif response.status_code >= 500:
            raise Exception('数据源服务异常，请稍后重试')
        elif response.status_code != 200:
            return None

        content = response.text.strip()
        if not content:
            return None

        # 提取 JSON 数据 (格式：jQuery({...}))
        if content.startswith('jQuery(') and content.endswith(')'):
            json_str = content[7:-1]
        else:
            return None

        data = json.loads(json_str)

        if not data or data.get('ErrCode') != 0:
            return None

        lsjz_list = data.get('Data', {}).get('LSJZList', [])
        if not lsjz_list:
            return None

        nav_data = lsjz_list[0]

        # 第三步：获取重仓股估算涨跌幅
        estimate = get_fund_stock_estimate(code)

        # 使用重仓股估算涨跌幅（如果可用）
        estimated_change = estimate.get('estimated_change')
        gszzl = str(estimated_change) if estimated_change is not None else str(nav_data.get('JZZZL', 0))
        jzzzl = str(nav_data.get('JZZZL', 0))  # 净值日期的实际涨跌幅

        result = {
            'code': code,
            'name': fund_name,
            'type': fund_type,
            'gsz': str(nav_data.get('DWJZ', '--')),  # 最新净值
            'gszzl': gszzl,  # 涨跌幅（优先使用估算值）
            'jzzzl': jzzzl,  # 净值日期实际涨跌幅
            'gztime': nav_data.get('FSRQ', '--'),  # 净值日期
            'dwjz': str(nav_data.get('DWJZ', '--')),  # 单位净值
            'ljjz': str(nav_data.get('LJJZ', '--')),  # 累计净值
            'jzrq': nav_data.get('FSRQ', '--'),  # 净值日期
            'sgzt': nav_data.get('SGZT', '--'),  # 申购状态
            'shzt': nav_data.get('SHZT', '--'),  # 赎回状态
            'source': 'eastmoney',
            'update_time': nav_data.get('FSRQ', '--'),  # 数据更新时间
            'has_estimate': estimated_change is not None,  # 是否有估算数据
            'stock_ratio': estimate.get('stock_ratio', 0),  # 股票占净比
            'top_stocks': estimate.get('stocks', []),  # 重仓股（最多10只）
            'sectors': estimate.get('sectors', [])[:6],  # 关联板块涨跌幅
            'performance': estimate.get('performance', {}),  # 收益率数据
            'nav_trend': estimate.get('nav_trend'),  # 净值走势
            'fund_managers': estimate.get('managers', []),  # 基金经理
            'asset_allocation': estimate.get('asset_allocation'),  # 资产配置
        }

        return result

    except requests.exceptions.Timeout:
        raise Exception('请求超时，天天基金网响应较慢，请稍候重试')
    except requests.exceptions.ConnectionError:
        raise Exception('无法连接到数据源，请检查网络')
    except requests.exceptions.RequestException:
        raise Exception('获取数据失败，请检查基金代码是否正确')
    except json.JSONDecodeError:
        raise Exception('数据解析失败，请稍后重试')
    except Exception:
        raise Exception('获取基金数据失败，请稍后重试')


@app.route('/api/fund/<code>', methods=['GET'])
@app.route('/guzhi/api/fund/<code>', methods=['GET'])
def get_single_fund(code):
    """
    获取单个基金数据
    
    Args:
        code (str): 6 位基金代码
        
    Returns:
        JSON: 基金数据
    """
    # 验证基金代码格式
    if not code or not code.isdigit() or len(code) != 6:
        return jsonify({
            'success': False,
            'error': '无效的基金代码，请输入 6 位数字'
        }), 400
    
    try:
        fund_data = get_fund_data(code)
        
        if fund_data:
            return jsonify({
                'success': True,
                'data': fund_data
            })
        else:
            return jsonify({
                'success': False,
                'error': f'未找到基金 {code}，请检查代码是否正确'
            }), 404
            
    except Exception as e:
        logger.error(f"获取基金 {code} 数据异常：{str(e)}\n{traceback.format_exc()}")
        return jsonify({
            'success': False,
            'error': '获取数据失败，请稍后重试'
        }), 500


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
        invalid_codes = [code for code in codes if not code.isdigit() or len(code) != 6]
        if invalid_codes:
            return jsonify({
                'success': False,
                'error': f'以下基金代码格式不正确：{", ".join(invalid_codes)}'
            }), 400
        
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
    """
    快速批量获取基金数据（使用天天基金批量估值接口）

    Request Body:
        {
            "codes": ["000001", "000002", ...]
        }

    Returns:
        JSON: 基金基础数据列表（净值、涨跌幅等）
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
        if len(codes) > 50:
            return jsonify({
                'success': False,
                'error': '单次最多查询 50 只基金'
            }), 400

        # 验证所有基金代码格式
        invalid_codes = [code for code in codes if not code.isdigit() or len(code) != 6]
        if invalid_codes:
            return jsonify({
                'success': False,
                'error': f'以下基金代码格式不正确：{", ".join(invalid_codes)}'
            }), 400

        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://fund.eastmoney.com/'
        }

        # 使用天天基金批量估值接口
        codes_str = ','.join(codes)
        url = f'https://fundcomapi.tiantianfunds.com/mm/newCore/FundValuationLast?FCODES={codes_str}&FIELDS=FCODE,SHORTNAME,GSZZL,GZTIME,GSZ,NAV,PDATE,NAVCHGRT'

        resp = requests.get(url, headers=headers, timeout=API_TIMEOUT)
        data = resp.json()

        results = []
        if data.get('success') and data.get('data'):
            for fund in data['data']:
                fund_code = fund.get('FCODE', '')
                fund_data = {
                    'code': fund_code,
                    'name': fund.get('SHORTNAME', ''),
                    'dwjz': str(fund.get('NAV', '--')),
                    'gszzl': str(fund.get('GSZZL', 0)) if fund.get('GSZZL') is not None else '0',
                    'jzzzl': str(fund.get('NAVCHGRT', 0)) if fund.get('NAVCHGRT') is not None else '0',
                    'gsz': str(fund.get('GSZ', '--')) if fund.get('GSZ') is not None else '--',
                    'gztime': fund.get('GZTIME', '--'),
                    'jzrq': fund.get('PDATE', '--'),
                    'source': 'tiantian'
                }
                results.append(fund_data)

        return jsonify({
            'success': len(results) > 0,
            'data': results,
            'message': f'成功获取 {len(results)} 只基金数据'
        })

    except requests.exceptions.Timeout:
        return jsonify({
            'success': False,
            'error': '请求超时，请稍后重试'
        }), 500
    except Exception as e:
        logger.error(f"快速批量获取基金数据异常：{str(e)}\n{traceback.format_exc()}")
        return jsonify({
            'success': False,
            'error': '获取数据失败，请稍后重试'
        }), 500


@app.route('/api/trading-status', methods=['GET'])
@app.route('/guzhi/api/trading-status', methods=['GET'])
def get_trading_status():
    """
    获取当前交易状态

    Returns:
        JSON: 交易状态信息
    """
    try:
        now = datetime.now()
        current_date = now.date()
        current_time = now.time()
        weekday = now.weekday()  # 0=周一, 6=周日

        # 2024-2025年节假日（可后续更新）
        holidays_2025 = [
            # 元旦
            date(2025, 1, 1),
            # 春节
            date(2025, 1, 28), date(2025, 1, 29), date(2025, 1, 30),
            date(2025, 1, 31), date(2025, 2, 1), date(2025, 2, 2), date(2025, 2, 3),
            # 清明节
            date(2025, 4, 4), date(2025, 4, 5), date(2025, 4, 6),
            # 劳动节
            date(2025, 5, 1), date(2025, 5, 2), date(2025, 5, 3),
            date(2025, 5, 4), date(2025, 5, 5),
            # 端午节
            date(2025, 5, 31), date(2025, 6, 1), date(2025, 6, 2),
            # 中秋节+国庆节
            date(2025, 10, 1), date(2025, 10, 2), date(2025, 10, 3),
            date(2025, 10, 4), date(2025, 10, 5), date(2025, 10, 6), date(2025, 10, 7),
        ]

        holidays_2026 = [
            # 元旦
            date(2026, 1, 1), date(2026, 1, 2), date(2026, 1, 3),
            # 春节
            date(2026, 2, 17), date(2026, 2, 18), date(2026, 2, 19),
            date(2026, 2, 20), date(2026, 2, 21), date(2026, 2, 22), date(2026, 2, 23),
            # 清明节
            date(2026, 4, 5), date(2026, 4, 6), date(2026, 4, 7),
            # 劳动节
            date(2026, 5, 1), date(2026, 5, 2), date(2026, 5, 3),
            # 端午节
            date(2026, 6, 19), date(2026, 6, 20), date(2026, 6, 21),
            # 中秋节
            date(2026, 9, 25), date(2026, 9, 26), date(2026, 9, 27),
            # 国庆节
            date(2026, 10, 1), date(2026, 10, 2), date(2026, 10, 3),
            date(2026, 10, 4), date(2026, 10, 5), date(2026, 10, 6), date(2026, 10, 7),
        ]

        holidays = holidays_2025 + holidays_2026

        # 判断是否为节假日
        is_holiday = current_date in holidays

        # 判断是否为周末
        is_weekend = weekday >= 5

        # 判断是否为交易日
        is_trading_day = not is_holiday and not is_weekend

        # 判断当前时段
        hour = current_time.hour
        minute = current_time.minute
        time_value = hour * 100 + minute

        # A股交易时段：9:30-11:30, 13:00-15:00
        morning_start = 930
        morning_end = 1130
        afternoon_start = 1300
        afternoon_end = 1500

        is_morning_trading = morning_start <= time_value <= morning_end
        is_afternoon_trading = afternoon_start <= time_value <= afternoon_end
        is_trading_time = is_morning_trading or is_afternoon_trading

        # 综合判断：是否正在交易
        is_trading = is_trading_day and is_trading_time

        # 计算下次开盘时间
        next_open = None
        if not is_trading:
            if is_trading_day:
                # 今天是交易日但不在交易时段
                if time_value < morning_start:
                    next_open = f'{current_date} 09:30'
                elif morning_end < time_value < afternoon_start:
                    next_open = f'{current_date} 13:00'
                else:
                    # 今天的交易已结束，找下一个交易日
                    next_date = current_date + timedelta(days=1)
                    while next_date.weekday() >= 5 or next_date in holidays:
                        next_date += timedelta(days=1)
                    next_open = f'{next_date} 09:30'
            else:
                # 今天不是交易日，找下一个交易日
                next_date = current_date + timedelta(days=1)
                while next_date.weekday() >= 5 or next_date in holidays:
                    next_date += timedelta(days=1)
                next_open = f'{next_date} 09:30'

        # 确定市场状态描述
        if is_trading:
            status = 'trading'
            status_text = '交易中'
        elif is_trading_day and not is_trading_time:
            status = 'closed_today'
            status_text = '今日休市（非交易时段）'
        elif is_holiday:
            status = 'holiday'
            status_text = '节假日休市'
        elif is_weekend:
            status = 'weekend'
            status_text = '周末休市'
        else:
            status = 'closed'
            status_text = '休市'

        return jsonify({
            'success': True,
            'status': status,
            'status_text': status_text,
            'is_trading': is_trading,
            'is_trading_day': is_trading_day,
            'is_holiday': is_holiday,
            'is_weekend': is_weekend,
            'current_time': now.strftime('%Y-%m-%d %H:%M:%S'),
            'next_open': next_open,
            'suggested_refresh_interval': 60000 if is_trading else 300000
        })

    except Exception as e:
        logger.error(f"获取交易状态失败：{e}\n{traceback.format_exc()}")
        return jsonify({
            'success': False,
            'error': str(e),
            'status': 'unknown',
            'status_text': '无法获取交易状态',
            'is_trading': False,
            'is_trading_day': False,
            'is_holiday': False,
            'is_weekend': False,
            'current_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'next_open': None,
            'suggested_refresh_interval': 300000
        })


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
        'timestamp': datetime.now().isoformat()
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
            'GET /api/fund/<code>': '获取单个基金数据',
            'GET /guzhi/api/fund/<code>': '获取单个基金数据 (带前缀)',
            'POST /api/funds/batch': '批量获取基金数据',
            'POST /guzhi/api/funds/batch': '批量获取基金数据 (带前缀)',
            'GET /api/health': '健康检查',
            'GET /guzhi/api/health': '健康检查 (带前缀)'
        }
    })


if __name__ == '__main__':
    print("=" * 60)
    print("    基金估值 API 服务")
    print("=" * 60)
    print("🚀 服务启动中...")
    print("📡 监听地址：http://localhost:5000")
    print("📚 API 文档：http://localhost:5000")
    print("💡 示例：http://localhost:5000/api/fund/000001")
    print("=" * 60)
    
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
