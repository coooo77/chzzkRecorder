import cp from 'child_process'

export default {
  getMediaDuration(videoPath: string) {
    const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${videoPath}`
    const stdout = cp.execSync(cmd).toString()
    return parseFloat(stdout)
  },
}
