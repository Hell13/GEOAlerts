const crypto = require('node:crypto');

// Critical Red Flag patterns indicating "time is down to days" or pre-evacuation
const LEVEL_5_PATTERNS = [
  { label: 'Ordered Departure (Mandatory Diplomatic Evacuation)', regex: /\b(ordered departure|mandatory evacuation|ordered the departure of)\b/i },
  { label: 'Leave Immediately via Commercial Means', regex: /\b(leave .* immediately|depart immediately|leave by commercial means while .* available|leave the country immediately)\b/i },
  { label: 'Embassy Suspension / Relocation', regex: /\b(suspended operations at the embassy|suspending consular operations|relocated embassy operations|embassy .* closed due to security)\b/i },
  { label: 'Imminent Military / Missile Strike Warning', regex: /\b(imminent (attack|military|missile|strike)|within the next (24|48|72) hours|shelter in place immediately)\b/i },
  { label: 'No U.S./Gov Evacuation Guarantee', regex: /\b(cannot guarantee ability to evacuate|will not be able to evacuate citizens|do not rely on the .* government for assisted departure)\b/i }
];

const LEVEL_4_PATTERNS = [
  { label: 'Authorized Departure (Voluntary Family/Staff Withdrawal)', regex: /\b(authorized departure|voluntary departure of non-emergency|dependents of .* staff have been temporarily withdrawn|withdrawal of .* staff families)\b/i },
  { label: 'Staff Movement & Shelter Restrictions', regex: /\b(shelter in place|restricted from traveling|staffing posture adjustments|live and work under strict security protocols|bomb shelter|hardened shelter)\b/i },
  { label: 'Airspace Conflict Zone / Anti-Aircraft Risk', regex: /\b(prohibiting certain flights|special federal aviation regulation|sfar|risks to civil aviation|conflict zone|missile and drone attacks|anti-aircraft|airspace closure|suspended flights)\b/i },
  { label: 'Border Closure / State of Emergency', regex: /\b(state of emergency|checkpoints will be closed|land border closure|martial law|curfew)\b/i },
  { label: 'Active Armed Hostilities / Strikes', regex: /\b(engaged in hostilities|military strikes|retaliatory attacks|rocket fire|armed UAV intrusions|indirect fire)\b/i }
];

function computeHash(text) {
  return crypto.createHash('sha256').update((text || '').trim()).digest('hex').slice(0, 24);
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;|&#8217;|&rsquo;|&#8216;|&lsquo;/gi, "'")
    .replace(/&#8211;|&ndash;|&#8212;|&mdash;/gi, '-')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, num) => {
      const code = Number(num);
      return code >= 32 && code <= 126 ? String.fromCharCode(code) : ' ';
    });
}

function stripHtml(html) {
  if (!html) return '';
  // Decode twice first to catch double-escaped RSS HTML like &lt;div class="tag"&gt;
  let text = decodeHtmlEntities(decodeHtmlEntities(html));
  text = text
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|br|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  // Decode once more in case entities remained inside text nodes, then strip any leftover tags
  text = decodeHtmlEntities(text).replace(/<[^>]+>/g, ' ');
  return text
    .replace(/Please refer to the attached file\.?/gi, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/**
 * Extracts sentence-level diff between oldText and newText
 */
function computeTextDiff(oldText, newText) {
  const splitSentences = (txt) =>
    (txt || '')
      .split(/(?<=[.!?])\s+|\n+/)
      .map(s => s.trim())
      .filter(s => s.length > 5);

  const oldSet = new Set(splitSentences(oldText));
  const newSentences = splitSentences(newText);
  const newSet = new Set(newSentences);

  const added = newSentences.filter(s => !oldSet.has(s));
  const removed = [...oldSet].filter(s => !newSet.has(s));

  return {
    hasChanges: added.length > 0 || removed.length > 0,
    addedText: added.slice(0, 6).join(' '),
    removedText: removed.slice(0, 4).join(' ')
  };
}

/**
 * Detects red flags in text and determines deterministic baseline threat level (1..5)
 */
function detectRedFlagsAndLevel(text, baseSourceLevel = 1) {
  const clean = stripHtml(text);
  const flags = [];
  let level = baseSourceLevel;

  for (const pat of LEVEL_5_PATTERNS) {
    if (pat.regex.test(clean)) {
      flags.push({ level: 5, label: pat.label });
      level = Math.max(level, 5);
    }
  }

  for (const pat of LEVEL_4_PATTERNS) {
    if (pat.regex.test(clean)) {
      flags.push({ level: 4, label: pat.label });
      // If base advisory is already high (3 or 4) and has active military/evacuation red flags, elevate to 4 or 5
      if (baseSourceLevel >= 4 && flags.length >= 2) {
        level = Math.max(level, 5);
      } else {
        level = Math.max(level, 4);
      }
    }
  }

  return {
    level: Math.min(5, Math.max(1, level)),
    redFlags: flags.map(f => f.label)
  };
}

const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 20000;
const MAX_AI_CALLS_PER_RUN = Number(process.env.MAX_AI_CALLS_PER_RUN) || 30;
let aiCallsThisRun = 0;

function resetAiCallBudget() {
  aiCallsThisRun = 0;
}

async function fetchJsonWithTimeout(url, options, timeoutMs = AI_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls OpenAI (or Gemini) ONLY when a meaningful change occurs, with timeout & per-run cap.
 * Falls back to deterministic intelligence analysis if keys are missing, timed out, or cap exceeded.
 */
async function analyzeChangeWithAI({
  countryName,
  sourceName,
  oldLevel,
  newBaseLevel,
  title,
  diffBefore,
  diffAfter,
  fullText
}) {
  const { level: deterministicLevel, redFlags } = detectRedFlagsAndLevel(
    `${title}\n${diffAfter || fullText}`,
    newBaseLevel
  );

  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const hasGemini = Boolean(geminiKey && geminiKey !== 'your_gemini_api_key_here');
  const hasOpenAI = Boolean(openaiKey && openaiKey !== 'your_openai_api_key_here');

  const overBudget = aiCallsThisRun >= MAX_AI_CALLS_PER_RUN;
  if ((!hasOpenAI && !hasGemini) || overBudget) {
    const summaryParts = [];
    if (redFlags.length > 0 && deterministicLevel >= 4) {
      summaryParts.push(`Critical indicators detected: ${redFlags.join(', ')}.`);
    }
    const cleanAfter = stripHtml(diffAfter || '');
    const cleanFull = stripHtml(fullText || '');
    if (cleanAfter) {
      summaryParts.push(cleanAfter.slice(0, 280) + (cleanAfter.length > 280 ? '...' : ''));
    } else if (cleanFull) {
      summaryParts.push(cleanFull.slice(0, 280) + '...');
    }
    return {
      normalizedLevel: deterministicLevel,
      severityLabel: getSeverityLabel(deterministicLevel),
      aiSummary: summaryParts.join(' ') || title,
      redFlags: deterministicLevel >= 4 ? redFlags : [],
      usedOpenAI: false
    };
  }
  aiCallsThisRun++;

  const cleanDiffBefore = stripHtml(diffBefore || '');
  const cleanDiffAfter = stripHtml(diffAfter || '');
  const cleanFullText = stripHtml(fullText || '');

  const prompt = `You are a senior geopolitical & military crisis intelligence analyst.
Analyze the following official update from "${sourceName}" for "${countryName}".

Previous Threat Level: ${oldLevel || 'N/A'}
Source Base Level: ${newBaseLevel}
Headline: ${title}
Removed Wording (Before): ${cleanDiffBefore || '(Initial or new bulletin)'}
Added Wording (After): ${cleanDiffAfter || cleanFullText.slice(0, 1200)}

Classify the update strictly on our 1-5 Geopolitical Early Warning Scale:
- Level 1 (Normal): Standard precautions, routine editorial/visa/health/nutrition/weather/administrative edits.
- Level 2 (Increased Caution): Peaceful protests, petty crime, localized weather/climate/health notes, non-violent unrest.
- Level 3 (High Risk / Reconsider Travel): High background threat or regional crime/instability, but diplomatic missions and airspace operate normally.
- Level 4 (Red Flag / Pre-Evacuation): Authorized Departure of diplomatic families/non-emergency staff, shelter-in-place orders, active conflict zone airspace warnings (NOTAM/EASA/FAA), border closures, state of emergency due to armed violence, missile/drone threats.
- Level 5 (Critical / Imminent War - Time is down to days): Ordered Departure (mandatory evacuation of diplomats), embassy closure/relocation, urgent call for citizens to leave immediately via commercial flights, imminent military strike warning.

CRITICAL RULES:
1. If the update is a routine editorial tweak, meeting minutes, nutrition/health report, or a DOWNGRADE/easing of a prior warning, reflect the true lower current threat level (do NOT escalate because the text mentions what it was downgraded from).
2. "redFlags" MUST be an empty array [] unless "normalizedLevel" is 4 or 5 AND the update explicitly reports military conflict, diplomatic evacuation, shelter-in-place, border closure, or conflict-zone airspace prohibition. NEVER put health, nutrition, editorial, climate, or crime tags in "redFlags".

Respond ONLY in valid JSON with this exact structure:
{
  "normalizedLevel": <number 1 to 5>,
  "severityLabel": "<NORMAL | CAUTION | HIGH_RISK | RED_FLAG | CRITICAL_WAR_WARNING>",
  "aiSummary": "<2-sentence crisp intelligence brief explaining what changed and why it matters>",
  "redFlags": []
}`;

  try {
    let parsed;
    if (hasOpenAI) {
      const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
      const bodyPayload = {
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You output strict JSON intelligence assessments.' },
          { role: 'user', content: prompt }
        ]
      };
      if (!model.startsWith('gpt-5')) bodyPayload.temperature = 0.1;

      const data = await fetchJsonWithTimeout('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify(bodyPayload)
      });
      parsed = JSON.parse(data.choices[0].message.content);
    } else if (hasGemini) {
      const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
      const data = await fetchJsonWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
          })
        }
      );
      parsed = JSON.parse(data.candidates[0].content.parts[0].text);
    }

    const aiLvl = Number(parsed.normalizedLevel);
    const validAiLvl = Number.isFinite(aiLvl) ? Math.min(5, Math.max(1, Math.round(aiLvl))) : deterministicLevel;
    // Trust AI's nuanced contextual classification (handles downgrades and editorial updates accurately),
    // while keeping explicit diplomatic base levels when higher unless the AI explicitly identifies a downgrade/editorial note.
    const isExplicitDowngradeOrEditorial = /\b(downgrad|eased|lifted|editorial|routine|no indication of escalating|nutrition|health update)\b/i.test(
      `${parsed.aiSummary || ''} ${cleanDiffAfter}`
    );
    const finalLevel = isExplicitDowngradeOrEditorial
      ? validAiLvl
      : Math.max(Math.min(deterministicLevel, 4), validAiLvl);

    // STRICT: Only Level 4 and Level 5 genuine security events may carry Red Flags!
    const aiFlags = Array.isArray(parsed.redFlags)
      ? parsed.redFlags.filter(f =>
          typeof f === 'string' &&
          f.trim().length > 2 &&
          !/\b(nutrition|health|editorial|climate|weather|reporting|visa|crime|petty|market|funding|rainfall|ebola|cholera)\b/i.test(f)
        )
      : [];
    const finalRedFlags = finalLevel >= 4
      ? Array.from(new Set([...redFlags, ...aiFlags])).slice(0, 6)
      : [];

    return {
      normalizedLevel: finalLevel,
      severityLabel: getSeverityLabel(finalLevel),
      aiSummary: parsed.aiSummary || title,
      redFlags: finalRedFlags,
      usedOpenAI: true
    };
  } catch (err) {
    console.error('[AI Analyzer Fallback]', err.message);
    return {
      normalizedLevel: deterministicLevel,
      severityLabel: getSeverityLabel(deterministicLevel),
      aiSummary: cleanDiffAfter ? cleanDiffAfter.slice(0, 300) : cleanFullText.slice(0, 300),
      redFlags: deterministicLevel >= 4 ? redFlags : [],
      usedOpenAI: false
    };
  }
}

function getSeverityLabel(level) {
  switch (Number(level)) {
    case 5: return 'CRITICAL / IMMINENT CRISIS';
    case 4: return 'RED FLAG / PRE-EVACUATION';
    case 3: return 'HIGH RISK / RECONSIDER TRAVEL';
    case 2: return 'INCREASED CAUTION';
    default: return 'NORMAL PRECAUTIONS';
  }
}

module.exports = {
  computeHash,
  stripHtml,
  computeTextDiff,
  detectRedFlagsAndLevel,
  analyzeChangeWithAI,
  getSeverityLabel,
  resetAiCallBudget
};
