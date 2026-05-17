'use client';

import QueueTable from '../../../components/QueueTable';

// All three tabs hit the same /pipeline/queue endpoint. The tabs only differ
// in which filters they pre-populate in the column dropdowns — the user can
// freely change them after that.
const ACTIVE_STATUSES = ['pending', 'blocked', 'preparing', 'captioning', 'training', 'running'];

export default function ActiveQueuePage() {
  return (
    <QueueTable
      key="active"
      initialSort={{ id: 'queuedAt', desc: false }}
      initialStatuses={ACTIVE_STATUSES}
    />
  );
}
