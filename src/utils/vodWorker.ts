'use strict'
import cp from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import readline from 'readline'

interface VodTask {
  cmd: string
  interactive: boolean
  startedPath: string
  resultPath: string
}

interface VodResult {
  exitCode: number | null
  paused: boolean
  error?: string
}

async function saveResult(filePath: string, data: object) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.tmp`
  await fs.writeFile(tempPath, JSON.stringify(data), 'utf8')
  await fs.rename(tempPath, filePath)
}

function stopDownload(child: cp.ChildProcess) {
  if (process.platform !== 'win32' || !child.pid) return Promise.resolve(child.kill('SIGTERM'))

  return new Promise<boolean>((resolve) => {
    cp.execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], (error) => {
      if (error) console.error(`Failed to stop download: ${error.message}`)
      resolve(!error)
    })
  })
}

function enablePauseControls(child: cp.ChildProcess) {
  let confirming = false
  let stopping: Promise<boolean> | null = null

  const onKeypress = (_: string, key: readline.Key) => {
    if (stopping) return
    if (!confirming && key.name !== 'p') return
    if (!confirming) {
      confirming = true
      console.log('\nPause this VOD? Press Y to confirm or N to keep downloading.')
      return
    }
    if (key.name === 'n') {
      confirming = false
      console.log('\nDownload continues.')
      return
    }
    if (key.name !== 'y') return

    console.log('\nPausing download...')
    stopping = stopDownload(child)
  }

  console.log('Press P to pause this VOD download.')
  readline.emitKeypressEvents(process.stdin)
  if (process.stdin.isTTY) process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on('keypress', onKeypress)

  return async () => {
    process.stdin.off('keypress', onKeypress)
    if (process.stdin.isTTY) process.stdin.setRawMode(false)
    process.stdin.pause()
    return (await stopping) ?? false
  }
}

function runDownload(task: VodTask) {
  return new Promise<VodResult>((resolve) => {
    const stdio: cp.StdioOptions = task.interactive ? ['ignore', 'inherit', 'inherit'] : 'ignore'
    const child = cp.spawn(task.cmd, [], { shell: true, windowsHide: !task.interactive, stdio })
    const closeControls = task.interactive ? enablePauseControls(child) : null
    let finished = false

    const finish = async (exitCode: number | null, error?: string) => {
      if (finished) return
      finished = true
      const paused = closeControls ? await closeControls() : false
      resolve({ exitCode, paused, error })
    }

    child.once('error', (error) => finish(null, error.message))
    child.once('close', (exitCode) => finish(exitCode))
  })
}

async function main() {
  const taskPath = process.argv[2]
  if (!taskPath) throw Error('no VOD task path provided')

  const task = JSON.parse(await fs.readFile(taskPath, 'utf8')) as VodTask
  await saveResult(task.startedPath, { pid: process.pid })
  const result = await runDownload(task)

  await saveResult(task.resultPath, result)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
