"use client";

import { ReactNode, useState } from "react";

export function Fold({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="fold">
      <button type="button" className="fold-head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span>{title}</span>
        {typeof count === "number" && <span className="fold-count">{count}</span>}
        <span className="grow" />
        <svg className={`fold-chevron${open ? " open" : ""}`} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && <div className="fold-body">{children}</div>}
    </section>
  );
}
