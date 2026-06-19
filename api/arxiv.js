export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query, sortBy, start } = req.query;
  if (!query) return res.status(400).json({ error: 'query required' });

  try {
    const encoded = encodeURIComponent(query);
    const sort = sortBy || 'relevance';
    const offset = start || '0';
    const url = `https://export.arxiv.org/api/query?search_query=all:${encoded}&start=${offset}&max_results=10&sortBy=${sort}&sortOrder=descending`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Dr-NIRA-Academic-App/1.0' }
    });

    if (!response.ok) throw new Error('arXiv API error: ' + response.status);
    const xml = await response.text();
    res.setHeader('Content-Type', 'application/xml');
    res.status(200).send(xml);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
