# fs-hash

Utility for tracking state changes to a file system.

## Status

WIP

## Usage

Can be used from the CLI or via javascript API. Uses a configuration file or CLI options

## Prospective Functionality

- will produce a mirror of the file system targeted by glob with a single file for each directory

.fs-hash/
  foo1/
  foo1.json
  foo2/
     bar1/
     bar1.json

The goal of aggregating folders is to balance diffs when files change with convenience. A single file to track everything would require heavy reads/writes on changes. A single file for each managed file would result in large diffs. This approach balances these and provides human-traversable output.

Each file contains a structure with # bytes, date updated, and a hash of all the files in the folder.

Writes can be cached.

When analyzing a structure for changes, the cached data is read for all files in question. Then the current file is compared to the cached state data using this logic:

1) MD5 hash
2) date is newer

Because hash collisions are possible with a likelihood depending on the algorithm used, it comparing datestamp can be used to validate hash matches. The downside of this is that it will result in false positives if files have been touched but otherwise not changed. So, when a hash matches but a date compare fails, we must assume that it's a has collission to be completely certain that

1) Will require some margin of error if the state data is expected to be valid across different instances or machines (e.g., is a member of a shared repository of some kind)



