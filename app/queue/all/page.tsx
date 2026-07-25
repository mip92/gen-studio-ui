'use client';

import QueueTable from '../../../components/QueueTable';

// "All" tab - no status pre-filter. Opens in QUEUE order like the Active tab:
// the running job, then everything pending in the order it will be dispatched,
// then history newest-first.
export default function AllQueuePage() {
  return (
    <QueueTable
      key="all"
      initialSort={{ id: 'queue', desc: false }}
    />
  );
}
