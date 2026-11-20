import { RealtimeClient } from '@supabase/supabase-js';
import { env } from './env';
import type { ConnectMessages } from './messagesRealtime';

export function connectAccountNotifications(userId: string, accessToken: string): ConnectMessages {
  return callbacks => {
    // Dedicated session clients keep a delayed cleanup/token refresh from touching another account.
    const client = new RealtimeClient(`${env.supabaseUrl.replace(/^http/, 'ws')}/realtime/v1`, {
      params: { apikey: env.supabasePublishableKey },
      accessToken: async () => accessToken,
    });
    const channel = client.channel(`notifications:${userId}`, { config: { private: true } });
    channel.on('broadcast', { event: 'notifications_changed' }, () => {
      // Event content is never displayed or trusted; the scheduler reloads authorized RPCs.
      callbacks.changed(userId);
    }).subscribe(status => {
      if (status === 'SUBSCRIBED') callbacks.ready();
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') callbacks.unavailable();
    });
    return () => {
      client.disconnect();
      void client.removeAllChannels().catch(() => { /* Already disconnected. */ });
    };
  };
}
