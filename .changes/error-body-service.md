---
plan: error-body-service
title: One core for every adapter
level: major
package: @open-tomato/service
---

- core: the error classes move into the core, and `toErrorResponse` turns anything thrown into a status and one body, `{ code, message, details? }`: an `AppError` answers with its own status and body, a `ZodError` with its issues, a 4xx error with its own code, message and details, and an open circuit with 503, while a 5xx never sends the error's own message, code or details. It never throws
- core: `parseApiError` reads a failed `Response` into that body and its status, a 1.x `{ error }` body and a body that is not JSON included, and the control operations fail with the same body
