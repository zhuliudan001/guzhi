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
    resolveEstimateChange,
    escapeHtml,
    escapeAttr,
    createBackup,
    parseBackup,
    mergeFavorites,
    mergeSearchHistory,
} = AppUtils;
const TRADING_REFRESH_INTERVAL = 60000;
const CLOSED_REFRESH_INTERVAL = 300000;
const MAX_SEARCH_HISTORY = 10;
const MAX_BACKUP_FILE_SIZE = 1024 * 1024;
let refreshTimer = null;
let refreshTimerInterval = null;
let currentTradingStatus = null;
let valuationRequestId = 0;
const DERIVED_ESTIMATE_TTL = 5 * 60 * 1000;
const derivedEstimateCache = new Map();
const derivedEstimatePending = new Map();

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
    let state = 'closed';
    if (is_trading) state = 'trading';
    else if (status === 'weekend' || status === 'holiday') state = 'holiday';

    statusEl.innerHTML = `
        <span class="trading-state" data-state="${state}">
            <span class="status-dot" aria-hidden="true"></span>
            <span>${escapeHtml(status_text || '未知')}</span>
        </span>
        ${next_open ? `<span class="next-open">下次开盘 ${escapeHtml(next_open)}</span>` : ''}
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
    'search': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    'trash-alt': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
    'star': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
    'sync-alt': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    'clock': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    'edit': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    'info-circle': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    'grip-vertical': '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
    'xmark': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    'download': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    'upload': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>'
};

function icon(name) {
    return `<span class="svg-icon" aria-hidden="true">${ICONS[name] || ''}</span>`;
}

// ========== Utility Functions ==========
function showToast(message, type = 'info') {
    const old = document.querySelector('.toast');
    if (old) old.remove();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.setAttribute('role', 'status');
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

function formatProfit(value) {
    if (!Number.isFinite(value)) return '--';
    const sign = value > 0 ? '+' : (value < 0 ? '-' : '');
    return `${sign}¥${formatMoney(Math.abs(value))}`;
}

function formatRate(value) {
    if (!Number.isFinite(value)) return '--';
    return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function valueClass(value) {
    if (!Number.isFinite(value) || value === 0) return 'neutral';
    return value > 0 ? 'positive' : 'negative';
}

function getStorage(key, def = null) {
    const d = localStorage.getItem(key);
    if (!d) return def;
    try { return JSON.parse(d); } catch { return def; }
}

function setStorage(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
}

function isFavorite(code) {
    return getStorage('fundFavorites', []).some(f => f.code === code);
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

// 批量估值源不覆盖部分基金时，用详情里的重仓股估算补齐
function getDerivedEstimate(code) {
    const cached = derivedEstimateCache.get(code);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.data);
    if (derivedEstimatePending.has(code)) return derivedEstimatePending.get(code);

    const pending = getFundDetail(code)
        .then((detail) => {
            const data = {
                gsz: detail?.gsz,
                gszzl: detail?.gszzl,
                jzzzl: detail?.jzzzl,
                dwjz: detail?.dwjz,
                jzrq: detail?.jzrq,
                gztime: detail?.gztime,
                update_time: detail?.update_time,
                has_estimate: !!detail?.has_estimate,
            };
            derivedEstimateCache.set(code, { data, expiresAt: Date.now() + DERIVED_ESTIMATE_TTL });
            return data;
        })
        .catch(() => null)
        .finally(() => { derivedEstimatePending.delete(code); });

    derivedEstimatePending.set(code, pending);
    return pending;
}

function canDeriveEstimates() {
    if (!currentTradingStatus) return false;
    return currentTradingStatus.status === 'trading' || currentTradingStatus.status === 'lunch_break';
}

// ========== Search History ==========
let historyOpen = false;

function saveSearchHistory(code, name) {
    let h = getStorage('searchHistory', []);
    h = h.filter(i => i.code !== code);
    h.unshift({ code, name });
    if (h.length > MAX_SEARCH_HISTORY) h = h.slice(0, MAX_SEARCH_HISTORY);
    setStorage('searchHistory', h);
    historyOpen = false;
    renderHistory();
}

function renderHistory() {
    const h = getStorage('searchHistory', []);
    const section = document.getElementById('historySection');
    const el = document.getElementById('searchHistory');
    if (!section || !el) return;

    const show = historyOpen && h.length > 0;
    section.hidden = !show;
    if (!show) {
        el.innerHTML = '';
        return;
    }

    el.innerHTML = h.map(i => `
        <div class="history-item">
            <button type="button" class="history-main" data-code="${escapeAttr(i.code)}">
                <span class="history-code">${escapeHtml(i.code)}</span>
                <span class="history-name">${escapeHtml(i.name)}</span>
            </button>
            <button type="button" class="history-remove" data-remove="${escapeAttr(i.code)}" aria-label="删除 ${escapeAttr(i.code)} 的搜索记录" title="删除记录">&times;</button>
        </div>
    `).join('');

    el.querySelectorAll('.history-main').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = document.getElementById('fundCode');
            input.value = btn.dataset.code;
            historyOpen = false;
            renderHistory();
            searchFund();
        });
    });

    el.querySelectorAll('.history-remove').forEach(btn => {
        btn.addEventListener('click', (event) => {
            event.stopPropagation();
            removeSearchHistory(btn.dataset.remove);
        });
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
    historyOpen = false;
    renderHistory();
    showToast('已清空搜索记录', 'success');
}

function setSearchError(message) {
    const errorEl = document.getElementById('searchError');
    const input = document.getElementById('fundCode');
    if (!errorEl) return;
    errorEl.textContent = message || '';
    errorEl.hidden = !message;
    input?.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function closeHistory() {
    if (!historyOpen) return;
    historyOpen = false;
    renderHistory();
}

// ========== Drawer ==========
const drawerState = {
    view: null,
    fund: null,
    backFund: null,
};

let drawerOpener = null;

function getDrawer() {
    return document.getElementById('fundDrawer');
}

function openDrawer() {
    const drawer = getDrawer();
    if (!drawer) return;
    if (!drawer.open) {
        const active = document.activeElement;
        drawerOpener = active && active !== document.body && !drawer.contains(active) ? active : null;
        drawer.showModal();
    }
    document.body.classList.add('drawer-open');
}

function closeDrawer() {
    searchRequestId++;
    const drawer = getDrawer();
    if (drawer?.open) drawer.close();
}

function setDrawerHead({ eyebrow, title, sub, back = false }) {
    const eyebrowEl = document.getElementById('drawerEyebrow');
    const titleEl = document.getElementById('drawerTitle');
    const subEl = document.getElementById('drawerSub');
    const backBtn = document.getElementById('drawerBack');
    if (eyebrowEl) eyebrowEl.textContent = eyebrow || '';
    if (titleEl) titleEl.textContent = title || '基金';
    if (subEl) subEl.innerHTML = sub || '';
    if (backBtn) backBtn.hidden = !back;
}

function setDrawerBody(html) {
    const body = document.getElementById('drawerBody');
    if (body) body.innerHTML = html;
}

function setDrawerFoot(html) {
    const foot = document.getElementById('drawerFoot');
    if (!foot) return;
    foot.hidden = !html;
    foot.innerHTML = html || '';
}

function renderDrawerLoading(label) {
    openDrawer();
    setDrawerHead({ eyebrow: '加载中', title: '正在获取数据…', sub: label || '' });
    setDrawerFoot('');
    setDrawerBody(`
        <div class="drawer-loading" aria-live="polite">
            <span class="skeleton" style="width: 40%; height: 12px;"></span>
            <span class="skeleton" style="width: 62%; height: 32px;"></span>
            <span class="skeleton" style="width: 100%; height: 88px; margin-top: 8px;"></span>
            <span class="skeleton" style="width: 100%; height: 64px;"></span>
            <span class="skeleton" style="width: 84%; height: 14px;"></span>
        </div>
    `);
}

function renderDrawerError(title, desc, retry) {
    openDrawer();
    setDrawerHead({ eyebrow: '出错了', title: title || '加载失败', sub: '' });
    setDrawerFoot('');
    setDrawerBody(`
        <div class="drawer-error">
            <p class="drawer-error-title">${escapeHtml(title || '加载失败')}</p>
            <p class="drawer-error-desc">${escapeHtml(desc || '请稍后重试')}</p>
            <button type="button" class="btn btn-secondary" id="drawerRetry">重新加载</button>
        </div>
    `);
    document.getElementById('drawerRetry')?.addEventListener('click', () => {
        if (typeof retry === 'function') retry();
    });
}

function renderChange(value) {
    const ch = formatChange(value);
    return `<span class="change ${ch.cls}">${escapeHtml(ch.value)}</span>`;
}

function getDisplayNav(fund) {
    if (fund?.gsz && fund.gsz !== '--') return fund.gsz;
    return fund?.dwjz || '--';
}

function changeCls(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num === 0) return 'neutral';
    return num > 0 ? 'positive' : 'negative';
}

// ========== Drawer: search result ==========
function renderSearchResult(fund) {
    drawerState.view = 'search';
    drawerState.fund = fund;
    const hasEstimate = !!fund.has_estimate;
    const nav = getDisplayNav(fund);
    const ch = hasEstimate ? formatChange(fund.gszzl) : formatChange(fund.jzzzl);
    const changeLabel = hasEstimate ? '盘中估算涨幅' : '最新净值日涨跌';
    const timeLabel = hasEstimate ? '估值时间' : '净值日期';
    const updateTime = fund.update_time || fund.gztime || fund.jzrq || '--';
    const favorite = isFavorite(fund.code);

    openDrawer();
    setDrawerHead({
        eyebrow: '搜索结果',
        title: fund.name || '基金',
        sub: `<span class="tag mono">${escapeHtml(fund.code)}</span>${fund.type ? `<span class="tag">${escapeHtml(fund.type)}</span>` : ''}`,
        back: false,
    });

    const sectors = Array.isArray(fund.sectors) ? fund.sectors : [];
    const topStocks = Array.isArray(fund.top_stocks) ? fund.top_stocks : [];
    const performance = fund.performance || {};
    const hasPerformance = ['month', 'quarter', 'half_year', 'year'].some(k => performance[k] !== undefined && performance[k] !== null);

    setDrawerBody(`
        <div class="fund-hero">
            <div class="fund-hero-top">
                <div>
                    <div class="fund-hero-label">${hasEstimate ? '估算净值' : '最新净值'}</div>
                    <div class="fund-nav">${escapeHtml(nav)}</div>
                </div>
                <div class="fund-hero-change">
                    <div class="fund-hero-change-value ${ch.cls}">${escapeHtml(ch.value)}</div>
                    <div class="fund-hero-change-label">${changeLabel}</div>
                </div>
            </div>
            <div class="fund-meta-row">
                <span class="tag ${hasEstimate ? 'tag-accent' : ''}">${hasEstimate ? '盘中估值' : '最新净值'}</span>
                <span class="tag">净值日期 ${escapeHtml(fund.jzrq || '--')}</span>
                ${fund.ljjz ? `<span class="tag">累计净值 ${escapeHtml(fund.ljjz)}</span>` : ''}
            </div>
        </div>

        <div class="drawer-section">
            <div class="drawer-section-head">
                <h3 class="drawer-section-title">关键数据</h3>
                <span class="drawer-section-note">${timeLabel} ${escapeHtml(updateTime)}</span>
            </div>
            <div class="metric-grid">
                <div class="metric">
                    <div class="metric-label">最新净值</div>
                    <div class="metric-value">${escapeHtml(fund.dwjz || '--')}</div>
                    <div class="metric-sub">${escapeHtml(fund.jzrq || '--')}</div>
                </div>
                <div class="metric">
                    <div class="metric-label">日涨跌</div>
                    <div class="metric-value ${changeCls(fund.jzzzl)}">${escapeHtml(formatChange(fund.jzzzl).value)}</div>
                </div>
                <div class="metric">
                    <div class="metric-label">累计净值</div>
                    <div class="metric-value">${escapeHtml(fund.ljjz || '--')}</div>
                </div>
                <div class="metric">
                    <div class="metric-label">申赎状态</div>
                    <div class="metric-value" style="font-family: var(--font-sans); font-size: 13px;">${escapeHtml(fund.sgzt || '--')} / ${escapeHtml(fund.shzt || '--')}</div>
                </div>
            </div>
        </div>

        ${sectors.length ? `
        <div class="drawer-section">
            <div class="drawer-section-head"><h3 class="drawer-section-title">关联板块</h3></div>
            <div class="chip-list">
                ${sectors.map(s => `<span class="chip">${escapeHtml(s.name)} ${renderChange(s.change_pct)}</span>`).join('')}
            </div>
        </div>` : ''}

        ${topStocks.length ? `
        <div class="drawer-section">
            <div class="drawer-section-head">
                <h3 class="drawer-section-title">重仓股</h3>
                <span class="drawer-section-note">前 ${topStocks.length} 只</span>
            </div>
            <div class="chip-list">
                ${topStocks.map(s => `<span class="chip">${escapeHtml(s.name)} ${renderChange(s.change_pct)}</span>`).join('')}
            </div>
        </div>` : ''}

        ${hasPerformance ? `
        <div class="drawer-section">
            <div class="drawer-section-head"><h3 class="drawer-section-title">阶段收益</h3></div>
            <div class="performance-grid">
                ${[['近1月', 'month'], ['近3月', 'quarter'], ['近6月', 'half_year'], ['近1年', 'year']].map(([label, key]) => {
                    const value = performance[key];
                    const cls = value === undefined || value === null ? 'neutral' : changeCls(value);
                    const text = value === undefined || value === null ? '--' : `${value > 0 ? '+' : ''}${value}%`;
                    return `<div class="performance-item"><div class="performance-label">${label}</div><div class="performance-value ${cls}">${escapeHtml(text)}</div></div>`;
                }).join('')}
            </div>
        </div>` : ''}
    `);

    const editButton = favorite && showPositions
        ? `<button type="button" class="btn btn-secondary" id="drawerEditPos">${icon('edit')}编辑持仓</button>`
        : '';
    const addButton = favorite
        ? ''
        : `<button type="button" class="btn btn-primary" id="drawerAddBtn">${icon('star')}加入自选</button>`;
    setDrawerFoot(`
        ${addButton}${editButton}
        <button type="button" class="btn ${favorite ? 'btn-primary' : 'btn-secondary'}" id="drawerDetailBtn">查看完整详情</button>
    `);

    document.getElementById('drawerAddBtn')?.addEventListener('click', () => addToFavorites(fund.code, fund.name));
    document.getElementById('drawerEditPos')?.addEventListener('click', () => {
        const fav = getStorage('fundFavorites', []).find(f => f.code === fund.code);
        editPosition(fund.code, fund.name, fav?.position || 0);
    });
    document.getElementById('drawerDetailBtn')?.addEventListener('click', () => {
        showFundDetail(fund.code, { backFund: fund });
    });
}

// ========== Drawer: full detail ==========
let fundDetailChart = null;

async function showFundDetail(code, options = {}) {
    drawerState.view = 'detail';
    drawerState.backFund = options.backFund || null;
    renderDrawerLoading(code);

    try {
        const fund = await getFundDetail(code);
        drawerState.fund = fund;
        renderFundDetail(fund);
    } catch (error) {
        renderDrawerError('详情加载失败', error.message || '请检查网络后重试', () => showFundDetail(code, options));
    }
}

function renderFundDetail(fund) {
    const hasEstimate = !!fund.has_estimate;
    const nav = getDisplayNav(fund);
    const ch = hasEstimate ? formatChange(fund.gszzl) : formatChange(fund.jzzzl);
    const changeLabel = hasEstimate ? '盘中估算涨幅' : '最新净值日涨跌';
    const favorite = isFavorite(fund.code);
    const stockPct = fund.stock_ratio ? Number(fund.stock_ratio) * 100 : null;
    const bondPct = fund.asset_allocation ? Number(fund.asset_allocation.bond) : null;
    const cashPct = fund.asset_allocation ? Number(fund.asset_allocation.cash) : null;
    const otherPct = (stockPct !== null || bondPct !== null || cashPct !== null)
        ? Math.max(0, 100 - (stockPct || 0) - (bondPct || 0) - (cashPct || 0))
        : null;
    const allocation = [
        ['股票', stockPct],
        ['债券', bondPct],
        ['现金', cashPct],
        ['其他', otherPct],
    ].filter(([, value]) => value !== null && Number.isFinite(value));
    const hasChart = fund.nav_trend && Array.isArray(fund.nav_trend.dates) && fund.nav_trend.dates.length > 5;

    openDrawer();
    setDrawerHead({
        eyebrow: '基金详情',
        title: fund.name || '基金',
        sub: `<span class="tag mono">${escapeHtml(fund.code)}</span>${fund.type ? `<span class="tag">${escapeHtml(fund.type)}</span>` : ''}`,
        back: !!drawerState.backFund,
    });

    setDrawerBody(`
        <div class="fund-hero">
            <div class="fund-hero-top">
                <div>
                    <div class="fund-hero-label">${hasEstimate ? '估算净值' : '最新净值'}</div>
                    <div class="fund-nav">${escapeHtml(nav)}</div>
                </div>
                <div class="fund-hero-change">
                    <div class="fund-hero-change-value ${ch.cls}">${escapeHtml(ch.value)}</div>
                    <div class="fund-hero-change-label">${changeLabel}</div>
                </div>
            </div>
            <div class="fund-meta-row">
                <span class="tag ${hasEstimate ? 'tag-accent' : ''}">${hasEstimate ? '盘中估值' : '最新净值'}</span>
                <span class="tag">净值日期 ${escapeHtml(fund.jzrq || '--')}</span>
                <span class="tag">申购 ${escapeHtml(fund.sgzt || '--')}</span>
                <span class="tag">赎回 ${escapeHtml(fund.shzt || '--')}</span>
            </div>
        </div>

        <div class="drawer-section">
            <div class="drawer-section-head"><h3 class="drawer-section-title">净值概览</h3></div>
            <div class="metric-grid">
                <div class="metric">
                    <div class="metric-label">最新净值</div>
                    <div class="metric-value">${escapeHtml(fund.dwjz || '--')}</div>
                    <div class="metric-sub">${escapeHtml(fund.jzrq || '--')}</div>
                </div>
                <div class="metric">
                    <div class="metric-label">日涨跌</div>
                    <div class="metric-value ${changeCls(fund.jzzzl)}">${escapeHtml(formatChange(fund.jzzzl).value)}</div>
                </div>
                <div class="metric">
                    <div class="metric-label">累计净值</div>
                    <div class="metric-value">${escapeHtml(fund.ljjz || '--')}</div>
                </div>
                <div class="metric">
                    <div class="metric-label">${hasEstimate ? '估值时间' : '更新时间'}</div>
                    <div class="metric-value" style="font-size: 12px;">${escapeHtml(fund.update_time || fund.gztime || '--')}</div>
                </div>
            </div>
        </div>

        ${hasChart ? `
        <div class="drawer-section">
            <div class="drawer-section-head">
                <h3 class="drawer-section-title">净值走势</h3>
                <span class="drawer-section-note">近 ${fund.nav_trend.dates.length} 个交易日</span>
            </div>
            <div class="chart-box"><canvas id="navTrendChart" aria-label="近期净值走势" role="img"></canvas></div>
        </div>` : ''}

        ${allocation.length ? `
        <div class="drawer-section">
            <div class="drawer-section-head"><h3 class="drawer-section-title">资产配置</h3></div>
            <div class="metric-grid">
                ${allocation.map(([label, value]) => `
                    <div class="metric">
                        <div class="metric-label">${label}</div>
                        <div class="metric-value">${value.toFixed(1)}%</div>
                    </div>
                `).join('')}
            </div>
        </div>` : ''}

        ${fund.performance && (fund.performance.year || fund.performance.quarter) ? `
        <div class="drawer-section">
            <div class="drawer-section-head"><h3 class="drawer-section-title">阶段收益</h3></div>
            <div class="performance-grid">
                ${[['近1月', 'month'], ['近3月', 'quarter'], ['近6月', 'half_year'], ['近1年', 'year']].map(([label, key]) => {
                    const value = fund.performance[key];
                    const cls = value === undefined || value === null ? 'neutral' : changeCls(value);
                    const text = value === undefined || value === null ? '--' : `${value > 0 ? '+' : ''}${value}%`;
                    return `<div class="performance-item"><div class="performance-label">${label}</div><div class="performance-value ${cls}">${escapeHtml(text)}</div></div>`;
                }).join('')}
            </div>
        </div>` : ''}

        ${fund.top_stocks && fund.top_stocks.length > 0 ? `
        <div class="drawer-section">
            <div class="drawer-section-head">
                <h3 class="drawer-section-title">重仓股</h3>
                <span class="drawer-section-note">${fund.top_stocks.length} 只</span>
            </div>
            <div class="stock-list">
                <div class="stock-head">
                    <span>名称</span><span class="num">代码</span><span class="num">持仓</span><span class="num">涨跌幅</span>
                </div>
                ${fund.top_stocks.map(s => `
                    <div class="stock-row">
                        <span class="stock-name">${escapeHtml(s.name)}</span>
                        <span class="stock-code num">${escapeHtml(s.code)}</span>
                        <span class="num">${s.weight ? s.weight.toFixed(2) + '%' : '--'}</span>
                        <span class="stock-change num ${changeCls(s.change_pct)}">${escapeHtml(formatChange(s.change_pct).value)}</span>
                    </div>
                `).join('')}
            </div>
        </div>` : ''}

        ${fund.sectors && fund.sectors.length > 0 ? `
        <div class="drawer-section">
            <div class="drawer-section-head"><h3 class="drawer-section-title">关联板块</h3></div>
            <div class="chip-list">
                ${fund.sectors.map(s => `<span class="chip">${escapeHtml(s.name)} ${renderChange(s.change_pct)}</span>`).join('')}
            </div>
        </div>` : ''}

        ${fund.fund_managers && fund.fund_managers.length > 0 ? `
        <div class="drawer-section">
            <div class="drawer-section-head"><h3 class="drawer-section-title">基金经理</h3></div>
            <div class="manager-list">
                ${fund.fund_managers.map(m => `
                    <div class="manager-item">
                        <div class="manager-avatar">${escapeHtml((m.name || '?')[0])}</div>
                        <div>
                            <div class="manager-name">${escapeHtml(m.name || '--')}</div>
                            <div class="manager-info">任职起始 ${escapeHtml(m.start_date || '--')}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>` : ''}
    `);

    const addButton = favorite
        ? ''
        : `<button type="button" class="btn btn-primary" id="detailAddBtn">${icon('star')}加入自选</button>`;
    const editButton = favorite && showPositions
        ? `<button type="button" class="btn btn-secondary" id="detailEditPos">${icon('edit')}编辑持仓</button>`
        : '';
    const refreshButton = `<button type="button" class="btn ${favorite && showPositions ? 'btn-ghost' : 'btn-secondary'}" id="detailRefresh">${icon('sync-alt')}刷新估值</button>`;
    setDrawerFoot(`${addButton}${editButton}${refreshButton}`);

    document.getElementById('detailAddBtn')?.addEventListener('click', () => addToFavorites(fund.code, fund.name));
    document.getElementById('detailEditPos')?.addEventListener('click', () => {
        const fav = getStorage('fundFavorites', []).find(f => f.code === fund.code);
        editPosition(fund.code, fund.name, fav?.position || 0);
    });
    document.getElementById('detailRefresh')?.addEventListener('click', () => showFundDetail(fund.code));

    if (hasChart) renderNavTrendChart(fund.nav_trend);
}

function renderNavTrendChart(navTrend) {
    const canvas = document.getElementById('navTrendChart');
    if (!canvas || typeof Chart === 'undefined') return;

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
            labels,
            datasets: [{
                data: values,
                borderColor: '#1d4ed8',
                backgroundColor: 'rgba(29, 78, 216, 0.06)',
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
                        maxTicksLimit: 6,
                        font: { size: 10 },
                        color: '#9ca3af'
                    }
                },
                y: {
                    display: true,
                    min: minVal - padding,
                    max: maxVal + padding,
                    grid: { color: '#f2f4f7' },
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

// ========== Search Fund ==========
let searchRequestId = 0;

async function searchFund() {
    const input = document.getElementById('fundCode');
    const code = input.value.trim();
    setSearchError('');

    if (!/^\d{6}$/.test(code)) {
        setSearchError('请输入 6 位数字基金代码');
        input.focus();
        return;
    }

    const requestId = ++searchRequestId;
    historyOpen = false;
    renderHistory();
    renderDrawerLoading(code);

    try {
        const fund = await getFundData(code);
        if (requestId !== searchRequestId) return;

        renderSearchResult(fund);
        saveSearchHistory(code, fund.name);
        showToast(fund.has_estimate ? '估值获取成功' : '查询成功', 'success');

        getFundDetail(code).then((detail) => {
            if (requestId !== searchRequestId) return;
            if (drawerState.view !== 'search' || drawerState.fund?.code !== code) return;
            renderSearchResult({ ...fund, ...detail });
        }).catch((error) => {
            console.warn('基金详情加载失败:', error);
        });
    } catch (error) {
        if (requestId !== searchRequestId) return;
        renderDrawerError('查询失败', error.message || '请检查基金代码后重试', () => searchFund());
        setSearchError(error.message || '查询失败');
    }
}

// ========== Favorites ==========
const fundViewCache = new Map();
let showPositions = true;

function applyPositionVisibility(visible) {
    document.body.classList.toggle('positions-hidden', !visible);
    const switchEl = document.getElementById('positionVisibilitySwitch');
    if (switchEl) switchEl.checked = visible;
    renderSummary(Array.from(fundViewCache.values()));
}

function initPositionVisibility() {
    showPositions = getStorage('showPositions', true) !== false;
    const switchEl = document.getElementById('positionVisibilitySwitch');
    if (switchEl) {
        switchEl.onchange = (event) => {
            showPositions = event.target.checked;
            setStorage('showPositions', showPositions);
            applyPositionVisibility(showPositions);
        };
    }
    applyPositionVisibility(showPositions);
}

function getFavoriteActions(f) {
    const code = escapeAttr(f.code);
    const name = escapeAttr(f.name);
    return `
        <div class="actions">
            <button class="icon-btn" type="button" data-action="refresh" data-code="${code}" title="刷新估值" aria-label="刷新 ${name} 的估值">${icon('sync-alt')}</button>
            <button class="icon-btn" type="button" data-action="detail" data-code="${code}" title="查看详情" aria-label="查看 ${name} 的详情">${icon('chart-line')}</button>
            <button class="icon-btn" type="button" data-action="edit" data-code="${code}" data-name="${name}" data-pos="${f.position || 0}" title="编辑持仓" aria-label="编辑 ${name} 的持仓">${icon('edit')}</button>
            <button class="icon-btn danger" type="button" data-action="remove" data-code="${code}" title="移除自选" aria-label="将 ${name} 移出自选">${icon('trash-alt')}</button>
        </div>
    `;
}

function getFavoriteCardActions(f) {
    return `
        <div class="fund-card-actions">
            <button class="icon-btn" type="button" data-action="refresh" data-code="${escapeAttr(f.code)}" title="刷新估值" aria-label="刷新估值">${icon('sync-alt')}</button>
            <button class="icon-btn" type="button" data-action="edit" data-code="${escapeAttr(f.code)}" data-name="${escapeAttr(f.name)}" data-pos="${f.position || 0}" title="编辑持仓" aria-label="编辑持仓">${icon('edit')}</button>
            <button class="icon-btn danger" type="button" data-action="remove" data-code="${escapeAttr(f.code)}" title="移除自选" aria-label="移除自选">${icon('trash-alt')}</button>
        </div>
    `;
}

function renderSkeletonRow(f) {
    const position = Number(f.position) > 0 ? `¥${formatMoney(f.position)}` : '未填';
    return `
        <tr data-code="${escapeAttr(f.code)}">
            <td>
                <div class="fund-cell">
                    <button class="icon-btn drag-handle" type="button" title="拖拽排序" aria-label="拖拽排序">${icon('grip-vertical')}</button>
                    <div class="fund-id">
                        <span class="fund-name">${escapeHtml(f.name)}</span>
                        <span class="fund-code">${escapeHtml(f.code)}</span>
                    </div>
                </div>
            </td>
            <td class="num" data-field="nav"><span class="skeleton" style="width: 52px; margin-left: auto;"></span></td>
            <td class="num" data-field="estimate"><span class="skeleton" style="width: 48px; margin-left: auto;"></span></td>
            <td class="num" data-field="daily"><span class="skeleton" style="width: 44px; margin-left: auto;"></span></td>
            <td class="num" data-field="date"><span class="skeleton" style="width: 72px; margin-left: auto;"></span></td>
            <td class="num position-cell ${position === '未填' ? 'is-empty' : ''}">${position}</td>
            <td class="num" data-field="profit"><span class="skeleton" style="width: 60px; margin-left: auto;"></span></td>
            <td>${getFavoriteActions(f)}</td>
        </tr>
    `;
}

function renderSkeletonCard(f) {
    return `
        <div class="fund-card" data-code="${escapeAttr(f.code)}">
            <div class="fund-card-top">
                <button class="icon-btn drag-handle fund-card-handle" type="button" title="拖拽排序" aria-label="拖拽排序">${icon('grip-vertical')}</button>
                <div class="fund-card-id">
                    <div class="fund-card-name">${escapeHtml(f.name)}</div>
                    <div class="fund-card-meta">${escapeHtml(f.code)}<span class="fund-card-date">加载中…</span></div>
                </div>
                <div class="fund-card-profit">
                    <div class="fund-card-profit-value"><span class="skeleton" style="width: 56px; height: 16px;"></span></div>
                    <div class="fund-card-profit-label">今日估算收益</div>
                </div>
            </div>
            <div class="fund-card-grid">
                <div><div class="stat-label">参考净值</div><div class="stat-value" data-field="nav"><span class="skeleton" style="width: 48px;"></span></div></div>
                <div><div class="stat-label">估算涨幅</div><div class="stat-value" data-field="estimate"><span class="skeleton" style="width: 44px;"></span></div></div>
                <div><div class="stat-label">日涨跌</div><div class="stat-value" data-field="daily"><span class="skeleton" style="width: 40px;"></span></div></div>
            </div>
            <div class="fund-card-foot">
                <span class="fund-card-position is-empty">持仓 --</span>
                ${getFavoriteCardActions(f)}
            </div>
        </div>
    `;
}

function addToFavorites(code, name) {
    if (!code) { showToast('请先查询基金', 'error'); return; }

    const favs = getStorage('fundFavorites', []);
    if (favs.find(f => f.code === code)) { showToast('已在自选中', 'info'); return; }

    favs.push({ code, name, position: 0 });
    setStorage('fundFavorites', favs);
    showToast('已加入自选', 'success');

    const tbody = document.getElementById('favoritesList');
    const cards = document.getElementById('favoritesCardList');
    const empty = document.getElementById('emptyFavorites');
    const tableWrap = document.querySelector('.table-wrap');
    if (empty) empty.hidden = true;
    if (tableWrap) tableWrap.hidden = false;
    tbody.insertAdjacentHTML('beforeend', renderSkeletonRow({ code, name, position: 0 }));
    cards.insertAdjacentHTML('beforeend', renderSkeletonCard({ code, name, position: 0 }));
    updateFavoritesMeta();

    const addBtn = document.getElementById('drawerAddBtn') || document.getElementById('detailAddBtn');
    if (addBtn) {
        addBtn.disabled = true;
        addBtn.textContent = '已在自选';
    }

    getFundData(code).then(data => {
        const fundData = toFundViewModel({ code, name }, data, 0);
        fundViewCache.set(code, fundData);
        updateFundRow(fundData);
        updateFundCard(fundData);
        renderSummary(Array.from(fundViewCache.values()));
        updateFavoritesMeta();
    }).catch(() => {
        const failedData = { code, name, position: 0, dwjz: '--', gszzl: 0, jzzzl: 0, jzrq: '--', failed: true };
        fundViewCache.set(code, failedData);
        updateFundRow(failedData);
        updateFundCard(failedData);
        renderSummary(Array.from(fundViewCache.values()));
        updateFavoritesMeta();
    });
}

function removeFromFavorites(code) {
    showDialog({
        type: 'danger',
        title: '移除自选',
        desc: '移除后本地持仓记录也会一并删除，确定继续吗？',
        confirmText: '移除',
        onConfirm: () => {
            const favs = getStorage('fundFavorites', []);
            setStorage('fundFavorites', favs.filter(f => f.code !== code));
            fundViewCache.delete(code);
            derivedEstimateCache.delete(code);

            const row = document.querySelector(`#favoritesList tr[data-code="${code}"]`);
            const card = document.querySelector(`#favoritesCardList .fund-card[data-code="${code}"]`);
            [row, card].forEach(el => {
                if (!el) return;
                el.style.transition = 'opacity 180ms ease, transform 180ms ease';
                el.style.opacity = '0';
                el.style.transform = 'translateX(-12px)';
                setTimeout(() => el.remove(), 180);
            });

            setTimeout(() => {
                const remaining = getStorage('fundFavorites', []);
                if (!remaining.length) renderFavorites(true);
            }, 200);

            renderSummary(Array.from(fundViewCache.values()));
            updateFavoritesMeta();
            showToast('已移除', 'info');
        }
    });
}

function mountDialog(className, innerHTML) {
    const opener = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = className ? `dialog ${className}` : 'dialog';
    dialog.innerHTML = innerHTML;
    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.addEventListener('close', () => {
        dialog.remove();
        if (opener && opener.isConnected && typeof opener.focus === 'function') {
            opener.focus();
        }
    }, { once: true });
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
    });
    return dialog;
}

function editPosition(code, name, current = 0) {
    const dialog = mountDialog('', `
        <div class="dialog-header">
            <h3 class="dialog-title" id="posDialogTitle">编辑持仓</h3>
            <p class="dialog-desc">${escapeHtml(name)} · ${escapeHtml(code)}</p>
        </div>
        <div class="dialog-body">
            <label class="field-label" for="posInput">持仓金额（元）</label>
            <input type="number" id="posInput" class="dialog-input" placeholder="0.00" value="${current > 0 ? current.toFixed(2) : ''}" step="0.01" min="0" inputmode="decimal">
            <p class="field-hint">持仓金额作为当前成本，用于估算今日收益；填 0 表示仅关注。</p>
            <p class="field-error" id="posError" role="alert" hidden></p>
        </div>
        <div class="dialog-footer">
            <button class="btn btn-secondary" id="cancelPos" type="button">取消</button>
            <button class="btn btn-primary" id="savePos" type="button">保存</button>
        </div>
    `);

    const input = dialog.querySelector('#posInput');
    const errorEl = dialog.querySelector('#posError');
    input.focus();
    input.select();

    const close = () => {
        if (dialog.open) dialog.close();
    };

    dialog.querySelector('#cancelPos').onclick = close;
    dialog.querySelector('#savePos').onclick = () => {
        const raw = input.value.trim();
        const val = raw === '' ? 0 : Number(raw);
        if (!Number.isFinite(val) || val < 0) {
            errorEl.textContent = '请输入不小于 0 的金额';
            errorEl.hidden = false;
            input.focus();
            return;
        }

        const favs = getStorage('fundFavorites', []);
        const idx = favs.findIndex(f => f.code === code);
        if (idx !== -1) {
            favs[idx].position = val;
            setStorage('fundFavorites', favs);
        }
        close();
        showToast('持仓已保存', 'success');

        const cached = fundViewCache.get(code);
        if (cached) {
            const merged = { ...cached, position: val };
            fundViewCache.set(code, merged);
            updateFundRow(merged);
            updateFundCard(merged);
        }
        renderSummary(Array.from(fundViewCache.values()));
        updateFavoritesMeta();
    };
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            dialog.querySelector('#savePos').click();
        }
    });
}

function showDialog({ type, title, desc, confirmText, onConfirm }) {
    const dialog = mountDialog('', `
        <div class="dialog-header">
            <h3 class="dialog-title" id="confirmTitle">${escapeHtml(title)}</h3>
            <p class="dialog-desc">${escapeHtml(desc)}</p>
        </div>
        <div class="dialog-footer" style="padding-top: 20px;">
            <button class="btn btn-secondary" id="cancelDlg" type="button">取消</button>
            <button class="btn ${type === 'danger' ? 'btn-danger-outline' : 'btn-primary'}" id="confirmDlg" type="button">${escapeHtml(confirmText)}</button>
        </div>
    `);

    dialog.querySelector('#cancelDlg').onclick = () => dialog.close();
    dialog.querySelector('#confirmDlg').onclick = () => { dialog.close(); onConfirm(); };
    dialog.querySelector('#cancelDlg').focus();
}

function renderSummary(fundList) {
    const section = document.getElementById('summarySection');
    const grid = document.getElementById('summaryGrid');
    if (!section || !grid) return;
    const summary = summarizePortfolio(fundList);

    if (!showPositions || !summary.count) {
        section.hidden = true;
        return;
    }

    const profitClass = valueClass(summary.totalProfit);
    const rateClass = valueClass(summary.totalProfitRate);

    section.hidden = false;
    grid.innerHTML = `
        <div class="summary-item">
            <div class="summary-label">总投入</div>
            <div class="summary-value">¥${formatMoney(summary.totalPosition)}</div>
            <div class="summary-change">${summary.count} 只持仓基金</div>
        </div>
        <div class="summary-item">
            <div class="summary-label">估算市值</div>
            <div class="summary-value">¥${formatMoney(summary.totalMarketValue)}</div>
            <div class="summary-change">无估值基金按持仓成本计</div>
        </div>
        <div class="summary-item">
            <div class="summary-label">今日估算收益</div>
            <div class="summary-value ${profitClass}">${formatProfit(summary.totalProfit)}</div>
            <div class="summary-change ${rateClass}">${formatRate(summary.totalProfitRate)} · 仅统计有盘中估值的基金</div>
        </div>
        <div class="summary-item">
            <div class="summary-label">持仓数量</div>
            <div class="summary-value">${summary.count} 只</div>
            <div class="summary-change">${summary.estimatedCount} 只有盘中估值</div>
        </div>
    `;
}

function updateFavoritesMeta() {
    const el = document.getElementById('favoritesMeta');
    if (!el) return;
    const favs = getStorage('fundFavorites', []);
    if (!favs.length) {
        el.textContent = '暂无自选，先搜索添加';
        return;
    }
    const codes = new Set(favs.map(f => f.code));
    const views = Array.from(fundViewCache.values()).filter(v => codes.has(v.code));
    const estimated = views.filter(v => v.has_estimate).length;
    const latest = views.map(v => v.update_time).filter(Boolean).sort().pop();
    el.textContent = `${favs.length} 只基金 · ${estimated} 只有盘中估值${latest ? ` · 估值时间 ${latest}` : ''}`;
}

function renderFavorites(force = false) {
    const favs = getStorage('fundFavorites', []);
    const tbody = document.getElementById('favoritesList');
    const cards = document.getElementById('favoritesCardList');
    const empty = document.getElementById('emptyFavorites');
    const tableWrap = document.querySelector('.table-wrap');
    const meta = document.getElementById('favoritesMeta');

    if (!favs.length) {
        tbody.innerHTML = '';
        cards.innerHTML = '';
        empty.hidden = false;
        if (tableWrap) tableWrap.hidden = true;
        document.getElementById('summarySection').hidden = true;
        if (meta) meta.textContent = '暂无自选，先搜索添加';
        return;
    }

    empty.hidden = true;
    if (tableWrap) tableWrap.hidden = false;

    const hasExistingData = !force && tbody.querySelector('tr[data-code]') && !tbody.querySelector('.skeleton');
    if (!hasExistingData) {
        tbody.innerHTML = favs.map(renderSkeletonRow).join('');
        cards.innerHTML = favs.map(renderSkeletonCard).join('');
        if (meta) meta.textContent = '正在获取估值…';
    }

    bindFavoriteEvents();
    initDragSort();
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
    const requestId = ++valuationRequestId;

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
    Array.from(derivedEstimateCache.keys()).forEach((code) => {
        if (!activeCodes.has(code)) derivedEstimateCache.delete(code);
    });

    const needsDerived = [];
    const hasFastEstimate = favs.some(fav => fastMap[fav.code]?.has_estimate);
    const mayDerive = hasFastEstimate || canDeriveEstimates();
    favs.forEach((fav) => {
        const base = fastMap[fav.code];
        if (!base || base.has_estimate) return;
        const cached = derivedEstimateCache.get(fav.code);
        if (cached && cached.expiresAt > Date.now() && cached.data.has_estimate) {
            fastMap[fav.code] = { ...base, ...cached.data };
        } else if (mayDerive) {
            needsDerived.push(fav);
        }
    });

    if (requestId !== valuationRequestId) return;

    favs.forEach((fav) => {
        const fundData = toFundViewModel(fav, fastMap[fav.code], fav.position);
        fundViewCache.set(fav.code, fundData);
        updateFundRow(fundData);
        updateFundCard(fundData);
    });

    renderSummary(Array.from(fundViewCache.values()));
    updateFavoritesMeta();

    if (!needsDerived.length) return;

    const derivedResults = await mapWithLimit(needsDerived.slice(0, 10), 3, async (fav) => {
        const estimate = await getDerivedEstimate(fav.code);
        return { code: fav.code, estimate };
    });
    if (requestId !== valuationRequestId) return;

    let changed = false;
    derivedResults.forEach(({ code, estimate }) => {
        if (!estimate || !estimate.has_estimate) return;
        const current = fundViewCache.get(code);
        if (!current) return;
        const merged = { ...current, ...estimate, has_estimate: true };
        fundViewCache.set(code, merged);
        updateFundRow(merged);
        updateFundCard(merged);
        changed = true;
    });
    if (changed) {
        renderSummary(Array.from(fundViewCache.values()));
        updateFavoritesMeta();
    }
}

function updateFundRow(f) {
    const row = document.querySelector(`#favoritesList tr[data-code="${f.code}"]`);
    if (!row) return;

    const ch = resolveEstimateChange(f);
    const jzCh = formatChange(f.jzzzl);
    const p = calcProfit(f.position, f.gsz, f.dwjz, !!f.has_estimate);
    const pCls = p.has ? valueClass(p.profit) : '';
    const fallbackTitle = ch.fallback
        ? `无盘中估值，显示 ${f.jzrq && f.jzrq !== '--' ? f.jzrq : '最新'} 净值日涨跌`
        : '';
    const navTitle = f.update_time ? `估值时间 ${f.update_time}` : (f.jzrq ? `净值日期 ${f.jzrq}` : '');
    const position = Number(f.position) > 0 ? `¥${formatMoney(f.position)}` : '未填';

    row.innerHTML = `
        <td>
            <div class="fund-cell">
                <button class="icon-btn drag-handle" type="button" title="拖拽排序" aria-label="拖拽排序">${icon('grip-vertical')}</button>
                <div class="fund-id">
                    <span class="fund-name">${escapeHtml(f.name)}</span>
                    <span class="fund-code">${escapeHtml(f.code)}</span>
                </div>
            </div>
        </td>
        <td class="num" data-field="nav"><span class="nav-value">${escapeHtml(f.gsz || '--')}</span></td>
        <td class="num" data-field="estimate">
            <span class="change ${ch.fallback ? 'is-fallback' : ch.cls}"${fallbackTitle ? ` title="${escapeAttr(fallbackTitle)}"` : ''}>${escapeHtml(ch.value)}${ch.fallback ? '<span class="fallback-tag">净值</span>' : ''}</span>
        </td>
        <td class="num" data-field="daily"><span class="change ${f.failed ? 'neutral' : jzCh.cls}">${f.failed ? '--' : escapeHtml(jzCh.value)}</span></td>
        <td class="num date-cell" data-field="date" title="${escapeAttr(navTitle)}">${escapeHtml(f.jzrq || '--')}</td>
        <td class="num position-cell ${position === '未填' ? 'is-empty' : ''}">${position}</td>
        <td class="num profit-cell ${pCls}" data-field="profit">${p.has ? formatProfit(p.profit) : '--'}</td>
        <td>${getFavoriteActions(f)}</td>
    `;
}

function updateFundCard(f) {
    const card = document.querySelector(`#favoritesCardList .fund-card[data-code="${f.code}"]`);
    if (!card) return;

    const ch = resolveEstimateChange(f);
    const jzCh = formatChange(f.jzzzl);
    const p = calcProfit(f.position, f.gsz, f.dwjz, !!f.has_estimate);
    const pCls = p.has ? valueClass(p.profit) : '';
    const fallbackTitle = ch.fallback
        ? `无盘中估值，显示 ${f.jzrq && f.jzrq !== '--' ? f.jzrq : '最新'} 净值日涨跌`
        : '';
    const date = f.jzrq && f.jzrq !== '--' ? f.jzrq : '暂无净值日期';
    const positionText = Number(f.position) > 0 ? `持仓 ¥${formatMoney(f.position)}` : '持仓未填';

    card.innerHTML = `
        <div class="fund-card-top">
            <button class="icon-btn drag-handle fund-card-handle" type="button" title="拖拽排序" aria-label="拖拽排序">${icon('grip-vertical')}</button>
            <div class="fund-card-id">
                <div class="fund-card-name">${escapeHtml(f.name)}</div>
                <div class="fund-card-meta">${escapeHtml(f.code)}<span class="fund-card-date">${escapeHtml(date)}</span></div>
            </div>
            <div class="fund-card-profit">
                <div class="fund-card-profit-value ${pCls}">${p.has ? formatProfit(p.profit) : '--'}</div>
                <div class="fund-card-profit-label">今日估算收益</div>
            </div>
        </div>
        <div class="fund-card-grid">
            <div>
                <div class="stat-label">${f.has_estimate ? '估算净值' : '最新净值'}</div>
                <div class="stat-value" data-field="nav">${escapeHtml(f.gsz || '--')}</div>
            </div>
            <div>
                <div class="stat-label">估算涨幅</div>
                <div class="stat-value change ${ch.fallback ? 'is-fallback' : ch.cls}" data-field="estimate"${fallbackTitle ? ` title="${escapeAttr(fallbackTitle)}"` : ''}>${escapeHtml(ch.value)}${ch.fallback ? '<span class="fallback-tag">净值</span>' : ''}</div>
            </div>
            <div>
                <div class="stat-label">日涨跌</div>
                <div class="stat-value change ${f.failed ? 'neutral' : jzCh.cls}" data-field="daily">${f.failed ? '--' : escapeHtml(jzCh.value)}</div>
            </div>
        </div>
        <div class="fund-card-foot">
            <span class="fund-card-position ${Number(f.position) > 0 ? '' : 'is-empty'}">${positionText}</span>
            ${getFavoriteCardActions(f)}
        </div>
    `;
}

function refreshSingleFund(code) {
    const favs = getStorage('fundFavorites', []);
    const fav = favs.find(f => f.code === code);
    if (!fav) return;

    showToast(`正在刷新 ${code}`, 'info');

    const row = document.querySelector(`#favoritesList tr[data-code="${code}"]`);
    const card = document.querySelector(`#favoritesCardList .fund-card[data-code="${code}"]`);
    [row, card].forEach(el => {
        ['nav', 'estimate', 'daily'].forEach(field => {
            const cell = el?.querySelector(`[data-field="${field}"]`);
            if (cell) cell.innerHTML = '<span class="skeleton" style="width: 44px;"></span>';
        });
    });

    getFundData(code).then(data => {
        const fundData = toFundViewModel(fav, data, fav.position || 0);
        fundViewCache.set(code, fundData);
        updateFundRow(fundData);
        updateFundCard(fundData);
        renderSummary(Array.from(fundViewCache.values()));
        updateFavoritesMeta();
        showToast('刷新成功', 'success');
    }).catch(() => {
        const failedData = { code, name: fav.name, position: fav.position || 0, dwjz: '--', gszzl: 0, jzzzl: 0, jzrq: '--', failed: true };
        fundViewCache.set(code, failedData);
        updateFundRow(failedData);
        updateFundCard(failedData);
        renderSummary(Array.from(fundViewCache.values()));
        updateFavoritesMeta();
        showToast('刷新失败', 'error');
    });
}

let favoriteEventsBound = false;

function handleFavoriteAction(button) {
    const action = button.dataset.action;
    const code = button.dataset.code;
    if (!action || !code) return;
    if (action === 'remove') removeFromFavorites(code);
    else if (action === 'detail') showFundDetail(code);
    else if (action === 'edit') editPosition(code, button.dataset.name || '', parseFloat(button.dataset.pos) || 0);
    else if (action === 'refresh') refreshSingleFund(code);
}

function bindFavoriteEvents() {
    if (favoriteEventsBound) return;
    favoriteEventsBound = true;

    const tbody = document.getElementById('favoritesList');
    const cards = document.getElementById('favoritesCardList');

    tbody.addEventListener('click', (e) => {
        if (e.target.closest('.drag-handle')) return;
        const button = e.target.closest('[data-action]');
        if (button) {
            e.stopPropagation();
            handleFavoriteAction(button);
            return;
        }
        const row = e.target.closest('tr[data-code]');
        if (row) showFundDetail(row.dataset.code);
    });

    cards.addEventListener('click', (e) => {
        if (e.target.closest('.drag-handle')) return;
        const button = e.target.closest('[data-action]');
        if (button) {
            e.stopPropagation();
            handleFavoriteAction(button);
            return;
        }
        const card = e.target.closest('.fund-card[data-code]');
        if (card) showFundDetail(card.dataset.code);
    });
}

async function sortFavorites() {
    const favs = getStorage('fundFavorites', []);
    if (!favs.length) { showToast('暂无自选', 'info'); return; }

    showToast('排序中…', 'info');
    try {
        const fastMap = await fetchFastValuationsChunked(favs.map(f => f.code));
        const sorted = favs.map((fav) => {
            const data = fastMap[fav.code];
            const cached = fundViewCache.get(fav.code);
            const model = data && (data.has_estimate || !cached)
                ? toFundViewModel(fav, data, fav.position)
                : cached;
            const change = model ? Number.parseFloat(resolveEstimateChange(model).value) : NaN;
            return { fav, change: Number.isFinite(change) ? change : 0 };
        }).sort((a, b) => b.change - a.change);
        setStorage('fundFavorites', sorted.map(({ fav }) => ({
            code: fav.code,
            name: fav.name,
            position: fav.position || 0,
        })));
        renderFavorites(true);
        showToast('已按今日估算涨幅排序', 'success');
    } catch { showToast('排序失败', 'error'); }
}

function toggleAutoRefresh(enable, silent = false) {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    refreshTimerInterval = null;
    if (enable) {
        startAutoRefresh();
        setStorage('autoRefreshEnabled', true);
        if (!silent) showToast('自动刷新已开启', 'success');
    } else {
        setStorage('autoRefreshEnabled', false);
        if (!silent) showToast('自动刷新已关闭', 'info');
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
        if (row && row !== draggedItem) row.classList.add('drag-over');
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

        if (fromIdx < toIdx) parent.insertBefore(draggedItem, row.nextSibling);
        else parent.insertBefore(draggedItem, row);

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

    cards.addEventListener('mousedown', (e) => {
        const handle = e.target.closest('.drag-handle');
        if (!handle) return;
        const card = handle.closest('.fund-card');
        if (card) card.setAttribute('draggable', 'true');
    });

    cards.addEventListener('mouseup', (e) => {
        const handle = e.target.closest('.drag-handle');
        if (!handle) return;
        const card = handle.closest('.fund-card');
        if (card) setTimeout(() => card.setAttribute('draggable', 'false'), 100);
    });

    cards.addEventListener('dragstart', (e) => {
        const card = e.target.closest('.fund-card');
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
        const card = e.target.closest('.fund-card');
        if (card && card !== draggedItem) card.classList.add('drag-over');
    });

    cards.addEventListener('dragleave', (e) => {
        const card = e.target.closest('.fund-card');
        if (card) card.classList.remove('drag-over');
    });

    cards.addEventListener('drop', (e) => {
        e.preventDefault();
        const card = e.target.closest('.fund-card');
        if (card) card.classList.remove('drag-over');
        if (!draggedItem || !card || draggedItem === card) return;

        const fromCode = draggedCode;
        const toCode = card.dataset.code;
        const parent = draggedItem.parentNode;
        const allCards = Array.from(parent.querySelectorAll('.fund-card[data-code]'));
        const fromIdx = allCards.indexOf(draggedItem);
        const toIdx = allCards.indexOf(card);

        if (fromIdx < toIdx) parent.insertBefore(draggedItem, card.nextSibling);
        else parent.insertBefore(draggedItem, card);

        syncRowOrder(fromCode, toCode, fromIdx, toIdx);
        saveOrderFromDOM();
    });

    cards.addEventListener('dragend', (e) => {
        const card = e.target.closest('.fund-card');
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
        const card = handle?.closest('.fund-card');
        if (!card) return;
        e.preventDefault();
        active = { card, pointerId: e.pointerId };
        card.classList.add('dragging');
        handle.setPointerCapture?.(e.pointerId);
    });

    container.addEventListener('pointermove', (e) => {
        if (!active || e.pointerId !== active.pointerId) return;
        e.preventDefault();
        const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.fund-card');
        container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        if (target && target !== active.card) target.classList.add('drag-over');
    });

    const finish = (e) => {
        if (!active || e.pointerId !== active.pointerId) return;
        const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.fund-card');
        active.card.classList.remove('dragging');
        container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

        if (target && target !== active.card) {
            const parent = active.card.parentNode;
            const allCards = Array.from(parent.querySelectorAll('.fund-card[data-code]'));
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
    const fromCard = cards.querySelector(`.fund-card[data-code="${fromCode}"]`);
    const toCard = cards.querySelector(`.fund-card[data-code="${toCode}"]`);
    if (!fromCard || !toCard) return;

    if (fromIdx < toIdx) cards.insertBefore(fromCard, toCard.nextSibling);
    else cards.insertBefore(fromCard, toCard);
}

function syncRowOrder(fromCode, toCode, fromIdx, toIdx) {
    const tbody = document.getElementById('favoritesList');
    const fromRow = tbody.querySelector(`tr[data-code="${fromCode}"]`);
    const toRow = tbody.querySelector(`tr[data-code="${toCode}"]`);
    if (!fromRow || !toRow) return;

    if (fromIdx < toIdx) tbody.insertBefore(fromRow, toRow.nextSibling);
    else tbody.insertBefore(fromRow, toRow);
}

function saveOrderFromDOM() {
    const rows = document.querySelectorAll('#favoritesList tr[data-code]');
    const newOrder = Array.from(rows).map(r => r.dataset.code);

    const favs = getStorage('fundFavorites', []);
    const favMap = {};
    favs.forEach(f => { favMap[f.code] = f; });

    const reordered = newOrder.map(code => favMap[code]).filter(Boolean);
    setStorage('fundFavorites', reordered);
}

// ========== Data Backup ==========
function getBackupState() {
    const favorites = getStorage('fundFavorites', []);
    const searchHistory = getStorage('searchHistory', []);
    return {
        favorites: Array.isArray(favorites) ? favorites : [],
        searchHistory: Array.isArray(searchHistory) ? searchHistory : [],
        autoRefreshEnabled: getStorage('autoRefreshEnabled', false) === true,
    };
}

function formatBackupTime(value) {
    if (!value) return '未知时间';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '未知时间';
    return date.toLocaleString('zh-CN', { hour12: false });
}

function downloadBackup() {
    const backup = createBackup(getBackupState());
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const date = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    const link = document.createElement('a');
    link.href = url;
    link.download = `guzhi-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function applyImportedData(data, mode) {
    const local = getBackupState();
    const merge = mode === 'merge';
    const favorites = merge ? mergeFavorites(local.favorites, data.favorites) : data.favorites;
    const searchHistory = merge ? mergeSearchHistory(local.searchHistory, data.searchHistory) : data.searchHistory;
    const autoRefreshEnabled = merge ? local.autoRefreshEnabled : data.autoRefreshEnabled;

    setStorage('fundFavorites', favorites);
    setStorage('searchHistory', searchHistory);

    const switchEl = document.getElementById('autoRefreshSwitch');
    if (switchEl) switchEl.checked = autoRefreshEnabled;
    toggleAutoRefresh(autoRefreshEnabled, true);

    renderHistory();
    renderFavorites(true);

    return { favorites: favorites.length, searchHistory: searchHistory.length };
}

function openBackupDialog(options = {}) {
    const dialog = mountDialog('backup-dialog', `
        <div class="dialog-header">
            <h3 class="dialog-title" id="backupDialogTitle">数据备份</h3>
            <p class="dialog-desc">导出自选、持仓金额、搜索记录和自动刷新设置</p>
            <button class="dialog-close" id="closeBackupTop" type="button" aria-label="关闭" title="关闭">${icon('xmark')}</button>
        </div>
        <div class="dialog-body" id="backupDialogBody"></div>
        <div class="dialog-footer" id="backupDialogFooter"></div>
    `);

    const body = dialog.querySelector('#backupDialogBody');
    const footer = dialog.querySelector('#backupDialogFooter');
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'backupFileInput';
    fileInput.accept = '.json,application/json';
    fileInput.style.display = 'none';
    dialog.appendChild(fileInput);

    let parsedBackup = null;

    const close = () => {
        if (dialog.open) dialog.close();
    };

    const finishImport = (mode) => {
        if (!parsedBackup) return;
        const result = applyImportedData(parsedBackup, mode);
        close();
        showToast(
            `${mode === 'merge' ? '已合并导入' : '已覆盖导入'}：${result.favorites} 只基金、${result.searchHistory} 条搜索记录`,
            'success'
        );
    };

    const renderHome = (errorMessage = '') => {
        parsedBackup = null;
        const state = getBackupState();
        body.innerHTML = `
            <div class="backup-actions">
                <button type="button" class="btn btn-primary" id="exportBackupBtn">${icon('download')}导出备份</button>
                <button type="button" class="btn btn-secondary" id="importBackupBtn">${icon('upload')}导入备份</button>
            </div>
            <p class="backup-hint">
                当前数据：${state.favorites.length} 只自选基金 · ${state.searchHistory.length} 条搜索记录。<br>
                备份文件只保存在本机，包含持仓金额，请妥善保管。
            </p>
            ${errorMessage ? `<p class="backup-error">${escapeHtml(errorMessage)}</p>` : ''}
        `;
        footer.innerHTML = '<button type="button" class="btn btn-secondary" id="closeBackupDlg">关闭</button>';
        body.querySelector('#exportBackupBtn').onclick = () => {
            downloadBackup();
            showToast('备份已导出', 'success');
        };
        body.querySelector('#importBackupBtn').onclick = () => fileInput.click();
        footer.querySelector('#closeBackupDlg').onclick = close;
        body.querySelector('#exportBackupBtn').focus();
    };

    const renderPreview = (backup) => {
        parsedBackup = backup;
        const ignored = backup.ignored.favorites + backup.ignored.searchHistory;
        body.innerHTML = `
            <div class="backup-preview">
                <div class="backup-preview-title">备份文件校验通过</div>
                <div class="backup-preview-meta">
                    备份时间：${escapeHtml(formatBackupTime(backup.exportedAt))}<br>
                    自选基金：${backup.favorites.length} 只 · 搜索记录：${backup.searchHistory.length} 条<br>
                    自动刷新：${backup.autoRefreshEnabled ? '开启' : '关闭'}
                </div>
                ${ignored ? `<p class="backup-warning">已忽略 ${ignored} 条无效记录</p>` : ''}
            </div>
            <p class="backup-hint">合并会保留本机独有的基金，同代码使用备份中的名称和持仓；覆盖会用备份完整替换本机自选和搜索记录。</p>
            <button type="button" class="backup-link" id="backupReselect">重新选择文件</button>
        `;
        footer.innerHTML = `
            <button type="button" class="btn btn-primary" id="backupMerge">合并导入</button>
            <button type="button" class="btn btn-danger-outline" id="backupReplace">覆盖导入</button>
        `;
        body.querySelector('#backupReselect').onclick = () => fileInput.click();
        footer.querySelector('#backupMerge').onclick = () => finishImport('merge');
        footer.querySelector('#backupReplace').onclick = () => finishImport('replace');
        footer.querySelector('#backupMerge').focus();
    };

    fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (!file) return;
        if (file.size > MAX_BACKUP_FILE_SIZE) {
            renderHome('备份文件过大，最大支持 1MB');
            return;
        }
        try {
            renderPreview(parseBackup(await file.text()));
        } catch (error) {
            renderHome(error && error.message ? error.message : '导入失败');
        }
    });

    dialog.querySelector('#closeBackupTop').addEventListener('click', close);

    renderHome();
    if (options.startImport) fileInput.click();
}

// ========== Init ==========
function init() {
    const searchForm = document.getElementById('searchForm');
    const fundCode = document.getElementById('fundCode');
    const drawer = getDrawer();

    searchForm.addEventListener('submit', (event) => {
        event.preventDefault();
        searchFund();
    });

    fundCode.addEventListener('input', () => {
        fundCode.value = fundCode.value.replace(/\D/g, '').slice(0, 6);
        setSearchError('');
    });

    fundCode.addEventListener('focus', () => {
        historyOpen = true;
        renderHistory();
    });

    fundCode.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            historyOpen = false;
            renderHistory();
            fundCode.blur();
        }
    });

    document.getElementById('clearHistoryBtn').onclick = clearSearchHistory;
    document.getElementById('refreshFavoritesBtn').onclick = () => {
        renderFavorites(true);
        showToast('正在刷新全部自选', 'info');
    };
    document.getElementById('sortFavoritesBtn').onclick = sortFavorites;
    document.getElementById('backupBtn').onclick = () => openBackupDialog();
    document.getElementById('restoreBackupBtn').onclick = () => openBackupDialog({ startImport: true });
    document.getElementById('emptySearchBtn').onclick = () => {
        fundCode.focus();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    document.getElementById('autoRefreshSwitch').onchange = (e) => toggleAutoRefresh(e.target.checked);

    document.getElementById('drawerClose').onclick = closeDrawer;
    document.getElementById('drawerBack').onclick = () => {
        if (drawerState.backFund) renderSearchResult(drawerState.backFund);
    };

    drawer.addEventListener('close', () => {
        document.body.classList.remove('drawer-open');
        const opener = drawerOpener;
        drawerOpener = null;
        const focusTarget = opener && opener.isConnected && opener.matches('button, a[href], input, select, textarea, [tabindex]')
            ? opener
            : document.getElementById('searchBtn');
        if (focusTarget) focusTarget.focus();
        if (fundDetailChart) {
            fundDetailChart.destroy();
            fundDetailChart = null;
        }
    });

    drawer.addEventListener('click', (event) => {
        if (event.target !== drawer) return;
        const rect = drawer.getBoundingClientRect();
        const outside = event.clientX < rect.left || event.clientX > rect.right
            || event.clientY < rect.top || event.clientY > rect.bottom;
        if (outside) closeDrawer();
    });

    document.addEventListener('click', (event) => {
        if (!event.target.closest('.search-area')) closeHistory();
    });

    initPositionVisibility();
    checkTradingStatus();
    renderHistory();
    renderFavorites();

    if (getStorage('autoRefreshEnabled')) {
        document.getElementById('autoRefreshSwitch').checked = true;
        toggleAutoRefresh(true, true);
    }
}

document.addEventListener('DOMContentLoaded', init);
