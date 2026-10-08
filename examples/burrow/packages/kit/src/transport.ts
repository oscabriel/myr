/** What a request comes back as: its status, and its body as text. */
export interface Reply {
  readonly status: number;
  readonly text: string;
}

/** Sends a GET to a URL. Services use `fetchTransport`; tests pass a fake. */
export type Transport = (url: string) => Promise<Reply>;

/** Where every burrow service's API lives. */
export const API = "https://api.burrow.example";

/** The transport over the runtime's own `fetch`. */
export const fetchTransport: Transport = async (url) => {
  const response = await fetch(url);

  return { status: response.status, text: await response.text() };
};

/** Whether a status is a success (2xx). */
export const isSuccess = (status: number) => status >= 200 && status < 300;
