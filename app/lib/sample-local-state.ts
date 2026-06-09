import { resetCustomerItemNotes } from "./customer-item-notes";
import { resetCustomerOfferResponses } from "./customer-offer-responses";
import { resetSubmittedRequests } from "./customer-request-submissions";
import { resetItemAvailability } from "./item-availability";
import { resetItemPricing } from "./item-pricing";
import { resetSampleOfferState } from "./sample-requests";

export function resetAllSampleLocalState(): void {
  resetSampleOfferState();
  resetSubmittedRequests();
  resetCustomerOfferResponses();
  resetCustomerItemNotes();
  resetItemAvailability();
  resetItemPricing();
}
