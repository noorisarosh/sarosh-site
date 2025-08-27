const crypto = require('crypto');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // read token from cookie
  const cookieHeader = req.headers.cookie || '';
  const tokenPair = cookieHeader.split(';').map(c=>c.trim()).find(c => c.startsWith('token='));
  if (!tokenPair) return res.status(401).json({ error: 'Not authenticated' });

  const token = tokenPair.split('=')[1];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return res.status(401).json({ error: 'Invalid token' });

  const secret = process.env.SESSION_SECRET || 'dev-secret-change-me';
  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
  if (sig !== expected) return res.status(401).json({ error: 'Invalid token signature' });

  // optional: expire sessions older than SESSION_MAX_AGE_SEC (default 3600)
  let payload;
  try { payload = JSON.parse(Buffer.from(payloadB64,'base64').toString('utf8')); } catch(e) { return res.status(401).json({ error: 'Invalid token payload' }); }
  const ageMs = Date.now() - (payload.iat || 0);
  const maxAgeMs = (process.env.SESSION_MAX_AGE_SEC ? Number(process.env.SESSION_MAX_AGE_SEC) * 1000 : 3600 * 1000);
  if (ageMs > maxAgeMs) return res.status(401).json({ error: 'Session expired' });

  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'Missing message' });

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: message }],
        max_tokens: 600
      })
    });

    const data = await openaiRes.json();
    const reply = data?.choices?.[0]?.message?.content ?? (data?.error?.message ?? 'No reply');
    res.status(200).json({ reply });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
};

