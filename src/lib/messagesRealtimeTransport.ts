import { RealtimeClient } from '@supabase/supabase-js';
import { env } from './env';
import type { ConnectMessages } from './messagesRealtime';

export function connectAccountMessages(userId: string, accessToken: string): ConnectMessages {
  return callbacks => {
    // A dedicated client belongs to this session only. A delayed cleanup or
    // token refresh from the previous account cannot authorize its replacement.
    const client = new RealtimeClient(`${env.supabaseUrl.replace(/^http/, 'ws')}/realtime/v1`, {
      params: { apikey: env.supabasePublishableKey },
      accessToken: async () => accessToken,
    });
    const channel = client.channel(`messages:${userId}`, { config: { private: true } });
    channel.on('broadcast', { event: 'messages_changed' }, event => {
      callbacks.changed(event.payload?.conversation_id);
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
