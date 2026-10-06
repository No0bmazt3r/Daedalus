import type { ErrorInfo } from '../types'

export default {
  name: 'HTTP Version Not Supported', title: 'An older tongue',
  myth: 'The messenger spoke a dialect the palace stopped using long ago.',
  block: 'This world was saved in a different version.',
  what: 'The server does not support the HTTP version the request used.',
  fix: 'A proxy or client setup issue. Update it, or retry through the browser.',
  art: [
    '............', '.aaaa..rrrr.', '.a..a..r..r.', '.a..a..r..r.',
    '.aaaa..rrrr.', '............', '...tttttt...', '..t......t..',
    '.....tt.....', '............', '............', '............',
  ],
  css: `
/* 505 — the two versions take turns */
.pix-505 .px-a { animation: pix-pulse 1.6s ease-in-out infinite; }
.pix-505 .px-r { animation: pix-pulse 1.6s ease-in-out infinite; animation-delay: -0.8s; }
`,
} satisfies ErrorInfo
