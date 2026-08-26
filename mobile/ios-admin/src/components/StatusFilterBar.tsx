import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  STATUS_FILTERS,
  type StatusFilterValue,
} from "../request-filters";
import { THEME } from "../theme";

type Props = {
  selected: string;
  counts: Record<StatusFilterValue, number>;
  onSelect: (value: StatusFilterValue) => void;
};

export function StatusFilterBar({ selected, counts, onSelect }: Props) {
  return (
    <View style={styles.row}>
      {STATUS_FILTERS.map((filter) => {
        const on = selected === filter.value;
        return (
          <Pressable
            key={filter.value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.chip, on && styles.chipOn]}
            onPress={() => onSelect(filter.value)}
          >
            <Text style={[styles.name, on && styles.nameOn]}>{filter.label}</Text>
            <Text style={[styles.count, on && styles.countOn]}>{counts[filter.value]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: {
    minWidth: 72,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.line,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: THEME.white,
    alignItems: "center",
  },
  chipOn: { backgroundColor: THEME.darkGreen, borderColor: THEME.darkGreen },
  name: { color: THEME.darkGreen, fontWeight: "700", fontSize: 13 },
  nameOn: { color: THEME.white },
  count: { color: THEME.muted, fontWeight: "700", fontSize: 16, marginTop: 2 },
  countOn: { color: THEME.white },
});
