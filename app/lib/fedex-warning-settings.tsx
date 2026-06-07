import { createContext, useContext, useMemo, useState } from "react";

export const DEFAULT_FEDEX_REMOVAL_WARNING =
  "Removing the FedEx Priority Overnight upgrade means this order will ship via standard USPS Priority. UPT only covers orders upgraded to FedEx Priority Overnight. Orders without this upgrade are not covered for carrier delays, weather damage, transit damage, lost packages, or other shipping-related issues.";

type FedexWarningSettings = {
  fedexRemovalWarning: string;
  setFedexRemovalWarning: (message: string) => void;
  resetFedexRemovalWarning: () => void;
};

const FedexWarningSettingsContext = createContext<FedexWarningSettings | null>(
  null,
);

export function useFedexWarningSettings() {
  const value = useContext(FedexWarningSettingsContext);
  if (!value) {
    throw new Error(
      "useFedexWarningSettings must be used within FedexWarningSettingsProvider",
    );
  }
  return value;
}

export function FedexWarningSettingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [fedexRemovalWarning, setFedexRemovalWarning] = useState(
    DEFAULT_FEDEX_REMOVAL_WARNING,
  );

  const value = useMemo(
    () => ({
      fedexRemovalWarning,
      setFedexRemovalWarning: (message: string) => {
        const trimmed = message.trim();
        setFedexRemovalWarning(trimmed || DEFAULT_FEDEX_REMOVAL_WARNING);
      },
      resetFedexRemovalWarning: () =>
        setFedexRemovalWarning(DEFAULT_FEDEX_REMOVAL_WARNING),
    }),
    [fedexRemovalWarning],
  );

  return (
    <FedexWarningSettingsContext.Provider value={value}>
      {children}
    </FedexWarningSettingsContext.Provider>
  );
}
