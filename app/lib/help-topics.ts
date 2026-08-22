/**
 * The documented workflows, as answers.
 *
 * The glossary defines a word; these explain a sequence — how a request moves
 * through the app, when money is actually taken, what a customer can see. They
 * are the passages an admin's "how does X work" question lands on, and like the
 * glossary they are grounded in citations the tests check against the real
 * files.
 *
 * They deliberately do not repeat a glossary definition. Where a question is
 * about one term, the glossary entry is the better answer and retrieval prefers
 * it, because an exact term match beats a topic's keyword overlap.
 */

import type { HelpCitation } from "./help-glossary";
import { AGENTS_DOC, HANDOFF_DOC, RUNBOOK_DOC } from "./help-glossary";

export type HelpTopic = {
  id: string;
  title: string;
  /** Ways an admin might ask for this topic, matched as strictly as the title. */
  aliases: string[];
  summary: string;
  detail: string[];
  citations: HelpCitation[];
  /** Glossary ids worth reading next. */
  seeAlso: string[];
};

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "request-lifecycle",
    title: "The life of a request",
    aliases: [
      "request lifecycle",
      "request workflow",
      "statuses",
      "status flow",
      "how a request moves",
    ],
    summary:
      "Submitted as New, Pending once the offer is sent, then Closed by payment or Expired by the hold running out.",
    detail: [
      "The customer submits a request with a plant name and optional notes. There is no quantity field — quantity is always 1 — and no budget field. The request is stored New and numbered `REQ1`, `REQ2`, and so on.",
      "An admin works the request: for each plant, Not Available with a reason, an exact plant with a photo, price and weight, or a Grower's Choice line linked to existing store stock. Sending the offer stores Pending, freezes the offer snapshot and starts a 3, 5 or 7 day hold.",
      "The customer answers each Available plant with Accept or Reject. Nothing is pre-selected and an unanswered plant is refused rather than defaulted, because a pre-checked Accept turns an unread offer into a purchase for anyone who just presses Submit. Accepting creates one draft order for the accepted plants, plus FedEx if it was kept.",
      "Payment closes the request and marks the accepted items Sold. If the hold ends unpaid the request becomes Expired instead. A request where nothing could be paid for can be closed by the customer or by the admin.",
      "The stored statuses are only New, Pending, Closed and Expired. Everything a customer reads on a Pending request is a label derived from it.",
    ],
    citations: [
      {
        path: AGENTS_DOC,
        locator: "Business rules to preserve",
        quote:
          "No quantity field on the customer form; quantity is 1. No Budget in the active customer workflow.",
      },
      {
        path: HANDOFF_DOC,
        locator: "The offer response follows the same rules",
        quote: "**Nothing is pre-selected.**",
      },
      {
        path: HANDOFF_DOC,
        locator: "Business rules 8",
        quote: "Payment (`orders/paid`) → Closed. Unpaid hold end → Expired.",
      },
    ],
    seeAlso: ["new", "pending", "closed", "expired", "offer-hold"],
  },
  {
    id: "exact-plants-workflow",
    title: "The EXACT PLANTS workflow",
    aliases: [
      "exact plants workflow",
      "how exact plants works",
      "listing queue",
      "publishing a released plant",
      "published automatically",
      "auto publish",
      "why a plant appeared in the shop",
    ],
    summary:
      "A released exact plant reaches a review queue, an admin approves it, and only then does one Shopify product appear in the EXACT PLANTS collection.",
    detail: [
      "A plant reaches the queue when `exactPlantReleaseReason` says it is promised to nobody: the customer declined it, they accepted it and the hold ended unpaid, or they never answered and the hold ended. The three reasons are kept apart in the queue and in analytics.",
      "Candidates are read from offer items rather than from customer responses, because an offer that simply expired has no response rows and starting from the response would silently miss every unanswered expired offer.",
      "Nothing is created until an admin approves it. The review form prefills the title, price, weight and the exact-plant photos, and nothing else — no customer-facing notes, no customer identity, no request or response information. Cancel creates nothing.",
      "On approve, one Shopify product is created per item, added to the existing EXACT PLANTS collection, given a variant that tracks inventory and denies oversell, stocked with one unit at the shop's primary location, and only then published — to Online Store and Point of Sale only. Publishing before stocking would show the plant as sold out.",
      "Retries are safe. The `upt-declined-item:{requestItemId}` tag identifies the product for that item, so a repeated approval updates it instead of creating a second listing. A failure keeps the rejection and allows the retry.",
      "Never for an accepted-and-paid plant, never for UPT Not Available, never for an item that was never offered, never for a Grower's Choice line, and never for the FedEx upgrade.",
    ],
    citations: [
      {
        path: HANDOFF_DOC,
        locator: "EXACT PLANTS creation",
        quote:
          "Candidates are\nqueried from **offer items**, not from customer responses",
      },
      {
        path: HANDOFF_DOC,
        locator: "One plant, one unit of stock",
        quote:
          "stocked with a\nquantity of 1 at the shop's primary location, all **before** `publishablePublish`",
      },
      {
        path: HANDOFF_DOC,
        locator: "Business rules 13",
        quote:
          "Do not create EXACT PLANTS listings for accepted items, UPT Not Available items, never-offered items, or FedEx.",
      },
    ],
    seeAlso: ["exact-plants-listing", "declined-item", "expired", "growers-choice"],
  },
  {
    id: "payment",
    title: "When money is taken",
    aliases: [
      "payment",
      "when is the customer charged",
      "billing",
      "how does the customer pay",
      "money",
    ],
    summary:
      "Only through a Shopify draft-order invoice for plants the customer accepted, and only the `orders/paid` webhook records it.",
    detail: [
      "Nothing is charged when a request is submitted, when an offer is sent, or when the customer opens the offer. A draft order is created when the customer accepts at least one plant, and it bills those plants plus the FedEx upgrade if they kept it.",
      "The amounts are the ones the customer answered. The offer snapshot froze the price, and the draft-order line carries that frozen amount, so a merchant repricing a product between the offer and the invoice does not change what is billed.",
      "The customer pays through Shopify's own invoice. The app learns about it from the `orders/paid` webhook, which closes the request and marks the accepted items Sold — that webhook is the only thing in the app that records a payment.",
      "A response that accepted nothing creates no draft order and no checkout link, and the customer is told plainly that no payment is needed.",
      "Not paying has one consequence: when the hold ends the request becomes Expired, any Shopify stock reservation lapses, and the exact plants become eligible for review as EXACT PLANTS listings.",
    ],
    citations: [
      {
        path: HANDOFF_DOC,
        locator: "Business rules 7",
        quote:
          "Draft orders only for **accepted** plants (plus FedEx if selected).",
      },
      {
        path: HANDOFF_DOC,
        locator: "Draft orders",
        quote:
          "Shopify bills what the customer answered rather than whatever the variant costs",
      },
      {
        path: HANDOFF_DOC,
        locator: "Payment webhooks",
        quote: "closes the matching request and marks accepted items Sold",
      },
    ],
    seeAlso: ["draft-order", "needs-payment", "no-payment-needed", "expired"],
  },
  {
    id: "emails",
    title: "Which emails go out",
    aliases: [
      "emails",
      "notifications",
      "outbox",
      "which emails are sent",
      "email delivery",
    ],
    summary:
      "Three to the customer — received, offer ready, one consolidated answer summary — plus an expiry reminder; exactly two to UPT.",
    detail: [
      "UPT's mailbox gets two events only: a new request, and one summary per customer response. Never one per item, and never for admin-side status changes, analytics, expiry maintenance or payment — Shopify's own paid-order notification covers that.",
      "The customer gets a request-received mail, an offer-ready mail that says UPT has responded and links to the offer without claiming payment is due, and a single confirmation covering their whole answer: accepted and declined items with prices and notes, the FedEx outcome, one checkout link when anything was accepted, and a plain no-payment-needed line when nothing was.",
      "One expiration reminder goes out before the hold ends, and only to customers who either never answered or accepted something. A customer who declined every plant is not chased.",
      "Delivery needs `RESEND_API_KEY`. Without it messages stay in the outbox with status `preview` and nothing is attempted. `failed` is a different state and means Resend refused the send — an unverified `EMAIL_FROM` domain is the likely first cause, and it must not be described as leaving messages in `preview`.",
      "Every customer-facing link in an email is a storefront app-proxy URL. A link to the app's own origin carries no signed identity and renders 'Request not available'.",
    ],
    citations: [
      {
        path: HANDOFF_DOC,
        locator: "Emails",
        quote:
          "UPT's mailbox gets exactly two events: `admin_new_request` and `admin_response`",
      },
      {
        path: HANDOFF_DOC,
        locator: "Emails",
        quote:
          "`preview` means no `RESEND_API_KEY`, so nothing was attempted; `failed` means Resend refused the send",
      },
      {
        path: AGENTS_DOC,
        locator: "Notes / gotchas",
        quote:
          "Customer-facing links must go through the storefront app proxy",
      },
    ],
    seeAlso: ["offer-hold", "no-payment-needed", "draft-order"],
  },
  {
    id: "customer-visibility",
    title: "What a customer can see",
    aliases: [
      "customer privacy",
      "can a customer see",
      "customer portal access",
      "who sees what",
    ],
    summary:
      "Only their own requests, and only after the app-proxy signature has been verified.",
    detail: [
      "A customer may only ever see their own requests. Ownership is decided by `identityOwnsRequest`: a request already claimed by a Shopify account id is never reachable by email, so changing an account email cannot reach a stranger's request.",
      "The customer portal is served through the storefront app proxy and every request to it is HMAC-verified before any identity is trusted. `logged_in_customer_id` is never read without that check, and the shop comes from the signed parameter.",
      "Internal analysis is admin-only and stays that way. Behaviour flags — including Repeated Request / Decline Pattern — appear in Customer Behavior Analytics and on the admin request page, never on a customer-facing page, and they never block or gate anything a customer can do.",
      "This Help surface is admin-only for the same reason. It is reachable at `/app/help` behind `requireAdmin` and is not linked from, or reachable through, any customer route.",
    ],
    citations: [
      {
        path: AGENTS_DOC,
        locator: "Business rules to preserve",
        quote:
          "A customer may only ever see their own requests. App-proxy identity is only trustworthy after the HMAC check",
      },
      {
        path: HANDOFF_DOC,
        locator: "Business rules 19",
        quote:
          "Behaviour flags are **internal**. They must never reach a customer-facing route",
      },
    ],
    seeAlso: ["repeated-request-decline", "approval-drop-off"],
  },
  {
    id: "plant-identity",
    title: "How plant names are grouped",
    aliases: [
      "canonical plant",
      "plant identity",
      "same plant",
      "plant name review",
      "spelling",
    ],
    summary:
      "Every line keeps the customer's wording and also points at a canonical identity, which is what analytics count on.",
    detail: [
      "`RequestItem.plantName` is the customer's own wording and is never rewritten. `RequestItem.canonicalPlantId` points at the identity the line is counted under, so `Hoya carnosa` and `H. carnosa` are one row in analytics and the customer still sees what they typed.",
      "Matching is deterministic and needs no network. Identical canonical keys, or an edit distance of 1 on the epithet, link automatically. Distance 2, or an abbreviation expansion that is not exact, opens an admin suggestion and merges nothing. Anything else stays separate, silently.",
      "Quoted names, cultivars, accession, clone, collection and seedling numbers, collector codes and locality words are never merged automatically. A wrong merge corrupts per-plant figures invisibly, which is worse than two rows for one plant.",
      "Suggestions are answered from the Plant Name Review card on the analytics page: Same Plant merges the identities and records the answer so it is not asked again, Keep Separate refuses the pair forever.",
    ],
    citations: [
      {
        path: HANDOFF_DOC,
        locator: "Canonical plant identity",
        quote:
          "Two names are kept for every line, permanently.",
      },
      {
        path: HANDOFF_DOC,
        locator: "Business rules 17",
        quote:
          "Only high confidence links two spellings automatically. Medium opens an admin suggestion and merges nothing.",
      },
    ],
    seeAlso: ["repeated-request-decline", "accepted-vs-purchased"],
  },
  {
    id: "ai-assist",
    title: "AI is optional and off by default",
    aliases: [
      "ai",
      "ai provider",
      "enable ai",
      "which model",
      "llm",
      "openai",
      "anthropic",
    ],
    summary:
      "Both AI assists in this app are off with no credential configured, and nothing requires one.",
    detail: [
      "No provider is configured and no core flow consults one. Requests, offers, draft orders, payments and analytics all work with AI absent, which is the default and the only path CI takes.",
      "The plant-name assist may only ever suggest. It is capped at medium confidence, so it can never link an identity on its own, and a returned identity that was not among the candidates is discarded.",
      "This Help assistant answers from the app's own glossary and documentation whether or not a provider is configured. A provider can only reword a passage the app already retrieved, or point at a different one of the passages it was given; it can never introduce a rule, and the passage and its source are shown beside whatever wording comes back.",
      "Each assist is enabled by four variables set together, all with a common prefix: `_PROVIDER` is the vendor label, `_BASE_URL` is an OpenAI-compatible chat-completions endpoint, `_MODEL` is the model id and `_API_KEY` is the bearer token. `PLANT_IDENTITY_AI_*` configures the plant-name assist, `HELP_ASSISTANT_AI_*` this one. With any of the four missing the disabled provider is used and nothing is sent anywhere. An optional `_TIMEOUT_MS` overrides the default.",
      "Naming a URL and a model rather than a company is what keeps the vendor out of the code: any hosted gateway or local runner that speaks the chat-completions shape works, and a provider with a different wire shape can be dropped in by implementing the interface.",
      "They are deliberately absent from `render.yaml`, because a `sync: false` entry would make the first deploy prompt for a credential that does not exist and that nothing needs.",
    ],
    citations: [
      {
        path: HANDOFF_DOC,
        locator: "AI is an optional assist, off by default",
        quote:
          "**No provider is configured, and nothing requires one**",
      },
      {
        path: HANDOFF_DOC,
        locator: "AI is an optional assist, off by default",
        quote:
          "They are deliberately **not** in `render.yaml`",
      },
      {
        path: AGENTS_DOC,
        locator: "Business rules to preserve",
        quote:
          "It may only ever *suggest*, is capped at medium confidence",
      },
    ],
    seeAlso: ["help-assistant"],
  },
  {
    id: "help-assistant",
    title: "Ask UPT Portal",
    aliases: [
      "ask upt portal",
      "help assistant",
      "this assistant",
      "what can you answer",
      "how do you work",
    ],
    summary:
      "This page answers questions about how the portal works from the app's own glossary and documentation, and says so when something is not documented.",
    detail: [
      "It is grounded. Every answer is a passage from the glossary, from a documented workflow, or from `AGENTS.md`, `docs/CLOUD_AGENT_HANDOFF.md` and the deployment runbook, and every answer names where it came from.",
      "When nothing documented matches the question it says the question is not documented rather than guessing. A confident wrong answer about when money is taken is worse than admitting the app does not say.",
      "It never reads customer data. The answer path takes a question and, optionally, the derived state of one request; it has no database access of its own, so it can neither look a customer up nor leak one.",
      "It is admin-only, behind `requireAdmin` at `/app/help`, and is not reachable from any customer route.",
      "It works with no AI provider, which is the default: matching is done by exact and near matching on the glossary terms plus keyword retrieval over the documented passages. A configured provider improves the wording and the choice between passages and is never required.",
    ],
    citations: [
      {
        path: RUNBOOK_DOC,
        locator: "Summary",
        quote: "Render",
      },
      {
        path: AGENTS_DOC,
        locator: "top",
        quote: "docs/CLOUD_AGENT_HANDOFF.md",
      },
    ],
    seeAlso: ["ai-assist", "customer-visibility"],
  },
];
