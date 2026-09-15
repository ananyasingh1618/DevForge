# DevForge Retrieval Target Closure — Diagnostic Report (Milestone A1)

Full per-candidate signal breakdown for all 3 cases failing in the Phase 14 baseline (106/109),
captured directly via `computeScoreSignals`/`combinedScore` against the real 67-case dataset
before any Part A code change — not assumed, not summarized from memory.

## Case 1: `retrieval-vague-wording-validation`

- **Query**: "something that checks if input looks right before using it"
- **Direct sources**: `py-validate-email`, `py-is-strong-password`, `svc-validate-order-items`
- **Supporting sources**: none
- **Category**: `vague-wording` (deliberately, maximally ambiguous by design — no exact
  identifier, no distinctive vocabulary overlap with any single target)

| Rank | Chunk | Grade | Semantic | Lexical | Identifier | Exact | Path | Combined | Kept? |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `github-get-default-branch` | 0 | 0.386 | 0.167 | 0 | 0 | 0 | 0.444 | yes |
| 2 | `py-get-order-by-id` | 0 | 0.325 | 0.333 | 0 | 0 | 0 | 0.441 | yes |
| 3 | `utils-normalize-order-payload` | 0 | 0.372 | 0.167 | 0 | 0 | 0 | 0.431 | yes |
| 4 | `py-get-order-by-customer-email` | 0 | 0.352 | 0.167 | 0 | 0 | 0 | 0.410 | yes |
| 5 | `py-generate-jwt` | 0 | 0.318 | 0.167 | 0 | 0 | 0 | 0.376 | yes |

None of the 3 direct targets appear even in the top 10 (verified, not just top 5). This is not a
ranking-order problem — the targets are not being surfaced by any signal at all: `lexicalScore`
and `identifierScore` are exactly 0 for all three targets against this query (no exact-token
overlap — "checks"/"looks right"/"using" share no token with `validate_email`/
`is_strong_password`/`validateOrderItems`), leaving only the weak mock `semanticScore` to carry
the entire signal, and it doesn't correlate strongly enough with any of the three.
- **Diagnosis**: retrieval miss, not a ranking/cutoff/labeling problem. Root cause: the
  deterministic mock embedding's char-n-gram+word-token proxy has no real semantic understanding
  — a genuinely vague, non-identifier-bearing, non-topic-word query has nothing left to match on.
  See §"Case 1 resolution" below.

## Case 2: `retrieval-neighboring-symbol-deliver-internal`

- **Query**: "What internal helper actually opens the network connection to send an email?"
- **Direct source**: `py-deliver-internal` (grade 2)
- **Supporting source**: `py-send-email-async` (grade 1)

| Rank | Chunk | Grade | Semantic | Lexical | Identifier | Exact | Path | Combined | Kept? |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `py-send-email-async` | 1 | 0.472 | 0.250 | 0.667 | 0 | 0.200 | 0.746 | yes |
| 2 | `py-get-order-by-customer-email` | 0 | 0.452 | 0.250 | 0.250 | 0 | 0 | 0.602 | yes |
| 3 | `py-validate-email` | 0 | 0.350 | 0.125 | 0.500 | 0 | 0 | 0.519 | no |
| 7 | `py-deliver-internal` | **2** | 0.395 | 0.125 | 0 | 0 | 0.200 | 0.459 | **no** |

- **Diagnosis**: a real, fixable fixture-content gap, not a ranking-algorithm defect.
  `py-deliver-internal` (`_deliver`) was the one function in `python/services/email_service.py`
  written **without** a doc-comment — every sibling function in this dataset has one (a real,
  unintentional inconsistency, confirmed by inspecting the fixture file directly). Its only
  indexable text is 5 lines of code, giving it almost no lexical surface to match against
  ("internal helper", "network connection") despite the function's *actual behavior* being
  exactly that (`asyncio.open_connection`). `identifierScore = 0` because `_deliver`'s only token,
  "deliver", doesn't overlap with any query word. See §"Case 2 resolution" below.

## Case 3: `retrieval-imported-function-cart-remove`

- **Query**: "Which underlying cartService function does the cart module's public
  removeFromCart delegate to?"
- **Direct source**: `js-cart-remove-item` (grade 2)
- **Supporting source**: `js-cart-remove-from-cart` (grade 1)

| Rank | Chunk | Grade | Semantic | Lexical | Identifier | Exact | Path | Combined | Kept? |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `js-cart-remove-from-cart` | 1 | 0.533 | 0.500 | 1.000 | **1** | 0.250 | **1.383** | yes |
| 2 | `js-cart-remove-item` | **2** | 0.431 | 0.500 | 0.500 | 0 | 0.600 | 0.791 | **no** |
| 3 | `js-cart-add-to-cart` | 0 | 0.409 | 0.400 | 0.500 | 0 | 0.250 | 0.699 | no |

Cutoff threshold at 0.78: `1.383 * 0.78 = 1.079`. `js-cart-remove-item`'s 0.791 falls well short.

- **Diagnosis**: a real, general, structural weakness in the relative-to-top cutoff, not a
  labeling or chunking problem. The query names `removeFromCart` verbatim, so
  `js-cart-remove-from-cart` gets the binary `exactIdentifierScore = 1` jackpot (weight 0.4) —
  this single binary signal alone contributes 0.4 of its 1.383 combined score, making the *top*
  score an outlier unrepresentative of the general relevance ceiling. Because the cutoff threshold
  is `topScore * 0.78`, one candidate's exact-match jackpot inflates the bar *every other*
  candidate must clear, even a clearly-relevant #2 result (`js-cart-remove-item`, the actual
  target, ranked immediately below with a substantial, non-trivial score of its own). See
  §"Case 3 resolution" below.

## Summary classification

| Case | Root cause class |
|---|---|
| 1 | Retrieval miss (mock-embedding limitation on a maximally vague, non-identifier query) |
| 2 | Fixture-content gap (one function missing a doc-comment, inconsistent with every sibling) |
| 3 | Ranking/cutoff-selection defect (exact-identifier jackpot inflates the cutoff basis) |

Two of three (cases 2 and 3) are real, fixable, general defects — addressed in Milestones A2–A4
(see `docs/RETRIEVAL_TARGET_CLOSURE_PROGRESS.md` for the implemented fixes and their measured
effect). Case 1 is examined in depth in Milestone A2/A5 for whether it is an implementation
defect, a mislabeled case, or a genuine, demonstrable proxy limitation — see the progress log for
the conclusion reached and the evidence behind it.
