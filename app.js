// ========== Constants ==========
const API_BASE_URL = '/api';
const TRADING_REFRESH_INTERVAL = 60000;  // 交易中：1分钟
const CLOSED_REFRESH_INTERVAL = 300000; // 休市时：5分钟
const MAX_SEARCH_HISTORY = 10;
const MAX_RETRY_COUNT = 2;
let refreshTimer = null;
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
    let icon = 'fa-moon';

    if (is_trading) {
        statusClass = 'status-trading';
        icon = 'fa-chart-line';
    } else if (status === 'weekend' || status === 'holiday') {
        statusClass = 'status-holiday';
        icon = 'fa-calendar-xmark';
    }

    statusEl.innerHTML = `
        <span class="status-indicator ${statusClass}">
            <i class="fas ${icon}"></i>
            ${status_text}
        </span>
        ${next_open ? `<span class="next-open">下次开盘: ${next_open}</span>` : ''}
    `;
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
    'edit': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    'info-circle': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    'exclamation-circle': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    'exclamation-triangle': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    'grip-vertical': '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>'
};

function icon(name) {
    return `<span class="svg-icon">${ICONS[name] || ''}</span>`;
}

// ========== Utility Functions ==========
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showToast(message, type = 'info') {
    const old = document.querySelector('.toast');
    if (old) old.remove();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 200); }, 2500);
}

function formatChange(change) {
    const v = parseFloat(change).toFixed(2);
    let c = 'neutral';
    if (v > 0) c = 'positive';
    else if (v < 0) c = 'negative';
    return { value: `${v}%`, cls: c };
}

function formatMoney(num) {
    if (num === null || num === undefined || num === '--') return '--';
    return parseFloat(num).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function calcProfit(pos, val, nav) {
    if (!pos || !val || !nav) return { profit: 0, rate: 0, has: false };
    const shares = pos / nav;
    const profit = shares * val - pos;
    return { profit, rate: (profit / pos) * 100, has: true };
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
const FUND_GZ_URL = 'https://fundgz.1234567.com.cn/js/{code}.js';

function getFundGZ(code) {
    return Promise.reject(new Error('JSONP 接口已废弃'));
}

async function getFundNav(code) {
    try {
        const timestamp = Date.now();
        const response = await axios.get(`${API_BASE_URL}/fund/${code}`, {
            timeout: 15000,
            params: { _t: timestamp }
        });
        if (response.data.success) return response.data.data;
    } catch (e) {}
    return null;
}

async function getFundData(code, retryCount = 0) {
    if (!/^\d{6}$/.test(code)) throw new Error('基金代码必须为6位数字');

    const [gzData, navData] = await Promise.allSettled([
        getFundGZ(code).catch(() => null),
        getFundNav(code).catch(() => null)
    ]);

    const gz = gzData.status === 'fulfilled' ? gzData.value : null;
    const nav = navData.status === 'fulfilled' ? navData.value : null;

    if (!gz && !nav) {
        const msg = '获取基金数据失败';
        showToast(msg, 'error');
        throw new Error(msg);
    }

    return {
        code: code,
        name: gz?.name || nav?.name || '',
        type: nav?.type || '',
        gsz: gz?.gsz || nav?.dwjz || '--',
        gszzl: gz?.gszzl || nav?.gszzl || '0',
        jzzzl: nav?.jzzzl || '0',
        gztime: gz?.gztime || nav?.jzrq || '--',
        dwjz: nav?.dwjz || gz?.dwjz || '--',
        ljjz: nav?.ljjz || '--',
        jzrq: nav?.jzrq || gz?.jzrq || '--',
        sgzt: nav?.sgzt || '--',
        shzt: nav?.shzt || '--',
        source: gz ? 'realtime' : 'history',
        update_time: gz?.gztime || nav?.update_time || '--',
        hasRealtime: !!gz,
        has_estimate: nav?.has_estimate || false,
        stock_ratio: nav?.stock_ratio || 0,
        top_stocks: nav?.top_stocks || [],
        sectors: nav?.sectors || [],
        performance: nav?.performance || {}
    };
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
async function searchFund() {
    const code = document.getElementById('fundCode').value.trim();
    if (!code) { showToast('请输入基金代码', 'error'); return; }

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
        sessionStorage.setItem('currentFundData', JSON.stringify(fund));

        let pos = 0;
        const favs = getStorage('fundFavorites', []);
        const fav = favs.find(f => f.code === code);
        if (fav?.position) pos = fav.position;

        const ch = formatChange(fund.gszzl);
        const profit = calcProfit(pos, parseFloat(fund.gsz) || 0, parseFloat(fund.dwjz) || 0);

        const realtimeTag = fund.hasRealtime
            ? `<span style="background: var(--green-50); color: var(--green-600); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; margin-left: 0.5rem;">${icon('bolt')} 实时</span>`
            : (fund.has_estimate ? `<span style="background: var(--blue-50); color: var(--blue-600); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; margin-left: 0.5rem;">${icon('calculator')} 估算</span>` : `<span style="background: var(--gray-100); color: var(--gray-500); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; margin-left: 0.5rem;">${icon('clock')} 净值</span>`);

        const hasEstimate = fund.has_estimate && fund.gszzl !== '0' && fund.gszzl !== '0.00';
        const estimateValue = hasEstimate ? `${fund.gszzl}%` : ch.value;
        const estimateClass = hasEstimate ? (parseFloat(fund.gszzl) > 0 ? 'positive' : (parseFloat(fund.gszzl) < 0 ? 'negative' : 'neutral')) : ch.cls;

        let sectorsHtml = '';
        if (fund.sectors && fund.sectors.length > 0) {
            sectorsHtml = `
                <div style="padding: 0.75rem 1.5rem; border-top: 1px solid var(--gray-100);">
                    <div style="font-size: 0.8125rem; color: var(--gray-500); margin-bottom: 0.5rem;">关联板块</div>
                    <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                        ${fund.sectors.map(s => {
                            const cls = s.change_pct > 0 ? 'positive' : (s.change_pct < 0 ? 'negative' : 'neutral');
                            return `<span style="padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; background: var(--gray-50); border: 1px solid var(--gray-200);">
                                ${escapeHtml(s.name)} <span class="${cls}">${s.change_pct > 0 ? '+' : ''}${s.change_pct}%</span>
                            </span>`;
                        }).join('')}
                    </div>
                </div>
            `;
        }

        let stocksHtml = '';
        if (fund.top_stocks && fund.top_stocks.length > 0) {
            stocksHtml = `
                <div style="padding: 0.75rem 1.5rem; border-top: 1px solid var(--gray-100);">
                    <div style="font-size: 0.8125rem; color: var(--gray-500); margin-bottom: 0.5rem;">重仓股</div>
                    <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                        ${fund.top_stocks.map(s => {
                            const cls = s.change_pct > 0 ? 'positive' : (s.change_pct < 0 ? 'negative' : 'neutral');
                            return `<span style="padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; background: var(--gray-50); border: 1px solid var(--gray-200);">
                                ${escapeHtml(s.name)} <span class="${cls}">${s.change_pct > 0 ? '+' : ''}${s.change_pct}%</span>
                            </span>`;
                        }).join('')}
                    </div>
                </div>
            `;
        }

        let performanceHtml = '';
        if (fund.performance && (fund.performance.year || fund.performance.quarter)) {
            performanceHtml = `
                <div style="padding: 0.75rem 1.5rem; border-top: 1px solid var(--gray-100);">
                    <div style="font-size: 0.8125rem; color: var(--gray-500); margin-bottom: 0.5rem;">阶段收益</div>
                    <div style="display: flex; flex-wrap: wrap; gap: 1rem; font-size: 0.8125rem;">
                        ${fund.performance.month ? `<span>近1月: <span class="${fund.performance.month > 0 ? 'positive' : 'negative'}">${fund.performance.month > 0 ? '+' : ''}${fund.performance.month}%</span></span>` : ''}
                        ${fund.performance.quarter ? `<span>近3月: <span class="${fund.performance.quarter > 0 ? 'positive' : 'negative'}">${fund.performance.quarter > 0 ? '+' : ''}${fund.performance.quarter}%</span></span>` : ''}
                        ${fund.performance.half_year ? `<span>近6月: <span class="${fund.performance.half_year > 0 ? 'positive' : 'negative'}">${fund.performance.half_year > 0 ? '+' : ''}${fund.performance.half_year}%</span></span>` : ''}
                        ${fund.performance.year ? `<span>近1年: <span class="${fund.performance.year > 0 ? 'positive' : 'negative'}">${fund.performance.year > 0 ? '+' : ''}${fund.performance.year}%</span></span>` : ''}
                    </div>
                </div>
            `;
        }

        document.getElementById('fundInfo').innerHTML = `
            <div class="result-card">
                <div class="result-header">
                    <div style="display: flex; align-items: center;">
                        <div class="result-name">${escapeHtml(fund.name)}</div>
                        ${realtimeTag}
                    </div>
                    <div class="result-code">${fund.code} ${fund.type ? '· ' + escapeHtml(fund.type) : ''}</div>
                </div>
                <div class="result-grid">
                    <div class="result-item">
                        <div class="result-label">${hasEstimate ? '估算净值' : '最新净值'}</div>
                        <div class="result-value">${fund.gsz || '--'}</div>
                    </div>
                    <div class="result-item">
                        <div class="result-label">${hasEstimate ? '估算涨幅' : '日涨跌'}</div>
                        <div class="result-value ${estimateClass}">${estimateValue}</div>
                    </div>
                    <div class="result-item">
                        <div class="result-label">净值日期</div>
                        <div class="result-value">${fund.jzrq || '--'}</div>
                    </div>
                    <div class="result-item">
                        <div class="result-label">累计净值</div>
                        <div class="result-value">${fund.ljjz || '--'}</div>
                    </div>
                </div>
                <div style="padding: 0.75rem 1.5rem; background: var(--gray-50); border-top: 1px solid var(--gray-100); display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 0.8125rem; color: var(--gray-500);">
                        ${icon('clock')} ${fund.hasRealtime ? '估值时间' : '数据更新'}：${fund.update_time || '--'}
                    </span>
                    <span style="font-size: 0.8125rem; color: var(--gray-500);">
                        申购：${fund.sgzt || '--'} | 赎回：${fund.shzt || '--'}
                    </span>
                </div>
                ${sectorsHtml}
                ${stocksHtml}
                ${performanceHtml}
                <div class="result-actions">
                    <button id="addToFavoritesBtn" class="btn btn-success" data-code="${fund.code}" data-name="${escapeHtml(fund.name)}">
                        ${icon('star')}添加到自选
                    </button>
                    <button id="editPositionBtn" class="btn btn-secondary">
                        ${icon('edit')}编辑持仓
                    </button>
                    <button id="viewDetailBtn" class="btn btn-secondary" onclick="showFundDetail('${fund.code}')">
                        ${icon('info-circle')}查看详情
                    </button>
                </div>
            </div>
        `;

        // 绑定按钮事件
        document.getElementById('addToFavoritesBtn')?.addEventListener('click', addToFavorites);
        document.getElementById('editPositionBtn')?.addEventListener('click', () => {
            const btn = document.getElementById('addToFavoritesBtn');
            if (btn?.dataset.code) {
                const favs = getStorage('fundFavorites', []);
                const f = favs.find(x => x.code === btn.dataset.code);
                editPosition(btn.dataset.code, btn.dataset.name, f?.position || 0);
            }
        });

        saveSearchHistory(code, fund.name);
        showToast(fund.hasRealtime ? '实时估值获取成功' : '查询成功', 'success');
    } catch (e) {
        document.getElementById('fundInfo').innerHTML = `
            <div class="empty" style="padding: 2rem;">
                <div class="empty-icon" style="color: var(--red-500);">${icon('exclamation-circle')}</div>
                <p class="empty-title">${e.message || '查询失败'}</p>
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
        <div class="dialog dialog-large">
            <div class="dialog-header">
                <div class="dialog-icon info">${icon('chart-line')}</div>
                <h3 class="dialog-title">基金详情</h3>
                <p class="dialog-desc">正在加载...</p>
            </div>
            <div class="fund-detail-body" id="fundDetailContent">
                <div class="skeleton" style="height: 200px;"></div>
            </div>
            <div class="dialog-footer">
                <button class="btn btn-secondary" onclick="this.closest('.dialog-backdrop').remove()">关闭</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.onclick = (e) => { if (e.target === overlay) { if (fundDetailChart) { fundDetailChart.destroy(); fundDetailChart = null; } overlay.remove(); } };

    try {
        const fund = await getFundData(code);
        const ch = formatChange(fund.gszzl);
        const jzCh = formatChange(fund.jzzzl || 0);
        const stockPct = fund.stock_ratio ? (fund.stock_ratio * 100) : 0;
        const bondPct = fund.asset_allocation ? fund.asset_allocation.bond : 0;
        const cashPct = fund.asset_allocation ? fund.asset_allocation.cash : 0;
        const otherPct = Math.max(0, 100 - stockPct - bondPct - cashPct);

        document.getElementById('fundDetailContent').innerHTML = `
            <div class="fund-detail-grid">
                <div class="fund-detail-item">
                    <div class="fund-detail-label">估算净值</div>
                    <div class="fund-detail-value">${fund.gsz || fund.dwjz || '--'}</div>
                </div>
                <div class="fund-detail-item">
                    <div class="fund-detail-label">估算涨跌</div>
                    <div class="fund-detail-value ${ch.cls}">${ch.value}</div>
                </div>
                <div class="fund-detail-item">
                    <div class="fund-detail-label">最新净值</div>
                    <div class="fund-detail-value">${fund.dwjz || '--'}</div>
                </div>
                <div class="fund-detail-item">
                    <div class="fund-detail-label">日涨跌</div>
                    <div class="fund-detail-value ${jzCh.cls}">${jzCh.value}</div>
                </div>
                <div class="fund-detail-item">
                    <div class="fund-detail-label">累计净值</div>
                    <div class="fund-detail-value">${fund.ljjz || '--'}</div>
                </div>
                <div class="fund-detail-item">
                    <div class="fund-detail-label">净值日期</div>
                    <div class="fund-detail-value">${fund.jzrq || '--'}</div>
                </div>
                <div class="fund-detail-item">
                    <div class="fund-detail-label">申购状态</div>
                    <div class="fund-detail-value">${fund.sgzt || '--'}</div>
                </div>
                <div class="fund-detail-item">
                    <div class="fund-detail-label">赎回状态</div>
                    <div class="fund-detail-value">${fund.shzt || '--'}</div>
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
                                <span class="stock-code">${s.code}</span>
                                <span class="stock-weight">${weight}</span>
                                <span class="${cls}">${s.change_pct > 0 ? '+' : ''}${s.change_pct}%</span>
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
                                <div class="manager-avatar">${(m.name || '?')[0]}</div>
                                <div>
                                    <div class="manager-name">${escapeHtml(m.name)}</div>
                                    <div class="manager-info">任职起始: ${m.start_date || '--'}</div>
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
                    <button class="icon-btn" data-code="${code}" onclick="refreshSingleFund('${code}')" title="刷新">${icon('sync-alt')}</button>
                    <button class="icon-btn detail-btn" onclick="showFundDetail('${code}')" title="查看详情">${icon('chart-line')}</button>
                    <button class="icon-btn" data-code="${code}" data-name="${escapeHtml(name)}" data-pos="0" title="编辑持仓">${icon('edit')}</button>
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
                    <button class="icon-btn" data-code="${code}" onclick="refreshSingleFund('${code}')" title="刷新">${icon('sync-alt')}</button>
                    <button class="icon-btn detail-btn" onclick="showFundDetail('${code}')" title="查看详情">${icon('chart-line')}</button>
                    <button class="icon-btn" data-code="${code}" data-name="${escapeHtml(name)}" data-pos="0">${icon('edit')}</button>
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

    // 绑定新行的按钮事件
    const newRow = tbody.querySelector(`tr[data-code="${code}"]`);
    const newCard = cards.querySelector(`.mobile-card[data-code="${code}"]`);
    [newRow, newCard].forEach(el => {
        if (!el) return;
        el.querySelector('.icon-btn.danger')?.addEventListener('click', () => removeFromFavorites(code));
        el.querySelector('.icon-btn:not(.danger):not(.drag-handle):not(.detail-btn)[data-pos]')?.addEventListener('click', function() {
            editPosition(code, name, 0);
        });
    });

    // 只请求新添加的基金数据
    getFundData(code).then(data => {
        const fundData = { ...data, position: 0 };
        const idx = favs.length - 1;
        updateFundRow(fundData, idx);
        updateFundCard(fundData, idx);
    }).catch(() => {
        const failedData = { code, name, position: 0, dwjz: '--', gszzl: 0, jzzzl: 0, jzrq: '--', failed: true };
        const idx = favs.length - 1;
        updateFundRow(failedData, idx);
        updateFundCard(failedData, idx);
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

    const withPosition = fundList.filter(f => f.position > 0);

    if (!withPosition.length) {
        section.style.display = 'none';
        return;
    }

    let totalPosition = 0;
    let totalMarketValue = 0;

    withPosition.forEach(f => {
        const nav = parseFloat(f.dwjz) || 0;
        if (nav > 0) {
            const shares = f.position / nav;
            const marketValue = shares * nav;
            totalPosition += f.position;
            totalMarketValue += marketValue;
        }
    });

    const totalProfit = totalMarketValue - totalPosition;
    const totalProfitRate = totalPosition > 0 ? (totalProfit / totalPosition) * 100 : 0;
    const profitClass = totalProfit >= 0 ? 'positive' : 'negative';

    section.style.display = 'block';
    grid.innerHTML = `
        <div class="summary-item">
            <div class="summary-label">总投入</div>
            <div class="summary-value">¥${formatMoney(totalPosition)}</div>
        </div>
        <div class="summary-item">
            <div class="summary-label">总市值</div>
            <div class="summary-value">¥${formatMoney(totalMarketValue)}</div>
        </div>
        <div class="summary-item">
            <div class="summary-label">总收益</div>
            <div class="summary-value ${profitClass}">¥${formatMoney(totalProfit)}</div>
            <div class="summary-change ${profitClass}">${totalProfitRate >= 0 ? '+' : ''}${totalProfitRate.toFixed(2)}%</div>
        </div>
        <div class="summary-item">
            <div class="summary-label">持仓数量</div>
            <div class="summary-value">${withPosition.length} 只</div>
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
                        <button class="icon-btn detail-btn" onclick="showFundDetail('${f.code}')" title="查看详情">${icon('chart-line')}</button>
                        <button class="icon-btn" data-code="${f.code}" data-name="${escapeHtml(f.name)}" data-pos="${f.position || 0}" title="编辑持仓">${icon('edit')}</button>
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
                        <button class="icon-btn detail-btn" onclick="showFundDetail('${f.code}')" title="查看详情">${icon('chart-line')}</button>
                        <button class="icon-btn" data-code="${f.code}" data-name="${escapeHtml(f.name)}" data-pos="${f.position || 0}">${icon('edit')}</button>
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

async function fetchBatchValuation(favs) {
    const codes = favs.map(f => f.code);
    const fetchedList = [];

    try {
        const timestamp = Date.now();
        const response = await axios.post(`${API_BASE_URL}/funds/fast`, { codes }, {
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' },
            params: { _t: timestamp }
        });

        if (response.data.success && response.data.data) {
            // 创建数据映射
            const dataMap = {};
            response.data.data.forEach(item => {
                dataMap[item.code] = item;
            });

            // 找出没有估算涨跌幅且有净值数据的基金，尝试通过重仓股计算
            // 注意：如果基金没有 NAV（净值数据），则不需要额外请求
            const needCalcFunds = [];
            favs.forEach((fav, idx) => {
                const data = dataMap[fav.code];
                if (data && data.dwjz && data.dwjz !== '--' &&
                    (!data.gszzl || data.gszzl === '0' || data.gszzl === '0.00' || data.gszzl === null)) {
                    needCalcFunds.push({ fav, idx, data });
                }
            });

            // 并行获取需要计算的基金的重仓股数据（限制并发数量）
            const calcResults = {};
            if (needCalcFunds.length > 0 && needCalcFunds.length <= 10) {
                // 只有少量基金需要计算时才请求详情，避免大量请求
                const calcPromises = needCalcFunds.map(async ({ fav }) => {
                    try {
                        const detail = await getFundData(fav.code);
                        return { code: fav.code, detail };
                    } catch {
                        return { code: fav.code, detail: null };
                    }
                });
                const results = await Promise.all(calcPromises);
                results.forEach(r => {
                    if (r.detail) calcResults[r.code] = r.detail;
                });
            }

            // 更新每个基金的数据
            favs.forEach((fav, idx) => {
                const data = dataMap[fav.code];
                const calcData = calcResults[fav.code];

                if (data) {
                    let gszzl = data.gszzl;
                    let hasEstimate = gszzl && gszzl !== '0' && gszzl !== '0.00';

                    // 如果没有估算涨跌幅，使用重仓股计算的结果
                    if (!hasEstimate && calcData && calcData.gszzl && calcData.gszzl !== '0') {
                        gszzl = calcData.gszzl;
                        hasEstimate = true;
                    }

                    // jzzzl 是净值日期的实际涨跌幅，与估算涨跌幅不同
                    let jzzzl = data.jzzzl || '0';

                    const fundData = {
                        ...data,
                        name: data.name || calcData?.name || fav.name,
                        position: fav.position || 0,
                        gsz: data.gsz !== '--' ? data.gsz : data.dwjz,
                        gszzl: gszzl || '0',
                        jzzzl: jzzzl,
                        hasRealtime: data.gztime && data.gztime !== '--',
                        has_estimate: hasEstimate,
                        top_stocks: calcData?.top_stocks || [],
                        sectors: calcData?.sectors || [],
                        performance: calcData?.performance || {}
                    };
                    fetchedList[idx] = fundData;
                    updateFundRow(fundData, idx);
                    updateFundCard(fundData, idx);
                } else if (calcData) {
                    // 批量接口没有数据，但重仓股计算有数据
                    const fundData = {
                        ...calcData,
                        position: fav.position || 0,
                        gsz: calcData.gsz || calcData.dwjz || '--',
                        hasRealtime: false,
                        has_estimate: calcData.gszzl && calcData.gszzl !== '0',
                        jzzzl: calcData.jzzzl || '0'
                    };
                    fetchedList[idx] = fundData;
                    updateFundRow(fundData, idx);
                    updateFundCard(fundData, idx);
                } else {
                    // 完全没有数据
                    const failedData = {
                        code: fav.code,
                        name: fav.name,
                        position: fav.position || 0,
                        dwjz: '--',
                        gszzl: '0',
                        jzzzl: '0',
                        jzrq: '--',
                        failed: true
                    };
                    fetchedList[idx] = failedData;
                    updateFundRow(failedData, idx);
                    updateFundCard(failedData, idx);
                }
            });

            renderSummary(fetchedList.filter(Boolean));
            return;
        }
    } catch (e) {
        console.warn('批量估值接口失败，降级到单个请求:', e);
    }

    // 降级：逐个请求
    favs.forEach((fav, idx) => {
        getFundData(fav.code).then(data => {
            const fundData = { ...data, position: fav.position || 0 };
            fetchedList[idx] = fundData;
            updateFundRow(fundData, idx);
            updateFundCard(fundData, idx);
            renderSummary(fetchedList.filter(Boolean));
        }).catch(() => {
            const failedData = { code: fav.code, name: fav.name, position: fav.position || 0, dwjz: '--', gszzl: '0', jzzzl: '0', jzrq: '--', failed: true };
            fetchedList[idx] = failedData;
            updateFundRow(failedData, idx);
            updateFundCard(failedData, idx);
        });
    });
}

function updateFundRow(f, idx) {
    const row = document.querySelector(`#favoritesList tr[data-code="${f.code}"]`);
    if (!row) return;

    const ch = formatChange(f.gszzl);
    const jzCh = formatChange(f.jzzzl || 0);
    const p = calcProfit(f.position, parseFloat(f.gsz) || 0, parseFloat(f.dwjz) || 0);
    const pCls = p.has ? (p.profit >= 0 ? 'positive' : 'negative') : '';

    row.innerHTML = `
        <td>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <button class="icon-btn drag-handle" title="拖拽排序">${icon('grip-vertical')}</button>
                <div>
                    <span class="fund-name-cell">${escapeHtml(f.name)}</span>
                    <span class="fund-code-tag">${f.code}</span>
                </div>
            </div>
        </td>
        <td class="text-right mono">${f.gsz || '--'}</td>
        <td class="text-right">
            <span class="change-badge ${f.failed ? 'neutral' : ch.cls}">${f.failed ? '--' : ch.value}</span>
        </td>
        <td class="text-right">
            <span class="change-badge ${f.failed ? 'neutral' : jzCh.cls}">${f.failed ? '--' : jzCh.value}</span>
        </td>
        <td style="color: var(--gray-500); font-size: 0.875rem;">${f.update_time || f.jzrq || '--'}</td>
        <td class="text-right profit-cell ${pCls}">
            ${p.has ? `¥${formatMoney(p.profit)}` : '--'}
        </td>
        <td class="text-center">
            <div class="action-group">
                <button class="icon-btn" data-code="${f.code}" onclick="refreshSingleFund('${f.code}')" title="刷新">${icon('sync-alt')}</button>
                <button class="icon-btn detail-btn" onclick="showFundDetail('${f.code}')" title="查看详情">${icon('chart-line')}</button>
                <button class="icon-btn" data-code="${f.code}" data-name="${escapeHtml(f.name)}" data-pos="${f.position}" title="编辑持仓">${icon('edit')}</button>
                <button class="icon-btn danger" data-code="${f.code}" title="移除">${icon('trash-alt')}</button>
            </div>
        </td>
    `;
}

function updateFundCard(f, idx) {
    const card = document.querySelector(`#favoritesCardList .mobile-card[data-code="${f.code}"]`);
    if (!card) return;

    const ch = formatChange(f.gszzl);
    const jzCh = formatChange(f.jzzzl || 0);
    const p = calcProfit(f.position, parseFloat(f.gsz) || 0, parseFloat(f.dwjz) || 0);
    const pCls = p.has ? (p.profit >= 0 ? 'positive' : 'negative') : '';

    card.innerHTML = `
        <div class="mobile-card-top">
            <div style="display: flex; align-items: flex-start; gap: 0.5rem;">
                <button class="icon-btn drag-handle" title="拖拽排序" style="margin-top: 2px;">${icon('grip-vertical')}</button>
                <div>
                    <div class="mobile-card-name">${escapeHtml(f.name)}</div>
                    <div class="mobile-card-code">${f.code}</div>
                </div>
            </div>
            <div class="action-group">
                <button class="icon-btn" data-code="${f.code}" onclick="refreshSingleFund('${f.code}')" title="刷新">${icon('sync-alt')}</button>
                <button class="icon-btn detail-btn" onclick="showFundDetail('${f.code}')" title="查看详情">${icon('chart-line')}</button>
                <button class="icon-btn" data-code="${f.code}" data-name="${escapeHtml(f.name)}" data-pos="${f.position}">${icon('edit')}</button>
                <button class="icon-btn danger" data-code="${f.code}">${icon('trash-alt')}</button>
            </div>
        </div>
        <div class="mobile-card-grid">
            <div>
                <div class="mobile-stat-label">${f.hasRealtime ? '估值' : '净值'}</div>
                <div class="mobile-stat-value">${f.gsz || '--'}</div>
            </div>
            <div>
                <div class="mobile-stat-label">估算涨幅</div>
                <div class="mobile-stat-value ${ch.cls}">${f.failed ? '--' : ch.value}</div>
            </div>
            <div>
                <div class="mobile-stat-label">日涨跌</div>
                <div class="mobile-stat-value ${jzCh.cls}">${f.failed ? '--' : jzCh.value}</div>
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
        const fundData = { ...data, position: favs[idx].position || 0 };
        updateFundRow(fundData, idx);
        updateFundCard(fundData, idx);
        showToast('刷新成功', 'success');
    }).catch(() => {
        const failedData = { code, name: favs[idx].name, position: favs[idx].position || 0, dwjz: '--', gszzl: 0, jzzzl: 0, jzrq: '--', failed: true };
        updateFundRow(failedData, idx);
        updateFundCard(failedData, idx);
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
        const fetchOne = async (fav) => {
            try {
                const data = await getFundData(fav.code);
                return { ...data, position: fav.position || 0 };
            } catch {
                return { code: fav.code, name: fav.name, position: fav.position || 0, gszzl: 0 };
            }
        };
        const results = await Promise.all(favs.map(fetchOne));
        results.sort((a, b) => (parseFloat(b.gszzl) || 0) - (parseFloat(a.gszzl) || 0));
        setStorage('fundFavorites', results.map(f => ({ code: f.code, name: f.name, position: f.position || 0 })));
        renderFavorites();
        showToast('排序完成', 'success');
    } catch { showToast('排序失败', 'error'); }
}

function toggleAutoRefresh(enable) {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
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
    refreshTimer = setInterval(() => {
        renderFavorites();
        // 每次刷新时重新检查交易状态
        checkTradingStatus().then(() => {
            // 如果交易状态变化，调整刷新间隔
            const newInterval = getRefreshInterval();
            if (newInterval !== interval) {
                clearInterval(refreshTimer);
                startAutoRefresh();
            }
        });
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
