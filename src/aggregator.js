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
  // Per the FHIR R4 spec, Bundle.total "SHALL only be provided if the total
  // for all pages is accurately calculated."  When aggregating multiple sources,
  // the raw sum of per-source totals overestimates the unique count because
  // duplicate resources (Practitioner, Location, etc.) are shared across
  // cloned EMR instances.
  //
  // When all results fit in a single page the deduped count is exact.
  // When paginated, we estimate the true total by applying the deduplication
  // ratio observed on this first page:
  //   adjustedTotal ≈ rawTotal × (dedupedEntries / rawEntries)
  // This prevents downstream consumers (e.g. fhir-data-pipes) from creating
  // more pagination segments than actually contain data.
  let adjustedTotal;
  if (!hasMore) {
    adjustedTotal = dedupedEntries.length;
  } else {
    const rawEntryCount = entries.length;
    const dedupRatio = rawEntryCount > 0 ? dedupedEntries.length / rawEntryCount : 1;
    adjustedTotal = Math.max(Math.ceil(totalCount * dedupRatio), dedupedEntries.length);
  }

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
