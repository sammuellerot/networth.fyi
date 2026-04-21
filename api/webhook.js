import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const WEBHOOK_SECRET = process.env.LS_WEBHOOK_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify webhook signature
  const signature = req.headers['x-signature'];
  const rawBody = JSON.stringify(req.body);
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  const digest = hmac.update(rawBody).digest('hex');

  if (signature !== digest) {
    console.error('Invalid webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { meta, data } = req.body;
  const eventName = meta?.event_name;
  const userEmail = meta?.custom_data?.user_email;

  console.log('Webhook received:', eventName, 'for:', userEmail);

  if (!userEmail) {
    console.error('No user_email in custom_data');
    return res.status(200).json({ received: true });
  }

  // Use service key to bypass RLS
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Get user by email
  const { data: { users }, error: userErr } = await supabase.auth.admin.listUsers();
  if (userErr) {
    console.error('Error fetching users:', userErr);
    return res.status(500).json({ error: 'Failed to fetch user' });
  }

  const user = users.find(u => u.email === userEmail);
  if (!user) {
    console.error('User not found:', userEmail);
    return res.status(200).json({ received: true });
  }

  const userId = user.id;
  const variantId = String(data?.attributes?.variant_id || data?.attributes?.first_order_item?.variant_id || '');
  const subscriptionId = String(data?.id || '');
  const status = data?.attributes?.status;

  let subscriptionStatus = 'trialing';

  if (eventName === 'order_created') {
    // Annual subscription purchase
    subscriptionStatus = 'active';
  } else if (eventName === 'subscription_created' || eventName === 'subscription_updated') {
    if (status === 'active') subscriptionStatus = 'active';
    else if (status === 'cancelled' || status === 'expired' || status === 'paused') subscriptionStatus = 'expired';
    else subscriptionStatus = 'trialing';
  } else if (eventName === 'subscription_cancelled') {
    subscriptionStatus = 'expired';
  }

  // Upsert user settings
  const { error: updateErr } = await supabase
    .from('user_settings')
    .upsert({
      user_id: userId,
      subscription_status: subscriptionStatus,
      ls_subscription_id: subscriptionId,
      ls_variant_id: variantId,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

  if (updateErr) {
    console.error('Error updating subscription:', updateErr);
    return res.status(500).json({ error: 'Failed to update subscription' });
  }

  console.log('Updated subscription status to', subscriptionStatus, 'for user', userId);
  return res.status(200).json({ received: true });
}
