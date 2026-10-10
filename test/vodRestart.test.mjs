import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectDir = fileURLToPath(new URL('../', import.meta.url))
const codeDir = process.env.VOD_TEST_SOURCE ? 'src' : 'dist'
const extension = process.env.VOD_TEST_SOURCE ? 'ts' : 'js'
const modelUrl = pathToFileURL(path.join(projectDir, codeDir, `utils/model.${extension}`)).href
const recorderUrl = pathToFileURL(path.join(projectDir, codeDir, `utils/recorder.${extension}`)).href
const liveVodUrl = pathToFileURL(path.join(projectDir, codeDir, `utils/liveVod.${extension}`)).href
const fileSysUrl = pathToFileURL(path.join(projectDir, codeDir, `utils/fileSys.${extension}`)).href
const workerPath = path.join(projectDir, codeDir, `utils/vodWorker.${extension}`)

test('VOD result can be recovered after the crawler exits', async () => {
  const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chzzk-vod-'))
  const originalDir = process.cwd()

  try {
    await fs.writeFile(path.join(testDir, 'config.json'), JSON.stringify({ saveDirectory: testDir, dlVodConcurrency: 1, showVodWindow: false }))
    const outputPath = path.join(testDir, 'video.ts')
    const downloadPath = path.join(testDir, 'download.mjs')
    const startPath = path.join(testDir, 'start.mjs')

    await fs.writeFile(
      downloadPath,
      `import { spawnSync } from 'node:child_process'\nawait new Promise((resolve) => setTimeout(resolve, 1500))\nconst result = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=s=16x16:d=1', '-c:v', 'mpeg2video', ${JSON.stringify(outputPath)}])\nprocess.exit(result.status ?? 1)\n`,
    )

    await fs.writeFile(
      startPath,
      `import Model from ${JSON.stringify(modelUrl)}\nimport Recorder from ${JSON.stringify(recorderUrl)}\nimport LiveVod from ${JSON.stringify(liveVodUrl)}\nconst model = new Model()\nconst recorder = new Recorder({ api: {}, model })\nrecorder.getVodDownloadCmd = () => ${JSON.stringify(`"${process.execPath}" "${downloadPath}"`)}\nconst liveVod = new LiveVod({ api: {}, model, recorder })\nconst item = { vodNum: 123, status: 'waiting', tryCount: 0, adult: false, duration: 1, publishDate: new Date().toISOString(), channelId: 'test', username: 'test', vodUrl: 'https://chzzk.naver.com/video/123' }\nmodel.vodDownloadList[item.vodNum] = item\nawait liveVod.onDownloadVodStart(item)\nawait recorder.recordVOD(item)\n`,
    )

    const startArgs = process.env.VOD_TEST_SOURCE ? ['--import', import.meta.resolve('tsx'), startPath] : [startPath]
    const started = spawnSync(process.execPath, startArgs, { cwd: testDir, encoding: 'utf8' })
    assert.equal(started.status, 0, started.stderr)

    process.chdir(testDir)
    const { default: Model } = await import(modelUrl)
    const { default: Recorder } = await import(recorderUrl)
    const { default: LiveVod } = await import(liveVodUrl)
    const { default: fileSys } = await import(fileSysUrl)
    const model = new Model()
    model.vodDownloadList = await fileSys.getVodDownloadList()
    const recorder = new Recorder({ api: {}, model })
    recorder.getVodFilePath = () => outputPath
    const liveVod = new LiveVod({ api: {}, model, recorder })

    assert.equal(model.vodDownloadList[123].status, 'ongoing')
    assert.equal(liveVod.ableDownloadCount, 0)
    await liveVod.checkOngoingVodList()
    assert.equal(model.vodDownloadList[123].status, 'ongoing')

    for (let i = 0; i < 100 && model.vodDownloadList[123].status === 'ongoing'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      await liveVod.checkOngoingVodList()
    }

    assert.equal(model.vodDownloadList[123].status, 'success')
    assert.equal((await fileSys.getVodDownloadList())[123].status, 'success')
  } finally {
    process.chdir(originalDir)
    await fs.rm(testDir, { recursive: true, force: true })
  }
})

test('VOD pauses only after P and Y are pressed', async () => {
  const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chzzk-vod-pause-'))
  const taskPath = path.join(testDir, 'task.json')
  const startedPath = path.join(testDir, 'started.json')
  const resultPath = path.join(testDir, 'result.json')
  const downloadPath = path.join(testDir, 'download.mjs')

  try {
    await fs.writeFile(downloadPath, 'setTimeout(() => {}, 5000)\n')
    await fs.writeFile(
      taskPath,
      JSON.stringify({ cmd: `"${process.execPath}" "${downloadPath}"`, interactive: true, startedPath, resultPath }),
    )

    const args = process.env.VOD_TEST_SOURCE ? ['--import', import.meta.resolve('tsx'), workerPath, taskPath] : [workerPath, taskPath]
    const worker = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })

    try {
      for (let i = 0; i < 100; i++) {
        if (await fs.stat(startedPath).catch(() => null)) break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      assert.ok(await fs.stat(startedPath).catch(() => null))

      worker.stdin.write('p')
      await new Promise((resolve) => setTimeout(resolve, 100))
      worker.stdin.write('n')
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.equal(await fs.stat(resultPath).catch(() => null), null)

      worker.stdin.write('p')
      await new Promise((resolve) => setTimeout(resolve, 100))
      worker.stdin.write('y')

      for (let i = 0; i < 100; i++) {
        if (await fs.stat(resultPath).catch(() => null)) break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      const result = JSON.parse(await fs.readFile(resultPath, 'utf8'))
      assert.equal(result.paused, true)
    } finally {
      worker.kill()
    }
  } finally {
    await fs.rm(testDir, { recursive: true, force: true })
  }
})

test('visible VOD window starts its worker', { skip: process.env.VOD_TEST_VISIBLE !== '1' }, async () => {
  const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chzzk-vod-window-'))
  const originalDir = process.cwd()

  try {
    await fs.writeFile(path.join(testDir, 'config.json'), JSON.stringify({ showVodWindow: true }))
    const downloadPath = path.join(testDir, 'download.mjs')
    await fs.writeFile(downloadPath, 'setTimeout(() => {}, 500)\n')
    process.chdir(testDir)

    const { default: Model } = await import(modelUrl)
    const { default: Recorder } = await import(recorderUrl)
    const model = new Model()
    const recorder = new Recorder({ api: {}, model })
    recorder.getVodDownloadCmd = () => `"${process.execPath}" "${downloadPath}"`
    const item = { vodNum: 456, runId: 'visible-test', adult: false, vodUrl: 'https://chzzk.naver.com/video/456' }
    await recorder.recordVOD(item)

    const paths = recorder.getVodTaskPaths(item)
    for (let i = 0; i < 100; i++) {
      if (await fs.stat(paths.resultPath).catch(() => null)) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    const result = JSON.parse(await fs.readFile(paths.resultPath, 'utf8'))
    assert.equal(result.exitCode, 0)
    assert.equal(result.paused, false)
  } finally {
    process.chdir(originalDir)
    await fs.rm(testDir, { recursive: true, force: true })
  }
})
