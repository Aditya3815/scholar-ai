/** The recorded answers of OpenAlex in fixtures/ are read as text with Vite's `?raw` import, like the XML fixtures of src/oa (the API has no Node types). */
declare module "*.json?raw" {
  const text: string;
  export default text;
}
