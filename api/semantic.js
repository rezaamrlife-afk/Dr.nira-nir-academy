export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query, start, sort } = req.query;
  if (!query) return res.status(400).json({ error: 'query required' });

  try {
    const offset = start || '0';
    const sortParam = sort === 'latest' ? 'published' : 'relevance';
    const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}&filter=type:journal-article&rows=10&offset=${offset}&select=DOI,title,abstract,author,published,is-referenced-by-count,container-title,type&sort=${sortParam}&order=desc&mailto=dr-nira@niracademy.com`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Dr-NIRA-Academic-App/1.0 (mailto:dr-nira@niracademy.com)' }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error('CrossRef ' + response.status + ': ' + errText.slice(0, 200));
    }

    const data = await response.json();
    const items = (data.message && data.message.items) || [];

    // Normalize to unified format
    const papers = items.map(function(p) {
      var authors = (p.author || []).map(function(a) {
        return (a.given ? a.given + ' ' : '') + (a.family || '');
      }).filter(Boolean);

      var year = '';
      if (p.published && p.published['date-parts'] && p.published['date-parts'][0]) {
        year = String(p.published['date-parts'][0][0] || '');
      }

      var title = Array.isArray(p.title) ? p.title[0] : (p.title || '');
      var venue = Array.isArray(p['container-title']) ? p['container-title'][0] : (p['container-title'] || '');
      var abstract = p.abstract ? p.abstract.replace(/<[^>]+>/g, '') : '';

      return {
        paperId: p.DOI || '',
        title: title,
        abstract: abstract,
        year: year,
        authors: authors.slice(0, 5),
        venue: venue,
        citationCount: p['is-referenced-by-count'] || 0,
        influentialCitationCount: 0,
        doi: p.DOI || ''
      };
    });

    res.status(200).json({ data: papers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
