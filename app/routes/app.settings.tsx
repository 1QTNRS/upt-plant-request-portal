import { useEffect, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  DEFAULT_FEDEX_REMOVAL_WARNING,
  useFedexWarningSettings,
} from "../lib/fedex-warning-settings";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return null;
};

export default function Settings() {
  const { fedexRemovalWarning, setFedexRemovalWarning, resetFedexRemovalWarning } =
    useFedexWarningSettings();
  const [draft, setDraft] = useState(fedexRemovalWarning);
  const [status, setStatus] = useState<{
    saved: boolean;
    reset: boolean;
  } | null>(null);

  useEffect(() => {
    setDraft(fedexRemovalWarning);
  }, [fedexRemovalWarning]);

  const handleSave = () => {
    setFedexRemovalWarning(draft);
    setStatus({ saved: true, reset: false });
  };

  const handleReset = () => {
    resetFedexRemovalWarning();
    setDraft(DEFAULT_FEDEX_REMOVAL_WARNING);
    setStatus({ saved: true, reset: true });
  };

  return (
    <s-page heading="Settings">
      {status?.saved && (
        <s-banner tone="success">
          <s-text>
            {status.reset
              ? "FedEx warning message reset to the default."
              : "FedEx warning message saved for this session."}
          </s-text>
        </s-banner>
      )}

      <s-section heading="Customer offer — FedEx upgrade warning">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            This message is shown to customers when they try to remove the FedEx
            Priority Overnight upgrade on their offer page.
          </s-paragraph>
          <s-text color="subdued">
            Saved locally for this admin session only. Database persistence is
            not enabled yet.
          </s-text>

          <s-stack direction="block" gap="base">
            <label htmlFor="fedex-removal-warning">
              <s-text color="subdued">Warning message</s-text>
            </label>
            <textarea
              id="fedex-removal-warning"
              rows={6}
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              style={{
                width: "100%",
                maxWidth: "640px",
                padding: "12px",
                borderRadius: "8px",
                border: "1px solid #c9cccf",
                font: "inherit",
                lineHeight: 1.5,
                resize: "vertical",
              }}
            />
            <s-stack direction="inline" gap="small">
              <s-button variant="primary" onClick={handleSave}>
                Save message
              </s-button>
              <s-button variant="secondary" onClick={handleReset}>
                Reset to default
              </s-button>
            </s-stack>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
