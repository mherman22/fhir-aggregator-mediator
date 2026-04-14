# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


# Release v1.1.0

## What's Changed
### 📝 Other Changes
- Prepare for next development iteration: 1.1.0-SNAPSHOT
- Add release.sh: one-command release with version bump
### 📚 Documentation
- add releasing instructions to README
- CI: add dev tag for development builds on main
- Remove deduplication — aggregator should only merge, not deduplicate
- Update README: remove all deduplication references
- Document that aggregator is for demo/test only, not production
- Update production architecture description in README
- Add duplicate ID removal to prevent HAPI FHIR transaction bundle rejection
- Fix total count: use deduped entry count when all results fit in one page
- Add Node.js cluster module support for horizontal scaling (#6)
- Add production readiness issues documentation and batch creation script (#7)
- Delete create-issues.sh
- Update production-readiness-issues.md

