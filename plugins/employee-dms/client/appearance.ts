import { useMemo } from "react";
import { StyleSheet } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { ConversationState } from "../shared/rooms.js";

export type Colors = PluginTheme["colors"];
export type Conversation = ConversationState["conversations"][number];
export type Employee = ConversationState["employees"][number];

// Employee avatar identities follow the approved conversation mockup in every theme.
export function avatarColor(name: string): string {
  if (name.toLowerCase().includes("supernova")) return "#6a70b8";
  if (name.toLowerCase().includes("jerr")) return "#388068";
  if (name === "You") return "#526e60";
  if (name === "Local agent") return "#665f72";
  const palette = ["#388068", "#368080", "#8f7838", "#75648d"];
  let hash = 0;
  for (const character of name) hash = (hash + character.charCodeAt(0)) % palette.length;
  return palette[hash]!;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length > 1) return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
  const capitals = name.match(/[A-Z]/g);
  if (capitals && capitals.length > 1) return capitals.slice(0, 2).join("");
  return name.slice(0, 1).toUpperCase();
}

export function availability(status: string): string {
  if (status === "running") return "Available";
  if (status === "stopped") return "Offline";
  return status.replaceAll("_", " ");
}

function createStyles(colors: Colors) {
  const small = { color: colors.foregroundMuted, fontSize: 11, lineHeight: 16 };
  const text = { color: colors.foreground, fontSize: 13, lineHeight: 18 };
  return StyleSheet.create({
    screen: { flex: 1, minHeight: 200, backgroundColor: colors.surface0 },
    panes: { flex: 1, flexDirection: "row", minHeight: 0 },
    directory: {
      width: 228,
      borderRightWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
      minHeight: 0,
    },
    compactDirectory: { flex: 1, borderRightWidth: 0, backgroundColor: colors.surface1 },
    directoryHeader: {
      height: 56,
      paddingHorizontal: 16,
      gap: 9,
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    title: { ...text, fontSize: 14, fontWeight: "600" },
    search: {
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 5,
      paddingHorizontal: 9,
      minHeight: 31,
      backgroundColor: colors.surface0,
      marginHorizontal: 13,
      marginTop: 14,
    },
    searchInput: { ...small, flex: 1, minWidth: 0, padding: 0, height: 29 },
    groupHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingLeft: 17,
      paddingRight: 10,
      marginTop: 14,
      marginBottom: 5,
    },
    sectionLabel: { ...small, fontWeight: "500" },
    iconButton: {
      width: 28,
      height: 28,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 5,
    },
    hovered: { backgroundColor: colors.surface2 },
    pressed: { opacity: 0.7 },
    scroll: { flex: 1, minHeight: 0 },
    directoryList: { paddingHorizontal: 9, paddingBottom: 12, gap: 2 },
    row: {
      minHeight: 38,
      paddingHorizontal: 9,
      paddingVertical: 6,
      borderRadius: 5,
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
    },
    selected: { backgroundColor: colors.surface2 },
    rowName: { ...text, flex: 1, minWidth: 0, fontSize: 12, lineHeight: 17 },
    unreadName: { color: colors.foreground, fontWeight: "600" },
    mutedName: { color: colors.foregroundMuted },
    badge: {
      minWidth: 17,
      height: 17,
      paddingHorizontal: 5,
      borderRadius: 9,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accent,
    },
    badgeLabel: { fontSize: 9, lineHeight: 12, fontWeight: "600", color: colors.accentForeground },
    avatar: { alignItems: "center", justifyContent: "center", flexShrink: 0, borderRadius: 6 },
    avatarLetters: { color: "#f4f7f4", fontSize: 10, fontWeight: "500", lineHeight: 14 },
    dot: { height: 6, width: 6, borderRadius: 3, backgroundColor: colors.foregroundMuted },
    availableDot: { backgroundColor: colors.statusSuccess },
    status: { flexDirection: "row", gap: 5, alignItems: "center" },
    small,
    text,
    emptyDirectory: { paddingHorizontal: 9, paddingVertical: 10, gap: 10 },
    quietButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      minHeight: 28,
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: 5,
      borderWidth: 1,
      borderColor: colors.border,
    },
    buttonLabel: { ...small, color: colors.foreground },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      paddingHorizontal: 16,
      paddingVertical: 13,
      borderTopWidth: 1,
      borderColor: colors.border,
    },
    footerLabels: { flex: 1, minWidth: 0 },
    footerName: { ...text, fontSize: 11, lineHeight: 16 },
    footerCaption: { ...small, fontSize: 10, lineHeight: 14 },
    conversation: { flex: 1, minWidth: 0, minHeight: 0 },
    header: {
      minHeight: 56,
      paddingHorizontal: 20,
      paddingVertical: 10,
      flexDirection: "row",
      gap: 10,
      alignItems: "center",
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    headerLabels: { flex: 1, minWidth: 0, gap: 1 },
    headerTitle: { ...text, fontSize: 14, fontWeight: "600" },
    headerCaption: { ...small, fontSize: 10, lineHeight: 14 },
    context: {
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      paddingHorizontal: 20,
      paddingVertical: 9,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    contextText: { ...small, flex: 1, minWidth: 0 },
    transcript: { paddingHorizontal: 22, paddingTop: 20, paddingBottom: 14, gap: 18 },
    dateDivider: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 3 },
    rule: { flex: 1, height: 1, backgroundColor: colors.border },
    date: { ...small, fontSize: 10, lineHeight: 14 },
    intro: { paddingTop: 18, paddingBottom: 24, gap: 12, maxWidth: 520 },
    introTitle: { ...text, fontSize: 18, lineHeight: 24, fontWeight: "600" },
    introText: { ...small, fontSize: 12, lineHeight: 19 },
    message: { flexDirection: "row", gap: 11, alignItems: "flex-start" },
    messageContent: { flex: 1, minWidth: 0, gap: 4, maxWidth: 760 },
    messageMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
    author: { ...text, fontSize: 12, lineHeight: 17, fontWeight: "600" },
    time: { ...small, fontSize: 10, lineHeight: 14 },
    role: { ...small, fontSize: 9, lineHeight: 13 },
    body: { ...text, fontSize: 13, lineHeight: 21 },
    messageActions: { alignSelf: "flex-start", marginTop: 4 },
    activity: {
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      minHeight: 22,
      paddingHorizontal: 22,
    },
    composerFrame: { paddingHorizontal: 20, paddingBottom: 16, paddingTop: 8 },
    composer: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
      borderRadius: 7,
      overflow: "hidden",
    },
    input: {
      ...text,
      fontSize: 13,
      lineHeight: 21,
      minHeight: 72,
      maxHeight: 170,
      padding: 13,
    },
    composerFooter: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 10,
      paddingBottom: 9,
    },
    composerIdentity: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
    send: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minHeight: 29,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 5,
      backgroundColor: colors.accent,
    },
    sendLabel: { fontSize: 11, lineHeight: 16, fontWeight: "500", color: colors.accentForeground },
    disabled: { opacity: 0.4 },
    banner: { padding: 12, gap: 8, borderBottomWidth: 1, borderColor: colors.border },
    danger: { ...small, color: colors.statusDanger },
    warning: { ...small, color: colors.statusWarning, paddingHorizontal: 20, paddingTop: 10 },
    notice: { ...small, padding: 14 },
    pickerBody: { padding: 16, gap: 12 },
    pickerSearch: { marginHorizontal: 0, marginTop: 0 },
    pickerRow: { minHeight: 56, paddingVertical: 9 },
    pickerLabels: { flex: 1, minWidth: 0, gap: 3 },
    pickerName: { ...text, fontSize: 13, lineHeight: 18 },
    dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
    dialogEnd: { borderColor: colors.statusDanger },
    dialogEndLabel: { ...small, color: colors.statusDanger },
    emptyChat: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32, gap: 12 },
    emptyChatText: { ...small, textAlign: "center", maxWidth: 260, fontSize: 12, lineHeight: 19 },
  });
}

export function useStyles(colors: Colors) {
  return useMemo(() => createStyles(colors), [colors]);
}
