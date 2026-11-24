# Den Matchmaker PR #2 — draft-only mergeability and registration workflow review
**Verified:** November 21, 2026 UTC. **No PR merge or deployment performed.**

## Previously unresolved conflict
GitHub identified draft PR #2 as `mergeable:false`. The feature branch diverged from `main`, which had one newer commit altering only `.github/workflows/register-den-matchmaker-test.yml`. The two versions of that manual, test-only workflow differed in checkout behavior and descriptive text.

The `main` version included the existing typed `REGISTER_TEST_ONLY` manual dispatch gate, and additionally pinned checkout to `feature/den-matchmaker-mvp-2026-11-18` and set `persist-credentials:false`. The older draft copy omitted those two checkout constraints.

## Safe reversible change to DRAFT branch ONLY
Copied the already-reviewed `main` workflow content byte-for-byte into the draft branch using a single-file GitHub contents update, commit `9ae80f6e3cd12cbe56d95c6415476711839787ae`. Independent GitHub readback confirmed both files have identical blob SHA `11dd211123cbc151039c07df5aa3f801055b982d`. Neither the manual dispatch gate nor the target test-only branch was relaxed.

After that write, GitHub reported PR #2 **`draft:true`, `merged:false`, `mergeable:true`**. This clears the previously observed *Git merge conflict*, **not** the independent security, live ACK, approved bot-owned publishing/cleanup, or deployment gates. The manual registration workflow was **not triggered**, and no command, Discord setting, member state, public post, database state, production Den Missions project, or original manual Squad Finder was modified.

## Validation / next steps
Earlier code/docs head `053f50ba` passed [Node 246/246](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44885623889), [Edge](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44885623881), and [disposable PostgreSQL](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44885623900). This workflow-only change does not authorize registration. Keep the test app registration manual; do not invoke it without separately granted Discord approval. Wait for explicit launch approval before any production merge, deployment, bot installation, or public posting.
