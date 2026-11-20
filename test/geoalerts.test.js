const test = require('node:test');
const assert = require('node:assert/strict');

const {
  stripHtml,
  detectRedFlagsAndLevel,
  computeTextDiff,
  getSeverityLabel
} = require('../server/analyzer');
const { formatAlertMessage, broadcastCriticalEvents } = require('../server/telegram');
const { parseAviationHtml } = require('../server/parsers');

test('stripHtml decodes double-escaped RSS HTML and strips tags & boilerplate', () => {
  const dirty =
    '&lt;div class="tag source"&gt;Sources: Nutrition Cluster&lt;/div&gt; ' +
    '&lt;p&gt;&lt;img src="https://reliefweb.int/x.png" alt&gt;&lt;/p&gt; ' +
    '&lt;p&gt;Please refer to the attached file.&lt;/p&gt; ' +
    '&lt;p&gt;La r&eacute;union mensuelle.&lt;/p&gt;';
  const clean = stripHtml(dirty);
  assert.ok(!clean.includes('<div'), 'should not contain <div>');
  assert.ok(!clean.includes('&lt;'), 'should not contain &lt;');
  assert.ok(!clean.includes('img src'), 'should not contain img src');
  assert.ok(!clean.includes('Please refer to the attached file'), 'should strip boilerplate');
  assert.ok(clean.includes('Sources: Nutrition Cluster'), 'should retain readable text');
});

test('detectRedFlagsAndLevel elevates Ordered Departure to Level 5 and leaves routine text at base level', () => {
  const routine = detectRedFlagsAndLevel('Updated visa and passport entry requirements for tourists.', 1);
  assert.equal(routine.level, 1);
  assert.deepEqual(routine.redFlags, []);

  const critical = detectRedFlagsAndLevel(
    'The Department of State has ordered the departure of non-emergency staff. U.S. citizens should depart immediately.',
    3
  );
  assert.equal(critical.level, 5);
  assert.ok(critical.redFlags.length >= 2);
});

test('formatAlertMessage sanitizes URLs, strips HTML in diffs, and syncs severity label to newLevel', () => {
  const html = formatAlertMessage({
    iso2: 'CD',
    countryName: 'DR Congo',
    sourceName: 'Test Agency',
    oldLevel: 4,
    newLevel: 5,
    severityLabel: 'INCREASED CAUTION', // deliberately mismatched input
    title: '<b>Escalation</b>',
    aiSummary: 'Summary text',
    redFlags: ['Ordered Departure'],
    diffBefore: '&lt;div&gt;Old HTML&lt;/div&gt;',
    diffAfter: '&lt;p&gt;New HTML&lt;/p&gt;',
    sourceUrl: 'javascript:alert(1)'
  });

  assert.ok(html.includes('CRITICAL / IMMINENT CRISIS'), 'must use consistent label for Level 5');
  assert.ok(!html.includes('INCREASED CAUTION'), 'must ignore stale mismatched label');
  assert.ok(!html.includes('javascript:alert'), 'must block javascript: URLs');
  assert.ok(html.includes('href="https://travel.state.gov"'), 'must fall back to safe https URL');
  assert.ok(!html.includes('&amp;lt;div'), 'must not double-escape raw HTML');
});

test('broadcastCriticalEvents strictly blocks unchanged status events (oldLevel === newLevel)', async () => {
  const res = await broadcastCriticalEvents([
    { iso2: 'UA', oldLevel: 5, newLevel: 5, title: 'No status change' },
    { iso2: 'ML', oldLevel: 4, newLevel: 4, title: 'No status change' }
  ]);
  assert.equal(res.sent, 0);
  assert.equal(res.eventsCount, 0);
});

test('parseAviationHtml is order-independent when two feed items swap positions (no ping-pong)', () => {
  const itemA =
    '<div class="feed-item feed-item-level-2" data-feed-item-country="Saudi Arabia" data-feed-item-warn-level="2">' +
    '<span class="feed-item-level">29 Oct</span>' +
    '<div class="feed-item-summary">France AIC extended, no change to warning.<div class="feed-item-summary-fade"></div>' +
    '<a href="https://safeairspace.net/saudi-arabia/">Read</a></div>';
  const itemB =
    '<div class="feed-item feed-item-level-2" data-feed-item-country="Saudi Arabia" data-feed-item-warn-level="2">' +
    '<span class="feed-item-level">29 Oct</span>' +
    '<div class="feed-item-summary">France Notam extended, no change to warning.<div class="feed-item-summary-fade"></div>' +
    '<a href="https://safeairspace.net/saudi-arabia/">Read</a></div>';

  const recsAB = parseAviationHtml(itemA + itemB);
  const recsBA = parseAviationHtml(itemB + itemA);
  assert.equal(recsAB.length, 1);
  assert.equal(recsBA.length, 1);
  assert.equal(recsAB[0].title, recsBA[0].title);
  assert.equal(recsAB[0].fullText, recsBA[0].fullText);
});

test('computeTextDiff isolates newly added sentences cleanly', () => {
  const diff = computeTextDiff(
    'Normal consular operations continue. Exercise caution in border areas.',
    'Normal consular operations continue. Authorized departure of non-emergency staff has been approved.'
  );
  assert.equal(diff.hasChanges, true);
  assert.ok(diff.addedText.includes('Authorized departure'));
  assert.ok(diff.removedText.includes('border areas'));
});

test('getSeverityLabel covers levels 1 through 5', () => {
  assert.equal(getSeverityLabel(1), 'NORMAL PRECAUTIONS');
  assert.equal(getSeverityLabel(5), 'CRITICAL / IMMINENT CRISIS');
});
