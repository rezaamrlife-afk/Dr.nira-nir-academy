// ─────────────────────────────────────────────────────────
// Dr. NIRA Academic Search API
// Single, consolidated handler (previous file had duplicate/
// dangling code outside any function, which caused 500s).
// ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query, sort, filter } = req.query;

  // ── Input validation ──
  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'query required' });
  }
  if (query.length > 300) {
    return res.status(400).json({ error: 'query too long (max 300 chars)' });
  }

  try {
    // ── 1. INTENT EXTRACTION ──
    const intent = extractIntent(query);

    // ── 2. QUERY REWRITE / EXPANSION (controlled, short) ──
    const expandedQuery = buildExpandedQuery(query, intent);

    // ── 3. OPENALEX RETRIEVAL (with fallback on failure) ──
    let data;
    try {
      data = await fetchOpenAlex(expandedQuery, sort);
    } catch (primaryErr) {
      // Fallback: retry with the raw, un-expanded query.
      // This protects against expansion strings that occasionally
      // cause OpenAlex to choke or return zero results.
      try {
        data = await fetchOpenAlex(query, sort);
      } catch (fallbackErr) {
        // Both attempts failed — return a clean, typed error instead of a 500 crash.
        return res.status(502).json({
          error: 'Search provider unavailable. Please try again.',
          detail: fallbackErr.message
        });
      }
    }

    let results = (data.results || []).map(normalizeResult);

    // ── 4. RANK + FILTER ──
    results = rankAndFilter(results, intent, filter, query);

    // ── 5. SAFETY NET: if hard filtering removed everything, fall back to ranked-but-unfiltered ──
    if (results.length === 0 && (data.results || []).length > 0) {
      results = (data.results || [])
        .map(normalizeResult)
        .map(p => scoreOnly(p, intent, filter, query))
        .sort((a, b) => b._score - a._score);
    }

    res.status(200).json({
      data: results.slice(0, 10),
      total: data.meta ? data.meta.count : results.length,
      rewrittenQuery: expandedQuery !== query ? expandedQuery : null,
      intent
    });

  } catch (err) {
    // Final safety net — never let an uncaught error leak a raw 500 with no context
    console.error('Search handler error:', err);
    res.status(500).json({ error: 'Internal search error', detail: err.message });
  }
}

// ─────────────────────────────────────────────
// OPENALEX FETCH (timeout-protected)
// ─────────────────────────────────────────────
async function fetchOpenAlex(searchQuery, sort) {
  const url = new URL('https://api.openalex.org/works');
  url.searchParams.set('search', searchQuery);
  url.searchParams.set('filter', 'has_abstract:true');

  // Explicit three-way branch instead of a binary ternary, so unrecognized or
  // future sort values don't silently fall through to citation-sort. relevance_score
  // is valid here because `search` is always set on this endpoint (OpenAlex only
  // exposes relevance_score when a search filter is active).
  let sortParam;
  if (sort === 'latest') {
    sortParam = 'publication_year:desc';
  } else if (sort === 'citations') {
    sortParam = 'cited_by_count:desc';
  } else {
    sortParam = 'relevance_score:desc'; // default — covers 'relevance', undefined, or any unrecognized value
  }
  url.searchParams.set('sort', sortParam);

  // Increased from 25 to 50: the hard filter for language_learning+motivation
  // queries can eliminate a large fraction of a 25-result page, leaving too few
  // candidates. A bigger candidate pool before filtering directly improves recall.
  url.searchParams.set('per-page', '50');
  url.searchParams.set(
    'select',
    'id,title,abstract_inverted_index,authorships,publication_year,cited_by_count,concepts,primary_location,doi,open_access'
  );
  url.searchParams.set('mailto', 'dr-nira@niracademy.com');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout — prevents hung requests

  try {
    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Dr-NIRA-Academic-App/1.0' },
      signal: controller.signal
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`OpenAlex ${response.status}: ${errText.slice(0, 200)}`);
    }

    return await response.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('OpenAlex request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ─────────────────────────────────────────────
// INTENT EXTRACTOR
// ─────────────────────────────────────────────
function extractIntent(query) {
  const q = query.toLowerCase();
  const intent = { domain: 'general', focus: [] };

  if (/\b(efl|esl|sla|second language|language learning|language acquisition|applied linguistics|english language|foreign language|l2|bilingual|multilingual)\b/.test(q)) {
    intent.domain = 'language_learning';
  } else if (/\b(education|teaching|classroom|pedagogy|curriculum|instruction)\b/.test(q)) {
    intent.domain = 'education';
  }

  // NOTE: prefix patterns like "motiv" must NOT have a trailing \b, since \b requires
  // a word boundary immediately after "motiv" — which fails for "motivation",
  // "motivated" etc. (the next character is a letter, not a boundary). Using \w*
  // instead lets the prefix match correctly while still requiring it start at a word boundary.
  if (/\b(motiv\w*|engag\w*|attitude|affect\w*|willingness|anxiety|self-efficacy|autonomy|interest)\b/.test(q)) {
    intent.focus.push('motivation');
  }
  if (/\b(method\w*|approach\w*|technique|strategy|design|model|framework|material)\b/.test(q)) {
    intent.focus.push('methodology');
  }
  if (/\b(vocabulary|grammar|pronunciation|reading|writing|speaking|listening)\b/.test(q)) {
    intent.focus.push('skills');
  }
  if (/\b(technolog\w*|digital|online|computer|ai|app|software|e-learn\w*|elearn\w*)\b/.test(q)) {
    intent.focus.push('technology');
  }

  return intent;
}

// ─────────────────────────────────────────────
// QUERY EXPANSION — controlled + Persian support
// ─────────────────────────────────────────────
const PERSIAN_EXPANSIONS = {
  'یادگیری زبان': 'language learning acquisition EFL ESL',
  'انگیزه': 'motivation engagement',
  'آموزش': 'teaching instruction education',
  'اضطراب': 'anxiety',
};

function buildExpandedQuery(query, intent) {
  // Persian terms: translate/expand rather than appending Latin words to Persian text,
  // since OpenAlex search performs poorly on mixed-script strings.
  for (const [fa, en] of Object.entries(PERSIAN_EXPANSIONS)) {
    if (query.includes(fa)) {
      const remainder = query.replace(fa, '').trim();
      return `${remainder} ${en}`.trim(); // .trim() guards against remainder being empty
    }
  }

  if (intent.domain === 'language_learning' && intent.focus.includes('motivation')) {
    // Broadened beyond just "motivation" so the OpenAlex search itself surfaces
    // papers that use adjacent terminology (engagement, anxiety, willingness)
    // instead of relying solely on the exact word "motivation".
    return query + ' motivation engagement anxiety language learning EFL ESL TESOL';
  }
  if (intent.domain === 'language_learning') {
    return query + ' language learning EFL ESL TESOL applied linguistics';
  }
  if (intent.domain === 'education' && intent.focus.includes('motivation')) {
    return query + ' motivation engagement learning education';
  }
  return query;
}

// ─────────────────────────────────────────────
// NORMALIZER
// ─────────────────────────────────────────────
function normalizeResult(p) {
  let abstract = '';
  if (p.abstract_inverted_index) {
    const wordMap = {};
    Object.keys(p.abstract_inverted_index).forEach(word => {
      p.abstract_inverted_index[word].forEach(pos => { wordMap[pos] = word; });
    });
    abstract = Object.keys(wordMap)
      .map(Number)
      .sort((a, b) => a - b)
      .map(pos => wordMap[pos])
      .join(' ');
  }

  const authors = (p.authorships || []).slice(0, 5).map(a => a.author?.display_name).filter(Boolean);
  const venue = p.primary_location?.source?.display_name || '';
  const venueType = p.primary_location?.source?.type || ''; // e.g. "journal", "repository"
  const isPeerReviewed = venueType === 'journal';
  const concepts = (p.concepts || []).slice(0, 5).map(c => c.display_name);
  const doi = p.doi ? p.doi.replace('https://doi.org/', '') : '';
  const openAccessUrl = p.open_access?.oa_url || '';

  return {
    id: p.id || '',
    title: p.title || '',
    abstract,
    year: p.publication_year ? String(p.publication_year) : '—',
    authors,
    venue,
    isPeerReviewed,
    citationCount: p.cited_by_count || 0,
    concepts,
    link: doi ? 'https://doi.org/' + doi : (openAccessUrl || p.id || ''),
    pdfLink: openAccessUrl || '',
    source: 'openalex'
  };
}

// ─────────────────────────────────────────────
// RANK + FILTER
// ─────────────────────────────────────────────
// Expanded with common synonyms/abbreviations that earlier caused relevant papers
// to be missed (e.g. a paper using "TESOL" or "intrinsic motivation" instead of
// the exact words "language learning" or "motivation" was previously invisible
// to these checks).
const LANG_SIGNALS = [
  'efl', 'esl', 'sla', 'tesol', 'tefl', 'elt', 'eal',
  'second language', 'foreign language', 'language learning', 'language acquisition',
  'language education', 'language teaching', 'language instruction', 'language proficiency',
  'applied linguistics', 'english language', 'l2', 'l1', 'bilingual', 'multilingual',
  'esol', 'english learner', 'language classroom', 'second language acquisition'
];

const MOTIV_SIGNALS = [
  'motivation', 'motivat', 'engagement', 'engage', 'attitude', 'affect',
  'willingness', 'anxiety', 'self-efficacy', 'self efficacy', 'autonomy', 'interest',
  'intrinsic motivation', 'extrinsic motivation', 'learner belief', 'learner psychology',
  'academic buoyancy', 'enjoyment', 'burnout', 'resilience', 'self-regulation',
  'self regulation', 'mindset', 'identity', 'demotivation', 'persistence', 'grit'
];

const NOISE_DOMAINS = ['mathematics', 'physics', 'chemistry', 'engineering', 'computer science', 'biology', 'medicine', 'economics'];

function scoreOnly(p, intent, filter, originalQuery) {
  const queryLower = originalQuery.toLowerCase();
  const titleLower = (p.title || '').toLowerCase();
  const conceptsArr = p.concepts || []; // defensive: don't assume caller always passes normalizeResult's shape
  const text = (p.title + ' ' + p.abstract + ' ' + conceptsArr.join(' ')).toLowerCase();
  const conceptStr = conceptsArr.join(' ').toLowerCase();

  let score = 0;

  // Citations (log-scaled, weight reduced from *3 to *2 so a heavily-cited but
  // tangential paper can't outrank a paper that's a much closer topical match —
  // at *3, 5000 citations alone added ~25 points, more than every relevance
  // signal in this function combined).
  score += Math.log1p(p.citationCount || 0) * 2;

  // Recency
  const year = parseInt(p.year) || 0;
  if (year >= 2020) score += 4;
  else if (year >= 2015) score += 2;

  // Title relevance — strongest direct signal of "is this actually about what was asked"
  if (titleLower.includes(queryLower)) score += 8;
  else {
    // Threshold lowered from >3 to >2: short domain terms like "efl", "l2", "sla"
    // are exactly the words that matter most here, and a >3 cutoff was excluding
    // all of them while still letting through less useful 4-letter filler words.
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    const titleHits = queryWords.filter(w => titleLower.includes(w)).length;
    score += titleHits * 3;
  }

  // Domain signal match
  const langMatches = LANG_SIGNALS.filter(s => text.includes(s)).length;
  score += langMatches * 4;

  if (intent.focus.includes('motivation')) {
    const motivMatches = MOTIV_SIGNALS.filter(s => text.includes(s)).length;
    score += motivMatches * 5;
    // Softer penalty than before (-3 instead of -8/-10) — avoids wrongly
    // nuking relevant papers that just phrase things differently.
    if (motivMatches === 0) score -= 3;
  }

  // Education filter boost
  if (filter === 'education' && langMatches > 0) score += 5;

  // Credibility signals
  if (p.isPeerReviewed) score += 3;
  if (!p.venue) score -= 2; // no identifiable venue — slightly less trustworthy
  if (p.abstract && p.abstract.length > 0) score += 1;

  // Off-domain noise penalty
  const noiseDomains = NOISE_DOMAINS.filter(d => conceptStr.includes(d)).length;
  score -= noiseDomains * 6;

  p._score = Math.round(score * 100) / 100;
  return p;
}

function rankAndFilter(results, intent, filter, originalQuery) {
  const scored = results.map(p => scoreOnly(p, intent, filter, originalQuery));

  return scored
    .filter(p => {
      // Hard filter only applies when we're confident about a specific domain+focus combo,
      // and only excludes documents with NO relevant signal at all (recall-preserving).
      if (intent.domain === 'language_learning' && intent.focus.includes('motivation')) {
        // Now also checks concepts, not just title+abstract — a paper can have a thin
        // or jargon-heavy abstract that misses our keyword list while OpenAlex's own
        // concept tagging correctly identifies it as relevant. Checking concepts too
        // catches these papers instead of dropping them.
        const text = (p.title + ' ' + p.abstract + ' ' + (p.concepts || []).join(' ')).toLowerCase();
        const hasLang = LANG_SIGNALS.some(s => text.includes(s));
        const hasMotiv = MOTIV_SIGNALS.some(s => text.includes(s));
        return hasLang || hasMotiv;
      }
      return true;
    })
    .sort((a, b) => b._score - a._score);
}
