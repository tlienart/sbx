# Analysis: Issue 1 - Bot Output Noise

## Symptoms
`make test_bot` output contains large blocks of repetitive text:
```text
Detail Detail Detail Detail ... (repeated 300 times)
```

## Root Cause
In `src/lib/bot/dispatcher.ts`, the `relayToAgent` method simulated agent output using:
```typescript
const mockResponse = `## Summary\\nI've processed your request: \"${msg.content}\".\\nThis is a mock response from the agent.\\n\\n${'Detail '.repeat(300)}`;
```

## Solution
Modified the mock response to use `.repeat(5)` instead of `.repeat(300)`.

## Verification Logic
1. Run `make test_bot` and verify the output is human-readable.
