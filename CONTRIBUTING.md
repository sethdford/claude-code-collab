# Contributing to Claude Code Collab

Thanks for your interest in contributing! This project enables hidden team mode features in Claude Code for multi-agent collaboration.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/claude-code-collab.git`
3. Install dependencies: `npm install`
4. Create a branch: `git checkout -b feature/your-feature-name`

## Development Setup

```bash
# Install dependencies
npm install

# Start the server in dev mode (auto-reload)
npm run dev

# Run the patch script
npm run patch

# Run tests
npm test

# Run preflight checks
npm run preflight
```

## Project Structure

```
claude-code-collab/
├── server.js          # Express + WebSocket server with SQLite
├── patch-cli.js       # CLI patcher to enable hidden features
├── run-lead.sh        # Script to run Claude Code as team lead
├── run-worker.sh      # Script to run Claude Code as worker
├── scripts/
│   ├── preflight.sh   # Pre-commit checks
│   └── test-suite.sh  # Test runner
└── package.json
```

## How to Contribute

### Reporting Bugs

- Check existing issues first
- Include steps to reproduce
- Include Claude Code version and Node.js version
- Include relevant logs or error messages

### Suggesting Features

- Open an issue describing the feature
- Explain the use case and benefits
- Be open to discussion about implementation

### Submitting Pull Requests

1. **Keep PRs focused** - One feature or fix per PR
2. **Update documentation** - If you change behavior, update the README
3. **Add tests** - For new features or bug fixes
4. **Follow code style** - Match existing patterns in the codebase
5. **Write clear commit messages** - Describe what and why

### Code Style

- Use 2-space indentation
- Use single quotes for strings
- Add JSDoc comments for functions
- Keep functions small and focused

## Areas for Contribution

### High Priority
- [ ] Better error handling and recovery
- [ ] Connection retry logic improvements
- [ ] Task queue management
- [ ] Agent discovery/heartbeat system

### Nice to Have
- [ ] Web UI for monitoring agents
- [ ] Message encryption
- [ ] Rate limiting
- [ ] Metrics/observability

### Documentation
- [ ] More usage examples
- [ ] Video tutorials
- [ ] Architecture deep-dive

## Testing

```bash
# Run the test suite
npm test

# Test specific functionality
./scripts/test-suite.sh server    # Test server endpoints
./scripts/test-suite.sh patch     # Test CLI patching
./scripts/test-suite.sh collab    # Test collaboration flow
```

## Questions?

Open an issue with the `question` label and we'll do our best to help!

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
