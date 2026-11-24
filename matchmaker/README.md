# The Den Matchmaker — minimum safe release, isolated staging only

**Current decision (November 24, 2026): NOT launched.** Existing manual Squad Finder remains available at https://fierclioness.github.io/lioness-den-squad-finder/. Production Den Missions `cpjcjcxinhjusosaguyi` is outside this project. Draft PR #2 is unmerged.

## Verified baseline and remaining gates

- Restricted private `/squad` create, preview, confirmation, mine/list and close succeeded on November 20. Signed requests, persistent replay rejection, explicit consent and mocked original-bot receipts have extensive passing CI evidence.
- Hosted staging `tcxktyqywsqafnyxhpgy`: signed webhook v19; separate inert named-secret worker v1. Missing key 401 and dedicated-key disabled 503 confirmed. Do not repeat these already-passed checks without relevant changes.
- Bounded privacy functions `purge_expired_transient_rows` and administrator-only `purge_resolved_listings` are installed in staging after green CI on c9a8ff75. No purge has been run. No public posting, automatic Discord deletion, scheduler, member edits or production changes authorized.
- This draft introduces the smallest controlled-test runtime wiring: explicit single-tester enqueue and a manually invoked single-item publisher on the existing separate worker. Both are OFF by default. The publisher uses the existing named-secret wrapper **and** the independent operator-key gateway, fixed reviewed channel and original bot identity. No deletion route, recurring schedule or new service is required. Nothing in this draft has been deployed.
- Before any controlled real test: review green CI, authorize one synthetic listing and exactly one original test-bot post in the owner-approved #squad-up destination, confirm the bot's channel permissions and identity, configure test-only credentials privately, deploy only to isolated staging, and verify the queue is empty. Do not enable member-wide commands. Do not reuse production credentials.

## Controlled test (separate explicit owner approval required)

1. Owner chooses one authorized tester and confirms the exact existing #squad-up channel and original test bot; no new guild installation or app permission change without its own approval. Use clearly labeled synthetic preferences, not member information.
2. Store credentials only through staging secret controls: existing dedicated `den_matchmaker_scheduler` API key, independent `DEN_MATCHMAKER_OPERATOR_KEY`, `DEN_MATCHMAKER_TEST_BOT_TOKEN`, `DEN_MATCHMAKER_TEST_BOT_USER_ID`, `DEN_MATCHMAKER_TEST_CHANNEL_ID`, one `DEN_MATCHMAKER_TESTER_IDS` entry. No credential values in chat, GitHub, logs or screenshots. Verify staging DB connection resolves only to this project. For a future production release, independently review a dedicated least-privilege runtime database identity; staging credentials must never be reused.
3. Only for the approved test window, enable `DEN_MATCHMAKER_COMMANDS_ENABLED`, `DEN_MATCHMAKER_TEST_ENQUEUE_ENABLED`, and `DEN_MATCHMAKER_TEST_PUBLISH_ENABLED`. Verify the owner-only preview explicitly says Post to #squad-up; Cancel first, then create a fresh preview and confirm one synthetic listing. Measure actual client acknowledgement. Verify exactly one pending job and no unrelated jobs before invoking the publisher.
4. Invoke one POST to the existing worker's `/publish` route with the named key and operator key header `x-matchmaker-scheduler-key`, **no request body**. Never retry an ambiguous send. Verify actual bot authorship, expected channel, exact message content/reference, one stored receipt, and no duplicate. Immediately disable both enqueue and publish flags; do not schedule calls.
5. Close the test listing. Manual moderation is sufficient for MVP: separate owner approval is required for any actual Discord removal; no automatic DELETE endpoint is used. Verify absence as below. Confirm the emergency disable and no other messages. Independently review security and privacy before requesting separate release approval.

## Minimum viable privacy and daily moderator procedure

Listings are visible through /squad only while active and unexpired (36h maximum). A member can close their listing at any time. A Discord post is not automatically removed merely because the database listing closes. Before public launch, the owner must accept daily moderation coverage and publish accurate notice of what is stored, the retention window and how to request removal; never promise automatic deletion when it is disabled.

Authorized database administrator, isolated staging only until separate production approval:

- Keep posting and automatic cleanup OFF during manual maintenance. Run the existing bounded `expire_due_listings(100)` RPC to mark expired listings, cancel unsent jobs and queue known receipts. It makes no Discord calls. Review due/closed listings and their cleanup receipts; never expose owner IDs to public channels or logs.
- For each expired/closed post, verify the exact receipt's message ID, channel ID, original bot ID and persisted listing reference against authenticated Discord GET. Only a moderator may remove the verified message, with appropriate approval. Re-fetch the same message using the authorized original bot. **Only Discord's exact Unknown Message (HTTP 404 / code 10008) with known channel access establishes absence.** A permission error, generic 404 or search miss does not. Record the time and verification outcome privately without credentials or member preferences.
- After verified absence, an administrator can mark the existing exact cleanup row done (never a claimed/in-flight row). Use a transaction, lock the listing first, and compare all receipt identifiers and inactive status. The example below is an operator procedure, NOT a scheduled query or permission to edit data. Substitute only independently verified values; require exactly one returned row before committing; otherwise roll back.

```sql
begin;
select id from matchmaker_internal.squad_listings
 where id = :verified_listing_id
   and (status in ('closed','expired') or expires_at <= clock_timestamp())
 for update;
update matchmaker_internal.cleanup_outbox c
 set state='done', claimed_by=null, updated_at=clock_timestamp()
 from matchmaker_internal.post_receipts r,
      matchmaker_internal.post_outbox o,
      matchmaker_internal.squad_listings s
 where c.listing_id=:verified_listing_id
   and c.listing_id=r.listing_id and c.listing_id=o.listing_id
   and c.listing_id=s.id and c.state in ('pending','uncertain')
   and o.state='posted' and o.posted_message_id=r.discord_message_id
   and c.message_id=r.discord_message_id and c.channel_id=r.channel_id
   and c.bot_user_id=r.bot_user_id
   and c.message_id=:verified_message_id and c.channel_id=:verified_channel_id
   and c.bot_user_id=:verified_bot_id
   and (s.status in ('closed','expired') or s.expires_at<=clock_timestamp())
 returning c.listing_id;
-- Commit only after confirming exactly one locked listing and one updated row.
-- Otherwise ROLLBACK. Never execute against Den Missions.
```

- Once daily, after the owner has approved the real retention process, the administrator invokes the bounded transient purge and resolved listing purge: `select * from matchmaker_internal.purge_expired_transient_rows(100);` and `select matchmaker_internal.purge_resolved_listings(100);`. The former preserves the replay safety margin; the latter requires at least 24 hours since close/expiry and excludes uncertain or unresolved public deliveries. Keep aggregate counts only. The proposed daily cadence means deletion eligibility at 24h, not guaranteed deletion exactly at 24h.
- For sending/uncertain jobs, stop publishing, wait until all in-flight calls are definitively quiescent, and investigate the exact listing reference in the approved channel. Do not retry or purge based on a search miss. Recover a known receipt via the existing verified manual reconciliation procedure. If no authoritative receipt/absence can be established, escalate to the privacy administrator promptly for an auditable case-specific deletion decision; unresolved evidence must not become indefinite routine retention. A workable verified resolution/deletion procedure and privacy request coverage must be signed off before member launch. The controlled synthetic test must stop on ambiguity.
- Emergency disable: turn both test enqueue and publish flags OFF immediately, disable commands if necessary, and keep the named-auth worker inert. Preserve the original Squad Finder. No automatic Discord deletion or advanced scheduling is an MVP launch gate.

## Explicit decisions outstanding

Controlled real Discord test approval (one synthetic post only), real client acknowledgement and correct-channel receipt, independently reviewed manual retention/removal and unresolved-delivery handling, credential/permission security review, and explicit launch approval. No PR merge, production changes, member-data modification or public launch is authorized by this document.
