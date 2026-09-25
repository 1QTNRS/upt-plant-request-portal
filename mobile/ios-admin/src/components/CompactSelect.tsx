import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { THEME } from "../theme";

type Option<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  label: string;
  value: T;
  options: Array<Option<T>>;
  onChange: (value: T) => void;
};

export function CompactSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const selected = options.find((row) => row.value === value)?.label ?? value;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        style={styles.trigger}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected}`}
      >
        <Text style={styles.triggerText}>{selected}</Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            {options.map((option) => (
              <Pressable
                key={option.value}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={[
                  styles.option,
                  option.value === value ? styles.optionActive : null,
                ]}
              >
                <Text
                  style={[
                    styles.optionText,
                    option.value === value ? styles.optionTextActive : null,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minWidth: 100, gap: 4 },
  label: { color: THEME.darkGreen, fontWeight: "700", fontSize: 12 },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.darkGreen,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  triggerText: { color: THEME.darkGreen, fontWeight: "600", flex: 1 },
  chevron: { color: THEME.darkGreen, fontWeight: "700", marginLeft: 6 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 41, 16, 0.35)",
    justifyContent: "center",
    padding: 24,
  },
  sheet: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.darkGreen,
    overflow: "hidden",
  },
  option: { paddingHorizontal: 14, paddingVertical: 12 },
  optionActive: { backgroundColor: THEME.darkGreen },
  optionText: { color: THEME.darkGreen, fontWeight: "600" },
  optionTextActive: { color: THEME.yellow },
});
