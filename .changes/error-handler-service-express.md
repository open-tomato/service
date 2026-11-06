---
plan: error-handler-service-express
title: Express on the shared core
level: major
package: @open-tomato/service-express
---

- express: a route that throws is answered with the core's `{ code, message, details? }` body, built by `toErrorResponse`, in place of `{ error }`; the control routes keep `{ error }` for now
- express: `createErrorHandler(logger, format?)` writes one line per error through the service logger, a warning with the code for a 4xx and an error with the hidden name, code, reason and stack for a 5xx, and a logger that throws never costs the caller the response
- express: `config.formatError` replaces the default rule and falls back to it when it throws, and the error classes and `toErrorResponse` are re-exported
