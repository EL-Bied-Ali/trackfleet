export type DeliveryCreationDraftParcel = {
  key: string;
  weightKg: string;
  manualPriceAmount: string;
  itemDescription: string;
  paymentStatus: "unpaid" | "partial" | "paid";
  amountPaid: string;
  // The depot scale weighs several parcels for one client at once -- rather
  // than typing the same weight into every row, checking this on a row folds
  // it into the nearest preceding un-grouped row's own weight, which is then
  // read as a TOTAL for the whole run and split evenly (see
  // parcelWeightGroups in page.tsx). False for a row that carries its own
  // weight, whether standalone or as the first (anchor) row of a group.
  groupedWithPrevious: boolean;
};

export type DeliveryCreationDraft = {
  destinationSiteId: string;
  departureAt: string;
  vehicleId: string;
  parcels: DeliveryCreationDraftParcel[];
  customer: string;
  contact: string;
  customerEmail: string;
  recipientName: string;
  recipientContact: string;
  whatsappOptIn: boolean;
};

// Same per-account-per-user namespacing as origin-preference.ts/truck-preference.ts,
// so two dispatchers at the same company never clobber each other's in-progress form.
export function deliveryCreationDraftKey(company: { account: string; user: string }) {
  return `trackfleet-delivery-draft:${encodeURIComponent(company.account.toLowerCase())}:${encodeURIComponent(company.user.toLowerCase())}`;
}

// A draft with nothing typed into it isn't worth restoring -- treating it as
// "no draft" lets the caller clear the stored key instead of leaving an
// empty one around, and lets openCreateModal fall through to its normal
// (non-draft) defaults.
export function isMeaningfulDeliveryCreationDraft(draft: DeliveryCreationDraft): boolean {
  return Boolean(
    draft.destinationSiteId
    || draft.departureAt
    || draft.customer.trim()
    || draft.contact.trim()
    || draft.customerEmail.trim()
    || draft.recipientName.trim()
    || draft.recipientContact.trim()
    || draft.parcels.some((parcel) => parcel.weightKg.trim() || parcel.manualPriceAmount.trim() || parcel.itemDescription.trim()),
  );
}
