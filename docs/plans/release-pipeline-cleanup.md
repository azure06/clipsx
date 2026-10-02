# Release pipeline

The authoritative triggers, immutable build selection, retries, migration,
credential setup and certification requirements are in
[RELEASE.md](../RELEASE.md#build-and-publication).

Build and tests save immutable app inputs. Trusted main prepares an explicit
build, preserving completed platforms. Certification selects an exact candidate;
merge publishes those files. New builds do not supersede existing selections.
