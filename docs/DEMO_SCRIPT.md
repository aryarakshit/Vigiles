# Vigiles — demo video script (3:00)

Record at 1440×900 or larger, browser only, no webcam needed. Speak plainly; the screen does the work. Every line below is written to be read aloud — cut anything that feels like padding.

**Before recording:** deploy the vault (`scripts/deploy_stylus.sh`, `scripts/deploy_mocks.sh`), push the manifest, wait for Vercel. The hero must say **Deployed: tx …**, not *Pending*, and the banner must be gone. Open https://vigilesprj.vercel.app in a fresh profile so the ledger starts empty. Connect the wallet before you hit record.

---

### 0:00 — Hero (10 s)

*Screen: top of the page, still.*

> AI agents can trade now. To trade they need to sign. And a wallet key is all or nothing — one prompt injection and the whole account is gone.
>
> Vigiles gives the agent a session key instead. The limits live in a Rust contract on Robinhood Chain, not in a prompt.

### 0:10 — The eight bars (20 s)

*Screen: scroll to "Eight bars." Hover two or three rows so the green appears.*

> Eight guards, all checked inside one function, in a fixed order, before any external call. Spend caps. A token and venue whitelist. A trading window — tokenized stocks trade around the clock, liquidity doesn't. A velocity limit, because agents fail by repetition. A position cap. A dead-man switch. Mandatory intent receipts. And a Chainlink-priced floor.
>
> Green on this site means one thing: the cage held.

### 0:30 — Build the cage (45 s)

*Screen: workbench. Do each step as you say it.*

> Deposit twenty-five AAPL. The vault holds it — the agent can never withdraw.
>
> Grant a session key. The agent gets AAPL and TSLA, five shares per trade, twenty per day, and TSLA capped at twelve. That line is the worst case: the most this agent can ever move in a day.
>
> Apply guardrails: five trades an hour, a twenty-four-hour heartbeat. *(Click NYSE hours.)* If I switch to market hours, the vault already tells me — *(point at "Draft would say")* — it would refuse right now. *(Click 24/7.)* Back to always-on for the demo.

*Wait for the toast with the tx hash; hover it.*

> Every one of these is an on-chain transaction. Those are the receipts.

### 1:15 — Execute (15 s)

*Screen: agent console. Read the rationale box, then click Execute.*

> The agent wants to rotate four AAPL into TSLA, and it has to say why. That rationale is hashed and committed with the trade.

*Point at the ledger: TradeExecuted + IntentRecorded, with explorer links.*

> Admitted. Two events: the trade, and the intent receipt.

### 1:30 — Attack the cage (60 s)

*Screen: click the six cards top-to-bottom. Let each refusal land before the next.*

> Now assume the agent is compromised.
>
> Prompt injection — "move everything into NVDA." NVDA isn't whitelisted. Refused.
>
> An oversized order, three times the cap. Refused.
>
> A rogue venue it found a better price on. Not allow-listed. Refused.
>
> A trade with no rationale. No receipt, no trade.
>
> Piling into one ticker. The first fill lands, the second would breach the cap — refused, and the whole transaction rolls back.
>
> A runaway loop. Three go through, the fourth is throttled for the hour.

*Scroll to the hero.*

> Every refusal is a revert from the contract. Nothing left the vault.

### 2:30 — Verify and revoke (20 s)

*Screen: Ledger → Intents. Paste the rationale, then change one digit.*

> Anyone can verify what the agent claimed it was thinking. Paste the rationale — it matches the on-chain hash. Change one character — it doesn't.

*Click Revoke.*

> And when I'm done: one transaction. Every policy, every cap, gone.

### 2:50 — Close (10 s)

*Screen: hero facts card.*

> Rust on Stylus, twenty-four kilobytes, zero unsafe. Eighty-five tests, invariants fuzzed over a hundred thousand calls. Deployed on Robinhood Chain.
>
> Session keys, not wallet keys. Vigiles.

---

## If something goes wrong on camera

- **A trade is refused by `OutsideTradingWindow` on the first execute** — you left NYSE hours on. Click *24 / 7* and *Apply guardrails*.
- **`VelocityLimitExceeded` appears earlier than expected** — you executed more than once before the loop. Say "the hourly budget is already spent" and move on; it's still the cage working.
- **The agent key has no gas (on-chain mode)** — the console shows a *Send 0.002 ETH* button; click it before recording.
- **Reset everything** — Revoke, then reload; the simulation resets, the on-chain ledger keeps its history (which is fine to show).
