/** URL parameters are untrusted navigation hints, never payment evidence. */
export default function Page(){
 return <main className="mx-auto max-w-xl space-y-4 p-6"><h1>Confirming your order</h1><p>Your payment and order still need to be verified. Returning from checkout does not confirm payment or ticket issuance.</p><p>Please do not pay again. Check My Tickets or the original email address used for your order. Contact support if it has not appeared.</p><a href="/feed/events/my-tickets">Check My Tickets</a></main>;
}
