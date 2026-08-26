/**
 * The portal's own vocabulary, written down.
 *
 * Every word the admin UI, the analytics page and the customer emails use that
 * means something particular here — and several of them are easy to get subtly
 * wrong, which is why they are written down rather than left to be inferred from
 * a screen. Three statuses that look stored are derived, "expired" is caused by
 * one thing and releases two, and a rejected Grower's Choice plant deliberately
 * does not do what a rejected exact plant does.
 *
 * This is content, not a cache. It is the source the Help assistant answers
 * from, and it lives in code so that it ships in the production image — the
 * Dockerfile copies `build`, `prisma`, `scripts`, `public` and `server.js`, and
 * no Markdown at all.
 *
 * Every entry carries citations, and `help-content.test.ts` reads each cited
 * file and fails when a quote is no longer in it, so a rule that changes cannot
 * leave an entry here describing the rule it replaced. Where the behaviour is
 * computed by a function, the test additionally calls that function and asserts
 * the answer the glossary gives.
 */

export type HelpCitation = {
  /** Repo-relative path the wording is grounded in. */
  path: string;
  /** The heading, numbered rule or exported symbol inside it. */
  locator: string;
  /**
   * Text that must still appear verbatim in `path`. Omitted only where the
   * locator is the whole file.
   */
  quote?: string;
};

export type GlossaryCategory =
  | "stored status"
  | "customer label"
  | "behaviour flag"
  | "analytics metric"
  | "fulfilment route"
  | "listing"
  | "offer"
  | "shipping";

export type GlossaryEntry = {
  id: string;
  term: string;
  /** Other wordings an admin might type. Matched as strictly as the term. */
  aliases: string[];
  category: GlossaryCategory;
  /** One sentence. */
  summary: string;
  /** The body of an answer, one string per paragraph. */
  detail: string[];
  citations: HelpCitation[];
  /** Ids of entries worth reading next, especially ones easily confused. */
  seeAlso: string[];
};

const HANDOFF = "docs/CLOUD_AGENT_HANDOFF.md";
const AGENTS = "AGENTS.md";
const RUNBOOK = "docs/PRODUCTION_DEPLOYMENT.md";

export const GLOSSARY: GlossaryEntry[] = [
  {
    id: "new",
    term: "New",
    aliases: ["new request", "new status"],
    category: "stored status",
    summary:
      "The stored status of a request that has been submitted and not yet offered.",
    detail: [
      "A request is created New when the customer submits it and stays New until an admin sends the offer, which moves it to Pending.",
      "Nothing expires while a request is New. `expireOverdueOffers` only ever looks at Pending requests, and until an offer exists there is no hold to run out.",
      "Before the offer can be sent, each item has to carry what its fulfilment route requires: an exact plant needs at least one exact plant photo, a price and a weight, a Grower's Choice item needs a linked purchasable variant with enough stock, a price and a weight, and a Not Available item needs none of it. `sendOffer` refuses and names each item and the fields it lacks.",
      "New is one of the four stored statuses and it is what the customer sees too. Only Pending has a derived customer label.",
    ],
    citations: [
      {
        path: "app/lib/portal.ts",
        locator: "RequestStatus",
        quote: 'export type RequestStatus = "New" | "Pending" | "Closed" | "Expired";',
      },
      {
        path: "app/lib/portal.server.ts",
        locator: "expireOverdueOffers",
        quote: 'status: "Pending"',
      },
      {
        path: HANDOFF,
        locator: "Business rules 2a",
        quote: "What an item must carry to be offered depends on its fulfilment route",
      },
    ],
    seeAlso: ["pending", "offer-hold"],
  },
  {
    id: "pending",
    term: "Pending",
    aliases: ["pending status", "awaiting response"],
    category: "stored status",
    summary:
      "The stored status of a request whose offer has been sent and has neither been paid for nor run out.",
    detail: [
      "Sending an offer that still has something to buy sets Pending. Accepting plants leaves it Pending until payment or expiry. Declining every purchasable plant closes it immediately (`Customer Closed Request`); that is no longer a leftover Pending / No Payment Needed request. A customer who has not opened the offer is still Pending.",
      "Four things leave Pending. Payment closes the request through the `orders/paid` webhook. The hold ending unpaid makes it Expired. Rejecting every purchasable plant (or having none to accept) closes on submit, and a leftover Pending decline-all is swept on the next request load. And an admin can override-close any still-open request with `adminOverrideCloseRequest`. An offer with nothing purchasable never becomes Pending: `sendOffer` writes Closed immediately with `Admin response contained no purchasable items`.",
      "A customer is never shown the word Pending. `formatCustomerStatusLabel` derives one of three labels from it instead: Offer Ready for Review, Needs Payment or No Payment Needed.",
    ],
    citations: [
      {
        path: AGENTS,
        locator: "Business rules to preserve",
        quote:
          "Statuses stored: New / Pending / Closed / Expired. Customer labels are derived by `formatCustomerStatusLabel`",
      },
      {
        path: "app/lib/portal.ts",
        locator: "formatCustomerStatusLabel",
        quote: "Pending is stored from the moment the offer is sent.",
      },
      {
        path: HANDOFF,
        locator: "Business rules 8",
        quote: "Payment (`orders/paid`) → Closed. Unpaid hold end → Expired.",
      },
    ],
    seeAlso: [
      "needs-payment",
      "offer-ready-for-review",
      "no-payment-needed",
      "expired",
    ],
  },
  {
    id: "closed",
    term: "Closed",
    aliases: ["closed status", "purchased status"],
    category: "stored status",
    summary:
      "The stored status of a finished request: paid for, or closed because nothing was owed.",
    detail: [
      "`orders/paid` closes a paid request and marks its accepted items Sold. A redelivery of the webhook for an already-paid request is ignored rather than appending a second status event.",
      "A request can also be closed with nothing paid. `sendOffer` closes immediately when the admin response has no purchasable items and writes `Admin response contained no purchasable items` — that is not a customer decline, a payment, or an expiration. A customer who rejects every purchasable plant is closed the same way on submit (`Customer Closed Request`). The Close Request button remains only as a leftover for a Pending decline-all that has not been swept yet. Reviewing the offer with nothing selected does not show it. The admin can close such a request too — `closeDeclinedRequest` refuses while the customer has accepted something, because that request stays open until they pay or the hold expires. `adminOverrideCloseRequest` is the separate admin-only path that can end any still-open request; it writes `Admin Override Close`, keeps history, and voids an unpaid Draft Order rather than leaving a payable invoice behind.",
      "Closing does not withdraw an unclaimed exact plant from the EXACT PLANTS queue. `exactPlantReleaseReason` returns `customer_declined` when they rejected the plant, or `unclaimed_after_close` when the request closed with the plant still unclaimed. Closed means paid or means the customer wanted nothing, and the second kind holds precisely the plants that queue exists for.",
    ],
    citations: [
      {
        path: "app/lib/exact-plants.ts",
        locator: "exactPlantReleaseReason",
        quote: "Declining survives the request being closed.",
      },
      {
        path: HANDOFF,
        locator: "Payment webhooks",
        quote:
          "closes the matching request and marks accepted items Sold",
      },
    ],
    seeAlso: ["pending", "declined-item", "exact-plants-listing"],
  },
  {
    id: "expired",
    term: "Expired",
    aliases: ["expired status", "offer expired", "expiry", "expiration"],
    category: "stored status",
    summary:
      "The stored status of a Pending request whose offer hold ended before it was paid for.",
    detail: [
      "`expireOverdueOffers(shop)` is the only thing that sets it. It flips a request to Expired when the stored status is Pending, `paidAt` is null and the offer's `expiresAt` has passed. It runs from request loaders, from analytics and from the hourly `POST /cron/offer-maintenance` job, so the status is right on the next read even if nobody had a page open.",
      "What makes an offer expire is the hold running out unpaid — not what the customer answered. Accepting every plant and not paying expires exactly like never opening the offer. Only payment prevents it. A New request cannot expire, and a paid request is never touched.",
      "Expiry releases two things. Shopify stock held for a Grower's Choice line is asked only until the offer's own deadline, so the reserved unit returns at that moment even if the portal is down. The hourly sweep also deletes the unpaid draft order (`voidExpiredDraftOrders`) so the issued invoice 404s instead of staying payable after the hold ends. And each Available exact plant on the offer becomes eligible for an EXACT PLANTS listing — `accepted_unpaid_expired` when the customer had accepted it, `never_responded_expired` when they never answered.",
      "Eligible is not published. An expired plant reaches the EXACT PLANTS review queue and waits for an admin to approve it, exactly like a declined one.",
    ],
    citations: [
      {
        path: "app/lib/portal.server.ts",
        locator: "expireOverdueOffers",
        quote: 'reason: "Offer expired before payment"',
      },
      {
        path: "app/lib/exact-plants.ts",
        locator: "ExactPlantReleaseReason",
        quote: '| "accepted_unpaid_expired"',
      },
      {
        path: HANDOFF,
        locator: "Business rules 9a",
        quote:
          "An **expired unpaid offer** releases its Available plants too, by the same admin-approved path.",
      },
      {
        path: "app/lib/draft-order-void.server.ts",
        locator: "voidExpiredDraftOrders",
        quote: "Voids every expired unpaid invoice that still has a live Shopify draft order.",
      },
    ],
    seeAlso: ["pending", "offer-hold", "exact-plants-listing", "growers-choice", "draft-order"],
  },
  {
    id: "offer-ready-for-review",
    term: "Offer Ready for Review",
    aliases: ["offer ready", "ready for review"],
    category: "customer label",
    summary:
      "The label a customer sees on a Pending request they have not answered yet. It is derived, not stored.",
    detail: [
      "`formatCustomerStatusLabel` returns it for a Pending request the customer has not responded to, unless the offer is already known to have nothing payable.",
      "It exists because Pending is written once, when the offer is sent, and never revised, so it is the label rather than the status that has to tell the customer where they stand.",
      "The offer-ready email matches it: it says UPT has responded and links to the offer, and deliberately does not claim payment is due — the customer may decline everything.",
    ],
    citations: [
      {
        path: "app/lib/portal.ts",
        locator: "OFFER_READY_LABEL",
        quote: 'export const OFFER_READY_LABEL = "Offer Ready for Review";',
      },
      {
        path: AGENTS,
        locator: "Business rules to preserve",
        quote: "Pending and unanswered is **Offer Ready for Review**",
      },
    ],
    seeAlso: ["pending", "needs-payment", "no-payment-needed"],
  },
  {
    id: "needs-payment",
    term: "Needs Payment",
    aliases: ["needs payment label", "customer label for pending"],
    category: "customer label",
    summary:
      "The label a customer sees once they have answered a Pending offer and something they accepted is still unpaid. Derived, not stored.",
    detail: [
      "`formatCustomerStatusLabel` returns Needs Payment for a Pending request when the customer has responded and the offer has not been established to have nothing payable. There is no stored status called Needs Payment; Pending is the only stored status that produces it.",
      "Given nothing at all about the answer, the label is Offer Ready for Review rather than Needs Payment. A caller that does not know what the customer chose cannot know that money is owed, and the label never claims it is.",
    ],
    citations: [
      {
        path: "app/lib/portal.ts",
        locator: "NEEDS_PAYMENT_LABEL",
        quote: 'export const NEEDS_PAYMENT_LABEL = "Needs Payment";',
      },
      {
        path: "app/lib/portal.ts",
        locator: "formatCustomerStatusLabel",
        quote:
          "With neither flag supplied the label never claims money is owed.",
      },
    ],
    seeAlso: ["pending", "offer-ready-for-review", "no-payment-needed", "draft-order"],
  },
  {
    id: "no-payment-needed",
    term: "No Payment Needed",
    aliases: ["nothing to pay", "no payment"],
    category: "customer label",
    summary:
      "The leftover label on a Pending request where nothing can be paid for. Decline-all and zero-availability now close immediately, so customers normally see Closed instead. Derived, not stored.",
    detail: [
      "`formatCustomerStatusLabel` returns it whenever the request is Pending and `hasPayableItems` is explicitly false, before it looks at whether the customer has answered.",
      "`offerHasPayableItems` decides that. An offer with no Available item is unpayable whatever the customer says, and an answer that accepted nothing is unpayable too. An offer nobody has answered yet is still payable, because the customer can accept until the hold ends.",
      "It is a label on a Pending request, not a status of its own, and it is not the No-Payment Rate on the analytics page. A decline-all submit, and the next request-load sweep, close those requests so they do not sit here.",
      "The customer is not emailed again when they decline everything. Payment, if any, lives on the request page; Shopify's own paid-order confirmation covers a later checkout.",
    ],
    citations: [
      {
        path: "app/lib/portal.ts",
        locator: "NOTHING_TO_PAY_LABEL",
        quote: 'export const NOTHING_TO_PAY_LABEL = "No Payment Needed";',
      },
      {
        path: "app/lib/portal.ts",
        locator: "offerHasPayableItems",
        quote: "Whether anything on a sent offer can still be paid for.",
      },
      {
        path: HANDOFF,
        locator: "Business rules 2",
        quote: "nothing payable → **No Payment Needed**",
      },
    ],
    seeAlso: ["pending", "needs-payment", "not-available", "no-payment-rate"],
  },
  {
    id: "approval-drop-off",
    term: "Approval Drop-Off",
    aliases: ["approval dropoff", "accepted but never paid"],
    category: "behaviour flag",
    summary:
      "An internal flag for a customer who has accepted at least one plant and never paid for any.",
    detail: [
      "`computeBehaviorFlags` sets it when `itemsAccepted` is above zero and `itemsPurchased` is zero. Both are lifetime totals across the customer's requests: accepted counts the lines they chose Accept on, purchased counts accepted lines on requests that were paid for.",
      "One purchase ever clears it, because purchased is a lifetime total rather than a per-request figure.",
      "It is not Expired Offer Risk. That fires on an expired request with no paid request and does not need the customer to have accepted anything: a customer who never answers gets Expired Offer Risk, one who says yes and then does not pay gets Approval Drop-Off.",
      "Behaviour flags are internal insight. They appear in Customer Behavior Analytics and on the admin request page, never on a customer-facing page, and they never block or gate anything a customer can do.",
    ],
    citations: [
      {
        path: "app/lib/portal.ts",
        locator: "computeBehaviorFlags",
        quote: 'flags.push("Approval Drop-Off");',
      },
      {
        path: "app/lib/portal.ts",
        locator: "BehaviorFlag",
        quote:
          "None of these is ever rendered on a customer-facing\n * page",
      },
      {
        path: HANDOFF,
        locator: "Business rules 19",
        quote:
          "Behaviour flags are **internal**. They must never reach a customer-facing route",
      },
    ],
    seeAlso: ["expired-offer-risk", "accepted-vs-purchased", "needs-payment"],
  },
  {
    id: "high-request-low-purchase",
    term: "High Request / Low Purchase",
    aliases: ["high request low purchase", "asks a lot buys little"],
    category: "behaviour flag",
    summary:
      "An internal flag for a customer who has asked for at least five plants and bought fewer than 40% of them.",
    detail: [
      "`computeBehaviorFlags` sets it when `itemsRequested` is 5 or more and purchased over requested is below 0.4.",
      "The denominator is every line the customer has ever submitted, including plants UPT marked Not Available and plants that were never offered at all. So it measures how much asking turns into buying, not how good UPT's offers were.",
      "Like every behaviour flag it is admin-only and never gates anything.",
    ],
    citations: [
      {
        path: "app/lib/portal.ts",
        locator: "computeBehaviorFlags",
        quote: "if (metrics.itemsRequested >= 5 && requestToPurchase < 0.4) {",
      },
    ],
    seeAlso: ["request-to-purchase", "approval-drop-off"],
  },
  {
    id: "repeated-request-decline",
    term: "Repeated Request / Decline Pattern",
    aliases: [
      "repeated request decline",
      "repeat decline pattern",
      "keeps asking and declining",
    ],
    category: "behaviour flag",
    summary:
      "An internal flag for a customer who keeps asking for one plant and keeps turning it down.",
    detail: [
      "It is counted per canonical plant identity rather than per typed name. `Hoya carnosa`, `H. carnosa` and `hoya  carnosa` are one plant asked for three times, which on raw text reads as three plants asked for once each — and that is exactly the case worth knowing about.",
      "`repeatedRequestDeclinePattern` fires only when all three thresholds are met inside a 90-day window: at least 3 requests of that canonical plant, at least 2 outright declines, and no purchase of it at all. Any purchase of the plant ends the pattern outright.",
      "Two declines rather than one is deliberate. One decline plus unanswered offers is a reachability problem, which Expired Offer Risk already covers; two is the customer looking at the plant and saying no.",
      "It reaches the customer's analytics row through `repeatedRequestDeclinePlants`, and it leads the flag priority order because it names a plant where every other flag is a ratio. `plant-behavior.test.ts` asserts that no customer route or component can reach the module or the flag.",
    ],
    citations: [
      {
        path: "app/lib/plant-behavior.ts",
        locator: "repeatedRequestDeclinePattern",
        quote:
          "Every threshold has to be met: enough asks, enough\n * outright declines, and no purchase at all.",
      },
      {
        path: HANDOFF,
        locator: "Internal behaviour flags",
        quote:
          "It fires at **3+ requests of one\ncanonical plant within 90 days, 0 purchases of it, and 2+ declines**",
      },
    ],
    seeAlso: ["approval-drop-off", "expired-offer-risk"],
  },
  {
    id: "expired-offer-risk",
    term: "Expired Offer Risk",
    aliases: ["expired offer risk flag", "never answers"],
    category: "behaviour flag",
    summary:
      "An internal flag for a customer with at least one expired request and no paid one.",
    detail: [
      "`computeBehaviorFlags` sets it when `expiredRequests` is above zero and `closedPaidRequests` is zero.",
      "It does not require the customer to have accepted anything, which is what separates it from Approval Drop-Off.",
    ],
    citations: [
      {
        path: "app/lib/portal.ts",
        locator: "computeBehaviorFlags",
        quote:
          "if (metrics.expiredRequests > 0 && metrics.closedPaidRequests === 0) {",
      },
    ],
    seeAlso: ["approval-drop-off", "expired"],
  },
  {
    id: "accepted-vs-purchased",
    term: "Accepted vs Purchased %",
    aliases: [
      "accepted vs purchased",
      "accepted versus purchased",
      "item purchase conversion rate",
    ],
    category: "analytics metric",
    summary:
      "Items purchased as a percentage of items accepted — how much of what customers said yes to they actually paid for.",
    detail: [
      "`percent(purchased, accepted)`, rounded to one decimal place, and 0 rather than undefined when nothing was accepted.",
      "Accepted counts response lines whose choice is accept. Purchased counts those same lines on a request that has a `paidAt`, so what moves an item from accepted to purchased is payment.",
      "It is reported three times over: per shop in the item funnel, per customer in Customer Behavior Analytics, and per request in the item table. On the analytics page 'Item purchase conversion rate' is the same computation under a second name, and 'Item drop-off rate' is its complement.",
    ],
    citations: [
      {
        path: "app/lib/analytics.server.ts",
        locator: "itemFunnel",
        quote:
          "acceptedVsPurchasedPercent: percent(itemFunnel.purchased, itemFunnel.accepted),",
      },
      {
        path: "app/lib/portal.ts",
        locator: "percent",
        quote: "export function percent(numerator: number, denominator: number): number {",
      },
    ],
    seeAlso: ["request-to-purchase", "approval-drop-off", "no-payment-rate"],
  },
  {
    id: "request-to-purchase",
    term: "Request-to-Purchase %",
    aliases: [
      "request to purchase",
      "request to purchase percent",
      "requested to purchased",
    ],
    category: "analytics metric",
    summary:
      "Items purchased as a percentage of items requested — how much of what customers ask for they end up buying.",
    detail: [
      "`percent(purchased, requested)`, rounded to one decimal place, and 0 when nothing was requested.",
      "Requested counts every line on every request, including lines UPT marked Not Available and lines that were never offered at all. Offered, by contrast, counts only offer lines whose availability is available.",
      "That is why it sits below Accepted vs Purchased % and what it is for: it measures the whole funnel, sourcing included, rather than only checkout.",
    ],
    citations: [
      {
        path: "app/lib/analytics.server.ts",
        locator: "itemFunnel",
        quote:
          "requestToPurchasePercent: percent(itemFunnel.purchased, itemFunnel.requested),",
      },
      {
        path: "app/lib/analytics.server.ts",
        locator: "itemFunnel.offered",
        quote: 'if (item.availability !== "available") continue;',
      },
    ],
    seeAlso: ["accepted-vs-purchased", "high-request-low-purchase", "not-available"],
  },
  {
    id: "exact-plant",
    term: "Exact Plant",
    aliases: ["exact plant offer", "offer exact plant", "exact_plant"],
    category: "fulfilment route",
    summary:
      "One specific physical plant, sourced and photographed for the customer who asked for it. The default fulfilment route.",
    detail: [
      "Stored as `fulfillmentType: \"exact_plant\"`, which is also what an unset value normalises to, so every offer made before Grower's Choice existed is an exact plant.",
      "It needs at least one exact plant photo, a price and a weight before its offer can be sent. The photograph is of the individual being sold, so a store listing photo will not do.",
      "There is no Shopify product for it while it is on offer, so an accepted exact plant is billed as a custom draft-order line and no Shopify inventory is reserved for it. The offer's hold is a promise UPT keeps, not a Shopify reservation.",
      "When an exact plant stops being held for the customer it was offered to — they declined it, or the hold ran out unpaid — it becomes a candidate for an EXACT PLANTS listing.",
    ],
    citations: [
      {
        path: "app/lib/growers-choice.ts",
        locator: "normalizeStoredFulfillmentType",
        quote: 'return raw === "growers_choice" ? "growers_choice" : "exact_plant";',
      },
      {
        path: HANDOFF,
        locator: "Business rules 7",
        quote:
          "an exact plant has no product in Shopify yet and stays custom",
      },
      {
        path: HANDOFF,
        locator: "Business rules 2a",
        quote:
          "An **exact plant** needs at least one exact plant photo, a price and a weight.",
      },
    ],
    seeAlso: ["growers-choice", "exact-plants-listing", "declined-item"],
  },
  {
    id: "growers-choice",
    term: "Grower's Choice",
    aliases: [
      "growers choice",
      "grower's choice / existing website stock",
      "existing website stock",
      "link existing website stock",
      "growers_choice",
    ],
    category: "fulfilment route",
    summary:
      "A plant supplied from a variant the store already lists, picked at dispatch rather than sourced for one customer.",
    detail: [
      "Stored as `fulfillmentType: \"growers_choice\"`. The admin chooses it as Link Existing Website Stock; the customer is shown Grower's Choice.",
      "Only a purchasable variant may be linked: an ACTIVE product, a price above zero, `availableForSale`, and either untracked stock or at least one unit. Untracked stock is allowed and is not the same as stock of zero — Shopify has no counter for it, so there is nothing to be short of. `unlinkableVariantReason` gives the reason rather than hiding the variant from the search results.",
      "Such an item needs a linked variant with enough stock, a price and a weight — the linked variant's own weight wherever Shopify has one — and no exact plant photo, there being no single plant to photograph.",
      "Linking reserves nothing. Stock is held once, when the customer accepts and the draft order is created, through `DraftOrderInput.reserveInventoryUntil` set to the offer's own payment deadline. Shopify releases it itself at that deadline and turns it into a real deduction on payment, so nothing in this app has to put a quantity back.",
      "The photo is the listing's, not the plant's, so the offer page carries a disclosure saying so, and the hold sentence drops the word 'exact' on any offer carrying one of these lines.",
      "A rejected or expired Grower's Choice item does not enter the EXACT PLANTS queue, where a rejected exact plant does. The plant already has a Shopify product and went back on the shelf when the hold ended, so a listing would be a second product for it — and an EXACT PLANTS listing is one physical plant with one unit of tracked stock.",
    ],
    citations: [
      {
        path: "app/lib/growers-choice.ts",
        locator: "module comment",
        quote:
          "a plant supplied from stock the store already lists, rather\n * than one specific plant sourced and photographed for one customer.",
      },
      {
        path: "app/lib/exact-plants.ts",
        locator: "exactPlantReleaseReason",
        quote: 'if (input.offerFulfillmentType === "growers_choice") return null;',
      },
      {
        path: HANDOFF,
        locator: "Grower's Choice from existing website stock",
        quote:
          "A rejected Grower's Choice item does **not** enter the EXACT PLANTS queue",
      },
      {
        path: HANDOFF,
        locator: "Business rules 7a",
        quote: "Linking a listing reserves nothing.",
      },
    ],
    seeAlso: ["exact-plant", "exact-plants-listing", "draft-order", "expired"],
  },
  {
    id: "exact-plants-listing",
    term: "EXACT PLANTS listing",
    aliases: [
      "exact plants",
      "exact plants collection",
      "listing review",
      "declined item listing",
    ],
    category: "listing",
    summary:
      "The Shopify product created, only after an admin approves it, for an exact plant that is no longer held for anyone.",
    detail: [
      "Eligibility is `exactPlantReleaseReason`, the one rule the listing queue, the review form and analytics all use. It keeps the historical reasons apart: `customer_declined`, `accepted_unpaid_expired`, `never_responded_expired`, and `unclaimed_after_close` when a request closed with the Exact Plant still unclaimed.",
      "A plant is only ever released when it is promised to nobody. Never while a hold is live, never for a UPT Not Available item, never for a Grower's Choice line, and never for a paid request. Candidates are read from offer items rather than from customer responses, because an offer that simply expired has no response rows at all and would otherwise be missed.",
      "Nothing is auto-published. The customer's rejection is saved without creating a product; an admin opens the review form and approves it, and Cancel creates nothing. Dismiss from EXACT PLANTS is the other queue action: it requires confirmation, writes `Admin Dismissed from EXACT PLANTS` plus `exactPlantDismissedAt`, and removes the item from the active queue without creating a Shopify product or deleting the request, response, offer snapshot, photos or history. A plant that already has a product GID cannot be dismissed.",
      "The listing prefills and publishes title, price, weight and the selected exact-plant photos only — never customer-facing notes or disclaimers, customer identity, request information or customer response information.",
      "One Shopify product per item, added to the existing EXACT PLANTS collection and published to Online Store and Point of Sale only. The variant tracks inventory, denies oversell and is stocked with one unit before it is published, because an untracked plant can be sold to several customers and a tracked one published before it is stocked shows as sold out.",
      "The `upt-declined-item:{requestItemId}` tag is the idempotency key: a retry updates the product that already exists rather than creating a second one. The `declined` wording predates expired offers becoming eligible and is kept because renaming it would orphan the products created under it.",
    ],
    citations: [
      {
        path: "app/lib/exact-plants.ts",
        locator: "exactPlantReleaseReason",
        quote:
          "An item is only ever released while it is not promised to anyone",
      },
      {
        path: "app/lib/exact-plants.ts",
        locator: "EXACT_PLANT_DISMISSED_REASON",
        quote: 'export const EXACT_PLANT_DISMISSED_REASON = "Admin Dismissed from EXACT PLANTS";',
      },
      {
        path: HANDOFF,
        locator: "Business rules 10",
        quote:
          "**Never auto-publish declined items.** Save the rejection; wait for admin review + explicit approve.",
      },
      {
        path: HANDOFF,
        locator: "Business rules 11",
        quote:
          "Listing prefill/publish: title, price, weight, selected exact-plant photos only.",
      },
      {
        path: AGENTS,
        locator: "Business rules to preserve",
        quote:
          "An EXACT PLANTS listing is **one physical plant**: its variant tracks inventory, holds one unit, and denies oversell.",
      },
    ],
    seeAlso: ["declined-item", "expired", "exact-plant", "growers-choice"],
  },
  {
    id: "declined-item",
    term: "Declined Item",
    aliases: ["declined plant", "customer rejected", "reject"],
    category: "listing",
    summary:
      "An Available plant that UPT offered as an exact plant and the customer answered Reject.",
    detail: [
      "All four parts are required: UPT marked the item Available, UPT made an exact-plant offer for it, the customer was given Accept and Reject, and the customer chose Reject.",
      "It is not UPT Not Available, which was never on offer and has no exact plant to sell. It is not a rejected Grower's Choice item either, which already has its own Shopify product.",
      "The rejection is recorded and nothing is published. A decline also survives the request being closed, so tidying a finished request away does not take its declined plant out of the review queue.",
    ],
    citations: [
      {
        path: HANDOFF,
        locator: "Business rules 9",
        quote:
          "**Declined item** means: UPT marked Available, UPT created an **exact-plant** offer, customer was given Accept/Reject, customer chose **Reject**.",
      },
      {
        path: "app/lib/exact-plants.ts",
        locator: "exactPlantReleaseReason",
        quote: 'if (input.responseChoice === "reject") return "customer_declined";',
      },
    ],
    seeAlso: ["exact-plants-listing", "not-available", "growers-choice"],
  },
  {
    id: "not-available",
    term: "UPT Not Available",
    aliases: ["not available", "not_available", "unavailable item"],
    category: "offer",
    summary:
      "An item UPT cannot supply. It appears on the offer with a reason and cannot be accepted or rejected.",
    detail: [
      "Stored as `availability: \"not_available\"`, which overrides whatever fulfilment route the item was on: a plant UPT cannot supply is not being supplied either way, and a stale route must not put it back into a draft order.",
      "It carries one of four reasons: currently not in UPT prop circulation, available in 2+ mos, available in 2-3weeks, or not in our current inventory.",
      "It needs no photo, price or weight before the offer can be sent, it is excluded from the offered count in analytics, and it can never become an EXACT PLANTS listing — there is no exact plant to sell. `readOfferChoices` only honours accept and reject, so a forged field cannot make an unavailable plant purchasable.",
      "An offer where nothing is available shows no FedEx upgrade and creates no draft order. `sendOffer` closes that request immediately; a leftover Pending all-unavailable answer still has a Close Request button.",
    ],
    citations: [
      {
        path: "app/lib/growers-choice.ts",
        locator: "resolveFulfillmentType",
        quote: "Not Available wins over anything stored",
      },
      {
        path: "app/lib/portal.ts",
        locator: "UNAVAILABLE_REASON_OPTIONS",
        quote: '"currently not in UPT prop circulation",',
      },
      {
        path: "app/lib/exact-plants.ts",
        locator: "exactPlantIneligibilityReason",
        quote:
          '"UPT Not Available items cannot become EXACT PLANTS listings."',
      },
    ],
    seeAlso: ["declined-item", "no-payment-needed", "fedex-upgrade"],
  },
  {
    id: "fedex-upgrade",
    term: "FedEx Priority Overnight upgrade",
    aliases: ["fedex", "fedex upgrade", "shipping upgrade", "priority overnight"],
    category: "shipping",
    summary:
      "An optional shipping upgrade on the offer, checked by default, sold as a separate Shopify product.",
    detail: [
      "It appears as a real checkbox on any unanswered offer that has at least one Available plant. JavaScript checks and enables it while one or more purchasable plants are accepted, and unchecks, disables and greys it out when the last accepted plant is rejected. An offer where nothing is available shows no upgrade at all, there being nothing to ship.",
      "It is only ever charged alongside plants. `buildDraftOrderLineItems` adds the FedEx line only when there is at least one accepted plant line, so a customer who declines everything is never billed for shipping.",
      "Unchecking it opens the Settings warning immediately when JavaScript is available. Without JavaScript it is a second server round-trip. The buttons are Keep FedEx Upgrade and I Understand, Remove Upgrade. A crafted POST without acknowledgement is refused.",
      "`ShopSettings.fedexUpgradePrice` is the single amount — what the offer quotes, what the response snapshot freezes and what the confirmation email states — and the draft-order line carries that frozen amount, so Shopify bills what the customer answered rather than whatever the variant costs by the time they open the invoice.",
      "It is a shipping service and not a plant: excluded from plant revenue and plant counts, on no fulfilment route in analytics, weightless on the draft order, and never given an EXACT PLANTS listing.",
    ],
    citations: [
      {
        path: AGENTS,
        locator: "Business rules to preserve",
        quote:
          "FedEx is optional, default on, excluded from plant analytics, never listed in EXACT PLANTS.",
      },
      {
        path: "app/lib/portal.ts",
        locator: "buildDraftOrderLineItems",
        quote: "if (input.fedexSelected && lines.length > 0) {",
      },
      {
        path: HANDOFF,
        locator: "The offer response follows the same rules",
        quote: "Removing FedEx is a **two-step server round-trip**",
      },
    ],
    seeAlso: ["draft-order", "not-available", "offer-hold"],
  },
  {
    id: "offer-hold",
    term: "Offer hold",
    aliases: [
      "hold",
      "expiration window",
      "expires at",
      "3 5 7 day hold",
      "offer snapshot",
      "how long a customer has to respond",
      "how long the customer has to reply",
      "response deadline",
    ],
    category: "offer",
    summary:
      "The 3, 5 or 7 day window, chosen when the offer is sent, that the offered plants are held for.",
    detail: [
      "The admin picks 3, 5 or 7 days at send. The resulting `expiresAt` is the deadline everywhere it matters: the hold sentence on the offer page, the Shopify stock reservation on a Grower's Choice draft order, and the moment `expireOverdueOffers` sets the request Expired.",
      "Sending the offer freezes a snapshot of it — name, price, weight, photos, notes, availability, fulfilment route and the linked product and variant titles. Those are never edited afterwards and never re-read from Shopify: a merchant renaming or repricing a product must not rewrite what the customer answered or what they are billed.",
      "Automatic expiration reminders are no longer sent. They would be a fourth customer email on the happy path.",
    ],
    citations: [
      {
        path: "app/lib/portal.ts",
        locator: "OfferExpirationDays",
        quote: "export type OfferExpirationDays = 3 | 5 | 7;",
      },
      {
        path: HANDOFF,
        locator: "Business rules 5",
        quote:
          "Offer snapshots freeze name, price, photos, notes, availability, fulfilment route and the linked product/variant titles after send.",
      },
      {
        path: HANDOFF,
        locator: "Emails",
        quote:
          "Automatic expiration reminders are no longer sent",
      },
    ],
    seeAlso: ["expired", "pending", "growers-choice"],
  },
  {
    id: "draft-order",
    term: "Draft order",
    aliases: ["invoice", "checkout link", "payment link", "draft orders"],
    category: "offer",
    summary:
      "The Shopify draft order that bills a customer for the plants they accepted.",
    detail: [
      "Created only for accepted plants, plus the FedEx line when the customer kept the upgrade. Never for a response that rejected everything, and never for an offer where nothing was available.",
      "A Grower's Choice line sells the real Shopify variant, which is also what the stock reservation is asked for. An exact plant has no Shopify product yet, so its line is a custom one with a title, price and weight, and it is marked as requiring shipping — a draft order with nothing shippable collects no address and quotes no shipping.",
      "Creation is idempotent three times over: a recorded `DraftOrderReference` with a checkout link short-circuits, the `upt-request:{requestId}` tag finds a draft order Shopify already created when a previous reply was lost, and a creation claim makes the window between those two exclusive. Without the first two a retry bills the customer twice; without the third, two concurrent callers reserve the same plant twice.",
      "Payment closes the request through the `orders/paid` webhook, which also marks the accepted items Sold. That webhook is the only thing that records payment. If the same webhook arrives after the invoice was already voided, the payment is still recorded and the request is Closed — money is never dropped — and the admin gets one `Payment After Expiration/Void` event and email.",
      "Shopify has no void state for a draft order. `draftOrderDelete` is the only way to make an issued invoice unpayable; the portal keeps the GID, invoice URL and line items on `DraftOrderReference` with `voidedAt`.",
    ],
    citations: [
      {
        path: HANDOFF,
        locator: "Business rules 7",
        quote:
          "Draft orders only for **accepted** plants (plus FedEx if selected).",
      },
      {
        path: HANDOFF,
        locator: "Shopify integrations implemented (in code)",
        quote: "Draft orders are idempotent three times over",
      },
      {
        path: "app/lib/draft-order-void.server.ts",
        locator: "COMPLETED_BEFORE_VOID",
        quote: "Shopify completed the draft before we could delete it.",
      },
    ],
    seeAlso: ["needs-payment", "fedex-upgrade", "growers-choice", "closed", "expired"],
  },
  {
    id: "no-payment-rate",
    term: "No-Payment Rate",
    aliases: ["no payment rate", "nonpayment rate"],
    category: "analytics metric",
    summary:
      "The share of a customer's requests that have not ended as a paid, closed request.",
    detail: [
      "`computeNoPaymentRate` is total requests minus closed-and-paid requests, over total requests. A request the customer may still pay for counts against it, and so does one that is still New.",
      "It is not the No Payment Needed label. That is a per-request, customer-facing label meaning nothing on this offer can be paid for; this is a lifetime ratio in the admin's customer table.",
    ],
    citations: [
      {
        path: "app/lib/portal.ts",
        locator: "computeNoPaymentRate",
        quote:
          "return percent(totalRequests - closedPaidRequests, totalRequests);",
      },
    ],
    seeAlso: ["no-payment-needed", "accepted-vs-purchased"],
  },
  {
    id: "item-status",
    term: "Item status",
    aliases: ["sourced", "offered", "sold", "listed", "requested item status"],
    category: "offer",
    summary:
      "Requested, Sourced, Offered, Sold, Unavailable or Listed — the per-plant status, which is not the request status.",
    detail: [
      "A line starts Requested. Sending an offer marks it Offered, payment marks it Sold, a plant UPT cannot supply is Unavailable, and Listed means an approved EXACT PLANTS product exists for it.",
      "A request has one status of its own and may carry several items in different item statuses at the same time.",
    ],
    citations: [
      {
        path: "app/lib/portal.ts",
        locator: "PlantItemStatus",
        quote: "export type PlantItemStatus =",
      },
      {
        path: HANDOFF,
        locator: "Database / schema architecture",
        quote:
          "Item statuses: `Requested` | `Sourced` | `Offered` | `Sold` | `Unavailable` | `Listed`.",
      },
    ],
    seeAlso: ["new", "pending", "closed", "exact-plants-listing"],
  },
  {
    id: "request-number",
    term: "Request number",
    aliases: ["req number", "req1", "request numbering"],
    category: "offer",
    summary:
      "`REQ1`, `REQ2`, `REQ2178` — sequential, unpadded and shop-wide.",
    detail: [
      "There is no year prefix and no zero padding. The sequence is shop-wide, kept in a single `RequestNumberSequence` row.",
      "The legacy `UPT-REQ-YYYY-NNNNNN` form is still understood when reading — the paid-order webhook and the admin search both accept it — but nothing new is ever written in that shape.",
    ],
    citations: [
      {
        path: "app/lib/portal.ts",
        locator: "formatRequestNumber",
        quote: "return `REQ${n}`;",
      },
      {
        path: AGENTS,
        locator: "Notes / gotchas",
        quote:
          "Request numbers are `REQ1`, `REQ2`, `REQ2178` (sequential, unpadded).",
      },
    ],
    seeAlso: ["new"],
  },
];

/** Terms every glossary must define, whatever else it grows. */
export const REQUIRED_GLOSSARY_TERMS = [
  "New",
  "Pending",
  "Closed",
  "Expired",
  "Offer Ready for Review",
  "Needs Payment",
  "No Payment Needed",
  "Approval Drop-Off",
  "High Request / Low Purchase",
  "Repeated Request / Decline Pattern",
  "Accepted vs Purchased %",
  "Request-to-Purchase %",
  "Exact Plant",
  "Grower's Choice",
  "EXACT PLANTS listing",
] as const;

export function glossaryEntry(id: string): GlossaryEntry | undefined {
  return GLOSSARY.find((entry) => entry.id === id);
}

export const GLOSSARY_CATEGORY_ORDER: GlossaryCategory[] = [
  "stored status",
  "customer label",
  "offer",
  "fulfilment route",
  "listing",
  "shipping",
  "behaviour flag",
  "analytics metric",
];

export { HANDOFF as HANDOFF_DOC, AGENTS as AGENTS_DOC, RUNBOOK as RUNBOOK_DOC };
