import * as path from 'path';
import { readFile, stat, writeFilep } from '../fs-helpers';
import { hashCacheDir, rootPath } from './lint-fmt-common';

const changesInvalidateCacheFiles = [
  '**/website/**/*.{js,jsx,ts,tsx}',
  '**/website/**/.eslint*',
  '**/website/**/tsconfig*.*',
  '**/website/**/tslint*.{json,js}',
  '**/website/**/tsfmt.json',
];

const hashedFiles = [
  '**/website/**/*.{ts,tsx,js,jsx,json}',
  '**/website/**/.eslint*',
];

type CacheFile = {
  [key: string]: CacheEntry;
};

export type CacheEntry = {
  dateUpdated: number;
  hash: number;
};

type FileInfo = {
  filePath: string;
  fileData: string;
  dateUpdated: number;
  changed: boolean;
};

// not to be used as a write cache.
const localCache = new Map<string, CacheFile>();

/**
 * Given a file path, provide information about whether it's been modified & the contents of the file
 * @param filePath The relative path to a file
 * @returns Promise resolving with cached file data
 */
export function getCached(filePath: string): Promise<FileInfo> {
  const hashPath = getHashPath(filePath);
  return Promise.all([
    stat(filePath),
    readFile(filePath),
  ]).then(([stats, fileData]) => {
    return getCacheEntry(hashPath)
    .then(cacheEntry => {
      const hash = getHash(fileData);
      const dateUpdated = +stats.ctime;

      const changed = hash !== cacheEntry.hash || isNewer(dateUpdated, cacheEntry.dateUpdated);
      const fileInfo: FileInfo = {
        changed,
        fileData,
        filePath,
        dateUpdated,
      };
      return fileInfo;
    });
  });
}

/**
 * Update the cache to sync with the current file stats
 * @param fileInfo the file info
 */
export function updateCache(filePath: string): Promise<CacheEntry> {
  return Promise.all([
    stat(filePath),
    readFile(filePath),
  ]).then(([stats, fileData]) => {
    return setCacheEntry(+stats.ctime, filePath, fileData);
  });
}

// writes the cache entry for the directory where filePath lives
function setCacheEntry(dateUpdated: number, filePath: string, fileData: string): Promise<CacheEntry> {
  console.log('setCacheEntry' + filePath);
  const cacheEntry: CacheEntry = {
    dateUpdated,
    hash: getHash(fileData),
  };

  return getCacheFile(filePath).then(cacheFile => {
    if (fileInfoComparer(cacheFile[filePath] || {}, cacheEntry)) {
      return cacheEntry;
    }

    // cacheFile is always a reference to the local cache; this will update it
    cacheFile[filePath] = cacheEntry;
    const hashPath = getHashPath(filePath);
    return setCacheFile(hashPath, cacheFile).then(() => cacheEntry);
  });
}

function setCacheFile(hashPath: string, cacheFile: CacheFile): Promise<void> {
  return writeFilep(hashPath, JSON.stringify(cacheFile));
}

function getCacheFile(filePath: string): Promise<CacheFile> {
  const hashPath = getHashPath(filePath);

  const localCacheFile = localCache.get(hashPath);
  if (localCacheFile) {
    return Promise.resolve(localCacheFile);
  }

  return readFile(hashPath)
  .then(data => {
    const cacheFile: CacheFile = JSON.parse(data);
    localCache.set(hashPath, cacheFile);
    return cacheFile;
  })
  .catch((err: NodeJS.ErrnoException): Promise<CacheFile> => {
    if (err.code !== 'ENOENT') {
      throw new Error(err.message);
    }
    return Promise.resolve({} as CacheFile);
  });
}

function getCacheEntry(filePath: string): Promise<CacheEntry> {
  return getCacheFile(filePath).then(cacheFile => {
    return cacheFile[filePath] || {
      dateUpdated: 0,
      hash: 0,
    } as CacheEntry;
  });
}

function getHashPath(filePath: string) {
  const relative = path.relative(path.join(rootPath, 'website'), filePath);
  return path.join(rootPath, hashCacheDir, path.dirname(relative) + '.json');
}

function fileInfoComparer(a: CacheEntry, b: CacheEntry) {
  return a.dateUpdated === b.dateUpdated && a.hash === b.hash;
}
// export const getCache = readFile(hashCachePath).catch((err: NodeJS.ErrnoException): Promise<Cache> => {
//   if (err.code === 'ENOENT') {
//     return createCache().then((cache) => {
//       writeFile(hashCachePath, JSON.stringify(cache));
//       hashCache = cache;
//       return hashCache;
//     });
//   }
//   return Promise.resolve(hashCache);
// }).then((cache: string) => {
//   hashCache = JSON.parse(cache);
//   return hashCache;
// });

// function createCache(): Promise<Cache> {
//   const cache: Cache = {
//     dateUpdated: 0,
//     entries: [],
//   };

//   let promise: Promise<any> = Promise.resolve();
//   hashedFiles.forEach(g => {
//     return glob(g).then(files => {
//       files.forEach(fileName => {
//         promise = promise.then(() => Promise.all([stat(fileName), readFile(fileName)]))
//         .then(([stats, data]) => {
//           cache.entries.push({
//             fileName,
//             dateUpdated: +stats.ctime,
//             hash: getHash(data),
//           } as CacheEntry);
//         });
//       });
//     });
//   });

//   return promise.then(() => {
//     cache.dateUpdated = Date.now();
//     return cache;
//   });
// }

export function getHash(text: string): number {
  let hash = 0;
  if (text.length === 0) {
    return hash;
  }
  for (let i = 0; i < text.length; i++) {
    const chr = text.charCodeAt(i);
    // tslint:disable:no-bitwise
    hash  = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
}

// compare dates with 2 minute grace period. This only matters if there's a hash collision
const gracePeriodMilliseconds = 1000 * 60 * 2;
function isNewer(date: number, comparedToDate: number) {
  return (date - gracePeriodMilliseconds) > comparedToDate;
}
