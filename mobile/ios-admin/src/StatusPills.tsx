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
    return { backgroundColor: THEME.white, color: THEME.darkGreen, borderColor: THEME.yellow };
  }
  // New sits on the mint request page — white keeps the pill readable.
  return { backgroundColor: THEME.white, color: THEME.darkGreen, borderColor: THEME.line };
}

export function StatusPills({
  status,
  hasExistingOrder,
}: {
  status: string;
  hasExistingOrder?: boolean;
}) {
  const statusColors = pillColors(status);
  const existingColors =
    status === "Closed"
      ? { backgroundColor: THEME.darkGreen, color: THEME.white, borderColor: THEME.darkGreen }
      : { backgroundColor: THEME.yellow, color: THEME.darkGreen, borderColor: THEME.yellow };

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
