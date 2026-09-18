import { getDb } from "../../../db";
import { activity } from "../../../db/schema";

export async function recordActivity(options: {
  wallet: string;
  kind: string;
  title: string;
  status?: string;
  referenceId?: string | null;
  amountLunas?: number | null;
}) {
  const db = getDb();
  await db.insert(activity).values({
    id: crypto.randomUUID(),
    walletAddress: options.wallet,
    kind: options.kind,
    title: options.title.slice(0, 120),
    status: options.status ?? "done",
    referenceId: options.referenceId ?? null,
    amountLunas: options.amountLunas ?? null,
  });
}

export function didLine(kind: string, title: string, extra?: string) {
  const label = kind.replaceAll("_", " ");
  const core = `I saved “${title}” in You as a ${label}.`;
  return extra ? `${core} ${extra}` : core;
}
