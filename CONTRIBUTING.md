# Contributing to @open-tomato/service

Thank you for your interest in contributing to the service stack. This guide covers the essential workflows for proposing changes and submitting pull requests.

## Before You Start

- Read [AGENTS.md](AGENTS.md) for detailed information on style, code layout, and the gates your PR must pass.
- Review [SECURITY.md](SECURITY.md) if your change involves security or input validation.

## Proposing a Change

Use the **Spec issue template** to propose a change:

1. Go to the repository's [Issues](https://github.com/open-tomato/service/issues) tab
2. Click **New issue**
3. Select **Spec** from the available templates
4. Fill in the sections: what you get, starting position, design, failure modes, tasks, and definition of done

The spec template ensures your proposal has the structure a plan can be built from. This is the fastest path to approval and implementation.

## Before Opening a Pull Request

1. **Install dependencies:**
   ```bash
   bun install
   ```

2. **Run the quality gates:**
   ```bash
   bun run gates
   ```

   This runs the full suite in sequence: lint, check-types, test, test-scripts, build, pack, check-node. Your PR must pass all gates. See [context/verification.md](context/verification.md) for what each gate checks.

3. **Turn on the privacy hook** once per clone, so a commit never carries a local path or a credential:
   ```bash
   git config core.hooksPath .githooks
   ```

4. **Verify your change:**
   - Tests cover your implementation (minimum 80% coverage)
   - Code follows the style enforced by ESLint (single quotes, 2-space indent, trailing commas, etc.)
   - TypeScript types pass in strict mode
   - The core (`packages/service`) still imports no framework

## Dependencies

The core, `@open-tomato/service`, depends on no framework. Framework libraries belong to the adapter that uses them, so a user of one adapter never installs another's. See [context/architecture.md](context/architecture.md).

## Security Issues

Do not open a public issue for security vulnerabilities. Instead, use GitHub's private vulnerability reporting at https://github.com/open-tomato/service/security/advisories/new. See [SECURITY.md](SECURITY.md) for full details.

## Questions?

Refer to [AGENTS.md](AGENTS.md) for:
- The packages and the rule that keeps the core framework-free
- The gates, and the context pages that explain each subject
- Where documentation lives (the shadow docs tree)
- What this public repository must never carry
