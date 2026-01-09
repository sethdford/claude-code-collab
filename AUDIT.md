# Project Audit Report

## Summary

After thorough analysis, here are the issues, gaps, and areas needing attention.

---

## 1. ~~CRITICAL: Injected Code Has Dependency Issue~~ FIXED

**Problem**: The injected collaboration code in `patch-cli.js` uses:
```javascript
const WebSocket = require('ws');
```

But the patched Claude Code CLI may not have `ws` installed in its node_modules.

**Impact**: WebSocket connections will fail at runtime.

**Fix**: patch-cli.js now automatically installs ws into Claude Code's directory after patching.

---

## 2. CRITICAL: No E2E Integration Test

**Problem**: We've never actually tested running two Claude Code instances together and verified they can communicate.

**Impact**: The whole system might not work in practice.

**Fix needed**: Create an e2e test that:
1. Starts the server
2. Runs patched Claude Code as lead
3. Runs patched Claude Code as worker  
4. Verifies task delegation works

---

## 3. HIGH: Missing WebSocket Tests

**Current test coverage**: 24 tests covering HTTP endpoints only.

**Missing**:
- WebSocket connection test
- Subscribe/unsubscribe test
- Real-time message delivery test
- WebSocket reconnection test
- Heartbeat/ping-pong test

---

## 4. HIGH: No Authentication/Authorization

**Problem**: Any client can:
- Impersonate any agent by using their UID
- Send messages as anyone
- Create/update tasks as anyone

**Impact**: In a multi-user environment, this is a security issue.

**Fix needed**: Add token-based auth where:
- `/auth` returns a JWT token
- All other endpoints require the token
- Token is validated against the claimed UID

---

## 5. ~~MEDIUM: Validation Gap in /chats/:chatId/read~~ FIXED

**Problem**: The endpoint doesn't validate that `uid` is provided in the body.

**Fix**: Added validation for `uid` field and chat existence check.

---

## 6. ~~MEDIUM: No Rate Limiting~~ FIXED

**Problem**: No protection against:
- Brute force attacks
- Message flooding
- Resource exhaustion

**Fix**: Added simple rate limiting middleware (100 requests/minute per IP).

---

## 7. MEDIUM: Task Dependencies Not Enforced

**Problem**: `blockedBy` is stored but never checked when updating task status.

**Current behavior**: You can mark a task "resolved" even if it's blocked by unresolved tasks.

**Fix needed**: Check blockedBy tasks are resolved before allowing status change to "resolved".

---

## 8. MEDIUM: CI Will Fail

**Problem**: CI references `npm run lint` but package.json has no lint script.

```yaml
- name: Run linter
  run: npm run lint --if-present  # This is OK with --if-present
```

Actually this is OK because `--if-present` handles missing scripts. But we should add actual linting.

**Fix needed**: Add ESLint configuration and lint script.

---

## 9. LOW: Platform Compatibility

**Problem**: Shell scripts use bash-specific features and Unix paths.

**Impact**: Won't work on Windows without WSL.

**Fix needed**: 
- Add Windows batch files, or
- Document Windows instructions, or
- Use Node.js scripts instead of bash

---

## 10. LOW: No Pagination Token Support

**Problem**: Messages endpoint uses limit/offset but no cursor-based pagination.

**Impact**: For large chat histories, pagination could miss messages if new ones arrive.

**Fix needed**: Add cursor-based pagination using message IDs.

---

## 11. LOW: No Message/Task Deletion

**Problem**: No endpoints to delete messages or tasks.

**Impact**: Data accumulates forever.

**Fix needed**: Add DELETE endpoints with soft-delete (archived flag).

---

## 12. LOW: No HTTPS Support

**Problem**: Server only supports HTTP.

**Impact**: In production, credentials would be transmitted in plain text.

**Fix needed**: Add HTTPS option with certificate configuration.

---

## 13. DOCUMENTATION: Missing

- API documentation (OpenAPI/Swagger)
- Architecture diagram (more detailed)
- Sequence diagrams for flows
- Troubleshooting guide expansion

---

## Test Coverage Summary

| Area | Covered | Missing |
|------|---------|---------|
| Health endpoint | ✅ | |
| Authentication | ✅ | Token validation |
| User management | ✅ | |
| Chat operations | ✅ | |
| Message handling | ✅ | |
| Mark as read validation | ✅ | |
| Task management | ✅ | Dependency enforcement |
| Broadcast | ✅ | |
| WebSocket | ✅ (requires websocat) | Real-time delivery |
| Rate limiting | ✅ | |
| E2E Integration | ❌ | Full flow test |
| Patch script | ❌ | Patching verification |

---

## Priority Order for Fixes

1. ~~**P0**: Fix WebSocket dependency in injected code~~ ✅ DONE
2. **P0**: Add E2E integration test
3. ~~**P1**: Add WebSocket tests~~ ✅ DONE
4. ~~**P1**: Add validation for /chats/:chatId/read~~ ✅ DONE
5. **P2**: Add authentication tokens
6. **P2**: Enforce task dependencies
7. ~~**P3**: Add rate limiting~~ ✅ DONE
8. **P3**: Add ESLint
9. **P4**: Platform compatibility
10. **P4**: Additional documentation
