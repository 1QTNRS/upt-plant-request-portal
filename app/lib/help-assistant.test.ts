import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import {
  answerPortalQuestion,
  MAX_PROVIDER_CANDIDATES,
} from "./help-assistant.server";
import {
  disabledHelpAssistantProvider,
  helpAssistantAiStatus,
  helpAssistantProviderFromEnv,
  MAX_PROVIDER_ANSWER_CHARS,
  parseHelpProviderReply,
  readHelpAssistantAiConfig,
  type HelpAssistantProvider,
  type HelpGroundingPassage,
} from "./help-assistant-ai.server";
import {
  contextPassageIds,
  matchedTerms,
  NOT_DOCUMENTED_ANSWER,
  rankHelpPassages,
  resolveHelpQuestion,
  stemHelpToken,
  type HelpRequestContext,
} from "./help-retrieval";

/** No provider, which is the default and the only configuration CI has. */
const withoutAi = { provider: disabledHelpAssistantProvider };

/** Records what it was asked and answers however the test says. */
function fakeProvider(
  reply: Awaited<ReturnType<HelpAssistantProvider["answerFromPassages"]>>,
  options: { throws?: boolean } = {},
): HelpAssistantProvider & {
  calls: Array<{ question: string; passages: HelpGroundingPassage[] }>;
} {
  const calls: Array<{ question: string; passages: HelpGroundingPassage[] }> = [];
  return {
    name: "test-provider",
    calls,
    async answerFromPassages(input) {
      calls.push(input);
      if (options.throws) throw new Error("provider unreachable");
      return reply;
    },
  };
}

describe("the assistant answers the questions it exists for", () => {
  const expected: Array<[string, string]> = [
    ["What does Approval Drop-Off mean?", "Approval Drop-Off"],
    ["What happens when an offer expires?", "Expired"],
    ["When does FedEx appear?", "FedEx Priority Overnight upgrade"],
    ["What does Pending mean?", "Pending"],
    ["Why is this request Expired?", "Expired"],
    ["How does the EXACT PLANTS workflow work?", "The EXACT PLANTS workflow"],
    ["What does No Payment Needed mean?", "No Payment Needed"],
    [
      "What does Repeated Request / Decline Pattern mean?",
      "Repeated Request / Decline Pattern",
    ],
    ["When is the customer actually charged?", "When money is taken"],
    ["Can a customer see another customer's requests?", "What a customer can see"],
  ];

  for (const [question, title] of expected) {
    it(`answers: ${question}`, async () => {
      const answer = await answerPortalQuestion({ question, ...withoutAi });
      assert.ok(answer.documented, `${question} should be answered`);
      assert.equal(answer.passages[0].title, title);
      assert.ok(answer.text.length > 40, "the answer should be the passage");
      assert.ok(answer.sources[0].citations.length > 0, "an answer names its source");
    });
  }

  it("forgives a misspelling of a term", async () => {
    const answer = await answerPortalQuestion({
      question: "what does aproval dropoff mean",
      ...withoutAi,
    });
    assert.equal(answer.match, "near_term");
    assert.equal(answer.passages[0].title, "Approval Drop-Off");
  });

  it("prefers the longer of two terms named by the same words", () => {
    const listing = resolveHelpQuestion({
      question: "how does an EXACT PLANTS listing get published",
    });
    assert.equal(listing.passages[0].id, "exact-plants-listing");

    const route = resolveHelpQuestion({ question: "what is an exact plant" });
    assert.equal(route.passages[0].id, "exact-plant");
  });

  it("folds word endings so a question need not match the term's grammar", () => {
    assert.equal(stemHelpToken("expires"), stemHelpToken("expired"));
    assert.equal(stemHelpToken("purchases"), stemHelpToken("purchased"));
    assert.equal(stemHelpToken("listings"), stemHelpToken("listing"));
    assert.equal(stemHelpToken("statuses"), stemHelpToken("status"));
    assert.notEqual(stemHelpToken("notes"), "not");
  });
});

describe("it says so when something is not documented", () => {
  const undocumented = [
    "What is the refund policy?",
    "How many warehouses does UPT have?",
    "What is the wholesale discount for resellers?",
    "What tax rate is applied at checkout?",
    "Do you ship internationally?",
    "Can I edit a customer's saved credit card?",
  ];

  for (const question of undocumented) {
    it(`refuses: ${question}`, async () => {
      const answer = await answerPortalQuestion({ question, ...withoutAi });
      assert.equal(answer.documented, false);
      assert.equal(answer.passages.length, 0);
      assert.ok(answer.text.startsWith(NOT_DOCUMENTED_ANSWER));
    });
  }

  it("names the nearest entries rather than answering from them", async () => {
    const answer = await answerPortalQuestion({
      question: "What tax rate is applied at checkout?",
      ...withoutAi,
    });
    assert.equal(answer.documented, false);
    assert.match(answer.text, /nearest documented entries/);
    assert.equal(answer.sources.length, 0, "a refusal cites nothing");
  });

  it("asks for a question rather than refusing an empty one", async () => {
    const answer = await answerPortalQuestion({ question: "   ", ...withoutAi });
    assert.equal(answer.documented, false);
    assert.match(answer.text, /Ask a question/);
  });
});

describe("it works with no AI provider, which is the default", () => {
  it("is disabled by an empty environment", () => {
    assert.equal(readHelpAssistantAiConfig({}), null);
    assert.equal(
      helpAssistantProviderFromEnv({}),
      disabledHelpAssistantProvider,
    );
    assert.equal(helpAssistantAiStatus({}).enabled, false);
  });

  it("stays disabled until every variable is present", () => {
    const full = {
      HELP_ASSISTANT_AI_PROVIDER: "openai",
      HELP_ASSISTANT_AI_BASE_URL: "https://api.example.test/v1/",
      HELP_ASSISTANT_AI_MODEL: "some-model",
      HELP_ASSISTANT_AI_API_KEY: "not-a-real-key",
    } as NodeJS.ProcessEnv;

    for (const omitted of Object.keys(full)) {
      const env = { ...full };
      delete env[omitted];
      assert.equal(
        readHelpAssistantAiConfig(env),
        null,
        `${omitted} missing must leave AI disabled`,
      );
    }

    const config = readHelpAssistantAiConfig(full);
    assert.equal(config?.provider, "openai");
    assert.equal(config?.model, "some-model");
    assert.equal(config?.baseUrl, "https://api.example.test/v1");

    const status = helpAssistantAiStatus(full);
    assert.equal(status.enabled, true);
    assert.ok(!status.detail.includes("not-a-real-key"), "never echo the key");
  });

  it("names the variables that would turn it on", () => {
    const detail = helpAssistantAiStatus({}).detail;
    for (const variable of [
      "HELP_ASSISTANT_AI_PROVIDER",
      "HELP_ASSISTANT_AI_BASE_URL",
      "HELP_ASSISTANT_AI_MODEL",
      "HELP_ASSISTANT_AI_API_KEY",
    ]) {
      assert.ok(detail.includes(variable), `${variable} should be named`);
    }
  });

  it("takes the vendor from configuration rather than hard-coding one", () => {
    const config = readHelpAssistantAiConfig({
      HELP_ASSISTANT_AI_PROVIDER: "ollama",
      HELP_ASSISTANT_AI_BASE_URL: "http://127.0.0.1:11434/v1",
      HELP_ASSISTANT_AI_MODEL: "llama3.1:8b",
      HELP_ASSISTANT_AI_API_KEY: "unused",
    });
    assert.equal(config?.provider, "ollama");
    assert.equal(config?.baseUrl, "http://127.0.0.1:11434/v1");
  });

  it("answers without one and records that nothing worded it", async () => {
    const answer = await answerPortalQuestion({
      question: "What does Needs Payment mean?",
      ...withoutAi,
    });
    assert.equal(answer.phrasing, null);
    assert.equal(answer.match, "term");
    assert.ok(answer.documented);
  });
});

describe("a provider may only work with the passages it is handed", () => {
  it("is offered the passages that scored, and no more", async () => {
    const provider = fakeProvider(null);
    await answerPortalQuestion({
      question: "What happens when an offer expires?",
      provider,
    });
    assert.equal(provider.calls.length, 1);
    const offered = provider.calls[0].passages;
    assert.ok(offered.length > 0);
    assert.ok(offered.length <= MAX_PROVIDER_CANDIDATES);
  });

  it("is not asked at all about something the documentation never mentions", async () => {
    const provider = fakeProvider({ passageIds: ["expired"], text: "invented" });
    const answer = await answerPortalQuestion({
      question: "What is the wholesale discount for resellers?",
      provider,
    });
    assert.equal(provider.calls.length, 0, "there was nothing to choose between");
    assert.equal(answer.documented, false);
  });

  it("cannot introduce a passage of its own", async () => {
    const provider = fakeProvider({
      passageIds: ["refund-policy"],
      text: "Refunds are issued within 30 days.",
    });
    const answer = await answerPortalQuestion({
      question: "What does Pending mean?",
      provider,
    });
    assert.equal(answer.match, "term");
    assert.equal(answer.phrasing, null);
    assert.ok(!answer.text.includes("Refunds"));
  });

  it("has its reply dropped when it names nothing that was supplied", () => {
    const passages: HelpGroundingPassage[] = [
      { id: "expired", title: "Expired", text: "..." },
    ];
    assert.equal(
      parseHelpProviderReply(
        JSON.stringify({ passageIds: ["invented"], text: "hello" }),
        passages,
      ),
      null,
    );
    assert.equal(
      parseHelpProviderReply(JSON.stringify({ passageIds: [] }), passages),
      null,
    );
    assert.equal(parseHelpProviderReply("not json", passages), null);
    assert.equal(parseHelpProviderReply(42, passages), null);
  });

  it("keeps only the supplied ids and refuses an over-long answer", () => {
    const passages: HelpGroundingPassage[] = [
      { id: "expired", title: "Expired", text: "..." },
      { id: "pending", title: "Pending", text: "..." },
    ];
    const reply = parseHelpProviderReply(
      JSON.stringify({
        passageIds: ["pending", "invented", "pending"],
        text: "x".repeat(MAX_PROVIDER_ANSWER_CHARS + 1),
      }),
      passages,
    );
    assert.deepEqual(reply?.passageIds, ["pending"]);
    assert.equal(reply?.text, null, "an essay is not a rewording of a passage");
  });

  it("words the answer when it stays inside the passages", async () => {
    const provider = fakeProvider({
      passageIds: ["expired"],
      text: "An unpaid hold running out makes the request Expired.",
    });
    const answer = await answerPortalQuestion({
      question: "so what happens once the hold runs out",
      provider,
      model: "test-model",
    });
    assert.equal(answer.match, "provider");
    assert.equal(answer.text, "An unpaid hold running out makes the request Expired.");
    assert.equal(answer.passages[0].id, "expired");
    assert.deepEqual(answer.phrasing, { provider: "test-provider", model: "test-model" });
    assert.ok(answer.sources[0].citations.length > 0, "the source is still shown");
  });

  it("falls back to the passage when it returns ids but no wording", async () => {
    const provider = fakeProvider({ passageIds: ["pending"], text: null });
    const answer = await answerPortalQuestion({
      question: "what state is a sent offer in",
      provider,
      model: null,
    });
    assert.equal(answer.passages[0].id, "pending");
    assert.ok(answer.text.startsWith("The stored status of a request whose offer"));
  });

  it("is indistinguishable from absent when it fails", async () => {
    const provider = fakeProvider(null, { throws: true });
    const answer = await answerPortalQuestion({
      question: "What does Pending mean?",
      provider,
    });
    assert.equal(answer.match, "term");
    assert.equal(answer.phrasing, null);
    assert.ok(answer.documented);
  });
});

describe("an answer can be asked about one request", () => {
  const context: HelpRequestContext = {
    requestNumber: "REQ123",
    status: "Pending",
    customerStatusLabel: "Needs Payment",
    hasResponded: true,
    offerExpiresAtIso: "2026-09-01T00:00:00.000Z",
    fulfillmentTypes: ["exact_plant", "growers_choice"],
  };

  it("names the glossary that request's state is written in", () => {
    assert.deepEqual(contextPassageIds(context), [
      "pending",
      "needs-payment",
      "offer-hold",
      "exact-plant",
      "growers-choice",
    ]);
    assert.deepEqual(
      contextPassageIds({
        requestNumber: "REQ7",
        status: "Pending",
        hasPayableItems: false,
      }),
      ["pending", "no-payment-needed"],
    );
    assert.deepEqual(
      contextPassageIds({ requestNumber: "REQ8", status: "Expired" }),
      ["expired"],
    );
  });

  it("moves those passages up the order", () => {
    const question = "why does this say the customer still owes money";
    const without = rankHelpPassages({ question });
    const with_ = rankHelpPassages({ question, context });
    const boosted = with_.ranked.find(
      (entry) => entry.passage.id === "needs-payment",
    );
    assert.ok(boosted, "the request's own label should be a candidate");
    assert.ok(boosted.boost > 0);
    assert.equal(
      without.ranked.find((entry) => entry.passage.id === "needs-payment")?.boost,
      0,
    );
  });

  it("cannot make an undocumented question answerable", async () => {
    const answer = await answerPortalQuestion({
      question: "What is the wholesale discount for resellers?",
      context,
      ...withoutAi,
    });
    assert.equal(answer.documented, false);
    assert.deepEqual(answer.context, context);
  });

  it("is carried through onto the answer", async () => {
    const answer = await answerPortalQuestion({
      question: "What does Needs Payment mean?",
      context,
      ...withoutAi,
    });
    assert.equal(answer.context?.requestNumber, "REQ123");
    assert.equal(answer.passages[0].id, "needs-payment");
  });
});

/**
 * The assistant explains internal analysis — behaviour flags, release reasons,
 * conversion rates — so it belongs to the merchant and to nobody else. Nothing a
 * customer can load may reach it, and it may not need customer data to work.
 */
describe("the assistant is admin-only", () => {
  const modules = [
    "help-assistant",
    "help-assistant-ai",
    "help-retrieval",
    "help-glossary",
    "help-topics",
  ];
  const roots = [
    path.join(import.meta.dirname, "..", "routes"),
    path.join(import.meta.dirname, "..", "components"),
  ];

  /** Every source file under a root, named the way a route is named. */
  async function sourceFiles(root: string): Promise<string[]> {
    const entries = await readdir(root, {
      recursive: true,
      withFileTypes: true,
    }).catch(() => []);
    return entries
      .filter((entry) => entry.isFile() && /[.]tsx?$/.test(entry.name))
      .map((entry) =>
        path.relative(root, path.join(entry.parentPath, entry.name)),
      );
  }

  it("is not referenced by any customer route or component", async () => {
    const forbidden = [...modules, "Ask UPT Portal", "/app/help", "answerPortalQuestion"];

    let checked = 0;
    for (const root of roots) {
      for (const entry of await sourceFiles(root)) {
        if (!/(^|\/)customer[.-]/.test(entry)) continue;
        const source = await readFile(path.join(root, entry), "utf8");
        checked += 1;
        for (const needle of forbidden) {
          assert.ok(
            !source.includes(needle),
            `${entry} must not reference ${needle}`,
          );
        }
      }
    }
    assert.ok(checked > 0, "the customer-facing files should have been found");
  });

  it("is only reachable from an admin route, behind requireAdmin", async () => {
    let admin = 0;
    for (const root of roots) {
      for (const entry of await sourceFiles(root)) {
        const source = await readFile(path.join(root, entry), "utf8");
        if (!modules.some((module) => source.includes(`lib/${module}`))) continue;
        assert.match(
          entry,
          /^app[.]/,
          `${entry} reaches the help modules but is not an admin route`,
        );
        assert.ok(
          source.includes("requireAdmin"),
          `${entry} must require an admin session`,
        );
        admin += 1;
      }
    }
    assert.ok(admin > 0, "the admin help route should have been found");
  });

  it("cannot read customer data, having no persistence at all", async () => {
    for (const module of ["help-assistant.server", "help-retrieval", "help-glossary", "help-topics"]) {
      const source = await readFile(
        path.join(import.meta.dirname, `${module}.ts`),
        "utf8",
      );
      // The glossary quotes paths like `app/lib/portal.server.ts` as citations,
      // so it is the import specifiers that have to be clean, not the prose.
      const imported = [...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map(
        (match) => match[1],
      );
      for (const forbidden of ["db.server", "portal.server", "@prisma/client"]) {
        assert.ok(
          !imported.some((specifier) => specifier.includes(forbidden)),
          `${module} must not import ${forbidden}`,
        );
      }
    }
  });

  it("matches a term without needing a shop, a request or a customer", () => {
    const matches = matchedTerms("what does approval drop-off mean");
    assert.equal(matches[0].passageId, "approval-drop-off");
    assert.equal(matches[0].exact, true);
  });
});
