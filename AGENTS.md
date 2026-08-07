## Strict Tool & File Restraints
- **Prohibit Markdown Generation**: Never create or modify `.md` files or generate long documentation block artifacts unless the user explicitly requests a specific .md file by filename or explicitly asks for markdown documentation.
- **Do Not Dump Outputs**: If a tool outputs raw log data or file diagnostics, do not copy-paste the whole content. Extract only relevant failures.
- **Strict Size Gate**: If a single response exceeds 3 prose paragraphs or 300 words (excluding code blocks), halt, provide a one-sentence summary of what remains, and ask the user for permission to continue. If the user grants permission, resume from the exact point where you halted without repeating already-delivered content.
- **No Refactoring Bloat**: Provide targeted diffs or precise functions. Do not rewrite whole structural code files to change small details.
