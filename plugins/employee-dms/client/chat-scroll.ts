import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { Conversation } from "./appearance.js";
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollView } from "react-native";

/** Keep the latest messages visible until the user chooses to read earlier history. */
export function useChatScroll(room: Conversation | undefined, enabled = true) {
  const conversation = enabled ? room?.room : undefined;
  const latestOwnMessage = room?.messages.findLast((message) => message.sender !== "employee")?.id;
  const ref = useRef<ScrollView>(null);
  const following = useRef(true);
  const dimensions = useRef<{ content: number; viewport: number } | null>(null);
  const [showLatest, setShowLatest] = useState(false);
  const followLatest = useCallback(() => {
    following.current = true;
    setShowLatest(false);
    ref.current?.scrollToEnd({ animated: false });
  }, []);
  useLayoutEffect(() => {
    following.current = true;
    dimensions.current = null;
    setShowLatest(false);
    if (conversation) ref.current?.scrollToEnd({ animated: false });
  }, [conversation, latestOwnMessage]);
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!conversation) return;
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const previous = dimensions.current;
      dimensions.current = { content: contentSize.height, viewport: layoutMeasurement.height };
      // Layout changes can emit a scroll event at the old offset before the resize callback.
      // Preserve follow mode through that event; actual scrolling back still releases it.
      if (
        following.current &&
        previous &&
        (previous.content !== contentSize.height || previous.viewport !== layoutMeasurement.height)
      ) {
        ref.current?.scrollToEnd({ animated: false });
        return;
      }
      const nearBottom = contentSize.height - layoutMeasurement.height - contentOffset.y <= 64;
      following.current = nearBottom;
      setShowLatest(!nearBottom);
    },
    [conversation],
  );
  const onResize = useCallback(() => {
    if (conversation && following.current) ref.current?.scrollToEnd({ animated: false });
  }, [conversation]);
  return { ref, onScroll, onResize, followLatest, showLatest: Boolean(conversation) && showLatest };
}
