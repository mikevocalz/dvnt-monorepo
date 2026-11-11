# Protected post engagement catalogue

`20261111042000_protected_post_engagement.sql` is source-only. Apply only in an approved database rollout after the private-follow and spicy read-gate prerequisites.

The direct `likes` and `comment_likes` REST tables previously retained permissive public reads. Their write policies could also admit forged user IDs. New restrictive policies compose with the existing policies rather than replacing them:

- Other members' like identities require access to the parent post, including private-follow approval, blocks, age/admission gates and post visibility.
- Each member may read only their own otherwise-hidden engagement row. This deliberate exception lets ordinary DELETE work after unfollow/block/privacy revocation, without exposing anyone else's identity or the parent content.
- INSERT requires the current verified database identity and visible parent; DELETE requires ownership. Anonymous/forged identities fail closed.
- Comment likes resolve the actual parent comment. Post comments use the same post gate; existing event-comment semantics are preserved. Orphan comments do not become public.
- Service-role behavior is unchanged. This does not replace endpoint authorization or CDN/media access controls.

Validation: `NODE_PATH=<test-dependency-directory> node --test scripts/test-protected-post-engagement.cjs scripts/test-weekly-post-follow-sql.cjs scripts/test-private-follow-requests-sql.cjs`.

The new regression first reproduces anonymous enumeration under the old policy, then applies the migration twice and checks anonymous/stranger denial, pending approval, approved reads, forged writes/deletes, actual own deletion after revocation, event comments, orphan rows and service bypass.
