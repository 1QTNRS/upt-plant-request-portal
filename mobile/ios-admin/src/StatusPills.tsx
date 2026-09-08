import { StyleSheet, Text, View } from "react-native";

import { THEME } from "./theme";

function pillColors(status: string) {
  if (status === "Closed") {
    return { backgroundColor: THEME.darkGreen, color: THEME.white, borderColor: THEME.darkGreen };
  }
  if (status === "Pending") {
    return { backgroundColor: THEME.yellow, color: THEME.darkGreen, borderColor: THEME.yellow };
  }
  if (status === "Expired") {
    return {
      backgroundColor: THEME.white,
      color: THEME.expiredRed,
      borderColor: THEME.expiredRed,
    };
  }
  return { backgroundColor: THEME.mint, color: THEME.darkGreen, borderColor: THEME.mint };
}

export function ExistingOrderPill({ status }: { status?: string }) {
  const existingColors =
    status === "Closed"
      ? { backgroundColor: THEME.darkGreen, color: THEME.white, borderColor: THEME.darkGreen }
      : { backgroundColor: THEME.yellow, color: THEME.darkGreen, borderColor: THEME.yellow };

  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: existingColors.backgroundColor,
          borderColor: existingColors.borderColor,
        },
      ]}
    >
      <Text style={[styles.label, { color: existingColors.color }]}>Existing Order</Text>
    </View>
  );
}

export function StatusPills({
  status,
  hasExistingOrder,
  isPurchased,
  hasResponded,
}: {
  status: string;
  hasExistingOrder?: boolean;
  isPurchased?: boolean;
  hasResponded?: boolean;
}) {
  const statusColors = pillColors(status);
  const existingColors =
    status === "Closed"
      ? { backgroundColor: THEME.darkGreen, color: THEME.white, borderColor: THEME.darkGreen }
      : { backgroundColor: THEME.yellow, color: THEME.darkGreen, borderColor: THEME.yellow };
  const purchasedColors = {
    backgroundColor: THEME.yellow,
    color: THEME.darkGreen,
    borderColor: THEME.yellow,
  };
  const answeredColors = {
    backgroundColor: THEME.mint,
    color: THEME.darkGreen,
    borderColor: THEME.darkGreen,
  };

  return (
    <View style={styles.row}>
      <View
        style={[
          styles.pill,
          {
            backgroundColor: statusColors.backgroundColor,
            borderColor: statusColors.borderColor,
          },
        ]}
      >
        <Text style={[styles.label, { color: statusColors.color }]}>{status}</Text>
      </View>
      {status === "Pending" && hasResponded ? (
        <View
          style={[
            styles.pill,
            {
              backgroundColor: answeredColors.backgroundColor,
              borderColor: answeredColors.borderColor,
            },
          ]}
        >
          <Text style={[styles.label, { color: answeredColors.color }]}>Answered</Text>
        </View>
      ) : null}
      {isPurchased ? (
        <View
          style={[
            styles.pill,
            {
              backgroundColor: purchasedColors.backgroundColor,
              borderColor: purchasedColors.borderColor,
            },
          ]}
        >
          <Text style={[styles.label, { color: purchasedColors.color }]}>Purchased</Text>
        </View>
      ) : null}
      {hasExistingOrder ? (
        <View
          style={[
            styles.pill,
            {
              backgroundColor: existingColors.backgroundColor,
              borderColor: existingColors.borderColor,
            },
          ]}
        >
          <Text style={[styles.label, { color: existingColors.color }]}>Existing Order</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  label: { fontSize: 12, fontWeight: "700" },
});
