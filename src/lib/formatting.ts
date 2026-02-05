export interface SplitOptions {
  limit: number;
  maxChunks: number;
}

/**
 * Extracts the final summary from agent output.
 * Looks for common patterns like "## Summary" or the last block of markdown.
 */
export function extractSummary(output: string): string {
  // Try to find "## Summary" or similar headings
  const summaryMatch = output.match(/##? (Summary|Conclusion|Result)[\s\S]+/i);
  if (summaryMatch) {
    return summaryMatch[0].trim();
  }

  // Fallback: If output is already reasonably short, return it all
  // Otherwise, take the last 2000 characters
  if (output.length <= 2000) {
    return output.trim();
  }

  return `... (truncated) ...\n\n${output.slice(-2000).trim()}`;
}

/**
 * Splits a long message into multiple chunks while trying to preserve Markdown blocks.
 */
export function splitMessage(
  content: string,
  options: SplitOptions = { limit: 2000, maxChunks: 5 },
): string[] {
  if (content.length <= options.limit) {
    return [content];
  }

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0 && chunks.length < options.maxChunks) {
    if (remaining.length <= options.limit) {
      chunks.push(remaining);
      break;
    }

    // Try to find a good place to split: newline, then space
    let splitIndex = remaining.lastIndexOf('\n', options.limit);
    if (splitIndex === -1 || splitIndex < options.limit * 0.5) {
      splitIndex = remaining.lastIndexOf(' ', options.limit);
    }

    if (splitIndex === -1 || splitIndex < options.limit * 0.5) {
      splitIndex = options.limit;
    }

    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining.length > 0 && chunks.length >= options.maxChunks) {
    // We hit the chunk limit, the rest needs to be summarized by the agent (handled at a higher level)
    chunks[chunks.length - 1] +=
      '\n\n... [Output too long, please use /restart or ask for a summary]';
  }

  return chunks;
}
