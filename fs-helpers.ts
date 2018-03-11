/**
 * Pure node versions of common shell file manipulation utilities,
 * with some enhancements & a promise API
 *
 * Each file accepts a final `options` argument which can include {
 *    log: [true|false]
 *    verbose: [true|false]
 * }
 *
 * Logging emits each operation to the console
 * Verbose causes any inner operations to also be emitted
 */

/* tslint:disable no-console */
/* global __dirname: 1 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import _glob = require('glob');
import minimatch = require('minimatch');
import readLine = require('readline');
import _rm = require('rimraf');

import { chainTasks } from './utility';

type Options = {
  verbose?: boolean;
  log?: boolean;
};

interface FsError extends NodeJS.ErrnoException {
  errType: string;
  errPath: string;
}

type ExistsOptions = Options & {
  /**
   * When true, will test for extence of link itself rather than link target
   */
  testLink?: boolean;
};

/**
 * Test if a file exists
 * @param src The file path
 * @param options Options
 * @returns Resolves with file name if the file exists
 */
function exists(src: string, options: ExistsOptions = {}): Promise<string> {
  log(`exists ${src}`, options);

  return new Promise((resolve, reject) => {
    if (options.testLink) {
      fs.lstat(src, callbackResolver(() => resolve(src), reject));
      return;
    }
    fs.access(src, fs.constants.F_OK, callbackResolver(() => resolve(src), reject));
  });
}

/**
 * Make a symlink
 *
 * @param target The link target
 * @param linkPath The path to the new link
 * @param options Options
 */
function symlink(target: string, linkPath: string, options: Options): Promise<string> {
  log(`symlink "${target}" "${linkPath}"`, options);

  return new Promise((resolve, reject) => {
    fs.symlink(target, linkPath, callbackResolver(() => resolve(target), reject));
  });
}

/**
 * Copy a file, but give slightly better error info than Node fs.copyFile
 *
 * @param src The file path
 * @param dest The target path. Must be a file name -- use cp for copying to a target folder.
 * @param options Options
 * @returns Promise with outcome
 */
function cp(src: string, dest: string, options: Options = {}) {
  assert.ok(src, '`src` is required for cp');
  assert.ok(dest, '`dest` is required for cp');
  log(`cp ${src} ${dest}`, options);

  return new Promise(function(resolve, reject) {
    fs.copyFile(src, dest, function(err) {
      if (!err) {
        return resolve();
      }

      if (err.code !== 'ENOENT') {
        return reject(err);
      }

      exists(path.dirname(dest))
        .then(function() {
          reject(toFsError(err, {
            errType: 'source',
            errPath: src,
            message: `ENOENT: Missing source file '${src}'`,
          }));
        })
        .catch(function() {
          reject(toFsError(err, {
            errType: 'dest',
            errPath: dest,
            message: `ENOENT: Missing target folder '${path.dirname(dest)}'`,
          }));
        });
    });
  });
}

/**
 * Copy a file with glob patterns
 *
 * @param src Glob for source files
 * @param dest Target output; subdirectories will be created based on first globbed segment in src
 * @param options Options
 * @returns Promise resolving on success with an array of all the files that were copied
 */
function cpGlob(src: string, dest: string, options: Options = {}): Promise<string[]> {
  assert.ok(src, '`src` is required for cpGlob');
  assert.ok(dest, '`dest` is required for cpGlob');

  log(`cpGlob ${src} ${dest}`, options);
  const innerOptions = options.verbose ? options : {};

  return new Promise(function(resolve, reject) {
    const segments = src.split('/');
    let firstGlobIndex = segments.findIndex(e => _glob.hasMagic(e));
    if (firstGlobIndex < 0) {
      firstGlobIndex = segments.length - 1;
    }

    if (!dest.endsWith('/')) {
      return reject(new Error('If copying a glob, you can only specify a target directory, not a file'));
    }

    const globTarget = path.normalize(segments.slice(0, firstGlobIndex).join('/'));

    _glob(src, (globErr: Error, files: string[]) => {
      if (globErr) {
        return reject(globErr);
      }

      type FileSpec = {
        srcFile: string;
        destFile: string;
      };

      const toProcess: FileSpec[] = files.map((file): FileSpec => {
        const normalizedFile = path.normalize(file);
        let relativeToGlobRoot: string = '';

        if (normalizedFile.startsWith(globTarget)) {
          relativeToGlobRoot = normalizedFile.split('/').slice(firstGlobIndex).join('/');
        }

        return {
          srcFile: file,
          destFile: `${dest}${relativeToGlobRoot}`,
        } as FileSpec;
      });

      const errors = toProcess.filter(e => !e.destFile);
      if (errors.length) {
        const errMessage = `Problem with the glob copy: files don't seem to be in target tree "${globTarget}". First file: ${errors[0].srcFile}"`;
        return reject(new Error(errMessage));
      }

      let noRetry = false;
      const copyNextFile = function() {
        if (toProcess.length === 0) {
          return resolve(files);
        }
        const { srcFile, destFile } = toProcess[0];

        cp(srcFile, destFile, innerOptions)
          .then(() => {
            noRetry = false;
            toProcess.shift();
            copyNextFile();
          })
          .catch(err => {
            // try to create the target folder if that's the only
            // problem and we haven't tried already
            if (noRetry || err.code !== 'ENOENT' || err.errType !== 'dest') {
              throw err;
            }

            noRetry = true;
            return mkdirp(path.dirname(destFile), innerOptions).then(() => {
              copyNextFile();
            });
          })
          .catch(reject);
      };

      copyNextFile();
    });
  });
}

/**
 * Unlink files
 * @param target The file or glob to unlink
 * @param options Options
 * @returns Promise resolving on success
 */
function rm(target: string, options: Options = {}): Promise<void> {
  assert.ok(target, '`target` is required for rm');

  return new Promise(function(resolve, reject) {
    log(`rm ${target}`, options);
    _rm(target, callbackResolver(resolve, reject));
  });
}

/**
 * Make a directory. Fails if the parent doesn't exist.
 *
 * @param target The directory path
 * @param options Options
 * @returns  Promise with outcome
 */
function mkdir(target: string, options: Options = {}): Promise<void> {
  assert.ok(target, '`target` is required for mkdir');

  return new Promise(function(resolve, reject) {
    log(`mkdir ${target}`, options);
    fs.mkdir(target, callbackResolver(resolve, reject));
  });
}

/**
 * Make a directory. Fails if the parent doesn't exist.
 *
 * @param prefix The directory prefix
 * @returns Promise with temporary directory
 */
function mkdtemp(prefix: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.mkdtemp(prefix, (err, folder: string) => {
      if (err) return reject(err);
      resolve(folder);
    });
  });
}

/**
 * Make a directory, including any parent directories as needed
 *
 * @param target The directory path
 * @param options Options
 * @returns Promise with outcome
 */
function mkdirp(target: string, options: Options = {}): Promise<any[]> {
  assert.ok(target, '`target` is required for mkdirp');
  return new Promise(function(resolve, reject) {
    log(`mkdirp ${target}`, options);
    const innerOptions = options.verbose ? options : {};

    const segments = withoutTrailingSlash(target).split('/');

    let index = 0;
    const foundRoot = false;
    const chain: Array<() => Promise<any>> = [];

    while (++index <= segments.length) {
      const partialPath = segments.slice(0, index).join('/');
      if (partialPath === '') {
        // ignore leading slashes in testing folders
        continue;
      }

      if (!foundRoot) {
        chain.push(
          () => exists(partialPath)
            .then(() => stat(partialPath, innerOptions))
            .then((stats) => {
              if (!stats.isDirectory()) {
                const err: NodeJS.ErrnoException = new Error(`EISDIR: ${partialPath} exists but isn't a directory`);
                err.code = 'EISDIR';
                throw err;
              }
            })
            .catch((err) => {
              if (err.code === 'ENOENT') {
                return mkdir(partialPath);
              }
              throw err;
            }),
        );
      } else {
        chain.push(() => mkdir(partialPath, innerOptions));
      }
    }
    chainTasks(chain).then(resolve, reject);
  });
}

/**
 * Write a text file
 * @param target The file to create
 * @param text The contents of the file
 * @returns Promise resolving on success
 */
function writeFile(target: string, text: string, options: Options = {}): Promise<void> {
  assert.ok(target, '`target` is required for writeFile');
  assert.ok(text, '`text` is required for writeFile');

  return new Promise((resolve, reject) => {
    log(`writeFile ${target} "${truncate(text)}"`, options);
    fs.writeFile(target, text, function(err) {
      if (err) return reject(err);
      resolve();
    });
  });
}

/**
 * Write a text file, creating path as neeed
 * @param target The file to create
 * @param text The contents of the file
 * @returns Promise resolving on success
 */
function writeFilep(target: string, text: string, options: Options = {}): Promise<void> {
  assert.ok(target, '`target` is required for writeFilep');
  assert.ok(text, '`text` is required for writeFilep');

  log(`writeFilep ${target} "${truncate(text)}"`, options);
  return mkdirp(path.dirname(target), options)
    .then(() => writeFile(target, text));
}

/**
 * Read a text file
 * @param {string} filename The file to read
 * @returns {Promise} Promise resolving with the contents of the file
 */
const readFile = function(filename: string, options: Options = {}): Promise<string> {
  assert.ok(filename, '`filename` is required for readFile');
  return new Promise((resolve, reject) => {
    log(`readFile ${filename}`, options);
    fs.readFile(filename, 'utf-8', function(err, data) {
      if (err) {
        return reject(err);
      }
      resolve(data);
    });
  });
};

/**
 * Read a file line by line, resolving when finished. Errors thrown in the
 * callback will cause entire method to abort & reject
 *
 * @param filename The file to read
 * @param callback for each line, invoke 'abort' to abort
 * @returns {Promise} Promise resolving when file read completely
 */
function readLines(
  filename: string,
  callback: (
    line: string,
    abort: (message?: string) => void,
  ) => void,
): Promise<string> {

  assert.ok(filename, '`filename` is required for readLines');
  assert.ok(callback, '`callback` is required for readLines');
  let error: Error;
  let message: string | undefined;

  return new Promise((resolve, reject) => {
    const lineReader = readLine.createInterface({
      input: fs.createReadStream(filename),
    });

    const abort = function(msg?: string) {
      message = msg;
      lineReader.removeListener('line', captureLine);
      lineReader.close();
    };

    const captureLine = function(line: string) {
      try {
        callback(line, abort);
      } catch (err) {
        error = err;
        abort();
      }
    };

    lineReader.on('line', captureLine);

    lineReader.on('close', function() {
      if (error) {
        reject(error);
      } else {
        resolve(message);
      }
    });
  });
}

export function stat(filename: string, options: Options = {}): Promise<fs.Stats> {
  assert.ok(filename, '`filename` is required for readLines');
  return new Promise(function(resolve, reject) {
    log(`stat ${filename}`, options);

    fs.stat(filename, function(err, data) {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

/**
 * Return files matching a pattern, relative to the root of the pattern (e.g. absolute, or current dir)
 *
 * @param pattern The pattern
 * @returns Promise resolving with matched files
 */
function glob(pattern: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    _glob(pattern, (err, files) => {
      if (err) return reject(err);
      resolve(files);
    });
  });
}

/**
 * Traverse up the directory path looking for files that match `pattern`
 *
 * @param startingPath A path
 * @param pattern a glob to match against path/[files]
 * @returns Matches found in closest folder
 */
function closest(startingPath: string, pattern: string, options: Options = {}): string[] {
  assert.ok(startingPath, '`startingPath` is required for closest');
  assert.ok(pattern, '`pattern` is required for closest');
  log(`stat ${startingPath}`, options);

  return closestHelper(startingPath, pattern);
}

function closestHelper(startingPath: string, pattern: string): string[] {
  const files = fs.readdirSync(startingPath);
  const matches = files
    .map(e => path.join(startingPath, e))
    .filter(e => minimatch(e, pattern));
  if (matches.length > 0) {
    return matches;
  }
  const parts = startingPath.split('/');
  if (parts.length === 1 ||
    (parts.length === 2 && parts[0] === '')) {
    throw new Error('no match found');
  }
  const levelUpPath = parts.slice(0, parts.length - 1).join('/');
  return closestHelper(levelUpPath, pattern);
}

function log(message: string, options: Options = {}): void {
  if (!options.log) return;
  console.log(message);
}

function callbackResolver(resolve: () => void, reject: (err: Error) => void) {
  return function(err: Error) {
    if (err) return reject(err);
    resolve();
  };
}

/**
 * Relatively reliable way to obtain the application root when __dirname
 * is unknown
 *
 * @param innerPath Path to resolve from app root
 * @returns The rooted path to the app root, or inner path
 */
function appRootPath(innerPath: string = ''): string {
  const likelyAppGruntfile = closest(__dirname, '**/website/Gruntfile.js');
  if (likelyAppGruntfile.length === 0) {
    throw new Error('Could not find Gruntfile.js above me');
  }
  const appRoot = path.resolve(path.dirname(likelyAppGruntfile[0]), '..');
  return path.join(appRoot, innerPath);
}

function truncate(text: string = ''): string {
  return text.length > 60 ? text.slice(0, 60) + '...' : text;
}

function withoutTrailingSlash(text: string): string {
  return text && text.endsWith('/') ? text.slice(0, text.length - 1) : text;
}

type FsHelpers = {
  appRootPath: typeof appRootPath,
  cp: typeof cp,
  cpGlob: typeof cpGlob,
  mkdir: typeof mkdir,
  mkdtemp: typeof mkdtemp,
  mkdirp: typeof mkdirp,
  rm: typeof rm,
  readFile: typeof readFile,
  writeFile: typeof writeFile,
  writeFilep: typeof writeFilep,
  readLines: typeof readLines,
  glob: typeof glob,
  closest: typeof closest,
  exists: typeof exists,
  symlink: typeof symlink,
};

const allHelpers: FsHelpers = { appRootPath, cp, cpGlob, mkdir, mkdtemp, mkdirp, rm, readFile, writeFile, writeFilep, readLines, glob, closest, exists, symlink };

/**
 * Bind options to all fs helper methods, e.g.
 *
 * const { readFile, readLines, writeFile } = withOptions({ log: true });
 *
 * Useful for troubleshooting & logging.
 *
 * @param {object} options Options: log, verboser
 * @returns {object} Object with all fs helper methods bound with specified options.
 */
function withOptions(options: Options): FsHelpers {
  return Object.keys(allHelpers).reduce((helpers, key: keyof FsHelpers): FsHelpers => {
    helpers[key] = function(...args: any[]) {
      return (allHelpers[key] as any)(...args, options);
    };
    return helpers;
  }, {} as FsHelpers);
}

function toFsError(err: NodeJS.ErrnoException, opts: { errType: string, errPath: string, message: string }): FsError {
  Object.assign((err as FsError), opts);
  return err as FsError;
}

export {
  appRootPath, cp, cpGlob, mkdir, mkdtemp, mkdirp, rm, readFile, writeFile, writeFilep, readLines, glob, closest, exists, symlink,
  withOptions,
};
