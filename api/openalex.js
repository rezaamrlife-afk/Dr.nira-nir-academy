export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query, sort, filter } = req.query;
  if (!query) return res.status(400).json({ error: 'query required' });

  try {
    // ─────────────────────────────
    // 1. INTENT EXTRACTION
    // ─────────────────────────────
    const intent = extractIntent(query);

    // ─────────────────────────────
    // 2. QUERY EXPANSION (SAFE + SHORT)
    // ─────────────────────────────
    const expandedQuery = buildExpandedQuery(query, intent);

    // ─────────────────────────────
    // 3. OPENALEX REQUEST (SAFE URL)
    // ─────────────────────────────
    const url = new URL('https://api.openalex.org/works');

    url.searchParams.set('search', expandedQuery);
    url.searchParams.set('filter', 'has_abstract:true');
    url.searchParams.set(
      'sort',
      sort === 'latest'
        ? 'publication_year:desc'
        : 'cited_by_count:desc'
    );
    url.searchParams.set('per-page', '25');
    url.searchParams.set(
      'select',
      'id,title,abstract_inverted_index,authorships,publication_year,cited_by_count,concepts,primary_location,doi,open_access'
    );

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Dr-NIRA-Academic-App/1.0'
      }
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error('OpenAlex Error: ' + err.slice(0, 200));
    }

    const data = await response.json();
    let results = (data.results || []).map(normalizeResult);

    // ─────────────────────────────
    // 4. RANKING + FILTERING
    // ─────────────────────────────
    results = rankResults(results, intent, filter, query);

    // ─────────────────────────────
    // 5. RESPONSE
    // ─────────────────────────────
    res.status(200).json({
      data: results.slice(0, 10),
      total: data.meta?.count || results.length,
      rewrittenQuery: expandedQuery !== query ? expandedQuery : null,
      intent
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

//
// ─────────────────────────────────────────────
// INTENT EXTRACTOR
// ─────────────────────────────────────────────
//
function extractIntent(query) {
  const q = query.toLowerCase();

  const intent = {
    domain: 'general',
    focus: []
  };

  // domain detection
  if (/\b(efl|esl|sla|language learning|language acquisition|applied linguistics|l2|bilingual)\b/.test(q)) {
    intent.domain = 'language_learning';
  } else if (/\b(education|teaching|classroom|pedagogy|curriculum|instruction)\b/.test(q)) {
    intent.domain = 'education';
  }

  // focus detection
  if (/\b(motiv|engag|attitude|affect|anxiety|interest|autonomy)\b/.test(q)) {
    intent.focus.push('motivation');
  }

  if (/\b(method|strategy|model|framework|curriculum)\b/.test(q)) {
    intent.focus.push('methodology');
  }

  return intent;
}

//
// ─────────────────────────────────────────────
// QUERY EXPANSION (CONTROLLED)
// ─────────────────────────────────────────────
//
function buildExpandedQuery(query, intent) {
  if (intent.domain === 'language_learning' && intent.focus.includes('motivation')) {
    return query + ' language learning motivation SLA ESL';
  }

  if (intent.domain === 'language_learning') {
    return query + ' language learning ESL EFL';
  }

  if (intent.domain === 'education') {
    return query + ' education teaching learning';
  }

  return query;
}

//
// ─────────────────────────────────────────────
// NORMALIZER
// ─────────────────────────────────────────────
//
function normalizeResult(p) {
  let abstract = '';

  if (p.abstract_inverted_index) {
    const wordMap = {};

    Object.keys(p.abstract_inverted_index).forEach(word => {
      p.abstract_inverted_index[word].forEach(pos => {
        wordMap[pos] = word;
      });
    });

    abstract = Object.keys(wordMap)
      .map(Number)
      .sort((a, b) => a - b)
      .map(pos => wordMap[pos])
      .join(' ');
  }

  return {
    id: p.id,
    title: p.title,
    abstract,
    year: p.publication_year,
    citationCount: p.cited_by_count || 0,
    concepts: (p.concepts || []).map(c => c.display_name),
    authors: (p.authorships || [])
      .slice(0, 5)
      .map(a => a.author?.display_name)
      .filter(Boolean),
    venue: p.primary_location?.source?.display_name || '',
    link:
      p.doi
        ? 'https://doi.org/' + p.doi.replace('https://doi.org/', '')
        : p.id,
    source: 'openalex'
  };
}

//
// ─────────────────────────────────────────────
// RANKING + FILTERING (INTENT-AWARE)
// ─────────────────────────────────────────────
//
const LANG_SIGNALS = [
  'efl','esl','sla','language learning','language acquisition','l2','bilingual'
];

const MOTIV_SIGNALS = [
  'motivation','engagement','attitude','affect','anxiety','interest','autonomy'
];

export function rankResults(results, intent, filter, query) {
  const tokens = query.toLowerCase().split(' ').filter(t => t.length > 3);

  return results
    .map(p => {
      const text = (p.title + ' ' + p.abstract).toLowerCase();

      let score = 0;

      // ── citations ──
      score += Math.log1p(p.citationCount) * 3;

      // ── recency ──
      if (p.year >= 2020) score += 4;
      else if (p.year >= 2015) score += 2;

      // ── query overlap ──
      tokens.forEach(t => {
        if (text.includes(t)) score += 2;
      });

      // ── language signals ──
      const langHits = LANG_SIGNALS.filter(s => text.includes(s)).length;
      score += langHits * 4;

      // ── INTENT ALIGNMENT (CRITICAL LAYER) ──
      let intentScore = 0;

      if (intent.domain === 'language_learning') {
        intentScore += 3;
      }

      if (intent.focus.includes('motivation')) {
        const motivationHits = MOTIV_SIGNALS.filter(s => text.includes(s)).length;
        intentScore += motivationHits * 6;

        if (motivationHits === 0) intentScore -= 8;
      }

      score += intentScore;

      p._score = score;
      return p;
    })
    .filter(p => {
      const text = (p.title + ' ' + p.abstract).toLowerCase();

      // hard filter for language learning motivation queries
      if (intent.domain === 'language_learning') {
        return LANG_SIGNALS.some(s => text.includes(s)) ||
               MOTIV_SIGNALS.some(s => text.includes(s));
      }

      return true;
    })
    .sort((a, b) => b._score - a._score);
}
