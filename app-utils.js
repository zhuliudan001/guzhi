(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AppUtils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function toNumber(value) {
        if (value === null || value === undefined) return null;
        if (typeof value === 'number') return Number.isFinite(value) ? value : null;
        const text = String(value).trim();
        if (!text || text === '--') return null;
        const parsed = Number(text.replace(/,/g, ''));
        return Number.isFinite(parsed) ? parsed : null;
    }

    function calcProfit(position, currentNav, costNav, hasEstimate) {
        const amount = toNumber(position);
        const current = toNumber(currentNav);
        const cost = toNumber(costNav);
        if (!hasEstimate || amount === null || amount <= 0 || current === null || current <= 0 || cost === null || cost <= 0) {
            return { has: false, profit: 0, rate: 0, marketValue: 0 };
        }
        const shares = amount / cost;
        const marketValue = shares * current;
        const profit = marketValue - amount;
        return {
            has: true,
            profit,
            rate: (profit / amount) * 100,
            marketValue,
        };
    }

    function summarizePortfolio(funds) {
        const summary = {
            count: 0,
            estimatedCount: 0,
            totalPosition: 0,
            totalMarketValue: 0,
            totalProfit: 0,
            totalProfitRate: 0,
        };

        (Array.isArray(funds) ? funds : []).forEach((fund) => {
            const position = toNumber(fund && fund.position);
            const costNav = toNumber(fund && fund.dwjz);
            if (position === null || position <= 0 || costNav === null || costNav <= 0) return;

            const hasEstimate = !!(fund && fund.has_estimate);
            const currentNav = hasEstimate ? toNumber(fund.gsz) : costNav;
            if (currentNav === null || currentNav <= 0) return;

            const result = calcProfit(position, currentNav, costNav, true);
            summary.count += 1;
            if (hasEstimate) summary.estimatedCount += 1;
            summary.totalPosition += position;
            summary.totalMarketValue += result.marketValue;
            summary.totalProfit += result.profit;
        });

        if (summary.totalPosition > 0) {
            summary.totalProfitRate = (summary.totalProfit / summary.totalPosition) * 100;
        }
        return summary;
    }

    function formatChange(change) {
        const value = toNumber(change);
        if (value === null) return { value: '--', cls: 'neutral' };
        const text = value.toFixed(2);
        let cls = 'neutral';
        if (value > 0) cls = 'positive';
        else if (value < 0) cls = 'negative';
        return { value: `${text}%`, cls };
    }

    function resolveEstimateChange(fund) {
        const source = fund && typeof fund === 'object' ? fund : {};
        if (source.failed) return { value: '--', cls: 'neutral', fallback: false };
        if (source.has_estimate) {
            return { ...formatChange(source.gszzl), fallback: false };
        }
        const navChange = formatChange(source.jzzzl);
        if (navChange.value === '--') return { value: '--', cls: 'neutral', fallback: false };
        return { value: navChange.value, cls: 'neutral', fallback: true };
    }

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function escapeAttr(value) {
        return escapeHtml(value)
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    const BACKUP_APP = 'guzhi';
    const BACKUP_VERSION = 1;
    const MAX_BACKUP_FAVORITES = 200;
    const MAX_BACKUP_HISTORY = 10;
    const MAX_FUND_NAME_LENGTH = 100;

    function backupError(code, message) {
        const error = new Error(message);
        error.code = code;
        return error;
    }

    function normalizeCode(value) {
        const code = String(value === null || value === undefined ? '' : value).trim();
        return /^\d{6}$/.test(code) ? code : null;
    }

    function normalizeName(value) {
        if (typeof value !== 'string') return null;
        const name = value.trim().replace(/\s+/g, ' ');
        if (!name || name.length > MAX_FUND_NAME_LENGTH) return null;
        return name;
    }

    function normalizePosition(value) {
        const position = toNumber(value);
        return position !== null && position >= 0 ? position : 0;
    }

    function normalizeFavorites(list) {
        if (!Array.isArray(list)) return { items: [], ignored: 0 };
        const byCode = new Map();
        let ignored = 0;
        list.forEach((item) => {
            if (!item || typeof item !== 'object') { ignored += 1; return; }
            const code = normalizeCode(item.code);
            const name = normalizeName(item.name);
            if (!code || !name) { ignored += 1; return; }
            byCode.set(code, { code, name, position: normalizePosition(item.position) });
        });
        const items = Array.from(byCode.values());
        const dropped = Math.max(0, items.length - MAX_BACKUP_FAVORITES);
        return { items: items.slice(0, MAX_BACKUP_FAVORITES), ignored: ignored + dropped };
    }

    function normalizeSearchHistory(list) {
        if (!Array.isArray(list)) return { items: [], ignored: 0 };
        const byCode = new Map();
        let ignored = 0;
        list.forEach((item) => {
            if (!item || typeof item !== 'object') { ignored += 1; return; }
            const code = normalizeCode(item.code);
            const name = normalizeName(item.name);
            if (!code || !name) { ignored += 1; return; }
            if (!byCode.has(code)) byCode.set(code, { code, name });
        });
        const items = Array.from(byCode.values());
        const dropped = Math.max(0, items.length - MAX_BACKUP_HISTORY);
        return { items: items.slice(0, MAX_BACKUP_HISTORY), ignored: ignored + dropped };
    }

    function createBackup(state, exportedAt) {
        const source = state && typeof state === 'object' ? state : {};
        const favorites = normalizeFavorites(source.favorites);
        const history = normalizeSearchHistory(source.searchHistory);
        const timestamp = exportedAt instanceof Date && !Number.isNaN(exportedAt.getTime())
            ? exportedAt.toISOString()
            : (typeof exportedAt === 'string' && exportedAt ? exportedAt : new Date().toISOString());
        return {
            app: BACKUP_APP,
            version: BACKUP_VERSION,
            exportedAt: timestamp,
            data: {
                favorites: favorites.items,
                searchHistory: history.items,
                autoRefreshEnabled: source.autoRefreshEnabled === true,
            },
        };
    }

    function parseBackup(text) {
        if (typeof text !== 'string' || !text.trim()) {
            throw backupError('invalid_json', '备份文件为空');
        }
        let raw;
        try {
            raw = JSON.parse(text);
        } catch {
            throw backupError('invalid_json', '文件不是有效的 JSON');
        }
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.app !== BACKUP_APP) {
            throw backupError('invalid_backup', '不是本应用的备份文件');
        }
        if (raw.version !== BACKUP_VERSION) {
            throw backupError('unsupported_version', `备份版本 ${raw.version === undefined ? '未知' : raw.version} 不受支持`);
        }
        if (!raw.data || typeof raw.data !== 'object' || Array.isArray(raw.data)) {
            throw backupError('invalid_backup', '备份文件缺少数据');
        }

        const favorites = normalizeFavorites(raw.data.favorites);
        const history = normalizeSearchHistory(raw.data.searchHistory);
        return {
            favorites: favorites.items,
            searchHistory: history.items,
            autoRefreshEnabled: raw.data.autoRefreshEnabled === true,
            exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : null,
            ignored: {
                favorites: favorites.ignored,
                searchHistory: history.ignored,
            },
        };
    }

    function mergeFavorites(localFavorites, importedFavorites) {
        const local = normalizeFavorites(localFavorites).items;
        const imported = normalizeFavorites(importedFavorites).items;
        const importedByCode = new Map(imported.map((item) => [item.code, item]));
        const merged = local.map((item) => importedByCode.get(item.code) || item);
        const localCodes = new Set(local.map((item) => item.code));
        imported.forEach((item) => {
            if (!localCodes.has(item.code)) merged.push(item);
        });
        return merged.slice(0, MAX_BACKUP_FAVORITES);
    }

    function mergeSearchHistory(localHistory, importedHistory) {
        const local = normalizeSearchHistory(localHistory).items;
        const imported = normalizeSearchHistory(importedHistory).items;
        const seen = new Set(local.map((item) => item.code));
        const merged = local.slice();
        imported.forEach((item) => {
            if (seen.has(item.code)) return;
            seen.add(item.code);
            merged.push(item);
        });
        return merged.slice(0, MAX_BACKUP_HISTORY);
    }

    return {
        toNumber,
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
    };
});
