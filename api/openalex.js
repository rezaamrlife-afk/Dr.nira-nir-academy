export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query, sort, page, filter } = req.query;
  if (!query) return res.status(400).json({ error: 'query required' });

  try {
    const perPage = 10;
    const p = page || '1';
    const sortParam = sort === 'latest' ? 'publication_year:desc' : 'cited_by_count:desc';
    
    // Build filter — education focus or general
    let filterParam = 'has_abstract:true';
    if (filter === 'education') {
      filterParam += ',concepts.id:C144024400'; // Education concept ID
    }

    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&filter=${filterParam}&sort=${sortParam}&per-page=${perPage}&page=${p}&select=id,title,abstract_inverted_index,authorships,publication_year,cited_by_count,concepts,primary_location,doi,open_access&mailto=dr-nira@niracademy.com`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Dr-NIRA-Academic-App/1.0' }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error('OpenAlex ' + response.status + ': ' + errText.slice(0, 200));
    }

    const data = await response.json();
    const results = (data.results || []).map(function(p) {
      // Reconstruct abstract from inverted index
      var abstract = '';
      if (p.abstract_inverted_index) {
        var wordMap = {};
        Object.keys(p.abstract_inverted_index).forEach(function(word) {
          p.abstract_inverted_index[word].forEach(function(pos) {
            wordMap[pos] = word;
          });
        });
        var positions = Object.keys(wordMap).map(Number).sort(function(a,b){return a-b;});
        abstract = positions.map(function(pos){ return wordMap[pos]; }).join(' ');
      }

      var authors = (p.authorships || []).slice(0, 5).map(function(a) {
        return a.author ? a.author.display_name : '';
      }).filter(Boolean);

      var venue = '';
      if (p.primary_location && p.primary_location.source) {
        venue = p.primary_location.source.display_name || '';
      }

      var concepts = (p.concepts || []).slice(0, 4).map(function(c){ return c.display_name; });
      var openAccessUrl = p.open_access && p.open_access.oa_url ? p.open_access.oa_url : '';
      var doiUrl = p.doi ? 'https://doi.org/' + p.doi.replace('https://doi.org/', '') : '';

      return {
        id: p.id || '',
        title: p.title || '',
        abstract: abstract,
        year: p.publication_year ? String(p.publication_year) : '—',
        authors: authors,
        venue: venue,
        citationCount: p.cited_by_count || 0,
        concepts: concepts,
        link: doiUrl || openAccessUrl || p.id || '',
        pdfLink: openAccessUrl || '',
        source: 'openalex'
      };
    });

    res.status(200).json({
      data: results,
      total: data.meta ? data.meta.count : results.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
