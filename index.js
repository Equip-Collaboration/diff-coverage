const artifact = require('@actions/artifact')
const core = require('@actions/core')
const exec = require('@actions/exec')
const github = require('@actions/github')
const fsPromises = require('fs').promises
const { join: joinPaths } = require('path')

run()

/**
 * Sets the variable lineNumbers in the action's output
 */
async function run() {
  // https://github.com/actions/toolkit/blob/main/docs/action-debugging.md#how-to-access-step-debug-logs
  core.debug('run: Starting...')

  try {
    const include = getInclude()
    const ignore = getIgnore()

    core.debug(`run: include=[${include}]`)
    core.debug(`run: ignore=[${ignore}]`)

    const { base, head } = getRefs()

    core.debug(`run: base=${JSON.stringify(base, null, 2)}`)
    core.debug(`run: head=${JSON.stringify(head, null, 2)}`)

    core.debug(`run: fetching ${base}...`)

    await execAsync('git', ['fetch', 'origin', base], { failOnStdErr: false })

    core.debug(`run: ${base} fetched`)

    const paths = await getPaths(base, head, include, ignore)

    core.debug(`run: paths=${JSON.stringify(paths, null, 2)}`)

    const diffs = await getDiffs(base, head, paths)

    core.startGroup('run: diffs')
    core.debug(`run: diffs=${JSON.stringify(diffs, null, 2)}`)
    core.endGroup()

    const lineNumbers = diffs.map(diff => getLineNumbers(diff))

    core.startGroup('run: lineNumbers')
    core.debug(`run: lineNumbers=${JSON.stringify(lineNumbers, null, 2)}`)
    core.endGroup()

    const lines = []
    for (let i = 0; i < paths.length; i++) {
      lines.push({
        path: paths[i],
        added: lineNumbers[i].added,
        removed: lineNumbers[i].removed
      })
    }

    core.startGroup('run: lines')
    core.debug(`run: lines=${JSON.stringify(lines, null, 2)}`)
    core.endGroup()

    const coverage = await getCoverage()

    core.startGroup('run: coverage')
    core.debug(`run: coverage=${JSON.stringify(coverage, null, 2)}`)
    core.endGroup()

    const untestedLines = getUntestedAddedLines(lines, coverage)

    core.startGroup('run: untestedLines')
    core.debug(`run: untestedLines=${JSON.stringify(untestedLines, null, 2)}`)
    core.endGroup()

    if (untestedLines.length) {
      core.setFailed(`Missing tests for ${untestedLines.length} files.`)

      for (let i = 0; i < untestedLines.length; i++) {
        const { path, all, hasTests } = untestedLines[i]
        if (hasTests) {
          core.error(
            `Coverage: ${path} is missing tests for lines ${JSON.stringify(
              all
            )}`
          )
        } else {
          core.error(`Coverage: ${path} is not being tested`)
        }
      }
    }
  } catch (error) {
    core.setFailed(error)
  }
  core.debug('run: Ended')
}

/**
 * Gets the `include` input and parses it to an array of regular expressions.
 *
 * @returns {RegExp[]} The parsed regular expressions
 */
function getInclude() {
  let includeInput = core.getInput('include')

  core.debug(
    `getInclude: includeInput=${JSON.stringify(includeInput, null, 2)}`
  )

  if (!includeInput) {
    includeInput = `[""]`
    core.debug(`getInclude: default=${includeInput}`)
  }

  let includeStrings
  try {
    includeStrings = JSON.parse(includeInput)
  } catch (e) {
    core.error(`getInclude: Could not parse include=${includeInput}`)
    throw e
  }

  core.debug(
    `getInclude: includeStrings=${JSON.stringify(includeInput, null, 2)}`
  )

  if (!(includeStrings instanceof Array)) {
    core.error(
      `getInclude: include parsed to ${JSON.stringify(includeStrings)}`
    )
    throw new Error('Error parsing "include" to array')
  }

  const include = includeStrings.map(str => {
    try {
      return new RegExp(str)
    } catch (e) {
      core.error(`getInclude: Could not parse ${str} to a regular expression`)
      throw e
    }
  })

  core.debug(`getInclude: include=${includeInput}`)

  return include
}

/**
 * Gets the `ignore` input and parses it to an array of regular expressions.
 *
 * @returns {RegExp[]} The parsed regular expressions
 */
function getIgnore() {
  let includeInput = core.getInput('ignore')

  core.debug(`getIgnore: includeInput=${JSON.stringify(includeInput, null, 2)}`)

  if (!includeInput) {
    includeInput = `[]`
    core.debug(`getIgnore: default=${includeInput}`)
  }

  let includeStrings
  try {
    includeStrings = JSON.parse(includeInput)
  } catch (e) {
    core.error(`getIgnore: Could not parse ignore=${includeInput}`)
    throw e
  }

  core.debug(
    `getIgnore: includeStrings=${JSON.stringify(includeInput, null, 2)}`
  )

  if (!(includeStrings instanceof Array)) {
    core.error(`getIgnore: ignore parsed to ${JSON.stringify(includeStrings)}`)
    throw new Error('Error parsing "ignore" to array')
  }

  const ignore = includeStrings.map(str => {
    try {
      return new RegExp(str)
    } catch (e) {
      core.error(`getIgnore: Could not parse ${str} to a regular expression`)
      throw e
    }
  })

  core.debug(`getIgnore: ignore=${includeInput}`)

  return ignore
}

/**
 * Gets the diffs (one for each file) between `base` and `head`
 *
 * git diff docs: <https://git-scm.com/docs/git-diff>
 *
 * @param {string} base The git ref to compare from
 * @param {string} head The git ref to compare to
 * @param {string[]} paths The paths of the files to compare
 * @returns {string[]} Diff patches
 */
async function getDiffs(base, head, paths) {
  core.startGroup('getDiffs')

  const diffs = []
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i]

    const { stdout } = await execAsync('git', [
      'diff',
      '-U0',
      `--minimal`,
      `--diff-filter=AM`,
      `--inter-hunk-context=0`,
      `-w`,
      `${base}`,
      '--',
      path
    ])

    core.debug(`getDiffs: stdout=${stdout}`)

    diffs.push(stdout)
  }

  core.endGroup()

  return diffs
}

/**
 * Gets the path of added or modified (ignores whitespace) files between `base`
 * and `head`.
 *
 * - Only return paths that match a regular expression in `include`. By default
 * includes all.
 * - Do not return paths that match a regular expression in `ignore`. By
 * default ignores none.
 *
 * git diff docs: <https://git-scm.com/docs/git-diff>
 *
 * @param {string} base The git ref to compare from
 * @param {string} head The git ref to compare to
 * @param {RegExp[]} include A list of regular expressions
 * @param {RegExp[]} ignore A list of regular expressions
 * @returns {string[]} The paths
 */
async function getPaths(base, head, include, ignore) {
  core.debug(`getPaths: Starting...`)

  const { stdout } = await execAsync('git', [
    'diff',
    '--name-only',
    `--diff-filter=AM`,
    `-w`,
    `${base}`,
    `--`
  ])

  core.debug(`getPaths: stdout=${stdout}`)

  return stdout
    .split('\n')
    .filter(
      path =>
        path &&
        include.some(re => re.test(path)) &&
        !ignore.some(re => re.test(path))
    )
}

// Matches a patch chunk line and captures the chunk's numbers.
// E.g.: Matches "@@ -27,7 +198,6 @@ ..." and captures 27, 7, 198 and 6
// E.g.: Matches "@@ -27 +198,0 @@ ..." and captures 27, undefined, 198 and 0
// Capture groups:             |-1-|    |-2-|     |-3-|    |-4-|
const patchLinesRegexp = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/**
 * Gets the line numbers (removed and added) from the patch
 *
 * @param {string} patch The diff's patch
 * @returns {object} { added: number[], removed: number[] }
 */
function getLineNumbers(patch) {
  const removed = []
  const added = []

  const patchLines = patch ? patch.split('\n') : []
  for (let i = 0; i < patchLines.length; i++) {
    const match = patchLines[i].match(patchLinesRegexp)
    if (match) {
      const remStart = Number.parseInt(match[1])
      const remNumber = match[2] ? Number.parseInt(match[2]) : 1
      const addStart = Number.parseInt(match[3])
      const addNumber = match[4] ? Number.parseInt(match[4]) : 1

      for (let j = 0; j < remNumber; j++) {
        removed.push(remStart + j)
      }
      for (let j = 0; j < addNumber; j++) {
        added.push(addStart + j)
      }
    }
  }

  return { added, removed }
}

/**
 * Gets the base and head refs from the github context.
 *
 * The base ref will be:
 * - The base branch of the pull request, or
 * - The commit before the push
 *
 * @returns {object} { base, head, owner, repo }
 */
function getRefs() {
  const { payload, eventName } = github.context

  core.startGroup('getRefs: payload')
  core.debug(`getRefs: payload=${JSON.stringify(payload, null, 2)}`)
  core.endGroup()
  core.debug(`getRefs: eventName=${JSON.stringify(eventName)}`)

  const {
    repository: {
      name: repo,
      owner: { login: owner }
    },
    before,
    after: head
  } = payload

  core.debug(`getRefs: repo=${JSON.stringify(repo)}`)
  core.debug(`getRefs: owner=${JSON.stringify(owner)}`)
  core.debug(`getRefs: before=${JSON.stringify(before)}`)
  core.debug(`getRefs: head=${JSON.stringify(head)}`)

  let base
  if (eventName === 'pull_request') {
    base = payload.pull_request.base.sha
  } else if (eventName === 'push') {
    base = before
  } else {
    throw new Error('The triggering event must be "push" or "pull_request"')
  }

  core.debug(`getRefs: base=${JSON.stringify(base)}`)

  return { base, head, owner, repo }
}

/**
 * Executes a shell command and resolves to the output
 * once the command finishes.
 *
 * By default, rejects if there is data on stderr or if the exit code is not zero.
 * See more options at
 * <https://github.com/actions/toolkit/blob/main/packages/exec/src/interfaces.ts>
 *
 * @param {string} command
 * @param {string[]} args
 * @param {object} options
 * @returns {object} { stdout: string, stderr: string, code: number }
 */
async function execAsync(command, args = [], options = {}) {
  const errArray = []
  const outArray = []
  let code = -1

  core.debug(`execAsync: command=${command}`)
  core.debug(`execAsync: args=${JSON.stringify(args, null, 2)}`)
  core.debug(`execAsync: (input) options=${JSON.stringify(options, null, 2)}`)

  options = {
    failOnStdErr: true,
    silent: true,
    ...options,
    listeners: {
      ...(options.listeners ? options.listeners : {}),
      // Use stdout instead of stdline https://github.com/actions/toolkit/issues/749
      stdout: data => outArray.push(data),
      stderr: data => errArray.push(data)
    }
  }

  try {
    code = await exec.exec(command, args, options)
  } catch (e) {
    e.stderr = errArray.join('')
    e.stdout = outArray.join('')
    core.error(`execAsync: stdout=${e.stdout}`)
    core.error(`execAsync: stderr=${e.stderr}`)
    throw e
  }

  return { stdout: outArray.join(''), stderr: errArray.join(''), code }
}

/**
 * Downloads the artifact `coverageArtifact`, reads it and returns it parsed.
 *
 * Expects the downloaded artifact to be `coverage-final.json`
 *
 * @returns {object} The parsed artifact
 */
async function getCoverage() {
  core.debug(`getCoverage: Starting...`)

  const artifactClient = artifact.create()
  const artifactName = 'coverageArtifact'
  const path = '~/downloads'
  const options = {
    createArtifactFolder: true
  }

  core.debug(`getCoverage: Downloading artifact...`)

  const downloadResult = await artifactClient.downloadArtifact(
    artifactName,
    path,
    options
  )

  core.debug(
    `getCoverage: downloadResult=${JSON.stringify(downloadResult, null, 2)}`
  )

  const coverageFile = await fsPromises.readFile(
    joinPaths(downloadResult.downloadPath, 'coverage-final.json'),
    'utf8'
  )

  core.startGroup('getCoverage: coverageFile')
  core.debug(
    `getCoverage: coverageFile=${JSON.stringify(coverageFile, null, 2)}`
  )
  core.endGroup()

  const coverage = JSON.parse(coverageFile)

  core.startGroup('getCoverage: coverage')
  core.debug(`getCoverage: coverage=${JSON.stringify(coverage, null, 2)}`)
  core.endGroup()

  return coverage
}

/**
 * Returns the line number of each untested added line.
 *
 * The received coverage object must be a parsed istambul JSON coverage report,
 * like the one generated by Jest. More details in
 * <https://istanbul.js.org/docs/advanced/alternative-reporters/#json>.
 *
 * - Returns an array of objects.
 * - Each object represents a file that has some untested lines.
 * - If the `hasTests` attribute is `false`, then the file was not tested.
 * - The `all` attribute has the line number of each untested lines.
 * - The `statements`, `functions`, `ifs` and `elses` attributes have the line
 * numbers corresponding to that category of test missing.
 *
 * Returned array:
 * ```javascript
 * [{
 *   path: string,
 *   hasTests: boolean,
 *   all: number[],
 *   statements: number[],
 *   functions: number[],
 *   ifs: number[],
 *   elses: number[]
 * }]
 * ```
 *
 * @param {object[]} lines New lines in each file
 * @param {string} lines[].path The file's path
 * @param {number[]} lines[].added Added (or modified) lines' numbers
 * @param {object} coverage A parsed istanbul JSON coverage report
 * @returns {object[]} The untested added lines
 */
function getUntestedAddedLines(lines, coverage) {
  core.debug(`getUntestedAddedLines: starting`)

  const baseDir = core.getInput('repoDirectory')

  core.debug(
    `getUntestedAddedLines: baseDir=${JSON.stringify(baseDir, null, 2)}`
  )

  const untestedAddedLines = []
  for (let i = 0; i < lines.length; i++) {
    const { path, added } = lines[i]
    const fullPath = joinPaths(baseDir, path)
    const result = {
      path,
      hasTests: true,
      all: [],
      statements: [],
      functions: [],
      ifs: [],
      elses: []
    }
    const fileCoverage = coverage[fullPath]
    if (!fileCoverage) {
      result.hasTests = false
      untestedAddedLines.push(result)
    } else {
      const addedSet = new Set(added)
      const untestedAddedLinesSet = new Set()
      const { statements, functions, ifs, elses } = result

      Object.entries(fileCoverage.s).forEach(([k, v]) => {
        if (v === 0) {
          const {
            start: { line: start },
            end: { line: end }
          } = fileCoverage.statementMap[k]

          getIntegersInRangeInSet(start, end, addedSet).forEach(l => {
            statements.push(l)
            untestedAddedLinesSet.add(l)
          })
        }
      })

      Object.entries(fileCoverage.f).forEach(([k, v]) => {
        if (v === 0) {
          const {
            start: { line: start },
            end: { line: end }
          } = fileCoverage.fnMap[k].loc

          getIntegersInRangeInSet(start, end, addedSet).forEach(l => {
            functions.push(l)
            untestedAddedLinesSet.add(l)
          })
        }
      })

      Object.entries(fileCoverage.b).forEach(([k, v]) => {
        const [ifBranchTests, elseBranchTests] = v

        if (ifBranchTests === 0 || elseBranchTests === 0) {
          const {
            start: { line: start },
            end: { line: end }
          } = fileCoverage.branchMap[k].loc

          getIntegersInRangeInSet(start, end, addedSet).forEach(l => {
            if (ifBranchTests === 0 || elseBranchTests === 0) {
              if (ifBranchTests === 0) {
                ifs.push(l)
              }
              if (elseBranchTests === 0) {
                elses.push(l)
              }
              untestedAddedLinesSet.add(l)
            }
          })
        }
      })

      if (untestedAddedLinesSet.size) {
        result.all = Array.from(untestedAddedLinesSet)
        result.all.sort((a, b) => a - b)
        untestedAddedLines.push(result)
      }
    }
  }

  return untestedAddedLines
}

/**
 * Returns an array with the numbers (integers) in `set` that are in the range.
 *
 * @example
 * ```javascript
 * const set = new Set([1, 2, 3, 4, 5])
 * console.log(getIntegersInRangeInSet(2, 4, set))
 * // [ 2, 3, 4 ]
 * ```
 *
 * @param {number} start The start of the range
 * @param {number} end The end of the range
 * @param {Set} set The Set where the numbers will be checked
 * @returns {number[]} Integers in the range and the set, in ascending order
 */
function getIntegersInRangeInSet(start, end, set) {
  const result = []
  for (let i = start; i <= end; i++) {
    if (set.has(i)) result.push(i)
  }
  return result
}
