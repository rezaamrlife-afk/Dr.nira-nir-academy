export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, messages } = req.body;
  if (!prompt && !messages) return res.status(400).json({ error: 'Prompt or messages required' });

  // Build messages array — support both single prompt and multi-turn messages
  const chatMessages = messages || [
    {
      role: 'system',
      content: 'You are Dr. NIRA, an expert academic research advisor specializing in PhD proposals. Write in formal, precise academic English. Be thorough, scholarly, and structured. Never use placeholder text — always write complete, real academic content.'
    },
    { role: 'user', content: prompt }
  ];

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        max_tokens: 2000,
        temperature: 0.65,
        messages: chatMessages
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
