/**
 * Client-side source of truth for personal-call capacity.
 *
 * The server is the final authority; these constants keep the app validator,
 * copy, and payload hints aligned with the backend so a call with 12 total
 * humans is accepted everywhere it is checked.
 */
export const CALL_HUMAN_CAPACITY = 12;
export const CALL_MAX_INVITEES = CALL_HUMAN_CAPACITY - 1; // 11
