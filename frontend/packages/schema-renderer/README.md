# @faabs/schema-renderer

Renders a host-published schema document — modes, tabs, registries and forms —
into a working control surface. The AI Lab panel uses it to browse the
Dehumanized skill and play registries and to edit an entry's configuration and
parameters without the interface knowing anything about either registry.

This is a copy of Dehumanized's `@dehumanized/schema-renderer`, moved here so
that no consumer depends on a sibling repository's npm package. It is consumed
from source: the app's Vite build compiles `src/` directly, so there is no
`dist/` to keep in sync and Rust-only builds never touch it.

The Dehumanized copy stays in place until its own demo is migrated; until then,
changes that affect the wire shape of the schema document belong in both.
