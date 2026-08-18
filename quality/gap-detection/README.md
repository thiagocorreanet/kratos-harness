# Gap detection calibration

Gap detection is the only part of the gap pipeline that needs judgment. The
runtime does not detect gaps; a model proposes them and `kratos gaps record`
receives them. This corpus is how that judgment is measured before anyone
switches a project to the enforcing policy.

## What is here

- [`documents/`](documents) holds ten short requirement documents. Five carry
  planted gaps and five are clean.
- [`corpus.v1.json`](corpus.v1.json) states what was planted in each document
  and the thresholds a recorded pass must meet.
- [`observed.v1.json`](observed.v1.json) is one recorded detection pass: what
  the model proposed for each document, and which planted gap each proposal
  was reviewed as. A proposal reviewed as `null` is a false gap.

The planted gaps cover all four categories: a rule that admits two readings
which produce different code, a decision only the owner can make, a
contradiction between two passages, and an external dependency nobody has
confirmed.

## The recorded pass

| Measure | Value |
| --- | --- |
| Documents | 10 |
| Planted gaps | 10 |
| Planted gaps found | 10 |
| Planted gaps missed | 0 |
| False gaps on clean documents | 0 |
| Recall | 1.00 |

Run `npm run gaps:calibrate` to reproduce the report. The same numbers are
asserted by `tests/gap-detection-calibration.test.ts`, so the corpus and the
recorded pass cannot drift apart silently.

## What this number is worth

The documents, the planted gaps, and the recorded pass were all produced by
the same model (`claude-opus-5`) in one session. That makes this an upper
bound on detection quality, not a measurement of it: a detector that knows
what was planted is not being tested. Read it as a floor for the mechanism —
the four categories are exercised end to end, every recorded proposal
satisfies the published `host.gap-proposal@1.0.0` contract, and clean
documents produced nothing — and not as evidence about a model reading a
document it has never seen.

An independent corpus, authored by someone other than the detector and scored
by a reviewer, is what would turn this into a real measurement. Until that
exists, treat the enforcing policy as a deliberate per-project choice rather
than a default the numbers here justify.

## Adding to the corpus

1. Add the document under `documents/`.
2. Record what it plants in `corpus.v1.json`, or record it as clean.
3. Run detection, record the proposals in `observed.v1.json`, and review each
   proposal against the planted set.
4. Run `npm run gaps:calibrate` and keep the table above current.
