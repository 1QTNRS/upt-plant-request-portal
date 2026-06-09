import { useEffect, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  getPrototypeCustomerProfile,
  isCustomerLoggedInPrototype,
  PROTOTYPE_CUSTOMER_PROFILE,
  setCustomerLoggedInPrototype,
  submitCustomerRequest,
} from "../lib/customer-request-submissions";
import { hydrateCustomerOfferResponses } from "../lib/customer-offer-responses";
import { LOCAL_STATE_CHANGED_EVENT } from "../lib/local-state-events";
import {
  getCustomerMyRequests,
  type CustomerMyRequestRow,
  type RequestStatus,
} from "../lib/sample-requests";

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

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getInitialLoginState(): boolean {
  if (typeof window === "undefined") return false;
  return isCustomerLoggedInPrototype();
}

function getInitialCustomerFields(): { name: string; email: string } {
  if (typeof window === "undefined" || !isCustomerLoggedInPrototype()) {
    return { name: "", email: "" };
  }

  return getPrototypeCustomerProfile();
}

function loadMyRequests(email: string): CustomerMyRequestRow[] {
  hydrateCustomerOfferResponses();
  return getCustomerMyRequests(email);
}

function customerStatusTone(
  status: RequestStatus,
): "info" | "warning" | "caution" | "success" | "critical" {
  switch (status) {
    case "New":
      return "info";
    case "Pending":
      return "caution";
    case "Closed":
      return "success";
    case "Expired":
      return "critical";
  }
}

function formatCustomerStatusLabel(status: RequestStatus): string {
  if (status === "Pending") return "Needs Payment";
  return status;
}

function customerOfferHref(requestId: string): string {
  return `/app/customer-offer-preview?requestId=${requestId}`;
}

const prototypeButtonStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: "8px",
  border: "1px solid #c9cccf",
  font: "inherit",
  cursor: "pointer",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function CustomerRequestForm() {
  const initialCustomer = getInitialCustomerFields();
  const [loggedIn, setLoggedIn] = useState(getInitialLoginState);
  const [name, setName] = useState(initialCustomer.name);
  const [email, setEmail] = useState(initialCustomer.email);
  const [plantLines, setPlantLines] = useState<PlantLine[]>([createPlantLine()]);
  const [errors, setErrors] = useState<string[]>([]);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [myRequests, setMyRequests] = useState<CustomerMyRequestRow[]>(() =>
    loggedIn ? loadMyRequests(initialCustomer.email) : [],
  );

  const refreshMyRequests = (customerEmail: string) => {
    setMyRequests(loadMyRequests(customerEmail));
  };

  useEffect(() => {
    if (!loggedIn) return;

    const handleRefresh = () => {
      refreshMyRequests(email || getPrototypeCustomerProfile().email);
    };

    handleRefresh();
    window.addEventListener("focus", handleRefresh);
    window.addEventListener(LOCAL_STATE_CHANGED_EVENT, handleRefresh);
    return () => {
      window.removeEventListener("focus", handleRefresh);
      window.removeEventListener(LOCAL_STATE_CHANGED_EVENT, handleRefresh);
    };
  }, [loggedIn, email]);

  const handleContinueAsLoggedIn = () => {
    setCustomerLoggedInPrototype(true);
    setLoggedIn(true);
    setName(PROTOTYPE_CUSTOMER_PROFILE.name);
    setEmail(PROTOTYPE_CUSTOMER_PROFILE.email);
    setErrors([]);
    setSuccessMessage(null);
    refreshMyRequests(PROTOTYPE_CUSTOMER_PROFILE.email);
  };

  const handleAddPlant = () => {
    setPlantLines((current) => [...current, createPlantLine()]);
  };

  const handleRemovePlant = (key: string) => {
    setPlantLines((current) => {
      if (current.length === 1) return current;
      return current.filter((line) => line.key !== key);
    });
  };

  const updatePlantLine = (
    key: string,
    field: keyof Omit<PlantLine, "key">,
    value: string,
  ) => {
    setPlantLines((current) =>
      current.map((line) =>
        line.key === key ? { ...line, [field]: value } : line,
      ),
    );
  };

  const handleSubmit = () => {
    const nextErrors: string[] = [];

    if (!name.trim()) {
      nextErrors.push("Name is required.");
    }

    if (!email.trim()) {
      nextErrors.push("Email is required.");
    } else if (!isValidEmail(email.trim())) {
      nextErrors.push("Enter a valid email address.");
    }

    const validPlantLines = plantLines.filter((line) => line.plantName.trim());

    if (validPlantLines.length === 0) {
      nextErrors.push("Add at least one plant with a name.");
    }

    if (plantLines.some((line) => !line.plantName.trim())) {
      nextErrors.push("Each plant row needs a plant name or should be removed.");
    }

    if (nextErrors.length > 0) {
      setErrors(nextErrors);
      return;
    }

    const result = submitCustomerRequest({
      name: name.trim(),
      email: email.trim(),
      items: validPlantLines.map((line) => ({
        plantName: line.plantName.trim(),
        budget: line.budget.trim() || undefined,
        notes: line.notes.trim() || undefined,
      })),
    });

    setErrors([]);
    setSuccessMessage(
      `Request submitted. Your request number is ${result.requestNumber}. We'll notify you when matching plants become available.`,
    );
    setPlantLines([createPlantLine()]);
    refreshMyRequests(email.trim());
  };

  if (!loggedIn) {
    return (
      <s-page heading="Customer Request Form">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-text>
              Please log in or create an account to submit a plant request.
            </s-text>
            <s-stack direction="inline" gap="base">
              <button
                type="button"
                style={{
                  ...prototypeButtonStyle,
                  backgroundColor: "#008060",
                  color: "#ffffff",
                  borderColor: "#008060",
                }}
              >
                Log In
              </button>
              <button
                type="button"
                style={{
                  ...prototypeButtonStyle,
                  backgroundColor: "#ffffff",
                }}
              >
                Create Account
              </button>
              <button
                type="button"
                style={{
                  ...prototypeButtonStyle,
                  backgroundColor: "transparent",
                }}
                onClick={handleContinueAsLoggedIn}
              >
                Continue as logged in customer
              </button>
            </s-stack>
            <s-text color="subdued">
              Prototype only: Log In and Create Account are placeholders. Use
              Continue as logged in customer to test the form.
            </s-text>
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
            Prototype form using local browser state. Submitted requests appear
            on the admin dashboard for testing.
          </s-text>
          <s-text-field
            label="Name"
            value={name}
            required
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <s-text-field
            label="Email"
            value={email}
            required
            onChange={(e) => setEmail(e.currentTarget.value)}
          />
        </s-stack>
      </s-section>

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
                <s-text-field
                  label="Plant Name"
                  value={line.plantName}
                  required
                  onChange={(e) =>
                    updatePlantLine(line.key, "plantName", e.currentTarget.value)
                  }
                />
                <s-text-field
                  label="Budget (optional)"
                  value={line.budget}
                  onChange={(e) =>
                    updatePlantLine(line.key, "budget", e.currentTarget.value)
                  }
                />
                <label>
                  <s-text>Notes (optional)</s-text>
                  <textarea
                    value={line.notes}
                    onChange={(e) =>
                      updatePlantLine(line.key, "notes", e.target.value)
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
                    style={prototypeButtonStyle}
                    onClick={() => handleRemovePlant(line.key)}
                  >
                    Remove plant
                  </button>
                )}
              </s-stack>
            </s-box>
          ))}

          <button type="button" style={prototypeButtonStyle} onClick={handleAddPlant}>
            Add another plant
          </button>
        </s-stack>
      </s-section>

      {errors.length > 0 && (
        <s-section>
          <s-banner tone="critical">
            <s-stack direction="block" gap="small">
              {errors.map((error) => (
                <s-text key={error}>{error}</s-text>
              ))}
            </s-stack>
          </s-banner>
        </s-section>
      )}

      <s-section>
        <button
          type="button"
          style={{
            ...prototypeButtonStyle,
            backgroundColor: "#008060",
            color: "#ffffff",
            borderColor: "#008060",
          }}
          onClick={handleSubmit}
        >
          Submit request
        </button>
      </s-section>

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
                    <s-link href={customerOfferHref(request.id)}>
                      {request.requestNumber}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={customerStatusTone(request.status)}>
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

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
