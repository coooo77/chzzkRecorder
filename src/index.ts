import Api from './utils/api.js'
import Main from './utils/main.js'
import Model from './utils/model.js'
import LiveVod from './utils/liveVod.js'
import Recorder from './utils/recorder.js'

const model = new Model()
const api = new Api({ model })
const recorder = new Recorder({ api, model })
const liveVod = new LiveVod({ api, model, recorder })
const main = new Main({ api, model, recorder, liveVod })

main.start()
