# Code Review Findings — 2026-09-03

Source: 4-angle background review of `src/` (diff/line scan, removed-behavior audit,
cross-file tracer, reuse/simplification pass) against commit `915747e` and current
`master`. Ranked by confidence/impact. Check off as each is fixed.

## Correctness bugs

- [x] **1. Port-change race hands out a soon-to-be-disposed server manager**
      File: `src/extension.ts:134` (`handlePanelPortChanged`), `src/extension.ts:155-158` (`getOrCreateServerManager`)
      Verdict: CONFIRMED
      `handlePanelPortChanged()` leaves the module-level `serverManager` assigned while it
      `await`s `isInferenceServerRunning()`. If `getOrCreateServerManager()` runs during that
      window, it hands out the same manager to a new panel right before
      `handlePanelPortChanged()` disposes it — the new panel ends up holding a reference to a
      disposed manager on a just-killed process.
      Fix idea: clear/guard `serverManager` (or take a local snapshot + in-flight flag) before
      the first `await` in `handlePanelPortChanged`, so a concurrent `getOrCreateServerManager`
      call can't observe a manager that's about to be disposed.

- [x] **2. Uncaught TypeError when `/api/status` response lacks `config`**
      File: `src/server/statusBarManager.ts:74-75` (usage), `src/server/panelApiClient.ts:114-120` (`isStatusResponse`)
      Verdict: CONFIRMED
      `isStatusResponse()` validates only `state` and `pid`, not `config`. `refresh()`
      dereferences `status.config.method` / `status.config.port` outside the try/catch that
      guards `getStatus()`. A response shaped `{state, pid}` with no `config` field throws an
      uncaught `TypeError` inside the `void this.refresh()` interval callback, freezing the
      status bar.
      Fix idea: extend `isStatusResponse` to require `config` (with `method`/`port`), or move
      the property access inside the existing try/catch.

- [x] **3. Stale doc comment references a nonexistent safety-check function**
      File: `src/server/panelServerManager.ts:207-211`
      Verdict: CONFIRMED
      `dispose()`'s JSDoc says the caller should confirm via `checkInferenceRunningBeforeDispose`
      — no such function exists anywhere in the repo. The real guard is duplicated ad hoc in
      `playgroundPanel.ts`'s `handleDispose` and `extension.ts`'s `handlePanelPortChanged`.
      Fix idea: update the comment to name the actual pattern/call sites, or extract a shared
      helper (see finding 8) and reference that.

- [x] **4. Orphan reaper can kill an unrelated process via PID reuse**
      File: `src/server/panelServerManager.ts:34-41` (`isPidAlive`), `:48-69` (`reapOrphanedPanelProcess`)
      Verdict: PLAUSIBLE
      The reaper only checks PID existence (`process.kill(pid, 0)`) before sending `SIGTERM` to
      `-pid` (the whole process group) — no identity check (start time, cmdline, listening
      port). If the OS reuses a stale tracked PID for an unrelated process group after an
      unclean extension-host exit, the reaper kills the wrong thing.
      Fix idea: before killing, verify the tracked port is actually held by that PID (e.g. via
      `lsof`/`isReachable()` on the tracked port), or store enough identity info to
      cross-check.

- [x] **5. Panel dispose skips the new 'error'-state warning**
      File: `src/views/playgroundPanel.ts:161` (`handleDispose`)
      Verdict: PLAUSIBLE
      This commit added explicit `'error'`-state warnings to `stopInferenceServer`
      (`extension.ts`) and `profileActiveSession` (`profileManager.ts`) via
      `getInferenceServerState()`, but `handleDispose()` still calls the boolean
      `isInferenceServerRunning()`, which treats `'error'` the same as `'stopped'`. Closing the
      panel while the inference server is crashed silently skips the confirmation dialog.
      Fix idea: switch `handleDispose()` to use `getInferenceServerState()` and mirror the
      'error' handling added elsewhere in this commit.

- [x] **6. `dispose()` skips any kill attempt when `child.pid` is undefined**
      File: `src/server/panelServerManager.ts:214`
      Verdict: PLAUSIBLE
      The kill attempt is now gated on `this.child.pid !== undefined` with no else branch. The
      old code called `child.kill()` unconditionally whenever the child was live and not
      already killed. If `spawn()` ever returns a child with `pid === undefined` while
      `killed` is still `false` (e.g. spawn failed before the OS assigned a PID), dispose()
      now takes no cleanup action at all. Low real-world likelihood, but a silent narrowing of
      the "always attempt cleanup" invariant.
      Fix idea: add an `else` branch that still calls `this.child.kill()` as a fallback.

- [x] **7. `getOrCreateServerManager` lacks the in-flight dedup guard added to `ensureRunning`**
      File: `src/extension.ts:155-175`
      Verdict: PLAUSIBLE
      This commit added an in-flight-promise guard (`inFlightEnsureRunning`) to
      `PanelServerManager.ensureRunning()` to prevent double-spawns from concurrent calls, but
      left the structurally identical check-then-act pattern in `getOrCreateServerManager`
      unguarded. Two near-simultaneous invocations (e.g. rapid double-click while
      `resolveInterpreter()` is slow) can each construct a `new PanelServerManager`, with the
      second silently overwriting the first.
      Fix idea: add the same in-flight-promise pattern to `getOrCreateServerManager`.

## Reuse / simplification

- [x] **8. Inference-state dispatch logic (`'error'`/`'running'`/other) duplicated 3x**
      Files: `src/extension.ts` (`stopInferenceServer`), `src/server/profileManager.ts`
      (`profileActiveSession`), `src/server/statusBarManager.ts` (`refresh`)
      This commit introduced the same three-way `getInferenceServerState()` dispatch
      independently in three places (and finding 5 shows a fourth site, `playgroundPanel.ts`,
      was missed entirely). Factor into a shared helper on `panelServerManager.ts`.

- [x] **9. Response-shape validation added to only 1 of 8 `PanelApiClient` methods**
      File: `src/server/panelApiClient.ts`
      `isStatusResponse` guards `getStatus()` only. `getMethods`, `getModels`, `getMemory`,
      `getLogs`, `getProfile`, `start`, `stop` all still blindly cast `requestJson`'s result.
      The same "foreign process answers on the port" bug class this commit fixed for one
      endpoint still reproduces on the other seven.

- [x] **10. `formatBytes()` duplicated with diverging behavior**
      Files: `src/server/statusBarManager.ts:18-26`, `src/server/profileManager.ts:14-25`
      Two independent implementations (different null-handling and precision), no shared
      `utils` module exists. Consolidate into one shared helper.

- [x] **11. Default panel port (7860) hardcoded in 3 places, only 1 named constant**
      Files: `src/extension.ts:177` (`DEFAULT_PANEL_PORT`), `src/views/playgroundPanel.ts:50`,
      `src/views/recommendSidebarProvider.ts:215`
      The latter two re-type the raw literal `7860` instead of importing/sharing the constant.
      A future default-port change would silently miss two of three sites.

## Notes on angles that came back clean

- `LogTailManager.poll()` reschedule logic: no missed-reschedule / busy-loop risk found —
  actually more robust than the prior `setInterval` design.
- `refreshRecommend`/`provider.refresh()`: genuinely implements what the old code's comment
  only promised; not a regression.
- Windows kill fallback in `dispose()`: falls back correctly to `child.kill()`, though (as
  documented) that only kills the immediate process, not descendants — pre-existing
  limitation, not introduced by this diff.
