import { Choice } from "./choice.js";
import { useState, useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { directoryRpc, directoryTargetsRpc } from "../shared/tasks.js";
import type { Target } from "../shared/rooms.js";
import { Action, Avatar } from "./conversations.js";
import { useStyles, type Colors, type Employee } from "./appearance.js";

export interface Recipient {
  employee: string;
  name: string;
  target?: Target;
}
export function Recipients({
  colors,
  host,
  onSelect,
  selected,
  disabled,
}: {
  colors: Colors;
  host: string;
  onSelect: (recipient: Recipient) => void;
  selected?: Recipient;
  disabled?: boolean;
}) {
  const directory = useRpc(directoryRpc);
  const query = useQuery({
    queryKey: ["task-recipients", host],
    queryFn: () => directory({}),
    retry: false,
  });
  const styles = useStyles(colors);
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.directoryList}>
      <Text style={styles.small}>Choose an employee, or expand its teammates.</Text>
      {query.isPending && <Text style={styles.small}>Loading employees…</Text>}
      {query.error && <Text style={styles.danger}>{query.error.message}</Text>}
      {query.data?.employees.map((employee) => (
        <RecipientRow
          key={employee.ai_employee_id}
          {...{ colors, host, employee, onSelect, selected, disabled }}
        />
      ))}
      {query.data?.employees.length === 0 && (
        <Text style={styles.small}>No employees are available in this Genesis account.</Text>
      )}
    </ScrollView>
  );
}
function RecipientRow({
  colors,
  host,
  employee,
  onSelect,
  selected,
  disabled,
}: {
  colors: Colors;
  host: string;
  employee: Employee;
  onSelect: (recipient: Recipient) => void;
  selected?: Recipient;
  disabled?: boolean;
}) {
  const [expanded, expand] = useState(false);
  const targets = useRpc(directoryTargetsRpc);
  const roster = useQuery({
    queryKey: ["task-targets", host, employee.ai_employee_id],
    queryFn: () => targets({ employee: employee.ai_employee_id }),
    enabled: expanded,
    retry: false,
  });
  const styles = useStyles(colors);
  const available = employee.status === "running";
  const chooseEmployee = useCallback(
    () => onSelect({ employee: employee.ai_employee_id, name: employee.name }),
    [onSelect, employee],
  );
  const toggle = useCallback(() => expand((value) => !value), []);
  const employeeStyle = useMemo(
    () => [layoutStyle2, !available && styles.disabled],
    [available, styles],
  );
  const chooseTarget = useCallback(
    (target: Target & { name: string }) =>
      onSelect({
        employee: employee.ai_employee_id,
        name: `${employee.name} / ${target.name}`,
        target: { kind: target.kind, id: target.id },
      }),
    [onSelect, employee],
  );
  return (
    <View>
      <View style={styles.row}>
        <Avatar colors={colors} name={employee.name} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Choose ${employee.name}`}
          disabled={disabled || !available}
          style={employeeStyle}
          onPress={chooseEmployee}
        >
          <Text style={styles.text}>
            {employee.name}
            {selected?.employee === employee.ai_employee_id && !selected.target ? " ✓" : ""}
          </Text>
          <Text style={styles.small}>{available ? "Available" : "Offline"}</Text>
        </Pressable>
        <Action
          colors={colors}
          label={`${expanded ? "Hide" : "Show"} ${employee.name} teammates`}
          icon={expanded ? "ChevronDown" : "ChevronRight"}
          iconOnly
          onPress={toggle}
        />
      </View>
      {expanded && (
        <View style={layoutStyle1}>
          {roster.isPending && <Text style={styles.small}>Loading teammates…</Text>}
          {roster.error && <Text style={styles.small}>{roster.error.message}</Text>}
          {roster.data?.targets.length === 0 && (
            <Text style={styles.small}>No named teammates on this employee.</Text>
          )}
          {roster.data?.targets.map((target) => (
            <Choice
              value={target}
              onChoose={chooseTarget}
              key={`${target.kind}:${target.id}`}
              label={`Choose ${employee.name} / ${target.name}`}
              disabled={disabled || !available || !target.available}
              style={styles.row}
              selectedStyle={styles.selected}
              selected={
                selected?.target?.id === target.id &&
                selected?.target.kind === target.kind &&
                selected.employee === employee.ai_employee_id
              }
            >
              <Avatar colors={colors} name={target.name} size={22} />
              <View style={layoutStyle2}>
                <Text style={styles.text}>{target.name}</Text>
                <Text style={styles.small}>
                  {target.available ? "Available" : target.status} ·{" "}
                  {target.kind === "arm" ? "Persistent agent" : "Teammate"}
                </Text>
              </View>
            </Choice>
          ))}
        </View>
      )}
    </View>
  );
}

const layoutStyle1 = { paddingLeft: 38, paddingBottom: 10, gap: 5 } as const;
const layoutStyle2 = { flex: 1 } as const;
