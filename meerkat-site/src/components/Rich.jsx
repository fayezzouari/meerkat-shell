// Renders `backtick` spans in the content strings as inline code, so copy stays
// plain text in src/data/content.js.
export default function Rich({ text }) {
  const parts = text.split("`");
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <code key={i}>{part}</code> : <span key={i}>{part}</span>,
      )}
    </>
  );
}
