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

    return {
        toNumber,
        calcProfit,
        summarizePortfolio,
        formatChange,
        escapeHtml,
        escapeAttr,
    };
});
