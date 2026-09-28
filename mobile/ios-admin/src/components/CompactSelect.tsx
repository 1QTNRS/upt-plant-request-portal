import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { THEME } from "../theme";

type Option<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  label: string;
  value: T;
  options: Array<Option<T>>;
  onChange: (value: T) => void;
  /** When true, uses tighter padding and a lighter border (Propagation Planning filters). */
  compact?: boolean;
};

export function CompactSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  compact = false,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const selected = options.find((row) => row.value === value)?.label ?? value;

  return (
    <View style={[styles.wrap, compact ? styles.wrapCompact : null]}>
      <Text style={[styles.label, compact ? styles.labelCompact : null]}>{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.trigger, compact ? styles.triggerCompact : null]}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected}`}
      >
        <Text style={styles.triggerText} numberOfLines={1}>
          {selected}
        </Text>
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

const BORDER = "rgba(0, 41, 16, 0.28)";

const styles = StyleSheet.create({
  wrap: { flex: 1, minWidth: 100, gap: 4 },
  wrapCompact: { gap: 2 },
  label: { color: THEME.darkGreen, fontWeight: "700", fontSize: 12 },
  labelCompact: { fontSize: 11, fontWeight: "600", opacity: 0.85 },
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
  triggerCompact: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    paddingHorizontal: 9,
    paddingVertical: 7,
    minHeight: 36,
  },
  triggerText: { color: THEME.darkGreen, fontWeight: "600", flex: 1, fontSize: 14 },
  chevron: { color: THEME.darkGreen, fontWeight: "600", marginLeft: 4, fontSize: 12, opacity: 0.7 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 41, 16, 0.35)",
    justifyContent: "center",
    padding: 24,
  },
  sheet: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    overflow: "hidden",
  },
  option: { paddingHorizontal: 14, paddingVertical: 12 },
  optionActive: { backgroundColor: THEME.darkGreen },
  optionText: { color: THEME.darkGreen, fontWeight: "600" },
  optionTextActive: { color: THEME.yellow },
});
