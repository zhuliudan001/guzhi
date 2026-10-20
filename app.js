// ========== Constants ==========
function resolveApiBase() {
    const { protocol, hostname, port, pathname } = window.location;
    if (protocol === 'file:') return 'http://localhost:5000/api';
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return port && port !== '5000' ? 'http://localhost:5000/api' : '/api';
    }
    if (pathname === '/guzhi' || pathname.startsWith('/guzhi/')) return '/guzhi/api';
    return '/api';
}

const API_BASE_URL = resolveApiBase();
const {
    calcProfit,
    summarizePortfolio,
    formatChange,
    escapeHtml,
    escapeAttr,
} = AppUtils;
const TRADING_REFRESH_INTERVAL = 60000;  // 交易中：1分钟
const CLOSED_REFRESH_INTERVAL = 300000; // 休市时：5分钟
const MAX_SEARCH_HISTORY = 10;
const MAX_RETRY_COUNT = 2;
let refreshTimer = null;
let refreshTimerInterval = null;
let currentTradingStatus = null;

// ========== Trading Status ==========
async function checkTradingStatus() {
    try {
        const timestamp = Date.now();
        const response = await axios.get(`${API_BASE_URL}/trading-status`, {
            timeout: 5000,
            params: { _t: timestamp }
        });
        currentTradingStatus = response.data;
        updateTradingStatusUI();
        if (refreshTimer && refreshTimerInterval !== getRefreshInterval()) {
            startAutoRefresh();
        }
        return response.data;
    } catch (e) {
        console.warn('获取交易状态失败:', e);
        return null;
    }
}

function updateTradingStatusUI() {
    const statusEl = document.getElementById('tradingStatus');
    if (!statusEl || !currentTradingStatus) return;

    const { status, status_text, is_trading, next_open } = currentTradingStatus;

    let statusClass = 'status-closed';
    let statusIcon = 'moon';

    if (is_trading) {
        statusClass = 'status-trading';
        statusIcon = 'chart-line';
    } else if (status === 'weekend' || status === 'holiday') {
        statusClass = 'status-holiday';
        statusIcon = 'calendar-xmark';
    } else if (status === 'lunch_break' || status === 'pre_open') {
        statusIcon = 'clock';
    }

    statusEl.innerHTML = `
        <span class="status-indicator ${statusClass}">
            ${icon(statusIcon)}
            ${escapeHtml(status_text)}
        </span>
        ${next_open ? `<span class="next-open">下次开盘: ${escapeHtml(next_open)}</span>` : ''}
    `;

    const intervalEl = document.getElementById('refreshInterval');
    if (intervalEl) {
        intervalEl.textContent = is_trading ? '1分钟' : '5分钟';
    }
}

function getRefreshInterval() {
    if (currentTradingStatus && currentTradingStatus.is_trading) {
        return TRADING_REFRESH_INTERVAL;
    }
    return CLOSED_REFRESH_INTERVAL;
}

// ========== SVG Icons ==========
const ICONS = {
    'chart-line': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
    'chart-pie': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>',
    'search': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    'trash-alt': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
    'wallet': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>',
    'star': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
    'sync-alt': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    'sort-amount-down': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="16" y2="12"/><line x1="4" y1="18" x2="12" y2="18"/><polyline points="18 15 21 18 18 21"/><line x1="21" y1="15" x2="21" y2="18"/></svg>',
    'inbox': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
    'bolt': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 10 10-12h-9l1-10z"/></svg>',
    'calculator': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="8" y2="10.01"/><line x1="12" y1="10" x2="12" y2="10.01"/><line x1="16" y1="10" x2="16" y2="10.01"/><line x1="8" y1="14" x2="8" y2="14.01"/><line x1="12" y1="14" x2="12" y2="14.01"/><line x1="16" y1="14" x2="16" y2="14.01"/><line x1="8" y1="18" x2="8" y2="18.01"/><line x1="12" y1="18" x2="16" y2="18"/></svg>',
    'clock': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    'moon': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    'calendar-xmark': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="10" y1="14" x2="14" y2="18"/><line x1="14" y1="14" x2="10" y2="18"/></svg>',
    'edit': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    'info-circle': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    'exclamation-circle': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    'exclamation-triangle': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    'grip-vertical': '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
    'xmark': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
};

function icon(name) {
    return `<span class="svg-icon">${ICONS[name] || ''}</span>`;
}

// ========== Utility Functions ==========
function showToast(message, type = 'info') {
    const old = document.querySelector('.toast');
    if (old) old.remove();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 200); }, 2500);
}

function formatMoney(num) {
    if (num === null || num === undefined || num === '--') return '--';
    const value = parseFloat(num);
    if (!Number.isFinite(value)) return '--';
    return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getStorage(key, def = null) {
    const d = localStorage.getItem(key);
    if (!d) return def;
    try { return JSON.parse(d); } catch { return def; }
}

function setStorage(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
}

// ========== API Functions ==========
async function requestJson(path, config = {}) {
    try {
        const response = await axios.get(`${API_BASE_URL}${path}`, {
            timeout: 20000,
            params: { _t: Date.now() },
            ...config,
        });
        if (!response.data?.success) {
            throw new Error(response.data?.error || '请求失败');
        }
        return response.data.data;
    } catch (error) {
        const serverMessage = error?.response?.data?.error;
        throw new Error(serverMessage || error?.message || '网络请求失败');
    }
}

async function getFundData(code) {
    if (!/^\d{6}$/.test(code)) throw new Error('基金代码必须为6位数字');
    return requestJson(`/fund/${code}`);
}

async function getFundDetail(code) {
    if (!/^\d{6}$/.test(code)) throw new Error('基金代码必须为6位数字');
    return requestJson(`/fund/${code}/detail`, { timeout: 30000 });
}

async function fetchFastValuations(codes) {
    if (!codes.length) return {};
    const response = await axios.post(`${API_BASE_URL}/funds/fast`, { codes }, {
        timeout: 15000,
        headers: { 'Content-Type': 'application/json' },
        params: { _t: Date.now() },
    });
    if (!response.data?.success) {
        throw new Error(response.data?.error || '批量估值获取失败');
    }
    const map = {};
    (response.data.data || []).forEach((item) => { map[item.code] = item; });
    return map;
}

async function fetchFastValuationsChunked(codes) {
    const unique = Array.from(new Set(codes));
    const chunks = [];
    for (let i = 0; i < unique.length; i += 50) {
        chunks.push(unique.slice(i, i + 50));
    }
    const results = await Promise.allSettled(chunks.map(fetchFastValuations));
    const map = {};
    results.forEach((result) => {
        if (result.status === 'fulfilled') Object.assign(map, result.value);
    });
    return map;
}

// ========== Search History ==========
function saveSearchHistory(code, name) {
    let h = getStorage('searchHistory', []);
    h = h.filter(i => i.code !== code);
    h.unshift({ code, name });
    if (h.length > MAX_SEARCH_HISTORY) h = h.slice(0, MAX_SEARCH_HISTORY);
    setStorage('searchHistory', h);
    renderHistory();
}

function renderHistory() {
    const h = getStorage('searchHistory', []);
    const section = document.getElementById('historySection');
    const el = document.getElementById('searchHistory');

    if (!h.length) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    el.innerHTML = h.map(i =>
        `<span class="history-tag" data-code="${i.code}"><code>${i.code}</code>${escapeHtml(i.name)}<span class="history-tag-delete" data-code="${i.code}" title="删除">&times;</span></span>`
    ).join('');

    // 绑定点击搜索事件
    el.querySelectorAll('.history-tag').forEach(t => {
        t.onclick = (e) => {
            // 如果点击的是删除按钮，不触发搜索
            if (e.target.classList.contains('history-tag-delete')) return;
            document.getElementById('fundCode').value = t.dataset.code;
            searchFund();
        };
    });

    // 绑定单个删除事件
    el.querySelectorAll('.history-tag-delete').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            removeSearchHistory(btn.dataset.code);
        };
    });
}

function removeSearchHistory(code) {
    let h = getStorage('searchHistory', []);
    h = h.filter(i => i.code !== code);
    setStorage('searchHistory', h);
    renderHistory();
}

function clearSearchHistory() {
    setStorage('searchHistory', []);
    renderHistory();
    showToast('已清空搜索历史', 'success');
}

// ========== Search Fund ==========
let searchRequestId = 0;

function renderFundResult(fund) {
    const ch = formatChange(fund.gszzl);
    const hasEstimate = !!fund.has_estimate;
    const changeLabel = hasEstimate ? '估算涨幅' : '日涨跌';
    const changeValue = hasEstimate ? `${fund.gszzl}%` : ch.value;
    const realtimeTag = fund.has_estimate
        ? `<span style="background: var(--green-50); color: var(--green-600); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; margin-left: 0.5rem;">${icon('bolt')} 盘中估值</span>`
        : `<span style="background: var(--gray-100); color: var(--gray-500); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; margin-left: 0.5rem;">${icon('clock')} 最新净值</span>`;

    const sectors = Array.isArray(fund.sectors) ? fund.sectors : [];
    const topStocks = Array.isArray(fund.top_stocks) ? fund.top_stocks : [];
    const performance = fund.performance || {};

    const sectorsHtml = sectors.length ? `
        <div style="padding: 0.75rem 1.5rem; border-top: 1px solid var(--gray-100);">
            <div style="font-size: 0.8125rem; color: var(--gray-500); margin-bottom: 0.5rem;">关联板块</div>
            <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                ${sectors.map(s => {
                    const cls = s.change_pct > 0 ? 'positive' : (s.change_pct < 0 ? 'negative' : 'neutral');
                    return `<span style="padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; background: var(--gray-50); border: 1px solid var(--gray-200);">
                        ${escapeHtml(s.name)} <span class="${cls}">${s.change_pct > 0 ? '+' : ''}${escapeHtml(s.change_pct)}%</span>
                    </span>`;
                }).join('')}
            </div>
        </div>
    ` : '';

    const stocksHtml = topStocks.length ? `
        <div style="padding: 0.75rem 1.5rem; border-top: 1px solid var(--gray-100);">
            <div style="font-size: 0.8125rem; color: var(--gray-500); margin-bottom: 0.5rem;">重仓股</div>
            <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                ${topStocks.map(s => {
                    const cls = s.change_pct > 0 ? 'positive' : (s.change_pct < 0 ? 'negative' : 'neutral');
                    return `<span style="padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; background: var(--gray-50); border: 1px solid var(--gray-200);">
                        ${escapeHtml(s.name)} <span class="${cls}">${s.change_pct > 0 ? '+' : ''}${escapeHtml(s.change_pct)}%</span>
                    </span>`;
                }).join('')}
            </div>
        </div>
    ` : '';

    const performanceHtml = (performance.year || performance.quarter) ? `
        <div style="padding: 0.75rem 1.5rem; border-top: 1px solid var(--gray-100);">
            <div style="font-size: 0.8125rem; color: var(--gray-500); margin-bottom: 0.5rem;">阶段收益</div>
            <div style="display: flex; flex-wrap: wrap; gap: 1rem; font-size: 0.8125rem;">
                ${performance.month ? `<span>近1月: <span class="${performance.month > 0 ? 'positive' : 'negative'}">${performance.month > 0 ? '+' : ''}${performance.month}%</span></span>` : ''}
                ${performance.quarter ? `<span>近3月: <span class="${performance.quarter > 0 ? 'positive' : 'negative'}">${performance.quarter > 0 ? '+' : ''}${performance.quarter}%</span></span>` : ''}
                ${performance.half_year ? `<span>近6月: <span class="${performance.half_year > 0 ? 'positive' : 'negative'}">${performance.half_year > 0 ? '+' : ''}${performance.half_year}%</span></span>` : ''}
                ${performance.year ? `<span>近1年: <span class="${performance.year > 0 ? 'positive' : 'negative'}">${performance.year > 0 ? '+' : ''}${performance.year}%</span></span>` : ''}
            </div>
        </div>
    ` : '';

    document.getElementById('fundInfo').innerHTML = `
        <div class="result-card">
            <div class="result-header">
                <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 0.25rem;">
                    <div class="result-name">${escapeHtml(fund.name || '')}</div>
                    ${realtimeTag}
                </div>
                <div class="result-code">${escapeHtml(fund.code || '')} ${fund.type ? '· ' + escapeHtml(fund.type) : ''}</div>
            </div>
            <div class="result-grid">
                <div class="result-item">
                    <div class="result-label">${hasEstimate ? '估算净值' : '最新净值'}</div>
                    <div class="result-value">${escapeHtml(fund.gsz || '--')}</div>
                </div>
                <div class="result-item">
                    <div class="result-label">${changeLabel}</div>
                    <div class="result-value ${ch.cls}">${escapeHtml(changeValue)}</div>
                </div>
                <div class="result-item">
                    <div class="result-label">净值日期</div>
                    <div class="result-value">${escapeHtml(fund.jzrq || '--')}</div>
                </div>
                <div class="result-item">
                    <div class="result-label">累计净值</div>
                    <div class="result-value">${escapeHtml(fund.ljjz || '--')}</div>
                </div>
            </div>
            <div style="padding: 0.75rem 1.5rem; background: var(--gray-50); border-top: 1px solid var(--gray-100); display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;">
                <span style="font-size: 0.8125rem; color: var(--gray-500);">
                    ${icon('clock')} ${hasEstimate ? '估值时间' : '净值日期'}：${escapeHtml(fund.update_time || '--')}
                </span>
                <span style="font-size: 0.8125rem; color: var(--gray-500);">
                    申购：${escapeHtml(fund.sgzt || '--')} | 赎回：${escapeHtml(fund.shzt || '--')}
                </span>
            </div>
            ${sectorsHtml}
            ${stocksHtml}
            ${performanceHtml}
            <div class="result-actions">
                <button id="addToFavoritesBtn" class="btn btn-success" data-code="${escapeAttr(fund.code)}" data-name="${escapeAttr(fund.name)}">
                    ${icon('star')}添加到自选
                </button>
                <button id="editPositionBtn" class="btn btn-secondary">
                    ${icon('edit')}编辑持仓
                </button>
                <button id="viewDetailBtn" class="btn btn-secondary">
                    ${icon('info-circle')}查看详情
                </button>
            </div>
        </div>
    `;

    document.getElementById('addToFavoritesBtn')?.addEventListener('click', addToFavorites);
    document.getElementById('editPositionBtn')?.addEventListener('click', () => {
        const favs = getStorage('fundFavorites', []);
        const fav = favs.find(x => x.code === fund.code);
        editPosition(fund.code, fund.name, fav?.position || 0);
    });
    document.getElementById('viewDetailBtn')?.addEventListener('click', () => showFundDetail(fund.code));
}

async function searchFund() {
    const code = document.getElementById('fundCode').value.trim();
    if (!/^\d{6}$/.test(code)) { showToast('请输入 6 位基金代码', 'error'); return; }

    const requestId = ++searchRequestId;
    const resultSection = document.getElementById('fundResult');
    resultSection.style.display = 'block';
    document.getElementById('fundInfo').innerHTML = `
        <div class="result-card">
            <div class="result-header">
                <div class="skeleton" style="height: 1.5rem; width: 30%; margin-bottom: 0.375rem;"></div>
                <div class="skeleton" style="height: 1rem; width: 15%;"></div>
            </div>
            <div class="result-grid">
                <div class="result-item"><div class="skeleton" style="height: 2.5rem;"></div></div>
                <div class="result-item"><div class="skeleton" style="height: 2.5rem;"></div></div>
                <div class="result-item"><div class="skeleton" style="height: 2.5rem;"></div></div>
                <div class="result-item"><div class="skeleton" style="height: 2.5rem;"></div></div>
            </div>
        </div>
    `;

    try {
        const fund = await getFundData(code);
        if (requestId !== searchRequestId) return;

        renderFundResult(fund);
        sessionStorage.setItem('currentFundData', JSON.stringify(fund));
        saveSearchHistory(code, fund.name);
        showToast(fund.has_estimate ? '估值获取成功' : '查询成功', 'success');

        getFundDetail(code).then((detail) => {
            if (requestId !== searchRequestId) return;
            const merged = { ...fund, ...detail };
            sessionStorage.setItem('currentFundData', JSON.stringify(merged));
            renderFundResult(merged);
        }).catch((error) => {
            console.warn('基金详情加载失败:', error);
        });
    } catch (e) {
        if (requestId !== searchRequestId) return;
        document.getElementById('fundInfo').innerHTML = `
            <div class="empty" style="padding: 2rem;">
                <div class="empty-icon" style="color: var(--red-500);">${icon('exclamation-circle')}</div>
                <p class="empty-title">${escapeHtml(e.message || '查询失败')}</p>
            </div>
        `;
    }
}

// ========== Fund Detail Dialog ==========
let fundDetailChart = null;

async function showFundDetail(code) {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-backdrop';
    overlay.innerHTML = `
        <div class="dialog dialog-large" role="dialog" aria-modal="true" aria-labelledby="fundDetailTitle">
            <div class="dialog-header">
                <button class="dialog-close" id="closeFundDetailTop" type="button" aria-label="关闭" title="关闭">${icon('xmark')}</button>
                <div class="dialog-icon info">${icon('chart-line')}</div>
                <h3 class="dialog-title" id="fundDetailTitle">基金详情</h3>
                <p class="dialog-desc">正在加载...</p>
            </div>
            <div class="fund-detail-body" id="fundDetailContent">
                <div class="skeleton" style="height: 200px;"></div>
            </div>
            <div class="dialog-footer">
                <button class="btn btn-secondary" id="closeFundDetail">关闭</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const close = () => {
        if (fundDetailChart) { fundDetailChart.destroy(); fundDetailChart = null; }
        overlay.remove();
        document.body.style.overflow = '';
        document.removeEventListener('keydown', onKeydown);
    };
    const onKeydown = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKeydown);
    overlay.querySelector('#closeFundDetail').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.closest('#closeFundDetailTop')) close();
    });

    try {
        const fund = await getFundDetail(code);
        const ch = formatChange(fund.gszzl);
        const jzCh = formatChange(fund.jzzzl || 0);
        const stockPct = fund.stock_ratio ? (fund.stock_ratio * 100) : 0;
        const bondPct = fund.asset_allocation ? fund.asset_allocation.bond : 0;
        const cashPct = fund.asset_allocation ? fund.asset_allocation.cash : 0;
        const otherPct = Math.max(0, 100 - stockPct - bondPct - cashPct);

        document.getElementById('fundDetailContent').innerHTML = `
            <div class="fund-detail-grid">
                <div class="fund-detail-item">
                    <div class="fund-detail-label">${fund.has_estimate ? '估算净值' : '最新净值'}</div>
                    <div class="fund-detail-value">${escapeHtml(fund.gsz || fund.dwjz || '--')}</div>
                </div>
                <div class="fund-detail-item">
                    <div class="fund-detail-label">${fund.has_estimate ? '估算涨跌' : '日涨跌'}</div>
                    <div class="fund-detail-value ${ch.cls}">${escapeHtml(ch.value)}</div>
                </div>
                <div class="fund-detail-item">
                    <div class="fund-detail-label">最新净值</div>
                    <div class="fund-detail-value">${escapeHtml(fund.dwjz || '--')}</div>
                </div>
                <div class="fund-detail-item">
                    <div class="fund-detail-label">日涨跌</div>
                    <div class="fund-detail-value ${jzCh.cls}">${escapeHtml(jzCh.value)}</div>
                </div>
                <div class="fund-detail-item">
                    <div class="fund-detail-label">累计净值</div>
                    <div class="fund-detail-value">${escapeHtml(fund.ljjz || '--')}</div>
                </div>
                <div class="fund-detail-item">
                    <div class="fund-detail-label">净值日期</div>
                    <div class="fund-detail-value">${escapeHtml(fund.jzrq || '--')}</div>
                </div>
                <div class="fund-detail-item">
                    <div class="fund-detail-label">申购状态</div>
                    <div class="fund-detail-value">${escapeHtml(fund.sgzt || '--')}</div>
                </div>
                <div class="fund-detail-item">
                    <div class="fund-detail-label">赎回状态</div>
                    <div class="fund-detail-value">${escapeHtml(fund.shzt || '--')}</div>
                </div>
            </div>

            ${fund.nav_trend && fund.nav_trend.dates && fund.nav_trend.dates.length > 5 ? `
                <div class="fund-detail-section">
                    <div class="fund-detail-section-title">净值走势（近${fund.nav_trend.dates.length}个交易日）</div>
                    <div class="detail-chart-container">
                        <canvas id="navTrendChart"></canvas>
                    </div>
                </div>
            ` : ''}

            ${fund.asset_allocation ? `
                <div class="fund-detail-section">
                    <div class="fund-detail-section-title">资产配置</div>
                    <div class="asset-bars">
                        <div class="asset-bar-row">
                            <span class="asset-label">股票</span>
                            <div class="asset-bar-track"><div class="asset-bar-fill stock" style="width: ${stockPct}%"></div></div>
                            <span class="asset-value">${stockPct.toFixed(1)}%</span>
                        </div>
                        <div class="asset-bar-row">
                            <span class="asset-label">债券</span>
                            <div class="asset-bar-track"><div class="asset-bar-fill bond" style="width: ${bondPct}%"></div></div>
                            <span class="asset-value">${bondPct.toFixed(1)}%</span>
                        </div>
                        <div class="asset-bar-row">
                            <span class="asset-label">现金</span>
                            <div class="asset-bar-track"><div class="asset-bar-fill cash" style="width: ${cashPct}%"></div></div>
                            <span class="asset-value">${cashPct.toFixed(1)}%</span>
                        </div>
                        ${otherPct > 0 ? `
                        <div class="asset-bar-row">
                            <span class="asset-label">其他</span>
                            <div class="asset-bar-track"><div class="asset-bar-fill other" style="width: ${otherPct}%"></div></div>
                            <span class="asset-value">${otherPct.toFixed(1)}%</span>
                        </div>
                        ` : ''}
                    </div>
                </div>
            ` : ''}

            ${fund.performance && (fund.performance.year || fund.performance.quarter) ? `
                <div class="fund-detail-section">
                    <div class="fund-detail-section-title">阶段收益</div>
                    <div class="fund-detail-grid">
                        <div class="fund-detail-item">
                            <div class="fund-detail-label">近1月</div>
                            <div class="fund-detail-value ${fund.performance.month > 0 ? 'positive' : 'negative'}">${fund.performance.month ? (fund.performance.month > 0 ? '+' : '') + fund.performance.month + '%' : '--'}</div>
                        </div>
                        <div class="fund-detail-item">
                            <div class="fund-detail-label">近3月</div>
                            <div class="fund-detail-value ${fund.performance.quarter > 0 ? 'positive' : 'negative'}">${fund.performance.quarter ? (fund.performance.quarter > 0 ? '+' : '') + fund.performance.quarter + '%' : '--'}</div>
                        </div>
                        <div class="fund-detail-item">
                            <div class="fund-detail-label">近6月</div>
                            <div class="fund-detail-value ${fund.performance.half_year > 0 ? 'positive' : 'negative'}">${fund.performance.half_year ? (fund.performance.half_year > 0 ? '+' : '') + fund.performance.half_year + '%' : '--'}</div>
                        </div>
                        <div class="fund-detail-item">
                            <div class="fund-detail-label">近1年</div>
                            <div class="fund-detail-value ${fund.performance.year > 0 ? 'positive' : 'negative'}">${fund.performance.year ? (fund.performance.year > 0 ? '+' : '') + fund.performance.year + '%' : '--'}</div>
                        </div>
                    </div>
                </div>
            ` : ''}

            ${fund.top_stocks && fund.top_stocks.length > 0 ? `
                <div class="fund-detail-section">
                    <div class="fund-detail-section-title">重仓股 (${fund.top_stocks.length}只)</div>
                    <div class="stock-table">
                        <div class="stock-table-header">
                            <span>名称</span><span>代码</span><span>持仓</span><span>涨跌幅</span>
                        </div>
                        ${fund.top_stocks.map(s => {
                            const cls = s.change_pct > 0 ? 'positive' : (s.change_pct < 0 ? 'negative' : 'neutral');
                            const weight = s.weight ? s.weight.toFixed(2) + '%' : '--';
                            return `<div class="stock-table-row">
                                <span class="stock-name">${escapeHtml(s.name)}</span>
                                <span class="stock-code">${escapeHtml(s.code)}</span>
                                <span class="stock-weight">${weight}</span>
                                <span class="${cls}">${s.change_pct > 0 ? '+' : ''}${escapeHtml(s.change_pct)}%</span>
                            </div>`;
                        }).join('')}
                    </div>
                </div>
            ` : ''}

            ${fund.sectors && fund.sectors.length > 0 ? `
                <div class="fund-detail-section">
                    <div class="fund-detail-section-title">关联板块</div>
                    <div class="fund-detail-tags">
                        ${fund.sectors.map(s => {
                            const cls = s.change_pct > 0 ? 'positive' : (s.change_pct < 0 ? 'negative' : 'neutral');
                            return `<span class="fund-detail-tag">${escapeHtml(s.name)} <span class="${cls}">${s.change_pct > 0 ? '+' : ''}${s.change_pct}%</span></span>`;
                        }).join('')}
                    </div>
                </div>
            ` : ''}

            ${fund.fund_managers && fund.fund_managers.length > 0 ? `
                <div class="fund-detail-section">
                    <div class="fund-detail-section-title">基金经理</div>
                    <div class="manager-list">
                        ${fund.fund_managers.map(m => `
                            <div class="manager-item">
                                <div class="manager-avatar">${escapeHtml((m.name || '?')[0])}</div>
                                <div>
                                    <div class="manager-name">${escapeHtml(m.name)}</div>
                                    <div class="manager-info">任职起始: ${escapeHtml(m.start_date || '--')}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
        `;

        // 更新头部信息
        const header = overlay.querySelector('.dialog-header');
        header.innerHTML = `
            <button class="dialog-close" id="closeFundDetailTop" type="button" aria-label="关闭" title="关闭">${icon('xmark')}</button>
            <div class="fund-detail-header">
                <div class="fund-detail-header-icon">${icon('chart-line')}</div>
                <div class="fund-detail-header-info">
                    <div class="fund-detail-header-name">${escapeHtml(fund.name)}</div>
                    <div class="fund-detail-header-meta">
                        <span class="fund-detail-header-code">${fund.code}</span>
                        ${fund.type ? `<span class="fund-detail-header-type">${escapeHtml(fund.type)}</span>` : ''}
                    </div>
                </div>
            </div>
        `;

        // 渲染净值走势图
        if (fund.nav_trend && fund.nav_trend.dates && fund.nav_trend.dates.length > 5) {
            renderNavTrendChart(fund.nav_trend);
        }
    } catch (e) {
        document.getElementById('fundDetailContent').innerHTML = `
            <div class="empty" style="padding: 1rem;">
                <p class="empty-title">${e.message || '加载失败'}</p>
            </div>
        `;
    }
}

function renderNavTrendChart(navTrend) {
    const canvas = document.getElementById('navTrendChart');
    if (!canvas) return;

    if (fundDetailChart) {
        fundDetailChart.destroy();
        fundDetailChart = null;
    }

    const labels = navTrend.dates.map(ts => {
        const d = new Date(ts);
        return `${d.getMonth() + 1}/${d.getDate()}`;
    });
    const values = navTrend.values;

    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const padding = (maxVal - minVal) * 0.1 || 0.01;

    fundDetailChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 1.5,
                pointRadius: 0,
                pointHoverRadius: 4,
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: (ctx) => `净值: ${ctx.parsed.y.toFixed(4)}`
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    grid: { display: false },
                    ticks: {
                        maxTicksLimit: 8,
                        font: { size: 10 },
                        color: '#9ca3af'
                    }
                },
                y: {
                    display: true,
                    min: minVal - padding,
                    max: maxVal + padding,
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: {
                        font: { size: 10 },
                        color: '#9ca3af',
                        callback: (v) => v.toFixed(2)
                    }
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            }
        }
    });
}

// ========== Favorites ==========
const fundViewCache = new Map();

function addToFavorites() {
    const btn = document.getElementById('addToFavoritesBtn');
    const code = btn?.dataset.code;
    const name = btn?.dataset.name;
    if (!code) { showToast('请先查询', 'error'); return; }

    let favs = getStorage('fundFavorites', []);
    if (favs.find(f => f.code === code)) { showToast('已在自选中', 'info'); return; }

    favs.push({ code, name, position: 0 });
    setStorage('fundFavorites', favs);
    showToast('添加成功', 'success');

    // 只追加新行，不刷新整个列表
    const tbody = document.getElementById('favoritesList');
    const cards = document.getElementById('favoritesCardList');
    const empty = document.getElementById('emptyFavorites');
    empty.style.display = 'none';

    // 隐藏空状态，显示表格容器
    tbody.closest('.table-wrap').style.display = '';

    const newRowHtml = `
        <tr data-code="${code}">
            <td>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <button class="icon-btn drag-handle" title="拖拽排序">${icon('grip-vertical')}</button>
                    <div>
                        <span class="fund-name-cell">${escapeHtml(name)}</span>
                        <span class="fund-code-tag">${code}</span>
                    </div>
                </div>
            </td>
            <td class="text-right mono"><div class="skeleton" style="height: 1.25rem; width: 60px; margin-left: auto;"></div></td>
            <td class="text-right"><div class="skeleton" style="height: 1.25rem; width: 50px; margin-left: auto;"></div></td>
            <td class="text-right"><div class="skeleton" style="height: 1.25rem; width: 50px; margin-left: auto;"></div></td>
            <td style="color: var(--gray-500); font-size: 0.875rem;"><div class="skeleton" style="height: 1.25rem; width: 70px;"></div></td>
            <td class="text-right profit-cell"><div class="skeleton" style="height: 1.25rem; width: 60px; margin-left: auto;"></div></td>
            <td class="text-center">
                <div class="action-group">
                    <button class="icon-btn" data-code="${code}" title="刷新">${icon('sync-alt')}</button>
                    <button class="icon-btn detail-btn" data-code="${code}" title="查看详情">${icon('chart-line')}</button>
                    <button class="icon-btn" data-code="${code}" data-name="${escapeAttr(name)}" data-pos="0" title="编辑持仓">${icon('edit')}</button>
                    <button class="icon-btn danger" data-code="${code}" title="移除">${icon('trash-alt')}</button>
                </div>
            </td>
        </tr>
    `;

    const newCardHtml = `
        <div class="mobile-card" data-code="${code}">
            <div class="mobile-card-top">
                <div style="display: flex; align-items: flex-start; gap: 0.5rem;">
                    <button class="icon-btn drag-handle" title="拖拽排序" style="margin-top: 2px;">${icon('grip-vertical')}</button>
                    <div>
                        <div class="mobile-card-name">${escapeHtml(name)}</div>
                        <div class="mobile-card-code">${code}</div>
                    </div>
                </div>
                <div class="action-group">
                    <button class="icon-btn" data-code="${code}" title="刷新">${icon('sync-alt')}</button>
                    <button class="icon-btn detail-btn" data-code="${code}" title="查看详情">${icon('chart-line')}</button>
                    <button class="icon-btn" data-code="${code}" data-name="${escapeAttr(name)}" data-pos="0">${icon('edit')}</button>
                    <button class="icon-btn danger" data-code="${code}">${icon('trash-alt')}</button>
                </div>
            </div>
            <div class="mobile-card-grid">
                <div>
                    <div class="mobile-stat-label">净值</div>
                    <div class="mobile-stat-value"><div class="skeleton" style="height: 1rem; width: 50px;"></div></div>
                </div>
                <div>
                    <div class="mobile-stat-label">估算涨幅</div>
                    <div class="mobile-stat-value"><div class="skeleton" style="height: 1rem; width: 40px;"></div></div>
                </div>
                <div>
                    <div class="mobile-stat-label">日涨跌</div>
                    <div class="mobile-stat-value"><div class="skeleton" style="height: 1rem; width: 40px;"></div></div>
                </div>
                <div>
                    <div class="mobile-stat-label">收益</div>
                    <div class="mobile-stat-value"><div class="skeleton" style="height: 1rem; width: 50px;"></div></div>
                </div>
            </div>
        </div>
    `;

    tbody.insertAdjacentHTML('beforeend', newRowHtml);
    cards.insertAdjacentHTML('beforeend', newCardHtml);

    // 按钮统一由 bindFavoriteEvents 的事件委托处理

    // 只请求新添加的基金数据
    getFundData(code).then(data => {
        const fundData = toFundViewModel({ code, name }, data, 0);
        fundViewCache.set(code, fundData);
        updateFundRow(fundData, favs.length - 1);
        updateFundCard(fundData, favs.length - 1);
        renderSummary(Array.from(fundViewCache.values()));
    }).catch(() => {
        const failedData = { code, name, position: 0, dwjz: '--', gszzl: 0, jzzzl: 0, jzrq: '--', failed: true };
        fundViewCache.set(code, failedData);
        updateFundRow(failedData, favs.length - 1);
        updateFundCard(failedData, favs.length - 1);
        renderSummary(Array.from(fundViewCache.values()));
    });
}

function removeFromFavorites(code) {
    showDialog({
        type: 'danger',
        title: '确认移除',
        desc: '从自选中移除这只基金？',
        confirmText: '移除',
        onConfirm: () => {
            let favs = getStorage('fundFavorites', []);
            setStorage('fundFavorites', favs.filter(f => f.code !== code));
            fundViewCache.delete(code);
            renderSummary(Array.from(fundViewCache.values()));

            // 直接移除 DOM 元素，不刷新整个列表
            const row = document.querySelector(`#favoritesList tr[data-code="${code}"]`);
            const card = document.querySelector(`#favoritesCardList .mobile-card[data-code="${code}"]`);

            if (row) {
                row.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
                row.style.opacity = '0';
                row.style.transform = 'translateX(-20px)';
                setTimeout(() => row.remove(), 200);
            }
            if (card) {
                card.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
                card.style.opacity = '0';
                card.style.transform = 'translateX(-20px)';
                setTimeout(() => card.remove(), 200);
            }

            // 如果列表为空，显示空状态
            setTimeout(() => {
                const remaining = getStorage('fundFavorites', []);
                if (!remaining.length) {
                    document.getElementById('emptyFavorites').style.display = '';
                    document.getElementById('favoritesList').innerHTML = '';
                    document.getElementById('favoritesCardList').innerHTML = '';
                    document.getElementById('summarySection').style.display = 'none';
                }
            }, 250);

            showToast('已移除', 'info');
        }
    });
}

function editPosition(code, name, current = 0) {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-backdrop';
    overlay.innerHTML = `
        <div class="dialog">
            <div class="dialog-header">
                <div class="dialog-icon info">${icon('edit')}</div>
                <h3 class="dialog-title">编辑持仓</h3>
                <p class="dialog-desc">${escapeHtml(name)} (${code})</p>
            </div>
            <div class="dialog-body">
                <input type="number" id="posInput" class="dialog-input" placeholder="持仓金额（元）" value="${current > 0 ? current.toFixed(2) : ''}" step="0.01" min="0">
            </div>
            <div class="dialog-footer">
                <button class="btn btn-secondary" id="cancelPos">取消</button>
                <button class="btn btn-primary" id="savePos">保存</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#posInput');
    input.focus();

    overlay.querySelector('#cancelPos').onclick = () => overlay.remove();
    overlay.querySelector('#savePos').onclick = () => {
        const val = parseFloat(input.value) || 0;
        let favs = getStorage('fundFavorites', []);
        const idx = favs.findIndex(f => f.code === code);
        if (idx !== -1) { favs[idx].position = val; setStorage('fundFavorites', favs); }
        overlay.remove();
        showToast('已保存', 'success');
        renderFavorites();
    };
    input.onkeypress = (e) => { if (e.key === 'Enter') overlay.querySelector('#savePos').click(); };
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}

function showDialog({ type, title, desc, confirmText, onConfirm }) {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-backdrop';
    overlay.innerHTML = `
        <div class="dialog">
            <div class="dialog-header">
                <div class="dialog-icon ${type}">${icon(type === 'danger' ? 'exclamation-triangle' : 'info-circle')}</div>
                <h3 class="dialog-title">${title}</h3>
                <p class="dialog-desc">${desc}</p>
            </div>
            <div class="dialog-footer" style="padding-top: 1.25rem;">
                <button class="btn btn-secondary" id="cancelDlg">取消</button>
                <button class="btn ${type === 'danger' ? 'btn-danger-outline' : 'btn-primary'}" id="confirmDlg">${confirmText}</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#cancelDlg').onclick = () => overlay.remove();
    overlay.querySelector('#confirmDlg').onclick = () => { overlay.remove(); onConfirm(); };
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}

function renderSummary(fundList) {
    const section = document.getElementById('summarySection');
    const grid = document.getElementById('summaryGrid');
    const summary = summarizePortfolio(fundList);

    if (!summary.count) {
        section.style.display = 'none';
        return;
    }

    const profitClass = summary.totalProfit >= 0 ? 'positive' : 'negative';

    section.style.display = 'block';
    grid.innerHTML = `
        <div class="summary-item">
            <div class="summary-label">总投入</div>
            <div class="summary-value">¥${formatMoney(summary.totalPosition)}</div>
        </div>
        <div class="summary-item">
            <div class="summary-label">估算市值</div>
            <div class="summary-value">¥${formatMoney(summary.totalMarketValue)}</div>
        </div>
        <div class="summary-item">
            <div class="summary-label">估算收益</div>
            <div class="summary-value ${profitClass}">¥${formatMoney(summary.totalProfit)}</div>
            <div class="summary-change ${profitClass}">${summary.totalProfitRate >= 0 ? '+' : ''}${summary.totalProfitRate.toFixed(2)}%</div>
        </div>
        <div class="summary-item">
            <div class="summary-label">持仓数量</div>
            <div class="summary-value">${summary.count} 只</div>
            <div class="summary-change">${summary.estimatedCount} 只有盘中估值</div>
        </div>
    `;
}

function renderFavorites() {
    const favs = getStorage('fundFavorites', []);
    const tbody = document.getElementById('favoritesList');
    const cards = document.getElementById('favoritesCardList');
    const empty = document.getElementById('emptyFavorites');

    if (!favs.length) {
        tbody.innerHTML = '';
        cards.innerHTML = '';
        empty.style.display = 'block';
        document.getElementById('summarySection').style.display = 'none';
        return;
    }
    empty.style.display = 'none';

    // 检查是否已有数据（判断是否首次加载）
    const hasExistingData = tbody.querySelector('tr[data-code]') && !tbody.querySelector('.skeleton');

    // 首次加载时显示骨架屏
    if (!hasExistingData) {
        tbody.innerHTML = favs.map(f => `
            <tr data-code="${f.code}">
                <td>
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <button class="icon-btn drag-handle" title="拖拽排序">${icon('grip-vertical')}</button>
                        <div>
                            <span class="fund-name-cell">${escapeHtml(f.name)}</span>
                            <span class="fund-code-tag">${f.code}</span>
                        </div>
                    </div>
                </td>
                <td class="text-right mono"><div class="skeleton" style="height: 1.25rem; width: 60px; margin-left: auto;"></div></td>
                <td class="text-right"><div class="skeleton" style="height: 1.25rem; width: 50px; margin-left: auto;"></div></td>
                <td class="text-right"><div class="skeleton" style="height: 1.25rem; width: 50px; margin-left: auto;"></div></td>
                <td style="color: var(--gray-500); font-size: 0.875rem;"><div class="skeleton" style="height: 1.25rem; width: 70px;"></div></td>
                <td class="text-right profit-cell"><div class="skeleton" style="height: 1.25rem; width: 60px; margin-left: auto;"></div></td>
                <td class="text-center">
                    <div class="action-group">
                        <button class="icon-btn" data-code="${f.code}" title="刷新">${icon('sync-alt')}</button>
                        <button class="icon-btn detail-btn" data-code="${f.code}" title="查看详情">${icon('chart-line')}</button>
                        <button class="icon-btn" data-code="${f.code}" data-name="${escapeAttr(f.name)}" data-pos="${f.position || 0}" title="编辑持仓">${icon('edit')}</button>
                        <button class="icon-btn danger" data-code="${f.code}" title="移除">${icon('trash-alt')}</button>
                    </div>
                </td>
            </tr>
        `).join('');

        cards.innerHTML = favs.map(f => `
            <div class="mobile-card" data-code="${f.code}">
                <div class="mobile-card-top">
                    <div style="display: flex; align-items: flex-start; gap: 0.5rem;">
                        <button class="icon-btn drag-handle" title="拖拽排序" style="margin-top: 2px;">${icon('grip-vertical')}</button>
                        <div>
                            <div class="mobile-card-name">${escapeHtml(f.name)}</div>
                            <div class="mobile-card-code">${f.code}</div>
                        </div>
                    </div>
                    <div class="action-group">
                        <button class="icon-btn" data-code="${f.code}" title="刷新">${icon('sync-alt')}</button>
                        <button class="icon-btn detail-btn" data-code="${f.code}" title="查看详情">${icon('chart-line')}</button>
                        <button class="icon-btn" data-code="${f.code}" data-name="${escapeAttr(f.name)}" data-pos="${f.position || 0}">${icon('edit')}</button>
                        <button class="icon-btn danger" data-code="${f.code}">${icon('trash-alt')}</button>
                    </div>
                </div>
                <div class="mobile-card-grid">
                    <div>
                        <div class="mobile-stat-label">净值</div>
                        <div class="mobile-stat-value"><div class="skeleton" style="height: 1rem; width: 50px;"></div></div>
                    </div>
                    <div>
                        <div class="mobile-stat-label">估算涨幅</div>
                        <div class="mobile-stat-value"><div class="skeleton" style="height: 1rem; width: 40px;"></div></div>
                    </div>
                    <div>
                        <div class="mobile-stat-label">日涨跌</div>
                        <div class="mobile-stat-value"><div class="skeleton" style="height: 1rem; width: 40px;"></div></div>
                    </div>
                    <div>
                        <div class="mobile-stat-label">收益</div>
                        <div class="mobile-stat-value"><div class="skeleton" style="height: 1rem; width: 50px;"></div></div>
                    </div>
                </div>
            </div>
        `).join('');
    }

    // 绑定非数据按钮事件
    bindFavoriteEvents();

    // 拖拽排序
    initDragSort();

    // 使用批量估值接口获取数据
    fetchBatchValuation(favs);
}

async function mapWithLimit(items, limit, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            results[index] = await worker(items[index], index);
        }
    });
    await Promise.all(runners);
    return results;
}

function toFundViewModel(base, data, position) {
    return {
        ...base,
        ...data,
        code: base.code,
        name: data?.name || base.name,
        position: position || 0,
        gsz: data?.gsz && data.gsz !== '--' ? data.gsz : (data?.dwjz || '--'),
        has_estimate: !!(data && data.has_estimate),
        failed: !data,
    };
}

async function fetchBatchValuation(favs) {
    const codes = favs.map(f => f.code);
    const fetchedList = [];

    let fastMap = {};
    try {
        fastMap = await fetchFastValuationsChunked(codes);
    } catch (e) {
        console.warn('批量估值接口失败，降级到单个请求:', e);
    }

    const missing = favs.filter(fav => !fastMap[fav.code]);

    const fallbackResults = await mapWithLimit(missing, 5, async (fav) => {
        try {
            return { code: fav.code, data: await getFundData(fav.code) };
        } catch {
            return { code: fav.code, data: null };
        }
    });
    fallbackResults.forEach(({ code, data }) => {
        if (data) fastMap[code] = data;
    });

    const activeCodes = new Set(codes);
    Array.from(fundViewCache.keys()).forEach((code) => {
        if (!activeCodes.has(code)) fundViewCache.delete(code);
    });

    favs.forEach((fav, idx) => {
        const fundData = toFundViewModel(fav, fastMap[fav.code], fav.position);
        fetchedList[idx] = fundData;
        fundViewCache.set(fav.code, fundData);
        updateFundRow(fundData, idx);
        updateFundCard(fundData, idx);
    });

    renderSummary(Array.from(fundViewCache.values()));
}

function updateFundRow(f, idx) {
    const row = document.querySelector(`#favoritesList tr[data-code="${f.code}"]`);
    if (!row) return;

    const ch = formatChange(f.gszzl);
    const jzCh = formatChange(f.jzzzl || 0);
    const p = calcProfit(f.position, f.gsz, f.dwjz, !!f.has_estimate);
    const pCls = p.has ? (p.profit >= 0 ? 'positive' : 'negative') : '';

    row.innerHTML = `
        <td>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <button class="icon-btn drag-handle" title="拖拽排序">${icon('grip-vertical')}</button>
                <div>
                    <span class="fund-name-cell">${escapeHtml(f.name)}</span>
                    <span class="fund-code-tag">${escapeHtml(f.code)}</span>
                </div>
            </div>
        </td>
        <td class="text-right mono">${escapeHtml(f.gsz || '--')}</td>
        <td class="text-right">
            <span class="change-badge ${f.failed || !f.has_estimate ? 'neutral' : ch.cls}">${f.failed || !f.has_estimate ? '--' : escapeHtml(ch.value)}</span>
        </td>
        <td class="text-right">
            <span class="change-badge ${f.failed ? 'neutral' : jzCh.cls}">${f.failed ? '--' : escapeHtml(jzCh.value)}</span>
        </td>
        <td style="color: var(--gray-500); font-size: 0.875rem;" title="${escapeAttr(f.update_time ? `估值时间 ${f.update_time}` : '')}">${escapeHtml(f.jzrq || '--')}</td>
        <td class="text-right profit-cell ${pCls}">
            ${p.has ? `¥${formatMoney(p.profit)}` : '--'}
        </td>
        <td class="text-center">
            <div class="action-group">
                <button class="icon-btn" data-code="${escapeAttr(f.code)}" title="刷新">${icon('sync-alt')}</button>
                <button class="icon-btn detail-btn" data-code="${escapeAttr(f.code)}" title="查看详情">${icon('chart-line')}</button>
                <button class="icon-btn" data-code="${escapeAttr(f.code)}" data-name="${escapeAttr(f.name)}" data-pos="${f.position || 0}" title="编辑持仓">${icon('edit')}</button>
                <button class="icon-btn danger" data-code="${escapeAttr(f.code)}" title="移除">${icon('trash-alt')}</button>
            </div>
        </td>
    `;
}

function updateFundCard(f, idx) {
    const card = document.querySelector(`#favoritesCardList .mobile-card[data-code="${f.code}"]`);
    if (!card) return;

    const ch = formatChange(f.gszzl);
    const jzCh = formatChange(f.jzzzl || 0);
    const p = calcProfit(f.position, f.gsz, f.dwjz, !!f.has_estimate);
    const pCls = p.has ? (p.profit >= 0 ? 'positive' : 'negative') : '';

    card.innerHTML = `
        <div class="mobile-card-top">
            <div style="display: flex; align-items: flex-start; gap: 0.5rem;">
                <button class="icon-btn drag-handle" title="拖拽排序" style="margin-top: 2px;">${icon('grip-vertical')}</button>
                <div>
                    <div class="mobile-card-name">${escapeHtml(f.name)}</div>
                    <div class="mobile-card-code">${escapeHtml(f.code)}</div>
                </div>
            </div>
            <div class="action-group">
                <button class="icon-btn" data-code="${escapeAttr(f.code)}" title="刷新">${icon('sync-alt')}</button>
                <button class="icon-btn detail-btn" data-code="${escapeAttr(f.code)}" title="查看详情">${icon('chart-line')}</button>
                <button class="icon-btn" data-code="${escapeAttr(f.code)}" data-name="${escapeAttr(f.name)}" data-pos="${f.position || 0}" title="编辑持仓">${icon('edit')}</button>
                <button class="icon-btn danger" data-code="${escapeAttr(f.code)}" title="移除">${icon('trash-alt')}</button>
            </div>
        </div>
        <div class="mobile-card-grid">
            <div>
                <div class="mobile-stat-label">${f.has_estimate ? '估算净值' : '最新净值'}</div>
                <div class="mobile-stat-value">${escapeHtml(f.gsz || '--')}</div>
            </div>
            <div>
                <div class="mobile-stat-label">估算涨幅</div>
                <div class="mobile-stat-value ${f.has_estimate ? ch.cls : ''}">${f.failed || !f.has_estimate ? '--' : escapeHtml(ch.value)}</div>
            </div>
            <div>
                <div class="mobile-stat-label">日涨跌</div>
                <div class="mobile-stat-value ${jzCh.cls}">${f.failed ? '--' : escapeHtml(jzCh.value)}</div>
            </div>
            <div>
                <div class="mobile-stat-label">收益</div>
                <div class="mobile-stat-value ${pCls}">${p.has ? `¥${formatMoney(p.profit)}` : '--'}</div>
            </div>
        </div>
    `;
}

function refreshSingleFund(code) {
    const favs = getStorage('fundFavorites', []);
    const idx = favs.findIndex(f => f.code === code);
    if (idx === -1) return;

    showToast(`正在刷新 ${code}...`, 'info');

    // 显示加载状态
    const row = document.querySelector(`#favoritesList tr[data-code="${code}"]`);
    if (row) {
        const cells = row.querySelectorAll('td');
        if (cells[1]) cells[1].innerHTML = '<div class="skeleton" style="height: 1.25rem; width: 60px; margin-left: auto;"></div>';
        if (cells[2]) cells[2].innerHTML = '<div class="skeleton" style="height: 1.25rem; width: 50px; margin-left: auto;"></div>';
        if (cells[3]) cells[3].innerHTML = '<div class="skeleton" style="height: 1.25rem; width: 50px; margin-left: auto;"></div>';
    }

    getFundData(code).then(data => {
        const fundData = toFundViewModel(favs[idx], data, favs[idx].position || 0);
        fundViewCache.set(code, fundData);
        updateFundRow(fundData, idx);
        updateFundCard(fundData, idx);
        renderSummary(Array.from(fundViewCache.values()));
        showToast('刷新成功', 'success');
    }).catch(() => {
        const failedData = { code, name: favs[idx].name, position: favs[idx].position || 0, dwjz: '--', gszzl: 0, jzzzl: 0, jzrq: '--', failed: true };
        fundViewCache.set(code, failedData);
        updateFundRow(failedData, idx);
        updateFundCard(failedData, idx);
        renderSummary(Array.from(fundViewCache.values()));
        showToast('刷新失败', 'error');
    });
}

let favoriteEventsBound = false;

function bindFavoriteEvents() {
    if (favoriteEventsBound) return;
    favoriteEventsBound = true;

    const tbody = document.getElementById('favoritesList');
    const cards = document.getElementById('favoritesCardList');

    // 使用事件委托，避免 innerHTML 替换后事件丢失
    tbody.addEventListener('click', (e) => {
        const btn = e.target.closest('.icon-btn');
        if (!btn) return;

        const code = btn.dataset.code;
        if (btn.classList.contains('danger')) {
            removeFromFavorites(code);
        } else if (btn.classList.contains('detail-btn')) {
            showFundDetail(code);
        } else if (btn.dataset.pos !== undefined && btn.dataset.name) {
            editPosition(code, btn.dataset.name, parseFloat(btn.dataset.pos) || 0);
        } else if (!btn.classList.contains('drag-handle')) {
            refreshSingleFund(code);
        }
    });

    cards.addEventListener('click', (e) => {
        const btn = e.target.closest('.icon-btn');
        if (!btn) return;

        const code = btn.dataset.code;
        if (btn.classList.contains('danger')) {
            removeFromFavorites(code);
        } else if (btn.classList.contains('detail-btn')) {
            showFundDetail(code);
        } else if (btn.dataset.pos !== undefined && btn.dataset.name) {
            editPosition(code, btn.dataset.name, parseFloat(btn.dataset.pos) || 0);
        } else if (!btn.classList.contains('drag-handle')) {
            refreshSingleFund(code);
        }
    });
}

async function retryFund(code) {
    refreshSingleFund(code);
}

async function sortFavorites() {
    const favs = getStorage('fundFavorites', []);
    if (!favs.length) { showToast('暂无自选', 'info'); return; }

    showToast('排序中...', 'info');
    try {
        const fastMap = await fetchFastValuationsChunked(favs.map(f => f.code));
        const sorted = favs.map((fav) => {
            const data = fastMap[fav.code] || {};
            return {
                fav,
                gszzl: Number.parseFloat(data.gszzl) || 0,
            };
        }).sort((a, b) => b.gszzl - a.gszzl);
        setStorage('fundFavorites', sorted.map(({ fav }) => ({
            code: fav.code,
            name: fav.name,
            position: fav.position || 0,
        })));
        renderFavorites();
        showToast('排序完成', 'success');
    } catch { showToast('排序失败', 'error'); }
}

function toggleAutoRefresh(enable) {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    refreshTimerInterval = null;
    if (enable) {
        startAutoRefresh();
        setStorage('autoRefreshEnabled', true);
        showToast('自动刷新已开启', 'success');
    } else {
        setStorage('autoRefreshEnabled', false);
        showToast('自动刷新已关闭', 'info');
    }
}

function startAutoRefresh() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    const interval = getRefreshInterval();
    refreshTimerInterval = interval;
    refreshTimer = setInterval(() => {
        renderFavorites();
        checkTradingStatus();
    }, interval);

    // 更新刷新间隔显示
    const intervalEl = document.getElementById('refreshInterval');
    if (intervalEl) {
        intervalEl.textContent = interval === TRADING_REFRESH_INTERVAL ? '1分钟' : '5分钟';
    }
}

// ========== Drag Sort (Only via handle) ==========
let draggedItem = null;
let draggedCode = null;

let dragEventsBound = false;

function initDragSort() {
    if (dragEventsBound) return;
    dragEventsBound = true;

    const tbody = document.getElementById('favoritesList');
    const cards = document.getElementById('favoritesCardList');

    // 使用事件委托处理拖拽
    // mousedown 在 drag-handle 上设置 draggable
    tbody.addEventListener('mousedown', (e) => {
        const handle = e.target.closest('.drag-handle');
        if (!handle) return;
        const row = handle.closest('tr');
        if (row) row.setAttribute('draggable', 'true');
    });

    tbody.addEventListener('mouseup', (e) => {
        const handle = e.target.closest('.drag-handle');
        if (!handle) return;
        const row = handle.closest('tr');
        if (row) setTimeout(() => row.setAttribute('draggable', 'false'), 100);
    });

    tbody.addEventListener('dragstart', (e) => {
        const row = e.target.closest('tr');
        if (!row || !row.dataset.code) return;
        draggedItem = row;
        draggedCode = row.dataset.code;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', row.dataset.code);
    });

    tbody.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const row = e.target.closest('tr');
        if (row && row !== draggedItem) {
            row.classList.add('drag-over');
        }
    });

    tbody.addEventListener('dragleave', (e) => {
        const row = e.target.closest('tr');
        if (row) row.classList.remove('drag-over');
    });

    tbody.addEventListener('drop', (e) => {
        e.preventDefault();
        const row = e.target.closest('tr');
        if (row) row.classList.remove('drag-over');
        if (!draggedItem || !row || draggedItem === row) return;

        const fromCode = draggedCode;
        const toCode = row.dataset.code;

        const parent = draggedItem.parentNode;
        const allRows = Array.from(parent.querySelectorAll('tr[data-code]'));
        const fromIdx = allRows.indexOf(draggedItem);
        const toIdx = allRows.indexOf(row);

        if (fromIdx < toIdx) {
            parent.insertBefore(draggedItem, row.nextSibling);
        } else {
            parent.insertBefore(draggedItem, row);
        }

        // 同步移动卡片
        syncCardOrder(fromCode, toCode, fromIdx, toIdx);
        saveOrderFromDOM();
    });

    tbody.addEventListener('dragend', (e) => {
        const row = e.target.closest('tr');
        if (row) {
            row.classList.remove('dragging');
            row.setAttribute('draggable', 'false');
        }
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        draggedItem = null;
        draggedCode = null;
    });

    // 移动端卡片拖拽
    cards.addEventListener('mousedown', (e) => {
        const handle = e.target.closest('.drag-handle');
        if (!handle) return;
        const card = handle.closest('.mobile-card');
        if (card) card.setAttribute('draggable', 'true');
    });

    cards.addEventListener('mouseup', (e) => {
        const handle = e.target.closest('.drag-handle');
        if (!handle) return;
        const card = handle.closest('.mobile-card');
        if (card) setTimeout(() => card.setAttribute('draggable', 'false'), 100);
    });

    cards.addEventListener('dragstart', (e) => {
        const card = e.target.closest('.mobile-card');
        if (!card || !card.dataset.code) return;
        draggedItem = card;
        draggedCode = card.dataset.code;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.dataset.code);
    });

    cards.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const card = e.target.closest('.mobile-card');
        if (card && card !== draggedItem) {
            card.classList.add('drag-over');
        }
    });

    cards.addEventListener('dragleave', (e) => {
        const card = e.target.closest('.mobile-card');
        if (card) card.classList.remove('drag-over');
    });

    cards.addEventListener('drop', (e) => {
        e.preventDefault();
        const card = e.target.closest('.mobile-card');
        if (card) card.classList.remove('drag-over');
        if (!draggedItem || !card || draggedItem === card) return;

        const fromCode = draggedCode;
        const toCode = card.dataset.code;

        const parent = draggedItem.parentNode;
        const allCards = Array.from(parent.querySelectorAll('.mobile-card[data-code]'));
        const fromIdx = allCards.indexOf(draggedItem);
        const toIdx = allCards.indexOf(card);

        if (fromIdx < toIdx) {
            parent.insertBefore(draggedItem, card.nextSibling);
        } else {
            parent.insertBefore(draggedItem, card);
        }

        // 同步移动表格行
        syncRowOrder(fromCode, toCode, fromIdx, toIdx);
        saveOrderFromDOM();
    });

    cards.addEventListener('dragend', (e) => {
        const card = e.target.closest('.mobile-card');
        if (card) {
            card.classList.remove('dragging');
            card.setAttribute('draggable', 'false');
        }
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        draggedItem = null;
        draggedCode = null;
    });

    initTouchDragSort(cards);
}

function initTouchDragSort(container) {
    let active = null;

    container.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse') return;
        const handle = e.target.closest('.drag-handle');
        const card = handle?.closest('.mobile-card');
        if (!card) return;
        e.preventDefault();
        active = { card, pointerId: e.pointerId };
        card.classList.add('dragging');
        handle.setPointerCapture?.(e.pointerId);
    });

    container.addEventListener('pointermove', (e) => {
        if (!active || e.pointerId !== active.pointerId) return;
        e.preventDefault();
        const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.mobile-card');
        container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        if (target && target !== active.card) target.classList.add('drag-over');
    });

    const finish = (e) => {
        if (!active || e.pointerId !== active.pointerId) return;
        const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.mobile-card');
        active.card.classList.remove('dragging');
        container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

        if (target && target !== active.card) {
            const parent = active.card.parentNode;
            const allCards = Array.from(parent.querySelectorAll('.mobile-card[data-code]'));
            const fromIdx = allCards.indexOf(active.card);
            const toIdx = allCards.indexOf(target);
            const fromCode = active.card.dataset.code;
            const toCode = target.dataset.code;
            if (fromIdx < toIdx) parent.insertBefore(active.card, target.nextSibling);
            else parent.insertBefore(active.card, target);
            syncRowOrder(fromCode, toCode, fromIdx, toIdx);
            saveOrderFromDOM();
        }
        active = null;
    };

    container.addEventListener('pointerup', finish);
    container.addEventListener('pointercancel', finish);
}

function syncCardOrder(fromCode, toCode, fromIdx, toIdx) {
    const cards = document.getElementById('favoritesCardList');
    const fromCard = cards.querySelector(`.mobile-card[data-code="${fromCode}"]`);
    const toCard = cards.querySelector(`.mobile-card[data-code="${toCode}"]`);
    if (!fromCard || !toCard) return;

    if (fromIdx < toIdx) {
        cards.insertBefore(fromCard, toCard.nextSibling);
    } else {
        cards.insertBefore(fromCard, toCard);
    }
}

function syncRowOrder(fromCode, toCode, fromIdx, toIdx) {
    const tbody = document.getElementById('favoritesList');
    const fromRow = tbody.querySelector(`tr[data-code="${fromCode}"]`);
    const toRow = tbody.querySelector(`tr[data-code="${toCode}"]`);
    if (!fromRow || !toRow) return;

    if (fromIdx < toIdx) {
        tbody.insertBefore(fromRow, toRow.nextSibling);
    } else {
        tbody.insertBefore(fromRow, toRow);
    }
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (this !== draggedItem) {
        this.classList.add('drag-over');
    }
}

function saveOrderFromDOM() {
    const rows = document.querySelectorAll('#favoritesList tr[data-code]');
    const newOrder = Array.from(rows).map(r => r.dataset.code);

    let favs = getStorage('fundFavorites', []);
    const favMap = {};
    favs.forEach(f => favMap[f.code] = f);

    const reordered = newOrder.map(code => favMap[code]).filter(Boolean);
    setStorage('fundFavorites', reordered);
}

// ========== Init ==========
function init() {
    document.getElementById('searchBtn').onclick = searchFund;
    document.getElementById('fundCode').onkeypress = (e) => { if (e.key === 'Enter') searchFund(); };
    document.getElementById('clearHistoryBtn').onclick = clearSearchHistory;
    document.getElementById('refreshFavoritesBtn').onclick = () => { renderFavorites(); showToast('刷新中...', 'info'); };
    document.getElementById('sortFavoritesBtn').onclick = sortFavorites;
    document.getElementById('autoRefreshSwitch').onchange = (e) => toggleAutoRefresh(e.target.checked);

    // 检查交易状态
    checkTradingStatus();

    renderHistory();
    renderFavorites();

    if (getStorage('autoRefreshEnabled')) {
        document.getElementById('autoRefreshSwitch').checked = true;
        toggleAutoRefresh(true);
    }
}

document.addEventListener('DOMContentLoaded', init);
