export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { systemPrompt, userPrompt } = req.body;
  if (!userPrompt) return res.status(400).json({ error: 'Prompt is required' });

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        max_tokens: 1500,
        temperature: 0.5,
        messages: [
          {
            role: 'system',
            content: systemPrompt || 'You are Dr. NIRA, an expert PhD research proposal analyst. Be specific, thorough, and scholarly.'
          },
          {
            role: 'user',
            content: userPrompt
          }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data.error?.message || 'Groq API error' });

    const result = data.choices?.[0]?.message?.content || '';
    return res.status(200).json({ result });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
