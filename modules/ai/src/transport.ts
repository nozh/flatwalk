export type HttpRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

export type SleepFn = (ms: number) => Promise<void>;

export const defaultSleep: SleepFn = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function headerMap(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

export const fetchTransport: HttpTransport = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
  });
  const body = await response.text();
  return {
    status: response.status,
    headers: headerMap(response.headers),
    body,
  };
};
