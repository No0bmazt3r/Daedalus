# Frontend tests

Node's own test runner on the TypeScript as written (Node strips the types), so
there is no test framework to install. From `frontend/`:

```bash
pnpm test
```

| File | What it pins |
|---|---|
| `threadLogic.test.ts` | Ariadne's Thread's pure logic (`src/lib/threadLogic.ts`): grouping questions by chat, ↑/↓ navigation that skips folded chats, the Markdown export with its retrieval tables, and reading a sensor evidence line as a table |
| `passage.test.ts` | Joining a PDF passage's hard line breaks back into paragraphs for display (`src/lib/passage.ts`), keeping real breaks, list items and equations |

Only logic with no React or DOM in it is tested this way — that is why the
Thread's logic lives in `src/lib/threadLogic.ts` rather than in its components.
A file here imports from `../src/` with the `.ts` extension, which Node needs.
