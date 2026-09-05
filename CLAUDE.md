## Strict Tool & File Restraints
- **Prohibit Markdown Generation**: Never create or modify `.md` or `.txt` files or generate long documentation block artifacts unless the user explicitly requests a specific .md file by filename or explicitly asks for markdown documentation.
- **Do Not Dump Outputs**: If a tool outputs raw log data or file diagnostics, extract only lines containing ERROR, FAIL, Exception, or stack traces, plus 2 lines of surrounding context.
- **Strict Size Gate**: If a response would exceed 300 words, split it into parts, deliver the first part, and end with: "Reply continue for the rest." Code blocks longer than 100 lines should also be split, with a note indicating truncation.
- **No Refactoring Bloat**: Provide targeted diffs or precise functions. If the change affects fewer than 20 lines, provide only a diff or the modified function(s), not the entire file.
