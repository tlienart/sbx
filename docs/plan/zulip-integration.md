# Zulip Integration Plan

This plan outlines the steps to integrate Zulip as a messaging platform for the `sbx` bot and document its setup.

## 1. Zulip Setup Instructions (README Addition)

The following content will be added to a new "Zulip" section in `README.md`:

### Zulip Bot Setup
1. **Create Organization**: If you don't have one, create a free organization at [zulipchat.com](https://zulipchat.com/new/).
2. **Create a Bot**:
   - Go to **Settings** (gear icon) -> **Personal settings** -> **Bots** -> **Add a new bot**.
   - **Bot type**: Generic bot.
   - **Full name**: `Sbx Bot` (or your choice).
   - **Bot email**: Take note of the generated email (e.g., `sbx-bot@yourorg.zulipchat.com`).
   - Click **Create bot**.
3. **Download Credentials**:
   - Once created, click the **Download zuliprc** (download icon) in the bot list.
   - Open the file to find your `api_key`.
4. **Environment Configuration**:
   Add these to your host's `.env` file:
   ```bash
   SBX_ZULIP_SITE="https://yourorg.zulipchat.com"
   SBX_ZULIP_USERNAME="sbx-bot@yourorg.zulipchat.com"
   SBX_ZULIP_API_KEY="your_api_key_here"
   SBX_ZULIP_DEFAULT_STREAM="general"
   ```

## 2. Implementation Steps

### A. Implement `sbx bot` command
- Create `src/commands/bot.ts`.
- It will read the environment variables and start the `BotDispatcher` with `ZulipMessaging`.
- It will also start the `SbxBridge` on the host to handle intercepted commands from the bot.

### B. Improve `BotDispatcher`
- Update `src/lib/bot/dispatcher.ts` to replace the mock implementation in `relayToAgent` with an actual call to `opencode` inside the sandbox.
- Use `runAsUser` to execute commands in the sandbox.
- Capture stdout/stderr and send it back to the Zulip topic.

### C. Register the command
- Update `src/index.ts` to include the `bot` command.

## 3. Testing the Bridge via Zulip
1. Start the bot: `sbx bot`.
2. In Zulip, message the bot: `/new my-sandbox`.
3. The bot will create a new topic named `#sbx-my-sandbox`.
4. In that topic, send a command: `ls -la` or `opencode "write a hello world in python"`.
5. Verify that the command is executed in the isolated sandbox and results are returned to Zulip.
6. Verify that "bridge" operations (like `git status` or LLM calls via `opencode`) work correctly.

## 4. Safety Considerations
- Ensure the `SbxBridge` is only accessible to the host and the sandbox user (ACLs are already handled in `bridge.ts`).
- Validate that the Zulip bot only responds to authorized users if necessary (currently it responds to anyone in the stream).
