# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for the Graph Indexer project.

## What is an ADR?

An Architecture Decision Record (ADR) is a document that captures an important architectural decision made along with its context and consequences.

## ADR Format

Each ADR follows this structure:

1. **Title** - A short noun phrase describing the decision
2. **Status** - Proposed, Accepted, Deprecated, or Superseded
3. **Context** - The issue motivating this decision and any context that influences it
4. **Decision** - The change that we're proposing or have agreed to implement
5. **Consequences** - What becomes easier or more difficult as a result of this change

## ADR Index

- [001 - Batch RAV Redemption](./001-batch-rav-redemption.md) - Implement batching for RAV redemptions to reduce gas costs

## Creating a New ADR

1. Copy the template from an existing ADR
2. Name it with the next number in sequence: `NNN-title-with-dashes.md`
3. Fill in the sections
4. Submit a PR for review
5. Update the index in this README

## Why Use ADRs?

- Document the reasoning behind decisions
- Provide context for future developers
- Create a decision log for the project
- Enable better architectural discussions