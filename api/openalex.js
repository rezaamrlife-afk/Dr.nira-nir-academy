export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query, sort, filter } = req.query;
  if (!query) return res.status(400).json({ error: 'query required' });

  try {
    // ── 1. INTENT EXTRACTOR ──
    const intent = extractIntent(query);

    // ── 2. CONTROLLED QUERY EXPANSION ──
    const expandedQuery = buildExpandedQuery(query, intent);

    // ── 3. OPENALEX RETRIEVAL — safe URL construction ──
    const baseUrl = new URL('https://api.openalex.org/works');
    baseUrl.searchParams.set('search', expandedQuery);
    baseUrl.searchParams.set('filter', 'has_abstract:true');
    baseUrl.searchParams.set('sort', sort === 'latest' ? 'publication_year:desc' : 'cited_by_count:desc');
    baseUrl.searchParams.set('per-page', '25');
    baseUrl.searchParams.set('select', 'id,title,abstract_inverted_index,authorships,publication_year,cited_by_count,concepts,primary_location,doi,open_access');
    baseUrl.searchParams.set('mailto', 'dr-nira@niracademy.com');

    const response = await fetch(baseUrl.toString(), { headers: { 'User-Agent': 'Dr-NIRA-Academic-App/1.0' } });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error('OpenAlex ' + response.status + ': ' + errText.slice(0, 200));
    }

    const data = await response.json();
    let results = (data.results || []).map(p => normalizeResult(p));

    // ── 4. DUAL FILTER + RANKING ──
    results = rankAndFilter(results, intent, filter);

    res.status(200).json({
      data: results.slice(0, 10),
      total: data.meta ? data.meta.count : results.length,
      rewrittenQuery: expandedQuery !== query ? expandedQuery : null,
      intent: intent
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── INTENT EXTRACTOR ──
function extractIntent(query) {
  const q = query.toLowerCase();
  const intent = {
    domain: 'general',
    focus: [],
    exclude: []
  };

  // Domain detection
  if (/\b(efl|esl|sla|second language|language learning|language acquisition|applied linguistics|english language|foreign language|l2|bilingual|multilingual)\b/.test(q)) {
    intent.domain = 'language_learning';
  } else if (/\b(education|teaching|classroom|pedagogy|curriculum|instruction|learning)\b/.test(q)) {
    intent.domain = 'education';
  }

  // Focus detection
  if (/\b(motiv|engag|attitude|affect|willingness|anxiety|self.efficacy|autonomy|interest)\b/.test(q)) {
    intent.focus.push('motivation');
  }
  if (/\b(method|approach|technique|strategy|design|model|framework|curriculum|material)\b/.test(q)) {
    intent.focus.push('methodology');
  }
  if (/\b(vocabulary|grammar|pronunciation|reading|writing|speaking|listening|skill)\b/.test(q)) {
    intent.focus.push('skills');
  }
  if (/\b(technolog|digital|online|computer|ai|app|tool|software|e.learn)\b/.test(q)) {
    intent.focus.push('technology');
  }

  // Exclude signals — when motivation is focus, penalize pure methodology
  if (intent.focus.includes('motivation') && !intent.focus.includes('methodology')) {
    intent.exclude.push('general_teaching');
  }

  return intent;
}

// ── CONTROLLED QUERY EXPANSION ──
function buildExpandedQuery(query, intent) {
  // Keep expansion minimal — OpenAlex 500s on long queries
  if (intent.domain === 'language_learning' && intent.focus.includes('motivation')) {
    return query + ' motivation language learning';
  }
  if (intent.domain === 'language_learning') {
    return query + ' language learning';
  }
  if (intent.domain === 'education' && intent.focus.includes('motivation')) {
    return query + ' motivation learning';
  }
  return query;
}

// ── NORMALIZE OPENALEX RESULT ──
function normalizeResult(p) {
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
    link: doi ? 'https://doi.org/' + doi : (openAccessUrl || p.id || ''),
    pdfLink: openAccessUrl || '',
    source: 'openalex'
  };
}

// ── DUAL FILTER + RANKING LAYER ──
const LANG_SIGNALS    = ['efl','esl','sla','second language','language learning','language acquisition','applied linguistics','english language','foreign language','l2','bilingual'];
const MOTIV_SIGNALS   = ['motivation','motivat','engagement','engage','attitude','affect','willingness','anxiety','self-efficacy','autonomy','interest','learner psychology'];
const TEACHING_NOISE  = ['teacher cognition','instructional design','curriculum design','lesson planning','teacher training','syllabus','assessment design'];
const NOISE_DOMAINS   = ['mathematics','physics','chemistry','engineering','computer science','biology','medicine','economics'];

function rankAndFilter(results, intent, filter) {
  return results.map(p => {
    const text = (p.title + ' ' + p.abstract + ' ' + p.concepts.join(' ')).toLowerCase();
    let score = 0;

    // ── Base: citations ──
    score += Math.log1p(p.citationCount || 0) * 3;

    // ── Recency ──
    const year = parseInt(p.year) || 0;
    if (year >= 2020) score += 4;
    else if (year >= 2015) score += 2;

    // ── Language domain match ──
    const langMatches = LANG_SIGNALS.filter(s => text.includes(s)).length;
    score += langMatches * 4;

    // ── Motivation/affective match ──
    if (intent.focus.includes('motivation')) {
      const motivMatches = MOTIV_SIGNALS.filter(s => text.includes(s)).length;
      score += motivMatches * 5; // high weight — this is the core intent

      // Penalty: pure teaching methodology without motivation
      const teachingNoise = TEACHING_NOISE.filter(s => text.includes(s)).length;
      if (motivMatches === 0 && teachingNoise > 0) score -= 10;
    }

    // ── Education mode boost ──
    if (filter === 'education') {
      if (langMatches > 0) score += 5;
    }

    // ── Noise domain penalty ──
    const noiseDomains = NOISE_DOMAINS.filter(d => p.concepts.join(' ').toLowerCase().includes(d)).length;
    score -= noiseDomains * 6;

    p._score = score;
    return p;
  })
  .filter(p => {
    // Hard filter: remove clearly off-domain results
    if (intent.domain === 'language_learning' && intent.focus.includes('motivation')) {
      const text = (p.title + ' ' + p.abstract).toLowerCase();
      const hasLang = LANG_SIGNALS.some(s => text.includes(s));
      const hasMotiv = MOTIV_SIGNALS.some(s => text.includes(s));
      // Keep if has language signal OR motivation signal (not both required — recall matters)
      return hasLang || hasMotiv;
    }
    return true;
  })
  .sort((a, b) => b._score - a._score);
}

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

