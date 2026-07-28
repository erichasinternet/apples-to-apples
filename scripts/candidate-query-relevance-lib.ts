const IGNORED_QUERY_TOKENS = new Set(["and", "or", "of", "the"]);

export function normalizeQueryTokens(value: string): string[] {
  return [
    ...new Set(
      (value
        .normalize("NFKD")
        .toLowerCase()
        .match(/[a-z0-9]+/g) ?? [])
        .filter((token) => !IGNORED_QUERY_TOKENS.has(token))
        .map(singularize),
    ),
  ];
}

export function candidateMatchesQuery(text: string, query: string): boolean {
  const queryTokens = normalizeQueryTokens(query);
  if (queryTokens.length === 0) return false;
  const candidateTokens = new Set(normalizeQueryTokens(text));
  return queryTokens.every((token) => candidateTokens.has(token));
}

export function countQueryRelevantCandidates(
  query: string,
  candidateTexts: string[],
): number {
  return candidateTexts.filter((text) => candidateMatchesQuery(text, query))
    .length;
}

function singularize(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }
  if (
    token.length > 4 &&
    /(ches|shes|sses|xes|zes)$/.test(token)
  ) {
    return token.slice(0, -2);
  }
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}
