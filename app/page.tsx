"use client";

// Home is the new design artifact only. The previous React screens live under
// app/_legacy/ and are not mounted, so they cannot interfere with the product UI.
import DesignShell from "./design-shell";

export default function Home() {
  return <DesignShell />;
}
