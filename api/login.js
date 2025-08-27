const crypto = require('crypto');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Missing password' });

  // SITE_PASSWORD is set on Vercel (see instructions below)
  if (password !== process.env.SITE_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  // make a simple signed token (no DB)
  const payload = JSON.stringify({ iat: Date.now() });
  const payloadB64 = Buffer.from(payload).toString('base64');
  const secret = process.env.SESSION_SECRET || 'dev-secret-change-me';
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
  const token = `${payloadB64}.${sig}`;

  // set cookie (HttpOnly so JS can't read it). Adjust Max-Age if you want longer sessions.
  let cookie = `token=${token}; HttpOnly; Path=/; Max-Age=${60 * 60}; SameSite=Lax`;
  if (process.env.NODE_ENV === 'production') cookie += '; Secure';

  res.setHeader('Set-Cookie', cookie);
  res.status(200).json({ ok: true });
};
