# Prompt Evaluation Against Baseline

This directory contains prompt evaluation fixtures, recorded baselines, and test cases.

## Normative Authorization Notice

This suite measures prompt behavior and discrimination on chosen test cases. A passing run demonstrates that the prompt outperforms the empty baseline on declared assertions; it does not constitute mathematical or universal proof of prompt correctness on arbitrary inputs.

## Structure

- `cases/`: Versioned evaluation cases (`*.v1.json`).
- `baselines/`: Recorded historical baselines for comparison against previous prompt revisions.

## Commands

- `npm run eval:prompts` (Requires live API credentials or `--replay`).
