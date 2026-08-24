import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import {
  CustomerRequestPortal,
  EMPTY_PLANT_LINE,
} from "../components/customer-request-portal";
import { loadCustomerPortal } from "../lib/customer-portal.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { portal } = await loadCustomerPortal(request);
  return portal;
};

export default function CustomerHome() {
  const portal = useLoaderData<typeof loader>();

  return (
    <CustomerRequestPortal
      loggedIn={portal.loggedIn}
      name={portal.name}
      email={portal.email}
      myRequests={portal.myRequests}
      successMessage={portal.submittedMessage}
      errors={portal.identityError ? [portal.identityError] : undefined}
      showDemoLogin={portal.showDemoLogin}
      loginHref={portal.loginHref}
      requestDetailHref={(requestId) =>
        `${portal.requestDetailBase}/requests/${requestId}`
      }
      formAction={portal.formAction}
      browseAction={portal.browseAction}
      plantLines={portal.plantLines ?? [EMPTY_PLANT_LINE]}
      hasExistingOrder={portal.hasExistingOrder}
      canSubmit={portal.canSubmitRequests}
      customerTimeZone={portal.customerTimeZone}
    />
  );
}
