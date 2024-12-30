'use strict'

import Api from './utils/api.js'
import Vod from './utils/vod.js'
import Model from './utils/model.js'
import Recorder from './utils/recorder.js'
import Puppeteer from './utils/puppeteer.js'

const model = new Model()
const api = new Api({ model })
const puppeteer = new Puppeteer({ model })
const recorder = new Recorder({ api, model })
const downloadVod = new Vod({ api, model, puppeteer, recorder })

downloadVod.start()
