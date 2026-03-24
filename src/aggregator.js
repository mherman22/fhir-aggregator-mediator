'use strict';

const logger = console;
const url = require('url');

/**
 * Extract _getpages token from a FHIR Bundle's next link.
 * OpenMRS format: http://host/openmrs/ws/fhir2/R4?_getpages=xxx&_getpagesoffset=20&_count=20
 */
function extractGetpagesToken(nextUrl) {
  if (!nextUrl) return null;
  const parsed = new URL(nextUrl);
  return parsed.searchParams.get('_getpages');
}

function deduplicate(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    if (!entry.resource || !entry.resource.id) return true;
    const key = `${entry.resource.resourceType}/${entry.resource.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Initial search: fan out to all sources, collect results and _getpages tokens.
 * Returns merged entries + per-source pagination tokens for offset-based access.
 */
async function searchAll(path, queryParams, sources, fhirClient) {
  const promises = sources.map((source) =>
    fhirClient
      .search(source, path, queryParams)
      .catch((err) => {
        logger.error(
          `[aggregator] Source ${source.id} (${source.name}) failed: ${err.message}`
        );
        return null;
      })
  );

  const results = await Promise.all(promises);

  const entries = [];
  let totalCount = 0;
  const sourceTokens = {};

  for (let i = 0; i < results.length; i++) {
    const bundle = results[i];
    if (!bundle) continue;

    const source = sources[i];
    entries.push(...(bundle.entry || []));
    totalCount += bundle.total || (bundle.entry || []).length;

    // Extract _getpages token from the next link for offset-based access
    const nextLink = (bundle.link || []).find((l) => l.relation === 'next');
    if (nextLink) {
      const token = extractGetpagesToken(nextLink.url);
      if (token) {
        sourceTokens[source.id] = {
          token: token,
          baseUrl: source.baseUrl,
        };
      }
    }
  }

  const dedupedEntries = deduplicate(entries);

  // Use deduped count as total when all results fit in one page,
  // otherwise keep the raw total for pagination segment calculation
  const hasMore = Object.keys(sourceTokens).length > 0;
  const adjustedTotal = hasMore ? totalCount : dedupedEntries.length;

  return {
    entries: dedupedEntries,
    totalCount: adjustedTotal,
    sourceTokens,
    hasMore,
  };
}

/**
 * Offset-based fetch: fhir-data-pipes constructs URLs like
 *   ?_getpages=<aggregator-token>&_getpagesoffset=N&_count=M
 *
 * We forward the same offset and count to each source using their stored _getpages tokens.
 */
async function fetchWithOffset(state, offset, count, sources, fhirClient) {
  const activeSources = sources.filter((s) => state[s.id]);
  const promises = activeSources.map((source) => {
    const sourceInfo = state[source.id];
    const fetchUrl =
      `${sourceInfo.baseUrl}?_getpages=${sourceInfo.token}` +
      `&_getpagesoffset=${offset}` +
      `&_count=${count}`;

    return fhirClient
      .fetchUrl(source, fetchUrl)
      .catch((err) => {
        logger.error(
          `[aggregator] Offset fetch from ${source.id} failed: ${err.message}`
        );
        return null;
      });
  });

  const results = await Promise.all(promises);

  const entries = [];
  for (const bundle of results) {
    if (!bundle) continue;
    entries.push(...(bundle.entry || []));
  }

  return { entries: deduplicate(entries) };
}

module.exports = { searchAll, fetchWithOffset };
