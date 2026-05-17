import { redirect } from 'next/navigation';

// /queue is just an alias for the default tab. A Server Component redirect
// keeps the user from seeing an empty shell page while client JS hydrates.
export default function QueuePage() {
  redirect('/queue/active');
}
