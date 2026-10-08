/** What Vite gives these tests to read a committed `.env.schema` as text: a `?raw` import. */
declare module "*?raw" {
  const text: string;
  export default text;
}
