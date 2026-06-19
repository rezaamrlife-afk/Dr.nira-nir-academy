export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query, sort, filter } = req.query;
  if (!query) return res.status(400).json({ error: 'query required' });

  try {
    // ── 1. QUERY REWRITING ──
    const rewritten = rewriteQuery(query);

    // ── 2. OPENALEX SEARCH ──
    const sortParam = sort === 'latest' ? 'publication_year:desc' : 'cited_by_count:desc';
    const fields = 'id,title,abstract_inverted_index,authorships,publication_year,cited_by_count,concepts,primary_location,doi,open_access';
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(rewritten)}&filter=has_abstract:true&sort=${sortParam}&per-page=20&select=${fields}&mailto=dr-nira@niracademy.com`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Dr-NIRA-Academic-App/1.0' }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error('OpenAlex ' + response.status + ': ' + errText.slice(0, 200));
    }

    const data = await response.json();
    let results = (data.results || []).map(p => normalizeResult(p));

    // ── 3. DOMAIN FILTER (education mode only) ──
    if (filter === 'education') {
      results = results.filter(p => isEducationRelevant(p));
    }

    // ── 4. RANKING LAYER ──
    results = rankResults(results, query, filter);

    // Return top 10 after filtering + ranking
    res.status(200).json({
      data: results.slice(0, 10),
      total: data.meta ? data.meta.count : results.length,
      rewrittenQuery: rewritten !== query ? rewritten : null
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── QUERY REWRITING ──
function rewriteQuery(query) {
  const q = query.toLowerCase();
  const expansions = {
    'efl': 'EFL ESL second language acquisition learner motivation',
    'esl': 'ESL EFL second language acquisition English language learning',
    'language learning motivation': 'language learning motivation SLA ESL student engagement educational psychology',
    'english learning': 'English language learning EFL ESL acquisition pedagogy',
    'teaching english': 'teaching English EFL ESL classroom instruction applied linguistics',
    'sla': 'second language acquisition SLA language learning',
    'applied linguistics': 'applied linguistics language education EFL ESL pedagogy',
    'language teaching': 'language teaching EFL ESL pedagogy classroom instruction',
  };
  for (const [key, expansion] of Object.entries(expansions)) {
    if (q.includes(key)) return query + ' ' + expansion;
  }
  // Persian → English expansion
  const persianMap = {
    'یادگیری زبان': 'language learning acquisition EFL ESL pedagogy',
    'انگیزه': 'motivation engagement learning',
    'آموزش': 'teaching instruction education',
  };
  for (const [key, expansion] of Object.entries(persianMap)) {
    if (query.includes(key)) return expansion;
  }
  return query;
}

// ── NORMALIZE OPENALEX RESULT ──
function normalizeResult(p) {
  // Reconstruct abstract
  let abstract = '';
  if (p.abstract_inverted_index) {
    const wordMap = {};
    Object.keys(p.abstract_inverted_index).forEach(word => {
      p.abstract_inverted_index[word].forEach(pos => { wordMap[pos] = word; });
    });
    abstract = Object.keys(wordMap).map(Number).sort((a,b) => a-b).map(pos => wordMap[pos]).join(' ');
  }

  const authors = (p.authorships || []).slice(0, 5).map(a => a.author ? a.author.display_name : '').filter(Boolean);
  const venue = p.primary_location && p.primary_location.source ? p.primary_location.source.display_name || '' : '';
  const concepts = (p.concepts || []).slice(0, 5).map(c => c.display_name);
  const conceptIds = (p.concepts || []).map(c => (c.id || '').toLowerCase());
  const doi = p.doi ? p.doi.replace('https://doi.org/', '') : '';
  const openAccessUrl = p.open_access && p.open_access.oa_url ? p.open_access.oa_url : '';

  return {
    id: p.id || '',
    title: p.title || '',
    abstract: abstract,
    year: p.publication_year ? String(p.publication_year) : '—',
    authors: authors,
    venue: venue,
    citationCount: p.cited_by_count || 0,
    concepts: concepts,
    conceptIds: conceptIds,
    link: doi ? 'https://doi.org/' + doi : (openAccessUrl || p.id || ''),
    pdfLink: openAccessUrl || '',
    source: 'openalex'
  };
}

// ── EDUCATION DOMAIN FILTER ──
const EDU_KEYWORDS = [
  'efl','esl','sla','second language','language learning','language acquisition',
  'language education','language teaching','applied linguistics','english language',
  'foreign language','learner','classroom instruction','language instruction',
  'language pedagogy','bilingual','multilingual','l2','language proficiency'
];

function isEducationRelevant(p) {
  const text = (p.title + ' ' + p.abstract + ' ' + p.concepts.join(' ')).toLowerCase();
  return EDU_KEYWORDS.some(kw => text.includes(kw));
}

// ── RANKING LAYER ──
const EDU_CONCEPT_BOOST = [
  'education','linguistics','applied linguistics','language acquisition',
  'second language acquisition','efl','esl','pedagogy','psychology','learning'
];

function rankResults(results, originalQuery, filter) {
  const queryLower = originalQuery.toLowerCase();
  return results.map(p => {
    let score = 0;

    // Citation signals (normalized)
    score += Math.log1p(p.citationCount || 0) * 3;

    // Recency boost (last 5 years)
    const year = parseInt(p.year) || 0;
    if (year >= 2020) score += 4;
    else if (year >= 2015) score += 2;

    // Title match
    const titleLower = (p.title || '').toLowerCase();
    if (titleLower.includes(queryLower)) score += 8;
    else if (queryLower.split(' ').some(w => w.length > 4 && titleLower.includes(w))) score += 4;

    // Concept domain boost
    const conceptStr = p.concepts.join(' ').toLowerCase();
    EDU_CONCEPT_BOOST.forEach(c => { if (conceptStr.includes(c)) score += 2; });

    // Education filter boost
    if (filter === 'education') {
      const text = (p.title + ' ' + p.abstract).toLowerCase();
      EDU_KEYWORDS.forEach(kw => { if (text.includes(kw)) score += 3; });
    }

    // Domain mismatch penalty (for general search)
    const NOISE_DOMAINS = ['mathematics','physics','chemistry','engineering','computer science','biology'];
    if (filter !== 'arxiv') {
      NOISE_DOMAINS.forEach(d => { if (conceptStr.includes(d)) score -= 5; });
    }

    p._score = score;
    return p;
  }).sort((a, b) => b._score - a._score);
}

