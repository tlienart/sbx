# Subtask 4: Message Processing & Long Content

## Goal
Format messages for Zulip/Discord limits.

## Requirements
- **Markdown Filtering**: Extract "final summary".
- **Message Splitting**: Break at ~2000 chars without destroying Markdown.
- **Auto-Summarization**: Triggered if output > 10,000 chars.
