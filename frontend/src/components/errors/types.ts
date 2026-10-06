/** Everything about one error code. One file per code in `codes/`, named `<code>.ts`. */
export interface ErrorInfo {
  /** The official name, e.g. "Not Found". */
  name: string
  /** The themed headline. */
  title: string
  /** One Daedalus-myth line. */
  myth: string
  /** One block-built line. */
  block: string
  /** Plain words: what went wrong. */
  what: string
  /** Plain words: what to try. */
  fix: string
  /**
   * The picture: rows of colour letters, '.' for empty. Square, 12 or 13 wide.
   * Letters: a primary · t text · m muted · r bad · w warn · g ok · d muted
   * (moves on its own) · b info. See `COLOURS` in PixelArt.tsx.
   */
  art: string[]
  /**
   * This code's animation: CSS rules on `.pix-<code>` (the whole picture) and
   * `.pix-<code> .px-<letter>` (one colour's pixels, with `--x` / `--y` set).
   * Shared keyframes live in animations.css.
   */
  css: string
}
