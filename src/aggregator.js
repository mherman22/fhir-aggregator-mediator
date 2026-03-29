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

function getDeduplicationKey(entry, config) {
  const resourceType = entry.resource.resourceType;
  const strategy = config?.deduplication?.[resourceType] || config?.deduplication?.default;
  if (strategy?.strategy === 'identifier' && strategy.system) {
    const matchingIdentifier = entry.resource.identifier?.find((i) => i.system === strategy.system);
    if (matchingIdentifier) return `${resourceType}/${matchingIdentifier.value}`;
  }
  return `${resourceType}/${entry.resource.id}`;
}

function deduplicate(entries, config) {
  const seen = new Set();
  return entries.filter((entry) => {
    if (!entry.resource || !entry.resource.id) return true;
    const key = getDeduplicationKey(entry, config);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function searchAll(path, queryParams, sources, fhirClient, sourceMonitor, config) {
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

  const dedupedEntries = deduplicate(entries, config);
  const hasMore = Object.keys(sourceTokens).length > 0;
  // When aggregating multiple sources the raw sum of per-source totals
  // overestimates the unique count because duplicate resources (Practitioner,
  // Location, etc.) are shared across cloned EMR instances.
  //
  // When all results fit in a single page the deduped count is exact.
  // When paginated, we approximate the true total by applying the dedup ratio
  // observed on this first page:
  //   adjustedTotal ≈ rawTotal × (dedupedEntries / rawEntries)
  //
  // This is a best-effort estimate — the FHIR R4 spec says Bundle.total
  // "SHALL only be provided if the value is accurately calculated."  A slight
  // over- or under-estimate is acceptable here because the alternative (raw
  // sum) causes downstream consumers like fhir-data-pipes to create far more
  // pagination segments than actually contain data.
  //
  // If no entries were returned on this page (rawEntryCount === 0) we have no
  // dedup signal, so we fall back to the deduped entry count (0) rather than
  // passing through the inflated raw total.
  let adjustedTotal;
  if (!hasMore) {
    adjustedTotal = dedupedEntries.length;
  } else {
    const rawEntryCount = entries.length;
    if (rawEntryCount === 0) {
      adjustedTotal = dedupedEntries.length;
    } else {
      const dedupRatio = dedupedEntries.length / rawEntryCount;
      adjustedTotal = Math.max(Math.ceil(totalCount * dedupRatio), dedupedEntries.length);
    }
  }

  return {
    entries: dedupedEntries,
    totalCount: adjustedTotal,
    sourceTokens,
    hasMore,
    failedSources,
  };
}

async function fetchWithOffset(state, offset, count, sources, fhirClient, sourceMonitor, config) {
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

  return { entries: deduplicate(entries, config), failedSources };
}

module.exports = { searchAll, fetchWithOffset, getDeduplicationKey };
