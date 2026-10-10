export function newMessageId() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return `m_${Array.from({ length: 16 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("")}`;
}
