import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import "./glossary-term.css";

type GlossaryTermProps = {
  children: ReactNode;
  definition: string;
  className?: string;
  focusable?: boolean;
};

type TooltipPosition = {
  left: number;
  side: "bottom" | "top";
  top: number;
};

export function GlossaryTerm({
  children,
  definition,
  className = "",
  focusable = true,
}: GlossaryTermProps) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({
    left: 0,
    side: "top",
    top: 0,
  });
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const accessibleName = typeof children === "string" ? children : undefined;

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      return;
    }
    const updatePosition = () => {
      const bounds = triggerRef.current?.getBoundingClientRect();
      if (!bounds) {
        return;
      }
      const edgePadding = 124;
      const left = Math.min(
        Math.max(bounds.left + bounds.width / 2, edgePadding),
        window.innerWidth - edgePadding,
      );
      const side = bounds.top < 80 ? "bottom" : "top";
      setPosition({
        left,
        side,
        top: side === "bottom" ? bounds.bottom + 7 : bounds.top - 7,
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  return (
    <span
      className={`glossary-term ${className}`.trim()}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        aria-describedby={tooltipId}
        aria-label={accessibleName}
        className="glossary-term__trigger"
        onBlur={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        ref={triggerRef}
        role="term"
        tabIndex={focusable ? 0 : undefined}
      >
        {children}
      </span>
      {open
        ? createPortal(
            <span
              className={`glossary-term__tooltip glossary-term__tooltip--${position.side}`}
              id={tooltipId}
              role="tooltip"
              style={{ left: position.left, top: position.top }}
            >
              {definition}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
