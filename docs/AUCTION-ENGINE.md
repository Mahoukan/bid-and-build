# Deterministic auction engine — Milestone 2

The engine implements the agreed auction rules as pure TypeScript. It imports only shared schemas/types and other engine modules. It does not access React, sockets, databases, wall clocks, randomness, timers, files or environment variables. The browser is still the Milestone 1 shell; real room transport and transactional persistence are Milestone 4.

## Entry points

Import from `engine/index.ts` in source, or `dist/engine/index.js` after building:

- `defaultAuctionSettings()` returns the agreed 20 / $ / opening 1 / increment 1 defaults.
- `createGame(input)` validates a supplied unique game ID, host seat, player identities, settings and ordered option IDs. It returns a detached lobby snapshot. Invalid creation input throws a validation error.
- `transition(state, actorPlayerId, command)` validates a private snapshot, actor, command scope, permissions and phase. Success returns `{ ok: true, state, events }`. A rejected command returns `{ ok: false, state: originalState, events: [], error }`, including a current minimum for a low bid. Neither path mutates the input.
- `parseGameState(unknown)` validates a JSON-rehydrated snapshot, including its ledger, balances, IDs, phase and terminal results, and returns a detached copy. `gameStateSchema` alone checks structure; use this entry point for persisted engine state.
- `minimumBid(state)` returns the next minimum during bidding, or `null` otherwise. It still reports the committed auction's minimum while paused; that is not permission to bid.

There are no timestamps to inject yet. The caller supplies the globally unique `gameId` and stable player/option IDs. The engine derives run IDs as `gameId:run:N` and auction IDs as `runId:auction:N` (one-based ID suffix, zero-based `optionIndex`). Play Again increments the run number instead of accepting a potentially reused ID. The same input and command sequence always produce the same state and ordered events.

Example using explicitly labelled test data:

```ts
import { createGame, defaultAuctionSettings, transition } from './engine/index.js';

const lobby = createGame({
  gameId: 'example-only',
  hostPlayerId: 'alex',
  players: [{ id: 'alex', name: 'Alex' }, { id: 'morgan', name: 'Morgan' }],
  settings: defaultAuctionSettings(),
  optionIds: ['firebreathing', 'storm-wings'],
});
const started = transition(lobby, 'alex', {
  commandId: 'start-example',
  gameId: lobby.gameId,
  runId: lobby.runId,
  auctionId: null,
  phase: 'lobby',
  type: 'start',
});
```

## Commands and state

Every command has `commandId`, `gameId`, `runId`, `auctionId` (null in a lobby) and expected `phase`. The actor is a separate argument and **must eventually come from the authenticated room session**, not a client-provided seat claim. Names do not confer identity. Admin accounts have no engine permission or special seat type.

| Command | Actor / phase | Result |
| --- | --- | --- |
| `start` | Host, lobby with 2–5 seats | Opens the first option |
| `bid`, `amount` | Non-leading, non-conceding player, bidding | Accepts an affordable whole-number bid at or above the minimum; settles immediately if nobody else can raise |
| `giveUp` | Non-leading, not-yet-conceded player, bidding | Concedes this option; a final eligible player buys at opening price |
| `skip` | Host, bidding with no leader | Unclaimed result and reveal, no charge |
| `next` | Host, reveal | Opens the next option or completes the run |
| `pause` / `resume` | Host, active game | Toggles a separate pause flag without changing the underlying phase |
| `end`, `confirmed: true` | Host, unfinished run | Settles a binding bid once, resolves remaining options and finishes incomplete; also works while paused |
| `playAgain` | Host, finished | Resets budgets/history/concessions into a fresh lobby; keeps seats and host |

State contains stable player IDs, names/balances, host ID, run/revision, ordered option IDs, current auction/index/leader/concessions, accepted bid history, purchases, unclaimed/unplayed records and completion status. It has no overall winner, ranking, combat or scoring. A player's build is the purchase records with that player's ID, joined to the private content snapshot by option ID; keeping one ledger avoids a second mutable collection.

All accepted commands increment `revision` once, even if they return multiple events. Rejections leave it unchanged. Simultaneous requests must be delivered sequentially by the future server. A second equal bid fails the updated minimum; a concession queued for an already settled option fails the phase/auction context. Full command-receipt deduplication is deliberately **not** implemented here: Milestone 4 must persist receipts scoped by actor/run/command ID and return the original receipt before retrying a transition. Engine guards prevent repeated payment, but they are not a substitute for transport receipts.

## Economic and lifecycle decisions

- Creation allows one seated host waiting in the lobby; Start requires 2–5 players. Six-player inputs and snapshots are invalid. Host identity must refer to an existing seat and need not be the first player in the array.
- Only settlement changes balances. The winner pays their accepted bid, or the opening price for a no-bid automatic purchase. A leading bid does not reserve/debit funds early. Losing bidders pay nothing.
- Opening price and increment are independent. A raise may jump by any amount meeting the minimum; it need not be an increment multiple. If the calculated next minimum exceeds every opponent's balance, the leader wins at the existing price.
- Bet All is the ordinary `bid` command with the player's exact balance. Its separate UI and exact-amount confirmation are later presentation work. The engine applies all normal leader, concession, price and balance checks.
- Give Up is sequential, irreversible for this option, and resets on the next. A non-leader may explicitly concede even if already unable to afford a raise; this does not imply that an absent or broke player has silently conceded. There is no simultaneous everyone-passes operation. Host Skip is the route to leave an unwanted unbid option unclaimed.
- At each opening: two or more funded players bid normally; one buys at opening price and gets an individual reveal; zero means unclaimed. Because the opening price is fixed, zero funded players also marks the later options unclaimed and finishes normally with reason `noEligiblePlayers`.
- Automatic purchases are advanced one reveal at a time. A player with $3 pays for exactly three subsequent $1 options before the remaining options become unclaimed. A positive balance below the opening price cannot buy an option.
- A revealed but skipped option has an auction ID. Future options never opened have a null auction ID. End marks a current unbid option `unclaimed` and future options `unplayed`, both with reason `hostEnded`. Exhaustion marks remaining options `unclaimed` with reason `noEligiblePlayers`.
- Paused bidding rejects Bid, Give Up, Skip and ordinary progression. Paused reveals reject Next. Resume preserves the auction/result and does not replay any purchase. There is no public settlement command and no bidding countdown. Reveal timing and recoverable server scheduling are Milestone 4 work.
- Confirmed End is the sole pause exception. It settles a live leader at exactly the accepted amount, then finishes incomplete. Ending during a reveal preserves the already-settled purchase. Ending an unstarted lobby is treated as cancellation: all options are unplayed, with no charge. Every other command on a finished run is rejected except Play Again.
- Play Again resets the current run's arrays and money but keeps settings, ordered option IDs, stable seats and host permission. The future persistence layer must retain prior-run ledger rows/receipts separately. New run IDs prevent old commands from becoming valid again.

Creation limits: IDs 1–64 ASCII letters/digits/underscores/hyphens; names 1–40 trimmed characters; 1–200 unique ordered option IDs; settings 1–1,000,000 whole units; symbol 1–8 characters. Generated scope IDs allow colons and up to 96 characters. Run numbers are capped at 1,000,000 and revisions at the maximum safe integer; commands cannot wrap or recycle either. Commands reject extra fields, numeric strings, fractions, non-finite/unsafe numbers and oversized data. Full template/image validation remains Milestone 3.

## Integration boundary

This snapshot and the full event stream are **private server data**. Ordered future option IDs are not a public projection. Do not broadcast a transition result directly. Milestone 4 must attach immutable template content, hide unrevealed fields/assets, authenticate actors, process each room in order, and persist state/ledger/receipts in one transaction before acknowledgement/broadcast. The database must enforce a unique settlement per game/run/option even after restart.

The pure engine has no network presence, recovery codes, controller sockets, timers or database access. Those now live in the server boundary. Milestone 6 adds a confirmed host `sitOut` transition while paused: preserve purchases and binding commitments, set the player's run-local `sittingOut` flag and exclude new bids/automatic purchases. Old snapshots default the flag to false. Resume can settle a result forced by Sit Out; it never settles while paused. If all remaining funded players conceded this option, unclaim only this option and let them return next option. Play Again resets participation. Server validation additionally requires the target to be offline; temporary disconnects never set this flag. See `RECOVERY.md`.

## Review

After selecting Node 24 in the terminal, run:

```powershell
npm.cmd test -- tests/engine.test.ts --reporter=verbose
```

There are 90 engine cases, including 80 generated complete games within the four seat-count cases. Money conservation and unique settlements are checked through those games, and their command traces replay to identical final states. The full suite additionally retains all 32 foundation tests. `npm run check`, `npm test` and `npm run build` passed for Milestone 2. Browser gameplay remains unavailable until the multiplayer milestone.
