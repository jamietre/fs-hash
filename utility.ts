/* tslint:disable no-console */

export type Task = (args?: string) => Promise<any> | any;

export type TaskMap = {
  [name: string]: Task;
};

/**
 * Given an array of functions that return promises, chain each, invoking the next function only
 * when the prior promise resolves, and return a promise resolving when the last promise resolves,
 * or rejecting if any rejects.
 *
 * The array can include elements that are also arrays; it will be flattened.
 *
 * @param arr Array of promises
 * @returns A promise resolving with an array of each promise's outcome
 */
function chainTasks(arr: Array<Task | Task[]>): Promise<any> {
  const queue = flatten<Task>(arr);
  let promise;
  const results: any[] = [];

  while (queue.length) {
    const next = queue.shift();
    if (typeof next !== 'function') {
      return Promise.reject(`A non-function was passed to chainTasks: ${next}`);
    }
    promise = promise ?
      promise.then(data => {
        results.push(data);
        return Promise.resolve(next());
      }) :
      Promise.resolve(next());
  }

  return promise ?
    promise.then((data) => {
      results.push(data);
      return results;
    }) :
    Promise.resolve([]);
}

/**
 * Flatten an array
 * @param arr Array possibly containing other arrays
 * @returns A flat array
 */
function flatten<T>(arr: Array<T | T[]>): T[] {
  return arr.reduce<T[]>((out, item) => {
    out = out.concat(Array.isArray(item) ? flatten<T>(item) : item);
    return out;
  }, []);
}

/**
 * Parse CLI arguments and if `exec_now` is present, execute a single task passed as the
 * next agument with optional args following `:`
 *
 * e.g.
 *
 * node some_file exec_now task:args
 *
 * If the tasks(s) fail, will exit with status code 1
 *
 * @param {object} allTasks Object map of { tasks: (subtask) => Promise }
 */
function commandLinify(allTasks: TaskMap) {
  if (!allTasks || Object.keys(allTasks).length === 0) {
    throw new Error('commandLinify demands a single argument, an object map of taskNames -> functions');
  }

  const argv = process.argv;
  const execIndex = argv.indexOf('exec_now');

  // bail out if this module wasn't invoked directly by node with the "exec_now" arg
  if (execIndex < 0) {
    return;
  }

  // remove the "exec_now" part of the cli to prevent any other script from
  // acting as if it were invoked from the command line
  process.argv = process.argv.slice(0, execIndex);

  const cliArgs = argv.slice(execIndex + 1);
  executeCommands(allTasks, cliArgs)
    .then((taskInfo) => {
      console.log(`Task "${taskInfo}" completed.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err.toString());
      process.exit(1);
    });
}

function executeCommands(allTasks: TaskMap, argv: string[]): Promise<string> {
  const taskNames = Object.keys(allTasks);

  let taskParam: string;
  let taskName: string;
  let taskArgs: string = '';

  switch (argv.length) {
  case 0:
    if (taskNames.length !== 1) {
      throw new Error('You must provide a task name when there is more than one task');
    }
    taskName = taskNames[0];
    taskParam = taskName;
    break;
  case 1:
    taskParam = argv[0];
    [taskName, taskArgs] = taskParam.split(':');
    break;
  default:
    {
      const argText = taskNames.length === 1 ? 'zero or one' : 'exactly one';
      throw new Error(`There must be ${argText} arguments after "exec_now"`);
    }
  }

  const task = allTasks[taskName];
  if (!task) {
    throw new Error(`No task named "${task}"`);
  }

  return task(taskArgs).then(() => taskParam);
}

/**
 * Convert a rejection to a resolution, and vice versa
 * @param promise The promise
 */
function invertPromise(promise: Promise<any>): Promise<Error> {
  return new Promise((resolve, reject) => {
    promise.then(reject).catch(resolve);
  });
}

export { chainTasks, commandLinify, invertPromise };

const test = { executeCommands };
export { test };
