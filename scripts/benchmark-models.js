const fs = require('fs');
const path = require('path');

// Load .env
const envText = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
const keyMatch = envText.match(/OPENAI_API_KEY=(\S+)/);
const apiKey = keyMatch ? keyMatch[1].trim() : '';

// Official pricing per 1M tokens (USD)
const PRICING = {
  'gpt-5-nano':   { in: 0.05, out: 0.40 },
  'gpt-4.1-nano': { in: 0.10, out: 0.40 },
  'gpt-4o-mini':  { in: 0.15, out: 0.60 },
  'gpt-5-mini':   { in: 0.25, out: 2.00 },
  'gpt-4.1-mini': { in: 0.40, out: 1.60 }
};

// 4 Realistic Geopolitical Wording Diff Test Cases
const TEST_CASES = [
  {
    id: 'routine_green',
    expectedLevel: 1,
    country: 'Japan',
    source: 'UK Foreign Travel Advice (FCDO)',
    before: 'Visas are not required for short-term tourist stays up to 90 days.',
    after: 'Updated information on customs declaration QR codes (Visit Japan Web) and new baggage rules for Shinkansen high-speed trains.'
  },
  {
    id: 'protest_yellow',
    expectedLevel: 2,
    country: 'France',
    source: 'U.S. Embassy Paris Alert',
    before: 'Exercise increased caution in France due to terrorism and civil unrest.',
    after: 'Demonstration Alert: Labor unions have called for a nationwide transport strike and peaceful march from Place de la République on Thursday, October 29. Expect metro disruptions and heavy police presence.'
  },
  {
    id: 'subtle_red_flag_l4',
    expectedLevel: 4,
    country: 'Lebanon',
    source: 'U.S. Department of State',
    before: 'Reconsider travel to Lebanon due to crime, terrorism, armed conflict, and civil unrest. U.S. Embassy personnel are restricted from traveling to the southern border area.',
    after: 'Due to unpredictable security developments, the Department of State has authorized the voluntary departure (Authorized Departure) of family members and non-emergency U.S. government personnel from U.S. Embassy Beirut. Lufthansa and Air France have suspended overnight flights into Beirut Rafic Hariri Airport.'
  },
  {
    id: 'imminent_war_black_l5',
    expectedLevel: 5,
    country: 'Ukraine (Feb 2022 Retrospective)',
    source: 'U.S. Department of State & Embassy Kyiv',
    before: 'Do not travel to Ukraine due to increased threats of Russian military action. Authorized departure of non-emergency staff is in effect.',
    after: 'On February 12, the Department of State ordered the departure (Ordered Departure) of most U.S. direct hire employees from Embassy Kyiv and suspended consular services. U.S. citizens in Ukraine should depart immediately via commercial or private means. The U.S. government will not be able to evacuate U.S. citizens in the event of military action.'
  }
];

function buildPrompt(tc) {
  return `You are a senior geopolitical & military crisis intelligence analyst.
Analyze the following official update from "${tc.source}" for "${tc.country}".

Removed Wording (Before): ${tc.before}
Added Wording (After): ${tc.after}

Classify the update strictly on our 1-5 Geopolitical Early Warning Scale:
- Level 1 (Normal): Standard precautions, routine editorial/visa/health/transport edits.
- Level 2 (Increased Caution): Peaceful protests, strikes, petty crime, weather/climate notes.
- Level 3 (High Risk / Reconsider Travel): High background threat, but diplomatic missions and airspace operate normally.
- Level 4 (Red Flag / Pre-Evacuation): Authorized Departure (voluntary departure) of diplomatic families/non-emergency staff, shelter-in-place orders, airline flight suspensions or conflict zone airspace warnings (NOTAM/EASA/FAA).
- Level 5 (Critical / Imminent War - Time is down to days): Ordered Departure (mandatory evacuation of diplomats), suspension/relocation of embassy operations, urgent call for citizens to leave immediately via commercial flights, disclaimer that government cannot guarantee evacuation.

Respond ONLY in valid JSON with this exact structure:
{
  "normalizedLevel": <number 1 to 5>,
  "severityLabel": "<NORMAL | CAUTION | HIGH_RISK | RED_FLAG | CRITICAL_WAR_WARNING>",
  "aiSummary": "<2-sentence crisp intelligence brief explaining what changed and why it matters>",
  "redFlags": ["<short tag 1>", "<short tag 2>"]
}`;
}

async function testModel(model) {
  let totalLatency = 0;
  let correctCount = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  const details = [];

  for (const tc of TEST_CASES) {
    const start = Date.now();
    const payload = {
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You output strict JSON intelligence assessments.' },
        { role: 'user', content: buildPrompt(tc) }
      ]
    };
    if (!model.startsWith('gpt-5') && !model.startsWith('o')) {
      payload.temperature = 0.1;
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    const elapsed = Date.now() - start;
    if (!res.ok) {
      const errText = await res.text();
      return { model, error: `HTTP ${res.status}: ${errText.slice(0, 140)}` };
    }

    const data = await res.json();
    const usage = data.usage || {};
    totalLatency += elapsed;
    totalPromptTokens += usage.prompt_tokens || 0;
    totalCompletionTokens += usage.completion_tokens || 0;

    let parsed = {};
    try {
      parsed = JSON.parse(data.choices[0].message.content);
    } catch (_) {}

    const predicted = Number(parsed.normalizedLevel);
    const isExact = predicted === tc.expectedLevel;
    if (isExact) correctCount++;

    details.push({
      id: tc.id,
      expected: tc.expectedLevel,
      predicted,
      isExact,
      ms: elapsed,
      summary: parsed.aiSummary,
      redFlags: parsed.redFlags
    });
  }

  const price = PRICING[model] || { in: 0.15, out: 0.60 };
  const costFor4Calls = (totalPromptTokens / 1e6) * price.in + (totalCompletionTokens / 1e6) * price.out;
  // Monthly estimate assuming 25 diffs/day = 750 diffs/month
  const costPerDiff = costFor4Calls / TEST_CASES.length;
  const estMonthlyUsd = costPerDiff * 750;

  return {
    model,
    accuracy: `${correctCount}/${TEST_CASES.length} (${Math.round((correctCount / TEST_CASES.length) * 100)}%)`,
    avgLatencyMs: Math.round(totalLatency / TEST_CASES.length),
    avgInTokens: Math.round(totalPromptTokens / TEST_CASES.length),
    avgOutTokens: Math.round(totalCompletionTokens / TEST_CASES.length),
    estMonthlyUsd: `$${estMonthlyUsd.toFixed(4)}/mo`,
    details
  };
}

(async () => {
  const candidateModels = ['gpt-5-nano', 'gpt-4.1-nano', 'gpt-4o-mini', 'gpt-5-mini', 'gpt-4.1-mini'];
  console.log('Running live OpenAI model benchmark across 4 geopolitical test scenarios...\n');
  const results = [];
  for (const m of candidateModels) {
    process.stdout.write(`Testing ${m}... `);
    const r = await testModel(m);
    console.log(r.error ? `ERROR (${r.error})` : `Done! Accuracy: ${r.accuracy}, Avg Latency: ${r.avgLatencyMs}ms, Est Monthly Cost: ${r.estMonthlyUsd}`);
    results.push(r);
  }
  fs.writeFileSync(path.join(__dirname, '../data/benchmark_results.json'), JSON.stringify(results, null, 2));
})();
