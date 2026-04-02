'use strict';

const logger = console;

function extractGetpagesToken(nextUrl) {
  if (!nextUrl) return null;
  try {
    const parsed = new URL(nextUrl);
    return parsed.searchParams.get('_getpages');
  } catch {
    logger.error(`[aggregator] Failed to parse next-link URL: ${nextUrl}`);
    return null;
  }
}

async function searchAll(path, queryParams, sources, fhirClient, sourceMonitor) {
  const promises = sources.map((source) =>
    fhirClient
      .search(source, path, queryParams)
      .then((result) => {
        if (sourceMonitor) sourceMonitor.recordSuccess(source.id);
        return result;
      })
      .catch((err) => {
        if (sourceMonitor) sourceMonitor.recordFailure(source.id, err);
        logger.error(`[aggregator] Source ${source.id} (${source.name}) failed: ${err.message}`);
        return null;
      })
  );

  const results = await Promise.all(promises);

  const entries = [];
  let totalCount = 0;
  const sourceTokens = {};
  const failedSources = [];

  for (let i = 0; i < results.length; i++) {
    const bundle = results[i];
    const source = sources[i];

    if (!bundle) {
      failedSources.push(source.id);
      continue;
    }

    entries.push(...(bundle.entry || []));
    totalCount += bundle.total || (bundle.entry || []).length;

    const links = Array.isArray(bundle.link) ? bundle.link : [];
    const nextLink = links.find((l) => l.relation === 'next');
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

  const hasMore = Object.keys(sourceTokens).length > 0;

  return {
    entries,
    totalCount,
    sourceTokens,
    hasMore,
    failedSources,
  };
}

async function fetchWithOffset(state, offset, count, sources, fhirClient, sourceMonitor) {
  const activeSources = sources.filter((s) => state[s.id]);
  const failedSources = [];

  const promises = activeSources.map((source) => {
    const sourceInfo = state[source.id];
    const fetchUrl =
      `${sourceInfo.baseUrl}?_getpages=${sourceInfo.token}` +
      `&_getpagesoffset=${offset}` +
      `&_count=${count}`;

    return fhirClient
      .fetchUrl(source, fetchUrl)
      .then((result) => {
        if (sourceMonitor) sourceMonitor.recordSuccess(source.id);
        return result;
      })
      .catch((err) => {
        if (sourceMonitor) sourceMonitor.recordFailure(source.id, err);
        failedSources.push(source.id);
        logger.error(`[aggregator] Offset fetch from ${source.id} failed: ${err.message}`);
        return null;
      });
  });

  const results = await Promise.all(promises);

  const entries = [];
  for (const bundle of results) {
    if (!bundle) continue;
    entries.push(...(bundle.entry || []));
  }

  return { entries, failedSources };
}

module.exports = { searchAll, fetchWithOffset };
