const test = require('node:test');
const assert = require('node:assert/strict');
const {
    calcProfit,
    summarizePortfolio,
    formatChange,
    escapeHtml,
    escapeAttr,
} = require('../app-utils.js');

test('calcProfit uses estimated nav against latest nav', () => {
    const result = calcProfit(1000, 1.1, 1.0, true);
    assert.equal(result.has, true);
    assert.ok(Math.abs(result.profit - 100) < 1e-9);
    assert.ok(Math.abs(result.rate - 10) < 1e-9);
    assert.ok(Math.abs(result.marketValue - 1100) < 1e-9);
});

test('calcProfit reports no estimate instead of a fake zero', () => {
    const result = calcProfit(1000, 1.0, 1.0, false);
    assert.equal(result.has, false);
    assert.equal(result.profit, 0);
});

test('summarizePortfolio values estimated positions correctly', () => {
    const summary = summarizePortfolio([
        { position: 1000, dwjz: 1.0, gsz: 1.1, has_estimate: true },
        { position: 500, dwjz: 2.0, gsz: 2.0, has_estimate: false },
    ]);
    assert.equal(summary.count, 2);
    assert.equal(summary.estimatedCount, 1);
    assert.ok(Math.abs(summary.totalPosition - 1500) < 1e-9);
    assert.ok(Math.abs(summary.totalMarketValue - 1600) < 1e-9);
    assert.ok(Math.abs(summary.totalProfit - 100) < 1e-9);
    assert.ok(Math.abs(summary.totalProfitRate - (100 / 1500) * 100) < 1e-9);
});

test('summarizePortfolio ignores empty positions and invalid nav', () => {
    const summary = summarizePortfolio([
        { position: 0, dwjz: 1.0, gsz: 1.0, has_estimate: true },
        { position: 100, dwjz: '--', gsz: '--', has_estimate: true },
    ]);
    assert.equal(summary.count, 0);
    assert.equal(summary.totalPosition, 0);
    assert.equal(summary.totalProfit, 0);
});

test('formatChange handles missing values', () => {
    assert.deepEqual(formatChange('--'), { value: '--', cls: 'neutral' });
    assert.deepEqual(formatChange('1.234'), { value: '1.23%', cls: 'positive' });
    assert.deepEqual(formatChange('-1.235'), { value: '-1.24%', cls: 'negative' });
});

test('escapeHtml and escapeAttr neutralize markup and quotes', () => {
    assert.equal(escapeHtml('<a>&"'), '&lt;a&gt;&amp;"');
    assert.equal(escapeAttr('a"b\'c<d>'), 'a&quot;b&#39;c&lt;d&gt;');
});
