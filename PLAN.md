# Improvements to Bot Interaction Flow

This plan addresses two user-requested improvements to the Zulip bot:
1.  Ensuring the `plan` agent explicitly suggests switching to `build` mode.
2.  Making `/switch <mode>` automatically trigger the agent with an implicit "ok".

## 1. Plan Agent Prompt Update
- [x] **Modify `opencode.json`**: Update the `plan` agent's prompt to be more explicit about suggesting the `/switch build` command.
- [x] **Modify `opencode.json`**: Update the `build` agent's prompt to similarly suggest switching back to `plan` if architecture changes are needed.

## 2. Auto-Trigger on Switch
- [x] **Modify `src/lib/bot/dispatcher.ts`**:
    - Update `cmdSwitch` to call `relayToAgent` immediately after a successful mode switch.
    - Use a synthetic "ok" message content to trigger the agent's next action.
    - Ensure the reaction logic doesn't fail if the message is synthetic (though it will use the original `/switch` message ID, which is actually correct).

## 3. Verification
- [x] **Test Prompt**: Start the bot, ask it to plan something, and verify it ends with "Plan updated. Use `/switch build` to start implementation."
- [x] **Test Auto-Trigger**: Run `/switch build` and verify the bot immediately replies with "⚙️ Thinking [build]..." and starts working without needing an extra "ok".
