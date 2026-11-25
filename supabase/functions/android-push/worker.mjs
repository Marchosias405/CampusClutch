function deliveryResult(result, sending) {
  if (result?.status === 'ok') {
    if (!sending) return ['done', null];
    if (typeof result.id === 'string' && result.id.length) return ['ticket', result.id];
  }
  const code = result?.details?.error;
  if (code === 'DeviceNotRegistered') return ['invalid_device', null];
  if (code === 'MessageTooBig') return ['drop', null];
  return ['retry', null];
}

export async function processBatch(rpc, expo) {
  const jobs = await rpc('claim_android_push_jobs', {});
  for (const sending of [false, true]) {
    const batch = jobs.filter(job => sending ? !job.ticket : Boolean(job.ticket));
    if (!batch.length) continue;
    let results;
    try {
      if (sending) {
        results = await expo('send', batch.map(job => ({
          to:job.expo_token, title:'Clu',
          body:job.category === 'messages' ? 'You have a new direct message.' : 'You have a request update.',
          channelId:job.category === 'messages' ? 'messages' : 'requests',
          data:{ notificationId:job.notification_id }, ttl:3600,
        })));
      } else {
        const receipts = await expo('getReceipts', { ids:batch.map(job => job.ticket) });
        results = batch.map(job => receipts?.[job.ticket]);
      }
    } catch {
      results = [];
    }
    for (const [index, job] of batch.entries()) {
      const [result, ticket] = deliveryResult(results?.[index], sending);
      await rpc('finish_android_push_job', {
        p_id:job.job_id, p_lease:job.lease_id, p_result:result, p_ticket:ticket, p_token:job.expo_token,
      });
    }
  }
  return jobs.length;
}
