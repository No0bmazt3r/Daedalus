import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion"
import { cn } from "cn"
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react"

function Accordion({ className, ...props }: AccordionPrimitive.Root.Props) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn("flex w-full flex-col", className)}
      {...props}
    />
  )
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("not-last:border-b", className)}
      {...props}
    />
  )
}

function AccordionTrigger({
  className,
  children,
  ...props
}: AccordionPrimitive.Trigger.Props) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "group/accordion-trigger relative flex flex-1 items-start justify-between rounded-lg border border-transparent py-2.5 text-left text-sm font-medium transition-all outline-none hover:underline focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:after:border-ring aria-disabled:pointer-events-none aria-disabled:opacity-50 **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-4 **:data-[slot=accordion-trigger-icon]:text-muted-foreground",
          className
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon data-slot="accordion-trigger-icon" className="pointer-events-none shrink-0 group-aria-expanded/accordion-trigger:hidden" />
        <ChevronUpIcon data-slot="accordion-trigger-icon" className="pointer-events-none hidden shrink-0 group-aria-expanded/accordion-trigger:inline" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

/**
 * The panel, carrying the app's one collapse animation.
 *
 * Two animations, and they are not fighting: Base UI animates the panel's
 * *height* — from a measured `--accordion-panel-height`, so nothing is guessed —
 * which is what makes the items below slide rather than jump. The domino
 * cascade from `components/ui/collapse.tsx` then plays over the contents, so an
 * accordion opens exactly like every other collapsible thing here.
 *
 * `data-domino` is set from the panel's own state rather than derived in CSS,
 * because CSS cannot set an attribute and the stagger rules key on one. The
 * `ending` transition status is what distinguishes "closing" from "closed": at
 * that moment the panel is still mounted and still has height, which is the only
 * window in which an outbound cascade can be seen at all.
 *
 * `index.css` slows the height animation to match, so the last row is not cut
 * off by a panel that has already finished collapsing.
 */
function AccordionContent({
  className,
  children,
  ...props
}: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-content"
      className="overflow-hidden text-sm data-open:animate-accordion-down data-closed:animate-accordion-up"
      // `render` rather than children, because the state the cascade needs —
      // open, and whether this is the closing transition — is only handed to
      // the render function. A caller passing its own `render` still wins: the
      // spread below is deliberate, as it is on every other part in this file.
      render={(panelProps, state) => (
        <div {...panelProps}>
          <div
            data-domino={
              state.transitionStatus === 'ending' ? 'out' : state.open ? 'in' : undefined
            }
            className={cn(
              "h-(--accordion-panel-height) pt-0 pb-2.5 data-ending-style:h-0 data-starting-style:h-0 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
              className
            )}
          >
            {children}
          </div>
        </div>
      )}
      {...props}
    />
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
