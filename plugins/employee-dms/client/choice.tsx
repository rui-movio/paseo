import { useCallback, useMemo, type ReactNode } from "react";
import { Pressable, type StyleProp, type ViewStyle } from "react-native";
export function Choice<T>({
  value,
  onChoose,
  label,
  selected,
  disabled,
  style,
  selectedStyle,
  children,
  role = "button",
}: {
  value: T;
  onChoose: (value: T) => void;
  label: string;
  selected?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  selectedStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
  role?: "button" | "radio";
}) {
  const press = useCallback(() => onChoose(value), [onChoose, value]);
  const appearance = useMemo(
    () => [style, selected && selectedStyle, disabled && dimmed],
    [style, selected, selectedStyle, disabled],
  );
  const state = useMemo(
    () => ({ selected, disabled, ...(role === "radio" ? { checked: selected } : {}) }),
    [selected, disabled, role],
  );
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={state}
      onPress={press}
      disabled={disabled}
      style={appearance}
    >
      {children}
    </Pressable>
  );
}
const dimmed = { opacity: 0.45 };
