import Api from './utils/api.js'
import Main from './utils/main.js'
import Model from './utils/model.js'
import LiveVod from './utils/liveVod.js'
import Recorder from './utils/recorder.js'

import Helper from './utils/common.js'

import Server from './utils/server.js'
import VodController from './utils/controllers/vod.js'
import RecordController from './utils/controllers/record.js'

const model = new Model()
const api = new Api({ model })
const recorder = new Recorder({ api, model })
const liveVod = new LiveVod({ api, model, recorder })
const main = new Main({ api, model, recorder, liveVod })

const vodController = new VodController(api, recorder, model)
const recordController = new RecordController(api, recorder, model)
const server = new Server(recordController, vodController)

model.listRecordEvent(recorder)

main.start()
server.init()

// 監聽所有未被 try/catch 處理的同步錯誤 (Uncaught Exception)
process.on('uncaughtException', async (err) => {
  await Helper.saveErrorLog(err)
  console.error('致命錯誤：未捕獲的同步異常', err.stack)
  server.server?.close()
  process.exit(1)
})

// 監聽所有未被 .catch() 處理的 Promise 拒絕 (Unhandled Rejection)
process.on('unhandledRejection', async (reason, promise) => {
  await Helper.saveErrorLog(reason, promise)
  console.error('致命錯誤：未處理的 Promise 拒絕', reason)
  server.server?.close()
  process.exit(1)
})

process.on('SIGINT', async () => {
  server.server?.close()
  console.log('Received SIGINT (Ctrl+C). Performing graceful shutdown...')
  process.exit(0)
})
