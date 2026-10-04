# Release pipeline

The authoritative domain layout, ordered release procedure, retries, one-time
setup and installed certification requirements are in
[RELEASE.md](../RELEASE.md#build-and-publication).

Build and tests save immutable app inputs. Trusted main prepares an explicit
build, preserving completed platforms. Certification selects exact files; merge
publishes them. New builds do not supersede existing selections. Historical
recovery exceptions are retired; read-only verification remains supported.
