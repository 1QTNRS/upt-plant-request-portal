import { useEffect, useState } from "react";
import { Form, useNavigation } from "react-router";

import {
  computeTimeRemaining,
  formatCustomerStatusLabel,
  requestStatusTone,
  type CustomerMyRequestRow,
  type RequestStatus,
} from "../lib/portal";

type PlantLine = {
  key: string;
  plantName: string;
  budget: string;
  notes: string;
};

function createPlantLine(): PlantLine {
  return {
    key: `plant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    plantName: "",
    budget: "",
    notes: "",
  };
}

const buttonStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: "8px",
  border: "1px solid #c9cccf",
  font: "inherit",
  cursor: "pointer",
};

export function CustomerRequestPortal({
  loggedIn,
  name,
  email,
  myRequests,
  successMessage,
  errors,
  requestDetailHref,
  showDemoLogin,
  formAction,
}: {
  loggedIn: boolean;
  name: string;
  email: string;
  myRequests: CustomerMyRequestRow[];
  successMessage?: string | null;
  errors?: string[];
  requestDetailHref: (requestId: string) => string;
  showDemoLogin: boolean;
  formAction?: string;
}) {
  const navigation = useNavigation();
  const [plantLines, setPlantLines] = useState<PlantLine[]>([createPlantLine()]);

  useEffect(() => {
    if (successMessage) {
      setPlantLines([createPlantLine()]);
    }
  }, [successMessage]);

  if (!loggedIn) {
    return (
      <s-page heading="Customer Request Form">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-text>
              Please log in to your Shopify customer account to submit a plant
              request.
            </s-text>
            {showDemoLogin ? (
              <Form method="post" action={formAction}>
                <input type="hidden" name="intent" value="demo-login" />
                <s-stack direction="block" gap="base">
                  <s-button variant="primary" type="submit">
                    Continue as logged in customer
                  </s-button>
                  <s-text color="subdued">
                    Development login uses the demo customer account. Production
                    uses the Shopify customer account from the app proxy or
                    Customer Account authentication.
                  </s-text>
                </s-stack>
              </Form>
            ) : (
              <s-text color="subdued">
                Open this page from your Shopify account while logged in.
              </s-text>
            )}
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Customer Request Form">
      {successMessage ? (
        <s-banner tone="success">
          <s-text>{successMessage}</s-text>
        </s-banner>
      ) : null}

      <s-section heading="New request">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">
            Name and email come from your customer account. You can submit
            multiple plants in one request. There is no quantity field — each
            exact plant is reviewed individually.
          </s-text>
          <s-text-field label="Name" value={name} readOnly />
          <s-text-field label="Email" value={email} readOnly />
        </s-stack>
      </s-section>

      <Form method="post" action={formAction}>
        <input type="hidden" name="intent" value="submit-request" />
        <s-section heading="Plants requested">
          <s-stack direction="block" gap="large">
            {plantLines.map((line, index) => (
              <s-box
                key={line.key}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="block" gap="base">
                  <s-heading>Plant {index + 1}</s-heading>
                  <input type="hidden" name={`plantName-${index}`} value={line.plantName} />
                  <input type="hidden" name={`budget-${index}`} value={line.budget} />
                  <input type="hidden" name={`notes-${index}`} value={line.notes} />
                  <s-text-field
                    label="Plant Name"
                    value={line.plantName}
                    required
                    onChange={(event) =>
                      setPlantLines((current) =>
                        current.map((entry) =>
                          entry.key === line.key
                            ? { ...entry, plantName: event.currentTarget.value }
                            : entry,
                        ),
                      )
                    }
                  />
                  <s-text-field
                    label="Budget (optional)"
                    value={line.budget}
                    onChange={(event) =>
                      setPlantLines((current) =>
                        current.map((entry) =>
                          entry.key === line.key
                            ? { ...entry, budget: event.currentTarget.value }
                            : entry,
                        ),
                      )
                    }
                  />
                  <label>
                    <s-text>Notes (optional)</s-text>
                    <textarea
                      value={line.notes}
                      onChange={(event) =>
                        setPlantLines((current) =>
                          current.map((entry) =>
                            entry.key === line.key
                              ? { ...entry, notes: event.target.value }
                              : entry,
                          ),
                        )
                      }
                      rows={3}
                      style={{
                        display: "block",
                        width: "100%",
                        marginTop: "8px",
                        padding: "8px",
                        borderRadius: "8px",
                        border: "1px solid #c9cccf",
                        font: "inherit",
                        resize: "vertical",
                      }}
                    />
                  </label>
                  {plantLines.length > 1 && (
                    <button
                      type="button"
                      style={buttonStyle}
                      onClick={() =>
                        setPlantLines((current) =>
                          current.length === 1
                            ? current
                            : current.filter((entry) => entry.key !== line.key),
                        )
                      }
                    >
                      Remove plant
                    </button>
                  )}
                </s-stack>
              </s-box>
            ))}
            <input type="hidden" name="itemCount" value={plantLines.length} />
            <button
              type="button"
              style={buttonStyle}
              onClick={() =>
                setPlantLines((current) => [...current, createPlantLine()])
              }
            >
              Add another plant
            </button>
          </s-stack>
        </s-section>

        {(errors?.length ?? 0) > 0 && (
          <s-section>
            <s-banner tone="critical">
              <s-stack direction="block" gap="small">
                {errors?.map((error) => (
                  <s-text key={error}>{error}</s-text>
                ))}
              </s-stack>
            </s-banner>
          </s-section>
        )}

        <s-section>
          <s-button
            variant="primary"
            type="submit"
            {...(navigation.state !== "idle" ? { loading: true } : {})}
          >
            Submit request
          </s-button>
        </s-section>
      </Form>

      <s-section heading="My Requests">
        {myRequests.length === 0 ? (
          <s-text color="subdued">
            You have not submitted any plant requests yet.
          </s-text>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Request Number</s-table-header>
              <s-table-header>Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {myRequests.map((request) => (
                <s-table-row key={request.id}>
                  <s-table-cell>
                    <s-link href={requestDetailHref(request.id)}>
                      {request.requestNumber}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={requestStatusTone(request.status as RequestStatus)}>
                      {formatCustomerStatusLabel(request.status)}
                    </s-badge>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export function OfferExpiryBanner({
  expirationDays,
  expiresAt,
  expiresAtIso,
  urgencyMessage,
  holdMessage,
}: {
  expirationDays: number;
  expiresAt: string;
  expiresAtIso: string;
  urgencyMessage: string;
  holdMessage: string;
}) {
  const remaining = computeTimeRemaining(expiresAtIso);
  return (
    <s-banner tone="warning">
      <s-stack direction="block" gap="small">
        <s-text>
          <strong>Offer expires in {expirationDays} days</strong>
        </s-text>
        <s-text>{urgencyMessage}</s-text>
        <s-text>{holdMessage}</s-text>
        <s-text color="subdued">Expires: {expiresAt}</s-text>
        {remaining ? <s-text color="subdued">{remaining}</s-text> : null}
      </s-stack>
    </s-banner>
  );
}
