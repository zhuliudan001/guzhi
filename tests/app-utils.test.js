const test = require('node:test');
const assert = require('node:assert/strict');
const {
    calcProfit,
    summarizePortfolio,
    formatChange,
    escapeHtml,
    escapeAttr,
    createBackup,
    parseBackup,
    mergeFavorites,
    mergeSearchHistory,
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

test('backup round-trips favorites, history and settings', () => {
    const state = {
        favorites: [
            { code: '000001', name: '华夏成长', position: 1234.56 },
            { code: '161725', name: '招商中证白酒', position: 0 },
        ],
        searchHistory: [
            { code: '161725', name: '招商中证白酒' },
            { code: '000001', name: '华夏成长' },
        ],
        autoRefreshEnabled: true,
    };

    const backup = createBackup(state, '2026-10-20T02:00:00.000Z');
    assert.equal(backup.app, 'guzhi');
    assert.equal(backup.version, 1);
    assert.equal(backup.exportedAt, '2026-10-20T02:00:00.000Z');

    const parsed = parseBackup(JSON.stringify(backup));
    assert.deepEqual(parsed.favorites, state.favorites);
    assert.deepEqual(parsed.searchHistory, state.searchHistory);
    assert.equal(parsed.autoRefreshEnabled, true);
    assert.equal(parsed.ignored.favorites, 0);
    assert.equal(parsed.ignored.searchHistory, 0);
});

test('createBackup exports only known fields', () => {
    const backup = createBackup({
        favorites: [{ code: '000001', name: '华夏成长', position: 10, secret: 'x' }],
        searchHistory: [{ code: '000001', name: '华夏成长', extra: true }],
        autoRefreshEnabled: false,
    }, '2026-10-20T02:00:00.000Z');

    assert.deepEqual(Object.keys(backup.data.favorites[0]).sort(), ['code', 'name', 'position']);
    assert.deepEqual(Object.keys(backup.data.searchHistory[0]).sort(), ['code', 'name']);
});

test('parseBackup rejects malformed, foreign and unsupported files', () => {
    assert.throws(
        () => parseBackup('{not json'),
        (error) => error.code === 'invalid_json'
    );
    assert.throws(
        () => parseBackup(JSON.stringify({ app: 'other', version: 1, data: {} })),
        (error) => error.code === 'invalid_backup'
    );
    assert.throws(
        () => parseBackup(JSON.stringify({ app: 'guzhi', version: 1 })),
        (error) => error.code === 'invalid_backup'
    );
    assert.throws(
        () => parseBackup(JSON.stringify({ app: 'guzhi', version: 2, data: {} })),
        (error) => error.code === 'unsupported_version'
    );
});

test('parseBackup sanitizes records and keeps the last duplicate', () => {
    const parsed = parseBackup(JSON.stringify({
        app: 'guzhi',
        version: 1,
        exportedAt: '2026-10-20T02:00:00.000Z',
        data: {
            favorites: [
                { code: '000001', name: ' 华夏成长 ', position: '1234.5' },
                { code: '12345', name: '坏代码', position: 1 },
                { code: '000001', name: '华夏成长新', position: 2000 },
                { code: '161725', name: '', position: 10 },
                { code: '110022', name: '易方达消费', position: -5 },
            ],
            searchHistory: [
                { code: '000001', name: '华夏成长' },
                { code: 'bad', name: '坏记录' },
                { code: '000001', name: '重复记录' },
            ],
            autoRefreshEnabled: 'yes',
        },
    }));

    assert.deepEqual(parsed.favorites, [
        { code: '000001', name: '华夏成长新', position: 2000 },
        { code: '110022', name: '易方达消费', position: 0 },
    ]);
    assert.deepEqual(parsed.searchHistory, [{ code: '000001', name: '华夏成长' }]);
    assert.equal(parsed.autoRefreshEnabled, false);
    assert.equal(parsed.ignored.favorites, 2);
    assert.equal(parsed.ignored.searchHistory, 1);
});

test('parseBackup caps oversized lists and reports dropped records', () => {
    const favorites = Array.from({ length: 205 }, (_, index) => ({
        code: String(100000 + index),
        name: `基金${index}`,
        position: 0,
    }));
    const history = Array.from({ length: 15 }, (_, index) => ({
        code: String(200000 + index),
        name: `历史${index}`,
    }));

    const parsed = parseBackup(JSON.stringify({
        app: 'guzhi',
        version: 1,
        data: { favorites, searchHistory: history },
    }));

    assert.equal(parsed.favorites.length, 200);
    assert.equal(parsed.ignored.favorites, 5);
    assert.equal(parsed.searchHistory.length, 10);
    assert.equal(parsed.ignored.searchHistory, 5);
});

test('mergeFavorites keeps local-only funds and imported positions win', () => {
    const merged = mergeFavorites(
        [
            { code: '000001', name: '本地名字', position: 100 },
            { code: '161725', name: '本地白酒', position: 0 },
        ],
        [
            { code: '161725', name: '备份白酒', position: 888 },
            { code: '110022', name: '备份消费', position: 50 },
        ]
    );

    assert.deepEqual(merged, [
        { code: '000001', name: '本地名字', position: 100 },
        { code: '161725', name: '备份白酒', position: 888 },
        { code: '110022', name: '备份消费', position: 50 },
    ]);
});

test('mergeSearchHistory keeps local recency and appends imported codes', () => {
    const merged = mergeSearchHistory(
        [
            { code: '000001', name: '本地华夏' },
            { code: '161725', name: '本地白酒' },
        ],
        [
            { code: '161725', name: '备份白酒' },
            { code: '110022', name: '备份消费' },
        ]
    );

    assert.deepEqual(merged, [
        { code: '000001', name: '本地华夏' },
        { code: '161725', name: '本地白酒' },
        { code: '110022', name: '备份消费' },
    ]);
});
