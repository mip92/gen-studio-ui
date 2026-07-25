'use client';

import QueueTable from '../../../components/QueueTable';

// All three tabs hit the same /pipeline/queue endpoint. The tabs only differ
// in which filters they pre-populate in the column dropdowns — the user can
// freely change them after that.
//
// This one opens in QUEUE order (the `#` column, ascending): the running job
// first, then everything else in the order it will actually be dispatched.
// Sorting by queuedAt would not answer "who is next" — reordering a job rewrites
// its queue position, never its queued-at timestamp.
export default function ActiveQueuePage() {
  return (
    <QueueTable
      key="active"
      initialSort={{ id: 'queue', desc: false }}
      initialStatuses={['pending', 'running']}
      hiddenColumns={['completedAt']}
    />
  );
}
