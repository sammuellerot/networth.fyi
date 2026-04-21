const RESEND_API_KEY = process.env.RESEND_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { type, email, title, description, severity } = req.body;

  if (!email || !title || !description) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const subject = `[EquiTerra ${type === 'bug' ? 'Bug' : 'Feature'}] ${title}`;
    const html = `
      <div style="font-family:sans-serif;max-width:560px;color:#333">
        <h2 style="color:#1D9E75;margin-bottom:4px">${type === 'bug' ? '🐛 Bug Report' : '💡 Feature Request'}</h2>
        <p style="color:#666;font-size:13px;margin-bottom:20px">Submitted via EquiTerra feedback form</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#999;width:120px">From</td><td style="padding:8px 0;border-bottom:1px solid #eee">${email}</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#999">Type</td><td style="padding:8px 0;border-bottom:1px solid #eee">${type === 'bug' ? 'Bug Report' : 'Feature Request'}</td></tr>
          ${type === 'bug' ? `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#999">Severity</td><td style="padding:8px 0;border-bottom:1px solid #eee">${severity}</td></tr>` : ''}
          <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#999">Summary</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600">${title}</td></tr>
        </table>
        <div style="margin-top:20px;padding:16px;background:#f9f9f9;border-radius:8px;font-size:14px;line-height:1.6;white-space:pre-wrap">${description}</div>
      </div>
    `;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'EquiTerra Feedback <hello@equiterra.app>',
        to: 'sam.mueller@opsterra.com',
        reply_to: email,
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.message || 'Resend error');
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Feedback error:', err);
    return res.status(500).json({ error: err.message });
  }
}
