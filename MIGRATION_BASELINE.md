# secsgem.com.cn migration baseline

This repository was initialized from the clean Fab release source at:

- Source commit: `49c2dbce0688a283a3ee7bf0ebe7aa3ccd46e269`
- Source tag: `v2.2.17-chituo.31`
- Imported on: `2026-10-07`

This initial snapshot is a migration baseline, not a deployable secsgem.com.cn
release. Before deployment, the staging branch must remove or parameterize all
gdibao.com endpoints, issue new environment-specific identities and secrets,
and configure the private service network for VM400-VM403.

Production databases, object data, credentials, private keys, runtime state,
build outputs, dependency directories, and machine identities are not part of
this source snapshot and must never be committed to Git.
