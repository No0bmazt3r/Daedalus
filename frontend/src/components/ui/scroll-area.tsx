import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"
import { cn } from "cn"

/**
 * `viewportClassName` exists because padding on the Root does not do what it
 * looks like it does.
 *
 * The Root is the positioned box; the Viewport inside it is `size-full` and is
 * what actually scrolls and clips. Padding the Root therefore insets its
 * content box while the Viewport still spans the padding box, so children sit
 * *under* the padding and are cut at the edge. On elements with a transparent
 * background nobody notices; the sidebar's filter input has a visible border
 * and rendered with its left edge sliced off.
 *
 * Padding belongs on the Viewport, which is what this forwards.
 *
 * `hideScrollbar` drops the scrollbar and keeps the scrolling — wheel, trackpad,
 * touch, and keyboard once something inside has focus. It is for the places
 * where the track is the only thing wide enough to notice in a narrow column,
 * like the sidebar's two lists. Everywhere else, leave it: a scrollbar is how
 * somebody knows there is more, and hiding it is a trade, not an improvement.
 */
function ScrollArea({
  className,
  viewportClassName,
  hideScrollbar = false,
  children,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  viewportClassName?: string
  hideScrollbar?: boolean
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className={cn(
          "size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1",
          viewportClassName,
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {!hideScrollbar && <ScrollBar />}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none data-horizontal:h-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:h-full data-vertical:w-2.5 data-vertical:border-l data-vertical:border-l-transparent",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-border"
      />
    </ScrollAreaPrimitive.Scrollbar>
  )
}

export { ScrollArea, ScrollBar }
