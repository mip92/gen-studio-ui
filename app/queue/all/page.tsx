'use client';

import QueueTable from '../../../components/QueueTable';

// "All" tab — no pre-filter, newest first.
export default function AllQueuePage() {
  return (
    <QueueTable
      key="all"
      initialSort={{ id: 'queuedAt', desc: true }}
    />
  );
}
