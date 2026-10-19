export type WebProvider = "auto" | "fallback" | "exa-mcp" | "brave" | "tavily" | "exa-api";
type ApiProvider = "brave" | "tavily" | "exa-api";
export interface WebInput {
  action: "search" | "read";
  query?: string;
  objective?: string;
  urls?: string[];
  provider?: WebProvider;
}
export interface WebAnswer { provider: string; text: string; credits?: number; }
export interface WebDeps {
  keys: { brave?: string; tavily?: string; exa?: string };
  mcp: (action: string, input: Record<string, unknown>, signal?: AbortSignal) => Promise<any>;
  post: (url: string, key: string, body: object, signal?: AbortSignal) => Promise<any>;
  progress?: (provider: string) => void;
}

const textOf = (result: any): string => (result?.content ?? [])
  .filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");

function checkAbort(signal?: AbortSignal) { signal?.throwIfAborted(); }
function requireKey(value: string | undefined, provider: string): string {
  if (!value) throw new Error(`${provider} key is not configured. Open ~/.pi/agent/customization/Pi-Maintenance.bat and choose 3 (Search API Key).`);
  return value;
}

const braveQueryFits = (query = "") => query.length <= 600 && query.trim().split(/\s+/).length <= 75;
function usableResults(results: any): any[] {
  if (!Array.isArray(results)) return [];
  return results.filter(r => {
    try {
      const url = new URL(r?.url);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && Boolean(r.title || r.description || r.content || r.raw_content || r.text);
    } catch { return false; }
  }).slice(0, 5);
}

/** Local routing only: no classifier model, extra MCP, concurrent requests, or billing API. */
export function fallbackOrder(input: WebInput, keys: WebDeps["keys"]): ApiProvider[] {
  const text = `${input.query || ""} ${input.objective || ""}`;
  const timely = /今天|昨日|最新|实时|新闻|近况|\b(?:news|today|latest|current|breaking)\b|site:|官方文档|\b(?:official docs|error message|stack trace)\b/i.test(text);
  const semantic = /论文|学术|语义|相似(?:页面|文章)|\b(?:arxiv|papers?|scholarly|semantic|similar pages?)\b/i.test(text);
  const synthesis = /对比|比较|综述|调研|综合|多(?:个)?来源|\b(?:compar(?:e|ison)|overview|research|survey|synthesis)\b/i.test(text);
  let order: ApiProvider[] = input.action === "read" ? ["tavily", "exa-api"]
    : timely ? ["brave", "tavily", "exa-api"]
    : semantic ? ["exa-api", "tavily", "brave"]
    : synthesis ? ["tavily", "brave", "exa-api"]
    : ["brave", "tavily", "exa-api"];
  // A relevance retry should prefer an index independent of the initial Exa result.
  if (input.provider === "fallback") order = [...order.filter(p => p !== "exa-api"), "exa-api"];
  return order.filter(p => Boolean(keys[p === "exa-api" ? "exa" : p]) && (p !== "brave" || braveQueryFits(input.query)));
}

function failureReason(error: unknown, keys: WebDeps["keys"]): string {
  let reason = error instanceof Error ? error.message : "request failed";
  for (const value of Object.values(keys)) if (value) reason = reason.split(value).join("[redacted]");
  return reason.replace(/(?:Authorization|X-Subscription-Token|x-api-key)\s*[:=]\s*\S+/gi, "[redacted header]").slice(0, 240);
}

export async function runWeb(input: WebInput, deps: WebDeps, signal?: AbortSignal): Promise<WebAnswer> {
  checkAbort(signal);
  if (input.action === "search" && !input.query?.trim()) throw new Error("A search query is required.");
  if (input.action === "read") {
    if (!input.urls?.length || input.urls.length > 3) throw new Error("Provide 1 to 3 URLs.");
    for (const value of input.urls) {
      const url = new URL(value);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Use public HTTP(S) URLs without embedded credentials.");
    }
  }
  const selected = input.provider ?? "auto";
  if (selected === "brave" && input.action === "read") throw new Error("Brave is search-only. Use auto, exa-mcp, tavily, or exa-api to read URLs.");
  if (selected === "brave" && !braveQueryFits(input.query)) throw new Error("Brave search supports at most 600 characters and 75 words. Shorten the query or use auto.");
  const providers: WebProvider[] = selected === "auto"
    ? ["exa-mcp", ...fallbackOrder(input, deps.keys)]
    : selected === "fallback" ? fallbackOrder(input, deps.keys) : [selected];
  const failures: string[] = [];
  for (const provider of providers) {
    checkAbort(signal);
    deps.progress?.(provider);
    try {
      let answer: WebAnswer;
      if (provider === "exa-mcp") {
        const params = input.action === "search"
          ? { query: input.query!.trim(), objective: input.objective || `Find reliable primary sources that answer: ${input.query}`, numResults: 5 }
          : { urls: input.urls, maxCharacters: 6000 };
        const result = await deps.mcp(input.action, params, signal);
        const text = textOf(result).trim();
        if (result?.isError || !text || /^(?:No (?:search )?results found|You.ve hit Exa.s free MCP rate limit)/i.test(text)
          || (input.action === "search" && !/https?:\/\/[^\s<>"]+/i.test(text))) {
          throw new Error("Exa MCP returned an error, rate limit, or no results.");
        }
        answer = { provider, text };
      } else if (provider === "brave") {
        const key = requireKey(deps.keys.brave, "Brave");
        const data = await deps.post("https://api.search.brave.com/res/v1/web/search", key, {
          q: input.query!.trim(), count: 5, extra_snippets: true, text_decorations: false,
        }, signal);
        const rows = usableResults(data.web?.results);
        if (!rows.length || data.query?.bad_results === true) throw new Error("Brave returned no usable results or marked them low quality.");
        answer = { provider, text: rows.map((r: any) => `${r.title || r.url}\n${r.url}\n${[r.description, ...(Array.isArray(r.extra_snippets) ? r.extra_snippets : [])].filter(s => typeof s === "string").join("\n").slice(0, 6000)}`).join("\n\n") };
      } else if (provider === "tavily") {
        const key = requireKey(deps.keys.tavily, "Tavily");
        const body = input.action === "search"
          ? { query: input.query, search_depth: "basic", max_results: 5, include_answer: false, include_raw_content: false, auto_parameters: false, include_usage: true }
          : { urls: input.urls, extract_depth: "basic", format: "markdown", include_usage: true };
        const data = await deps.post(`https://api.tavily.com/${input.action === "search" ? "search" : "extract"}`, key, body, signal);
        const rows = usableResults(data.results);
        if (!rows.length) throw new Error("Tavily returned no usable results.");
        answer = {
          provider,
          credits: data.usage?.credits,
          text: rows.map((r: any) => `${r.title || r.url}\n${r.url}\n${String(r.content || r.raw_content || "").slice(0, 6000)}`).join("\n\n"),
        };
      } else {
        const key = requireKey(deps.keys.exa, "Exa API");
        const body = input.action === "search"
          ? { query: input.query, type: "auto", numResults: 5, contents: { text: { maxCharacters: 2000 } } }
          : { ids: input.urls, text: { maxCharacters: 6000 } };
        const data = await deps.post(`https://api.exa.ai/${input.action === "search" ? "search" : "contents"}`, key, body, signal);
        const rows = usableResults(data.results);
        if (!rows.length) throw new Error("Exa API returned no usable results.");
        answer = { provider, text: rows.map((r: any) => `${r.title || r.url}\n${r.url}\n${String(r.text || "").slice(0, 6000)}`).join("\n\n") };
      }
      const reason = failures.length ? `\nFallback: ${failures.join("; ")}` : "";
      return { ...answer, text: `[Source: ${provider}${answer.credits !== undefined ? `; API credits: ${answer.credits}` : ""}]${reason}\n\n${answer.text.slice(0, 24000)}` };
    } catch (error) {
      checkAbort(signal);
      // Never include upstream response bodies or request headers in errors.
      failures.push(`${provider}: ${failureReason(error, deps.keys)}`);
    }
  }
  const setup = !deps.keys.brave && !deps.keys.tavily && !deps.keys.exa ? " Open ~/.pi/agent/customization/Pi-Maintenance.bat, option 3, to configure Brave, Tavily, or Exa API fallback." : "";
  throw new Error(`Web lookup failed. ${failures.join("; ")}.${setup}`);
}
