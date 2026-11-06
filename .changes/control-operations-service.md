---
plan: control-operations-service
title: Control operations as plain functions, token check on WebCrypto
level: major
package: @open-tomato/service
---

- core: adds the control operations as functions over a runtime, each answering a status and a body for any transport to send: `controlStatus`, `listDependencies`, `pauseDependency`, `resumeDependency`, `restartDependency` and `resetClient`. The status reports the `aggregateHealth` status, and the version comes from the caller
- core: `verifyControlToken(given, expected)` compares SHA-256 digests made through `crypto.subtle` in constant time, and rejects a token that is not a string and every token when the secret is empty
