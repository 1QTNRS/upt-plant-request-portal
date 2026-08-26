export function itemNoteLines(item: {
  customerRequestNotes?: string;
  adminNotes?: string;
}): { customer?: string; admin?: string } {
  const customer = item.customerRequestNotes?.trim() || "";
  const admin = item.adminNotes?.trim() || "";
  return {
    ...(customer ? { customer } : {}),
    ...(admin && admin !== customer ? { admin } : {}),
  };
}

export function mobileAdminNotes(item: {
  customerRequestNotes?: string | null;
  adminNotes?: string | null;
}): string {
  const customer = item.customerRequestNotes?.trim() || "";
  const admin = item.adminNotes?.trim() || "";
  return admin && admin !== customer ? admin : "";
}
