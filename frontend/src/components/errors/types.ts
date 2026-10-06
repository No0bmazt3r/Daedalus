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
   * The picture: rows of colour letters, '.' for empty. Usually square, 12 or 13 wide;
   * a wider scene (e.g. 400, 24×10) is scaled to fit.
   * Letters: a primary · t text · m muted · r bad · w warn · g ok · d muted
   * (moves on its own) · b info. See `COLOURS` in PixelArt.tsx.
   */
  art: string[]
  /** Extra colour letters for this picture only, over the shared ones in PixelArt.tsx. */
  colours?: Record<string, string>
  /**
   * This code's animation: CSS rules on `.pix-<code>` (the whole picture) and
   * `.pix-<code> .px-<letter>` (one colour's pixels, with `--x` / `--y` set).
   * Shared keyframes live in animations.css.
   */
  css: string
}
