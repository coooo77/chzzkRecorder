import cp from 'child_process'
import common from './common.js'

export default {
  getMediaDuration(videoPath: string, ffprobePath?: string): Promise<number> {
    return new Promise((resolve) => {
      try {
        const bin = common.checkFileExists(ffprobePath) ? ffprobePath! : 'ffprobe'

        const args = ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', videoPath]

        cp.execFile(bin, args, (error, stdout) => {
          if (error) {
            common.msg(`failed to get video duration, path: ${videoPath}, error: ${error.message}`, 'error')
            resolve(NaN)
            return
          }

          const parsed = parseFloat(stdout.trim())
          if (isNaN(parsed)) {
            common.msg(`failed to parse video duration from output: "${stdout.trim()}", path: ${videoPath}`, 'error')
            resolve(NaN)
            return
          }

          resolve(parsed)
        })
      } catch (error) {
        common.msg(`failed to execute ffprobe, path: ${videoPath}, error: ${error instanceof Error ? error.message : String(error)}`, 'error')
        resolve(NaN)
      }
    })
  },
}
