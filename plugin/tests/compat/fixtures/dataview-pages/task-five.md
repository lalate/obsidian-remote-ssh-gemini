# Task five

Plain note with no frontmatter. Used as a negative-control case so
the F11 Dataview test can assert that getMarkdownFiles() returns
five files even when one has no frontmatter, and that the
metadataCache yields a record with `frontmatter: undefined` for it.
