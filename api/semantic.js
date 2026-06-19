export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query, start } = req.query;
  if (!query) return res.status(400).json({ error: 'query required' });

  try {
    const offset = start || '0';
    // tldr removed — requires API key on free tier
    const fields = 'title,abstract,year,citationCount,influentialCitationCount,venue,authors';
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=10&offset=${offset}&fields=${fields}`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Dr-NIRA-Academic-App/1.0' }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error('Semantic Scholar ' + response.status + ': ' + errText.slice(0, 200));
    }
    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
