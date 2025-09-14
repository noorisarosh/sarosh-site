export default async function handler(req, res) {
  // Set CORS headers to allow requests from browser extensions
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
asdasdasd asdas dsa
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const { prompt } = req.body;

    // Validate input
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Valid prompt is required' });
    }

    // Get your API key from environment variables
    const apiKey = process.env.AI_API_KEY;
    if (!apiKey) {
      console.error('ERROR: AI_API_KEY environment variable is not set');
      return res.status(500).json({ error: 'Server configuration error: API key not set' });
    }

    console.log('Making request to OpenAI with prompt:', prompt.substring(0, 50) + '...');

    // For OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      return res.status(500).json({ error: `AI service error: ${response.status}` });
    }

    const data = await response.json();
    const aiResponse = data.choices[0]?.message?.content || 'No response from AI';
    
    console.log('Successfully received response from OpenAI');
    res.status(200).json({ response: aiResponse });
  } catch (error) {
    console.error('Unexpected error:', error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
}

