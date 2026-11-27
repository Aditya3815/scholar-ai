/**
 * Answers written before the writer was told to use plain text (and any a model still dresses in markdown) showed their asterisks and backticks on the page: "**Bias** tab hota hai ...".
 * The page draws these answers as plain paragraphs, so the marks are taken out here and the words are left as they are.
 */
export function unmark(text: string): string {
  return text
    .replace(/```[a-z]*\n?([\s\S]*?)```/g, "$1")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/(^|[\s(])\*(?=\S)([^*\n]*?\S)\*(?=$|[\s).,;:!?])/g, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "");
}
