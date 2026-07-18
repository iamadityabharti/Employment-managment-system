# Architecture Decision Record: Atlas EMS

The canonical architecture, event schema, and database ownership model live in the [root README](../README.md#architecture-first). This short ADR exists to make the design-first sequencing explicit.

## Decision

Build Atlas EMS as independently deployable NestJS services backed by RabbitMQ topic exchanges, transactional outboxes, consumer inboxes, isolated data stores, and a stateless API Gateway.

## Context

Leave approval is the key workflow: Attendance owns its state machine, Payroll owns the eventual leave-balance projection and payments, and Notification owns delivery. A distributed transaction would over-couple these concerns and make partial failure recovery opaque.

## Consequences

- Reads that span services are eventually consistent and must display their projection state.
- Consumers are at-least-once, so each side effect needs a durable idempotency boundary.
- The system gains independent deployability and failure isolation at the cost of operational components and observability requirements.
