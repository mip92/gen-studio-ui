'use client';

import QueueTable from '../../../components/QueueTable';

// "Done" tab — only successfully completed rows. Failed/cancelled rows live in
// the All tab (Status dropdown can be widened from here too).
export default function DoneQueuePage() {
  return (
    <QueueTable
      key="done"
      initialSort={{ id: 'completedAt', desc: true }}
      initialStatuses={['completed']}
    />
  );
}
