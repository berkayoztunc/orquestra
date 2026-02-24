# Contributing to orquestra

Thank you for your interest in contributing! We welcome contributions of all kinds.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/yourusername/orquestra.git
   cd orquestra
   ```

3. **Create a feature branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

4. **Set up development environment:**
   ```bash
   npm run install:all
   cp .env.example .env.local
   # Edit .env.local with your local config
   npm run dev
   ```

## Development Guidelines

### Code Style

- Use TypeScript for all new code
- Follow [Prettier](https://prettier.io/) formatting
  ```bash
  npm run format
  ```
- Run ESLint and fix issues:
  ```bash
  npm run lint:fix
  ```

### Type Safety

- Write types for all functions and variables
- Enable strict mode in TypeScript
- Add type definitions to `@orquestra/shared` for cross-package code
- Run type checking before committing:
  ```bash
  npm run type-check
  ```

### Testing

- Write tests for new features and bug fixes
- Run test suite locally:
  ```bash
  npm test
  ```
- Ensure all tests pass before pushing

### Commits

Follow conventional commits:

```
feat: Add new feature
fix: Fix a bug
docs: Update documentation
style: Format code
refactor: Restructure code
perf: Improve performance
test: Add/update tests
chore: Update dependencies
```

Example:
```bash
git commit -m "feat: Add transaction builder validation"
```

### Pull Requests

1. **Create a descriptive PR title**
   - Use conventional commit format
   - Be specific about changes

2. **Write a clear description**
   - What problem does this solve?
   - How does it solve it?
   - Any breaking changes?

3. **Link related issues**
   ```markdown
   Closes #123
   Relates to #456
   ```

4. **Request review** from maintainers

## Project Structure

```
packages/
├── frontend/     # React UI (Cloudflare Pages)
├── worker/       # Hono API (Cloudflare Workers)
└── shared/       # Shared types & utilities

migrations/      # D1 database schemas
scripts/         # Build and utility scripts
.github/         # GitHub Actions CI/CD
```

## Common Development Tasks

### Working on Frontend

```bash
npm run dev:frontend  # Start dev server at localhost:5173
npm run build:frontend
npm run lint --prefix packages/frontend
```

Files:
- Components: `packages/frontend/src/components/`
- Pages: `packages/frontend/src/pages/`
- Styling: Tailwind CSS (see `tailwind.config.js`)

### Working on Backend

```bash
npm run dev:worker    # Start dev server at localhost:8787
npm run build:worker
npm run lint --prefix packages/worker
```

Files:
- Routes: `packages/worker/src/routes/`
- Middleware: `packages/worker/src/middleware/`
- Services: `packages/worker/src/services/`

### Working on Shared Types

```bash
npm run build --prefix packages/shared
npm run type-check   # Verify across workspace
```

Files:
- Types: `packages/shared/src/types.ts`
- Utils: `packages/shared/src/utils.ts`

### Database Development

```bash
npm run db:migrate:dev   # Apply migrations
npm run db:seed          # Seed sample data
npm run db:reset         # Reset database (dev only)
```

## Feature Development Workflow

### 1. Design

- Write design document if complex
- Discuss with maintainers before major changes
- Update architecture docs if needed

### 2. Implementation

- Create feature branch
- Write code with tests
- Update types in shared package
- Document new APIs

### 3. Testing

- Run local tests: `npm test`
- Test in dev environment
- Verify no regressions

### 4. Documentation

- Update README if user-facing
- Add/update API documentation
- Update DEPLOYMENT.md if needed
- Add comments for complex logic

### 5. Review

- Push to your fork
- Create pull request
- Address reviewer feedback
- Squash commits if requested

### 6. Merge

- Maintainer merges to develop
- Tested in staging
- Merged to main for production

## Code Review Process

### What We Look For

✅ **Good**
- Clear, descriptive commit messages
- Well-documented code with comments
- Comprehensive test coverage
- No breaking changes (unless necessary)
- Follows project conventions
- Updated documentation

❌ **Avoid**
- Large monolithic commits
- Undocumented code
- No tests
- Breaking changes without discussion
- Inconsistent style
- Outdated documentation

## Testing Guidelines

### Unit Tests

Test individual functions and utilities:

```typescript
describe('isValidSolanaAddress', () => {
  it('returns true for valid addresses', () => {
    expect(isValidSolanaAddress('11111111111111111111111111111111')).toBe(true)
  })

  it('returns false for invalid addresses', () => {
    expect(isValidSolanaAddress('invalid')).toBe(false)
  })
})
```

### Integration Tests

Test component interactions:

```typescript
describe('Dashboard', () => {
  it('loads user projects', async () => {
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText('My Projects')).toBeInTheDocument()
    })
  })
})
```

## Documentation

### Code Comments

- Explain *why*, not *what*
- Document public APIs
- Add JSDoc for complex functions

```typescript
/**
 * Validates a Solana address format
 * @param address - Base58 encoded address
 * @returns true if valid, false otherwise
 */
export function isValidSolanaAddress(address: string): boolean {
  // ...
}
```

### README Updates

Keep updated with:
- New features
- Breaking changes
- New endpoints
- New commands

### Architecture

Update [ARCHITECTURE.md](./ARCHITECTURE.md) for:
- System design changes
- New components
- Data flow changes
- Performance improvements

## Reporting Issues

### Bug Reports

Include:
- Description of bug
- Steps to reproduce
- Expected behavior
- Actual behavior
- Environment (OS, Node version, etc.)
- Screenshots/logs if applicable

### Feature Requests

Include:
- Use case / problem it solves
- Proposed solution
- Alternatives considered
- Any breaking changes

## Release Process

1. Create release branch from main
2. Update version in package.json
3. Update CHANGELOG
4. Create PR for review
5. Merge to main
6. Tag release: `git tag v1.0.0`
7. GitHub Actions creates release

## Getting Help

- **Discord:** [Community Server](https://discord.gg/orquestra)
- **GitHub Discussions:** Q&A and discussions
- **Issues:** Bug reports and feature requests
- **Documentation:** [SETUP_GUIDE.md](./SETUP_GUIDE.md)

## Code of Conduct

- Be respectful
- Be inclusive
- Be professional
- Report violations to maintainers

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to orquestra! 🎉
