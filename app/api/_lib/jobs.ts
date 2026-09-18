export type StageLinks = {
  status: string;
  invoiceStatus?: string | null;
  escrowStatus?: string | null;
};

export function stageDisplayStatus(stage: StageLinks) {
  if (stage.invoiceStatus === "paid") return "paid";
  if (stage.escrowStatus && /^(paid_direct|released)$/.test(stage.escrowStatus)) return "paid";
  if (stage.status === "cancelled") return "cancelled";
  if (stage.escrowStatus) return "escrowed";
  if (stage.invoiceStatus === "open" || stage.status === "invoiced") return "invoiced";
  if (stage.status === "escrow_requested") return "escrow_requested";
  return "pending";
}

export function jobIsComplete(stageStatuses: string[]) {
  return stageStatuses.length > 0 && stageStatuses.every((status) => status === "paid" || status === "cancelled")
    && stageStatuses.some((status) => status === "paid");
}
