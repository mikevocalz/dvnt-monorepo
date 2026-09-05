import { redirect } from 'next/navigation';

/** The console now lives INSIDE the admin (/admin is the ops home). */
export default function Page() {
  redirect('/admin');
}
