import { createLogger } from "@jeanbot/logger";
import type { ResearchCitation, ServiceHealth } from "@jeanbot/types";

export class SearchService {
  private readonly logger = createLogger("search-service");

  async search(query: string): Promise<ResearchCitation[]> {
    this.logger.info("Executing synthetic search", { query });

    return [1, 2, 3].map((index) => ({
      title: `Synthetic search result ${index} for "${query}"`,
      url: `https://example.com/search/${index}?q=${encodeURIComponent(query)}`,
      snippet: `JeanBot placeholder result ${index} related to ${query}.`
    }));
  }

  health(): ServiceHealth {
    return {
      name: "search-service",
      ok: true,
      details: {
        mode: "synthetic"
      }
    };
  }
}
