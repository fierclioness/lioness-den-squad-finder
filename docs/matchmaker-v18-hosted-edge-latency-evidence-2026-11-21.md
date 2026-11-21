# Den Matchmaker — hosted staging Edge latency baseline (November 21, 2026 UTC)

**Status: READ-ONLY OBSERVABILITY EVIDENCE ONLY.** This is not a live Discord-client acknowledgement test, a performance certification, launch clearance, or permission to enable anything. Isolated staging project `tcxktyqywsqafnyxhpgy` only; production Den Missions `cpjcjcxinhjusosaguyi` was not accessed.

## Method

Queried the isolated Supabase project's unified logs on November 21, 2026 (approximately 11:45 UTC) using a **rolling previous-24-hour** read-only ClickHouse summary. Restricted to `source='function_edge_logs'`, `version='18'`, and grouped by HTTP request method/path/status. Metrics are Supabase's `log_attributes['execution_time_ms']`, **NOT** network round-trip, browser/client rendering, or Discord acknowledgement time. The aggregate does not include payloads, user IDs, IP addresses, tokens, secrets or member data.

Reproducible query for a *new* 24-hour window (figures below will change as the window moves):

```sql
select
  log_attributes['request.method'] as method,
  log_attributes['request.pathname'] as path,
  log_attributes['response.status_code'] as status,
  count() as requests,
  round(avg(toFloat64OrNull(log_attributes['execution_time_ms'])),1) as mean_ms,
  quantile(0.95)(toFloat64OrNull(log_attributes['execution_time_ms'])) as p95_ms,
  max(toFloat64OrNull(log_attributes['execution_time_ms'])) as max_ms
from logs
where source = 'function_edge_logs'
  and log_attributes['version'] = '18'
group by method, path, status
order by requests desc
limit 30;
```

## Observed staging measurements

| v18 route | Status | Requests | Mean edge execution | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| POST `/functions/v1/den-matchmaker` | 200 | 8 | 230.8 ms | 406.05 ms | 433 ms |
| POST `/functions/v1/den-matchmaker` | 401 | 122 | 58.3 ms | 152.25 ms | 1,132 ms |
| GET `/functions/v1/den-matchmaker/health` | 200 | 117 | 231.9 ms | 537.4 ms | 1,519 ms |

The **eight HTTP 200 POSTs** are a small mixture of requests **not distinguishable as /squad commands versus signed PING solely from these access-log fields**. Even if each were an authorized command, server execution time does not prove Discord received the initial acknowledgement within three seconds. The 401s are rejected HTTP requests, not accepted interactions; the health samples are not Discord commands. Neither may be combined with the eight 200s to inflate the sample size. The maximum under two seconds here does **not** close the Discord-client ACK gate.

The existing offline 2,000-ms local headroom / 3,000-ms Discord deadline diagnostics remain distinct from this hosted evidence. A representative real, authorized client-observed /squad test under varied network/cold-start conditions is still required and must be **separately authorized** before changing command registration or app/guild settings.

## Independent read-only safety inventory

- Isolated staging `den-matchmaker` Edge **v18 ACTIVE**, and **no separate worker deployment** was listed.
- Seven private `matchmaker_internal` tables: **1** opt-in listing; **1** pending preview; **9** replay rows; **0** post-outbox, cleanup-outbox, post-receipt or reconciliation-audit rows. No inserts/updates/deletes were issued to inspect this state.
- Security advisor: **seven informational** `rls_enabled_no_policy` findings (one per private RLS-protected table), [Supabase lint reference](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). This is consistent with an intentionally inaccessible private schema but does **not**, by itself, prove full authorization correctness.
- Performance advisor: two informational `unused_index` findings (`discord_interaction_replays_expiry`, `post_outbox_retry_idx`), [Supabase lint reference](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index). Low staging utilization is not justification to drop indexes needed after launch.
- GitHub draft PR #2 was **mergeable, still draft and unmerged** at observation time. No changes to existing manual Squad Finder.

## Release decision

**Do not launch.** This is valuable server-side baseline visibility, not the necessary live Discord-client ACK. Separately permitted original-bot POST and exact-reference GET-before-DELETE controlled E2E, authenticated scheduler/expiry exercise, independent security review, and explicit release approval are still pending. Keep public posting, scheduler, commands and guild installation disabled. Never merge/deploy to production or alter Den Missions production, live Discord settings or member data without separate permission.
