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
    // 2. QUERY EXPANSION (SAFE)
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

    // ─────────────────────────────
    // 4. NORMALIZE RESULTS
    // ─────────────────────────────
    let results = (data.results || []).map(normalizeResult);

    // ─────────────────────────────
    // 5. FILTER + RANKING
    // ─────────────────────────────
    results = rankResults(results, intent, filter, query);

    // ─────────────────────────────
    // 6. RESPONSE
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
    focus: [],
    exclude: []
  };

  // language learning domain
  if (/\b(efl|esl|sla|second language|language learning|language acquisition|applied linguistics|l2|bilingual|multilingual)\b/.test(q)) {
    intent.domain = 'language_learning';
  }
  // education domain
  else if (/\b(education|teaching|classroom|pedagogy|curriculum|instruction|learning)\b/.test(q)) {
    intent.domain = 'education';
  }

  // motivation focus
  if (/\b(motiv|engag|attitude|affect|anxiety|self.efficacy|autonomy|interest)\b/.test(q)) {
    intent.focus.push('motivation');
  }

  // methodology focus
  if (/\b(method|approach|technique|strategy|model|framework|curriculum)\b/.test(q)) {
    intent.focus.push('methodology');
  }

  return intent;
}

//
// ─────────────────────────────────────────────
// QUERY EXPANSION (SAFE - SHORT ONLY)
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
// RANKING + FILTERING
// ─────────────────────────────────────────────
//
const LANG = ['efl','esl','sla','language learning','language acquisition','l2'];
const MOTIV = ['motivation','engagement','attitude','affect','anxiety','interest'];

function rankResults(results, intent, filter, query) {
  const qTokens = query.toLowerCase().split(' ').filter(w => w.length > 3);

  return results
    .map(p => {
      const text = (p.title + ' ' + p.abstract).toLowerCase();

      let score = 0;

      // citations
      score += Math.log1p(p.citationCount) * 3;

      // recency
      if (p.year >= 2020) score += 4;
      else if (p.year >= 2015) score += 2;

      // query overlap
      qTokens.forEach(t => {
        if (text.includes(t)) score += 2;
      });

      // language signal
      LANG.forEach(s => {
        if (text.includes(s)) score += 4;
      });

      // motivation boost
      if (intent.focus.includes('motivation')) {
        MOTIV.forEach(s => {
          if (text.includes(s)) score += 5;
        });
      }

      p._score = score;
      return p;
    })
    .filter(p => {
      const text = (p.title + ' ' + p.abstract).toLowerCase();

      // hard filter for language learning
      if (intent.domain === 'language_learning') {
        return LANG.some(s => text.includes(s)) || MOTIV.some(s => text.includes(s));
      }

      return true;
    })
    .sort((a, b) => b._score - a._score);
}
