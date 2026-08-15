# Host and model evaluations

Deterministic host compatibility and probabilistic model behavior are reported
separately. A deterministic failure blocks release. A model evaluation reports
sample count, distribution, retries, host/model observation, prompt and skill
versions, duration, and privacy-safe artifact digests; it blocks only when a
published release policy promotes its threshold.

Every run is classified as one of: runtime, adapter, host contract, model
behavior, environment, or test infrastructure. A retry is a new recorded
attempt, never a replacement for the first result.

Protected real-host projects cover initialization, objective, start/continue,
gate explanation, approval, evidence, completion, migration, and recovery.
Contributor and fork CI use deterministic fixtures and never receives host
credentials. Real-host retention excludes prompts, source, secrets, and raw
conversation content.

`npm run eval:calibrate` verifies that the versioned rubric separates the known
good and known bad calibration samples before it can score live observations.
