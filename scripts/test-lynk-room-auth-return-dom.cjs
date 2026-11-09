// Execute the real auth surfaces with a shared room as the destination.
// All account, verification and profile IO is fixture-only, never live.
process.env.LYNK_ROOM_TARGET = '1';
require('./test-review-auth-return-dom.cjs');
