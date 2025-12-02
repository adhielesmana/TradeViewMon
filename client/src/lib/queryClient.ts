import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

function buildUrl(queryKey: readonly unknown[]): string {
  const pathSegments: string[] = [];
  const params: Record<string, string | string[]> = {};

  for (const segment of queryKey) {
    if (typeof segment === "string") {
      pathSegments.push(segment);
    } else if (typeof segment === "number") {
      pathSegments.push(String(segment));
    } else if (typeof segment === "object" && segment !== null) {
      for (const [key, value] of Object.entries(segment)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          params[key] = value.map(String);
        } else {
          params[key] = String(value);
        }
      }
    }
  }

  let url = pathSegments.length > 0 ? pathSegments[0] : "";
  for (let i = 1; i < pathSegments.length; i++) {
    const seg = pathSegments[i];
    if (seg.startsWith("/")) {
      url += seg;
    } else {
      url += "/" + seg;
    }
  }

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        searchParams.append(key, v);
      }
    } else {
      searchParams.append(key, value);
    }
  }

  const queryString = searchParams.toString();
  if (queryString) {
    url += (url.includes("?") ? "&" : "?") + queryString;
  }

  return url;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = buildUrl(queryKey);
    const res = await fetch(url, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
