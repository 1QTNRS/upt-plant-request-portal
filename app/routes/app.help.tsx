import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { requireAdmin } from "../lib/admin-auth.server";
import {
  answerPortalQuestion,
  helpAssistantAiStatus,
} from "../lib/help-assistant.server";
import { GLOSSARY_CATEGORY_ORDER } from "../lib/help-glossary";
import { citationLines, helpPassages } from "../lib/help-retrieval";

const EXAMPLE_QUESTIONS = [
  "What does Approval Drop-Off mean?",
  "What happens when an offer expires?",
  "When does FedEx appear?",
  "What does No Payment Needed mean?",
  "How does the EXACT PLANTS workflow work?",
  "When is the customer charged?",
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request);
  const passages = helpPassages();

  return {
    aiStatus: helpAssistantAiStatus(),
    glossary: passages
      .filter((passage) => passage.kind === "glossary")
      .map((passage) => ({
        id: passage.id,
        term: passage.title,
        category: passage.category ?? "offer",
        summary: passage.summary,
        detail: passage.detail,
        citations: citationLines(passage),
      })),
    topics: passages
      .filter((passage) => passage.kind === "topic")
      .map((passage) => ({
        id: passage.id,
        title: passage.title,
        summary: passage.summary,
      })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireAdmin(request);
  const form = await request.formData();
  const question = String(form.get("question") || "");
  return { answer: await answerPortalQuestion({ question }) };
};

export default function Help() {
  const { aiStatus, glossary, topics } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const answer = actionData?.answer;

  const categories = GLOSSARY_CATEGORY_ORDER.map((category) => ({
    category,
    entries: glossary.filter((entry) => entry.category === category),
  })).filter((group) => group.entries.length > 0);

  return (
    <s-page heading="Help — Ask UPT Portal">
      <s-section heading="Ask a question">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Answers come from this app&apos;s own glossary, business rules and
            handoff notes, and every answer names where it came from. When
            something is not documented, this says so instead of guessing.
          </s-paragraph>

          <Form method="post">
            <s-stack direction="block" gap="base">
              <s-text-field
                name="question"
                label="Your question"
                defaultValue={answer?.question ?? ""}
                placeholder="What does Approval Drop-Off mean?"
              />
              <s-button
                variant="primary"
                type="submit"
                {...(navigation.state !== "idle" ? { loading: true } : {})}
              >
                Ask
              </s-button>
            </s-stack>
          </Form>

          <s-text color="subdued">
            For example: {EXAMPLE_QUESTIONS.join(" · ")}
          </s-text>
        </s-stack>
      </s-section>

      {answer ? (
        <s-section heading={answer.documented ? "Answer" : "Not documented"}>
          <s-stack direction="block" gap="base">
            {answer.documented ? null : (
              <s-banner tone="warning">
                <s-text>
                  Nothing in the documentation answers this, so there is no
                  answer to give.
                </s-text>
              </s-banner>
            )}

            {answer.text.split("\n\n").map((paragraph, index) => (
              <s-paragraph key={index}>{paragraph}</s-paragraph>
            ))}

            {answer.sources.length > 0 ? (
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="small">
                  <s-text color="subdued">Where this comes from</s-text>
                  {answer.sources.map((source) => (
                    <s-stack key={source.passageId} direction="block" gap="none">
                      <s-text>{source.title}</s-text>
                      {source.citations.map((citation) => (
                        <s-text key={citation} color="subdued">
                          {citation}
                        </s-text>
                      ))}
                    </s-stack>
                  ))}
                </s-stack>
              </s-box>
            ) : null}

            {answer.seeAlso.length > 0 ? (
              <s-text color="subdued">
                See also: {answer.seeAlso.join(", ")}
              </s-text>
            ) : null}

            <s-text color="subdued">
              {answer.phrasing
                ? `Worded by ${answer.phrasing.provider}${
                    answer.phrasing.model ? ` (${answer.phrasing.model})` : ""
                  } from the passages above.`
                : "Matched and worded by the app itself, with no AI provider involved."}
            </s-text>
          </s-stack>
        </s-section>
      ) : null}

      <s-section heading="AI assistance">
        <s-stack direction="block" gap="small">
          <s-badge tone={aiStatus.enabled ? "success" : "info"}>
            {aiStatus.enabled ? "Configured" : "Off"}
          </s-badge>
          <s-text color="subdued">{aiStatus.detail}</s-text>
        </s-stack>
      </s-section>

      <s-section heading="How the portal works">
        <s-stack direction="block" gap="base">
          {topics.map((topic) => (
            <s-stack key={topic.id} direction="block" gap="none">
              <s-heading>{topic.title}</s-heading>
              <s-text color="subdued">{topic.summary}</s-text>
            </s-stack>
          ))}
        </s-stack>
      </s-section>

      {categories.map((group) => (
        <s-section key={group.category} heading={`Glossary — ${group.category}`}>
          <s-stack direction="block" gap="base">
            {group.entries.map((entry) => (
              <s-box
                key={entry.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="base"
              >
                <s-stack direction="block" gap="small">
                  <s-heading>{entry.term}</s-heading>
                  <s-text>{entry.summary}</s-text>
                  {entry.detail.map((paragraph, index) => (
                    <s-text key={index} color="subdued">
                      {paragraph}
                    </s-text>
                  ))}
                  {entry.citations.map((citation) => (
                    <s-text key={citation} color="subdued">
                      {citation}
                    </s-text>
                  ))}
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      ))}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
