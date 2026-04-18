import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const APP_URL = process.env.APP_URL || 'https://networth-fyi.vercel.app';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify cron secret
  const authHeader = req.headers['authorization'];
  const secret = authHeader?.replace('Bearer ', '');
  if (secret !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Get all users with reminders enabled
    const { data: users, error } = await sb
      .from('user_settings')
      .select('user_id, subscription_status, trial_start')
      .eq('reminder_enabled', true);

    if (error) throw error;
    if (!users?.length) return res.status(200).json({ sent: 0 });

    // Only email active users (active subscription or in trial)
    const activeUsers = users.filter(u => {
      if (u.subscription_status === 'active') return true;
      if (u.trial_start) {
        const days = (Date.now() - new Date(u.trial_start).getTime()) / (1000*60*60*24);
        return days <= 14;
      }
      return false;
    });

    if (!activeUsers.length) return res.status(200).json({ sent: 0 });

    const month = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const quickEntryUrl = `${APP_URL}/app?quick=1`;
    let sent = 0;

    for (const user of activeUsers) {
      // Get email from auth
      const { data: userData } = await sb.auth.admin.getUserById(user.user_id);
      const email = userData?.user?.email;
      if (!email) continue;

      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Networth.fyi <onboarding@resend.dev>',
          to: email,
          subject: `Time to update your net worth — ${month}`,
          html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0b;font-family:Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
<tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
<tr><td style="padding-bottom:28px;"><span style="font-family:Georgia,serif;font-size:22px;color:#f0ede8;">Networth.fyi</span></td></tr>
<tr><td style="background:#111113;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:32px;">
  <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#5a5550;">Monthly reminder</p>
  <h1 style="margin:0 0 14px;font-size:22px;font-weight:600;color:#f0ede8;">Time to log ${month}</h1>
  <p style="margin:0 0 24px;font-size:14px;color:#8a8580;line-height:1.65;">15 minutes is all it takes. Click below to jump straight into Quick Entry.</p>
  <a href="${quickEntryUrl}" style="display:inline-block;background:#1D9E75;color:#fff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:8px;">Update my net worth →</a>
</td></tr>
<tr><td style="padding-top:20px;">
  <p style="margin:0;font-size:12px;color:#3a3530;line-height:1.6;">You're receiving this because you enabled monthly reminders in your <a href="${APP_URL}/app" style="color:#5a5550;">settings</a>. To turn off, go to Settings → Monthly entry reminder.</p>
</td></tr>
</table></td></tr></table>
</body></html>`,
        }),
      });

      if (resp.ok) sent++;
      else console.error(`Failed to send to ${email}:`, await resp.text());
    }

    return res.status(200).json({ sent, total: activeUsers.length });

  } catch (err) {
    console.error('Reminder error:', err);
    return res.status(500).json({ error: err.message });
  }
}
