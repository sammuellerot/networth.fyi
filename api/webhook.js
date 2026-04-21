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
  const attrs = data?.attributes || {};

  // ends_at is when the current paid period ends (set on cancellation)
  // renews_at is the next billing date (set on active subscriptions)
  const endsAt = attrs.ends_at || null;
  const renewsAt = attrs.renews_at || null;

  let subscriptionStatus = 'trialing';
  let subscriptionEndsAt = null;

  if (eventName === 'order_created') {
    // Annual plan one-time purchase
    subscriptionStatus = 'active';
    // Annual = 1 year from now
    const endsDate = new Date();
    endsDate.setFullYear(endsDate.getFullYear() + 1);
    subscriptionEndsAt = endsDate.toISOString();

  } else if (eventName === 'subscription_created') {
    subscriptionStatus = 'active';
    subscriptionEndsAt = renewsAt || null;

  } else if (eventName === 'subscription_updated') {
    if (status === 'active') {
      subscriptionStatus = 'active';
      subscriptionEndsAt = renewsAt || null;
    } else if (status === 'cancelled') {
      // Cancelled but still paid through ends_at — keep active until then
      subscriptionStatus = 'cancelled';
      subscriptionEndsAt = endsAt || null;
    } else if (status === 'expired' || status === 'paused') {
      subscriptionStatus = 'expired';
      subscriptionEndsAt = null;
    }

  } else if (eventName === 'subscription_cancelled') {
    // User cancelled — keep access until end of billing period
    subscriptionStatus = 'cancelled';
    subscriptionEndsAt = endsAt || attrs.trial_ends_at || null;

  } else if (eventName === 'subscription_expired') {
    subscriptionStatus = 'expired';
    subscriptionEndsAt = null;
  }

  const { error: updateErr } = await supabase
    .from('user_settings')
    .upsert({
      user_id: userId,
      subscription_status: subscriptionStatus,
      subscription_ends_at: subscriptionEndsAt,
      ls_subscription_id: subscriptionId,
      ls_variant_id: variantId,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

  if (updateErr) {
    console.error('Error updating subscription:', updateErr);
    return res.status(500).json({ error: 'Failed to update subscription' });
  }

  console.log(`Updated: status=${subscriptionStatus}, ends_at=${subscriptionEndsAt} for user ${userId}`);
  return res.status(200).json({ received: true });
}
