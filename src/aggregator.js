'use strict';

const logger = console;

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

  const dedupedEntries = deduplicate(entries);
  const hasMore = Object.keys(sourceTokens).length > 0;
  // When all results fit in one page, use the deduped count (accurate).
  // When paginated, use the raw total — we can't know the true deduped total
  // without fetching all pages. This may cause fhir-data-pipes to create more
  // segments than needed; empty tail segments produce "Invalid bundle submitted"
  // errors at the sink but don't affect data correctness.
  // See: https://github.com/google/fhir-data-pipes/issues/XXXX
  const adjustedTotal = hasMore ? totalCount : dedupedEntries.length;

  return {
    entries: dedupedEntries,
    totalCount: adjustedTotal,
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

  return { entries: deduplicate(entries), failedSources };
}

module.exports = { searchAll, fetchWithOffset };
